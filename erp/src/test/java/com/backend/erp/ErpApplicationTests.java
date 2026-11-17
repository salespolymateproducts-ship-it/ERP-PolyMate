package com.backend.erp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import tools.jackson.databind.ObjectMapper;

/** ทดสอบ API ทั้งชุดกับ PostgreSQL จริง (embedded) — ไม่ต้องใช้ Docker */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ErpApplicationTests {
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
	final HttpClient http = HttpClient.newHttpClient();
	static String token;
	static String adminToken;

	@SuppressWarnings("unchecked")
	Map<String, Object> call(String method, String path, Object body, String tok, int expect) throws Exception {
		HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1" + path))
			.header("Content-Type", "application/json");
		if (tok != null) b.header("Authorization", "Bearer " + tok);
		b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
		HttpResponse<String> res = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
		assertEquals(expect, res.statusCode(), method + " " + path + " -> " + res.body());
		String s = res.body();
		if (s == null || s.isBlank()) return Map.of();
		if (s.startsWith("[")) return Map.of("_list", mapper.readValue(s, List.class));
		return mapper.readValue(s, Map.class);
	}

	@Test @Order(1)
	void healthAndAuth() throws Exception {
		call("GET", "/healthz", null, null, 200);
		call("GET", "/customers", null, null, 401);
		call("POST", "/auth/login", Map.of("username", "admin", "password", "wrong-pass"), null, 401);
		Map<String, Object> r = call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200);
		assertEquals(true, r.get("mustChange"));
		token = (String) r.get("token");
		call("GET", "/customers", null, token, 401); // PASSWORD_CHANGE_REQUIRED
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "short"), token, 400);
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), token, 200);
		r = call("POST", "/auth/login", Map.of("username", "admin", "password", "New-Pass-456"), null, 200);
		assertEquals(false, r.get("mustChange"));
		adminToken = (String) r.get("token");
		call("GET", "/auth/me", null, adminToken, 200);
	}

	@Test @Order(2)
	void crudAndVersioning() throws Exception {
		Map<String, Object> c = call("POST", "/customers", Map.of("id", "CUS-T1", "name", "ลูกค้าทดสอบ", "credit", 30), adminToken, 201);
		assertEquals(1, ((Number) c.get("_version")).intValue());
		call("POST", "/customers", Map.of("id", "CUS-T1", "name", "dup"), adminToken, 409);
		Map<String, Object> p = call("PATCH", "/customers/CUS-T1", Map.of("name", "แก้ชื่อ", "_version", 1), adminToken, 200);
		assertEquals("แก้ชื่อ", p.get("name"));
		call("PATCH", "/customers/CUS-T1", Map.of("name", "stale", "_version", 1), adminToken, 409);
		call("PUT", "/customers/CUS-T1", Map.of("name", "put", "_version", 1), adminToken, 409);
		assertEquals("put", call("PUT", "/customers/CUS-T1", Map.of("name", "put", "_version", 2), adminToken, 200).get("name"));
		call("GET", "/customers/NOPE", null, adminToken, 404);
		call("GET", "/nonexistent", null, adminToken, 404);
		assertTrue(((List<?>) call("GET", "/customers?q=put", null, adminToken, 200).get("_list")).size() == 1);
		call("DELETE", "/customers/CUS-T1", null, adminToken, 200);
		call("GET", "/customers/CUS-T1", null, adminToken, 404);
	}

	@Test @Order(3)
	void rolesAndUsers() throws Exception {
		Map<String, Object> u = call("POST", "/users", Map.of("username", "sale1", "fullName", "Sale One", "role", "sales"), adminToken, 201);
		String temp = (String) u.get("temporaryPassword");
		assertNotNull(temp);
		call("POST", "/users", Map.of("username", "SALE1", "role", "sales"), adminToken, 409);
		Map<String, Object> l = call("POST", "/auth/login", Map.of("username", "sale1", "password", temp), null, 200);
		String st = (String) l.get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", temp, "newPassword", "Sale-Pass-789"), st, 200);
		call("GET", "/users", null, st, 403);
		call("POST", "/suppliers", Map.of("id", "SUP-X", "name", "x"), st, 403); // sales เขียน suppliers ไม่ได้
		call("POST", "/customers", Map.of("id", "CUS-S", "name", "ok"), st, 201);
		call("POST", "/users/" + ((Map<?, ?>) u.get("user")).get("id") + "/suspend", null, adminToken, 200);
		call("GET", "/customers", null, st, 401); // session ถูกเพิกถอน
	}

	@Test @Order(4)
	void countersAndAudit() throws Exception {
		Map<String, Object> a = call("POST", "/counters/IV/next?date=2026-11-05", null, adminToken, 200);
		assertEquals("IV2026110001", a.get("docNo"));
		assertEquals("IV2026110002", call("POST", "/counters/IV/next?date=2026-11-20", null, adminToken, 200).get("docNo"));
		assertEquals("IV2026110003", call("GET", "/counters/IV/peek?date=2026-11-20", null, adminToken, 200).get("docNo"));
		call("POST", "/counters/IV1x/next", null, adminToken, 400);
		List<?> logs = (List<?>) call("GET", "/audit-logs?limit=50", null, adminToken, 200).get("_list");
		assertTrue(logs.size() > 3);
	}

	@Test @Order(5)
	void workflowReceiveAndProduce() throws Exception {
		call("POST", "/materials", Map.of("id", "MAT-1", "code", "PP-H350", "name", "PP H350", "unit", "KG", "stock", 0), adminToken, 201);
		call("POST", "/finished", Map.of("id", "FG-1", "code", "FAN-16", "name", "Fan", "stock", 0), adminToken, 201);
		call("POST", "/molds", Map.of("id", "MOLD-1", "cavities", 2, "shots", 0), adminToken, 201);
		call("POST", "/machines", Map.of("id", "INJ-01", "name", "เครื่อง 1", "tonnage", 180), adminToken, 201);
		call("POST", "/boms", Map.of("id", "BOM-1", "name", "สูตร 1", "productCode", "FAN-16", "status", "active", "wasteRate", 0,
			"lines", List.of(Map.of("item", "MAT-1", "type", "resin", "qty", 0.5))), adminToken, 201);
		call("POST", "/suppliers", Map.of("id", "SUP-1", "code", "SUP-1", "name", "S", "status", "active"), adminToken, 201);
		call("POST", "/purchaseOrders", Map.of("id", "PO-1", "status", "draft", "supplier", "SUP-1", "supplierName", "S",
			"lines", List.of(Map.of("item", "MAT-1", "name", "PP", "qty", 500, "price", 2))), adminToken, 201);
		call("POST", "/actions/purchase-orders/PO-1/receive", null, adminToken, 422); // ยังไม่อนุมัติ
		call("PATCH", "/purchaseOrders/PO-1", Map.of("status", "approved"), adminToken, 200);
		call("POST", "/actions/purchase-orders/PO-1/receive", null, adminToken, 200);
		call("POST", "/actions/purchase-orders/PO-1/receive", null, adminToken, 409); // รับซ้ำไม่ได้
		assertEquals(500.0, ((Number) call("GET", "/materials/MAT-1", null, adminToken, 200).get("stock")).doubleValue());
		call("GET", "/expenses/EXP-PO-1", null, adminToken, 200);

		call("POST", "/workOrders", Map.of("id", "WO-1", "productCode", "FAN-16", "product", "Fan", "quantity", 100, "status", "queued",
			"mold", "MOLD-1", "machine", "INJ-01", "produced", 0, "ng", 0), adminToken, 201);
		call("POST", "/actions/work-orders/WO-1/produce", Map.of("produced", 0, "ng", 0), adminToken, 400);
		call("POST", "/actions/work-orders/WO-1/produce", Map.of("produced", 100, "ng", 5), adminToken, 200);
		assertEquals(450.0, ((Number) call("GET", "/materials/MAT-1", null, adminToken, 200).get("stock")).doubleValue()); // 100*0.5 = 50
		assertEquals(95.0, ((Number) call("GET", "/finished/FG-1", null, adminToken, 200).get("stock")).doubleValue());
		assertEquals(50, ((Number) call("GET", "/molds/MOLD-1", null, adminToken, 200).get("shots")).intValue());
		call("POST", "/actions/stock/adjust", Map.of("code", "FAN-16", "delta", -1000, "note", "x"), adminToken, 422); // สต๊อกไม่พอ -> rollback
		assertEquals(95.0, ((Number) call("GET", "/finished/FG-1", null, adminToken, 200).get("stock")).doubleValue());
		call("POST", "/actions/stock/adjust", Map.of("code", "FAN-16", "delta", 5, "note", "ปรับ"), adminToken, 200);
		assertTrue(((List<?>) call("GET", "/stockMovements", null, adminToken, 200).get("_list")).size() >= 4);
	}

	@Test @Order(6)
	void bootstrapExportImport() throws Exception {
		Map<String, Object> b = call("GET", "/bootstrap", null, adminToken, 200);
		assertNotNull(b.get("docs"));
		assertNotNull(b.get("counters"));
		call("PUT", "/settings/company", Map.of("nameTh", "บริษัท ทดสอบ", "taxId", "123"), adminToken, 400);
		call("PUT", "/settings/company", Map.of("nameTh", "บริษัท ทดสอบ", "taxId", "0123456789012"), adminToken, 200);
		Map<String, Object> exp = call("GET", "/admin/export", null, adminToken, 200);
		assertTrue(exp.containsKey("users"));
		Map<String, Object> legacy = Map.of("docs", List.of(Map.of("id", "IV2026110001", "status", "approved")),
			"customers", List.of(Map.of("id", "C-9", "name", "legacy")), "counters", Map.of("IV202611", 1),
			"users", List.of(Map.of("id", "USR-old", "username", "olduser", "fullName", "Old", "role", "sales",
				"salt", "abcd1234", "hash", "1111", "mustChange", false)));
		Map<String, Object> rep = call("POST", "/admin/import", legacy, adminToken, 200);
		assertEquals(1, ((Number) rep.get("docs")).intValue());
		call("GET", "/docs/IV2026110001", null, adminToken, 200);
		call("POST", "/auth/login", Map.of("username", "olduser", "password", "x"), null, 401);
	}
}
