package com.backend.erp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

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
 * Phase 2 (ทะเบียนวัตถุดิบ): ห้ามลบ materials, กฎฟิลด์ตาม role, รหัสซ้ำข้าม materials/finished, advisory lock
 * แยกคลาสเพื่อให้มี context (และตัวจำกัดจำนวนครั้ง login) ของตัวเอง
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class MaterialRegistryRulesTests {
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

	static Map<String, Object> mat(String id, String code, Object stock) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", id); m.put("code", code); m.put("name", "วัตถุดิบ " + code); m.put("type", "เม็ดพลาสติก"); m.put("unit", "KG");
		m.put("stock", stock); m.put("min", 10); m.put("max", 100); m.put("cost", 5.5); m.put("active", true);
		return m;
	}

	static Map<String, Object> with(Map<String, Object> m, String k, Object v) {
		Map<String, Object> c = new HashMap<>(m);
		c.put(k, v);
		return c;
	}

	@Test @Order(1)
	void setup() throws Exception {
		String t = (String) call("POST", "/auth/login", Map.of("username", "admin", "password", "Init-Pass-123"), null, 200).get("token");
		call("POST", "/auth/change-password", Map.of("currentPassword", "Init-Pass-123", "newPassword", "New-Pass-456"), t, 200);
		admin = t;
		proc = newUser("proc1", "procurement");
		prod = newUser("prod1", "production");
		acct = newUser("acct1", "accounting");
		sales = newUser("sale1", "sales");
	}

	@Test @Order(2)
	void materialsCannotBeDeletedByAnyRole() throws Exception {
		call("POST", "/materials", mat("M-DEL", "DEL-001", 5), admin, 201);
		call("DELETE", "/materials/M-DEL", null, admin, 409);
		call("DELETE", "/materials/M-DEL", null, proc, 409);
		call("DELETE", "/materials/M-DEL", null, prod, 409);
		call("DELETE", "/materials/M-DEL", null, acct, 409);
		call("DELETE", "/materials/M-DEL", null, sales, 403); // ไม่ใช่ผู้เขียน materials
		call("DELETE", "/materials/NOPE", null, admin, 409);
		call("GET", "/materials/M-DEL", null, admin, 200); // ยังอยู่
		// ไม่กระทบ collection อื่น
		call("POST", "/finished", Map.of("id", "FG-DEL", "code", "FGDEL-1", "name", "x", "stock", 0), admin, 201);
		call("DELETE", "/finished/FG-DEL", null, admin, 200);
		call("POST", "/customers", Map.of("id", "C-DEL", "name", "x"), admin, 201);
		call("DELETE", "/customers/C-DEL", null, admin, 200);
	}

	@Test @Order(3)
	void fieldRulesByRole() throws Exception {
		Map<String, Object> base = mat("M-A", "PP-001", 10);
		call("POST", "/materials", base, prod, 403);  // production สร้างวัตถุดิบไม่ได้
		call("POST", "/materials", base, acct, 403);
		call("POST", "/materials", base, sales, 403);
		call("POST", "/materials", base, proc, 201);

		// production / accounting: แก้ได้เฉพาะ stock
		for (String t : List.of(prod, acct)) {
			Map<String, Object> cur = call("GET", "/materials/M-A", null, t, 200);
			double s = ((Number) cur.get("stock")).doubleValue();
			Map<String, Object> ok = new HashMap<>(cur);
			ok.put("stock", s - 1);
			assertEquals(s - 1, ((Number) call("PUT", "/materials/M-A", ok, t, 200).get("stock")).doubleValue());
			cur = call("GET", "/materials/M-A", null, t, 200);
			call("PUT", "/materials/M-A", with(cur, "cost", 99), t, 409);  // ต้นทุนแก้ตรงไม่ได้ทุก role
			call("PUT", "/materials/M-A", with(cur, "active", false), t, 403);
			call("PUT", "/materials/M-A", with(cur, "code", "OTHER"), t, 403);
			call("PUT", "/materials/M-A", with(cur, "name", "เปลี่ยนชื่อ"), t, 403);
			call("PATCH", "/materials/M-A", Map.of("stock", 7), t, 200);
			call("PATCH", "/materials/M-A", Map.of("stock", 6, "cost", 5.5), t, 200); // cost ไม่เปลี่ยน → ผ่าน
			call("PATCH", "/materials/M-A", Map.of("name", "x"), t, 403);
			call("PATCH", "/materials/M-A", Map.of("active", false), t, 403);
		}
		assertEquals("วัตถุดิบ PP-001", call("GET", "/materials/M-A", null, admin, 200).get("name"));

		// admin / procurement: แก้ทะเบียนได้
		Map<String, Object> cur = call("GET", "/materials/M-A", null, proc, 200);
		Map<String, Object> edited = new HashMap<>(cur);
		edited.put("name", "แก้โดยจัดซื้อ"); edited.put("active", false);
		Map<String, Object> saved = call("PUT", "/materials/M-A", edited, proc, 200);
		assertEquals(false, saved.get("active"));
		call("PATCH", "/materials/M-A", Map.of("active", true, "max", 500), admin, 200);

		// เวอร์ชันเก่า → 409 (ไม่ใช่ 403) แม้ฟิลด์ทะเบียนที่ส่งมาจะเป็นค่าเก่า
		Map<String, Object> stale = call("GET", "/materials/M-A", null, prod, 200);
		call("PATCH", "/materials/M-A", Map.of("max", 501), admin, 200);
		call("PUT", "/materials/M-A", with(stale, "stock", 1), prod, 409);
	}

	@Test @Order(4)
	void duplicateCodesAreRejected() throws Exception {
		call("POST", "/finished", Map.of("id", "FG-X", "code", "FG-X1", "name", "สินค้า", "stock", 0), admin, 201);
		// วัตถุดิบ ซ้ำ FG (ไม่สนตัวพิมพ์/ช่องว่าง)
		call("POST", "/materials", mat("M-1", "fg-x1", 0), admin, 409);
		call("POST", "/materials", mat("M-2", "  fg -x1 ", 0), admin, 409);
		call("POST", "/materials", mat("fg-x", "NEWCODE", 0), admin, 409); // id ชน id ของ FG (FG-X ต่างตัวพิมพ์: "fg-x" vs "FG-X")
		// วัตถุดิบ ซ้ำวัตถุดิบ
		call("POST", "/materials", mat("M-3", "pp-001", 0), proc, 409);
		call("POST", "/materials", mat("M-4", "P P - 0 0 1", 0), proc, 409);
		call("POST", "/materials", mat("pp-001", "ANY-1", 0), proc, 409); // id ต่างตัวพิมพ์ชน code ที่มีอยู่
		// FG ซ้ำวัตถุดิบ
		call("POST", "/finished", Map.of("id", "FG-Y", "code", "pp-001", "name", "x", "stock", 0), sales, 409);
		call("POST", "/finished", Map.of("id", "FG-Z", "code", "m-a", "name", "x", "stock", 0), sales, 409); // ชน id ของวัตถุดิบ M-A
		// id ซ้ำตรง ๆ ยังคงเป็น 409 เหมือนเดิม
		call("POST", "/materials", mat("M-A", "BRAND-NEW", 0), admin, 409);

		// แก้รหัสไปชนของอื่น → 409 ; แก้เป็นรหัสว่าง → ผ่าน
		Map<String, Object> cur = call("GET", "/materials/M-A", null, admin, 200);
		call("PUT", "/materials/M-A", with(cur, "code", "fg -x1"), admin, 409);
		call("PATCH", "/materials/M-A", Map.of("code", "FG-X1"), admin, 409);
		call("PATCH", "/materials/M-A", Map.of("code", "pp-001"), admin, 200); // รหัสเดิม (ต่างตัวพิมพ์) ของตัวเอง ไม่นับว่าซ้ำ
		call("PATCH", "/finished/FG-X", Map.of("code", "PP-001"), admin, 409);
		call("PATCH", "/finished/FG-X", Map.of("code", "FG-X2"), admin, 200);
		call("POST", "/materials", mat("M-5", "FG-X1", 0), admin, 201); // รหัสเดิมของ FG ถูกปล่อยแล้ว

		// ข้อมูลเดิมที่ซ้ำอยู่ (legacy) ต้องไม่ขวางการอัปเดตสต็อก
		jdbc.update("insert into erp_records(collection,id,data) values ('materials','LEG-1', ?::jsonb)", "{\"id\":\"LEG-1\",\"code\":\"LEGDUP\",\"name\":\"a\",\"stock\":3}");
		jdbc.update("insert into erp_records(collection,id,data) values ('finished','LEG-2', ?::jsonb)", "{\"id\":\"LEG-2\",\"code\":\"legdup\",\"name\":\"b\",\"stock\":3}");
		Map<String, Object> leg = call("GET", "/materials/LEG-1", null, prod, 200);
		assertEquals(2.0, ((Number) call("PUT", "/materials/LEG-1", with(leg, "stock", 2), prod, 200).get("stock")).doubleValue());
		call("PATCH", "/finished/LEG-2", Map.of("stock", 1), sales, 200);
	}

	@Test @Order(5)
	void concurrentCreatesOfSameCodeYieldSingleWinner() throws Exception {
		List<CompletableFuture<Integer>> fs = new ArrayList<>();
		for (int i = 0; i < 12; i++) {
			boolean fg = i % 2 == 0;
			Map<String, Object> body = fg ? Map.of("id", "CF-" + i, "code", "CONC-1", "name", "x", "stock", 0) : mat("CM-" + i, "conc-1", 0);
			HttpRequest rq = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/" + (fg ? "finished" : "materials")))
				.header("Content-Type", "application/json").header("Authorization", "Bearer " + admin)
				.POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body))).build();
			fs.add(http.sendAsync(rq, HttpResponse.BodyHandlers.ofString()).thenApply(HttpResponse::statusCode));
		}
		int created = 0, conflict = 0;
		for (CompletableFuture<Integer> f : fs) {
			int sc = f.get();
			if (sc == 201) created++; else if (sc == 409) conflict++;
		}
		assertEquals(1, created, "ต้องสร้างสำเร็จเพียง 1 รายการ");
		assertEquals(11, conflict);
		Integer n = jdbc.queryForObject("select count(*) from erp_records where collection in ('materials','finished') and upper(data->>'code') = 'CONC-1'", Integer.class);
		assertEquals(1, n);
		assertNotNull(n);
	}
}
