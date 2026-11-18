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
import org.springframework.transaction.annotation.Transactional;

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
	private final AuditService audit;

	public BomService(RecordRepository repo, Json json, JdbcTemplate jdbc, AuditService audit) {
		this.repo = repo;
		this.json = json;
		this.jdbc = jdbc;
		this.audit = audit;
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

	/** เม็ดผสม: basis = shareOfResin → pct คือสัดส่วน % ของน้ำหนักเม็ดรวม (resinWeight กก./ชิ้น ไม่รวมมาสเตอร์แบตช์) */
	static final String SHARE = "shareOfResin";

	private static double resinQty(Map<String, Object> l, double resinWeight) {
		return SHARE.equals(Json.s(l.get("basis"))) ? resinWeight * Json.num(l.get("pct")) / 100d : Json.num(l.get("qty"));
	}

	/** แปลงบรรทัด BOM (qty หรือ pct) เป็นปริมาณ กก./ชิ้น ที่ใช้จริง */
	@SuppressWarnings("unchecked")
	public static List<Map<String, Object>> resolveLines(Map<String, Object> bom) {
		List<Map<String, Object>> in = new ArrayList<>();
		if (bom.get("lines") instanceof List<?> l) for (Object o : l) if (o instanceof Map<?, ?> m) in.add((Map<String, Object>) m);
		double resinWeight = Json.num(bom.get("resinWeight"));
		double resinTotal = 0, regrindPct = 0;
		for (Map<String, Object> l : in) {
			if ("resin".equals(Json.s(l.get("type")))) resinTotal += resinQty(l, resinWeight);
			if ("regrind".equals(Json.s(l.get("type")))) regrindPct += Json.num(l.get("pct"));
		}
		List<Map<String, Object>> out = new ArrayList<>();
		for (Map<String, Object> l : in) {
			String type = Json.s(l.get("type")), basis = Json.s(l.get("basis"));
			double q;
			if ("resin".equals(type)) q = resinQty(l, resinWeight) * (1 - regrindPct / 100d);
			else if ("pctOfResin".equals(basis) || "regrind".equals(type)) q = resinTotal * Json.num(l.get("pct")) / 100d;
			else q = Json.num(l.get("qty"));
			Map<String, Object> r = new LinkedHashMap<>();
			r.put("item", l.get("item"));
			r.put("name", l.get("name"));
			r.put("type", type);
			r.put("basis", "regrind".equals(type) ? "pctOfResin" : basis);
			if (SHARE.equals(basis) || "pctOfResin".equals(basis) || "regrind".equals(type)) r.put("pct", Json.num(l.get("pct")));
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
		// น้ำหนักชิ้นงาน/รันเนอร์ (กรัม) — ใช้ตอนบันทึกผลิตเพื่อคำนวณรันเนอร์ที่ได้กลับเป็นเศษรีไซเคิล
		if (bom.get("partWeight") != null) s.put("partWeight", Json.num(bom.get("partWeight")));
		if (bom.get("runnerWeight") != null) s.put("runnerWeight", Json.num(bom.get("runnerWeight")));
		if (bom.get("cavities") != null) s.put("cavities", Json.num(bom.get("cavities")));
		if (bom.get("piecesPerUnit") != null) s.put("piecesPerUnit", Json.num(bom.get("piecesPerUnit")));
		if (bom.get("regrindItem") != null) s.put("regrindItem", bom.get("regrindItem"));
		// สูตรตั้งต้น (ก่อนปรับสัดส่วนรายใบ) — ใช้คำนวณใหม่เมื่อปรับ % ของใบสั่งผลิต
		s.put("baseLines", bom.get("lines"));
		if (bom.get("resinWeight") != null) s.put("baseResinWeight", Json.num(bom.get("resinWeight")));
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
			applyWeights(u, bom);
		}

		boolean changed = cur == null || !sameJson(resolveCore(cur), resolveCore(bom));
		// ประวัติการแก้สูตร: server เป็นเจ้าของ — เก็บสำเนาเวอร์ชันก่อนแก้ + ผู้แก้ + เหตุผล (สูตรที่ใช้งานอยู่ต้องระบุเหตุผล)
		String why = Json.s(bom.get("changeReason")).trim();
		bom.remove("changeReason");
		List<Object> hist = new ArrayList<>();
		if (cur != null && cur.get("history") instanceof List<?> oh) hist.addAll(oh);
		if (cur != null && changed) {
			if (wasActive && why.isEmpty()) throw ApiException.badRequest("ต้องระบุเหตุผลทุกครั้งที่แก้สูตรที่ใช้งานอยู่");
			Map<String, Object> he = new LinkedHashMap<>();
			he.put("revision", cur.get("revision") == null ? 1 : cur.get("revision"));
			he.put("name", cur.get("name"));
			he.put("color", cur.get("color"));
			he.put("wasteRate", Json.num(cur.get("wasteRate")));
			he.put("lines", cur.get("lines"));
			if (cur.get("resinWeight") != null) he.put("resinWeight", cur.get("resinWeight"));
			he.put("by", u.fullName());
			he.put("at", nowStr());
			he.put("reason", why);
			hist.add(0, he);
		}
		if (hist.isEmpty()) bom.remove("history"); else bom.put("history", hist);
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
		c.put("resinWeight", b.get("resinWeight") == null ? 0 : Json.num(b.get("resinWeight")));
		c.put("partWeight", b.get("partWeight") == null ? 0 : Json.num(b.get("partWeight")));
		c.put("runnerWeight", b.get("runnerWeight") == null ? 0 : Json.num(b.get("runnerWeight")));
		c.put("cavities", b.get("cavities") == null ? 0 : Json.num(b.get("cavities")));
		c.put("piecesPerUnit", b.get("piecesPerUnit") == null ? 1 : Json.num(b.get("piecesPerUnit")));
		c.put("regrindItem", Json.s(b.get("regrindItem")));
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
		double regrindPct = 0, shareSum = 0;
		int i = 0, shareLines = 0, resinLines = 0;
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
			String basis = "regrind".equals(type) ? "pctOfResin"
				: ("resin".equals(type) ? (SHARE.equals(Json.s(l.get("basis"))) ? SHARE : "perPiece") : (l.get("basis") == null ? "perPiece" : Json.s(l.get("basis"))));
			if (!basis.equals("perPiece") && !basis.equals("pctOfResin") && !basis.equals(SHARE)) throw ApiException.badRequest("รายการที่ " + i + " วิธีกำหนดปริมาณไม่ถูกต้อง");
			l.put("type", type);
			l.put("basis", basis);
			if (basis.equals(SHARE)) {
				double p = Json.num(l.get("pct"));
				if (!(p > 0 && p <= 100)) throw ApiException.badRequest("รายการที่ " + i + " สัดส่วนเม็ดต้องมากกว่า 0 และไม่เกิน 100 %");
				l.put("pct", p);
				l.remove("qty");
				shareSum += p;
				shareLines++;
			} else if (basis.equals("perPiece")) {
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
			if ("resin".equals(type)) { hasResin = true; resinLines++; }
			if ("regrind".equals(type)) regrindPct += Json.num(l.get("pct"));
			l.put("name", Json.s(l.get("name")).isBlank() ? mat.get("name") : l.get("name"));
			l.put("unit", "KG/PCS");
			out.add(l);
		}
		if (!hasResin) throw ApiException.badRequest("BOM ต้องมีเม็ดพลาสติก (resin) อย่างน้อย 1 รายการ");
		if (regrindPct >= 100) throw ApiException.badRequest("สัดส่วนเศษรีไซเคิลรวมต้องน้อยกว่า 100 %");
		if (shareLines > 0) {
			// เม็ดผสมเป็น % : ทุกบรรทัดเม็ดต้องกำหนดเป็น % ของเม็ดรวม, ผลรวม = 100 และต้องมีน้ำหนักเม็ดรวมต่อชิ้น
			if (shareLines != resinLines) throw ApiException.badRequest("เม็ดพลาสติกทุกรายการต้องกำหนดเป็น % ของเม็ดรวมเหมือนกัน (ห้ามปนกับ กก./ชิ้น)");
			if (Math.abs(shareSum - 100) > 1e-6) throw ApiException.badRequest("สัดส่วนเม็ดรวมต้องเท่ากับ 100 % พอดี (ตอนนี้ " + shareSum + " %)");
			double rw = Json.num(bom.get("resinWeight"));
			if (!(rw > 0) || Double.isInfinite(rw)) throw ApiException.badRequest("ต้องระบุน้ำหนักเม็ดรวมต่อชิ้น (กก./ชิ้น) มากกว่า 0");
			bom.put("resinWeight", rw);
		} else {
			bom.remove("resinWeight");
		}
		bom.put("lines", out);
	}

	/**
	 * น้ำหนักชิ้นงาน (partWeight, กรัม/ชิ้น) + รันเนอร์ (runnerWeight, กรัม/ช็อต; 0 = รันเนอร์ร้อน/ไม่มี) + จำนวนคาวิตี้
	 * → น้ำหนักเม็ดต่อชิ้น = (ชิ้นงาน + รันเนอร์ ÷ คาวิตี้) ÷ 1000 กก. — server คำนวณเองและเขียนทับค่าเม็ดในสูตร (ไม่ให้ตัวเลขสองที่ขัดกัน)
	 * ไม่ได้กรอกน้ำหนักชิ้นงาน = สูตรแบบเดิม (กรอกกก./ชิ้นเอง)
	 * regrindItem = วัตถุดิบ (เศษรีไซเคิล) ที่รับรันเนอร์กลับเข้าสต๊อกตอนผลิต — ไม่ระบุ = ใช้วัตถุดิบชนิดเศษรีไซเคิลในสูตร
	 */
	@SuppressWarnings("unchecked")
	private void applyWeights(AuthUser u, Map<String, Object> bom) {
		double part = bom.get("partWeight") == null ? 0 : Json.num(bom.get("partWeight"));
		double runner = bom.get("runnerWeight") == null ? 0 : Json.num(bom.get("runnerWeight"));
		if (!(part > 0)) { bom.remove("partWeight"); bom.remove("runnerWeight"); bom.remove("cavities"); bom.remove("regrindItem"); bom.remove("piecesPerUnit"); return; }
		if (Double.isInfinite(part) || !(runner >= 0) || Double.isInfinite(runner)) throw ApiException.badRequest("น้ำหนักชิ้นงาน/รันเนอร์ต้องเป็นตัวเลขไม่ติดลบ");
		double cav = bom.get("cavities") == null ? 0 : Json.num(bom.get("cavities"));
		if (!(cav >= 1) && !Json.s(bom.get("mold")).isBlank()) {
			Optional<String> ms = repo.get("molds", Json.s(bom.get("mold")));
			if (ms.isPresent()) cav = Json.num(json.map(ms.get()).get("cavities"));
		}
		if (!(cav >= 1) || cav != Math.floor(cav)) throw ApiException.badRequest("ต้องระบุจำนวนคาวิตี้ (จำนวนเต็มตั้งแต่ 1) หรือเลือกแม่พิมพ์ที่มีคาวิตี้");
		// ชิ้นต่อ 1 หน่วยสินค้า (ชุด): เช่น ซ้าย+ขวา = 2 — เม็ดต่อชุด = (ชิ้นงาน + รันเนอร์ ÷ คาวิตี้) × ชิ้นต่อชุด
		double ppu = bom.get("piecesPerUnit") == null ? 1 : Json.num(bom.get("piecesPerUnit"));
		if (!(ppu >= 1) || ppu != Math.floor(ppu)) throw ApiException.badRequest("จำนวนชิ้นต่อชุดต้องเป็นจำนวนเต็มตั้งแต่ 1");
		if (cav % ppu != 0) throw ApiException.badRequest("จำนวนคาวิตี้ (" + (long) cav + ") ต้องหารด้วยจำนวนชิ้นต่อชุด (" + (long) ppu + ") ลงตัว");
		double rw = r6((part + runner / cav) * ppu / 1000d);
		bom.put("piecesPerUnit", ppu);
		bom.put("partWeight", part);
		bom.put("runnerWeight", runner);
		bom.put("cavities", cav);
		List<Map<String, Object>> lines = (List<Map<String, Object>>) bom.get("lines");
		long share = lines.stream().filter(l -> "resin".equals(Json.s(l.get("type"))) && SHARE.equals(Json.s(l.get("basis")))).count();
		if (share > 0) {
			bom.put("resinWeight", rw);
		} else {
			List<Map<String, Object>> resins = lines.stream().filter(l -> "resin".equals(Json.s(l.get("type")))).toList();
			if (resins.size() != 1) throw ApiException.badRequest("ผสมเม็ดหลายเกรดต้องกำหนดเป็น % ของเม็ดรวม เมื่อใช้น้ำหนักชิ้นงาน/รันเนอร์");
			resins.get(0).put("qty", rw);
			bom.remove("resinWeight");
		}
		String target = Json.s(bom.get("regrindItem")).trim();
		if (target.isEmpty()) {
			target = lines.stream().filter(l -> "regrind".equals(Json.s(l.get("type")))).map(l -> Json.s(l.get("item"))).findFirst().orElse("");
		}
		if (runner > 0 && target.isEmpty()) {
			// ไม่ได้ระบุที่เก็บรันเนอร์ และสูตรไม่มีเศษรีไซเคิล → ใช้ "เม็ดรีไซเคิลของเกรดเดียวกัน" ของเม็ดหลักในสูตร (ไม่มีให้สร้างอัตโนมัติ)
			String main = lines.stream().filter(l -> "resin".equals(Json.s(l.get("type")))).map(l -> Json.s(l.get("item"))).findFirst().orElse("");
			if (!main.isEmpty()) target = recycledVariantOf(u, main);
		}
		if (runner > 0 && !target.isEmpty() && repo.get("materials", target).isEmpty()) throw ApiException.badRequest("ไม่พบวัตถุดิบเศษรีไซเคิล " + target + " ที่ใช้รับรันเนอร์กลับ");
		if (target.isEmpty()) bom.remove("regrindItem"); else bom.put("regrindItem", target);
	}

	/** วัตถุดิบ "รีไซเคิลของเกรดเดียวกัน" (recycledFrom = รหัสเม็ดใหม่) — ไม่มีให้สร้างใหม่: รหัส <เม็ด>-RC ชื่อ "<เม็ด> (รีไซเคิล)" หน่วยเดียวกัน */
	private String recycledVariantOf(AuthUser u, String virginId) {
		List<String> found = jdbc.queryForList(
			"select id from erp_records where collection = 'materials' and data->>'recycledFrom' = ? order by id limit 1", String.class, virginId);
		if (!found.isEmpty()) return found.get(0);
		Optional<String> vs = repo.get("materials", virginId);
		if (vs.isEmpty()) return "";
		Map<String, Object> v = json.map(vs.get());
		String id = Json.s(v.get("code")) + "-RC";
		for (int n = 2; repo.get("materials", id).isPresent(); n++) id = Json.s(v.get("code")) + "-RC" + n;
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", id); m.put("code", id); m.put("name", Json.s(v.get("name")) + " (รีไซเคิล)");
		m.put("type", "เศษรีไซเคิล"); m.put("unit", v.get("unit") == null ? "KG" : v.get("unit"));
		m.put("stock", 0); m.put("min", 0); m.put("max", v.get("max") == null ? 10000 : v.get("max")); m.put("cost", 0);
		m.put("active", true); m.put("recycledFrom", virginId);
		repo.insert("materials", id, json.str(m), u.username());
		audit.log(u, "CREATE", "วัตถุดิบ", id, "สร้างอัตโนมัติ: เม็ดรีไซเคิลของ " + virginId + " (รับรันเนอร์กลับจากการผลิต)");
		return id;
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

	// ---------- ปรับสัดส่วนรายใบสั่งผลิต ----------

	/** ปรับ % (หรือกก./ชิ้น) ของมาสเตอร์แบตช์ / สารเติมแต่ง / เศษรีไซเคิล เฉพาะใบสั่งผลิตที่ยังไม่เริ่มผลิต — ค่าจริงคำนวณใหม่จากสูตรตั้งต้นทุกครั้ง */
	@Transactional
	@SuppressWarnings("unchecked")
	public Map<String, Object> adjustWorkOrder(AuthUser u, String woId, List<?> adjustments, String reason) {
		RecordService.requireWrite(u, RecordService.def("workOrders"));
		String why = reason == null ? "" : reason.trim();
		if (why.isEmpty()) throw ApiException.badRequest("ต้องระบุเหตุผลการปรับสัดส่วน");
		Map<String, Object> wo = json.map(repo.getForUpdate("workOrders", woId).orElseThrow(() -> ApiException.notFound("ไม่พบใบสั่งผลิต " + woId)));
		String st = Json.s(wo.get("status"));
		if (!(st.equals("queued") || st.equals("setup")) || Json.num(wo.get("produced")) > 0)
			throw ApiException.conflict("WO_STARTED", woId + " เริ่มผลิตแล้วหรือปิดแล้ว — ปรับสัดส่วนไม่ได้");
		if (!(wo.get("bomSnapshot") instanceof Map<?, ?> sm)) throw ApiException.badRequest(woId + " ไม่มีสูตร BOM");
		Map<String, Object> snap = new LinkedHashMap<>((Map<String, Object>) sm);
		if (!(snap.get("baseLines") instanceof List<?> bl) || bl.isEmpty()) throw ApiException.badRequest(woId + " เป็นใบเก่าที่ไม่มีสูตรตั้งต้น — ปรับสัดส่วนไม่ได้");
		List<Map<String, Object>> lines = new ArrayList<>();
		for (Object o : bl) lines.add(new LinkedHashMap<>((Map<String, Object>) o));
		List<Object> changes = new ArrayList<>();
		Set<String> touched = new HashSet<>();
		if (adjustments != null) for (Object ao : adjustments) {
			if (!(ao instanceof Map<?, ?> a)) throw ApiException.badRequest("รายการปรับไม่ถูกต้อง");
			String item = Json.s(a.get("item"));
			if (!touched.add(item)) throw ApiException.badRequest("วัตถุดิบ " + item + " ซ้ำในรายการปรับ");
			Map<String, Object> l = lines.stream().filter(x -> item.equals(Json.s(x.get("item")))).findFirst().orElseThrow(() -> ApiException.badRequest("ไม่พบวัตถุดิบ " + item + " ในสูตรของใบนี้"));
			String type = Json.s(l.get("type"));
			boolean share = SHARE.equals(Json.s(l.get("basis")));
			if ("resin".equals(type) && !share) throw ApiException.badRequest("ปรับเม็ดพลาสติกได้เฉพาะสูตรที่กำหนดเม็ดผสมเป็น % — เม็ดที่กำหนดเป็น กก./ชิ้น ปรับไม่ได้");
			boolean pct = share || "regrind".equals(type) || "pctOfResin".equals(Json.s(l.get("basis")));
			String key = pct ? "pct" : "qty";
			double v = Json.num(a.get(key));
			if (!(v > 0) || Double.isInfinite(v) || (pct && (share ? v > 100 : v >= 100))) throw ApiException.badRequest("ค่าของ " + item + " ต้องมากกว่า 0" + (pct ? " และน้อยกว่า 100 %" : ""));
			double from = Json.num(l.get(key));
			if (Math.abs(from - v) < 1e-9) continue;
			l.put(key, v);
			Map<String, Object> c = new LinkedHashMap<>();
			c.put("item", item); c.put("name", l.get("name")); c.put("unit", pct ? "%" : "KG/PCS"); c.put("from", from); c.put("to", v);
			changes.add(c);
		}
		double rg = 0;
		for (Map<String, Object> l : lines) if ("regrind".equals(Json.s(l.get("type")))) rg += Json.num(l.get("pct"));
		if (rg >= 100) throw ApiException.badRequest("สัดส่วนเศษรีไซเคิลรวมต้องน้อยกว่า 100 %");
		double ss = 0; boolean anyShare = false;
		for (Map<String, Object> l : lines) if (SHARE.equals(Json.s(l.get("basis")))) { anyShare = true; ss += Json.num(l.get("pct")); }
		if (anyShare && Math.abs(ss - 100) > 1e-6) throw ApiException.badRequest("สัดส่วนเม็ดรวมต้องเท่ากับ 100 % พอดี (ตอนนี้ " + r6(ss) + " %)");
		Map<String, Object> tmp = new LinkedHashMap<>();
		tmp.put("lines", lines);
		if (snap.get("baseResinWeight") != null) tmp.put("resinWeight", snap.get("baseResinWeight"));
		snap.put("lines", resolveLines(tmp));
		if (changes.isEmpty()) { snap.remove("adjustments"); snap.remove("adjustReason"); snap.remove("adjustBy"); snap.remove("adjustAt"); }
		else { snap.put("adjustments", changes); snap.put("adjustReason", why); snap.put("adjustBy", u.fullName()); snap.put("adjustAt", nowStr()); }
		wo.put("bomSnapshot", snap);
		wo.remove("_version");
		repo.update("workOrders", woId, json.str(wo), null, u.username());
		audit.log(u, "BOM_ADJUST", "ใบสั่งผลิต", woId, (changes.isEmpty() ? "คืนค่าตามสูตรตั้งต้น" : changes.size() + " รายการ") + " · " + why);
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("id", woId);
		out.put("adjusted", changes.size());
		return out;
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
