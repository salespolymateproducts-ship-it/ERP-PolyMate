package com.backend.erp;

import static org.junit.jupiter.api.Assertions.assertEquals;

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
 * Phase Supplier Management: ห้ามลบ suppliers, สิทธิ์ตาม role, รหัสซ้ำ (ไม่สนตัวพิมพ์/ช่องว่าง) + advisory lock,
 * ล็อกรหัสเมื่อมี PO อ้างอิง — แยกคลาสเพื่อให้มี context (และตัวจำกัดจำนวนครั้ง login) ของตัวเอง
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "erp.admin.initial-password=Init-Pass-123")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class SupplierRulesTests {
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

	static Map<String, Object> sup(String id, String code) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", id); m.put("code", code); m.put("name", "ผู้ขาย " + code); m.put("taxId", "0105500000001");
		m.put("contact", "คุณทดสอบ"); m.put("phone", "02-000-0000"); m.put("email", "t@example.test");
		m.put("category", "เม็ดพลาสติก"); m.put("credit", 30); m.put("address", "กรุงเทพ"); m.put("status", "active");
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
	void suppliersCannotBeDeletedByAnyRole() throws Exception {
		call("POST", "/suppliers", sup("S-DEL", "DEL-1"), admin, 201);
		call("DELETE", "/suppliers/S-DEL", null, admin, 409);
		call("DELETE", "/suppliers/S-DEL", null, proc, 409);
		call("DELETE", "/suppliers/S-DEL", null, prod, 403);
		call("DELETE", "/suppliers/S-DEL", null, acct, 403);
		call("DELETE", "/suppliers/S-DEL", null, sales, 403);
		call("DELETE", "/suppliers/NOPE", null, admin, 409);
		call("GET", "/suppliers/S-DEL", null, admin, 200); // ยังอยู่
		// collection อื่นไม่ถูกกระทบ
		call("POST", "/customers", Map.of("id", "C-SDEL", "name", "x"), admin, 201);
		call("DELETE", "/customers/C-SDEL", null, admin, 200);
	}

	@Test @Order(3)
	void onlyAdminAndProcurementCanWrite() throws Exception {
		for (String t : List.of(prod, acct, sales)) {
			call("POST", "/suppliers", sup("S-X" + t.hashCode(), "NOPE-" + Math.abs(t.hashCode())), t, 403);
		}
		call("POST", "/suppliers", sup("S-P1", "PROC-1"), proc, 201);
		call("POST", "/suppliers", sup("S-A1", "ADM-1"), admin, 201);
		Map<String, Object> cur = call("GET", "/suppliers/S-P1", null, admin, 200);
		for (String t : List.of(prod, acct, sales)) {
			call("PUT", "/suppliers/S-P1", with(cur, "name", "hack"), t, 403);
			call("PATCH", "/suppliers/S-P1", Map.of("name", "hack"), t, 403);
			call("GET", "/suppliers/S-P1", null, t, 200); // อ่านได้ตามเดิม
		}
		call("PUT", "/suppliers/S-P1", with(cur, "name", "ชื่อใหม่ (admin)"), admin, 200);
		cur = call("GET", "/suppliers/S-P1", null, proc, 200);
		call("PUT", "/suppliers/S-P1", with(cur, "contact", "คุณใหม่"), proc, 200);
		call("PATCH", "/suppliers/S-P1", Map.of("status", "inactive"), proc, 200);
		call("PATCH", "/suppliers/S-P1", Map.of("status", "active"), admin, 200);
		assertEquals("active", call("GET", "/suppliers/S-P1", null, proc, 200).get("status"));
	}

	@Test @Order(4)
	void duplicateCodesAreRejected() throws Exception {
		call("POST", "/suppliers", sup("S-D1", "ABC-1"), admin, 201);
		call("POST", "/suppliers", sup("S-D2", "abc-1"), admin, 409);        // ตัวพิมพ์ต่าง
		call("POST", "/suppliers", sup("S-D3", "  a b c-1 "), proc, 409);    // ช่องว่างต่าง
		call("POST", "/suppliers", sup("S-D1", "BRAND-NEW"), admin, 409);    // id ซ้ำตรง ๆ
		// เลขผู้เสียภาษีซ้ำต้องไม่ถูกบล็อก (หลายสาขา)
		call("POST", "/suppliers", sup("S-D4", "ABC-2"), admin, 201);
		assertEquals("0105500000001", call("GET", "/suppliers/S-D4", null, admin, 200).get("taxId"));

		Map<String, Object> d4 = call("GET", "/suppliers/S-D4", null, admin, 200);
		call("PUT", "/suppliers/S-D4", with(d4, "code", "abc-1"), admin, 409);
		call("PATCH", "/suppliers/S-D4", Map.of("code", " Abc -1"), admin, 409);
		call("PATCH", "/suppliers/S-D4", Map.of("code", "ABC-2"), admin, 200);  // รหัสเดิมของตัวเอง
		call("PATCH", "/suppliers/S-D4", Map.of("code", "abc-2"), admin, 200);  // ต่างตัวพิมพ์ของตัวเอง ไม่นับว่าซ้ำ
		call("PATCH", "/suppliers/S-D4", Map.of("code", "ABC-3"), admin, 200);  // รหัสว่างจริง ๆ ผ่านได้
		call("POST", "/suppliers", sup("S-D5", "abc-2"), admin, 201);           // รหัสเดิมถูกปล่อยแล้ว

		// ข้อมูลเดิมที่ซ้ำอยู่ (legacy) ต้องไม่ขวางการแก้ไขอื่น (ชื่อ/ติดต่อ)
		jdbc.update("insert into erp_records(collection,id,data) values ('suppliers','LEG-1', ?::jsonb)", "{\"id\":\"LEG-1\",\"code\":\"LEGDUP\",\"name\":\"a\",\"status\":\"active\"}");
		jdbc.update("insert into erp_records(collection,id,data) values ('suppliers','LEG-2', ?::jsonb)", "{\"id\":\"LEG-2\",\"code\":\"legdup\",\"name\":\"b\",\"status\":\"active\"}");
		Map<String, Object> leg = call("GET", "/suppliers/LEG-1", null, proc, 200);
		call("PUT", "/suppliers/LEG-1", with(leg, "name", "a2"), proc, 200);
		call("PATCH", "/suppliers/LEG-2", Map.of("contact", "x"), admin, 200);
	}

	@Test @Order(5)
	void codeIsLockedOnceReferencedByPurchaseOrder() throws Exception {
		call("POST", "/suppliers", sup("S-L1", "LOCK-1"), proc, 201);
		// ยังไม่มี PO → เปลี่ยนรหัสได้
		call("PATCH", "/suppliers/S-L1", Map.of("code", "LOCK-1B"), proc, 200);
		call("PATCH", "/suppliers/S-L1", Map.of("code", "LOCK-1"), proc, 200);
		call("POST", "/purchaseOrders", Map.of("id", "PO-LOCK-1", "supplier", "LOCK-1", "supplierName", "ผู้ขาย LOCK-1", "total", 100, "status", "pending"), proc, 201);

		Map<String, Object> cur = call("GET", "/suppliers/S-L1", null, proc, 200);
		call("PUT", "/suppliers/S-L1", with(cur, "code", "LOCK-2"), proc, 409);
		call("PUT", "/suppliers/S-L1", with(cur, "code", "LOCK-2"), admin, 409);
		call("PATCH", "/suppliers/S-L1", Map.of("code", "LOCK-2"), proc, 409);
		call("PATCH", "/suppliers/S-L1", Map.of("code", "LOCK-2"), admin, 409);
		assertEquals("LOCK-1", call("GET", "/suppliers/S-L1", null, admin, 200).get("code"));

		// ชื่อ / ข้อมูลติดต่อ / สถานะ ยังแก้ได้
		call("PUT", "/suppliers/S-L1", with(cur, "name", "ชื่อใหม่"), proc, 200);
		call("PATCH", "/suppliers/S-L1", Map.of("phone", "099-999-9999", "email", "n@example.test", "credit", 45), proc, 200);
		call("PATCH", "/suppliers/S-L1", Map.of("status", "inactive"), admin, 200);
		// ส่งรหัสเดิมซ้ำ (ต่างตัวพิมพ์/ช่องว่าง) ไม่นับว่าเปลี่ยนรหัส
		call("PATCH", "/suppliers/S-L1", Map.of("code", " lock-1 "), proc, 200);
		// PO เดิมไม่เปลี่ยน
		assertEquals("LOCK-1", call("GET", "/purchaseOrders/PO-LOCK-1", null, admin, 200).get("supplier"));
		// Supplier ที่ไม่มี PO อ้างอิงยังเปลี่ยนรหัสได้
		call("PATCH", "/suppliers/S-D4", Map.of("code", "FREE-CODE"), proc, 200);
	}

	@Test @Order(6)
	void concurrentCreatesOfSameCodeYieldSingleWinner() throws Exception {
		List<CompletableFuture<Integer>> fs = new ArrayList<>();
		for (int i = 0; i < 12; i++) {
			Map<String, Object> body = sup("CS-" + i, i % 2 == 0 ? "CONC-1" : " conc-1 ");
			HttpRequest rq = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/suppliers"))
				.header("Content-Type", "application/json").header("Authorization", "Bearer " + (i % 3 == 0 ? admin : proc))
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
		Integer n = jdbc.queryForObject("select count(*) from erp_records where collection = 'suppliers' and upper(replace(data->>'code',' ','')) = 'CONC-1'", Integer.class);
		assertEquals(1, n);
	}
}
