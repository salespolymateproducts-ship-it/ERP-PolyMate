package com.backend.erp;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
 * ซื้อมาขายไป: PO ซื้อสินค้าสำเร็จรูปได้ (สินค้าซื้อมาขายไป / เปิดธง buyable), รับของเพิ่มสต๊อกสินค้า + movement + เจ้าหนี้ +
 * ต้นทุนถัวเฉลี่ย ใน transaction เดียว, ต้นทุนสินค้าที่ซื้อได้แก้ตรงไม่ได้ (ปรับโดย admin พร้อมเหตุผล), จุดสั่งซื้อ/ระยะเวลาสั่งของ
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class TradeGoodsTests {
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

	@SuppressWarnings("unchecked")
	String newUser(String username, String role) throws Exception {
		Map<String, Object> u = call("POST", "/users", Map.of("username", username, "fullName", username, "role", role), admin, 201);
		String temp = (String) u.get("temporaryPassword");
		String t = (String) call("POST", "/auth/login", Map.of("username", username, "password", temp), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", temp, "newPassword", "Test-Pass-" + username), t, 200);
		return t;
	}

	static Map<String, Object> fg(String code, String jobType, double stock, double cost) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", "FG-" + code); m.put("code", code); m.put("name", "สินค้า " + code); m.put("jobType", jobType);
		m.put("unit", "PCS"); m.put("stock", stock); m.put("cost", cost); m.put("price", 100);
		return m;
	}

	static Map<String, Object> line(String itemType, String item, double qty, double price) {
		Map<String, Object> l = new LinkedHashMap<>();
		if (itemType != null) l.put("itemType", itemType);
		l.put("item", item); l.put("name", "รายการ " + item); l.put("qty", qty); l.put("unit", "PCS"); l.put("price", price);
		return l;
	}

	static Map<String, Object> po(String id, List<Map<String, Object>> lines) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", id); m.put("date", "2026-11-17"); m.put("supplier", "SUPT"); m.put("supplierName", "ผู้ขาย SUPT");
		m.put("status", "pending"); m.put("whtRate", 0); m.put("lines", lines);
		return m;
	}

	static Map<String, Object> with(Map<String, Object> m, String k, Object v) {
		Map<String, Object> c = new HashMap<>(m);
		c.put(k, v);
		return c;
	}

	double stockOf(String coll, String id) throws Exception { return ((Number) call("GET", "/" + coll + "/" + id, null, admin, 200).get("stock")).doubleValue(); }

	double costOf(String id) throws Exception { return ((Number) call("GET", "/finished/" + id, null, admin, 200).get("cost")).doubleValue(); }

	void receive(String poId, List<Map<String, Object>> lines) throws Exception {
		call("POST", "/purchaseOrders", po(poId, lines), proc, 201);
		call("PATCH", "/purchaseOrders/" + poId, Map.of("status", "approved"), proc, 200);
		call("POST", "/actions/purchase-orders/" + poId + "/receive", null, proc, 200);
	}

	@SuppressWarnings("unchecked")
	Map<String, Object> movement(String ref, String item) throws Exception {
		String json = jdbc.queryForObject("select data::text from erp_records where collection='stockMovements' and data->>'ref' = ? and data->>'item' = ? limit 1", String.class, ref, item);
		return mapper.readValue(json, Map.class);
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
		Map<String, Object> sup = new LinkedHashMap<>();
		sup.put("id", "S-T"); sup.put("code", "SUPT"); sup.put("name", "ผู้ขาย SUPT"); sup.put("category", "อื่น ๆ"); sup.put("credit", 30); sup.put("status", "active");
		call("POST", "/suppliers", sup, admin, 201);
		Map<String, Object> mat = new LinkedHashMap<>();
		mat.put("id", "M-T"); mat.put("code", "M-T"); mat.put("name", "วัตถุดิบ"); mat.put("type", "เม็ดพลาสติก"); mat.put("unit", "KG");
		mat.put("stock", 0); mat.put("min", 1); mat.put("max", 100); mat.put("cost", 0); mat.put("active", true);
		call("POST", "/materials", mat, admin, 201);
		call("POST", "/finished", fg("T1", "trade", 100, 50), admin, 201);           // ซื้อมาขายไป: ต้นทุนยกมา 50, stock 100
		call("POST", "/finished", fg("OEM1", "oem", 10, 7), admin, 201);             // ผลิตเอง: ซื้อไม่ได้
		call("POST", "/finished", with(fg("OEM2", "oem", 0, 0), "buyable", true), admin, 201); // OEM ที่เปิดธงซื้อได้
		call("POST", "/finished", with(fg("T-OFF", "trade", 0, 0), "active", false), admin, 201);
	}

	@Test @Order(2)
	void productLinesOnPoAreValidated() throws Exception {
		List<Map<String, Object>> ok = List.of(line("product", "FG-T1", 10, 55));
		call("POST", "/purchaseOrders", po("PO-X1", List.of(line("product", "FG-OEM1", 10, 5))), proc, 400);     // ไม่ได้ตั้งเป็นซื้อได้
		call("POST", "/purchaseOrders", po("PO-X2", List.of(line("product", "FG-NOPE", 10, 5))), proc, 400);     // ไม่มีสินค้า
		call("POST", "/purchaseOrders", po("PO-X3", List.of(line("product", "FG-T-OFF", 10, 5))), proc, 400);    // ปิดใช้งาน
		call("POST", "/purchaseOrders", po("PO-X4", List.of(line("product", "FG-T1", 10, 5), line("product", "FG-T1", 5, 5))), proc, 400); // ซ้ำ
		call("POST", "/purchaseOrders", po("PO-X5", List.of(line("product", "FG-T1", 0, 5))), proc, 400);        // qty 0
		call("POST", "/purchaseOrders", po("PO-X6", List.of(line("product", "FG-T1", 1, 0))), proc, 400);        // ราคา 0
		call("POST", "/purchaseOrders", po("PO-X7", List.of(line(null, "FG-T1", 1, 5))), proc, 400);             // ไม่ระบุชนิด = วัตถุดิบ → ไม่พบวัตถุดิบ FG-T1
		call("POST", "/purchaseOrders", po("PO-X8", List.of(line("product", "custom", 1, 5))), proc, 400);
		for (String t : List.of(prod, sales, acct)) call("POST", "/purchaseOrders", po("PO-R" + Math.abs(t.hashCode()), ok), t, 403);
		// รหัสเดียวกันแต่ต่างชนิด (วัตถุดิบ / สินค้า) ในใบเดียวกันได้ และ server คำนวณยอดเอง
		call("POST", "/purchaseOrders", with(po("PO-OK1", List.of(line("product", "FG-T1", 10, 55), line("material", "M-T", 4, 20))), "total", 1), proc, 201);
		Map<String, Object> p = call("GET", "/purchaseOrders/PO-OK1", null, admin, 200);
		assertEquals(630.0, ((Number) p.get("subtotal")).doubleValue(), 1e-9);    // 550 + 80
		assertEquals("product", ((Map<?, ?>) ((List<?>) p.get("lines")).get(0)).get("itemType"));
		assertEquals("material", ((Map<?, ?>) ((List<?>) p.get("lines")).get(1)).get("itemType"));
		call("POST", "/purchaseOrders", po("PO-OK2", List.of(line("product", "FG-OEM2", 5, 30))), proc, 201);   // OEM ที่เปิดธงซื้อได้
	}

	@Test @Order(3)
	void receiveAddsFinishedStockCostMovementAndPayable() throws Exception {
		double s0 = stockOf("finished", "FG-T1");
		call("PATCH", "/purchaseOrders/PO-OK1", Map.of("status", "approved"), proc, 200);
		Map<String, Object> r = call("POST", "/actions/purchase-orders/PO-OK1/receive", null, proc, 200);
		assertEquals(Boolean.TRUE, r.get("ok"));
		// สินค้า: stock 100 @ 50 + 10 @ 55 → ถัวเฉลี่ย (5000 + 550) / 110 = 50.4545
		assertEquals(s0 + 10, stockOf("finished", "FG-T1"), 1e-9);
		assertEquals(50.4545, costOf("FG-T1"), 1e-4);
		assertEquals(4.0, stockOf("materials", "M-T"), 1e-9);                     // วัตถุดิบในใบเดียวกันก็เข้าสต๊อก
		Map<String, Object> mv = movement("PO-OK1", "T1");
		assertEquals("IN", mv.get("type"));
		assertEquals(55.0, ((Number) mv.get("unitCost")).doubleValue(), 1e-9);
		assertEquals(50.0, ((Number) mv.get("costBefore")).doubleValue(), 1e-9);
		assertEquals(50.4545, ((Number) mv.get("costAfter")).doubleValue(), 1e-4);
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> h = (List<Map<String, Object>>) call("GET", "/finished/FG-T1", null, admin, 200).get("costHistory");
		assertEquals(2, h.size());                                                 // ต้นทุนยกมา + รับ PO
		assertEquals("PO-OK1", h.get(1).get("ref"));
		// เจ้าหนี้: ใบผสม = หมวดวัตถุดิบ, ใบสินค้าล้วน = หมวดสินค้าซื้อมาขาย
		assertEquals("วัตถุดิบ", jdbc.queryForObject("select data->>'category' from erp_records where collection='expenses' and id='EXP-PO-OK1'", String.class));
		call("PATCH", "/purchaseOrders/PO-OK2", Map.of("status", "approved"), proc, 200);
		call("POST", "/actions/purchase-orders/PO-OK2/receive", null, proc, 200);
		assertEquals("สินค้าซื้อมาขาย", jdbc.queryForObject("select data->>'category' from erp_records where collection='expenses' and id='EXP-PO-OK2'", String.class));
		assertEquals(5.0, stockOf("finished", "FG-OEM2"), 1e-9);
		assertEquals(30.0, costOf("FG-OEM2"), 1e-9);                               // stock เดิม 0 → ต้นทุน = ราคา PO
		// รับซ้ำไม่ได้
		call("POST", "/actions/purchase-orders/PO-OK1/receive", null, admin, 409);
		assertEquals(s0 + 10, stockOf("finished", "FG-T1"), 1e-9);
	}

	@Test @Order(4)
	void unmatchedProductRollsBackWholePo() throws Exception {
		double t1 = stockOf("finished", "FG-T1"), m = stockOf("materials", "M-T");
		int mv0 = jdbc.queryForObject("select count(*)::int from erp_records where collection='stockMovements'", Integer.class);
		jdbc.update("insert into erp_records(collection,id,data) values ('purchaseOrders','PO-BAD', ?::jsonb)",
			"{\"id\":\"PO-BAD\",\"supplier\":\"SUPT\",\"status\":\"approved\",\"lines\":[{\"itemType\":\"material\",\"item\":\"M-T\",\"qty\":3,\"price\":9},{\"itemType\":\"product\",\"item\":\"FG-GHOST\",\"qty\":2,\"price\":9}]}");
		call("POST", "/actions/purchase-orders/PO-BAD/receive", null, proc, 422);
		assertEquals(t1, stockOf("finished", "FG-T1"), 1e-9);
		assertEquals(m, stockOf("materials", "M-T"), 1e-9);
		assertEquals(mv0, jdbc.queryForObject("select count(*)::int from erp_records where collection='stockMovements'", Integer.class));
		assertEquals("approved", call("GET", "/purchaseOrders/PO-BAD", null, admin, 200).get("status"));
	}

	@Test @Order(5)
	void concurrentReceiveOfProductPoAddsOnce() throws Exception {
		call("POST", "/purchaseOrders", po("PO-K1", List.of(line("product", "FG-T1", 25, 60))), proc, 201);
		call("PATCH", "/purchaseOrders/PO-K1", Map.of("status", "approved"), proc, 200);
		double s0 = stockOf("finished", "FG-T1");
		List<CompletableFuture<Integer>> fs = new ArrayList<>();
		for (int i = 0; i < 8; i++) {
			HttpRequest rq = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/actions/purchase-orders/PO-K1/receive"))
				.header("Content-Type", "application/json").header("Authorization", "Bearer " + (i % 2 == 0 ? admin : proc))
				.POST(HttpRequest.BodyPublishers.noBody()).build();
			fs.add(http.sendAsync(rq, HttpResponse.BodyHandlers.ofString()).thenApply(HttpResponse::statusCode));
		}
		int ok = 0, conflict = 0;
		for (CompletableFuture<Integer> f : fs) { int sc = f.get(); if (sc == 200) ok++; else if (sc == 409) conflict++; }
		assertEquals(1, ok);
		assertEquals(7, conflict);
		assertEquals(s0 + 25, stockOf("finished", "FG-T1"), 1e-9);
	}

	@Test @Order(6)
	void costOfBuyableProductsCannotBeEditedDirectly() throws Exception {
		double c = costOf("FG-T1");
		Map<String, Object> cur = call("GET", "/finished/FG-T1", null, admin, 200);
		for (String t : List.of(admin, sales, prod)) {
			call("PUT", "/finished/FG-T1", with(cur, "cost", 1), t, 409);
			call("PATCH", "/finished/FG-T1", Map.of("cost", 1), t, 409);
		}
		call("PATCH", "/finished/FG-T1", Map.of("costHistory", List.of()), admin, 409);
		assertEquals(c, costOf("FG-T1"), 1e-9);
		// ส่งค่าเดิมซ้ำ (ซิงก์ปกติของหน้าจอ) และแก้ราคาขาย/จุดสั่งซื้อ/ผู้ขายประจำ ได้
		call("PUT", "/finished/FG-T1", with(cur, "price", 150), sales, 200);
		call("PATCH", "/finished/FG-T1", Map.of("cost", c, "min", 30, "leadDays", 7, "supplier", "SUPT"), proc, 200);
		Map<String, Object> after = call("GET", "/finished/FG-T1", null, admin, 200);
		assertEquals(30, ((Number) after.get("min")).intValue());
		assertEquals(7, ((Number) after.get("leadDays")).intValue());
		// สินค้าผลิตเอง (ไม่ซื้อได้) ยังแก้ต้นทุนมาตรฐานได้ตามเดิม
		call("PATCH", "/finished/FG-OEM1", Map.of("cost", 9), sales, 200);
		assertEquals(9.0, costOf("FG-OEM1"), 1e-9);
	}

	@Test @Order(7)
	void adminAdjustsProductCostWithReason() throws Exception {
		for (String t : List.of(proc, prod, sales, acct)) call("POST", "/actions/products/FG-T1/adjust-cost", Map.of("cost", 40, "reason", "ปรับ"), t, 403);
		call("POST", "/actions/products/FG-T1/adjust-cost", Map.of("cost", 40, "reason", " "), admin, 400);
		call("POST", "/actions/products/FG-T1/adjust-cost", Map.of("cost", 40), admin, 400);
		call("POST", "/actions/products/FG-T1/adjust-cost", Map.of("cost", -1, "reason", "x"), admin, 400);
		call("POST", "/actions/products/NOPE/adjust-cost", Map.of("cost", 1, "reason", "x"), admin, 422);
		double before = costOf("FG-T1");
		call("POST", "/actions/products/FG-T1/adjust-cost", Map.of("cost", 40, "reason", "ผู้ขายคืนส่วนลด"), admin, 200);
		assertEquals(40.0, costOf("FG-T1"), 1e-9);
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> h = (List<Map<String, Object>>) call("GET", "/finished/FG-T1", null, admin, 200).get("costHistory");
		Map<String, Object> last = h.get(h.size() - 1);
		assertEquals("MANUAL", last.get("ref"));
		assertEquals(before, ((Number) last.get("prev")).doubleValue(), 1e-9);
		assertTrue(jdbc.queryForObject("select count(*)::int from erp_audit_logs where action='ADJUST_COST' and entity_id='FG-T1'", Integer.class) >= 1);
	}

	@Test @Order(8)
	void extrasValidationAndFlippingBuyable() throws Exception {
		call("PATCH", "/finished/FG-OEM1", Map.of("min", -1), admin, 400);
		call("PATCH", "/finished/FG-OEM1", Map.of("min", "abc"), admin, 400);
		call("PATCH", "/finished/FG-OEM1", Map.of("leadDays", -3), admin, 400);
		call("POST", "/finished", with(with(fg("BAD-MIN", "trade", 0, 0), "min", -5), "id", "FG-BAD-MIN"), admin, 400);
		// เปิดธง ซื้อได้ → ต้นทุนเริ่มถูกคุมโดยระบบ (ตั้งค่า cost ที่ส่งมาเป็นต้นทุนยกมา) แล้วแก้ตรงไม่ได้
		call("PATCH", "/finished/FG-OEM1", Map.of("buyable", true, "cost", 8), admin, 200);
		assertEquals(8.0, costOf("FG-OEM1"), 1e-9);
		assertEquals(1, ((List<?>) call("GET", "/finished/FG-OEM1", null, admin, 200).get("costHistory")).size());
		call("PATCH", "/finished/FG-OEM1", Map.of("cost", 3), admin, 409);
		receive("PO-OEM1", List.of(line("product", "FG-OEM1", 10, 12)));          // stock 10 @ 8 + 10 @ 12 = 10
		assertEquals(10.0, costOf("FG-OEM1"), 1e-9);
		// ต้นทุนยกมาติดลบ → 0
		call("POST", "/finished", with(fg("NEGC", "trade", 0, -5), "id", "FG-NEGC"), admin, 201);
		assertEquals(0.0, costOf("FG-NEGC"), 1e-9);
	}
}
