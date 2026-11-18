package com.backend.erp;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
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
 * ใบสั่งซื้อ "งานบริการ" (เช่น ซ่อมแม่พิมพ์): รายการ itemType=service ไม่ต้องเลือกวัตถุดิบ/ไม่เข้าสต๊อก
 * ตรวจรับงานแล้วตั้งเจ้าหนี้ (ค่าใช้จ่าย) พร้อม VAT และหัก ณ ที่จ่ายตาม PO · ผสมกับวัตถุดิบได้ (เข้าสต๊อกเฉพาะวัตถุดิบ)
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class PurchaseServiceTests {
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
	static String admin, proc;

	@SuppressWarnings("unchecked")
	Map<String, Object> call(String method, String path, Object body, String tok, int expect) throws Exception {
		HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1" + path)).header("Content-Type", "application/json");
		if (tok != null) b.header("Authorization", "Bearer " + tok);
		b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
		HttpResponse<String> res = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
		assertEquals(expect, res.statusCode(), method + " " + path + " -> " + res.body());
		String s = res.body();
		if (s == null || s.isBlank()) return Map.of();
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

	static Map<String, Object> svc(String name, double qty, double price) {
		Map<String, Object> l = new LinkedHashMap<>();
		l.put("itemType", "service"); l.put("name", name); l.put("qty", qty); l.put("unit", "งาน"); l.put("price", price);
		return l;
	}

	static Map<String, Object> mat(String item, double qty, double price) {
		Map<String, Object> l = new LinkedHashMap<>();
		l.put("itemType", "material"); l.put("item", item); l.put("name", "วัตถุดิบ " + item); l.put("qty", qty); l.put("unit", "KG"); l.put("price", price);
		return l;
	}

	static Map<String, Object> po(String id, int wht, List<Map<String, Object>> lines) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", id); m.put("date", "2026-11-18"); m.put("supplier", "SUPS"); m.put("supplierName", "ผู้ขาย SUPS");
		m.put("status", "pending"); m.put("whtRate", wht); m.put("lines", lines);
		return m;
	}

	void approveAndReceive(String id) throws Exception {
		call("PATCH", "/purchaseOrders/" + id, Map.of("status", "approved"), proc, 200);
		call("POST", "/actions/purchase-orders/" + id + "/receive", null, proc, 200);
	}

	double stockOfMat(String id) throws Exception { return ((Number) call("GET", "/materials/" + id, null, admin, 200).get("stock")).doubleValue(); }

	@Test @Order(1)
	void setup() throws Exception {
		String t = (String) call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), t, 200);
		admin = t;
		proc = newUser("proc1", "procurement");
		Map<String, Object> sup = new LinkedHashMap<>();
		sup.put("id", "S-S"); sup.put("code", "SUPS"); sup.put("name", "ผู้ขาย SUPS"); sup.put("category", "อื่น ๆ"); sup.put("credit", 30); sup.put("status", "active");
		call("POST", "/suppliers", sup, admin, 201);
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", "M-S"); m.put("code", "M-S"); m.put("name", "วัตถุดิบ"); m.put("type", "เม็ดพลาสติก"); m.put("unit", "KG");
		m.put("stock", 0); m.put("min", 1); m.put("max", 100); m.put("cost", 0); m.put("active", true);
		call("POST", "/materials", m, admin, 201);
	}

	@Test @Order(2)
	void serviceLineValidation() throws Exception {
		call("POST", "/purchaseOrders", po("PS-X1", 0, List.of(svc("  ", 1, 100))), proc, 400);       // ไม่มีรายละเอียดงาน
		call("POST", "/purchaseOrders", po("PS-X2", 0, List.of(svc("ซ่อมแม่พิมพ์", 0, 100))), proc, 400);  // จำนวน 0
		call("POST", "/purchaseOrders", po("PS-X3", 0, List.of(svc("ซ่อมแม่พิมพ์", 1, 0))), proc, 400);    // ราคา 0
	}

	@Test @Order(3)
	void serviceOnlyPoCreatesPayableWithoutStock() throws Exception {
		Map<String, Object> created = call("POST", "/purchaseOrders", po("PS-1", 3, List.of(svc("บริการซ่อมแม่พิมพ์", 1, 10000))), proc, 201);
		assertEquals(10000.0, ((Number) created.get("subtotal")).doubleValue(), 1e-9);
		assertEquals(700.0, ((Number) created.get("vat")).doubleValue(), 1e-9);
		int mv0 = jdbc.queryForObject("select count(*)::int from erp_records where collection='stockMovements'", Integer.class);
		approveAndReceive("PS-1");
		assertEquals("received", call("GET", "/purchaseOrders/PS-1", null, admin, 200).get("status"));
		assertEquals(mv0, jdbc.queryForObject("select count(*)::int from erp_records where collection='stockMovements'", Integer.class));   // ไม่มีเคลื่อนไหวสต๊อก
		Map<String, Object> exp = call("GET", "/expenses/EXP-PS-1", null, admin, 200);
		assertEquals("ค่าบริการ/จ้างทำของ", exp.get("category"));
		assertEquals(10000.0, ((Number) exp.get("amount")).doubleValue(), 1e-9);
		assertEquals(700.0, ((Number) exp.get("vat")).doubleValue(), 1e-9);
		assertEquals(3, ((Number) exp.get("whtRate")).intValue());
	}

	@Test @Order(4)
	void mixedPoStocksOnlyMaterial() throws Exception {
		call("POST", "/purchaseOrders", po("PS-2", 0, List.of(mat("M-S", 10, 50), svc("ค่าขนส่งวัตถุดิบ", 1, 500))), proc, 201);
		approveAndReceive("PS-2");
		assertEquals(10.0, stockOfMat("M-S"), 1e-9);
		assertEquals("วัตถุดิบ", call("GET", "/expenses/EXP-PS-2", null, admin, 200).get("category"));
		assertEquals(1000.0, ((Number) call("GET", "/expenses/EXP-PS-2", null, admin, 200).get("amount")).doubleValue(), 1e-9);   // 10×50 + 500
	}
}
