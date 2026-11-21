package com.backend.erp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
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
 * การเงิน A3: ใบสำคัญจ่าย (PV) — ผู้รับเงินคนเดียว, อนุมัติ, จ่ายตามบัญชี, หัก ณ ที่จ่าย (WT) ณ วันจ่ายจริง, ผู้บันทึก≠ผู้อนุมัติ, ยกเลิก, กลับรายการ
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class PaymentTests {
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
	static String admin, acc, sales, pv1;
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

	String expStatus(String id) { return jdbc.queryForObject("select data->>'status' from erp_records where collection='expenses' and id = ?", String.class, id); }

	static Map<String, Object> account(String code, String type, double opening) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("code", code); m.put("name", "บัญชี " + code); m.put("type", type); m.put("openingBalance", opening); m.put("openingDate", TODAY.toString());
		return m;
	}

	void exp(String id, String vendor, double amount, double vat, int whtRate, String status) {
		jdbc.update("insert into erp_records(collection,id,data) values ('expenses',?,?::jsonb)", id,
			"{\"id\":\"" + id + "\",\"vendor\":\"" + vendor + "\",\"amount\":" + amount + ",\"vat\":" + vat + ",\"whtRate\":" + whtRate + ",\"status\":\"" + status + "\",\"date\":\"" + TODAY + "\",\"category\":\"ทดสอบ\"}");
	}

	static Map<String, Object> pv(List<String> ids) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("date", TODAY.toString()); m.put("expenseIds", ids);
		return m;
	}

	static Map<String, Object> payBody(String acct) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("accountId", acct); m.put("payDate", TODAY.toString()); m.put("refNo", "SLIP-1");
		return m;
	}

	@Test @Order(1)
	void setup() throws Exception {
		String t = (String) call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), t, 200);
		admin = t;
		acc = newUser("acc1", "accounting");
		sales = newUser("sale1", "sales");
		call("POST", "/finance/accounts", account("BANK1", "bank", 100000), admin, 200);
		call("POST", "/finance/accounts", account("CASH1", "cash", 500), admin, 200);
		exp("EXP-A", "ผู้ขาย ก", 10000, 700, 3, "approved");   // สุทธิ 10,400 (หัก 300)
		exp("EXP-B", "ผู้ขาย ก", 2000, 0, 0, "approved");      // สุทธิ 2,000
		exp("EXP-C", "ผู้ขาย ข", 1000, 0, 0, "approved");
		exp("EXP-D", "ผู้ขาย ก", 500, 0, 0, "paid");
		exp("EXP-E", "ผู้ขาย ค", 300, 0, 0, "approved");
		exp("EXP-F", "ผู้ขาย ง", 100, 0, 0, "approved");
	}

	@Test @Order(2)
	void validationAndPermissions() throws Exception {
		call("GET", "/finance/payments", null, sales, 403);
		call("POST", "/finance/payments", pv(List.of("EXP-A")), sales, 403);
		call("POST", "/finance/payments", pv(List.of()), admin, 400);
		call("POST", "/finance/payments", pv(List.of("NOPE")), admin, 400);
		call("POST", "/finance/payments", pv(List.of("EXP-D")), admin, 409);                       // จ่ายแล้ว
		call("POST", "/finance/payments", pv(List.of("EXP-A", "EXP-C")), admin, 400);              // ผู้รับเงินต่างกัน
		call("POST", "/finance/payments", pv(List.of("EXP-A", "EXP-A")), admin, 400);              // ซ้ำ
		assertEquals(0, jdbc.queryForObject("select count(*)::int from fin_pay_vouchers", Integer.class));
		assertEquals(5, ((List<?>) call("GET", "/finance/payments/payables", null, acc, 200).get("_list")).size());   // A,B,C,E,F รอจ่าย (D จ่ายแล้ว)
	}

	@Test @Order(3)
	void adminCreatesApprovesAndPaysWithWhtAtPayDate() throws Exception {
		Map<String, Object> v = call("POST", "/finance/payments", pv(List.of("EXP-A", "EXP-B")), admin, 200);
		pv1 = String.valueOf(v.get("id"));
		assertEquals("approved", v.get("status"));
		assertEquals(Boolean.TRUE, v.get("selfApproved"));
		assertTrue(pv1.startsWith("PV" + TODAY.getYear()));
		assertEquals(12700.0, ((Number) v.get("gross")).doubleValue(), 1e-9);
		assertEquals(300.0, ((Number) v.get("wht")).doubleValue(), 1e-9);
		assertEquals(12400.0, ((Number) v.get("net")).doubleValue(), 1e-9);
		assertEquals(100000.0, balance("BANK1"), 1e-9);                                           // ยังไม่จ่าย เงินไม่ออก
		call("POST", "/finance/payments", pv(List.of("EXP-A")), admin, 409);                      // อยู่ในใบสำคัญจ่ายแล้ว
		call("POST", "/finance/payments/" + pv1 + "/pay", Map.of("payDate", TODAY.toString()), admin, 400);           // ไม่ระบุบัญชี
		Map<String, Object> early = new LinkedHashMap<>(payBody("BANK1"));
		early.put("payDate", TODAY.minusDays(3).toString());
		call("POST", "/finance/payments/" + pv1 + "/pay", early, admin, 400);                     // ก่อนวันที่ใบสำคัญจ่าย
		Map<String, Object> paid = call("POST", "/finance/payments/" + pv1 + "/pay", payBody("BANK1"), admin, 200);
		assertEquals("paid", paid.get("status"));
		assertEquals(87600.0, balance("BANK1"), 1e-9);                                            // ออกเฉพาะยอดสุทธิ
		assertTrue(String.valueOf(paid.get("whtCertNo")).startsWith("WT" + TODAY.getYear()));     // เลขหนังสือหัก ณ ที่จ่าย ออกตอนจ่าย
		assertEquals(TODAY.toString(), paid.get("whtCertDate"));
		assertEquals("paid", expStatus("EXP-A"));
		assertEquals("paid", expStatus("EXP-B"));
		assertEquals(pv1, jdbc.queryForObject("select data->>'payVoucher' from erp_records where collection='expenses' and id='EXP-A'", String.class));
		String wt = String.valueOf(paid.get("whtCertNo"));
		assertEquals(wt, jdbc.queryForObject("select data->>'payWtNo' from erp_records where collection='expenses' and id='EXP-A'", String.class));   // รายการที่หัก → ได้เลข WT ของ PV
		assertNull(jdbc.queryForObject("select data->>'payWtNo' from erp_records where collection='expenses' and id='EXP-B'", String.class));        // รายการที่ไม่หัก → ไม่มี
		jdbc.update("update erp_records set data = data || '{\"whtCert\":{\"no\":\"" + wt + "\"}}'::jsonb where collection='expenses' and id='EXP-A'");   // จำลองว่าพิมพ์หนังสือแล้ว
		call("POST", "/finance/payments/" + pv1 + "/pay", payBody("BANK1"), admin, 409);          // จ่ายซ้ำไม่ได้
	}

	@Test @Order(4)
	void makerCheckerAndCashLimit() throws Exception {
		Map<String, Object> p = call("POST", "/finance/payments", pv(List.of("EXP-C")), acc, 200);
		String id = String.valueOf(p.get("id"));
		assertEquals("pending", p.get("status"));
		call("POST", "/finance/payments/" + id + "/pay", payBody("BANK1"), acc, 409);             // ยังไม่อนุมัติ จ่ายไม่ได้
		call("POST", "/finance/payments/" + id + "/approve", null, acc, 403);
		call("POST", "/finance/payments/" + id + "/approve", null, admin, 200);
		call("POST", "/finance/payments/" + id + "/pay", payBody("CASH1"), acc, 422);             // เงินสดมี 500 จ่าย 1,000 ไม่พอ
		assertEquals("approved", expStatus("EXP-C"));
		call("POST", "/finance/payments/" + id + "/pay", payBody("BANK1"), acc, 200);             // ฝ่ายบัญชีจ่ายจากธนาคารได้
		assertEquals(86600.0, balance("BANK1"), 1e-9);
	}

	@Test @Order(5)
	void rejectAndCancelReleaseExpenses() throws Exception {
		Map<String, Object> p = call("POST", "/finance/payments", pv(List.of("EXP-E")), acc, 200);
		String id = String.valueOf(p.get("id"));
		call("POST", "/finance/payments/" + id + "/reject", Map.of("reason", ""), admin, 400);
		call("POST", "/finance/payments/" + id + "/cancel", Map.of("reason", "คีย์ผิด"), sales, 403);
		call("POST", "/finance/payments/" + id + "/cancel", Map.of("reason", "คีย์ผิด"), acc, 200);
		assertEquals("approved", expStatus("EXP-E"));                                             // กลับมารอจ่าย
		Map<String, Object> p2 = call("POST", "/finance/payments", pv(List.of("EXP-E")), acc, 200);
		call("POST", "/finance/payments/" + p2.get("id") + "/reject", Map.of("reason", "ไม่ถูกต้อง"), admin, 200);
		call("POST", "/finance/payments", pv(List.of("EXP-E")), admin, 200);                      // สร้างใหม่ได้อีก
	}

	@Test @Order(6)
	void payNowShortcut() throws Exception {
		Map<String, Object> b = new LinkedHashMap<>(pv(List.of("EXP-F")));
		b.put("pay", payBody("CASH1"));
		Map<String, Object> v = call("POST", "/finance/payments", b, admin, 200);
		assertEquals("paid", v.get("status"));                                                     // บันทึกและจ่ายทันที
		assertEquals(400.0, balance("CASH1"), 1e-9);
		assertEquals(1, movements(String.valueOf(v.get("id"))));
		assertEquals("paid", expStatus("EXP-F"));
	}

	@Test @Order(7)
	void voidPaidRestoresEverything() throws Exception {
		call("POST", "/finance/payments/" + pv1 + "/void", Map.of("reason", "จ่ายผิดบัญชี"), acc, 403);
		call("POST", "/finance/payments/" + pv1 + "/void", Map.of("reason", ""), admin, 400);
		Map<String, Object> v = call("POST", "/finance/payments/" + pv1 + "/void", Map.of("reason", "จ่ายผิดบัญชี"), admin, 200);
		assertEquals("void", v.get("status"));
		assertEquals(99000.0, balance("BANK1"), 1e-9);                                            // 86,600 + 12,400 คืน
		assertEquals(2, movements(pv1));
		assertEquals("approved", expStatus("EXP-A"));                                             // ค่าใช้จ่ายกลับมารอจ่าย
		assertEquals(0, jdbc.queryForObject("select count(*)::int from erp_records where collection='expenses' and id='EXP-A' and data ? 'payVoucher'", Integer.class));
		assertEquals(0, jdbc.queryForObject("select count(*)::int from erp_records where collection='expenses' and id='EXP-A' and (data ? 'payWtNo' or data ? 'whtCert')", Integer.class));   // เลข/หนังสือเดิมถูกถอด
		assertEquals(1, jdbc.queryForObject("select count(*)::int from erp_records where collection='expenses' and id='EXP-A' and data ? 'whtCertVoided'", Integer.class));            // แต่เก็บหลักฐานไว้
		call("POST", "/finance/payments/" + pv1 + "/void", Map.of("reason", "ซ้ำ"), admin, 409);
		call("POST", "/finance/payments", pv(List.of("EXP-A", "EXP-B")), admin, 200);             // ออกใบสำคัญจ่ายใหม่ได้
	}

	@Test @Order(8)
	void itemsAreImmutable() {
		assertThrows(Exception.class, () -> jdbc.update("delete from fin_pay_items"));
		assertThrows(Exception.class, () -> jdbc.update("update fin_pay_items set base = base + 1"));
	}
}
