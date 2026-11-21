package com.backend.erp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
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

/** สิทธิ์อ่านข้อมูลฝั่งเซิร์ฟเวอร์ตามบทบาท: ฝ่ายผลิต/จัดซื้อไม่เห็นยอดเงินเอกสารขาย ค่าใช้จ่ายบริษัท เงินเดือน และ Audit Log */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ReadPolicyTests {
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
	static String admin, acc, sales, prod, proc;

	@SuppressWarnings("unchecked")
	Object call(String method, String path, Object body, String tok, int expect) throws Exception {
		HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1" + path)).header("Content-Type", "application/json");
		if (tok != null) b.header("Authorization", "Bearer " + tok);
		b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
		HttpResponse<String> res = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
		assertEquals(expect, res.statusCode(), method + " " + path + " -> " + res.body());
		String s = res.body();
		if (s == null || s.isBlank()) return Map.of();
		return s.startsWith("[") ? mapper.readValue(s, List.class) : mapper.readValue(s, Map.class);
	}

	@SuppressWarnings("unchecked")
	String newUser(String username, String role) throws Exception {
		Map<String, Object> u = (Map<String, Object>) call("POST", "/users", Map.of("username", username, "fullName", username, "role", role), admin, 201);
		String temp = (String) u.get("temporaryPassword");
		String t = (String) ((Map<String, Object>) call("POST", "/auth/login", Map.of("username", username, "password", temp), null, 200)).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", temp, "newPassword", "Test-Pass-" + username), t, 200);
		return t;
	}

	@SuppressWarnings("unchecked")
	List<Map<String, Object>> list(String path, String tok) throws Exception { return (List<Map<String, Object>>) call("GET", path, null, tok, 200); }

	@Test @Order(1)
	@SuppressWarnings("unchecked")
	void setup() throws Exception {
		String t = (String) ((Map<String, Object>) call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200)).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), t, 200);
		admin = t;
		acc = newUser("acc1", "accounting"); sales = newUser("sale1", "sales"); prod = newUser("prod1", "production"); proc = newUser("proc1", "procurement");
		jdbc.update("insert into erp_records(collection,id,data) values ('docs','IV-1','{\"type\":\"INV\",\"status\":\"approved\",\"customer\":\"C1\",\"customerName\":\"ลูกค้า\",\"total\":1070,\"subtotal\":1000,\"vat\":70,\"net\":1070,\"whtRate\":3,\"lines\":[{\"code\":\"A\",\"name\":\"สินค้า\",\"qty\":10,\"price\":100,\"disc\":0,\"unitCost\":60}]}'::jsonb)");
		jdbc.update("insert into erp_records(collection,id,data) values ('expenses','EXP-1','{\"vendor\":\"ผู้ขาย\",\"amount\":5000,\"category\":\"ค่าเช่า\",\"status\":\"approved\"}'::jsonb)");
		jdbc.update("insert into erp_records(collection,id,data) values ('employees','EMP-1','{\"name\":\"สมชาย\",\"salary\":38000}'::jsonb)");
	}

	@Test @Order(2)
	@SuppressWarnings("unchecked")
	void salesDocsRedactedForOtherRoles() throws Exception {
		for (String tok : new String[] { admin, acc, sales }) {                                          // ผู้มีสิทธิ์เห็นราคา: ครบ
			Map<String, Object> d = list("/docs", tok).get(0);
			assertEquals(1070.0, ((Number) d.get("total")).doubleValue(), 1e-9);
			assertEquals(100.0, ((Number) ((List<Map<String, Object>>) d.get("lines")).get(0).get("price")).doubleValue(), 1e-9);
		}
		for (String tok : new String[] { prod, proc }) {                                                  // ฝ่ายผลิต/จัดซื้อ: เห็นจำนวนแต่ไม่เห็นเงิน
			Map<String, Object> d = list("/docs", tok).get(0);
			assertEquals("C1", d.get("customer"));
			for (String k : new String[] { "total", "subtotal", "vat", "net", "whtRate" }) assertFalse(d.containsKey(k), k);
			Map<String, Object> line = ((List<Map<String, Object>>) d.get("lines")).get(0);
			assertEquals(10.0, ((Number) line.get("qty")).doubleValue(), 1e-9);
			for (String k : new String[] { "price", "disc", "unitCost" }) assertFalse(line.containsKey(k), k);
			assertFalse(((Map<String, Object>) call("GET", "/docs/IV-1", null, tok, 200)).containsKey("total"));
		}
	}

	@Test @Order(3)
	void expensesAndEmployeesOnlyForFinance() throws Exception {
		for (String tok : new String[] { admin, acc }) {
			assertEquals(1, list("/expenses", tok).size());
			assertEquals(1, list("/employees", tok).size());
			call("GET", "/expenses/EXP-1", null, tok, 200);
		}
		for (String tok : new String[] { sales, prod, proc }) {
			assertTrue(list("/expenses", tok).isEmpty());
			assertTrue(list("/employees", tok).isEmpty());
			call("GET", "/expenses/EXP-1", null, tok, 403);
			call("GET", "/employees/EMP-1", null, tok, 403);
		}
	}

	@Test @Order(4)
	@SuppressWarnings("unchecked")
	void bootstrapAppliesSamePolicyAndHidesAuditLogs() throws Exception {
		Map<String, Object> a = (Map<String, Object>) call("GET", "/bootstrap", null, admin, 200);
		assertEquals(1, ((List<?>) a.get("expenses")).size());
		assertFalse(((List<?>) a.get("auditLogs")).isEmpty());
		Map<String, Object> p = (Map<String, Object>) call("GET", "/bootstrap", null, prod, 200);
		assertTrue(((List<?>) p.get("expenses")).isEmpty());
		assertTrue(((List<?>) p.get("employees")).isEmpty());
		assertTrue(((List<?>) p.get("auditLogs")).isEmpty());
		assertFalse(((Map<String, Object>) ((List<?>) p.get("docs")).get(0)).containsKey("total"));
		Map<String, Object> s = (Map<String, Object>) call("GET", "/bootstrap", null, sales, 200);
		assertTrue(((List<?>) s.get("auditLogs")).isEmpty());                                              // ฝ่ายขายไม่เห็น Audit Log (มียอดเงิน)
		assertEquals(1, ((List<?>) s.get("docs")).size());
		assertTrue(((Map<String, Object>) ((List<?>) s.get("docs")).get(0)).containsKey("total"));
		call("GET", "/audit-logs", null, prod, 403);
	}
}
