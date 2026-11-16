package com.backend.erp.data;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.backend.erp.auth.AuthUser;
import com.backend.erp.common.ApiException;
import com.backend.erp.common.Json;

/** CRUD ทั่วไปของทุก collection พร้อม audit, optimistic lock และสิทธิ์ตาม role */
@Service
public class RecordService {
	/** role ที่แก้ทะเบียนวัตถุดิบได้ (role อื่นที่เขียน materials ได้ แก้ได้เฉพาะ stock) */
	private static final Set<String> MATERIAL_MASTER_ROLES = Set.of("admin", "procurement");
	/** ล็อกต่อธุรกรรม กันสร้าง/แก้รหัสสินค้า-วัตถุดิบซ้ำพร้อมกัน */
	private static final String STOCK_CODE_LOCK = "erp.stockcode";
	/** ล็อกต่อธุรกรรม กันสร้าง/แก้รหัส Supplier ซ้ำพร้อมกัน */
	private static final String SUPPLIER_CODE_LOCK = "erp.suppliercode";

	private final RecordRepository repo;
	private final AuditService audit;
	private final CounterService counters;
	private final Json json;
	private final JdbcTemplate jdbc;

	public RecordService(RecordRepository repo, AuditService audit, CounterService counters, Json json, JdbcTemplate jdbc) {
		this.repo = repo;
		this.audit = audit;
		this.counters = counters;
		this.json = json;
		this.jdbc = jdbc;
	}

	public static Collections.Def def(String coll) {
		Collections.Def d = Collections.get(coll);
		if (d == null) throw ApiException.notFound("ไม่พบ collection " + coll);
		return d;
	}

	public static void requireWrite(AuthUser u, Collections.Def d) {
		if (!d.writers().contains(u.role())) throw ApiException.forbidden("บทบาท " + u.role() + " ไม่มีสิทธิ์แก้ไข" + d.label());
	}

	public List<String> list(String coll, String q, int limit, int offset) {
		def(coll);
		return repo.list(coll, q, Math.max(1, Math.min(limit, 5000)), Math.max(0, offset));
	}

	public String get(String coll, String id) {
		def(coll);
		return repo.get(coll, id).orElseThrow(() -> ApiException.notFound("ไม่พบข้อมูล " + id));
	}

	private static Integer versionOf(Map<String, Object> body) {
		Object v = body.remove("_version");
		return v instanceof Number n ? n.intValue() : null;
	}

	// ---------- กติกาของทะเบียนวัตถุดิบ / รหัสสินค้า ----------
	private static boolean isStockColl(String coll) { return "materials".equals(coll) || "finished".equals(coll); }

	private static boolean isMaterialMaster(AuthUser u) { return MATERIAL_MASTER_ROLES.contains(u.role()); }

	/** รหัสเทียบแบบไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่าง */
	private static String normKey(Object v) {
		return v == null ? "" : String.valueOf(v).replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
	}

	@SuppressWarnings("unchecked")
	private static boolean same(Object a, Object b) {
		if (a instanceof Number x && b instanceof Number y) return Double.compare(x.doubleValue(), y.doubleValue()) == 0;
		if (a instanceof Map<?, ?> m1 && b instanceof Map<?, ?> m2) {
			if (m1.size() != m2.size()) return false;
			for (Map.Entry<?, ?> e : ((Map<Object, Object>) m1).entrySet()) {
				if (!m2.containsKey(e.getKey()) || !same(e.getValue(), m2.get(e.getKey()))) return false;
			}
			return true;
		}
		if (a instanceof List<?> l1 && b instanceof List<?> l2) {
			if (l1.size() != l2.size()) return false;
			for (int i = 0; i < l1.size(); i++) if (!same(l1.get(i), l2.get(i))) return false;
			return true;
		}
		return Objects.equals(a, b);
	}

	private static ApiException onlyStockAllowed(AuthUser u) {
		return ApiException.forbidden("บทบาท " + u.role() + " แก้ไขได้เฉพาะยอดคงเหลือ (stock) ของวัตถุดิบ — ข้อมูลทะเบียนวัตถุดิบแก้ได้เฉพาะผู้ดูแลระบบและฝ่ายจัดซื้อ");
	}

	/** รหัส (code) และ id ต้องไม่ซ้ำกันทั้งระหว่างวัตถุดิบและสินค้าสำเร็จรูป — เรียกภายในธุรกรรมเท่านั้น */
	private void assertUniqueStockCode(String coll, String id, Map<String, Object> rec) {
		List<String> keys = new ArrayList<>();
		String kc = normKey(rec.get("code"));
		String ki = normKey(id);
		if (!kc.isEmpty()) keys.add(kc);
		if (!ki.isEmpty() && !keys.contains(ki)) keys.add(ki);
		if (keys.isEmpty()) return;
		// serialize ผู้ตรวจ/ผู้เขียนรหัสทั้งหมด ล็อกปล่อยอัตโนมัติเมื่อจบธุรกรรม
		jdbc.queryForObject("select pg_advisory_xact_lock(hashtext(?))::text", String.class, STOCK_CODE_LOCK);
		String marks = String.join(",", java.util.Collections.nCopies(keys.size(), "?"));
		String idExpr = "upper(regexp_replace(id, '\\s', '', 'g'))";
		String codeExpr = "upper(regexp_replace(coalesce(data->>'code', ''), '\\s', '', 'g'))";
		List<Object> args = new ArrayList<>(keys);
		args.addAll(keys);
		List<Map<String, Object>> rows = jdbc.queryForList(
			"select collection, id from erp_records where collection in ('materials','finished') and (" + idExpr + " in (" + marks + ") or " + codeExpr + " in (" + marks + "))",
			args.toArray());
		for (Map<String, Object> r : rows) {
			String rc = String.valueOf(r.get("collection")), rid = String.valueOf(r.get("id"));
			if (rc.equals(coll) && rid.equals(id)) continue;
			String what = "materials".equals(rc) ? "วัตถุดิบ" : "สินค้าสำเร็จรูป";
			throw ApiException.conflict("DUPLICATE_CODE", "รหัส " + (kc.isEmpty() ? id : String.valueOf(rec.get("code")).trim()) + " ซ้ำกับ" + what + " " + rid);
		}
	}

	private static boolean isSupplier(String coll) { return "suppliers".equals(coll); }

	/** รหัส Supplier ต้องไม่ซ้ำกับ Supplier อื่น (ไม่สนตัวพิมพ์/ช่องว่าง) — เรียกภายในธุรกรรมเท่านั้น */
	private void assertUniqueSupplierCode(String id, Map<String, Object> rec) {
		String kc = normKey(rec.get("code"));
		if (kc.isEmpty()) return;
		jdbc.queryForObject("select pg_advisory_xact_lock(hashtext(?))::text", String.class, SUPPLIER_CODE_LOCK);
		List<Map<String, Object>> rows = jdbc.queryForList(
			"select id from erp_records where collection = 'suppliers' and id <> ? and upper(regexp_replace(coalesce(data->>'code', ''), '\\s', '', 'g')) = ?",
			id, kc);
		if (!rows.isEmpty()) {
			throw ApiException.conflict("DUPLICATE_CODE", "รหัส Supplier " + String.valueOf(rec.get("code")).trim() + " ซ้ำกับ Supplier " + rows.get(0).get("id"));
		}
	}

	/** รหัส Supplier ที่มี PO อ้างอิงแล้ว ห้ามเปลี่ยน */
	private void assertSupplierCodeNotReferenced(Object oldCode) {
		String k = normKey(oldCode);
		if (k.isEmpty()) return;
		Integer n = jdbc.queryForObject(
			"select count(*)::int from erp_records where collection = 'purchaseOrders' and upper(regexp_replace(coalesce(data->>'supplier', ''), '\\s', '', 'g')) = ?",
			Integer.class, k);
		if (n != null && n > 0) {
			throw ApiException.conflict("CODE_LOCKED", "รหัส Supplier ถูกอ้างอิงในใบสั่งซื้อแล้ว (" + n + " ใบ) ไม่สามารถเปลี่ยนรหัสได้");
		}
	}

	@Transactional
	public String create(AuthUser u, String coll, Map<String, Object> body) {
		Collections.Def d = def(coll);
		requireWrite(u, d);
		if ("materials".equals(coll) && !isMaterialMaster(u)) throw onlyStockAllowed(u);
		body.remove("_version");
		Object idv = body.get("id") != null ? body.get("id") : body.get("code");
		String id = idv == null || String.valueOf(idv).isBlank() ? UUID.randomUUID().toString().substring(0, 12) : String.valueOf(idv);
		body.put("id", id);
		if (isStockColl(coll)) assertUniqueStockCode(coll, id, body);
		if (isSupplier(coll)) assertUniqueSupplierCode(id, body);
		try {
			repo.insert(coll, id, json.str(body), u.username());
		} catch (DuplicateKeyException e) {
			throw ApiException.conflict("DUPLICATE", "มีรหัส " + id + " อยู่แล้ว");
		}
		audit.log(u, "CREATE", d.label(), id, "");
		return repo.get(coll, id).orElseThrow();
	}

	@Transactional
	public String replace(AuthUser u, String coll, String id, Map<String, Object> body) {
		Collections.Def d = def(coll);
		requireWrite(u, d);
		Integer expected = versionOf(body);
		body.put("id", id);
		if (isSupplier(coll)) {
			Optional<String> curS = repo.getForUpdate(coll, id);
			if (curS.isPresent()) {
				Map<String, Object> cur = json.map(curS.get());
				Integer curVer = cur.get("_version") instanceof Number n ? n.intValue() : null;
				if (expected != null && curVer != null && !expected.equals(curVer)) {
					throw ApiException.conflict("VERSION_CONFLICT", "ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดใหม่");
				}
				// เปลี่ยนรหัสจริงเท่านั้นที่ถูกตรวจ (ข้อมูลเดิมที่ซ้ำอยู่ไม่ขวางการแก้ไขอื่น)
				if (!normKey(cur.get("code")).equals(normKey(body.get("code")))) {
					assertSupplierCodeNotReferenced(cur.get("code"));
					assertUniqueSupplierCode(id, body);
				}
			}
		}
		if (isStockColl(coll)) {
			Optional<String> curS = repo.getForUpdate(coll, id);
			if (curS.isPresent()) {
				Map<String, Object> cur = json.map(curS.get());
				Integer curVer = cur.get("_version") instanceof Number n ? n.intValue() : null;
				if (expected != null && curVer != null && !expected.equals(curVer)) {
					throw ApiException.conflict("VERSION_CONFLICT", "ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดใหม่");
				}
				if ("materials".equals(coll) && !isMaterialMaster(u)) {
					Set<String> keys = new HashSet<>(cur.keySet());
					keys.addAll(body.keySet());
					for (String k : keys) {
						if (k.equals("stock") || k.equals("_version") || k.equals("id")) continue;
						if (!same(cur.get(k), body.get(k))) throw onlyStockAllowed(u);
					}
				}
				// ตรวจซ้ำเฉพาะเมื่อรหัสเปลี่ยนจริง (ไม่ให้ข้อมูลเดิมที่ซ้ำอยู่ขวางการอัปเดตสต็อก)
				if (!normKey(cur.get("code")).equals(normKey(body.get("code")))) assertUniqueStockCode(coll, id, body);
			}
		}
		int n = repo.update(coll, id, json.str(body), expected, u.username());
		if (n == 0) throw missingOrConflict(coll, id);
		audit.log(u, "UPDATE", d.label(), id, "แก้ไขข้อมูล");
		return repo.get(coll, id).orElseThrow();
	}

	@Transactional
	public String patch(AuthUser u, String coll, String id, Map<String, Object> patch) {
		Collections.Def d = def(coll);
		requireWrite(u, d);
		Integer expected = versionOf(patch);
		Optional<String> cur = repo.getForUpdate(coll, id);
		if (cur.isEmpty()) throw ApiException.notFound("ไม่พบข้อมูล " + id);
		Map<String, Object> rec = json.map(cur.get());
		Integer curVer = rec.get("_version") instanceof Number n ? n.intValue() : null;
		if (expected != null && curVer != null && !expected.equals(curVer)) {
			throw ApiException.conflict("VERSION_CONFLICT", "ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดใหม่");
		}
		rec.remove("_version");
		patch.remove("id");
		if ("materials".equals(coll) && !isMaterialMaster(u)) {
			for (Map.Entry<String, Object> e : patch.entrySet()) {
				if (!e.getKey().equals("stock") && !same(rec.get(e.getKey()), e.getValue())) throw onlyStockAllowed(u);
			}
		}
		Object oldCodeRaw = rec.get("code");
		String oldCode = normKey(oldCodeRaw);
		java.util.List<String> changed = new java.util.ArrayList<>();
		patch.forEach((k, v) -> {
			if (!java.util.Objects.equals(rec.get(k), v)) changed.add(k);
			rec.put(k, v);
		});
		if (isStockColl(coll) && !normKey(rec.get("code")).equals(oldCode)) assertUniqueStockCode(coll, id, rec);
		if (isSupplier(coll) && !normKey(rec.get("code")).equals(oldCode)) {
			assertSupplierCodeNotReferenced(oldCodeRaw);
			assertUniqueSupplierCode(id, rec);
		}
		repo.update(coll, id, json.str(rec), null, u.username());
		if (!changed.isEmpty()) audit.log(u, "UPDATE", d.label(), id, "แก้ไข: " + String.join(", ", changed));
		return repo.get(coll, id).orElseThrow();
	}

	@Transactional
	public void delete(AuthUser u, String coll, String id) {
		Collections.Def d = def(coll);
		requireWrite(u, d);
		// วัตถุดิบห้ามลบผ่าน API ทุก role (รวม admin) — ใช้ปิดใช้งาน (active=false) แทน
		if ("materials".equals(coll)) {
			throw ApiException.conflict("DELETE_NOT_ALLOWED", "ไม่อนุญาตให้ลบวัตถุดิบ — กรุณาปิดใช้งาน (active=false) แทน");
		}
		// Supplier ห้ามลบผ่าน API ทุก role — ใช้ status = inactive แทน
		if (isSupplier(coll)) {
			throw ApiException.conflict("DELETE_NOT_ALLOWED", "ไม่อนุญาตให้ลบ Supplier — กรุณาปิดใช้งาน (status = inactive) แทน");
		}
		Optional<String> cur = repo.getForUpdate(coll, id);
		if (cur.isEmpty()) throw ApiException.notFound("ไม่พบข้อมูล " + id);
		Map<String, Object> rec = json.map(cur.get());
		repo.delete(coll, id);
		if (rec.get("counterKey") instanceof String ck && rec.get("seq") instanceof Number sq) {
			counters.releaseIfLast(ck, sq.intValue());
		}
		audit.log(u, "DELETE", d.label(), id, "");
	}

	private ApiException missingOrConflict(String coll, String id) {
		return repo.get(coll, id).isPresent()
			? ApiException.conflict("VERSION_CONFLICT", "ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดใหม่")
			: ApiException.notFound("ไม่พบข้อมูล " + id);
	}
}
