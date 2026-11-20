package com.backend.erp;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
 * การเงิน A2: รับเงินลูกค้า (RV) — จัดสรรเข้าใบกำกับ, ค่าธรรมเนียมธนาคาร, ภาษีถูกหัก (รอ 50 ทวิ), เงินส่วนเกิน/คืนเงิน, ผู้บันทึก≠ผู้อนุมัติ, กลับรายการ
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ReceiptTests {
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

	@SuppressWarnings("unchecked")
	double balance(String acct) throws Exception {
		List<Map<String, Object>> list = (List<Map<String, Object>>) call("GET", "/finance/accounts", null, admin, 200).get("_list");
		return ((Number) list.stream().filter(a -> acct.equals(a.get("id"))).findFirst().orElseThrow().get("balance")).doubleValue();
	}

	int movements(String sourceId) { return jdbc.queryForObject("select count(*)::int from fin_movements where source_id = ?", Integer.class, sourceId); }

	static Map<String, Object> account(String code, String type) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("code", code); m.put("name", "บัญชี " + code); m.put("type", type); m.put("openingBalance", 0); m.put("openingDate", TODAY.toString());
		return m;
	}

	static Map<String, Object> with(Map<String, Object> m, String k, Object v) {
		Map<String, Object> c = new LinkedHashMap<>(m);
		c.put(k, v);
		return c;
	}

	void inv(String id, String cust, double total, double wht, String status) {
		jdbc.update("insert into erp_records(collection,id,data) values ('docs',?,?::jsonb)", id,
			"{\"type\":\"INV\",\"customer\":\"" + cust + "\",\"customerName\":\"c\",\"status\":\"" + status + "\",\"total\":" + total + ",\"wht\":" + wht + ",\"date\":\"" + TODAY + "\"}");
	}

	static Map<String, Object> alloc(String inv, double amount, double wht) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("invoiceId", inv); m.put("amount", amount); m.put("wht", wht);
		return m;
	}

	static Map<String, Object> rv(String cust, String acct, double received, double fee, List<Map<String, Object>> allocs) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("date", TODAY.toString()); m.put("customerId", cust); m.put("accountId", acct); m.put("received", received); m.put("bankFee", fee); m.put("allocations", allocs);
		return m;
	}

	@SuppressWarnings("unchecked")
	double remaining(String cust, String invId) throws Exception {
		List<Map<String, Object>> l = (List<Map<String, Object>>) call("GET", "/finance/receipts/open-invoices?customerId=" + cust, null, admin, 200).get("_list");
		return l.stream().filter(i -> invId.equals(i.get("id"))).findFirst().map(i -> ((Number) i.get("remaining")).doubleValue()).orElse(0.0);
	}

	@Test @Order(1)
	void setup() throws Exception {
		String t = (String) call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), t, 200);
		admin = t;
		acc = newUser("acc1", "accounting");
		sales = newUser("sale1", "sales");
		call("POST", "/finance/accounts", account("BANK1", "bank"), admin, 200);
		call("POST", "/finance/accounts", account("CASH1", "cash"), admin, 200);
		jdbc.update("insert into erp_records(collection,id,data) values ('customers','C1','{\"name\":\"ลูกค้า 1\"}'::jsonb), ('customers','C2','{\"name\":\"ลูกค้า 2\"}'::jsonb)");
		inv("IV-1", "C1", 1070, 30, "approved");
		inv("IV-2", "C1", 500, 0, "approved");
		inv("IV-3", "C2", 800, 0, "approved");
		inv("IV-DRAFT", "C1", 100, 0, "draft");
	}

	@Test @Order(2)
	void validationAndPermissions() throws Exception {
		call("POST", "/finance/receipts", rv("C1", "BANK1", 100, 0, List.of(alloc("IV-1", 100, 0))), sales, 403);
		call("GET", "/finance/receipts", null, sales, 403);
		call("POST", "/finance/receipts", rv("C1", "BANK1", 100, 0, List.of()), admin, 400);                                    // ไม่มีรายการจัดสรร
		call("POST", "/finance/receipts", rv("NOPE", "BANK1", 100, 0, List.of(alloc("IV-1", 100, 0))), admin, 400);             // ไม่พบลูกค้า
		call("POST", "/finance/receipts", rv("C1", "BANK1", 100, 0, List.of(alloc("IV-3", 100, 0))), admin, 400);               // ใบกำกับของลูกค้าอื่น
		call("POST", "/finance/receipts", rv("C1", "BANK1", 100, 0, List.of(alloc("IV-DRAFT", 100, 0))), admin, 409);           // ใบกำกับยังไม่อนุมัติ
		call("POST", "/finance/receipts", rv("C1", "BANK1", 100, 0, List.of(alloc("IV-1", 200, 0))), admin, 422);               // จัดสรรมากกว่าเงินรับ
		call("POST", "/finance/receipts", rv("C1", "BANK1", 2000, 0, List.of(alloc("IV-1", 2000, 0))), admin, 422);            // เกินยอดคงค้างใบกำกับ
		call("POST", "/finance/receipts", rv("C1", "BANK1", 100, 0, List.of(alloc("IV-1", 70, 30), alloc("IV-1", 10, 0))), admin, 400);   // ใบกำกับซ้ำ
		call("POST", "/finance/receipts", rv("C1", "BANK1", 100, 0, List.of(alloc("IV-1", 70, 31))), admin, 422);               // ภาษีถูกหักเกินในใบกำกับ
		assertEquals(0.0, balance("BANK1"), 1e-9);
		assertEquals(0, jdbc.queryForObject("select count(*)::int from fin_receipts", Integer.class));                           // ที่ปฏิเสธต้องไม่เหลือร่องรอย
	}

	@Test @Order(3)
	void feeWhtAndFullSettlement() throws Exception {
		// IV-1 ยอด 1070 ภาษีถูกหัก 30: ลูกค้าโอน 1040 ธนาคารหักค่าธรรมเนียม 25 → เข้าบัญชี 1015, ตัดใบกำกับ 1040 + wht 30 = 1070
		Map<String, Object> r = call("POST", "/finance/receipts", rv("C1", "BANK1", 1015, 25, List.of(alloc("IV-1", 1040, 30))), admin, 200);
		assertEquals("confirmed", r.get("status"));
		assertEquals(Boolean.TRUE, r.get("selfApproved"));
		assertTrue(String.valueOf(r.get("id")).startsWith("RV" + TODAY.getYear()));
		assertEquals(30.0, ((Number) r.get("wht")).doubleValue(), 1e-9);
		assertEquals(0.0, ((Number) r.get("excess")).doubleValue(), 1e-9);
		assertEquals(Boolean.TRUE, r.get("whtCertPending"));                                                                      // รอ 50 ทวิ
		assertEquals(1015.0, balance("BANK1"), 1e-9);                                                                             // เข้าบัญชีเฉพาะที่ได้รับจริง
		assertEquals(0.0, remaining("C1", "IV-1"), 1e-9);                                                                         // ใบกำกับปิดครบ
		call("POST", "/finance/receipts", rv("C1", "BANK1", 10, 0, List.of(alloc("IV-1", 10, 0))), admin, 422);                  // ปิดแล้วจัดสรรเพิ่มไม่ได้
		String id = String.valueOf(r.get("id"));
		assertEquals(List.of("IV-1"), call("GET", "/finance/receipts/wht-invoices", null, acc, 200).get("_list"));              // ฝั่งลูกค้า: ภาษีถูกหักของ IV-1 ติดตามผ่านใบรับเงิน
		call("GET", "/finance/receipts/wht-invoices", null, sales, 403);
		assertEquals(1, ((Number) call("GET", "/finance/receipts/summary", null, acc, 200).get("whtCertPendingCount")).intValue());
		call("POST", "/finance/receipts/" + id + "/wht-cert", Map.of("no", "", "date", TODAY.toString(), "amount", 30), acc, 400);
		Map<String, Object> c = call("POST", "/finance/receipts/" + id + "/wht-cert", Map.of("no", "50T-001", "date", TODAY.toString(), "amount", 30), acc, 200);
		assertEquals(Boolean.FALSE, c.get("whtCertPending"));
		assertEquals(0, ((Number) call("GET", "/finance/receipts/summary", null, acc, 200).get("whtCertPendingCount")).intValue());
	}

	@Test @Order(4)
	void partialPaymentKeepsInvoiceOpen() throws Exception {
		call("POST", "/finance/receipts", rv("C1", "BANK1", 200, 0, List.of(alloc("IV-2", 200, 0))), admin, 200);                 // จ่ายไม่ครบ → ยังคงค้าง
		assertEquals(300.0, remaining("C1", "IV-2"), 1e-9);
		call("POST", "/finance/receipts", rv("C1", "BANK1", 300.01, 0, List.of(alloc("IV-2", 300.01, 0))), admin, 422);          // เกินคงค้าง 1 สตางค์
		call("POST", "/finance/receipts", rv("C1", "BANK1", 300, 0, List.of(alloc("IV-2", 300, 0))), admin, 200);
		assertEquals(0.0, remaining("C1", "IV-2"), 1e-9);
	}

	@Test @Order(5)
	void excessNeedsConfirmAndRefundFlow() throws Exception {
		call("POST", "/finance/receipts", rv("C2", "BANK1", 1000, 0, List.of(alloc("IV-3", 800, 0))), admin, 422);               // เกิน 200 ต้องยืนยัน
		Map<String, Object> ok = call("POST", "/finance/receipts", with(rv("C2", "BANK1", 1000, 0, List.of(alloc("IV-3", 800, 0))), "keepExcess", true), admin, 200);
		String id = String.valueOf(ok.get("id"));
		assertEquals(200.0, ((Number) ok.get("excess")).doubleValue(), 1e-9);
		assertEquals(200.0, ((Number) call("GET", "/finance/receipts/summary", null, admin, 200).get("refundDue")).doubleValue(), 1e-9);
		double before = balance("BANK1");
		Map<String, Object> bad = new LinkedHashMap<>();
		bad.put("date", TODAY.toString()); bad.put("accountId", "BANK1"); bad.put("amount", 250);
		call("POST", "/finance/receipts/" + id + "/refund", bad, admin, 422);                                                       // คืนเกินส่วนเกินไม่ได้
		bad.put("amount", 150);
		Map<String, Object> r = call("POST", "/finance/receipts/" + id + "/refund", bad, admin, 200);
		assertEquals(150.0, ((Number) r.get("refunded")).doubleValue(), 1e-9);
		assertEquals(before - 150, balance("BANK1"), 1e-9);
		bad.put("amount", 60);
		call("POST", "/finance/receipts/" + id + "/refund", bad, admin, 422);                                                       // เหลือคืนได้ 50
		call("POST", "/finance/receipts/" + id + "/void", Map.of("reason", "ทดสอบ"), admin, 409);                                   // มีการคืนเงินแล้ว กลับรายการไม่ได้
	}

	@Test @Order(6)
	void makerCheckerAndVoid() throws Exception {
		inv("IV-4", "C1", 400, 0, "approved");
		double before = balance("CASH1");
		Map<String, Object> p = call("POST", "/finance/receipts", rv("C1", "CASH1", 400, 0, List.of(alloc("IV-4", 400, 0))), acc, 200);
		assertEquals("pending", p.get("status"));                                                                                   // accounting บันทึก → รออนุมัติ
		String id = String.valueOf(p.get("id"));
		assertEquals(before, balance("CASH1"), 1e-9);                                                                               // ยังไม่เข้าสมุดเงิน
		assertEquals(0.0, remaining("C1", "IV-4"), 1e-9);                                                                           // แต่จองยอดใบกำกับไว้แล้ว
		call("POST", "/finance/receipts", rv("C1", "CASH1", 100, 0, List.of(alloc("IV-4", 100, 0))), admin, 422);                  // จัดสรรซ้ำซ้อนไม่ได้
		call("POST", "/finance/receipts/" + id + "/approve", null, acc, 403);
		Map<String, Object> a = call("POST", "/finance/receipts/" + id + "/approve", null, admin, 200);
		assertEquals("confirmed", a.get("status"));
		assertEquals(before + 400, balance("CASH1"), 1e-9);
		call("POST", "/finance/receipts/" + id + "/approve", null, admin, 409);                                                     // อนุมัติซ้ำไม่ได้
		call("POST", "/finance/receipts/" + id + "/void", Map.of("reason", "ลูกค้ายกเลิกการโอน"), acc, 403);
		Map<String, Object> v = call("POST", "/finance/receipts/" + id + "/void", Map.of("reason", "ลูกค้ายกเลิกการโอน"), admin, 200);
		assertEquals("void", v.get("status"));
		assertEquals(before, balance("CASH1"), 1e-9);
		assertEquals(400.0, remaining("C1", "IV-4"), 1e-9);                                                                         // ใบกำกับกลับมาคงค้าง
		assertEquals(2, movements(id));
		// ไม่อนุมัติ → คืนยอดใบกำกับ
		Map<String, Object> p2 = call("POST", "/finance/receipts", rv("C1", "CASH1", 50, 0, List.of(alloc("IV-4", 50, 0))), acc, 200);
		assertEquals(350.0, remaining("C1", "IV-4"), 1e-9);
		call("POST", "/finance/receipts/" + p2.get("id") + "/reject", Map.of("reason", "ไม่พบเงินเข้า"), admin, 200);
		assertEquals(400.0, remaining("C1", "IV-4"), 1e-9);
	}

	@SuppressWarnings("unchecked")
	List<Map<String, Object>> rcStatus() throws Exception { return (List<Map<String, Object>>) call("GET", "/finance/receipts/rc-status", null, acc, 200).get("_list"); }

	@Test @Order(8)
	void receiptsLinkToIssuedRcAndTrackCollection() throws Exception {
		jdbc.update("insert into erp_records(collection,id,data) values ('docs','RC-1','{\"type\":\"RC\",\"customer\":\"C1\",\"status\":\"approved\"}'::jsonb), "
			+ "('docs','RC-OTHER','{\"type\":\"RC\",\"customer\":\"C2\",\"status\":\"approved\"}'::jsonb), ('docs','RC-CANC','{\"type\":\"RC\",\"customer\":\"C1\",\"status\":\"cancelled\"}'::jsonb)");
		assertEquals(0, rcStatus().stream().filter(s -> "RC-1".equals(s.get("rcId"))).count());                                  // ยังไม่มีใครบันทึกรับเงิน = รอเก็บเงิน
		call("POST", "/finance/receipts", with(rv("C1", "CASH1", 100, 0, List.of(alloc("IV-4", 100, 0))), "rcIds", List.of("NOPE")), admin, 400);       // ไม่พบใบเสร็จ
		call("POST", "/finance/receipts", with(rv("C1", "CASH1", 100, 0, List.of(alloc("IV-4", 100, 0))), "rcIds", List.of("RC-OTHER")), admin, 400);    // ลูกค้าไม่ตรง
		call("POST", "/finance/receipts", with(rv("C1", "CASH1", 100, 0, List.of(alloc("IV-4", 100, 0))), "rcIds", List.of("RC-CANC")), admin, 409);     // ใบเสร็จถูกยกเลิก
		assertEquals(400.0, remaining("C1", "IV-4"), 1e-9);                                                                                           // ที่ปฏิเสธต้องไม่จองยอด
		Map<String, Object> pend = call("POST", "/finance/receipts", with(rv("C1", "CASH1", 100, 0, List.of(alloc("IV-4", 100, 0))), "rcIds", List.of("RC-1")), acc, 200);
		assertEquals(List.of("RC-1"), pend.get("rcIds"));
		assertEquals("pending", rcStatus().stream().filter(s -> "RC-1".equals(s.get("rcId"))).findFirst().orElseThrow().get("status"));              // รออนุมัติ
		call("POST", "/finance/receipts/" + pend.get("id") + "/approve", null, admin, 200);
		assertEquals("confirmed", rcStatus().stream().filter(s -> "RC-1".equals(s.get("rcId"))).findFirst().orElseThrow().get("status"));            // รับเงินแล้ว
		call("POST", "/finance/receipts/" + pend.get("id") + "/void", Map.of("reason", "ทดสอบ"), admin, 200);
		assertEquals(0, rcStatus().stream().filter(s -> "RC-1".equals(s.get("rcId"))).count());                                  // กลับรายการ → กลับไปรอเก็บเงิน
		call("GET", "/finance/receipts/rc-status", null, sales, 403);
	}

	@Test @Order(9)
	void allocationsAreImmutable() {
		assertThrows(Exception.class, () -> jdbc.update("delete from fin_receipt_allocs"));
		assertThrows(Exception.class, () -> jdbc.update("update fin_receipt_allocs set amount = amount + 1"));
	}
}
