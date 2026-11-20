package com.backend.erp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import tools.jackson.databind.ObjectMapper;

/**
 * การเงิน 1A: บัญชีเงิน · สมุดเงิน · รับ/จ่ายเงินอื่น ๆ · โอนระหว่างบัญชี
 * ตรวจ: สิทธิ์, ผู้บันทึก≠ผู้อนุมัติ (admin อนุมัติเองได้), เกณฑ์อนุมัติ, ยอดคงเหลือ, เงินสดติดลบไม่ได้, กลับรายการ, วันล็อกงวด, สมุดเงิน immutable
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class FinanceTests {
	static EmbeddedPostgres pg;

	@DynamicPropertySource
	static void db(DynamicPropertyRegistry r) throws IOException {
		pg = EmbeddedPostgres.builder().start();
		r.add("spring.datasource.url", () -> pg.getJdbcUrl("postgres", "postgres"));
		r.add("spring.datasource.username", () -> "postgres");
		r.add("spring.datasource.password", () -> "postgres");
	}

	@AfterAll
	static void stop() throws IOException { if (pg != null) pg.close(); }

	@Value("${local.server.port}") int port;
	@Autowired ObjectMapper mapper;
	@Autowired JdbcTemplate jdbc;
	final HttpClient http = HttpClient.newHttpClient();
	static String admin, acc, sales;
	static final LocalDate TODAY = LocalDate.now(ZoneId.of("Asia/Bangkok"));

	@SuppressWarnings("unchecked")
	Map<String, Object> call(String method, String path, Object body, String tok, int expect) throws Exception {
		HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1" + path)).header("Content-Type", "application/json");
		if (tok != null) b.header("Authorization", "Bearer " + tok);
		b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
		HttpResponse<String> res = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
		assertEquals(expect, res.statusCode(), method + " " + path + " -> " + res.body());
		String s = res.body();
		if (s == null || s.isBlank()) return Map.of();
		if (s.startsWith("[")) return Map.of("_list", mapper.readValue(s, List.class));
		return mapper.readValue(s, Map.class);
	}

	@SuppressWarnings("unchecked")
	String newUser(String username, String role) throws Exception {
		Map<String, Object> u = call("POST", "/users", Map.of("username", username, "fullName", username, "role", role), admin, 201);
		String temp = (String) u.get("temporaryPassword");
		String t = (String) call("POST", "/auth/login", Map.of("username", username, "password", temp), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", temp, "newPassword", "Test-Pass-" + username), t, 200);
		return t;
	}

	static Map<String, Object> account(String code, String type, double opening, LocalDate od) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("code", code); m.put("name", "บัญชี " + code); m.put("type", type); m.put("openingBalance", opening); m.put("openingDate", od.toString());
		return m;
	}

	static Map<String, Object> txn(String kind, String acct, double amount, String category) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("kind", kind); m.put("date", TODAY.toString()); m.put("accountId", acct); m.put("amount", amount); m.put("category", category);
		return m;
	}

	static Map<String, Object> with(Map<String, Object> m, String k, Object v) {
		Map<String, Object> c = new LinkedHashMap<>(m);
		c.put(k, v);
		return c;
	}

	@SuppressWarnings("unchecked")
	double balance(String acct) throws Exception {
		List<Map<String, Object>> list = (List<Map<String, Object>>) call("GET", "/finance/accounts", null, admin, 200).get("_list");
		return ((Number) list.stream().filter(a -> acct.equals(a.get("id"))).findFirst().orElseThrow().get("balance")).doubleValue();
	}

	int movements(String sourceId) { return jdbc.queryForObject("select count(*)::int from fin_movements where source_id = ?", Integer.class, sourceId); }

	@Test @Order(1)
	void setup() throws Exception {
		String t = (String) call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), t, 200);
		admin = t;
		acc = newUser("acc1", "accounting");
		sales = newUser("sale1", "sales");
	}

	@Test @Order(2)
	void accountsAndPermissions() throws Exception {
		call("GET", "/finance/accounts", null, sales, 403);                                                   // sales เข้าไม่ได้
		call("POST", "/finance/accounts", account("BANK1", "bank", 0, TODAY), sales, 403);
		call("POST", "/finance/accounts", account("BANK1", "bank", 0, TODAY), acc, 200);                      // accounting สร้างได้
		call("POST", "/finance/accounts", account("bank1", "bank", 0, TODAY), acc, 409);                      // รหัสซ้ำ (ไม่สนตัวพิมพ์)
		call("POST", "/finance/accounts", account("CASH1", "cash", 0, TODAY), acc, 200);
		call("POST", "/finance/accounts", account("BAD", "wallet", 0, TODAY), acc, 400);                      // ประเภทผิด
		call("POST", "/finance/accounts", account("NEG", "cash", -5, TODAY), acc, 400);                       // ยอดยกมาติดลบ
		call("POST", "/finance/accounts", with(account("OLD", "cash", 100, TODAY.minusDays(10)), "name", "เงินสดเก่า"), acc, 200);
		assertEquals(100.0, balance("OLD"), 1e-9);
	}

	@Test @Order(3)
	void adminSelfApprovesAndLedgerBalances() throws Exception {
		Map<String, Object> cap = call("POST", "/finance/txns", with(txn("other_in", "BANK1", 1000000, "เงินทุนเจ้าของ"), "counterparty", "เจ้าของ"), admin, 200);
		assertEquals("confirmed", cap.get("status"));
		assertEquals(Boolean.TRUE, cap.get("selfApproved"));                                                 // admin บันทึกและอนุมัติเอง → ติดป้าย
		assertTrue(String.valueOf(cap.get("id")).startsWith("RX" + TODAY.getYear()));
		assertEquals(1, movements(String.valueOf(cap.get("id"))));
		assertEquals(1000000.0, balance("BANK1"), 1e-9);
		Map<String, Object> led = call("GET", "/finance/accounts/BANK1/ledger", null, acc, 200);
		assertEquals(1, ((List<?>) led.get("movements")).size());
	}

	@Test @Order(4)
	void accountingNeedsAdminApproval() throws Exception {
		Map<String, Object> p = call("POST", "/finance/txns", txn("other_out", "BANK1", 25000, "เงินเดือน"), acc, 200);
		String id = String.valueOf(p.get("id"));
		assertEquals("pending", p.get("status"));
		assertEquals(0, movements(id));                                                                       // ยังไม่มีเงินเคลื่อนไหว
		assertEquals(1000000.0, balance("BANK1"), 1e-9);
		call("POST", "/finance/txns/" + id + "/approve", null, acc, 403);                                     // accounting อนุมัติเองไม่ได้
		Map<String, Object> ok = call("POST", "/finance/txns/" + id + "/approve", null, admin, 200);
		assertEquals("confirmed", ok.get("status"));
		assertEquals(Boolean.FALSE, ok.get("selfApproved"));
		assertEquals(975000.0, balance("BANK1"), 1e-9);
		call("POST", "/finance/txns/" + id + "/approve", null, admin, 409);                                   // อนุมัติซ้ำไม่ได้
		assertEquals(1, movements(id));
	}

	@Test @Order(5)
	void rejectAndCancel() throws Exception {
		String id = String.valueOf(call("POST", "/finance/txns", txn("other_out", "BANK1", 500, "ค่าไฟ"), acc, 200).get("id"));
		call("POST", "/finance/txns/" + id + "/reject", Map.of("reason", ""), admin, 400);                    // ต้องมีเหตุผล
		call("POST", "/finance/txns/" + id + "/reject", Map.of("reason", "ไม่มีใบแจ้งหนี้"), admin, 200);
		assertEquals(0, movements(id));
		String id2 = String.valueOf(call("POST", "/finance/txns", txn("other_out", "BANK1", 500, "ค่าน้ำ"), acc, 200).get("id"));
		call("POST", "/finance/txns/" + id2 + "/cancel", Map.of("reason", "บันทึกผิด"), acc, 200);          // ผู้บันทึกยกเลิกเองได้
		assertEquals(975000.0, balance("BANK1"), 1e-9);
	}

	@Test @Order(6)
	void transferAndCashRules() throws Exception {
		Map<String, Object> t = new LinkedHashMap<>(txn("transfer", "BANK1", 20000, ""));
		t.put("toAccountId", "CASH1");
		String id = String.valueOf(call("POST", "/finance/txns", t, admin, 200).get("id"));
		assertTrue(id.startsWith("TF"));
		assertEquals(2, movements(id));                                                                       // ออก + เข้า
		assertEquals(955000.0, balance("BANK1"), 1e-9);
		assertEquals(20000.0, balance("CASH1"), 1e-9);
		Map<String, Object> same = new LinkedHashMap<>(txn("transfer", "BANK1", 10, ""));
		same.put("toAccountId", "BANK1");
		call("POST", "/finance/txns", same, admin, 400);                                                      // ต้นทาง=ปลายทาง
		call("POST", "/finance/txns", txn("other_out", "CASH1", 20000.01, "ค่าเดินทาง"), admin, 422);        // เงินสดติดลบไม่ได้
		call("POST", "/finance/txns", txn("other_out", "CASH1", 20000, "ค่าเดินทาง"), admin, 200);
		assertEquals(0.0, balance("CASH1"), 1e-9);
		call("POST", "/finance/txns", txn("other_out", "BANK1", 2000000, "ผ่อนชำระเงินกู้"), admin, 200);      // ธนาคารเบิกเกินบัญชีได้
		assertTrue(balance("BANK1") < 0);
		call("POST", "/finance/txns", txn("other_in", "BANK1", 1045000, "เงินทุนเจ้าของ"), admin, 200);       // ใส่ทุนเพิ่มให้ยอดกลับ 0.00
		assertEquals(0.0, balance("BANK1"), 1e-9);
	}

	@Test @Order(7)
	void validationRules() throws Exception {
		call("POST", "/finance/txns", with(txn("other_in", "BANK1", 100, "x"), "date", TODAY.plusDays(1).toString()), admin, 400);   // วันที่อนาคต
		call("POST", "/finance/txns", with(txn("other_in", "BANK1", 0, "x"), "amount", 0), admin, 400);                              // จำนวน 0
		call("POST", "/finance/txns", with(txn("other_in", "BANK1", 1.005, "x"), "amount", "1.005"), admin, 400);                    // ทศนิยมเกิน 2
		call("POST", "/finance/txns", txn("other_in", "BANK1", 100, ""), admin, 400);                                                // ไม่มีหมวด
		call("POST", "/finance/txns", txn("other_in", "NOPE", 100, "x"), admin, 400);                                                // ไม่พบบัญชี
		call("POST", "/finance/txns", with(txn("other_in", "OLD", 100, "x"), "date", TODAY.minusDays(20).toString()), admin, 400);   // ก่อนวันยอดยกมา
		call("PUT", "/finance/accounts/BANK1", Map.of("openingBalance", 5), acc, 409);                                               // มีเคลื่อนไหวแล้วแก้ยอดยกมาไม่ได้
		call("PUT", "/finance/accounts/OLD", Map.of("active", false), acc, 409);                                                     // ยังมียอดคงเหลือ ปิดไม่ได้
	}

	@Test @Order(8)
	void thresholdAutoConfirms() throws Exception {
		call("PUT", "/finance/settings", Map.of("approvalThreshold", 500), acc, 403);                          // เฉพาะ admin ตั้งค่า
		call("PUT", "/finance/settings", Map.of("approvalThreshold", 500), admin, 200);
		Map<String, Object> small = call("POST", "/finance/txns", txn("other_in", "OLD", 300, "ดอกเบี้ยรับ"), acc, 200);
		assertEquals("confirmed", small.get("status"));                                                       // ไม่เกินเกณฑ์ → ยืนยันเอง
		assertEquals(Boolean.FALSE, small.get("selfApproved"));
		Map<String, Object> big = call("POST", "/finance/txns", txn("other_in", "OLD", 600, "ดอกเบี้ยรับ"), acc, 200);
		assertEquals("pending", big.get("status"));
		call("PUT", "/finance/settings", Map.of("approvalThreshold", 0), admin, 200);
		call("POST", "/finance/txns/" + big.get("id") + "/approve", null, admin, 200);
	}

	@Test @Order(9)
	void voidCreatesReversalAndLockDateBlocks() throws Exception {
		double before = balance("OLD");
		String id = String.valueOf(call("POST", "/finance/txns", with(txn("other_in", "OLD", 1000, "เงินกู้กรรมการ"), "date", TODAY.minusDays(7).toString()), admin, 200).get("id"));
		assertEquals(before + 1000, balance("OLD"), 1e-9);
		call("POST", "/finance/txns/" + id + "/void", Map.of("reason", "บันทึกผิดบัญชี"), acc, 403);          // เฉพาะ admin กลับรายการ
		call("POST", "/finance/txns/" + id + "/void", Map.of("reason", ""), admin, 400);
		call("POST", "/finance/txns/" + id + "/void", Map.of("reason", "x", "date", TODAY.minusDays(9).toString()), admin, 400);   // ก่อนวันรายการเดิม
		Map<String, Object> v = call("POST", "/finance/txns/" + id + "/void", Map.of("reason", "บันทึกผิดบัญชี"), admin, 200);
		assertEquals("void", v.get("status"));
		assertEquals(before, balance("OLD"), 1e-9);                                                           // ยอดกลับเท่าเดิม
		assertEquals(2, movements(id));                                                                       // ต้นฉบับยังอยู่ + รายการตรงข้ามลงวันที่กลับรายการ
		assertEquals(1, jdbc.queryForObject("select count(*)::int from fin_movements where source_id = ? and reversal_of is not null", Integer.class, id));
		call("POST", "/finance/txns/" + id + "/void", Map.of("reason", "ซ้ำ"), admin, 409);                    // กลับซ้ำไม่ได้
		// วันล็อกงวด
		call("PUT", "/finance/settings", Map.of("lockDate", TODAY.plusDays(1).toString()), admin, 400);        // ล็อกอนาคตไม่ได้
		call("PUT", "/finance/settings", Map.of("lockDate", TODAY.minusDays(5).toString()), admin, 200);
		call("POST", "/finance/txns", with(txn("other_in", "OLD", 10, "x"), "date", TODAY.minusDays(6).toString()), admin, 409);      // งวดล็อก
		call("POST", "/finance/txns", with(txn("other_in", "OLD", 10, "x"), "date", TODAY.minusDays(4).toString()), admin, 200);      // งวดเปิด
		Map<String, Object> unlock = new LinkedHashMap<>();
		unlock.put("lockDate", null);
		call("PUT", "/finance/settings", unlock, admin, 200);                                                  // ยกเลิกวันล็อก
	}

	@Test @Order(10)
	void ledgerIsImmutableAndBalancesAddUp() throws Exception {
		assertThrows(Exception.class, () -> jdbc.update("delete from fin_movements"));
		assertThrows(Exception.class, () -> jdbc.update("update fin_movements set amount = amount + 1"));
		jdbc.update("update fin_movements set cleared = true, statement_ref = 'STM-1' where id = (select min(id) from fin_movements)");   // ฟิลด์กระทบยอดแก้ได้
		// ยอดคงเหลือทุกบัญชี = ยอดยกมา + เงินเข้า − เงินออก
		for (String acct : List.of("BANK1", "CASH1", "OLD")) {
			Double fromLedger = jdbc.queryForObject("select (a.opening_balance + coalesce((select sum(case when m.direction='in' then m.amount else -m.amount end) from fin_movements m where m.account_id=a.id),0))::float8 from fin_accounts a where a.id = ?", Double.class, acct);
			assertEquals(fromLedger, balance(acct), 1e-9);
		}
		Map<String, Object> sum = call("GET", "/finance/summary", null, admin, 200);
		assertFalse(sum.isEmpty());
		assertEquals(0, ((Number) sum.get("pendingCount")).intValue());
	}

	@SuppressWarnings("unchecked")
	@Test @Order(11)
	void listsPageSearchAndSortOnServerWithoutSilentCap() throws Exception {
		// เพิ่มรายการเกิน 500 แถวตรง ๆ (ไม่ผ่าน API เพื่อความเร็ว) — ต้องไม่ถูกตัดเงียบ ๆ
		jdbc.update("insert into fin_txns(id,kind,txn_date,account_id,amount,category,counterparty,status,created_by,created_by_id) select 'ZZ-' || g, 'other_in', ?::date, 'OLD', g, 'หมวดทดสอบ', case when g = 7 then 'บริษัทค้นหาเจอ' else 'x' end, 'confirmed', 'test', 'test' from generate_series(1, 650) g", TODAY.toString());
		List<Object> all = (List<Object>) call("GET", "/finance/txns?kind=other_in", null, admin, 200).get("_list");
		assertTrue(all.size() >= 650, "ไม่ส่ง page ต้องได้ครบทุกแถว ไม่ตัดที่ 500 (ได้ " + all.size() + ")");
		Map<String, Object> p = call("GET", "/finance/txns?kind=other_in&page=2&size=100&sort=amount&dir=desc", null, admin, 200);
		assertEquals(100, ((List<Object>) p.get("items")).size());
		assertTrue(((Number) p.get("total")).intValue() >= 650);
		double first = ((Number) ((Map<String, Object>) ((List<Object>) p.get("items")).get(0)).get("amount")).doubleValue();
		double last = ((Number) ((Map<String, Object>) ((List<Object>) p.get("items")).get(99)).get("amount")).doubleValue();
		assertTrue(first >= last, "ต้องเรียงจากมากไปน้อย");
		Map<String, Object> s = call("GET", "/finance/txns?page=1&size=50&q=" + java.net.URLEncoder.encode("ค้นหาเจอ", "UTF-8"), null, admin, 200);
		assertEquals(1, ((Number) s.get("total")).intValue());
		Map<String, Object> pct = call("GET", "/finance/txns?page=1&size=50&q=%25", null, admin, 200);   // "%" ต้องค้นเป็นตัวอักษร ไม่ใช่ wildcard
		assertEquals(0, ((Number) pct.get("total")).intValue());
		Map<String, Object> d = call("GET", "/finance/txns?page=1&size=5&from=" + TODAY.plusDays(1) + "&to=" + TODAY.plusDays(2), null, admin, 200);
		assertEquals(0, ((Number) d.get("total")).intValue());
		call("GET", "/finance/txns?page=1&from=2026-13-45", null, admin, 400);
		call("GET", "/finance/txns?page=1&sort=id;drop%20table", null, admin, 200);                       // คีย์เรียงที่ไม่รู้จัก → ใช้ค่าเริ่มต้น ไม่หลุดเข้า SQL
		call("GET", "/finance/receipts?page=1&size=10&status=WHT", null, admin, 200);
		call("GET", "/finance/receipts?page=1&size=10&status=REFUND&q=abc", null, admin, 200);
		call("GET", "/finance/payments?page=1&size=10&q=abc&sort=net&dir=asc", null, admin, 200);
	}
}
