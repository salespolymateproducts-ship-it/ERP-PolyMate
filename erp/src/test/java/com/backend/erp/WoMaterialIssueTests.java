package com.backend.erp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.HashMap;
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
 * เบิกวัตถุดิบเพิ่ม / คืนวัตถุดิบ เข้าใบสั่งผลิต: ตัด/คืนสต๊อก + movement, มูลค่ารวมเข้าต้นทุนสินค้าสำเร็จรูปในการบันทึกผลิตครั้งถัดไป,
 * คืนได้ไม่เกินที่เบิกเพิ่ม, ใบที่ปิดแล้วเบิกไม่ได้, สิทธิ์ admin/production เท่านั้น
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class WoMaterialIssueTests {
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
	static String admin, prod, sales;

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

	double num(String coll, String id, String field) throws Exception {
		Object v = call("GET", "/" + coll + "/" + id, null, admin, 200).get(field);
		return v == null ? 0 : ((Number) v).doubleValue();
	}

	static Map<String, Object> issue(String item, double qty, String kind, String reason) {
		Map<String, Object> m = new HashMap<>();
		m.put("item", item); m.put("qty", qty); m.put("kind", kind);
		if (reason != null) m.put("reason", reason);
		return m;
	}

	@Test @Order(1)
	void setup() throws Exception {
		String t = (String) call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), t, 200);
		admin = t;
		prod = newUser("prod1", "production");
		sales = newUser("sale1", "sales");
		Map<String, Object> mat = new LinkedHashMap<>();
		mat.put("id", "R1"); mat.put("code", "R1"); mat.put("name", "เม็ด R1"); mat.put("type", "เม็ดพลาสติก"); mat.put("unit", "KG");
		mat.put("stock", 1000); mat.put("min", 1); mat.put("max", 100000); mat.put("cost", 0); mat.put("active", true);
		call("POST", "/materials", mat, admin, 201);
		jdbc.update("update erp_records set data = jsonb_set(data, '{cost}', '10') where collection='materials' and id='R1'");
		Map<String, Object> fg = new LinkedHashMap<>();
		fg.put("id", "FG-F1"); fg.put("code", "F1"); fg.put("name", "สินค้า F1"); fg.put("unit", "PCS"); fg.put("stock", 0);
		call("POST", "/finished", fg, admin, 201);
		Map<String, Object> line = new LinkedHashMap<>();
		line.put("item", "R1"); line.put("type", "resin"); line.put("qty", 1);
		Map<String, Object> bom = new LinkedHashMap<>();
		bom.put("id", "B1"); bom.put("name", "สูตร B1"); bom.put("productCode", "F1"); bom.put("color", "ดำ");
		bom.put("status", "active"); bom.put("wasteRate", 0); bom.put("lines", List.of(line));
		call("POST", "/boms", bom, prod, 201);
		Map<String, Object> wo = new LinkedHashMap<>();
		wo.put("id", "W1"); wo.put("productCode", "F1"); wo.put("product", "สินค้า F1"); wo.put("quantity", 100);
		wo.put("status", "queued"); wo.put("produced", 0); wo.put("ng", 0); wo.put("bomId", "B1");
		call("POST", "/workOrders", wo, prod, 201);
	}

	@Test @Order(2)
	void validationAndPermissions() throws Exception {
		String p = "/actions/work-orders/W1/material";
		call("POST", p, issue("R1", 5, "ISSUE", "ใช้เพิ่ม"), sales, 403);                 // สิทธิ์
		call("POST", p, issue("R1", 5, "ISSUE", null), prod, 400);                         // ไม่มีเหตุผล
		call("POST", p, issue("R1", 0, "ISSUE", "x"), prod, 400);                          // จำนวน 0
		call("POST", p, issue("R1", 5, "FOO", "x"), prod, 400);                            // ประเภทผิด
		call("POST", p, issue("NOPE", 5, "ISSUE", "x"), prod, 422);                        // ไม่มีวัตถุดิบ
		call("POST", p, issue("R1", 99999, "ISSUE", "x"), prod, 422);                      // สต๊อกไม่พอ
		call("POST", p, issue("R1", 1, "RETURN", "x"), prod, 422);                         // ยังไม่เคยเบิก คืนไม่ได้
		assertEquals(1000, num("materials", "R1", "stock"), 1e-9);
	}

	@Test @Order(3)
	void issueAndReturnAdjustStockAndPendingCost() throws Exception {
		String p = "/actions/work-orders/W1/material";
		call("POST", p, issue("R1", 5, "ISSUE", "ล้างเครื่องเปลี่ยนสี"), prod, 200);
		assertEquals(995, num("materials", "R1", "stock"), 1e-9);
		assertEquals(50, num("workOrders", "W1", "pendingExtraCost"), 1e-9);
		call("POST", p, issue("R1", 6, "RETURN", "x"), prod, 422);                         // คืนเกินที่เบิก
		call("POST", p, issue("R1", 2, "RETURN", "คืนส่วนที่ไม่ได้ใช้"), prod, 200);
		assertEquals(997, num("materials", "R1", "stock"), 1e-9);
		assertEquals(30, num("workOrders", "W1", "pendingExtraCost"), 1e-9);
		int mv = jdbc.queryForObject("select count(*)::int from erp_records where collection='stockMovements' and data->>'ref'='W1'", Integer.class);
		assertEquals(2, mv);
	}

	@Test @Order(4)
	void producePutsExtraCostIntoFinishedGoodsCost() throws Exception {
		// ผลิต 100 ชิ้น (NG 0): ตามสูตร 100 กก. × 10 = 1000 + ส่วนเบิกเพิ่มสุทธิ 3 กก. × 10 = 30 → 1030 ÷ 100 = 10.30
		call("POST", "/actions/work-orders/W1/produce", Map.of("produced", 100, "ng", 0), prod, 200);
		assertEquals(897, num("materials", "R1", "stock"), 1e-9);
		assertEquals(10.3, num("finished", "FG-F1", "cost"), 1e-9);
		assertEquals(1030, num("workOrders", "W1", "materialCost"), 1e-9);
		assertEquals(0, num("workOrders", "W1", "pendingExtraCost"), 1e-9);
	}

	@Test @Order(5)
	void closedWorkOrderRejectsIssue() throws Exception {
		assertTrue(num("workOrders", "W1", "produced") >= 100);
		call("POST", "/actions/work-orders/W1/material", issue("R1", 1, "ISSUE", "ช้าไป"), prod, 409);
		assertEquals(897, num("materials", "R1", "stock"), 1e-9);
	}

	@Test @Order(6)
	void returnAfterCloseRestoresStockAndLowersCost() throws Exception {
		String p = "/actions/work-orders/W1/material";
		call("POST", p, issue("R1", 4, "RETURN", "เกินที่เบิกเพิ่ม"), prod, 422);                 // เบิกเพิ่มสุทธิเหลือ 3 กก.
		call("POST", p, issue("R1", 3, "RETURN", "คืนเม็ดที่เหลือหลังผลิตเสร็จ"), prod, 200);
		assertEquals(900, num("materials", "R1", "stock"), 1e-9);
		// ต้นทุนสินค้า (stock 100 × 10.30 = 1030) − 30 = 1000 → 10.00 ; ต้นทุนใบสั่งผลิต 1030 → 1000
		assertEquals(10.0, num("finished", "FG-F1", "cost"), 1e-9);
		assertEquals(1000, num("workOrders", "W1", "materialCost"), 1e-9);
	}
}
