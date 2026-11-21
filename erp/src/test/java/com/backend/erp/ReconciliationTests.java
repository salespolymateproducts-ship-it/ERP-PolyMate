package com.backend.erp;

import static org.junit.jupiter.api.Assertions.assertEquals;
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

/** การเงิน 1C: กระทบยอดบัญชีธนาคาร — ผลต่างต้อง 0, รายการเดียวกระทบซ้ำไม่ได้, ลำดับรอบ, สิทธิ์, ยกเลิกเฉพาะรอบล่าสุด */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ReconciliationTests {
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
	static String admin, acc, sales, rec1, rec2;
	static final LocalDate TODAY = LocalDate.now(ZoneId.of("Asia/Bangkok"));
	static long mvIn500, mvOut200, mvIn300, mvOut50;

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

	static Map<String, Object> txn(String kind, String acct, double amount) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("kind", kind); m.put("date", TODAY.toString()); m.put("accountId", acct); m.put("amount", amount); m.put("category", "ทดสอบ");
		return m;
	}

	long mvId(String desc) { return jdbc.queryForObject("select id from fin_movements where account_id='BANK1' and amount = ?::numeric order by id limit 1", Long.class, desc); }

	Map<String, Object> body(double balance, long... ids) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("accountId", "BANK1"); m.put("statementDate", TODAY.toString()); m.put("statementBalance", balance);
		m.put("movementIds", java.util.Arrays.stream(ids).boxed().toList());
		return m;
	}

	@Test @Order(1)
	void setup() throws Exception {
		String t = (String) call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), t, 200);
		admin = t;
		acc = newUser("acc1", "accounting");
		sales = newUser("sale1", "sales");
		Map<String, Object> a = new LinkedHashMap<>();
		a.put("code", "BANK1"); a.put("name", "ธนาคาร"); a.put("type", "bank"); a.put("openingBalance", 1000); a.put("openingDate", TODAY.toString());
		call("POST", "/finance/accounts", a, admin, 200);
		a.put("code", "CASH1"); a.put("name", "เงินสด"); a.put("type", "cash"); a.put("openingBalance", 100);
		call("POST", "/finance/accounts", a, admin, 200);
		call("POST", "/finance/txns", txn("other_in", "BANK1", 500), admin, 200);
		call("POST", "/finance/txns", txn("other_out", "BANK1", 200), admin, 200);
		call("POST", "/finance/txns", txn("other_in", "BANK1", 300), admin, 200);
		call("POST", "/finance/txns", txn("other_out", "BANK1", 50), admin, 200);
		mvIn500 = mvId("500"); mvOut200 = mvId("200"); mvIn300 = mvId("300"); mvOut50 = mvId("50");
	}

	@Test @Order(2)
	@SuppressWarnings("unchecked")
	void workspaceAndPermissions() throws Exception {
		call("GET", "/finance/reconciliations/workspace?accountId=BANK1", null, sales, 403);
		call("GET", "/finance/reconciliations/workspace?accountId=CASH1", null, admin, 400);              // เงินสดไม่มี Statement
		call("GET", "/finance/reconciliations/workspace?accountId=NOPE", null, admin, 404);
		Map<String, Object> w = call("GET", "/finance/reconciliations/workspace?accountId=BANK1&date=" + TODAY, null, acc, 200);
		assertEquals(1000.0, ((Number) w.get("clearedBalance")).doubleValue(), 1e-9);                     // ยังไม่กระทบ → ยอดยกมา
		assertEquals(4, ((List<?>) w.get("items")).size());
		assertEquals(0, ((List<?>) call("GET", "/finance/reconciliations/workspace?accountId=BANK1&date=" + TODAY.minusDays(2), null, acc, 200).get("items")).size());   // รายการหลังวัน Statement ไม่แสดง
		call("POST", "/finance/reconciliations", body(1300, mvIn500, mvOut200), sales, 403);
	}

	@Test @Order(3)
	void differenceMustBeZero() throws Exception {
		call("POST", "/finance/reconciliations", body(1301, mvIn500, mvOut200), acc, 409);                // 1000+500−200 = 1300 ไม่ใช่ 1301
		call("POST", "/finance/reconciliations", body(1000), acc, 400);                                   // ไม่เลือกรายการ
		call("POST", "/finance/reconciliations", body(1300, mvIn500, mvIn500), acc, 400);                 // ซ้ำ
		call("POST", "/finance/reconciliations", body(1300, 999999), acc, 400);                           // ไม่ใช่รายการของบัญชีนี้
		Map<String, Object> future = body(1300, mvIn500, mvOut200); future.put("statementDate", TODAY.plusDays(1).toString());
		call("POST", "/finance/reconciliations", future, acc, 400);
		assertEquals(0, jdbc.queryForObject("select count(*)::int from fin_reconciliations", Integer.class));
		assertEquals(0, jdbc.queryForObject("select count(*)::int from fin_movements where cleared", Integer.class));   // ไม่ผ่านต้องไม่เปลี่ยนอะไร
	}

	@Test @Order(4)
	@SuppressWarnings("unchecked")
	void reconcileAndRepeatBlocked() throws Exception {
		Map<String, Object> r = call("POST", "/finance/reconciliations", body(1300, mvIn500, mvOut200), acc, 200);
		rec1 = String.valueOf(r.get("id"));
		assertTrue(rec1.startsWith("BR" + TODAY.getYear()));
		assertEquals(2, jdbc.queryForObject("select count(*)::int from fin_movements where statement_ref = ? and cleared", Integer.class, rec1));
		Map<String, Object> w = call("GET", "/finance/reconciliations/workspace?accountId=BANK1&date=" + TODAY, null, acc, 200);
		assertEquals(1300.0, ((Number) w.get("clearedBalance")).doubleValue(), 1e-9);
		assertEquals(2, ((List<?>) w.get("items")).size());                                               // เหลือ +300 −50
		call("POST", "/finance/reconciliations", body(1300, mvIn500, mvOut200), acc, 409);                // กระทบซ้ำไม่ได้ (ผลต่าง/กระทบแล้ว)
		Map<String, Object> early = body(1550, mvIn300, mvOut50); early.put("statementDate", TODAY.minusDays(1).toString());
		call("POST", "/finance/reconciliations", early, acc, 409);                                        // ก่อนรอบล่าสุด (หรือรายการหลังวัน) ไม่ได้
		assertEquals(1, ((List<?>) call("GET", "/finance/reconciliations?accountId=BANK1", null, acc, 200).get("_list")).size());
	}

	@Test @Order(5)
	void secondRoundAndVoidOnlyLatest() throws Exception {
		Map<String, Object> r = call("POST", "/finance/reconciliations", body(1550, mvIn300, mvOut50), acc, 200);   // 1300+300−50
		rec2 = String.valueOf(r.get("id"));
		call("POST", "/finance/reconciliations/" + rec1 + "/void", Map.of("reason", "ผิดรอบ"), admin, 409);       // ไม่ใช่รอบล่าสุด
		call("POST", "/finance/reconciliations/" + rec2 + "/void", Map.of("reason", "x"), acc, 403);              // เฉพาะ admin
		call("POST", "/finance/reconciliations/" + rec2 + "/void", Map.of("reason", ""), admin, 400);
		call("POST", "/finance/reconciliations/" + rec2 + "/void", Map.of("reason", "คีย์ยอดผิด"), admin, 200);
		assertEquals(2, jdbc.queryForObject("select count(*)::int from fin_movements where not cleared", Integer.class));   // กลับเป็นยังไม่กระทบ
		call("POST", "/finance/reconciliations/" + rec2 + "/void", Map.of("reason", "ซ้ำ"), admin, 409);
		call("POST", "/finance/reconciliations/" + rec1 + "/void", Map.of("reason", "ยกเลิกรอบแรก"), admin, 200);   // ตอนนี้ rec1 เป็นรอบล่าสุดแล้ว
		assertEquals(4, jdbc.queryForObject("select count(*)::int from fin_movements where not cleared", Integer.class));
		call("POST", "/finance/reconciliations", body(1550, mvIn500, mvOut200, mvIn300, mvOut50), acc, 200);      // กระทบใหม่ทั้งหมดในรอบเดียวได้
	}
}
