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
 * เครื่องจักร: กฎข้อมูล (รหัสซ้ำ, ขนาด, ระยะห่างเสา, ช่วงความหนา), ห้ามลบ, สิทธิ์ตามบทบาท, สภาพเครื่องต้องมีเหตุผล,
 * ตั้งซ่อม/เลิกใช้ไม่ได้ถ้ามีใบสั่งผลิตเปิดอยู่, เปิดใบสั่งบนเครื่องที่ซ่อม/เลิกใช้ไม่ได้, บันทึกซ่อมบำรุง,
 * และระบบผลิตเขียนทับสภาพเครื่องไม่ได้
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class MachineRulesTests {
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

	static Map<String, Object> mc(String id) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", id); m.put("name", "เครื่อง " + id + " — Test 180T"); m.put("tonnage", 180);
		m.put("tieBarW", 460); m.put("tieBarL", 460); m.put("thkMin", 150); m.put("thkMax", 450); m.put("pmIntervalDays", 60);
		m.put("location", "โรงงาน 1"); m.put("note", "");
		return m;
	}

	static Map<String, Object> with(Map<String, Object> m, String k, Object v) {
		Map<String, Object> c = new HashMap<>(m);
		c.put(k, v);
		return c;
	}

	static Map<String, Object> wo(String id, String machine) {
		Map<String, Object> w = new LinkedHashMap<>();
		w.put("id", id); w.put("productCode", "NONE"); w.put("product", "สินค้า"); w.put("quantity", 10); w.put("machine", machine);
		w.put("status", "queued"); w.put("produced", 0); w.put("ng", 0);
		return w;
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
	}

	@Test @Order(2)
	void createRules() throws Exception {
		for (String t : List.of(proc, sales, acct)) call("POST", "/machines", mc("X" + Math.abs(t.hashCode())), t, 403);
		Map<String, Object> noName = mc("M-X1"); noName.put("name", " ");
		call("POST", "/machines", noName, prod, 400);
		call("POST", "/machines", with(mc("M-X2"), "tonnage", 0), prod, 400);
		call("POST", "/machines", with(mc("M-X3"), "tonnage", -5), prod, 400);
		Map<String, Object> noTon = mc("M-X4"); noTon.remove("tonnage");
		call("POST", "/machines", noTon, prod, 400);
		Map<String, Object> oneTie = mc("M-X5"); oneTie.remove("tieBarL");
		call("POST", "/machines", oneTie, prod, 400);                                             // กว้างโดยไม่มียาว
		call("POST", "/machines", with(mc("M-X6"), "tieBarW", 0), prod, 400);
		call("POST", "/machines", with(with(mc("M-X7"), "thkMin", 500), "thkMax", 300), prod, 400); // ต่ำสุดเกินสูงสุด
		Map<String, Object> oneThk = mc("M-X8"); oneThk.remove("thkMax");
		call("POST", "/machines", oneThk, prod, 400);
		call("POST", "/machines", with(mc("M-X9"), "pmIntervalDays", 99999), prod, 400);
		call("POST", "/machines", mc("bad id!"), prod, 400);                                      // รหัสมีอักขระต้องห้าม
		call("POST", "/machines", with(mc("M-X10"), "condition", "maintenance"), prod, 400);      // สภาพไม่ปกติต้องมีเหตุผล
		call("POST", "/machines", with(mc("M-X11"), "condition", "bogus"), prod, 400);
		assertEquals(0, jdbc.queryForObject("select count(*)::int from erp_records where collection='machines'", Integer.class));

		Map<String, Object> ok = mc("INJ-T1"); ok.put("status", "running"); ok.put("maintLog", List.of(Map.of("note", "ปลอม")));
		call("POST", "/machines", ok, prod, 201);
		Map<String, Object> r = call("GET", "/machines/INJ-T1", null, admin, 200);
		assertEquals("idle", r.get("status"), "สถานะเดินเครื่องเริ่มที่ idle (ค่าจาก client ถูกทิ้ง)");
		assertEquals("ready", r.get("condition"));
		assertEquals(0, ((List<?>) r.get("maintLog")).size());
		assertNotNullDate(r.get("lastMaint"));
		// ไม่ระบุข้อมูลเสา/ความหนา/รอบ PM ได้ (ข้ามการตรวจ) และรอบ PM ตั้งต้น 90 วัน
		Map<String, Object> bare = new LinkedHashMap<>();
		bare.put("id", "INJ-T2"); bare.put("name", "เครื่องเล็ก"); bare.put("tonnage", 80);
		call("POST", "/machines", bare, admin, 201);
		assertEquals(90, ((Number) call("GET", "/machines/INJ-T2", null, admin, 200).get("pmIntervalDays")).intValue());
		// เครื่องที่สร้างด้วยสภาพซ่อมพร้อมเหตุผล (เช่น ข้อมูลตั้งต้น)
		call("POST", "/machines", with(with(mc("INJ-T3"), "condition", "maintenance"), "conditionReason", "เปลี่ยนซีล"), admin, 201);
		assertEquals("เปลี่ยนซีล", call("GET", "/machines/INJ-T3", null, admin, 200).get("conditionReason"));
	}

	static void assertNotNullDate(Object d) { assertTrue(d != null && String.valueOf(d).matches("\\d{4}-\\d{2}-\\d{2}"), "lastMaint = " + d); }

	@Test @Order(3)
	void duplicateIdsAndNoDelete() throws Exception {
		call("POST", "/machines", mc("INJ-T1"), admin, 409);
		call("POST", "/machines", mc("inj-t1"), admin, 409);       // ตัวพิมพ์ต่าง
		for (String t : List.of(admin, prod)) call("DELETE", "/machines/INJ-T2", null, t, 409);
		for (String t : List.of(proc, sales, acct)) call("DELETE", "/machines/INJ-T2", null, t, 403);
		call("GET", "/machines/INJ-T2", null, admin, 200);
	}

	@Test @Order(4)
	void editKeepsServerOwnedFields() throws Exception {
		Map<String, Object> cur = call("GET", "/machines/INJ-T1", null, admin, 200);
		Map<String, Object> tamper = with(with(with(cur, "name", "ชื่อใหม่"), "condition", "retired"), "status", "running");
		tamper.put("maintLog", List.of(Map.of("note", "ปลอม")));
		tamper.put("lastMaint", "2000-01-01");
		call("PUT", "/machines/INJ-T1", tamper, prod, 200);
		Map<String, Object> after = call("GET", "/machines/INJ-T1", null, admin, 200);
		assertEquals("ชื่อใหม่", after.get("name"));
		assertEquals("ready", after.get("condition"));
		assertEquals("idle", after.get("status"));
		assertEquals(0, ((List<?>) after.get("maintLog")).size());
		assertEquals(cur.get("lastMaint"), after.get("lastMaint"));
		call("PATCH", "/machines/INJ-T1", Map.of("condition", "retired", "tonnage", 200), prod, 200);
		after = call("GET", "/machines/INJ-T1", null, admin, 200);
		assertEquals(200, ((Number) after.get("tonnage")).intValue());
		assertEquals("ready", after.get("condition"));
		// แก้เป็นค่าผิดกฎก็ถูกปฏิเสธ
		call("PATCH", "/machines/INJ-T1", Map.of("tonnage", 0), prod, 400);
		call("PUT", "/machines/INJ-T1", with(after, "thkMin", 900), prod, 400);
		for (String t : List.of(proc, sales, acct)) call("PATCH", "/machines/INJ-T1", Map.of("name", "x"), t, 403);
	}

	@Test @Order(5)
	void conditionNeedsReasonAndRoles() throws Exception {
		call("POST", "/actions/machines/INJ-T1/condition", Map.of("condition", "due", "reason", "เสียงดังผิดปกติ"), proc, 403);
		call("POST", "/actions/machines/INJ-T1/condition", Map.of("condition", "due", "reason", " "), prod, 400);
		call("POST", "/actions/machines/INJ-T1/condition", Map.of("condition", "due"), prod, 400);
		call("POST", "/actions/machines/INJ-T1/condition", Map.of("condition", "bogus", "reason", "x"), prod, 400);
		call("POST", "/actions/machines/NOPE/condition", Map.of("condition", "due", "reason", "x"), prod, 404);
		call("POST", "/actions/machines/INJ-T1/condition", Map.of("condition", "due", "reason", "เสียงดังผิดปกติ"), prod, 200);
		Map<String, Object> m = call("GET", "/machines/INJ-T1", null, admin, 200);
		assertEquals("due", m.get("condition"));
		assertEquals("เสียงดังผิดปกติ", m.get("conditionReason"));
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> log = (List<Map<String, Object>>) m.get("conditionLog");
		assertEquals("ready", log.get(0).get("from"));
		assertEquals("due", log.get(0).get("to"));
		assertEquals("prod1", log.get(0).get("by"));
		// กลับเป็นพร้อมใช้งานไม่ต้องมีเหตุผล และล้างเหตุผลเดิม
		call("POST", "/actions/machines/INJ-T1/condition", Map.of("condition", "ready"), admin, 200);
		m = call("GET", "/machines/INJ-T1", null, admin, 200);
		assertEquals("ready", m.get("condition"));
		assertEquals("", m.get("conditionReason"));
		assertEquals(2, ((List<?>) m.get("conditionLog")).size());
		assertTrue(jdbc.queryForObject("select count(*)::int from erp_audit_logs where action = 'MACHINE_CONDITION' and entity_id = 'INJ-T1'", Integer.class) >= 2);
	}

	@Test @Order(6)
	void workOrdersOnMachines() throws Exception {
		// เครื่องไม่มีในทะเบียน / "—" / ว่าง
		call("POST", "/workOrders", wo("WO-M0", "NOPE"), prod, 400);
		call("POST", "/workOrders", wo("WO-M1", "—"), prod, 201);
		// ควรซ่อมบำรุง ยังเลือกได้ (เตือนที่หน้าจอ) · ซ่อมอยู่/เลิกใช้ เลือกไม่ได้
		call("POST", "/actions/machines/INJ-T1/condition", Map.of("condition", "due", "reason", "ครบรอบ PM"), prod, 200);
		call("POST", "/workOrders", wo("WO-M2", "INJ-T1"), prod, 201);
		call("POST", "/workOrders", wo("WO-M3", "INJ-T3"), prod, 400);                       // INJ-T3 อยู่ระหว่างซ่อมบำรุง
		call("PATCH", "/workOrders/WO-M1", Map.of("machine", "INJ-T3"), prod, 400);          // ย้ายใบสั่งไปเครื่องที่ซ่อมอยู่ไม่ได้
		call("PATCH", "/workOrders/WO-M1", Map.of("machine", "INJ-T1"), prod, 200);
		// มีใบสั่งเปิดอยู่ → ตั้งซ่อม/เลิกใช้ไม่ได้
		call("POST", "/actions/machines/INJ-T1/condition", Map.of("condition", "maintenance", "reason", "เปลี่ยนซีล"), prod, 409);
		call("POST", "/actions/machines/INJ-T1/condition", Map.of("condition", "retired", "reason", "ขายทิ้ง"), admin, 409);
		for (String id : List.of("WO-M1", "WO-M2")) call("PATCH", "/workOrders/" + id, Map.of("status", "cancelled"), prod, 200);
		call("POST", "/actions/machines/INJ-T1/condition", Map.of("condition", "maintenance", "reason", "เปลี่ยนซีล"), prod, 200);
		call("POST", "/workOrders", wo("WO-M4", "INJ-T1"), prod, 400);
		call("POST", "/actions/machines/INJ-T1/condition", Map.of("condition", "retired", "reason", "ขายทิ้ง"), admin, 200);
		call("POST", "/workOrders", wo("WO-M5", "INJ-T1"), prod, 400);
		call("POST", "/actions/machines/INJ-T1/maintenance", Map.of("note", "x"), prod, 409);   // เครื่องเลิกใช้บันทึกซ่อมไม่ได้
		// เลิกใช้แล้วกลับมาใช้ได้
		call("POST", "/actions/machines/INJ-T1/condition", Map.of("condition", "ready"), admin, 200);
		call("POST", "/workOrders", wo("WO-M6", "INJ-T1"), prod, 201);
	}

	@Test @Order(7)
	void maintenanceLog() throws Exception {
		for (String t : List.of(proc, sales, acct)) call("POST", "/actions/machines/INJ-T3/maintenance", Map.of("note", "เปลี่ยนซีลกระบอกฉีด"), t, 403);
		call("POST", "/actions/machines/INJ-T3/maintenance", Map.of("note", "  "), prod, 400);
		call("POST", "/actions/machines/INJ-T3/maintenance", Map.of("note", "ซ่อม", "kind", "bogus"), prod, 400);
		call("POST", "/actions/machines/INJ-T3/maintenance", Map.of("note", "ซ่อม", "cost", -1), prod, 400);
		call("POST", "/actions/machines/INJ-T3/maintenance", Map.of("note", "ซ่อม", "date", "2999-01-01"), prod, 400);
		call("POST", "/actions/machines/INJ-T3/maintenance", Map.of("note", "ซ่อม", "date", "ไม่ใช่วันที่"), prod, 400);
		call("POST", "/actions/machines/NOPE/maintenance", Map.of("note", "ซ่อม"), prod, 404);
		// ซ่อมเสร็จ (finish เริ่มต้น = true): บันทึกประวัติ + วันล่าสุด + กลับเป็นพร้อมใช้งาน
		Map<String, Object> r = call("POST", "/actions/machines/INJ-T3/maintenance",
			Map.of("kind", "repair", "note", "เปลี่ยนซีลกระบอกฉีด", "cost", 12500, "downtimeHrs", 6.5, "date", "2026-11-10"), prod, 200);
		assertEquals("ready", r.get("condition"));
		Map<String, Object> m = call("GET", "/machines/INJ-T3", null, admin, 200);
		assertEquals("ready", m.get("condition"));
		assertEquals("", m.get("conditionReason"));
		assertTrue(String.valueOf(m.get("lastMaint")).compareTo("2026-11-10") >= 0);
		@SuppressWarnings("unchecked")
		Map<String, Object> e = ((List<Map<String, Object>>) m.get("maintLog")).get(0);
		assertEquals("เปลี่ยนซีลกระบอกฉีด", e.get("note"));
		assertEquals(12500.0, ((Number) e.get("cost")).doubleValue(), 1e-9);
		assertEquals(6.5, ((Number) e.get("downtimeHrs")).doubleValue(), 1e-9);
		assertEquals("prod1", e.get("by"));
		// ยังไม่เสร็จ (finish=false): บันทึกประวัติแต่สภาพ/วันล่าสุดไม่เปลี่ยน
		call("POST", "/actions/machines/INJ-T3/condition", Map.of("condition", "maintenance", "reason", "ซ่อมรอบสอง"), prod, 200);
		String last = (String) call("GET", "/machines/INJ-T3", null, admin, 200).get("lastMaint");
		call("POST", "/actions/machines/INJ-T3/maintenance", Map.of("note", "ถอดชิ้นส่วนตรวจสอบ", "finish", false, "date", "2026-11-12"), prod, 200);
		m = call("GET", "/machines/INJ-T3", null, admin, 200);
		assertEquals("maintenance", m.get("condition"));
		assertEquals(last, m.get("lastMaint"));
		assertEquals(2, ((List<?>) m.get("maintLog")).size());
		// PM ที่เครื่องพร้อมใช้งานอยู่: อัปเดตวันล่าสุด ไม่เปลี่ยนสภาพ
		call("POST", "/actions/machines/INJ-T2/maintenance", Map.of("kind", "PM", "note", "ตรวจเช็กประจำรอบ", "date", "2026-11-15"), prod, 200);
		m = call("GET", "/machines/INJ-T2", null, admin, 200);
		assertEquals("ready", m.get("condition"));
		assertTrue(String.valueOf(m.get("lastMaint")).compareTo("2026-11-15") >= 0, "วันบำรุงล่าสุดไม่เลื่อนย้อนหลัง");
		assertEquals(1, ((List<?>) m.get("maintLog")).size());
	}

	@Test @Order(8)
	void productionDoesNotOverwriteCondition() throws Exception {
		// เครื่องที่ผลิตอยู่ ถูกตั้งเป็น "ควรซ่อมบำรุง" ได้ และบันทึกผลิตต้องไม่ล้างสภาพนี้
		call("POST", "/finished", Map.of("id", "FG-PM", "code", "P-M", "name", "สินค้า", "unit", "PCS", "stock", 0), admin, 201);
		call("POST", "/machines", mc("INJ-T4"), admin, 201);
		Map<String, Object> w = wo("WO-PM", "INJ-T4"); w.put("productCode", "P-M");
		call("POST", "/workOrders", w, prod, 201);
		call("POST", "/actions/machines/INJ-T4/condition", Map.of("condition", "due", "reason", "ครบรอบ PM"), prod, 200);
		call("POST", "/actions/work-orders/WO-PM/produce", Map.of("produced", 4, "ng", 0), prod, 200);
		Map<String, Object> m = call("GET", "/machines/INJ-T4", null, admin, 200);
		assertEquals("running", m.get("status"));
		assertEquals("due", m.get("condition"));
		assertEquals("ครบรอบ PM", m.get("conditionReason"));
		call("POST", "/actions/work-orders/WO-PM/produce", Map.of("produced", 6, "ng", 0), prod, 200);
		m = call("GET", "/machines/INJ-T4", null, admin, 200);
		assertEquals("idle", m.get("status"));
		assertEquals("due", m.get("condition"));
	}
}
