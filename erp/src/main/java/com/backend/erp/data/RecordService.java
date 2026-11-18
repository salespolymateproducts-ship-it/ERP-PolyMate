package com.backend.erp.data;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
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
	private final BomService boms;
	private final MachineService machines;

	public RecordService(RecordRepository repo, AuditService audit, CounterService counters, Json json, JdbcTemplate jdbc, BomService boms, MachineService machines) {
		this.boms = boms;
		this.machines = machines;
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

	/** ต้นทุนวัตถุดิบ (cost / costHistory) เกิดจากการรับ PO หรือการปรับโดย admin ผ่าน action เท่านั้น — PUT/PATCH แก้ตรงไม่ได้ทุก role */
	private static final Set<String> MATERIAL_COST_KEYS = Set.of("cost", "costHistory");

	private static ApiException costManaged() {
		return ApiException.conflict("COST_MANAGED", "ต้นทุนวัตถุดิบแก้ตรงไม่ได้ — ระบบคำนวณจากการรับ PO (admin ปรับฉุกเฉินได้ที่ปุ่ม ปรับต้นทุน พร้อมเหตุผล)");
	}

	private static void assertMaterialCostUntouched(Map<String, Object> cur, Map<String, Object> next) {
		for (String k : MATERIAL_COST_KEYS) {
			if (!same(cur.get(k), next.get(k))) throw costManaged();
		}
	}

	/** วัตถุดิบใหม่: cost ที่ส่งมาคือต้นทุนยกมา (ไม่ติดลบ) ประวัติต้นทุนเริ่มต้นสร้างโดย server เอง */
	private static void initMaterialCost(AuthUser u, Map<String, Object> m) {
		double c = Math.max(0d, Json.num(m.get("cost")));
		m.put("cost", c);
		List<Object> hist = new ArrayList<>();
		if (c > 0) {
			Map<String, Object> he = new LinkedHashMap<>();
			he.put("date", nowStr().substring(0, 10));
			he.put("cost", c);
			he.put("by", u.fullName());
			he.put("note", "ต้นทุนยกมา");
			hist.add(he);
		}
		m.put("costHistory", hist);
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

	// ---------- สินค้าซื้อมาขายไป / สินค้าที่ซื้อได้ ----------
	/** สินค้าที่ออก PO ซื้อได้: ประเภทซื้อมาขายไป หรือเปิดธง buyable (เช่น สินค้า OEM ที่จ้างผู้อื่นผลิต) */
	private static boolean isBuyable(Map<String, Object> f) {
		return Boolean.TRUE.equals(f.get("buyable")) || "trade".equals(Json.s(f.get("jobType")));
	}

	/** ฟิลด์สำหรับการสั่งซื้อซ้ำ: จุดสั่งซื้อ (min) และระยะเวลาสั่งของ (leadDays) ต้องไม่ติดลบ */
	private static void validateProductExtras(Map<String, Object> f) {
		for (String k : List.of("min", "leadDays")) {
			Object v = f.get(k);
			if (v == null || (v instanceof String s && s.isBlank())) { f.remove(k); continue; }
			if (!(v instanceof Number n) || !(n.doubleValue() >= 0) || Double.isInfinite(n.doubleValue())) {
				throw ApiException.badRequest(("min".equals(k) ? "จุดสั่งซื้อ (Min)" : "ระยะเวลาสั่งของ (วัน)") + " ต้องเป็นตัวเลขไม่ติดลบ");
			}
		}
	}

	// ---------- กติกาของใบสั่งซื้อ (PO) ----------
	private static boolean isPO(String coll) { return "purchaseOrders".equals(coll); }

	private static final Set<String> PO_CREATE_STATUS = Set.of("draft", "pending");
	private static final Map<String, Set<String>> PO_TRANSITIONS = Map.of(
		"draft", Set.of("draft", "pending", "approved", "cancelled"),
		"pending", Set.of("pending", "draft", "approved", "cancelled"),
		"approved", Set.of("approved", "cancelled"));
	private static final Set<String> PO_FROZEN_WHEN_APPROVED = Set.of("supplier", "lines", "subtotal", "vat", "total", "whtRate");

	private static double r2(double v) { return Math.round(v * 100d) / 100d; }

	private static String nowStr() { return LocalDateTime.now(ZoneId.of("Asia/Bangkok")).format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")); }

	/** Supplier ต้องมีในทะเบียนและยังใช้งาน (เทียบด้วยรหัส Supplier ที่ PO เก็บไว้) */
	private void assertSupplierUsable(Object code) {
		String k = normKey(code);
		if (k.isEmpty()) throw ApiException.badRequest("ต้องระบุ Supplier ในใบสั่งซื้อ");
		List<Map<String, Object>> rows = jdbc.queryForList(
			"select data->>'status' as st from erp_records where collection = 'suppliers' and upper(regexp_replace(coalesce(data->>'code', ''), '\\s', '', 'g')) = ?", k);
		if (rows.isEmpty()) throw ApiException.badRequest("ไม่พบ Supplier รหัส " + String.valueOf(code).trim() + " ในทะเบียน");
		if ("inactive".equals(rows.get(0).get("st"))) throw ApiException.badRequest("Supplier " + String.valueOf(code).trim() + " ปิดใช้งานแล้ว ออก PO ใหม่ไม่ได้");
	}

	/** ตรวจรายการสั่งซื้อทุกบรรทัด + คำนวณยอดเงินใหม่ฝั่ง server (ไม่เชื่อค่าจาก client) */
	private void validatePOLinesAndTotals(Map<String, Object> po) {
		if (!(po.get("lines") instanceof List<?> raw) || raw.isEmpty()) throw ApiException.badRequest("ใบสั่งซื้อต้องมีรายการอย่างน้อย 1 รายการ");
		List<Object> out = new ArrayList<>();
		Set<String> seen = new HashSet<>();
		double subtotal = 0;
		int i = 0;
		for (Object o : raw) {
			i++;
			if (!(o instanceof Map<?, ?> lm)) throw ApiException.badRequest("รายการที่ " + i + " ไม่ถูกต้อง");
			@SuppressWarnings("unchecked") Map<String, Object> line = new LinkedHashMap<>((Map<String, Object>) lm);
			// รายการบริการ/จ้างทำของ (เช่น ซ่อมแม่พิมพ์ ค่าขนส่ง): ไม่เข้าสต๊อก — ต้องมีรายละเอียด จำนวน และราคา; ลงเป็นค่าใช้จ่าย/เจ้าหนี้ตอนตรวจรับงาน
			if ("service".equals(Json.s(line.get("itemType")))) {
				String desc = Json.s(line.get("name")).trim();
				if (desc.isEmpty()) throw ApiException.badRequest("รายการที่ " + i + " (บริการ) ต้องระบุรายละเอียดงาน");
				if (desc.length() > 300) throw ApiException.badRequest("รายการที่ " + i + " รายละเอียดงานยาวเกิน 300 ตัวอักษร");
				double sq = Json.num(line.get("qty")), sp = Json.num(line.get("price"));
				if (!(sq > 0) || Double.isInfinite(sq)) throw ApiException.badRequest("รายการที่ " + i + " จำนวนต้องมากกว่า 0");
				if (!(sp > 0) || Double.isInfinite(sp)) throw ApiException.badRequest("รายการที่ " + i + " ราคาต่อหน่วยต้องมากกว่า 0");
				double samount = r2(sq * sp);
				line.remove("item");
				line.put("itemType", "service");
				line.put("name", desc);
				line.put("qty", sq);
				line.put("price", sp);
				line.put("amount", samount);
				if (line.get("unit") == null || String.valueOf(line.get("unit")).isBlank()) line.put("unit", "งาน");
				subtotal += samount;
				out.add(line);
				continue;
			}
			String item = line.get("item") == null ? "" : String.valueOf(line.get("item")).trim();
			if (item.isEmpty() || "custom".equals(item)) throw ApiException.badRequest("รายการที่ " + i + " ต้องเลือกวัตถุดิบหรือสินค้าจากทะเบียน (ไม่รองรับรายการพิมพ์เอง เพราะรับของเข้าสต๊อกไม่ได้)");
			boolean isProduct = "product".equals(Json.s(line.get("itemType")));
			Optional<String> ms = repo.get(isProduct ? "finished" : "materials", item);
			if (ms.isEmpty()) throw ApiException.badRequest("รายการที่ " + i + " ไม่พบ" + (isProduct ? "สินค้า " : "วัตถุดิบ ") + item + " ในทะเบียน");
			Map<String, Object> mat = json.map(ms.get());
			if (isProduct && !isBuyable(mat)) throw ApiException.badRequest("รายการที่ " + i + " สินค้า " + item + " ไม่ได้ตั้งเป็นสินค้าที่ซื้อได้ (ซื้อมาขายไป) — ตั้งค่า \"ซื้อได้\" ที่ทะเบียนสินค้าก่อน");
			if (Boolean.FALSE.equals(mat.get("active"))) throw ApiException.badRequest("รายการที่ " + i + (isProduct ? " สินค้า " : " วัตถุดิบ ") + item + " ปิดใช้งานแล้ว");
			if (!seen.add((isProduct ? "p:" : "m:") + item)) throw ApiException.badRequest((isProduct ? "สินค้า " : "วัตถุดิบ ") + item + " ซ้ำในใบสั่งซื้อเดียวกัน (รายการที่ " + i + ")");
			line.put("itemType", isProduct ? "product" : "material");
			double qty = Json.num(line.get("qty")), price = Json.num(line.get("price"));
			if (!(qty > 0) || Double.isInfinite(qty)) throw ApiException.badRequest("รายการที่ " + i + " จำนวนต้องมากกว่า 0");
			if (!(price > 0) || Double.isInfinite(price)) throw ApiException.badRequest("รายการที่ " + i + " ราคาต่อหน่วยต้องมากกว่า 0");
			double amount = r2(qty * price);
			line.put("item", item);
			line.put("qty", qty);
			line.put("price", price);
			line.put("amount", amount);
			if (line.get("name") == null || String.valueOf(line.get("name")).isBlank()) line.put("name", mat.get("name"));
			if (line.get("unit") == null || String.valueOf(line.get("unit")).isBlank()) line.put("unit", mat.get("unit"));
			subtotal += amount;
			out.add(line);
		}
		double sub = r2(subtotal), vat = r2(sub * 0.07);
		po.put("lines", out);
		po.put("items", out.size());
		po.put("subtotal", sub);
		po.put("vat", vat);
		po.put("total", r2(sub + vat));
	}

	private void validatePOCreate(Map<String, Object> po) {
		String st = po.get("status") == null ? "pending" : String.valueOf(po.get("status"));
		if (!PO_CREATE_STATUS.contains(st)) throw ApiException.badRequest("ใบสั่งซื้อใหม่ต้องเริ่มที่สถานะ ร่าง หรือ รออนุมัติ เท่านั้น");
		po.put("status", st);
		po.remove("approvedBy"); po.remove("approvedAt"); po.remove("receivedAt"); po.remove("receivedBy"); po.remove("cancel");
		assertSupplierUsable(po.get("supplier"));
		validatePOLinesAndTotals(po);
	}

	private static Map<String, Object> stripMeta(Map<String, Object> m) {
		Map<String, Object> c = new LinkedHashMap<>(m);
		c.remove("_version");
		return c;
	}

	/** กติกาตอนแก้ไข PO เดิม: cur = ค่าเดิมใน DB, next = ค่าที่จะบันทึก (แก้ค่าใน next ได้) */
	private void validatePOUpdate(AuthUser u, Map<String, Object> cur, Map<String, Object> next) {
		String oldSt = String.valueOf(cur.get("status")), newSt = next.get("status") == null ? oldSt : String.valueOf(next.get("status"));
		if ("received".equals(oldSt) || "cancelled".equals(oldSt)) {
			if (!same(stripMeta(cur), stripMeta(next))) {
				throw ApiException.conflict("PO_LOCKED", "ใบสั่งซื้อที่" + ("received".equals(oldSt) ? "รับของแล้ว" : "ยกเลิกแล้ว") + " แก้ไขไม่ได้");
			}
			return;
		}
		if ("received".equals(newSt)) throw ApiException.conflict("USE_RECEIVE_ACTION", "การรับของต้องทำผ่านปุ่มรับของ (เพิ่มสต๊อกและเปลี่ยนสถานะพร้อมกัน) ไม่สามารถตั้งสถานะรับแล้วโดยตรง");
		Set<String> allowed = PO_TRANSITIONS.get(oldSt);
		if (allowed == null || !allowed.contains(newSt)) throw ApiException.conflict("INVALID_TRANSITION", "เปลี่ยนสถานะ PO จาก " + oldSt + " เป็น " + newSt + " ไม่ได้");
		if ("approved".equals(oldSt)) {
			for (String k : PO_FROZEN_WHEN_APPROVED) {
				if (!same(cur.get(k), next.get(k))) throw ApiException.conflict("PO_LOCKED", "ใบสั่งซื้อที่อนุมัติแล้วแก้ไข Supplier/รายการ/ยอดเงินไม่ได้ (ต้องยกเลิกแล้วออกใหม่)");
			}
		} else {
			if (!normKey(cur.get("supplier")).equals(normKey(next.get("supplier")))) assertSupplierUsable(next.get("supplier"));
			if (!same(cur.get("lines"), next.get("lines"))) validatePOLinesAndTotals(next);
		}
		if ("approved".equals(newSt) && !"approved".equals(oldSt)) {
			next.put("approvedBy", u.fullName());
			next.put("approvedAt", nowStr());
		}
		if ("cancelled".equals(newSt)) {
			Object c = next.get("cancel");
			String reason = c instanceof Map<?, ?> cm && cm.get("reason") != null ? String.valueOf(cm.get("reason")).trim() : "";
			if (reason.isEmpty()) throw ApiException.badRequest("ต้องระบุเหตุผลการยกเลิกใบสั่งซื้อ");
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
		if ("materials".equals(coll)) initMaterialCost(u, body);
		if (isPO(coll)) validatePOCreate(body);
		if ("finished".equals(coll)) {
			validateProductExtras(body);
			if (isBuyable(body)) initMaterialCost(u, body); // ต้นทุนยกมา; หลังจากนี้ต้นทุนเกิดจากการรับ PO
		}
		if ("boms".equals(coll)) boms.prepare(u, id, body, null);
		if ("workOrders".equals(coll)) { boms.attachToNewWorkOrder(body); machines.assertUsable(body.get("machine")); }
		if ("machines".equals(coll)) machines.prepareCreate(u, id, body);
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
		if (isPO(coll)) {
			Optional<String> curS = repo.getForUpdate(coll, id);
			if (curS.isPresent()) {
				Map<String, Object> cur = json.map(curS.get());
				Integer curVer = cur.get("_version") instanceof Number n ? n.intValue() : null;
				if (expected != null && curVer != null && !expected.equals(curVer)) {
					throw ApiException.conflict("VERSION_CONFLICT", "ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดใหม่");
				}
				validatePOUpdate(u, cur, body);
			}
		}
		if ("boms".equals(coll) || "workOrders".equals(coll)) {
			Optional<String> curS = repo.getForUpdate(coll, id);
			if (curS.isPresent()) {
				Map<String, Object> cur = json.map(curS.get());
				Integer curVer = cur.get("_version") instanceof Number n ? n.intValue() : null;
				if (expected != null && curVer != null && !expected.equals(curVer)) {
					throw ApiException.conflict("VERSION_CONFLICT", "ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดใหม่");
				}
				if ("boms".equals(coll)) boms.prepare(u, id, body, cur);
				else {
					boms.keepWorkOrderBom(cur, body);
					if (!Json.s(cur.get("machine")).equals(Json.s(body.get("machine")))) machines.assertUsable(body.get("machine"));
				}
			}
		}
		if ("machines".equals(coll)) {
			Optional<String> curS = repo.getForUpdate(coll, id);
			if (curS.isPresent()) {
				Map<String, Object> cur = json.map(curS.get());
				Integer curVer = cur.get("_version") instanceof Number n ? n.intValue() : null;
				if (expected != null && curVer != null && !expected.equals(curVer)) {
					throw ApiException.conflict("VERSION_CONFLICT", "ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดใหม่");
				}
				machines.prepareUpdate(cur, body);
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
				if ("materials".equals(coll)) assertMaterialCostUntouched(cur, body);
				if ("finished".equals(coll)) {
					if (isBuyable(cur)) assertMaterialCostUntouched(cur, body);
					else if (isBuyable(body)) initMaterialCost(u, body);
					validateProductExtras(body);
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
		if ("materials".equals(coll)) {
			for (String k : MATERIAL_COST_KEYS) {
				if (patch.containsKey(k) && !same(rec.get(k), patch.get(k))) throw costManaged();
			}
		}
		if ("materials".equals(coll) && !isMaterialMaster(u)) {
			for (Map.Entry<String, Object> e : patch.entrySet()) {
				if (!e.getKey().equals("stock") && !same(rec.get(e.getKey()), e.getValue())) throw onlyStockAllowed(u);
			}
		}
		Map<String, Object> before = new LinkedHashMap<>(rec);
		Object oldCodeRaw = rec.get("code");
		String oldCode = normKey(oldCodeRaw);
		java.util.List<String> changed = new java.util.ArrayList<>();
		patch.forEach((k, v) -> {
			if (!java.util.Objects.equals(rec.get(k), v)) changed.add(k);
			rec.put(k, v);
		});
		if (isPO(coll)) validatePOUpdate(u, before, rec);
		if ("finished".equals(coll)) {
			if (isBuyable(before)) assertMaterialCostUntouched(before, rec);
			else if (isBuyable(rec)) initMaterialCost(u, rec);
			validateProductExtras(rec);
		}
		if ("boms".equals(coll)) boms.prepare(u, id, rec, before);
		if ("workOrders".equals(coll)) {
			boms.keepWorkOrderBom(before, rec);
			if (!Json.s(before.get("machine")).equals(Json.s(rec.get("machine")))) machines.assertUsable(rec.get("machine"));
		}
		if ("machines".equals(coll)) machines.prepareUpdate(before, rec);
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
		if ("boms".equals(coll)) {
			throw ApiException.conflict("DELETE_NOT_ALLOWED", "ไม่อนุญาตให้ลบ BOM — ใช้สถานะเลิกใช้ (inactive) แทน");
		}
		if ("machines".equals(coll)) {
			throw ApiException.conflict("DELETE_NOT_ALLOWED", "ไม่อนุญาตให้ลบเครื่องจักร — ตั้งสภาพเป็นเลิกใช้แทน");
		}
		Optional<String> cur = repo.getForUpdate(coll, id);
		if (cur.isEmpty()) throw ApiException.notFound("ไม่พบข้อมูล " + id);
		Map<String, Object> rec = json.map(cur.get());
		if (isPO(coll) && Set.of("approved", "received").contains(String.valueOf(rec.get("status")))) {
			throw ApiException.conflict("DELETE_NOT_ALLOWED", "ลบใบสั่งซื้อที่อนุมัติหรือรับของแล้วไม่ได้ — ใช้การยกเลิกแทน");
		}
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
