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
 * น้ำหนักชิ้นงาน + รันเนอร์ (กรัม): เม็ดต่อชิ้น = (ชิ้นงาน + รันเนอร์ ÷ คาวิตี้) ÷ 1000 กก. · ผลิตแล้วรันเนอร์ (ช็อต × กรัม) เข้าสต๊อกเศษรีไซเคิล
 * ตีมูลค่าที่ต้นทุนเม็ด และหักออกจากต้นทุนสินค้า
 * ตัวอย่าง: 6 คาวิตี้ ชิ้นละ 3 กรัม รันเนอร์ 15 กรัม → 5.5 กรัม/ชิ้น
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class RunnerWeightTests {
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
	static String admin, prod;

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

	double num(String coll, String id, String field) throws Exception {
		Object v = call("GET", "/" + coll + "/" + id, null, admin, 200).get(field);
		return v == null ? 0 : ((Number) v).doubleValue();
	}

	static Map<String, Object> mat(String id, double stock, String type) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", id); m.put("code", id); m.put("name", "วัตถุดิบ " + id); m.put("type", type); m.put("unit", "KG");
		m.put("stock", stock); m.put("min", 1); m.put("max", 100000); m.put("cost", 0); m.put("active", true);
		return m;
	}

	static Map<String, Object> resinLine(String item) {
		Map<String, Object> l = new LinkedHashMap<>();
		l.put("item", item); l.put("type", "resin"); l.put("qty", 0.001);   // ค่าชั่วคราว — server คำนวณจากน้ำหนักชิ้นงาน/รันเนอร์ทับ
		return l;
	}

	static Map<String, Object> bom(String id, List<Map<String, Object>> lines, double part, double runner, Double cavities) {
		Map<String, Object> b = new LinkedHashMap<>();
		b.put("id", id); b.put("name", "สูตร " + id); b.put("productCode", "F2"); b.put("color", "ดำ");
		b.put("status", "active"); b.put("wasteRate", 0); b.put("lines", lines);
		b.put("partWeight", part); b.put("runnerWeight", runner);
		if (cavities != null) b.put("cavities", cavities);
		return b;
	}

	@SuppressWarnings("unchecked")
	double firstLineQty(String bomId) throws Exception {
		return ((Number) ((Map<String, Object>) ((List<?>) call("GET", "/boms/" + bomId, null, admin, 200).get("lines")).get(0)).get("qty")).doubleValue();
	}

	@Test @Order(1)
	void setup() throws Exception {
		String t = (String) call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), t, 200);
		admin = t;
		prod = newUser("prod1", "production");
		call("POST", "/materials", mat("R2", 1000, "เม็ดพลาสติก"), admin, 201);
		call("POST", "/materials", mat("RG", 0, "เศษรีไซเคิล"), admin, 201);
		jdbc.update("update erp_records set data = jsonb_set(data, '{cost}', '100') where collection='materials' and id='R2'");
		Map<String, Object> fg = new LinkedHashMap<>();
		fg.put("id", "FG-F2"); fg.put("code", "F2"); fg.put("name", "สินค้า F2"); fg.put("unit", "PCS"); fg.put("stock", 0);
		call("POST", "/finished", fg, admin, 201);
	}

	@Test @Order(2)
	void resinPerPieceIncludesRunnerShare() throws Exception {
		Map<String, Object> b = bom("B2", List.of(resinLine("R2")), 3, 15, 6.0);
		b.put("regrindItem", "RG");
		call("POST", "/boms", b, prod, 201);
		assertEquals(0.0055, firstLineQty("B2"), 1e-9);                    // (3 + 15/6) g = 5.5 g
		Map<String, Object> saved = call("GET", "/boms/B2", null, admin, 200);
		assertEquals(6.0, ((Number) saved.get("cavities")).doubleValue(), 1e-9);
		assertEquals("RG", saved.get("regrindItem"));
	}

	@Test @Order(3)
	void validation() throws Exception {
		call("POST", "/boms", bom("B-NOCAV", List.of(resinLine("R2")), 3, 15, null), prod, 400);          // ไม่มีคาวิตี้/แม่พิมพ์
		call("POST", "/boms", bom("B-NEG", List.of(resinLine("R2")), 3, -1, 6.0), prod, 400);             // รันเนอร์ติดลบ
		Map<String, Object> r2b = resinLine("RG");
		call("POST", "/boms", bom("B-2RESIN", List.of(resinLine("R2"), r2b), 3, 15, 6.0), prod, 400);     // หลายเกรดไม่ใช่ %
		Map<String, Object> hot = bom("B-HOT", List.of(resinLine("R2")), 3, 0, 6.0);                      // รันเนอร์ร้อน: ไม่มีรันเนอร์
		call("POST", "/boms", hot, prod, 201);
		assertEquals(0.003, firstLineQty("B-HOT"), 1e-9);
	}

	@Test @Order(4)
	void produceRecoversRunnerIntoRegrindStockAndLowersCost() throws Exception {
		call("PATCH", "/boms/B-HOT", Map.of("status", "inactive"), prod, 200);
		Map<String, Object> wo = new LinkedHashMap<>();
		wo.put("id", "WR1"); wo.put("productCode", "F2"); wo.put("product", "สินค้า F2"); wo.put("quantity", 600);
		wo.put("status", "queued"); wo.put("produced", 0); wo.put("ng", 0); wo.put("bomId", "B2");
		call("POST", "/workOrders", wo, prod, 201);
		Map<String, Object> r = call("POST", "/actions/work-orders/WR1/produce", Map.of("produced", 600, "ng", 0), prod, 200);
		// เม็ด 600 × 5.5 g = 3.3 กก. (฿330) · ช็อต 600÷6 = 100 × 15 g = 1.5 กก. รันเนอร์ → เศษรีไซเคิล (มูลค่า ฿150)
		assertEquals(1000 - 3.3, num("materials", "R2", "stock"), 1e-9);
		assertEquals(1.5, num("materials", "RG", "stock"), 1e-9);
		assertEquals(100.0, num("materials", "RG", "cost"), 1e-9);
		assertEquals(1.5, ((Number) r.get("runnerRecoveredKg")).doubleValue(), 1e-9);
		// ต้นทุนสินค้า = (330 − 150) ÷ 600 = 0.30 บาท/ชิ้น = 3 กรัม × 100 บาท/กก.
		assertEquals(0.30, num("finished", "FG-F2", "cost"), 1e-9);
		assertEquals(600, num("finished", "FG-F2", "stock"), 1e-9);
	}

	@Test @Order(5)
	void recycledVariantOfSameGradeIsCreatedAndReused() throws Exception {
		// ไม่ระบุที่เก็บรันเนอร์ + สูตรไม่มีเศษรีไซเคิล → สร้าง "R2-RC" (รีไซเคิลของ R2) อัตโนมัติ และสูตรถัดไปใช้ตัวเดิม
		call("POST", "/boms", bom("B3", List.of(resinLine("R2")), 3, 15, 6.0), prod, 201);
		Map<String, Object> b3 = call("GET", "/boms/B3", null, admin, 200);
		assertEquals("R2-RC", b3.get("regrindItem"));
		Map<String, Object> rc = call("GET", "/materials/R2-RC", null, admin, 200);
		assertEquals("R2", rc.get("recycledFrom"));
		assertEquals("เศษรีไซเคิล", rc.get("type"));
		assertEquals("KG", rc.get("unit"));
		call("POST", "/boms", bom("B4", List.of(resinLine("R2")), 4, 12, 6.0), prod, 201);
		assertEquals("R2-RC", call("GET", "/boms/B4", null, admin, 200).get("regrindItem"));      // ไม่สร้างซ้ำ

		Map<String, Object> wo = new LinkedHashMap<>();
		wo.put("id", "WR2"); wo.put("productCode", "F2"); wo.put("product", "สินค้า F2"); wo.put("quantity", 600);
		wo.put("status", "queued"); wo.put("produced", 0); wo.put("ng", 0); wo.put("bomId", "B3");
		call("POST", "/workOrders", wo, prod, 201);
		double before = num("materials", "R2-RC", "stock");
		call("POST", "/actions/work-orders/WR2/produce", Map.of("produced", 600, "ng", 0), prod, 200);
		assertEquals(before + 1.5, num("materials", "R2-RC", "stock"), 1e-9);                       // รันเนอร์ 1.5 กก. เข้า R2-RC
	}

	@Test @Order(6)
	void setProductLeftRightInOneMold() throws Exception {
		// ชุดซ้าย+ขวา (2 ชิ้น/ชุด) แม่พิมพ์ 2 คาวิตี้ ชิ้นละ 3 กรัม รันเนอร์ 15 กรัม → 1 ช็อต = 1 ชุด ใช้เม็ด 3+3+15 = 21 กรัม
		Map<String, Object> fg = new LinkedHashMap<>();
		fg.put("id", "FG-F5"); fg.put("code", "F5"); fg.put("name", "ครอบไฟเลี้ยว ชุด"); fg.put("unit", "SET"); fg.put("stock", 0);
		call("POST", "/finished", fg, admin, 201);
		Map<String, Object> bad = with(bom("B5X", List.of(resinLine("R2")), 3, 15, 3.0), "productCode", "F5");
		bad.put("piecesPerUnit", 2);
		call("POST", "/boms", bad, prod, 400);                                                         // 3 คาวิตี้ หารด้วย 2 ไม่ลงตัว
		Map<String, Object> b = with(bom("B5", List.of(resinLine("R2")), 3, 15, 2.0), "productCode", "F5");
		b.put("piecesPerUnit", 2);
		call("POST", "/boms", b, prod, 201);
		assertEquals(0.021, firstLineQty("B5"), 1e-9);
		Map<String, Object> wo = new LinkedHashMap<>();
		wo.put("id", "WR5"); wo.put("productCode", "F5"); wo.put("product", "ครอบไฟเลี้ยว ชุด"); wo.put("quantity", 100);
		wo.put("status", "queued"); wo.put("produced", 0); wo.put("ng", 0); wo.put("bomId", "B5");
		call("POST", "/workOrders", wo, prod, 201);
		double r2 = num("materials", "R2", "stock"), rc = num("materials", "R2-RC", "stock");
		Map<String, Object> r = call("POST", "/actions/work-orders/WR5/produce", Map.of("produced", 100, "ng", 0), prod, 200);
		assertEquals(r2 - 2.1, num("materials", "R2", "stock"), 1e-9);                                  // 100 ชุด × 21 กรัม = 2.1 กก.
		assertEquals(rc + 1.5, num("materials", "R2-RC", "stock"), 1e-9);                               // 100 ช็อต × 15 กรัม = 1.5 กก.
		assertEquals(1.5, ((Number) r.get("runnerRecoveredKg")).doubleValue(), 1e-9);
		assertEquals(0.6, num("finished", "FG-F5", "cost"), 1e-9);                                      // (210 − 150) ÷ 100 ชุด = 6 กรัม × 100 บาท/กก.
	}

	static Map<String, Object> with(Map<String, Object> m, String k, Object v) {
		Map<String, Object> c = new LinkedHashMap<>(m);
		c.put(k, v);
		return c;
	}
}
