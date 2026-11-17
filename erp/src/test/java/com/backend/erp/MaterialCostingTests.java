package com.backend.erp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

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
 * Material Costing: ต้นทุนถัวเฉลี่ยเคลื่อนที่ (Moving Average) เมื่อรับของตาม PO — คำนวณใน transaction เดียวกับการเพิ่มสต๊อก
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class MaterialCostingTests {
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
	static String admin, proc, prod;

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

	static Map<String, Object> sup(String id, String code) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", id); m.put("code", code); m.put("name", "ผู้ขาย " + code); m.put("category", "เม็ดพลาสติก"); m.put("credit", 30); m.put("status", "active");
		return m;
	}

	static Map<String, Object> mat(String id, String code, double stock, double cost) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", id); m.put("code", code); m.put("name", "วัตถุดิบ " + code); m.put("type", "เม็ดพลาสติก"); m.put("unit", "KG");
		m.put("stock", stock); m.put("min", 10); m.put("max", 1000); m.put("cost", cost); m.put("active", true);
		return m;
	}

	static Map<String, Object> line(String item, double qty, double price) {
		Map<String, Object> l = new LinkedHashMap<>();
		l.put("item", item); l.put("name", "รายการ " + item); l.put("qty", qty); l.put("unit", "KG"); l.put("price", price);
		return l;
	}

	static Map<String, Object> po(String id, List<Map<String, Object>> lines) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", id); m.put("date", "2026-11-17"); m.put("supplier", "SUPOK"); m.put("supplierName", "ผู้ขาย SUPOK");
		m.put("status", "pending"); m.put("whtRate", 0); m.put("lines", lines);
		return m;
	}

	static Map<String, Object> with(Map<String, Object> m, String k, Object v) {
		Map<String, Object> c = new HashMap<>(m);
		c.put(k, v);
		return c;
	}

	double stockOf(String id) throws Exception { return ((Number) call("GET", "/materials/" + id, null, admin, 200).get("stock")).doubleValue(); }

	double costOf(String id) throws Exception { return ((Number) call("GET", "/materials/" + id, null, admin, 200).get("cost")).doubleValue(); }

	int movementsOf(String ref) {
		Integer n = jdbc.queryForObject("select count(*)::int from erp_records where collection = 'stockMovements' and data->>'ref' = ?", Integer.class, ref);
		return n == null ? 0 : n;
	}

	void receive(String poId, String matId, double qty, double price) throws Exception {
		call("POST", "/purchaseOrders", po(poId, List.of(line(matId, qty, price))), proc, 201);
		call("PATCH", "/purchaseOrders/" + poId, Map.of("status", "approved"), proc, 200);
		call("POST", "/actions/purchase-orders/" + poId + "/receive", null, proc, 200);
	}

	@SuppressWarnings("unchecked")
	Map<String, Object> movement(String ref) throws Exception {
		String json = jdbc.queryForObject("select data::text from erp_records where collection='stockMovements' and data->>'ref' = ? limit 1", String.class, ref);
		return mapper.readValue(json, Map.class);
	}

	@Test @Order(1)
	void setup() throws Exception {
		String t = (String) call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), t, 200);
		admin = t;
		proc = newUser("proc1", "procurement");
		prod = newUser("prod1", "production");
		call("POST", "/suppliers", sup("S-OK", "SUPOK"), admin, 201);
		call("POST", "/materials", mat("M-C1", "MATC1", 100, 50), admin, 201);
		call("POST", "/materials", mat("M-C2", "MATC2", 0, 10), admin, 201);
		call("POST", "/materials", mat("M-C3", "MATC3", 40, 5.5), admin, 201);
	}

	@Test @Order(2)
	void movingAverageOnReceive() throws Exception {
		// stock 100 @ 50, รับ 100 @ 56 → 53.00
		receive("PO-C1", "M-C1", 100, 56);
		assertEquals(53.0, costOf("M-C1"), 0.00001);
		assertEquals(200.0, stockOf("M-C1"), 0.0001);
		Map<String, Object> mv = movement("PO-C1");
		assertEquals(56.0, ((Number) mv.get("unitCost")).doubleValue(), 0.00001);
		assertEquals(5600.0, ((Number) mv.get("value")).doubleValue(), 0.001);
		assertEquals(50.0, ((Number) mv.get("costBefore")).doubleValue(), 0.00001);
		assertEquals(53.0, ((Number) mv.get("costAfter")).doubleValue(), 0.00001);
		// ราคาลง: stock 200 @ 53, รับ 100 @ 41 → (10600 + 4100) / 300 = 49.0
		receive("PO-C2", "M-C1", 100, 41);
		assertEquals(49.0, costOf("M-C1"), 0.00001);
		// stock 300 @ 49, รับ 50 @ 60.5 → (14700 + 3025) / 350 = 50.642857 → 50.6429
		receive("PO-C3", "M-C1", 50, 60.5);
		assertEquals(50.6429, costOf("M-C1"), 0.00001);
	}

	@Test @Order(3)
	@SuppressWarnings("unchecked")
	void costHistoryRecordsEachReceive() throws Exception {
		List<Map<String, Object>> h = (List<Map<String, Object>>) call("GET", "/materials/M-C1", null, admin, 200).get("costHistory");
		assertNotNull(h);
		assertEquals(4, h.size()); // ต้นทุนยกมา + รับ PO 3 ครั้ง
		assertEquals("ต้นทุนยกมา", h.get(0).get("note"));
		assertEquals("PO-C1", h.get(1).get("ref"));
		assertEquals(50.0, ((Number) h.get(1).get("prev")).doubleValue(), 0.00001);
		assertEquals("PO-C3", h.get(3).get("ref"));
	}

	@Test @Order(4)
	void zeroOrNegativeStockUsesPoPrice() throws Exception {
		receive("PO-Z1", "M-C2", 30, 12.3456);
		assertEquals(12.3456, costOf("M-C2"), 0.00001);
		assertEquals(30.0, stockOf("M-C2"), 0.0001);
		jdbc.update("update erp_records set data = jsonb_set(data, '{stock}', '-20') where collection='materials' and id='M-C2'");
		receive("PO-Z2", "M-C2", 50, 20);
		assertEquals(20.0, costOf("M-C2"), 0.00001);
		assertEquals(30.0, stockOf("M-C2"), 0.0001);
	}

	@Test @Order(5)
	void duplicateReceiveDoesNotRecalculate() throws Exception {
		double c = costOf("M-C1"), s = stockOf("M-C1");
		call("POST", "/actions/purchase-orders/PO-C3/receive", null, proc, 409);
		assertEquals(c, costOf("M-C1"), 0.00001);
		assertEquals(s, stockOf("M-C1"), 0.0001);
		assertEquals(4, ((List<?>) call("GET", "/materials/M-C1", null, admin, 200).get("costHistory")).size());
	}

	@Test @Order(6)
	void rejectedReceiveLeavesCostUnchanged() throws Exception {
		double c = costOf("M-C1");
		jdbc.update("insert into erp_records(collection,id,data) values ('purchaseOrders','PO-BAD', ?::jsonb)",
			"{\"id\":\"PO-BAD\",\"supplier\":\"SUPOK\",\"status\":\"approved\",\"lines\":[{\"item\":\"M-C1\",\"qty\":10,\"price\":999},{\"name\":\"ไม่มีในทะเบียนเลย\",\"qty\":1,\"price\":1}]}");
		call("POST", "/actions/purchase-orders/PO-BAD/receive", null, proc, 422);
		assertEquals(c, costOf("M-C1"), 0.00001);
		assertEquals(0, movementsOf("PO-BAD"));
	}

	@Test @Order(7)
	void lineWithoutPriceKeepsCost() throws Exception {
		jdbc.update("insert into erp_records(collection,id,data) values ('purchaseOrders','PO-NP', ?::jsonb)",
			"{\"id\":\"PO-NP\",\"supplier\":\"SUPOK\",\"status\":\"approved\",\"lines\":[{\"item\":\"M-C3\",\"qty\":10}]}");
		double c = costOf("M-C3");
		call("POST", "/actions/purchase-orders/PO-NP/receive", null, proc, 200);
		assertEquals(c, costOf("M-C3"), 0.00001);
		assertEquals(50.0, stockOf("M-C3"), 0.0001);
		assertTrue(!movement("PO-NP").containsKey("unitCost"));
	}

	@Test @Order(8)
	void manualStockAdjustDoesNotChangeCost() throws Exception {
		double c = costOf("M-C1");
		call("POST", "/actions/stock/adjust", Map.of("code", "MATC1", "delta", 10, "note", "ปรับ"), admin, 200);
		call("POST", "/actions/stock/adjust", Map.of("code", "MATC1", "delta", -5, "note", "ปรับ"), admin, 200);
		assertEquals(c, costOf("M-C1"), 0.00001);
	}

	@Test @Order(9)
	void concurrentReceivesOnSameMaterialMatchSequentialResult() throws Exception {
		// stock 100 @ 10 แล้วรับ 10 PO พร้อมกัน PO ละ 10 @ 20 → ต้นทุนสุดท้ายเท่ากับรับต่อเนื่อง (100*10 + 100*20) / 200 = 15
		call("POST", "/materials", mat("M-C4", "MATC4", 100, 10), admin, 201);
		for (int i = 0; i < 10; i++) {
			call("POST", "/purchaseOrders", po("PO-P" + i, List.of(line("M-C4", 10, 20))), proc, 201);
			call("PATCH", "/purchaseOrders/PO-P" + i, Map.of("status", "approved"), proc, 200);
		}
		List<CompletableFuture<Integer>> fs = new ArrayList<>();
		for (int i = 0; i < 10; i++) {
			HttpRequest rq = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/actions/purchase-orders/PO-P" + i + "/receive"))
				.header("Content-Type", "application/json").header("Authorization", "Bearer " + proc)
				.POST(HttpRequest.BodyPublishers.noBody()).build();
			fs.add(http.sendAsync(rq, HttpResponse.BodyHandlers.ofString()).thenApply(HttpResponse::statusCode));
		}
		for (CompletableFuture<Integer> f : fs) assertEquals(200, f.get());
		assertEquals(200.0, stockOf("M-C4"), 0.0001);
		assertEquals(15.0, costOf("M-C4"), 0.0001);
	}

	@Test @Order(10)
	void costCannotBeEditedDirectlyByAnyRole() throws Exception {
		double c = costOf("M-C3");
		Map<String, Object> cur = call("GET", "/materials/M-C3", null, admin, 200);
		call("PUT", "/materials/M-C3", with(cur, "cost", 7.25), proc, 409);
		call("PUT", "/materials/M-C3", with(cur, "cost", 7.25), admin, 409);
		call("PUT", "/materials/M-C3", with(cur, "cost", 1), prod, 409);
		call("PATCH", "/materials/M-C3", Map.of("cost", 7.25), admin, 409);
		call("PATCH", "/materials/M-C3", Map.of("costHistory", List.of()), admin, 409);
		assertEquals(c, costOf("M-C3"), 0.00001);
		// ส่งค่าเดิมซ้ำ (sync ปกติของหน้าจอ) ต้องไม่ถูกขวาง
		call("PUT", "/materials/M-C3", with(cur, "name", "เปลี่ยนชื่อได้"), proc, 200);
		call("PATCH", "/materials/M-C3", Map.of("cost", c), proc, 200);
	}

	@Test @Order(11)
	void adminCanAdjustCostWithReasonOnly() throws Exception {
		call("POST", "/actions/materials/M-C3/adjust-cost", Map.of("cost", 9.5, "reason", "แก้ข้อมูลผิด"), proc, 403);
		call("POST", "/actions/materials/M-C3/adjust-cost", Map.of("cost", 9.5, "reason", "แก้ข้อมูลผิด"), prod, 403);
		call("POST", "/actions/materials/M-C3/adjust-cost", Map.of("cost", 9.5, "reason", "  "), admin, 400);
		call("POST", "/actions/materials/M-C3/adjust-cost", Map.of("cost", 9.5), admin, 400);
		call("POST", "/actions/materials/M-C3/adjust-cost", Map.of("cost", -1, "reason", "x"), admin, 400);
		call("POST", "/actions/materials/NOPE/adjust-cost", Map.of("cost", 1, "reason", "x"), admin, 422);
		double before = costOf("M-C3");
		assertEquals(before, costOf("M-C3"), 0.00001);
		call("POST", "/actions/materials/M-C3/adjust-cost", Map.of("cost", 9.5, "reason", "แก้ข้อมูลผิด"), admin, 200);
		assertEquals(9.5, costOf("M-C3"), 0.00001);
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> h = (List<Map<String, Object>>) call("GET", "/materials/M-C3", null, admin, 200).get("costHistory");
		Map<String, Object> last = h.get(h.size() - 1);
		assertEquals("MANUAL", last.get("ref"));
		assertEquals(before, ((Number) last.get("prev")).doubleValue(), 0.00001);
		assertTrue(String.valueOf(last.get("note")).contains("แก้ข้อมูลผิด"));
		Integer n = jdbc.queryForObject("select count(*)::int from erp_audit_logs where action = 'ADJUST_COST' and entity_id = 'M-C3'", Integer.class);
		assertTrue(n != null && n >= 1);
	}

	@Test @Order(12)
	void newMaterialStartsWithoutCostUnlessOpeningCost() throws Exception {
		// ไม่มีต้นทุนยกมา → 0, ประวัติว่าง, ค่าที่ client ยัดมา (costHistory) ถูกทับ
		Map<String, Object> m = mat("M-N1", "MATN1", 0, 0);
		m.remove("cost");
		m.put("costHistory", List.of(Map.of("cost", 999)));
		call("POST", "/materials", m, proc, 201);
		assertEquals(0.0, costOf("M-N1"), 0.00001);
		assertEquals(0, ((List<?>) call("GET", "/materials/M-N1", null, admin, 200).get("costHistory")).size());
		// รับ PO แรก → ต้นทุน = ราคา PO
		receive("PO-N1", "M-N1", 20, 33.3);
		assertEquals(33.3, costOf("M-N1"), 0.00001);
		// ต้นทุนยกมา (ส่งมาตอนสร้างพร้อมยอดยกมา) → ถือเป็นต้นทุนตั้งต้นและเฉลี่ยกับ PO ถัดไปได้ถูกต้อง
		call("POST", "/materials", mat("M-N2", "MATN2", 0, 40), proc, 201);
		assertEquals(40.0, costOf("M-N2"), 0.00001);
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> h = (List<Map<String, Object>>) call("GET", "/materials/M-N2", null, admin, 200).get("costHistory");
		assertEquals(1, h.size());
		assertEquals("ต้นทุนยกมา", h.get(0).get("note"));
		// ติดลบ → ถูกปรับเป็น 0
		call("POST", "/materials", mat("M-N3", "MATN3", 0, -5), proc, 201);
		assertEquals(0.0, costOf("M-N3"), 0.00001);
	}
}
