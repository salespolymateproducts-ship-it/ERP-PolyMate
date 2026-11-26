package com.backend.erp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import tools.jackson.databind.ObjectMapper;

/** ทะเบียนสินค้า: สิทธิ์แก้ราคา, จำนวนต่อลัง, ล็อกรหัส/หน่วยของสินค้าที่ถูกใช้แล้ว, กันลบ, ปิดใช้งาน */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ProductMasterRulesTests {
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
	static String admin, proc, prod, sales, acct;

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

	String newUser(String username, String role) throws Exception {
		Map<String, Object> u = call("POST", "/users", Map.of("username", username, "fullName", username, "role", role), admin, 201);
		String t = (String) call("POST", "/auth/login", Map.of("username", username, "password", u.get("temporaryPassword")), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", u.get("temporaryPassword"), "newPassword", "Test-Pass-" + username), t, 200);
		return t;
	}

	static Map<String, Object> fg(String code, double stock) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", "FG-" + code); m.put("code", code); m.put("name", "สินค้า " + code); m.put("jobType", "own");
		m.put("unit", "ใบ"); m.put("stock", stock); m.put("cost", 1); m.put("price", 10);
		return m;
	}

	static Map<String, Object> with(Map<String, Object> m, String k, Object v) {
		Map<String, Object> c = new LinkedHashMap<>(m);
		c.put(k, v);
		return c;
	}

	@Test @Order(1)
	void setup() throws Exception {
		String t = (String) call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), t, 200);
		admin = t;
		proc = newUser("proc1", "procurement");
		prod = newUser("prod1", "production");
		sales = newUser("sale1", "sales");
		acct = newUser("acct1", "accounting");
		call("POST", "/finished", fg("FREE", 0), admin, 201);
		call("POST", "/finished", fg("STOCKED", 5), admin, 201);
		call("POST", "/finished", fg("INDOC", 0), admin, 201);
		call("POST", "/finished", fg("INPO", 0), proc, 201); // สร้างสินค้าใหม่พร้อมราคาตั้งต้นได้ตามเดิม
		call("POST", "/docs", Map.of("id", "QT-1", "type", "QT", "lines", List.of(Map.of("code", "INDOC", "qty", 1, "price", 10))), sales, 201);
		call("POST", "/purchaseOrders", Map.of("id", "PO-1", "status", "draft", "supplier", "S", "lines",
			List.of(Map.of("itemType", "product", "item", "FG-INPO", "name", "x", "qty", 1, "price", 1))), admin, 400); // ไม่ได้ตั้งเป็นสินค้าที่ซื้อได้
		call("PATCH", "/finished/FG-INPO", Map.of("buyable", true), proc, 200);
	}

	@Test @Order(2)
	void priceChangeOnlyAdminAndSales() throws Exception {
		for (String t : List.of(proc, prod, acct)) {
			call("PATCH", "/finished/FG-FREE", Map.of("price", 11), t, 403);
			call("PUT", "/finished/FG-FREE", with(fg("FREE", 0), "price", 11), t, 403);
		}
		call("PATCH", "/finished/FG-FREE", Map.of("price", 11), sales, 200);
		call("PATCH", "/finished/FG-FREE", Map.of("price", 12), admin, 200);
		call("PATCH", "/finished/FG-FREE", Map.of("price", -1), admin, 400);
		call("PATCH", "/finished/FG-FREE", Map.of("price", "abc"), admin, 400);
		// ราคาไม่เปลี่ยน → role อื่นยังอัปเดตสต๊อกได้ตามเดิม
		call("PUT", "/finished/FG-STOCKED", fg("STOCKED", 6), prod, 200);
	}

	@Test @Order(3)
	void packSizeMustBeWholeNumberFromTwo() throws Exception {
		for (Object bad : List.of(1, 0, -20, 2.5, "20")) call("PATCH", "/finished/FG-FREE", Map.of("packSize", bad), admin, 400);
		assertEquals(20, call("PATCH", "/finished/FG-FREE", Map.of("packSize", 20), admin, 200).get("packSize"));
		assertNull(call("PATCH", "/finished/FG-FREE", Map.of("packSize", ""), admin, 200).get("packSize"));
	}

	@Test @Order(4)
	void codeAndUnitLockedWhenUsed() throws Exception {
		call("PATCH", "/finished/FG-STOCKED", Map.of("code", "NEW-S"), admin, 409);
		call("PATCH", "/finished/FG-STOCKED", Map.of("unit", "ลัง"), admin, 409);
		call("PATCH", "/finished/FG-INDOC", Map.of("code", "NEW-D"), admin, 409);
		call("PATCH", "/finished/FG-INDOC", Map.of("unit", "ลัง"), admin, 409);
		call("PATCH", "/finished/FG-INDOC", Map.of("name", "เปลี่ยนชื่อได้"), admin, 200);
		call("PATCH", "/finished/FG-FREE", Map.of("code", "FREE-2", "unit", "ลัง"), admin, 200);
		call("PATCH", "/finished/FG-FREE", Map.of("code", "FREE", "unit", "ใบ"), admin, 200);
	}

	@Test @Order(5)
	void usedProductCannotBeDeletedButCanBeDeactivated() throws Exception {
		call("DELETE", "/finished/FG-STOCKED", null, admin, 409);
		call("DELETE", "/finished/FG-INDOC", null, admin, 409);
		assertEquals(false, call("PATCH", "/finished/FG-INDOC", Map.of("active", false), admin, 200).get("active"));
		call("DELETE", "/finished/FG-FREE", null, admin, 200);
	}
}
