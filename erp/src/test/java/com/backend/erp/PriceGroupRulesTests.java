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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import tools.jackson.databind.ObjectMapper;

/** กลุ่มราคา: ตรวจข้อมูล, สิทธิ์เขียน, สินค้าซ้ำกลุ่ม, ล็อกรหัสสินค้า, สิทธิ์แก้ราคาในใบเสนอราคา/ใบสั่งขาย */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class PriceGroupRulesTests {
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
	static String admin, proc, sales, acct;

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

	static Map<String, Object> group(String id, List<?> tiers, Object... codeAndPrices) {
		List<Map<String, Object>> items = new java.util.ArrayList<>();
		for (int i = 0; i < codeAndPrices.length; i += 2) items.add(Map.of("code", codeAndPrices[i], "prices", codeAndPrices[i + 1]));
		return new LinkedHashMap<>(Map.of("id", id, "name", "กลุ่ม " + id, "active", true, "tiers", tiers, "items", items));
	}

	static Map<String, Object> doc(String id, Object... lines) {
		return new LinkedHashMap<>(Map.of("id", id, "type", "QT", "status", "draft", "lines", List.of(lines)));
	}

	static Map<String, Object> line(String code, int qty, int pack, double price, String mode) {
		Map<String, Object> l = new LinkedHashMap<>(Map.of("code", code, "qty", qty, "price", price));
		if (pack > 0) l.put("packSize", pack);
		if (mode != null) l.put("priceMode", mode);
		return l;
	}

	@Test @Order(1)
	void setup() throws Exception {
		String t = (String) call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), t, 200);
		admin = t;
		proc = newUser("proc1", "procurement");
		sales = newUser("sale1", "sales");
		acct = newUser("acct1", "accounting");
		for (String c : List.of("A", "B")) call("POST", "/finished", Map.of("id", "FG-" + c, "code", c, "name", c, "stock", 0, "price", 12, "packSize", 20), admin, 201);
		call("POST", "/finished", Map.of("id", "FG-LOOSE", "code", "LOOSE", "name", "x", "stock", 0, "price", 5), admin, 201);
	}

	@Test @Order(2)
	void onlyAdminAndSalesWriteValidGroups() throws Exception {
		Map<String, Object> ok = group("PG1", List.of(5, 10), "A", List.of(10, 8), "B", List.of(11, 9));
		call("POST", "/priceGroups", ok, acct, 403);
		call("POST", "/priceGroups", ok, proc, 403);
		call("POST", "/priceGroups", ok, sales, 201);
		call("POST", "/priceGroups", group("BAD1", List.of(10, 5), "LOOSE", List.of(1, 1)), admin, 400);  // ขั้นไม่เรียง
		call("POST", "/priceGroups", group("BAD2", List.of(5), "LOOSE", List.of(1)), admin, 400);         // ไม่ได้ตั้งจำนวนต่อลัง
		call("POST", "/priceGroups", group("BAD3", List.of(5), "NOPE", List.of(1)), admin, 400);
		call("POST", "/priceGroups", group("BAD4", List.of(5), "A", List.of(-1)), admin, 400);
		call("POST", "/priceGroups", group("BAD5", List.of(5), "A", List.of(1)), admin, 409);             // A อยู่กลุ่มอื่นแล้ว
		call("PATCH", "/finished/FG-A", Map.of("code", "A2"), admin, 409);
		call("DELETE", "/finished/FG-A", null, admin, 409);
	}

	@Test @Order(3)
	void accountingCannotOverrideGroupPrice() throws Exception {
		call("POST", "/docs", doc("Q-BAD", line("A", 200, 20, 1, "auto")), acct, 403);
		call("POST", "/docs", doc("Q-BAD2", line("A", 200, 20, 8, "manual")), acct, 403);
		call("POST", "/docs", doc("Q-BAD3", line("A", 200, 0, 8, "auto")), acct, 403);                   // ตัดข้อมูลลังออก
		call("POST", "/docs", doc("Q-OK", line("A", 100, 20, 8, "auto"), line("B", 100, 20, 9, "auto")), acct, 201); // 10 ลังรวม
		call("POST", "/docs", doc("Q-LOW", line("A", 40, 20, 12, "auto")), acct, 201);                   // ต่ำกว่าขั้นแรก = ราคาปกติ
		call("PATCH", "/docs/Q-OK", Map.of("lines", List.of(line("A", 100, 20, 1, "auto"))), acct, 403);
		call("PUT", "/docs/Q-OK", doc("Q-OK", line("A", 100, 20, 7, "manual")), sales, 200);
		Map<String, Object> keep = doc("Q-OK", line("A", 100, 20, 7, "manual"));
		keep.put("note", "บัญชีแก้หมายเหตุ");
		call("PUT", "/docs/Q-OK", keep, acct, 200);                                                      // ราคาเดิมไม่เปลี่ยน
		Map<String, Object> so = doc("S-1", Map.of("code", "A", "qty", 20, "price", 7, "packSize", 20, "src", Map.of("doc", "Q-OK", "line", 0)));
		so.put("type", "SO");
		call("POST", "/docs", so, acct, 201);                                                            // ราคาตรงเอกสารต้นทาง
		// สั่งน้อยกว่าที่เสนอ → รายการจากใบเสนอราคาที่คิดราคาใหม่ต้องตรงกับขั้นของจำนวนที่สั่งจริง
		Map<String, Object> re = new LinkedHashMap<>(Map.of("code", "A", "qty", 20, "price", 12, "packSize", 20, "priceMode", "auto", "repriced", true, "src", Map.of("doc", "Q-OK", "line", 0)));
		Map<String, Object> so2 = doc("S-2", re);
		so2.put("type", "SO");
		call("POST", "/docs", so2, acct, 201);                                                           // 1 ลัง = ราคาปกติ 12
		Map<String, Object> wrong = new LinkedHashMap<>(re);
		wrong.put("price", 1);
		Map<String, Object> so3 = doc("S-3", wrong);
		so3.put("type", "SO");
		call("POST", "/docs", so3, acct, 403);
		call("POST", "/docs", doc("Q-FAKE",Map.of("code", "A", "qty", 20, "price", 1, "src", Map.of("doc", "Q-OK", "line", 0))), acct, 403);
		call("POST", "/docs", doc("Q-LOOSE", line("LOOSE", 1, 0, 1, null)), acct, 201);                  // สินค้านอกกลุ่มทำงานแบบเดิม
	}
}
