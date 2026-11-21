package com.backend.erp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
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

/** ลายเซ็นอิเล็กทรอนิกส์ ระดับ 1–2: เวลาอนุมัติ/จ่ายใน PV · ภาพลายเซ็น (ตรวจไฟล์, เจ้าของเท่านั้น) · ส่งภาพเฉพาะเอกสารที่อนุมัติแล้ว + สิทธิ์ + Audit Log */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class SignatureTests {
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
	static String admin, acc, sales, prod, pv1;
	static final LocalDate TODAY = LocalDate.now(ZoneId.of("Asia/Bangkok"));
	// PNG 1x1 ที่ถูกต้อง
	static final String PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

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
	Map<String, Object> signer(Map<String, Object> r, String role) {
		return ((List<Map<String, Object>>) r.get("signers")).stream().filter(s -> role.equals(s.get("role"))).findFirst().orElse(null);
	}

	@Test @Order(1)
	void setupAndValidation() throws Exception {
		String t = (String) call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), t, 200);
		admin = t;
		acc = newUser("acc1", "accounting");
		sales = newUser("sale1", "sales");
		prod = newUser("prod1", "production");
		call("GET", "/signatures/me", null, null, 401);                                                    // ต้องล็อกอิน
		assertEquals(Boolean.FALSE, call("GET", "/signatures/me", null, admin, 200).get("has"));
		call("PUT", "/signatures/me", Map.of("image", "hello"), admin, 400);                              // ไม่ใช่ data URL
		call("PUT", "/signatures/me", Map.of("image", "data:image/gif;base64,R0lGODlhAQABAAAAACw="), admin, 400);   // ชนิดไม่รองรับ
		call("PUT", "/signatures/me", Map.of("image", "data:image/png;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), admin, 400);   // ไม่ใช่ PNG จริง
		call("PUT", "/signatures/me", Map.of("image", "data:image/png;base64," + "A".repeat(500_000)), admin, 400);               // ใหญ่เกิน
		call("PUT", "/signatures/me", Map.of(), admin, 400);
		Map<String, Object> ok = call("PUT", "/signatures/me", Map.of("image", PNG), admin, 200);
		assertEquals(Boolean.TRUE, ok.get("has"));
		assertTrue(String.valueOf(ok.get("image")).startsWith("data:image/png;base64,"));
		assertEquals(Boolean.FALSE, call("GET", "/signatures/me", null, acc, 200).get("has"));            // ของใครของมัน
	}

	@Test @Order(2)
	void pvShowsTimesAndSignaturesOnlyWhenApproved() throws Exception {
		call("POST", "/finance/accounts", Map.of("code", "BANK1", "name", "ธนาคาร", "type", "bank", "openingBalance", 50000, "openingDate", TODAY.toString()), admin, 200);
		jdbc.update("insert into erp_records(collection,id,data) values ('expenses','EXP-S1',?::jsonb)",
			"{\"id\":\"EXP-S1\",\"vendor\":\"ผู้ขาย\",\"amount\":1000,\"vat\":0,\"whtRate\":0,\"status\":\"approved\",\"date\":\"" + TODAY + "\",\"category\":\"ทดสอบ\"}");
		Map<String, Object> v = call("POST", "/finance/payments", Map.of("date", TODAY.toString(), "expenseIds", List.of("EXP-S1")), admin, 200);
		pv1 = String.valueOf(v.get("id"));
		assertEquals("approved", v.get("status"));
		assertNotNull(v.get("approvedAt"));                                                                 // L1: เวลาอนุมัติ
		assertNull(v.get("paidAt"));
		call("GET", "/signatures/for/pv/" + pv1, null, sales, 403);                                         // ไม่มีสิทธิ์การเงิน
		Map<String, Object> r = call("GET", "/signatures/for/pv/" + pv1, null, acc, 200);
		assertNotNull(signer(r, "creator").get("image"));                                                   // admin ตั้งลายเซ็นไว้ ใบอนุมัติแล้ว → เห็นภาพ
		assertNotNull(signer(r, "approver").get("image"));
		assertNull(signer(r, "payer"));                                                                     // ยังไม่จ่าย
		Map<String, Object> paid = call("POST", "/finance/payments/" + pv1 + "/pay", Map.of("accountId", "BANK1", "payDate", TODAY.toString(), "refNo", "S1"), admin, 200);
		assertNotNull(paid.get("paidAt"));
		assertEquals(1, jdbc.queryForObject("select count(*)::int from fin_pay_vouchers where id=? and paid_by_id is not null", Integer.class, pv1));
		assertNotNull(signer(call("GET", "/signatures/for/pv/" + pv1, null, acc, 200), "payer").get("image"));
		assertTrue(jdbc.queryForObject("select count(*)::int from erp_audit_logs where action='SIGNATURE_USE' and entity_id=?", Integer.class, pv1) >= 2);   // บันทึกว่าใครเปิดพร้อมลายเซ็น
		call("POST", "/finance/payments/" + pv1 + "/void", Map.of("reason", "ทดสอบ"), admin, 200);
		Map<String, Object> after = call("GET", "/signatures/for/pv/" + pv1, null, acc, 200);
		assertNull(signer(after, "creator").get("image"));                                                  // กลับรายการแล้ว → ไม่ส่งภาพ (ส่งชื่อ/เวลา)
		assertNull(signer(after, "approver").get("image"));
		call("GET", "/signatures/for/pv/NOPE", null, acc, 404);
	}

	@Test @Order(3)
	void salesDocSignature() throws Exception {
		jdbc.update("insert into erp_records(collection,id,data) values ('docs','QT-S1',?::jsonb)", "{\"id\":\"QT-S1\",\"type\":\"QT\",\"status\":\"approved\",\"approvedBy\":\"ผู้ดูแลระบบ\",\"approvedAt\":\"2026-11-21 10:00\"}");
		jdbc.update("insert into erp_records(collection,id,data) values ('docs','QT-S2',?::jsonb)", "{\"id\":\"QT-S2\",\"type\":\"QT\",\"status\":\"cancelled\",\"approvedBy\":\"ผู้ดูแลระบบ\",\"approvedAt\":\"2026-11-21 10:00\"}");
		jdbc.update("insert into erp_records(collection,id,data) values ('docs','QT-S3',?::jsonb)", "{\"id\":\"QT-S3\",\"type\":\"QT\",\"status\":\"draft\"}");
		call("GET", "/signatures/for/doc/QT-S1", null, prod, 403);                                          // ฝ่ายผลิตไม่มีสิทธิ์ดูเอกสารขาย
		assertNotNull(signer(call("GET", "/signatures/for/doc/QT-S1", null, sales, 200), "approver").get("image"));
		assertNull(signer(call("GET", "/signatures/for/doc/QT-S2", null, sales, 200), "approver").get("image"));    // ยกเลิกแล้ว
		assertTrue(((List<?>) call("GET", "/signatures/for/doc/QT-S3", null, sales, 200).get("signers")).isEmpty());   // ยังไม่อนุมัติ
		call("GET", "/signatures/for/doc/NOPE", null, sales, 404);
	}

	@Test @Order(4)
	void ownerCanDelete() throws Exception {
		call("DELETE", "/signatures/me", null, admin, 200);
		assertEquals(Boolean.FALSE, call("GET", "/signatures/me", null, admin, 200).get("has"));
		assertNull(signer(call("GET", "/signatures/for/doc/QT-S1", null, sales, 200), "approver").get("image"));
		Map<String, Object> m = new LinkedHashMap<>(call("GET", "/signatures/me", null, acc, 200));
		assertEquals(Boolean.FALSE, m.get("has"));
	}
}
