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
 * Phase PO Management + PO Receiving → Stock: กฎการออก/แก้ไข/อนุมัติ/ยกเลิก PO ฝั่ง server และการรับของ
 * (เพิ่มสต๊อก + movement + เปลี่ยนสถานะ ใน transaction เดียว, ไม่รับซ้ำ, rollback ทั้งใบเมื่อจับคู่วัตถุดิบไม่ได้)
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class PurchaseOrderRulesTests {
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
	static String admin, proc, prod, acct, sales;

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

	static Map<String, Object> sup(String id, String code, String status) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", id); m.put("code", code); m.put("name", "ผู้ขาย " + code); m.put("category", "เม็ดพลาสติก"); m.put("credit", 30); m.put("status", status);
		return m;
	}

	static Map<String, Object> mat(String id, String code, double stock, boolean active) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", id); m.put("code", code); m.put("name", "วัตถุดิบ " + code); m.put("type", "เม็ดพลาสติก"); m.put("unit", "KG");
		m.put("stock", stock); m.put("min", 10); m.put("max", 1000); m.put("cost", 5.5); m.put("active", active);
		return m;
	}

	static Map<String, Object> line(String item, double qty, double price) {
		Map<String, Object> l = new LinkedHashMap<>();
		if (item != null) l.put("item", item);
		l.put("name", "รายการ " + item); l.put("qty", qty); l.put("unit", "KG"); l.put("price", price);
		return l;
	}

	static Map<String, Object> po(String id, String supplier, List<Map<String, Object>> lines) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", id); m.put("date", "2026-11-17"); m.put("supplier", supplier); m.put("supplierName", "ผู้ขาย " + supplier);
		m.put("status", "pending"); m.put("whtRate", 0); m.put("lines", lines);
		// ยอดที่ client ส่งมาตั้งใจให้ผิด — server ต้องคำนวณใหม่
		m.put("subtotal", 1); m.put("vat", 1); m.put("total", 1); m.put("items", 99);
		return m;
	}

	static Map<String, Object> with(Map<String, Object> m, String k, Object v) {
		Map<String, Object> c = new HashMap<>(m);
		c.put(k, v);
		return c;
	}

	double stockOf(String matId) throws Exception {
		return ((Number) call("GET", "/materials/" + matId, null, admin, 200).get("stock")).doubleValue();
	}

	int movementsOf(String ref) {
		Integer n = jdbc.queryForObject("select count(*)::int from erp_records where collection = 'stockMovements' and data->>'ref' = ?", Integer.class, ref);
		return n == null ? 0 : n;
	}

	String poStatus(String id) throws Exception { return (String) call("GET", "/purchaseOrders/" + id, null, admin, 200).get("status"); }

	@Test @Order(1)
	void setup() throws Exception {
		String t = (String) call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), t, 200);
		admin = t;
		proc = newUser("proc1", "procurement");
		prod = newUser("prod1", "production");
		acct = newUser("acct1", "accounting");
		sales = newUser("sale1", "sales");
		call("POST", "/suppliers", sup("S-OK", "SUPOK", "active"), admin, 201);
		call("POST", "/suppliers", sup("S-OFF", "SUPOFF", "inactive"), admin, 201);
		call("POST", "/materials", mat("M-A", "MATA", 100, true), admin, 201);
		call("POST", "/materials", mat("M-B", "MATB", 50, true), admin, 201);
		call("POST", "/materials", mat("M-OFF", "MATOFF", 0, false), admin, 201);
	}

	@Test @Order(2)
	void createValidatesSupplierAndLines() throws Exception {
		List<Map<String, Object>> ok = List.of(line("M-A", 10, 5));
		call("POST", "/purchaseOrders", po("PO-R1", "NOSUCH", ok), proc, 400);                              // supplier ไม่มี
		call("POST", "/purchaseOrders", po("PO-R2", "SUPOFF", ok), proc, 400);                              // supplier ปิดใช้งาน
		call("POST", "/purchaseOrders", po("PO-R3", "SUPOK", List.of()), proc, 400);                        // ไม่มีรายการ
		call("POST", "/purchaseOrders", po("PO-R4", "SUPOK", List.of(line("custom", 1, 1))), proc, 400);    // รายการพิมพ์เอง
		call("POST", "/purchaseOrders", po("PO-R5", "SUPOK", List.of(line(null, 1, 1))), proc, 400);        // ไม่มี item
		call("POST", "/purchaseOrders", po("PO-R6", "SUPOK", List.of(line("M-NOPE", 1, 1))), proc, 400);    // วัตถุดิบไม่มี
		call("POST", "/purchaseOrders", po("PO-R7", "SUPOK", List.of(line("M-OFF", 1, 1))), proc, 400);     // วัตถุดิบปิดใช้งาน
		call("POST", "/purchaseOrders", po("PO-R8", "SUPOK", List.of(line("M-A", 0, 5))), proc, 400);       // qty = 0
		call("POST", "/purchaseOrders", po("PO-R9", "SUPOK", List.of(line("M-A", -2, 5))), proc, 400);      // qty ติดลบ
		call("POST", "/purchaseOrders", po("PO-R10", "SUPOK", List.of(line("M-A", 2, 0))), proc, 400);      // price = 0
		call("POST", "/purchaseOrders", po("PO-R11", "SUPOK", List.of(line("M-A", 2, 5), line("M-A", 3, 5))), proc, 400); // ซ้ำ
		call("POST", "/purchaseOrders", with(po("PO-R12", "SUPOK", ok), "status", "approved"), proc, 400);  // เริ่มที่อนุมัติไม่ได้
		call("POST", "/purchaseOrders", with(po("PO-R13", "SUPOK", ok), "status", "received"), proc, 400);
		Integer n = jdbc.queryForObject("select count(*)::int from erp_records where collection = 'purchaseOrders'", Integer.class);
		assertEquals(0, n, "PO ที่ไม่ผ่านกฎต้องไม่ถูกบันทึก");
	}

	@Test @Order(3)
	void serverRecomputesTotalsAndRolesAreEnforced() throws Exception {
		for (String t : List.of(acct, sales)) {
			call("POST", "/purchaseOrders", po("PO-X" + Math.abs(t.hashCode()), "SUPOK", List.of(line("M-A", 1, 1))), t, 403);
		}
		// ฝ่ายผลิตสร้างได้ (เริ่มที่รออนุมัติ) แต่แก้/ลบไม่ได้
		Map<String, Object> pp = call("POST", "/purchaseOrders", po("PO-PRD1", "SUPOK", List.of(line("M-A", 1, 1))), prod, 201);
		assertEquals("pending", pp.get("status"));
		call("PUT", "/purchaseOrders/PO-PRD1", pp, prod, 403);
		call("DELETE", "/purchaseOrders/PO-PRD1", null, prod, 403);
		call("POST", "/purchaseOrders", po("PO-T1", " supok ", List.of(line("M-A", 3, 10.333), line("M-B", 2, 100))), proc, 201);
		Map<String, Object> p = call("GET", "/purchaseOrders/PO-T1", null, admin, 200);
		// 3*10.333 = 30.999 → 31.00 ; 2*100 = 200 ; subtotal 231.00 ; vat 16.17 ; total 247.17
		assertEquals(231.0, ((Number) p.get("subtotal")).doubleValue(), 0.0001);
		assertEquals(16.17, ((Number) p.get("vat")).doubleValue(), 0.0001);
		assertEquals(247.17, ((Number) p.get("total")).doubleValue(), 0.0001);
		assertEquals(2, ((Number) p.get("items")).intValue());
	}

	@Test @Order(4)
	void statusTransitionsAndLocking() throws Exception {
		call("POST", "/purchaseOrders", po("PO-S1", "SUPOK", List.of(line("M-A", 5, 10))), proc, 201);
		Map<String, Object> cur = call("GET", "/purchaseOrders/PO-S1", null, proc, 200);
		// ตั้งสถานะรับแล้วโดยตรงไม่ได้ (ต้องผ่านปุ่มรับของ)
		call("PUT", "/purchaseOrders/PO-S1", with(cur, "status", "received"), admin, 409);
		call("PATCH", "/purchaseOrders/PO-S1", Map.of("status", "received"), admin, 409);
		// แก้รายการตอนยังไม่อนุมัติได้ และ server คำนวณยอดใหม่
		call("PUT", "/purchaseOrders/PO-S1", with(cur, "lines", List.of(line("M-A", 6, 10))), proc, 200);
		assertEquals(60.0, ((Number) call("GET", "/purchaseOrders/PO-S1", null, proc, 200).get("subtotal")).doubleValue(), 0.0001);
		// แก้เป็นรายการที่ไม่ถูกต้อง → ปฏิเสธ
		cur = call("GET", "/purchaseOrders/PO-S1", null, proc, 200);
		call("PUT", "/purchaseOrders/PO-S1", with(cur, "lines", List.of(line("custom", 1, 1))), proc, 400);
		// อนุมัติ → ระบบประทับผู้อนุมัติเอง (ไม่เชื่อค่าจาก client)
		cur = call("GET", "/purchaseOrders/PO-S1", null, proc, 200);
		call("PUT", "/purchaseOrders/PO-S1", with(with(cur, "status", "approved"), "approvedBy", "ปลอม"), proc, 200);
		Map<String, Object> ap = call("GET", "/purchaseOrders/PO-S1", null, admin, 200);
		assertEquals("approved", ap.get("status"));
		assertEquals("proc1", ap.get("approvedBy"));
		assertNotNull(ap.get("approvedAt"));
		// อนุมัติแล้วแก้รายการ/ยอด/supplier ไม่ได้ และถอยกลับไม่ได้
		call("PUT", "/purchaseOrders/PO-S1", with(ap, "lines", List.of(line("M-A", 99, 10))), proc, 409);
		call("PATCH", "/purchaseOrders/PO-S1", Map.of("total", 1), proc, 409);
		call("PATCH", "/purchaseOrders/PO-S1", Map.of("supplier", "SUPOFF"), proc, 409);
		call("PATCH", "/purchaseOrders/PO-S1", Map.of("status", "pending"), proc, 409);
		// ลบ PO ที่อนุมัติแล้วไม่ได้
		call("DELETE", "/purchaseOrders/PO-S1", null, admin, 409);
		// ยกเลิกต้องมีเหตุผล
		call("PATCH", "/purchaseOrders/PO-S1", Map.of("status", "cancelled"), proc, 400);
		call("PATCH", "/purchaseOrders/PO-S1", Map.of("status", "cancelled", "cancel", Map.of("reason", "  ")), proc, 400);
		call("PATCH", "/purchaseOrders/PO-S1", Map.of("status", "cancelled", "cancel", Map.of("reason", "สั่งผิด")), proc, 200);
		// ยกเลิกแล้วแก้อะไรไม่ได้ ฟื้นคืนไม่ได้
		call("PATCH", "/purchaseOrders/PO-S1", Map.of("status", "approved"), admin, 409);
		call("PATCH", "/purchaseOrders/PO-S1", Map.of("note", "x"), admin, 409);
		// PO ที่ยังไม่อนุมัติลบได้
		call("POST", "/purchaseOrders", po("PO-S2", "SUPOK", List.of(line("M-A", 1, 1))), proc, 201);
		call("DELETE", "/purchaseOrders/PO-S2", null, admin, 200);
		// supplier ที่ปิดใช้งานภายหลัง ไม่ขวางการอนุมัติ PO เดิม
		call("POST", "/purchaseOrders", po("PO-S3", "SUPOK", List.of(line("M-A", 1, 1))), proc, 201);
		call("PATCH", "/suppliers/S-OK", Map.of("status", "inactive"), admin, 200);
		call("PATCH", "/purchaseOrders/PO-S3", Map.of("status", "approved"), proc, 200);
		call("PATCH", "/suppliers/S-OK", Map.of("status", "active"), admin, 200);
	}

	@Test @Order(5)
	void receiveAddsStockOnceWithMovementAndPayable() throws Exception {
		double a0 = stockOf("M-A"), b0 = stockOf("M-B");
		call("POST", "/purchaseOrders", po("PO-V1", "SUPOK", List.of(line("M-A", 40, 10), line("M-B", 12.5, 20))), proc, 201);
		// ยังไม่อนุมัติ → รับไม่ได้ สต๊อกไม่เปลี่ยน
		call("POST", "/actions/purchase-orders/PO-V1/receive", null, proc, 422);
		assertEquals(a0, stockOf("M-A"), 0.0001);
		assertEquals("pending", poStatus("PO-V1"));
		// บทบาทที่ไม่มีสิทธิ์
		call("PATCH", "/purchaseOrders/PO-V1", Map.of("status", "approved"), proc, 200);
		for (String t : List.of(prod, acct, sales)) call("POST", "/actions/purchase-orders/PO-V1/receive", null, t, 403);
		assertEquals(a0, stockOf("M-A"), 0.0001);

		Map<String, Object> r = call("POST", "/actions/purchase-orders/PO-V1/receive", null, proc, 200);
		assertEquals(Boolean.TRUE, r.get("ok"));
		assertEquals(a0 + 40, stockOf("M-A"), 0.0001);
		assertEquals(b0 + 12.5, stockOf("M-B"), 0.0001);
		assertEquals("received", poStatus("PO-V1"));
		assertEquals(2, movementsOf("PO-V1"), "ต้องมี movement 1 รายการต่อบรรทัด อ้างเลข PO");
		Integer inType = jdbc.queryForObject("select count(*)::int from erp_records where collection='stockMovements' and data->>'ref'='PO-V1' and data->>'type'='IN'", Integer.class);
		assertEquals(2, inType);
		Integer exp = jdbc.queryForObject("select count(*)::int from erp_records where collection='expenses' and id='EXP-PO-V1'", Integer.class);
		assertEquals(1, exp);

		// รับซ้ำ → 409 และสต๊อก/movement ไม่เพิ่ม
		call("POST", "/actions/purchase-orders/PO-V1/receive", null, admin, 409);
		assertEquals(a0 + 40, stockOf("M-A"), 0.0001);
		assertEquals(2, movementsOf("PO-V1"));
		// PO ที่รับแล้วแก้/ลบไม่ได้
		call("PATCH", "/purchaseOrders/PO-V1", Map.of("status", "approved"), admin, 409);
		call("DELETE", "/purchaseOrders/PO-V1", null, admin, 409);
	}

	@Test @Order(6)
	void cancelledPoCannotBeReceived() throws Exception {
		double a0 = stockOf("M-A");
		call("POST", "/purchaseOrders", po("PO-C1", "SUPOK", List.of(line("M-A", 7, 1))), proc, 201);
		call("PATCH", "/purchaseOrders/PO-C1", Map.of("status", "approved"), proc, 200);
		call("PATCH", "/purchaseOrders/PO-C1", Map.of("status", "cancelled", "cancel", Map.of("reason", "ยกเลิก")), proc, 200);
		call("POST", "/actions/purchase-orders/PO-C1/receive", null, proc, 409);
		assertEquals(a0, stockOf("M-A"), 0.0001);
		call("POST", "/actions/purchase-orders/NOPE/receive", null, proc, 422);
	}

	@Test @Order(7)
	void unmatchedLineRejectsWholePoAndRollsBack() throws Exception {
		// PO เก่า (legacy) ที่บรรทัดแรกจับคู่ได้ แต่บรรทัดที่สองไม่มีในทะเบียน
		String legacy = "{\"id\":\"PO-L1\",\"supplier\":\"SUPOK\",\"supplierName\":\"ผู้ขาย\",\"status\":\"approved\",\"subtotal\":100,\"vat\":7,\"total\":107,"
			+ "\"lines\":[{\"item\":\"M-A\",\"name\":\"A\",\"qty\":5,\"unit\":\"KG\",\"price\":10},{\"name\":\"วัตถุดิบที่ไม่มีในระบบเลย\",\"qty\":3,\"unit\":\"KG\",\"price\":10}]}";
		jdbc.update("insert into erp_records(collection,id,data) values ('purchaseOrders','PO-L1', ?::jsonb)", legacy);
		double a0 = stockOf("M-A");
		int moves0 = jdbc.queryForObject("select count(*)::int from erp_records where collection='stockMovements'", Integer.class);
		call("POST", "/actions/purchase-orders/PO-L1/receive", null, proc, 422);
		assertEquals(a0, stockOf("M-A"), 0.0001, "ห้ามรับเข้าบางรายการ");
		assertEquals(moves0, jdbc.queryForObject("select count(*)::int from erp_records where collection='stockMovements'", Integer.class));
		assertEquals("approved", poStatus("PO-L1"));
		assertEquals(0, jdbc.queryForObject("select count(*)::int from erp_records where collection='expenses' and id='EXP-PO-L1'", Integer.class));

		// บรรทัด qty <= 0 ก็ปฏิเสธทั้งใบ
		String bad = "{\"id\":\"PO-L2\",\"supplier\":\"SUPOK\",\"status\":\"approved\",\"lines\":[{\"item\":\"M-A\",\"qty\":4,\"price\":1},{\"item\":\"M-B\",\"qty\":0,\"price\":1}]}";
		jdbc.update("insert into erp_records(collection,id,data) values ('purchaseOrders','PO-L2', ?::jsonb)", bad);
		call("POST", "/actions/purchase-orders/PO-L2/receive", null, proc, 422);
		assertEquals(a0, stockOf("M-A"), 0.0001);
		// ไม่มีรายการเลย
		jdbc.update("insert into erp_records(collection,id,data) values ('purchaseOrders','PO-L3', ?::jsonb)", "{\"id\":\"PO-L3\",\"status\":\"approved\",\"lines\":[]}");
		call("POST", "/actions/purchase-orders/PO-L3/receive", null, proc, 422);
		assertEquals("approved", poStatus("PO-L3"));
	}

	@Test @Order(8)
	void legacyLineWithoutItemStillMatchesByCode() throws Exception {
		// PO เก่าที่ไม่มี item แต่ชื่อมีรหัสวัตถุดิบ → ยังจับคู่ได้เหมือนเดิม
		jdbc.update("insert into erp_records(collection,id,data) values ('purchaseOrders','PO-L4', ?::jsonb)",
			"{\"id\":\"PO-L4\",\"supplier\":\"SUPOK\",\"supplierName\":\"ผู้ขาย\",\"status\":\"approved\",\"lines\":[{\"name\":\"เม็ด MATB เกรด 1\",\"qty\":8,\"price\":2}]}");
		double b0 = stockOf("M-B");
		call("POST", "/actions/purchase-orders/PO-L4/receive", null, proc, 200);
		assertEquals(b0 + 8, stockOf("M-B"), 0.0001);
	}

	@Test @Order(9)
	void concurrentReceiveAddsStockExactlyOnce() throws Exception {
		call("POST", "/purchaseOrders", po("PO-K1", "SUPOK", List.of(line("M-A", 25, 4))), proc, 201);
		call("PATCH", "/purchaseOrders/PO-K1", Map.of("status", "approved"), proc, 200);
		double a0 = stockOf("M-A");
		List<CompletableFuture<Integer>> fs = new ArrayList<>();
		for (int i = 0; i < 8; i++) {
			HttpRequest rq = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/actions/purchase-orders/PO-K1/receive"))
				.header("Content-Type", "application/json").header("Authorization", "Bearer " + (i % 2 == 0 ? admin : proc))
				.POST(HttpRequest.BodyPublishers.noBody()).build();
			fs.add(http.sendAsync(rq, HttpResponse.BodyHandlers.ofString()).thenApply(HttpResponse::statusCode));
		}
		int ok = 0, conflict = 0;
		for (CompletableFuture<Integer> f : fs) {
			int sc = f.get();
			if (sc == 200) ok++; else if (sc == 409) conflict++;
		}
		assertEquals(1, ok, "รับสำเร็จได้ครั้งเดียว");
		assertEquals(7, conflict);
		assertEquals(a0 + 25, stockOf("M-A"), 0.0001);
		assertEquals(1, movementsOf("PO-K1"));
		assertTrue(poStatus("PO-K1").equals("received"));
	}
}
