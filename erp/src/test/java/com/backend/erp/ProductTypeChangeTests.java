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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import tools.jackson.databind.ObjectMapper;

/** เปลี่ยนประเภทงานของสินค้า: สิทธิ์ เหตุผล ตัวกันเอกสารค้าง ประวัติ และประวัติต้นทุนไม่หาย */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ProductTypeChangeTests {
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
	static String admin, sales;

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

	Map<String, Object> change(String id, String type, boolean buyable, String tok, int expect) throws Exception {
		return call("POST", "/actions/products/" + id + "/change-type", Map.of("jobType", type, "buyable", buyable, "reason", "ทดสอบ"), tok, expect);
	}

	/** ใส่เอกสารอ้างอิงตรงในฐานข้อมูล (ทดสอบเฉพาะตัวกัน ไม่ใช่กติกาการสร้างเอกสารนั้น) */
	void raw(String coll, String id, String data) {
		jdbc.update("insert into erp_records(collection, id, data) values (?, ?, ?::jsonb)", coll, id, data);
	}

	void drop(String id) { jdbc.update("delete from erp_records where id = ?", id); }

	static Map<String, Object> fg(String code, String jobType, double cost) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", "FG-" + code); m.put("code", code); m.put("name", code); m.put("jobType", jobType);
		m.put("unit", "PCS"); m.put("stock", 10); m.put("cost", cost); m.put("price", 100);
		return m;
	}

	@Test @Order(1)
	void setup() throws Exception {
		String t = (String) call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), t, 200);
		admin = t;
		Map<String, Object> u = call("POST", "/users", Map.of("username", "sale1", "fullName", "sale1", "role", "sales"), admin, 201);
		sales = (String) call("POST", "/auth/login", Map.of("username", "sale1", "password", u.get("temporaryPassword")), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", u.get("temporaryPassword"), "newPassword", "Test-Pass-sale1"), sales, 200);
		call("POST", "/finished", fg("T", "trade", 50), admin, 201);
		call("POST", "/finished", fg("O", "oem", 7), admin, 201);
	}

	@Test @Order(2)
	void typeOnlyChangesThroughAction() throws Exception {
		call("PATCH", "/finished/FG-O", Map.of("jobType", "trade"), admin, 409);
		call("PATCH", "/finished/FG-O", Map.of("jobTypeHistory", List.of()), admin, 409);
		change("FG-O", "trade", false, sales, 403);
		change("FG-O", "oem", false, admin, 400);
		change("FG-O", "xxx", false, admin, 400);
		call("POST", "/actions/products/FG-O/change-type", Map.of("jobType", "trade", "reason", " "), admin, 400);
	}

	@Test @Order(3)
	void openProductionBlocksTrade() throws Exception {
		raw("workOrders", "WO-1", "{\"id\":\"WO-1\",\"productCode\":\"O\",\"status\":\"running\"}");
		change("FG-O", "trade", false, admin, 409);
		drop("WO-1");
		raw("workOrders", "WO-2", "{\"id\":\"WO-2\",\"productCode\":\"O\",\"status\":\"done\"}");
		raw("boms", "BOM-1", "{\"id\":\"BOM-1\",\"productCode\":\"O\",\"status\":\"active\"}");
		change("FG-O", "trade", false, admin, 409);
		jdbc.update("update erp_records set data = jsonb_set(data, '{status}', '\"inactive\"') where id = 'BOM-1'");
		change("FG-O", "trade", false, admin, 200);
	}

	@Test @Order(4)
	@SuppressWarnings("unchecked")
	void openPurchaseBlocksNonBuyableAndHistoryIsKept() throws Exception {
		raw("purchaseOrders", "PO-1", "{\"id\":\"PO-1\",\"status\":\"approved\",\"lines\":[{\"itemType\":\"product\",\"item\":\"FG-T\"}]}");
		change("FG-T", "own", false, admin, 409);
		change("FG-T", "own", true, admin, 200);      // ยังสั่งซื้อได้ → ใบสั่งซื้อค้างไม่ขวาง
		Map<String, Object> p = call("GET", "/finished/FG-T", null, admin, 200);
		assertEquals("own", p.get("jobType"));
		assertEquals(true, p.get("buyable"));
		assertEquals(50.0, ((Number) p.get("cost")).doubleValue());
		assertEquals(1, ((List<?>) p.get("costHistory")).size());
		assertEquals(1, ((List<?>) p.get("jobTypeHistory")).size());
		drop("PO-1");
		// เอาธงสั่งซื้อได้ออก แก้ต้นทุนมาตรฐาน แล้วเปิดกลับ → ประวัติต้นทุนเดิมต้องไม่หาย
		call("PATCH", "/finished/FG-T", Map.of("buyable", false), admin, 200);
		call("PATCH", "/finished/FG-T", Map.of("cost", 40), admin, 200);
		call("PATCH", "/finished/FG-T", Map.of("buyable", true), admin, 200);
		List<Map<String, Object>> h = (List<Map<String, Object>>) call("GET", "/finished/FG-T", null, admin, 200).get("costHistory");
		assertEquals(2, h.size());
		assertEquals(40.0, ((Number) h.get(1).get("cost")).doubleValue());
		change("FG-T", "trade", false, admin, 200);
		Map<String, Object> back = call("GET", "/finished/FG-T", null, admin, 200);
		assertNull(back.get("buyable"));
		assertEquals(2, ((List<?>) back.get("jobTypeHistory")).size());
		assertEquals(10.0, ((Number) back.get("stock")).doubleValue());
	}
}
