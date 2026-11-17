package com.backend.erp.data;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.backend.erp.auth.AuthUser;
import com.backend.erp.common.ApiException;
import com.backend.erp.common.Json;

/**
 * BOM หลายสูตรต่อสินค้า: ตรวจกฎ, คำนวณปริมาณต่อชิ้นจากสัดส่วน (%) และสร้าง snapshot ให้ใบสั่งผลิต
 * ชนิดบรรทัด: resin (กก./ชิ้น) · masterbatch / additive (กก./ชิ้น หรือ % ของน้ำหนักเม็ด) · regrind (% ของน้ำหนักเม็ด, เศษรีไซเคิลแทนเม็ดใหม่)
 */
@Service
public class BomService {
	static final Set<String> STATUSES = Set.of("draft", "active", "inactive");
	static final Set<String> TYPES = Set.of("resin", "masterbatch", "additive", "regrind");
	private static final Set<String> OPEN_WO = Set.of("queued", "setup", "running");
	private static final String BOM_LOCK = "erp.bom";

	private final RecordRepository repo;
	private final Json json;
	private final JdbcTemplate jdbc;

	public BomService(RecordRepository repo, Json json, JdbcTemplate jdbc) {
		this.repo = repo;
		this.json = json;
		this.jdbc = jdbc;
	}

	private static double r6(double v) { return Math.round(v * 1_000_000d) / 1_000_000d; }

	private static String nowStr() { return LocalDateTime.now(ZoneId.of("Asia/Bangkok")).format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")); }

	/** เทียบโครงสร้างข้อมูลโดยไม่สนลำดับคีย์/ชนิดตัวเลข (jsonb เรียงคีย์ใหม่) */
	private static String canon(Object o) {
		if (o instanceof Map<?, ?> m) {
			java.util.TreeMap<String, String> t = new java.util.TreeMap<>();
			m.forEach((k, v) -> t.put(String.valueOf(k), canon(v)));
			return t.toString();
		}
		if (o instanceof List<?> l) {
			StringBuilder sb = new StringBuilder("[");
			for (Object x : l) sb.append(canon(x)).append(",");
			return sb.append("]").toString();
		}
		if (o instanceof Number n) return String.valueOf(n.doubleValue());
		return String.valueOf(o);
	}

	private static boolean sameJson(Object a, Object b) { return canon(a).equals(canon(b)); }

	// ---------- คำนวณปริมาณต่อชิ้น ----------

	/** แปลงบรรทัด BOM (qty หรือ pct) เป็นปริมาณ กก./ชิ้น ที่ใช้จริง */
	@SuppressWarnings("unchecked")
	public static List<Map<String, Object>> resolveLines(Map<String, Object> bom) {
		List<Map<String, Object>> in = new ArrayList<>();
		if (bom.get("lines") instanceof List<?> l) for (Object o : l) if (o instanceof Map<?, ?> m) in.add((Map<String, Object>) m);
		double resinTotal = 0, regrindPct = 0;
		for (Map<String, Object> l : in) {
			if ("resin".equals(Json.s(l.get("type")))) resinTotal += Json.num(l.get("qty"));
			if ("regrind".equals(Json.s(l.get("type")))) regrindPct += Json.num(l.get("pct"));
		}
		List<Map<String, Object>> out = new ArrayList<>();
		for (Map<String, Object> l : in) {
			String type = Json.s(l.get("type")), basis = Json.s(l.get("basis"));
			double q;
			if ("resin".equals(type)) q = Json.num(l.get("qty")) * (1 - regrindPct / 100d);
			else if ("pctOfResin".equals(basis) || "regrind".equals(type)) q = resinTotal * Json.num(l.get("pct")) / 100d;
			else q = Json.num(l.get("qty"));
			Map<String, Object> r = new LinkedHashMap<>();
			r.put("item", l.get("item"));
			r.put("name", l.get("name"));
			r.put("type", type);
			r.put("basis", "regrind".equals(type) ? "pctOfResin" : basis);
			if ("pctOfResin".equals(basis) || "regrind".equals(type)) r.put("pct", Json.num(l.get("pct")));
			r.put("qty", r6(q));
			r.put("unit", "KG/PCS");
			out.add(r);
		}
		return out;
	}

	/** snapshot ที่เก็บไว้กับใบสั่งผลิต (ปริมาณต่อชิ้นแปลงเป็น กก. แล้ว) */
	public static Map<String, Object> snapshotOf(Map<String, Object> bom) {
		Map<String, Object> s = new LinkedHashMap<>();
		s.put("bomId", bom.get("id"));
		s.put("name", bom.get("name"));
		s.put("revision", bom.get("revision"));
		s.put("color", bom.get("color"));
		s.put("wasteRate", Json.num(bom.get("wasteRate")));
		s.put("packaging", bom.get("packaging"));
		s.put("lines", resolveLines(bom));
		return s;
	}

	// ---------- ตรวจกฎ BOM ----------

	private void assertProductExists(String code) {
		Integer n = jdbc.queryForObject("select count(*)::int from erp_records where collection = 'finished' and data->>'code' = ?", Integer.class, code);
		if (n == null || n == 0) throw ApiException.badRequest("ไม่พบสินค้ารหัส " + code + " ในทะเบียนสินค้า");
	}

	/** ตรวจ + ปรับค่าที่ server เป็นเจ้าของ (revision, updatedBy, isDefault) — cur = ค่าเดิม (null ถ้าสร้างใหม่) */
	public void prepare(AuthUser u, String id, Map<String, Object> bom, Map<String, Object> cur) {
		jdbc.queryForObject("select pg_advisory_xact_lock(hashtext(?))::text", String.class, BOM_LOCK);
		String name = Json.s(bom.get("name")).trim();
		if (name.isEmpty()) throw ApiException.badRequest("ต้องระบุชื่อสูตร BOM");
		bom.put("name", name);
		String code = Json.s(bom.get("productCode")).trim();
		if (code.isEmpty()) throw ApiException.badRequest("ต้องระบุสินค้า");
		if (cur != null && !code.equals(Json.s(cur.get("productCode")))) throw ApiException.conflict("BOM_PRODUCT_LOCKED", "เปลี่ยนสินค้าของ BOM ไม่ได้ — สร้างสูตรใหม่ให้สินค้านั้นแทน");
		bom.put("productCode", code);
		String status = bom.get("status") == null ? "draft" : Json.s(bom.get("status"));
		if (!STATUSES.contains(status)) throw ApiException.badRequest("สถานะ BOM ต้องเป็น draft / active / inactive");
		bom.put("status", status);
		double waste = bom.get("wasteRate") == null ? 0 : Json.num(bom.get("wasteRate"));
		if (!(waste >= 0 && waste <= 50)) throw ApiException.badRequest("% เผื่อเสียต้องอยู่ระหว่าง 0–50");
		bom.put("wasteRate", waste);
		if (cur == null) assertProductExists(code);

		boolean wasActive = cur != null && "active".equals(Json.s(cur.get("status")));
		if (status.equals("inactive")) {
			// เลิกใช้ได้เมื่อไม่มีใบสั่งผลิตที่ยังเปิดอยู่อ้างสูตรนี้
			if (cur != null && !"inactive".equals(Json.s(cur.get("status")))) {
				Integer open = jdbc.queryForObject(
					"select count(*)::int from erp_records where collection = 'workOrders' and data->>'bomId' = ? and data->>'status' in ('queued','setup','running')", Integer.class, id);
				if (open != null && open > 0) throw ApiException.conflict("BOM_IN_USE", "มีใบสั่งผลิตที่ยังเปิดอยู่ใช้สูตรนี้ " + open + " ใบ — ปิดงานหรือยกเลิกก่อนจึงจะเลิกใช้สูตรได้");
			}
			bom.put("isDefault", false);
		} else {
			validateLines(bom, status.equals("active"));
		}

		boolean changed = cur == null || !sameJson(resolveCore(cur), resolveCore(bom));
		bom.put("revision", cur == null ? 1 : (int) Json.num(cur.get("revision")) + (changed ? 1 : 0));
		if (cur != null && Json.num(cur.get("revision")) == 0) bom.put("revision", 1);
		bom.put("updatedBy", u.fullName());
		bom.put("updatedAt", nowStr());
		if (cur == null) { bom.put("createdBy", u.fullName()); bom.put("createdAt", nowStr()); }
		else { bom.put("createdBy", cur.get("createdBy")); bom.put("createdAt", cur.get("createdAt")); }

		// สูตรหลักต่อสินค้า: สูตรที่ใช้งานแรกเป็นสูตรหลักโดยอัตโนมัติ, ตั้งสูตรใหม่เป็นหลักแล้วสูตรอื่นถูกปลดอัตโนมัติ
		if (status.equals("active")) {
			boolean wantDefault = Boolean.TRUE.equals(bom.get("isDefault"));
			Integer others = jdbc.queryForObject(
				"select count(*)::int from erp_records where collection = 'boms' and id <> ? and data->>'productCode' = ? and data->>'status' = 'active' and data->>'isDefault' = 'true'",
				Integer.class, id, code);
			if (wantDefault || others == null || others == 0) {
				bom.put("isDefault", true);
				jdbc.update("update erp_records set data = jsonb_set(data, '{isDefault}', 'false'::jsonb) where collection = 'boms' and id <> ? and data->>'productCode' = ?", id, code);
			} else {
				bom.put("isDefault", false);
			}
		} else if (!status.equals("inactive")) {
			bom.put("isDefault", false);
		}
		if (cur != null && wasActive && status.equals("draft")) {
			// ถอยกลับเป็นร่างได้เฉพาะเมื่อไม่มีใบสั่งที่เปิดอยู่อ้างอิง
			Integer open = jdbc.queryForObject(
				"select count(*)::int from erp_records where collection = 'workOrders' and data->>'bomId' = ? and data->>'status' in ('queued','setup','running')", Integer.class, id);
			if (open != null && open > 0) throw ApiException.conflict("BOM_IN_USE", "มีใบสั่งผลิตที่ยังเปิดอยู่ใช้สูตรนี้ " + open + " ใบ — แก้เป็นร่างไม่ได้");
		}
	}

	/** ส่วนของ BOM ที่ทำให้เลขเวอร์ชันเพิ่มเมื่อเปลี่ยน */
	private static Object resolveCore(Map<String, Object> b) {
		Map<String, Object> c = new LinkedHashMap<>();
		c.put("lines", b.get("lines"));
		c.put("wasteRate", Json.num(b.get("wasteRate")));
		c.put("name", b.get("name"));
		c.put("color", b.get("color"));
		return c;
	}

	@SuppressWarnings("unchecked")
	private void validateLines(Map<String, Object> bom, boolean requireActiveMaterials) {
		if (!(bom.get("lines") instanceof List<?> raw) || raw.isEmpty()) throw ApiException.badRequest("BOM ต้องมีรายการวัตถุดิบอย่างน้อย 1 รายการ");
		List<Object> out = new ArrayList<>();
		Set<String> seen = new HashSet<>();
		boolean hasResin = false;
		double regrindPct = 0;
		int i = 0;
		for (Object o : raw) {
			i++;
			if (!(o instanceof Map<?, ?> lm)) throw ApiException.badRequest("รายการที่ " + i + " ไม่ถูกต้อง");
			Map<String, Object> l = new LinkedHashMap<>((Map<String, Object>) lm);
			String item = Json.s(l.get("item")).trim();
			if (item.isEmpty()) throw ApiException.badRequest("รายการที่ " + i + " ต้องเลือกวัตถุดิบ");
			Optional<String> ms = repo.get("materials", item);
			if (ms.isEmpty()) throw ApiException.badRequest("รายการที่ " + i + " ไม่พบวัตถุดิบ " + item + " ในทะเบียน");
			Map<String, Object> mat = json.map(ms.get());
			if (requireActiveMaterials && Boolean.FALSE.equals(mat.get("active"))) throw ApiException.badRequest("รายการที่ " + i + " วัตถุดิบ " + item + " ปิดใช้งานแล้ว");
			if (!seen.add(item)) throw ApiException.badRequest("วัตถุดิบ " + item + " ซ้ำในสูตรเดียวกัน (รายการที่ " + i + ")");
			String type = Json.s(l.get("type"));
			if (!TYPES.contains(type)) throw ApiException.badRequest("รายการที่ " + i + " ชนิดต้องเป็น เม็ดพลาสติก / มาสเตอร์แบตช์ / สารเติมแต่ง / เศษรีไซเคิล");
			String basis = "regrind".equals(type) ? "pctOfResin" : ("resin".equals(type) ? "perPiece" : (l.get("basis") == null ? "perPiece" : Json.s(l.get("basis"))));
			if (!basis.equals("perPiece") && !basis.equals("pctOfResin")) throw ApiException.badRequest("รายการที่ " + i + " วิธีกำหนดปริมาณไม่ถูกต้อง");
			l.put("type", type);
			l.put("basis", basis);
			if (basis.equals("perPiece")) {
				double q = Json.num(l.get("qty"));
				if (!(q > 0) || Double.isInfinite(q)) throw ApiException.badRequest("รายการที่ " + i + " ปริมาณต่อชิ้นต้องมากกว่า 0");
				l.put("qty", q);
				l.remove("pct");
			} else {
				double p = Json.num(l.get("pct"));
				if (!(p > 0 && p < 100)) throw ApiException.badRequest("รายการที่ " + i + " สัดส่วนต้องมากกว่า 0 และน้อยกว่า 100 %");
				l.put("pct", p);
				l.remove("qty");
			}
			if ("resin".equals(type)) hasResin = true;
			if ("regrind".equals(type)) regrindPct += Json.num(l.get("pct"));
			l.put("name", Json.s(l.get("name")).isBlank() ? mat.get("name") : l.get("name"));
			l.put("unit", "KG/PCS");
			out.add(l);
		}
		if (!hasResin) throw ApiException.badRequest("BOM ต้องมีเม็ดพลาสติก (resin) อย่างน้อย 1 รายการ");
		if (regrindPct >= 100) throw ApiException.badRequest("สัดส่วนเศษรีไซเคิลรวมต้องน้อยกว่า 100 %");
		bom.put("lines", out);
	}

	// ---------- ใบสั่งผลิต: เลือกสูตร + snapshot ----------

	private Optional<Map<String, Object>> loadBom(String id) {
		return repo.get("boms", id).map(json::map);
	}

	private Optional<Map<String, Object>> defaultBomOf(String productCode) {
		List<String> ids = jdbc.queryForList(
			"select id from erp_records where collection = 'boms' and data->>'productCode' = ? and data->>'status' = 'active' order by (data->>'isDefault') desc nulls last, id limit 1",
			String.class, productCode);
		return ids.isEmpty() ? Optional.empty() : loadBom(ids.get(0));
	}

	/** ตอนสร้างใบสั่งผลิต: server เป็นผู้กำหนด bomId + snapshot เอง (ไม่เชื่อค่าจาก client) */
	public void attachToNewWorkOrder(Map<String, Object> wo) {
		wo.remove("bomSnapshot");
		String productCode = Json.s(wo.get("productCode"));
		String bomId = Json.s(wo.get("bomId")).trim();
		Optional<Map<String, Object>> bom;
		if (!bomId.isEmpty()) {
			bom = loadBom(bomId);
			if (bom.isEmpty()) throw ApiException.badRequest("ไม่พบสูตร BOM " + bomId);
			if (!productCode.equals(Json.s(bom.get().get("productCode")))) throw ApiException.badRequest("สูตร BOM นี้ไม่ใช่ของสินค้า " + productCode);
			if (!"active".equals(Json.s(bom.get().get("status")))) throw ApiException.badRequest("สูตร BOM นี้ไม่ได้อยู่ในสถานะใช้งาน");
		} else {
			bom = defaultBomOf(productCode);
		}
		if (bom.isPresent()) {
			wo.put("bomId", bom.get().get("id"));
			wo.put("bomSnapshot", snapshotOf(bom.get()));
		} else {
			wo.remove("bomId");
		}
	}

	/** แก้ใบสั่งผลิตเดิม: สูตรและ snapshot เปลี่ยนไม่ได้ (คืนค่าเดิมให้เสมอ ไม่ error เพื่อไม่ขวางการซิงก์ของหน้าจอ) */
	public void keepWorkOrderBom(Map<String, Object> cur, Map<String, Object> next) {
		for (String k : List.of("bomId", "bomSnapshot")) {
			if (cur.containsKey(k)) next.put(k, cur.get(k)); else next.remove(k);
		}
	}

	/** สูตรที่ใช้ตัดวัตถุดิบ: snapshot ของใบสั่ง ถ้าไม่มี (ใบเก่า) ใช้สูตรหลักปัจจุบันของสินค้า */
	public Optional<Map<String, Object>> effectiveSnapshot(Map<String, Object> wo) {
		if (wo.get("bomSnapshot") instanceof Map<?, ?> s) {
			@SuppressWarnings("unchecked") Map<String, Object> snap = (Map<String, Object>) s;
			return Optional.of(snap);
		}
		return defaultBomOf(Json.s(wo.get("productCode"))).map(BomService::snapshotOf);
	}
}
