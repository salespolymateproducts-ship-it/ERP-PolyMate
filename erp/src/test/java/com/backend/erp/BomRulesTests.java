package com.backend.erp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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
 * BOM หลายสูตรต่อสินค้า: กฎการสร้าง/แก้, สัดส่วน % (มาสเตอร์แบตช์/เศษรีไซเคิล), สูตรหลัก, เวอร์ชัน,
 * snapshot ในใบสั่งผลิต, และการตัดวัตถุดิบตอนบันทึกผลิต (transaction เดียว, ปฏิเสธเมื่อวัตถุดิบไม่พอ)
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class BomRulesTests {
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
	static String admin, prod, proc, sales, acct;

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

	static Map<String, Object> mat(String id, double stock, boolean active) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", id); m.put("code", id); m.put("name", "วัตถุดิบ " + id); m.put("type", "เม็ดพลาสติก"); m.put("unit", "KG");
		m.put("stock", stock); m.put("min", 1); m.put("max", 100000); m.put("cost", 0); m.put("active", active);
		return m;
	}

	static Map<String, Object> fg(String code) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", "FG-" + code); m.put("code", code); m.put("name", "สินค้า " + code); m.put("unit", "PCS"); m.put("stock", 0);
		return m;
	}

	static Map<String, Object> resin(String item, double qty) {
		Map<String, Object> l = new LinkedHashMap<>();
		l.put("item", item); l.put("type", "resin"); l.put("qty", qty);
		return l;
	}

	static Map<String, Object> pct(String item, String type, double p) {
		Map<String, Object> l = new LinkedHashMap<>();
		l.put("item", item); l.put("type", type); l.put("basis", "pctOfResin"); l.put("pct", p);
		return l;
	}

	static Map<String, Object> bom(String id, String productCode, String status, List<Map<String, Object>> lines) {
		Map<String, Object> b = new LinkedHashMap<>();
		b.put("id", id); b.put("name", "สูตร " + id); b.put("productCode", productCode); b.put("color", "ดำ");
		b.put("status", status); b.put("wasteRate", 0); b.put("lines", lines);
		return b;
	}

	static Map<String, Object> wo(String id, String productCode, double qty) {
		Map<String, Object> w = new LinkedHashMap<>();
		w.put("id", id); w.put("productCode", productCode); w.put("product", "สินค้า " + productCode); w.put("quantity", qty);
		w.put("status", "queued"); w.put("produced", 0); w.put("ng", 0);
		return w;
	}

	static Map<String, Object> with(Map<String, Object> m, String k, Object v) {
		Map<String, Object> c = new HashMap<>(m);
		c.put(k, v);
		return c;
	}

	double stockOf(String coll, String id) throws Exception {
		return ((Number) call("GET", "/" + coll + "/" + id, null, admin, 200).get("stock")).doubleValue();
	}

	@SuppressWarnings("unchecked")
	Map<String, Object> snap(String woId) throws Exception {
		return (Map<String, Object>) call("GET", "/workOrders/" + woId, null, admin, 200).get("bomSnapshot");
	}

	@SuppressWarnings("unchecked")
	double snapQty(String woId, String item) throws Exception {
		for (Map<String, Object> l : (List<Map<String, Object>>) snap(woId).get("lines")) {
			if (item.equals(l.get("item"))) return ((Number) l.get("qty")).doubleValue();
		}
		throw new AssertionError("ไม่มีบรรทัด " + item);
	}

	@Test @Order(1)
	void setup() throws Exception {
		String t = (String) call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), t, 200);
		admin = t;
		prod = newUser("prod1", "production");
		proc = newUser("proc1", "procurement");
		sales = newUser("sale1", "sales");
		acct = newUser("acct1", "accounting");
		call("POST", "/materials", mat("R-ABS", 1000, true), admin, 201);
		call("POST", "/materials", mat("R-PC", 500, true), admin, 201);
		call("POST", "/materials", mat("MB-BK", 50, true), admin, 201);
		call("POST", "/materials", mat("RG-1", 100, true), admin, 201);
		call("POST", "/materials", mat("R-OLD", 10, false), admin, 201);
		call("POST", "/finished", fg("P-1"), admin, 201);
		call("POST", "/finished", fg("P-2"), admin, 201);
		call("POST", "/finished", fg("P-NOBOM"), admin, 201);
	}

	@Test @Order(2)
	void invalidBomsAreRejected() throws Exception {
		List<Map<String, Object>> ok = List.of(resin("R-ABS", 0.02));
		call("POST", "/boms", bom("B-X1", "NOPE", "active", ok), prod, 400);                                        // สินค้าไม่มี
		call("POST", "/boms", with(bom("B-X2", "P-1", "active", ok), "name", "  "), prod, 400);                     // ไม่มีชื่อ
		call("POST", "/boms", with(bom("B-X3", "P-1", "bogus", ok), "name", "x"), prod, 400);                       // สถานะผิด
		call("POST", "/boms", with(bom("B-X4", "P-1", "active", ok), "wasteRate", 51), prod, 400);                  // waste เกิน
		call("POST", "/boms", bom("B-X5", "P-1", "active", List.of()), prod, 400);                                  // ไม่มีรายการ
		call("POST", "/boms", bom("B-X6", "P-1", "active", List.of(pct("MB-BK", "masterbatch", 2))), prod, 400);    // ไม่มีเม็ด
		call("POST", "/boms", bom("B-X7", "P-1", "active", List.of(resin("R-ABS", 0.02), resin("R-ABS", 0.01))), prod, 400); // ซ้ำ
		call("POST", "/boms", bom("B-X8", "P-1", "active", List.of(resin("R-ABS", 0))), prod, 400);                 // qty 0
		call("POST", "/boms", bom("B-X9", "P-1", "active", List.of(resin("R-ABS", 0.02), pct("MB-BK", "masterbatch", 0))), prod, 400);   // pct 0
		call("POST", "/boms", bom("B-X10", "P-1", "active", List.of(resin("R-ABS", 0.02), pct("MB-BK", "masterbatch", 100))), prod, 400); // pct 100
		call("POST", "/boms", bom("B-X11", "P-1", "active", List.of(resin("NOPE", 0.02))), prod, 400);              // วัตถุดิบไม่มี
		call("POST", "/boms", bom("B-X12", "P-1", "active", List.of(resin("R-OLD", 0.02))), prod, 400);             // วัตถุดิบปิดใช้งาน
		call("POST", "/boms", bom("B-X13", "P-1", "active", List.of(resin("R-ABS", 0.02), pct("RG-1", "regrind", 0))), prod, 400); // regrind 0%
		Map<String, Object> badType = pct("MB-BK", "colorant", 2);
		call("POST", "/boms", bom("B-X14", "P-1", "active", List.of(resin("R-ABS", 0.02), badType)), prod, 400);    // ชนิดผิด
		for (String t : List.of(proc, sales, acct)) call("POST", "/boms", bom("B-R" + Math.abs(t.hashCode()), "P-1", "active", ok), t, 403);
		assertEquals(0, jdbc.queryForObject("select count(*)::int from erp_records where collection='boms'", Integer.class));
		// ร่างที่ใช้วัตถุดิบที่ปิดใช้งานได้ (ยังไม่ใช้งานจริง)
		call("POST", "/boms", bom("B-DRAFT", "P-2", "draft", List.of(resin("R-OLD", 0.02))), prod, 201);
		call("DELETE", "/boms/B-DRAFT", null, admin, 409);
	}

	@Test @Order(3)
	void defaultRevisionAndProductLock() throws Exception {
		// สูตรใช้งานแรก = สูตรหลักอัตโนมัติ
		call("POST", "/boms", with(bom("B-ABS", "P-1", "active", List.of(resin("R-ABS", 0.02))), "isDefault", false), prod, 201);
		Map<String, Object> a = call("GET", "/boms/B-ABS", null, admin, 200);
		assertEquals(true, a.get("isDefault"));
		assertEquals(1, ((Number) a.get("revision")).intValue());
		assertEquals("prod1", a.get("updatedBy"));
		// สูตรที่สองไม่เป็นหลัก ยกเว้นสั่งตั้ง และสูตรเดิมถูกปลดอัตโนมัติ
		call("POST", "/boms", bom("B-PC", "P-1", "active", List.of(resin("R-PC", 0.02))), prod, 201);
		assertEquals(false, call("GET", "/boms/B-PC", null, admin, 200).get("isDefault"));
		Map<String, Object> pcRec = call("GET", "/boms/B-PC", null, admin, 200);
		call("PUT", "/boms/B-PC", with(pcRec, "isDefault", true), prod, 200);
		assertEquals(true, call("GET", "/boms/B-PC", null, admin, 200).get("isDefault"));
		assertEquals(false, call("GET", "/boms/B-ABS", null, admin, 200).get("isDefault"));
		// เวอร์ชัน: แก้สูตร/waste เพิ่ม แก้บรรจุภัณฑ์ไม่เพิ่ม
		Map<String, Object> cur = call("GET", "/boms/B-ABS", null, admin, 200);
		call("PUT", "/boms/B-ABS", with(cur, "packaging", "กล่อง 50 ชิ้น"), prod, 200);
		assertEquals(1, ((Number) call("GET", "/boms/B-ABS", null, admin, 200).get("revision")).intValue());
		cur = call("GET", "/boms/B-ABS", null, admin, 200);
		call("PUT", "/boms/B-ABS", with(with(cur, "wasteRate", 2), "changeReason", "ปรับเผื่อเสีย"), prod, 200);
		assertEquals(2, ((Number) call("GET", "/boms/B-ABS", null, admin, 200).get("revision")).intValue());
		cur = call("GET", "/boms/B-ABS", null, admin, 200);
		call("PUT", "/boms/B-ABS", with(cur, "lines", List.of(resin("R-ABS", 0.025))), prod, 400);   // สูตรใช้งานอยู่ ต้องมีเหตุผล
		call("PUT", "/boms/B-ABS", with(with(cur, "lines", List.of(resin("R-ABS", 0.025))), "changeReason", "เปลี่ยนเกรด"), prod, 200);
		assertEquals(3, ((Number) call("GET", "/boms/B-ABS", null, admin, 200).get("revision")).intValue());
		call("PUT", "/boms/B-ABS", with(cur, "lines", List.of(resin("R-ABS", 0.025))), proc, 403);
		// ใช้งานซ้ำ revision ปลอมจาก client ไม่ได้
		cur = call("GET", "/boms/B-ABS", null, admin, 200);
		call("PUT", "/boms/B-ABS", with(with(cur, "revision", 99), "updatedBy", "ปลอม"), prod, 200);
		Map<String, Object> after = call("GET", "/boms/B-ABS", null, admin, 200);
		assertEquals(3, ((Number) after.get("revision")).intValue());
		assertEquals("prod1", after.get("updatedBy"));
		// เปลี่ยนสินค้าไม่ได้
		call("PUT", "/boms/B-ABS", with(after, "productCode", "P-2"), prod, 409);
		call("PATCH", "/boms/B-ABS", Map.of("productCode", "P-2"), admin, 409);
		call("DELETE", "/boms/B-ABS", null, admin, 409);
		call("DELETE", "/boms/B-ABS", null, prod, 409);
	}

	@Test @Order(4)
	void percentLinesResolveToKgPerPiece() throws Exception {
		// เม็ด 0.020 กก./ชิ้น · มาสเตอร์ 2% ของเม็ด · เศษรีไซเคิล 10% แทนเม็ดใหม่
		call("POST", "/boms", bom("B-MIX", "P-2", "active", List.of(resin("R-ABS", 0.02), pct("MB-BK", "masterbatch", 2), pct("RG-1", "regrind", 10))), prod, 201);
		call("POST", "/workOrders", with(wo("WO-MIX", "P-2", 100), "bomId", "B-MIX"), prod, 201);
		assertEquals(0.018, snapQty("WO-MIX", "R-ABS"), 1e-9);      // 0.020 x (1 - 10%)
		assertEquals(0.0004, snapQty("WO-MIX", "MB-BK"), 1e-9);     // 0.020 x 2%
		assertEquals(0.002, snapQty("WO-MIX", "RG-1"), 1e-9);       // 0.020 x 10%
		// มาสเตอร์แบตช์กำหนดเป็น กก./ชิ้น แบบคงที่ก็ได้
		Map<String, Object> fixed = new LinkedHashMap<>();
		fixed.put("item", "MB-BK"); fixed.put("type", "masterbatch"); fixed.put("basis", "perPiece"); fixed.put("qty", 0.0007);
		call("POST", "/boms", bom("B-FIX", "P-2", "draft", List.of(resin("R-PC", 0.03), fixed)), prod, 201);
		assertEquals("perPiece", ((Map<?, ?>) ((List<?>) call("GET", "/boms/B-FIX", null, admin, 200).get("lines")).get(1)).get("basis"));
	}

	@Test @Order(5)
	void workOrderPicksVariantAndKeepsSnapshot() throws Exception {
		// ไม่ระบุสูตร → ใช้สูตรหลักของสินค้า (B-PC เป็นสูตรหลักของ P-1)
		call("POST", "/workOrders", wo("WO-1", "P-1", 100), prod, 201);
		assertEquals("B-PC", call("GET", "/workOrders/WO-1", null, admin, 200).get("bomId"));
		assertEquals(0.02, snapQty("WO-1", "R-PC"), 1e-9);
		// เลือกสูตร ABS
		call("POST", "/workOrders", with(wo("WO-2", "P-1", 100), "bomId", "B-ABS"), prod, 201);
		assertEquals(0.025, snapQty("WO-2", "R-ABS"), 1e-9);
		// สูตรของสินค้าอื่น / สูตรไม่ใช้งาน / สูตรไม่มี → 400
		call("POST", "/workOrders", with(wo("WO-3", "P-1", 10), "bomId", "B-MIX"), prod, 400);
		call("POST", "/workOrders", with(wo("WO-4", "P-2", 10), "bomId", "B-DRAFT"), prod, 400);
		call("POST", "/workOrders", with(wo("WO-5", "P-1", 10), "bomId", "NOPE"), prod, 400);
		// ส่ง snapshot ปลอมมา → ถูกทิ้ง server สร้างเอง
		Map<String, Object> forged = with(wo("WO-6", "P-1", 10), "bomId", "B-ABS");
		forged.put("bomSnapshot", Map.of("wasteRate", 0, "lines", List.of(Map.of("item", "R-ABS", "qty", 0.000001))));
		call("POST", "/workOrders", forged, sales, 201);
		assertEquals(0.025, snapQty("WO-6", "R-ABS"), 1e-9);
		// แก้ BOM ภายหลัง → ใบสั่งเดิมไม่เปลี่ยน
		Map<String, Object> cur = call("GET", "/boms/B-ABS", null, admin, 200);
		call("PUT", "/boms/B-ABS", with(with(cur, "lines", List.of(resin("R-ABS", 0.5))), "changeReason", "ทดสอบ"), prod, 200);
		assertEquals(0.025, snapQty("WO-2", "R-ABS"), 1e-9);
		assertEquals(3, ((Number) snap("WO-2").get("revision")).intValue());
		// client แก้ bomId/snapshot ของใบสั่งเดิม → server คืนค่าเดิม (ไม่ error)
		Map<String, Object> w2 = call("GET", "/workOrders/WO-2", null, admin, 200);
		Map<String, Object> tamper = with(with(w2, "bomId", "B-PC"), "bomSnapshot", Map.of("lines", List.of()));
		call("PUT", "/workOrders/WO-2", with(tamper, "status", "setup"), prod, 200);
		Map<String, Object> w2b = call("GET", "/workOrders/WO-2", null, admin, 200);
		assertEquals("B-ABS", w2b.get("bomId"));
		assertEquals("setup", w2b.get("status"));
		assertEquals(0.025, snapQty("WO-2", "R-ABS"), 1e-9);
		call("PATCH", "/workOrders/WO-2", Map.of("bomId", "B-PC"), prod, 200);
		assertEquals("B-ABS", call("GET", "/workOrders/WO-2", null, admin, 200).get("bomId"));
		// เลิกใช้สูตรที่ยังมีใบสั่งเปิดอยู่ไม่ได้ ปิดใบสั่งแล้วเลิกใช้ได้
		call("PATCH", "/boms/B-ABS", Map.of("status", "inactive"), prod, 409);
		call("PATCH", "/boms/B-ABS", Map.of("status", "draft"), prod, 409);
		for (String id : List.of("WO-2", "WO-6")) call("PATCH", "/workOrders/" + id, Map.of("status", "cancelled"), prod, 200);
		call("PATCH", "/boms/B-ABS", Map.of("status", "inactive"), prod, 200);
		assertEquals(false, call("GET", "/boms/B-ABS", null, admin, 200).get("isDefault"));
	}

	@Test @Order(6)
	void produceConsumesBySnapshotAndRejectsShortage() throws Exception {
		call("PATCH", "/boms/B-PC", Map.of("wasteRate", 10, "changeReason", "เผื่อเสีย"), prod, 200);   // แก้หลังเปิด WO-1 ไม่กระทบใบเดิม (waste 0)
		double pc0 = stockOf("materials", "R-PC"), fg0 = stockOf("finished", "FG-P-1");
		int mv0 = jdbc.queryForObject("select count(*)::int from erp_records where collection='stockMovements'", Integer.class);
		// WO-1: เม็ด PC 0.02 กก./ชิ้น ไม่เผื่อเสีย → ผลิต 100 ใช้ 2.0 กก.
		Map<String, Object> r = call("POST", "/actions/work-orders/WO-1/produce", Map.of("produced", 100, "ng", 5), prod, 200);
		assertEquals(Boolean.TRUE, r.get("hasBom"));
		assertEquals(pc0 - 2.0, stockOf("materials", "R-PC"), 1e-6);
		assertEquals(fg0 + 95, stockOf("finished", "FG-P-1"), 1e-6);
		assertEquals(mv0 + 2, jdbc.queryForObject("select count(*)::int from erp_records where collection='stockMovements'", Integer.class)); // OUT เม็ด + IN สินค้า
		// ผลิตเกินวัตถุดิบ → ปฏิเสธทั้งหมด ไม่มีอะไรเปลี่ยน
		call("POST", "/workOrders", with(wo("WO-BIG", "P-1", 100000), "bomId", "B-PC"), prod, 201);
		double pcBefore = stockOf("materials", "R-PC");
		int mvBefore = jdbc.queryForObject("select count(*)::int from erp_records where collection='stockMovements'", Integer.class);
		Map<String, Object> err = call("POST", "/actions/work-orders/WO-BIG/produce", Map.of("produced", 100000, "ng", 0), prod, 422);
		assertTrue(String.valueOf(err).contains("R-PC"));
		assertEquals(pcBefore, stockOf("materials", "R-PC"), 1e-6);
		assertEquals(mvBefore, jdbc.queryForObject("select count(*)::int from erp_records where collection='stockMovements'", Integer.class));
		assertEquals(0.0, ((Number) call("GET", "/workOrders/WO-BIG", null, admin, 200).get("produced")).doubleValue(), 1e-9);
		// สิทธิ์
		for (String t : List.of(proc, sales, acct)) call("POST", "/actions/work-orders/WO-1/produce", Map.of("produced", 1, "ng", 0), t, 403);
	}

	@Test @Order(7)
	void mixedBomConsumesAllLinesAtomically() throws Exception {
		double abs0 = stockOf("materials", "R-ABS"), mb0 = stockOf("materials", "MB-BK"), rg0 = stockOf("materials", "RG-1");
		call("POST", "/actions/work-orders/WO-MIX/produce", Map.of("produced", 1000, "ng", 0), prod, 200);
		assertEquals(abs0 - 18.0, stockOf("materials", "R-ABS"), 1e-6);
		assertEquals(mb0 - 0.4, stockOf("materials", "MB-BK"), 1e-6);
		assertEquals(rg0 - 2.0, stockOf("materials", "RG-1"), 1e-6);
		// มาสเตอร์แบตช์พอแต่เศษบดไม่พอ → ล้มทั้งชุด (ไม่ตัดเม็ด/มาสเตอร์ไปก่อน)
		call("POST", "/workOrders", with(wo("WO-MIX2", "P-2", 100000), "bomId", "B-MIX"), prod, 201);
		double abs1 = stockOf("materials", "R-ABS"), mb1 = stockOf("materials", "MB-BK");
		call("POST", "/actions/work-orders/WO-MIX2/produce", Map.of("produced", 60000, "ng", 0), prod, 422);   // RG-1 ต้อง 120 > 98 คงเหลือ
		assertEquals(abs1, stockOf("materials", "R-ABS"), 1e-6);
		assertEquals(mb1, stockOf("materials", "MB-BK"), 1e-6);
	}

	@Test @Order(8)
	void productWithoutBomProducesWithoutConsumption() throws Exception {
		call("POST", "/workOrders", wo("WO-NB", "P-NOBOM", 10), prod, 201);
		assertTrue(!call("GET", "/workOrders/WO-NB", null, admin, 200).containsKey("bomId"));
		double pc = stockOf("materials", "R-PC");
		Map<String, Object> r = call("POST", "/actions/work-orders/WO-NB/produce", Map.of("produced", 10, "ng", 0), prod, 200);
		assertEquals(Boolean.FALSE, r.get("hasBom"));
		assertEquals(pc, stockOf("materials", "R-PC"), 1e-6);
		assertEquals(10.0, stockOf("finished", "FG-P-NOBOM"), 1e-6);
	}

	@Test @Order(9)
	void concurrentProduceNeverOversellsMaterial() throws Exception {
		call("POST", "/materials", mat("R-LIM", 100, true), admin, 201);
		call("POST", "/finished", fg("P-C"), admin, 201);
		call("POST", "/boms", bom("B-C", "P-C", "active", List.of(resin("R-LIM", 1))), prod, 201);   // 1 กก./ชิ้น
		for (int i = 0; i < 6; i++) call("POST", "/workOrders", wo("WO-C" + i, "P-C", 60), prod, 201);
		List<CompletableFuture<Integer>> fs = new ArrayList<>();
		for (int i = 0; i < 6; i++) {
			HttpRequest rq = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/actions/work-orders/WO-C" + i + "/produce"))
				.header("Content-Type", "application/json").header("Authorization", "Bearer " + (i % 2 == 0 ? admin : prod))
				.POST(HttpRequest.BodyPublishers.ofString("{\"produced\":60,\"ng\":0}")).build();
			fs.add(http.sendAsync(rq, HttpResponse.BodyHandlers.ofString()).thenApply(HttpResponse::statusCode));
		}
		int ok = 0, rejected = 0;
		for (CompletableFuture<Integer> f : fs) { int sc = f.get(); if (sc == 200) ok++; else if (sc == 422) rejected++; }
		assertEquals(1, ok, "ผลิตสำเร็จได้ 1 ใบ (100 กก. พอแค่ 60 ชิ้นหนึ่งครั้ง)");
		assertEquals(5, rejected);
		assertEquals(40.0, stockOf("materials", "R-LIM"), 1e-6);
		assertEquals(60.0, stockOf("finished", "FG-P-C"), 1e-6);
		assertFalse(jdbc.queryForObject("select count(*)::int from erp_records where collection='stockMovements' and data->>'item'='R-LIM'", Integer.class) != 1);
		assertNotNull(call("GET", "/workOrders/WO-C0", null, admin, 200).get("bomSnapshot"));
	}

	@SuppressWarnings("unchecked")
	@Test @Order(10)
	void bomHistoryKeepsPreviousVersions() throws Exception {
		call("POST", "/finished", fg("P-S2"), admin, 201);
		call("POST", "/boms", bom("B-S2", "P-S2", "active", List.of(resin("R-ABS", 0.02), pct("MB-BK", "masterbatch", 2), pct("RG-1", "regrind", 10))), prod, 201);
		Map<String, Object> cur = call("GET", "/boms/B-S2", null, admin, 200);
		assertTrue(!cur.containsKey("history"));
		call("PUT", "/boms/B-S2", with(cur, "wasteRate", 3), prod, 400);                                   // ไม่ใส่เหตุผล
		call("PUT", "/boms/B-S2", with(with(cur, "wasteRate", 3), "changeReason", "ของเสียสูงขึ้น"), prod, 200);
		cur = call("GET", "/boms/B-S2", null, admin, 200);
		List<Map<String, Object>> h = (List<Map<String, Object>>) cur.get("history");
		assertEquals(1, h.size());
		assertEquals(1, ((Number) h.get(0).get("revision")).intValue());
		assertEquals(0.0, ((Number) h.get(0).get("wasteRate")).doubleValue(), 1e-9);
		assertEquals("ของเสียสูงขึ้น", h.get(0).get("reason"));
		assertEquals("prod1", h.get(0).get("by"));
		assertTrue(!cur.containsKey("changeReason"));
		// แก้ที่ไม่เปลี่ยนสูตร (บรรจุภัณฑ์) ไม่เพิ่มประวัติ และ client ปลอมประวัติไม่ได้
		call("PUT", "/boms/B-S2", with(with(cur, "packaging", "กล่อง"), "history", List.of()), prod, 200);
		assertEquals(1, ((List<?>) call("GET", "/boms/B-S2", null, admin, 200).get("history")).size());
		// แก้สายผลิตซ้ำ → ประวัติใหม่อยู่บนสุด
		cur = call("GET", "/boms/B-S2", null, admin, 200);
		call("PUT", "/boms/B-S2", with(with(cur, "wasteRate", 0), "changeReason", "กลับค่า"), prod, 200);
		h = (List<Map<String, Object>>) call("GET", "/boms/B-S2", null, admin, 200).get("history");
		assertEquals(2, h.size());
		assertEquals(2, ((Number) h.get(0).get("revision")).intValue());
		// ร่างแก้ได้โดยไม่ต้องมีเหตุผล
		call("POST", "/boms", bom("B-S2D", "P-S2", "draft", List.of(resin("R-ABS", 0.02))), prod, 201);
		cur = call("GET", "/boms/B-S2D", null, admin, 200);
		call("PUT", "/boms/B-S2D", with(cur, "wasteRate", 1), prod, 200);
	}

	@SuppressWarnings("unchecked")
	@Test @Order(11)
	void workOrderBomAdjustment() throws Exception {
		call("POST", "/workOrders", with(wo("WO-S2", "P-S2", 100), "bomId", "B-S2"), prod, 201);
		assertEquals(0.018, snapQty("WO-S2", "R-ABS"), 1e-9);
		List<Map<String, Object>> adj = List.of(Map.of("item", "MB-BK", "pct", 4), Map.of("item", "RG-1", "pct", 20));
		String url = "/actions/work-orders/WO-S2/bom-adjust";
		// ต้องมีเหตุผล / สิทธิ์ / รายการต้องถูกต้อง
		call("POST", url, Map.of("adjustments", adj, "reason", " "), prod, 400);
		for (String t : List.of(proc, acct)) call("POST", url, Map.of("adjustments", adj, "reason", "x"), t, 403);
		call("POST", url, Map.of("adjustments", List.of(Map.of("item", "R-ABS", "pct", 5)), "reason", "x"), prod, 400);      // เม็ดหลักปรับไม่ได้
		call("POST", url, Map.of("adjustments", List.of(Map.of("item", "R-PC", "pct", 5)), "reason", "x"), prod, 400);       // ไม่อยู่ในสูตร
		call("POST", url, Map.of("adjustments", List.of(Map.of("item", "MB-BK", "pct", 100)), "reason", "x"), prod, 400);
		call("POST", url, Map.of("adjustments", List.of(Map.of("item", "MB-BK", "pct", 0)), "reason", "x"), prod, 400);
		call("POST", url, Map.of("adjustments", List.of(Map.of("item", "RG-1", "pct", 99.9), Map.of("item", "RG-1", "pct", 5)), "reason", "x"), prod, 400);  // ซ้ำ
		assertEquals(0.0004, snapQty("WO-S2", "MB-BK"), 1e-9);   // ยังไม่เปลี่ยน
		Map<String, Object> r = call("POST", url, Map.of("adjustments", adj, "reason", "ลูกค้าขอสีเข้มขึ้น"), prod, 200);
		assertEquals(2, ((Number) r.get("adjusted")).intValue());
		assertEquals(0.016, snapQty("WO-S2", "R-ABS"), 1e-9);     // 0.02 x (1 - 20%)
		assertEquals(0.0008, snapQty("WO-S2", "MB-BK"), 1e-9);    // 0.02 x 4%
		assertEquals(0.004, snapQty("WO-S2", "RG-1"), 1e-9);      // 0.02 x 20%
		Map<String, Object> sn = snap("WO-S2");
		assertEquals("ลูกค้าขอสีเข้มขึ้น", sn.get("adjustReason"));
		assertEquals(2, ((List<?>) sn.get("adjustments")).size());
		// แก้ BOM หลักภายหลังไม่กระทบใบที่ปรับแล้ว และ client ทับ snapshot ไม่ได้
		Map<String, Object> w = call("GET", "/workOrders/WO-S2", null, admin, 200);
		call("PUT", "/workOrders/WO-S2", with(w, "bomSnapshot", Map.of("lines", List.of())), prod, 200);
		assertEquals(0.0008, snapQty("WO-S2", "MB-BK"), 1e-9);
		// ปรับซ้ำคำนวณจากสูตรตั้งต้นเสมอ (ไม่ทบ) และส่งรายการว่าง = คืนค่าตามสูตร
		call("POST", url, Map.of("adjustments", List.of(Map.of("item", "MB-BK", "pct", 3)), "reason", "ลดลง"), prod, 200);
		assertEquals(0.018, snapQty("WO-S2", "R-ABS"), 1e-9);
		assertEquals(0.0006, snapQty("WO-S2", "MB-BK"), 1e-9);
		call("POST", url, Map.of("adjustments", List.of(), "reason", "คืนค่า"), prod, 200);
		assertEquals(0.0004, snapQty("WO-S2", "MB-BK"), 1e-9);
		assertTrue(!snap("WO-S2").containsKey("adjustments"));
		// ตัดวัตถุดิบตามสัดส่วนที่ปรับ
		call("POST", url, Map.of("adjustments", adj, "reason", "ปรับก่อนผลิต"), prod, 200);
		double abs0 = stockOf("materials", "R-ABS"), mb0 = stockOf("materials", "MB-BK"), rg0 = stockOf("materials", "RG-1");
		call("POST", "/actions/work-orders/WO-S2/produce", Map.of("produced", 50, "ng", 0), prod, 200);
		assertEquals(abs0 - 0.8, stockOf("materials", "R-ABS"), 1e-6);
		assertEquals(mb0 - 0.04, stockOf("materials", "MB-BK"), 1e-6);
		assertEquals(rg0 - 0.2, stockOf("materials", "RG-1"), 1e-6);
		// เริ่มผลิตแล้ว → ปรับไม่ได้
		call("POST", url, Map.of("adjustments", List.of(Map.of("item", "MB-BK", "pct", 1)), "reason", "x"), prod, 409);
		assertEquals(1, jdbc.queryForObject("select count(*)::int from erp_audit_logs where action='BOM_ADJUST' and detail like '%ปรับก่อนผลิต%'", Integer.class));
	}
}
