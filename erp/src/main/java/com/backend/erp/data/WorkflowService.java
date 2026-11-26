package com.backend.erp.data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.backend.erp.auth.AuthUser;
import com.backend.erp.common.ApiException;
import com.backend.erp.common.Json;

/** ฟังก์ชันธุรกิจที่ Store เดิมทำฝั่ง client: receivePO / produceWO / adjustStock (all-or-nothing ด้วย DB transaction) */
@Service
public class WorkflowService {
	private static final ZoneId BKK = ZoneId.of("Asia/Bangkok");
	private final RecordRepository repo;
	private final AuditService audit;
	private final Json json;
	private final JdbcTemplate jdbc;
	private final BomService boms;

	public WorkflowService(RecordRepository repo, AuditService audit, Json json, JdbcTemplate jdbc, BomService boms) {
		this.boms = boms;
		this.repo = repo;
		this.audit = audit;
		this.json = json;
		this.jdbc = jdbc;
	}

	// ---------- helpers ----------
	private static String nowStr() { return LocalDateTime.now(BKK).format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")); }

	private static void need(AuthUser u, String... roles) {
		for (String r : roles) if (r.equals(u.role())) return;
		throw ApiException.forbidden("บทบาท " + u.role() + " ไม่มีสิทธิ์ทำรายการนี้");
	}

	private Map<String, Object> lock(String coll, String id, String notFoundMsg) {
		return json.map(repo.getForUpdate(coll, id).orElseThrow(() -> ApiException.unprocessable("NOT_FOUND", notFoundMsg)));
	}

	private void save(String coll, Map<String, Object> rec, AuthUser u) {
		rec.remove("_version");
		repo.update(coll, String.valueOf(rec.get("id")), json.str(rec), null, u.username());
	}

	private void logMove(AuthUser u, String type, String item, double qty, String unit, String ref, String note) {
		logMove(u, type, item, qty, unit, ref, note, null);
	}

	private void logMove(AuthUser u, String type, String item, double qty, String unit, String ref, String note, Map<String, Object> extra) {
		Map<String, Object> mv = new LinkedHashMap<>();
		mv.put("id", "MV-" + UUID.randomUUID().toString().substring(0, 12));
		mv.put("date", nowStr().substring(0, 16));
		mv.put("by", u.fullName());
		mv.put("type", type);
		mv.put("item", item);
		mv.put("qty", qty);
		mv.put("unit", unit);
		mv.put("ref", ref);
		mv.put("note", note);
		if (extra != null) mv.putAll(extra);
		repo.insert("stockMovements", String.valueOf(mv.get("id")), json.str(mv), u.username());
	}

	private static double r4(double v) { return Math.round(v * 10000d) / 10000d; }

	private static String norm(String s) { return s == null ? "" : s.toLowerCase().replaceAll("[^a-z0-9ก-๙]", ""); }

	private Map<String, Object> matchMaterial(Map<String, Object> line) {
		if (line.get("item") != null) {
			return repo.getForUpdate("materials", String.valueOf(line.get("item"))).map(json::map).orElse(null);
		}
		String name = norm(Json.s(line.get("name")));
		if (name.isEmpty()) return null;
		List<Map<String, Object>> all = new ArrayList<>();
		for (String s : repo.list("materials", null, 5000, 0)) all.add(json.map(s));
		for (Map<String, Object> m : all) {
			String c = norm(Json.s(m.get("code")));
			if (c.length() >= 4 && name.contains(c)) return lock("materials", String.valueOf(m.get("id")), "ไม่พบวัตถุดิบ");
		}
		for (Map<String, Object> m : all) {
			String nm = norm(Json.s(m.get("name")));
			nm = nm.length() > 10 ? nm.substring(0, 10) : nm;
			if (nm.length() >= 5 && name.contains(nm)) return lock("materials", String.valueOf(m.get("id")), "ไม่พบวัตถุดิบ");
		}
		return null;
	}

	// ---------- stock adjust ----------
	@Transactional
	public Map<String, Object> adjustStock(AuthUser u, String code, double delta, String ref, String note, boolean allowNegative) {
		need(u, "admin", "procurement", "production", "accounting");
		String coll = "finished";
		List<String> found = jdbc.queryForList("select id from erp_records where collection='finished' and data->>'code' = ? for update", String.class, code);
		if (found.isEmpty()) {
			coll = "materials";
			found = jdbc.queryForList("select id from erp_records where collection='materials' and data->>'code' = ? for update", String.class, code);
		}
		if (found.isEmpty()) throw ApiException.unprocessable("NOT_FOUND", "ไม่พบสินค้า/วัตถุดิบรหัส " + code);
		Map<String, Object> rec = lock(coll, found.get(0), "ไม่พบรายการ");
		double next = Json.r3(Json.num(rec.get("stock")) + delta);
		if (next < 0 && !allowNegative) {
			throw ApiException.unprocessable("INSUFFICIENT_STOCK", "สต๊อก " + code + " ไม่พอ (คงเหลือ " + rec.get("stock") + ", ต้องการ " + Math.abs(delta) + ")");
		}
		rec.put("stock", next);
		save(coll, rec, u);
		String unit = rec.get("unit") != null ? String.valueOf(rec.get("unit")) : "finished".equals(coll) ? "PCS" : "";
		logMove(u, delta >= 0 ? "IN" : "OUT", code, Math.abs(delta), unit, ref, note);
		audit.log(u, "ADJUST", "คลังสินค้า", code, (delta >= 0 ? "+" : "") + delta + (note == null ? "" : " · " + note));
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("code", code);
		out.put("stock", next);
		return out;
	}

	// ---------- ปรับต้นทุนวัตถุดิบฉุกเฉิน (admin เท่านั้น) ----------
	@Transactional
	public Map<String, Object> adjustMaterialCost(AuthUser u, String id, double newCost, String reason) {
		return adjustCost(u, "materials", "วัตถุดิบ", id, newCost, reason);
	}

	/** ปรับต้นทุนสินค้าซื้อมาขาย/สินค้าที่ตั้งเป็นซื้อได้ (admin เท่านั้น ต้องมีเหตุผล) */
	@Transactional
	public Map<String, Object> adjustProductCost(AuthUser u, String id, double newCost, String reason) {
		return adjustCost(u, "finished", "สินค้า", id, newCost, reason);
	}

	// ---------- เปลี่ยนประเภทงานของสินค้า (admin เท่านั้น ต้องมีเหตุผล) ----------
	private static final List<String> JOB_TYPES = List.of("oem", "own", "trade");

	/**
	 * เปลี่ยนประเภทงาน (oem / own / trade) และธง "สั่งซื้อได้" พร้อมกัน · สต๊อก ต้นทุนปัจจุบัน และเอกสารเดิมไม่เปลี่ยน
	 * กัน: เปลี่ยนเป็นซื้อมาขายขณะมีใบสั่งผลิตค้างหรือ BOM ใช้งานอยู่ · เปลี่ยนเป็นสินค้าที่ซื้อไม่ได้ขณะมีใบสั่งซื้อค้าง
	 */
	@Transactional
	public Map<String, Object> changeProductType(AuthUser u, String id, String jobType, boolean buyable, String reason) {
		need(u, "admin");
		if (!JOB_TYPES.contains(jobType)) throw ApiException.badRequest("ประเภทงานไม่ถูกต้อง");
		if (reason == null || reason.isBlank()) throw ApiException.badRequest("ต้องระบุเหตุผลการเปลี่ยนประเภทงาน");
		Map<String, Object> p = lock("finished", id, "ไม่พบสินค้า " + id);
		String from = Json.s(p.get("jobType")), code = Json.s(p.get("code"));
		if (jobType.equals(from)) throw ApiException.badRequest("สินค้านี้เป็นประเภทที่เลือกอยู่แล้ว");
		boolean wasBuyable = Boolean.TRUE.equals(p.get("buyable")) || "trade".equals(from);
		boolean willBuy = "trade".equals(jobType) || buyable;
		if ("trade".equals(jobType)) {
			blockIfAny("select id from erp_records where collection = 'workOrders' and data->>'productCode' = ? and coalesce(data->>'status', '') not in ('done', 'cancelled')",
				code, "มีใบสั่งผลิตค้างอยู่ ปิดหรือยกเลิกก่อน");
			blockIfAny("select id from erp_records where collection = 'boms' and data->>'productCode' = ? and data->>'status' = 'active'",
				code, "มี BOM ใช้งานอยู่ เปลี่ยนเป็นเลิกใช้ก่อน");
		}
		if (!willBuy) {
			blockIfAny("select id from erp_records where collection = 'purchaseOrders' and coalesce(data->>'status', '') not in ('received', 'cancelled') "
				+ "and data->'lines' @> jsonb_build_array(jsonb_build_object('itemType', 'product', 'item', ?::text))", id, "มีใบสั่งซื้อค้างอยู่ รับของหรือยกเลิกก่อน");
		}
		p.put("jobType", jobType);
		if (!"trade".equals(jobType) && buyable) p.put("buyable", true);
		else p.remove("buyable");
		double cost = Json.num(p.get("cost"));
		if (wasBuyable != willBuy && cost > 0) {
			List<Object> hist = p.get("costHistory") instanceof List<?> h ? new ArrayList<>(h) : new ArrayList<>();
			Map<String, Object> he = new LinkedHashMap<>();
			he.put("date", LocalDate.now(BKK).toString());
			he.put("cost", cost);
			he.put("prev", cost);
			he.put("by", u.fullName());
			he.put("ref", "TYPE");
			he.put("note", willBuy ? "ต้นทุนยกมา (เปลี่ยนประเภทงาน)" : "ใช้เป็นต้นทุนมาตรฐาน (เปลี่ยนประเภทงาน)");
			hist.add(he);
			p.put("costHistory", hist);
		}
		List<Object> types = p.get("jobTypeHistory") instanceof List<?> h ? new ArrayList<>(h) : new ArrayList<>();
		Map<String, Object> th = new LinkedHashMap<>();
		th.put("date", nowStr().substring(0, 16));
		th.put("by", u.fullName());
		th.put("from", from);
		th.put("fromBuyable", wasBuyable);
		th.put("to", jobType);
		th.put("buyable", willBuy);
		th.put("cost", cost);
		th.put("stock", Json.num(p.get("stock")));
		th.put("reason", reason.trim());
		types.add(th);
		p.put("jobTypeHistory", types);
		save("finished", p, u);
		audit.log(u, "CHANGE_TYPE", "สินค้า", id, from + " → " + jobType + " · " + reason.trim());
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("id", id);
		out.put("jobType", jobType);
		return out;
	}

	private void blockIfAny(String sql, String arg, String message) {
		List<String> ids = jdbc.queryForList(sql + " order by id limit 5", String.class, arg);
		if (!ids.isEmpty()) throw ApiException.conflict("TYPE_CHANGE_BLOCKED", "เปลี่ยนประเภทงานไม่ได้ เพราะ" + message + ": " + String.join(", ", ids));
	}

	private Map<String, Object> adjustCost(AuthUser u, String coll, String label, String id, double newCost, String reason) {
		need(u, "admin");
		if (reason == null || reason.isBlank()) throw ApiException.badRequest("ต้องระบุเหตุผลการปรับต้นทุน");
		if (!(newCost >= 0) || Double.isInfinite(newCost)) throw ApiException.badRequest("ต้นทุนต้องเป็นตัวเลขไม่ติดลบ");
		Map<String, Object> m = lock(coll, id, "ไม่พบ" + label + " " + id);
		double old = Json.num(m.get("cost")), next = r4(newCost);
		List<Object> hist = m.get("costHistory") instanceof List<?> h ? new ArrayList<>(h) : new ArrayList<>();
		Map<String, Object> he = new LinkedHashMap<>();
		he.put("date", LocalDate.now(BKK).toString());
		he.put("cost", next);
		he.put("prev", old);
		he.put("by", u.fullName());
		he.put("ref", "MANUAL");
		he.put("note", "ปรับโดย admin: " + reason.trim());
		hist.add(he);
		m.put("cost", next);
		m.put("costHistory", hist);
		save(coll, m, u);
		audit.log(u, "ADJUST_COST", label, id, old + " → " + next + " · " + reason.trim());
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("id", id);
		out.put("cost", next);
		return out;
	}

	// ---------- receive PO ----------
	@Transactional
	public Map<String, Object> receivePO(AuthUser u, String poId) {
		need(u, "admin", "procurement");
		Map<String, Object> po = lock("purchaseOrders", poId, "ไม่พบใบสั่งซื้อ " + poId);
		String st = Json.s(po.get("status"));
		if ("received".equals(st)) throw ApiException.conflict("ALREADY_RECEIVED", poId + " รับของไปแล้ว");
		if ("cancelled".equals(st)) throw ApiException.conflict("ALREADY_CANCELLED", poId + " ถูกยกเลิกแล้ว");
		if (!"approved".equals(st)) throw ApiException.unprocessable("SOURCE_NOT_APPROVED", poId + " ต้องอนุมัติก่อนรับของเข้าคลัง");
		List<Map<String, Object>> received = new ArrayList<>();
		Object linesObj = po.get("lines");
		List<?> lines = linesObj instanceof List<?> l ? l : List.of();
		if (lines.isEmpty()) throw ApiException.unprocessable("PO_NO_LINES", poId + " ไม่มีรายการสั่งซื้อ รับของเข้าคลังไม่ได้");
		// ขั้น 1: จับคู่วัตถุดิบให้ครบทุกบรรทัดก่อน — บรรทัดใดจับคู่ไม่ได้ให้ปฏิเสธทั้งใบ (ไม่รับเข้าบางรายการแบบเงียบ ๆ)
		List<String> matchedIds = new ArrayList<>();
		List<String> matchedColl = new ArrayList<>();
		List<Double> matchedQty = new ArrayList<>();
		List<Double> matchedPrice = new ArrayList<>();
		int serviceLines = 0;
		int idx = 0;
		for (Object lo : lines) {
			idx++;
			if (!(lo instanceof Map<?, ?> raw)) throw ApiException.unprocessable("PO_LINE_INVALID", poId + " รายการที่ " + idx + " ไม่ถูกต้อง");
			@SuppressWarnings("unchecked") Map<String, Object> line = (Map<String, Object>) raw;
			double qty = Json.num(line.get("qty"));
			String label = Json.s(line.get("name")).isBlank() ? Json.s(line.get("item")) : Json.s(line.get("name"));
			if (!(qty > 0)) throw ApiException.unprocessable("PO_LINE_INVALID", poId + " รายการที่ " + idx + " (" + label + ") จำนวนต้องมากกว่า 0");
			if ("service".equals(Json.s(line.get("itemType")))) { serviceLines++; continue; } // งานบริการ: ไม่รับเข้าสต๊อก (ลงค่าใช้จ่ายด้านล่าง)
			boolean isProduct = "product".equals(Json.s(line.get("itemType")));
			Map<String, Object> m;
			if (isProduct) {
				String pid = Json.s(line.get("item")).trim();
				m = pid.isEmpty() ? null : repo.getForUpdate("finished", pid).map(json::map).orElse(null);
				if (m == null) {
					throw ApiException.unprocessable("PRODUCT_NOT_FOUND", poId + " รายการที่ " + idx + " (" + label + ") ไม่พบสินค้าในทะเบียน จึงรับเข้าคลังไม่ได้ — ไม่มีการรับเข้าสต๊อกรายการใดเลย");
				}
			} else {
				m = matchMaterial(line);
			}
			if (m == null) {
				throw ApiException.unprocessable("MATERIAL_NOT_FOUND", poId + " รายการที่ " + idx + " (" + label + ") ไม่พบวัตถุดิบในทะเบียน จึงรับเข้าคลังไม่ได้ — ไม่มีการรับเข้าสต๊อกรายการใดเลย กรุณาแก้ไขรายการ (ยกเลิก PO แล้วออกใหม่โดยเลือกวัตถุดิบจากทะเบียน)");
			}
			matchedIds.add(String.valueOf(m.get("id")));
			matchedColl.add(isProduct ? "finished" : "materials");
			matchedQty.add(qty);
			matchedPrice.add(Json.num(line.get("price")));
		}
		// ขั้น 2: เพิ่มสต๊อก + บันทึก movement (ทั้งหมดอยู่ในธุรกรรมเดียวกับการเปลี่ยนสถานะ PO)
		for (int k = 0; k < matchedIds.size(); k++) {
			double qty = matchedQty.get(k);
			String coll = matchedColl.get(k);
			Map<String, Object> m = lock(coll, matchedIds.get(k), "ไม่พบรายการ");
			double oldStock = Json.num(m.get("stock")), oldCost = Json.num(m.get("cost")), price = matchedPrice.get(k);
			m.put("stock", Json.r3(oldStock + qty));
			// ต้นทุนถัวเฉลี่ยเคลื่อนที่ (Moving Average): คิดจากราคาใน PO (ก่อน VAT); ไม่มีราคาใน PO = ไม่เปลี่ยนต้นทุน
			Map<String, Object> extra = null;
			if (price > 0) {
				double newCost = oldStock > 0 ? r4((oldStock * oldCost + qty * price) / (oldStock + qty)) : r4(price);
				extra = new LinkedHashMap<>();
				extra.put("unitCost", r4(price));
				extra.put("value", Json.r3(qty * price));
				extra.put("costBefore", oldCost);
				extra.put("costAfter", newCost);
				m.put("cost", newCost);
				List<Object> hist = m.get("costHistory") instanceof List<?> h ? new ArrayList<>(h) : new ArrayList<>();
				Map<String, Object> he = new LinkedHashMap<>();
				he.put("date", LocalDate.now(BKK).toString());
				he.put("cost", newCost);
				he.put("prev", oldCost);
				he.put("by", u.fullName());
				he.put("ref", poId);
				he.put("note", "ถัวเฉลี่ยจากรับ " + poId + " @ " + r4(price));
				hist.add(he);
				m.put("costHistory", hist);
			}
			save(coll, m, u);
			String unit = Json.s(m.get("unit")).isBlank() ? "PCS" : Json.s(m.get("unit"));
			logMove(u, "IN", Json.s(m.get("code")), qty, unit, poId, "รับเข้าจาก " + Json.s(po.get("supplierName")), extra);
			Map<String, Object> r = new LinkedHashMap<>();
			r.put("code", m.get("code"));
			r.put("type", coll.equals("finished") ? "product" : "material");
			r.put("qty", qty);
			r.put("unit", unit);
			if (extra != null) r.put("costAfter", extra.get("costAfter"));
			received.add(r);
		}
		po.put("status", "received");
		po.put("receivedAt", nowStr());
		po.put("receivedBy", u.fullName());
		save("purchaseOrders", po, u);

		String expId = "EXP-" + poId;
		if (repo.get("expenses", expId).isEmpty()) {
			Map<String, Object> exp = new LinkedHashMap<>();
			exp.put("id", expId);
			exp.put("date", LocalDate.now(BKK).toString());
			exp.put("category", matchedColl.isEmpty() ? "ค่าบริการ/จ้างทำของ" : matchedColl.stream().allMatch("finished"::equals) ? "สินค้าซื้อมาขาย" : "วัตถุดิบ");
			exp.put("vendor", po.get("supplierName"));
			exp.put("desc", (matchedColl.isEmpty() ? "ตรวจรับงานตาม " : "รับของตาม ") + poId + " (" + lines.size() + " รายการ)");
			exp.put("amount", po.get("subtotal"));
			exp.put("vat", po.get("vat"));
			exp.put("whtRate", po.get("whtRate") == null ? 0 : po.get("whtRate"));
			exp.put("status", "approved");
			exp.put("ref", poId);
			exp.put("source", "po");
			exp.put("due", LocalDate.now(BKK).plusDays(30).toString());
			repo.insert("expenses", expId, json.str(exp), u.username());
		}
		audit.log(u, "RECEIVE", "ใบสั่งซื้อ", poId, "รับเข้าสต๊อก " + received.size() + " รายการ" + (serviceLines > 0 ? " · ตรวจรับงานบริการ " + serviceLines + " รายการ" : "") + " · ตั้งเจ้าหนี้ " + expId);
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("ok", true);
		out.put("received", received);
		out.put("expenseId", expId);
		return out;
	}

	// ---------- produce WO ----------
	public Map<String, Object> produceWO(AuthUser u, String woId, double produced, double ng) {
		return produceWO(u, woId, produced, ng, "", "", "");
	}

	/** shift = "เช้า" | "ดึก" (ว่างได้); หัวหน้าช่าง/คนนั่งเครื่อง = ชื่อที่พิมพ์เอง บันทึกลงประวัติการผลิตของใบสั่งผลิต */
	@Transactional
	public Map<String, Object> produceWO(AuthUser u, String woId, double produced, double ng, String shift, String supervisor, String operator) {
		need(u, "admin", "production");
		shift = shift == null ? "" : shift.trim();
		if (!shift.isEmpty() && !shift.equals("เช้า") && !shift.equals("ดึก")) throw ApiException.badRequest("กะต้องเป็น เช้า หรือ ดึก");
		supervisor = supervisor == null ? "" : supervisor.trim();
		operator = operator == null ? "" : operator.trim();
		if (supervisor.length() > 100 || operator.length() > 100) throw ApiException.badRequest("ชื่อยาวเกินไป (สูงสุด 100 ตัวอักษร)");
		Map<String, Object> wo = lock("workOrders", woId, "ไม่พบใบสั่งผลิต " + woId);
		if ("cancelled".equals(Json.s(wo.get("status")))) throw ApiException.conflict("ALREADY_CANCELLED", woId + " ถูกยกเลิกแล้ว");
		if (!(produced > 0)) throw ApiException.badRequest("จำนวนผลิตต้องมากกว่า 0");
		if (ng > produced) throw ApiException.badRequest("จำนวน NG มากกว่าจำนวนผลิต");
		double good = produced - ng;
		String productCode = Json.s(wo.get("productCode"));

		// สูตรที่ใช้ตัดวัตถุดิบ = snapshot ของใบสั่งผลิต (ใบเก่าที่ไม่มี snapshot ใช้สูตรหลักปัจจุบันของสินค้า)
		java.util.Optional<Map<String, Object>> snap = boms.effectiveSnapshot(wo);
		List<Map<String, Object>> consumed = new ArrayList<>();
		double batchCost = 0;
		List<String> noCost = new ArrayList<>();
		Double newFgCost = null;
		if (snap.isPresent() && snap.get().get("lines") instanceof List<?> bl) {
			double waste = 1 + Json.num(snap.get().get("wasteRate")) / 100d;
			// คำนวณปริมาณที่ใช้ทุกบรรทัดก่อน แล้วล็อกวัตถุดิบเรียงตามรหัส (กัน deadlock เมื่อบันทึกผลิตพร้อมกัน)
			java.util.TreeMap<String, Double> need = new java.util.TreeMap<>();
			for (Object lo : bl) {
				if (!(lo instanceof Map<?, ?> l) || l.get("item") == null) continue;
				need.merge(String.valueOf(l.get("item")), Json.r3(Json.num(l.get("qty")) * produced * waste), Double::sum);
			}
			Map<String, Map<String, Object>> mats = new java.util.LinkedHashMap<>();
			List<String> short_ = new ArrayList<>();
			for (Map.Entry<String, Double> e : need.entrySet()) {
				java.util.Optional<String> ms = repo.getForUpdate("materials", e.getKey());
				if (ms.isEmpty()) throw ApiException.unprocessable("MATERIAL_NOT_FOUND", "ไม่พบวัตถุดิบ " + e.getKey() + " ในสูตรของ " + woId);
				Map<String, Object> m = json.map(ms.get());
				mats.put(e.getKey(), m);
				double use = Json.r3(e.getValue());
				if (Json.num(m.get("stock")) < use) {
					short_.add(Json.s(m.get("code")) + " (ต้องใช้ " + use + " " + Json.s(m.get("unit")) + " คงเหลือ " + Json.r3(Json.num(m.get("stock"))) + ")");
				}
			}
			if (!short_.isEmpty()) {
				throw ApiException.unprocessable("INSUFFICIENT_MATERIAL", "วัตถุดิบไม่พอสำหรับผลิต " + produced + " ชิ้น: " + String.join(", ", short_) + " — ไม่มีการตัดสต๊อกหรือบันทึกผลิตใดๆ");
			}
			for (Map.Entry<String, Double> e : need.entrySet()) {
				Map<String, Object> m = mats.get(e.getKey());
				double use = Json.r3(e.getValue());
				m.put("stock", Json.r3(Json.num(m.get("stock")) - use));
				save("materials", m, u);
				// มูลค่าวัตถุดิบที่ใช้ ณ ต้นทุนถัวเฉลี่ยปัจจุบัน (รวมส่วนที่เป็น NG) — ใช้คิดต้นทุนสินค้าสำเร็จรูป
				if (Json.num(m.get("cost")) > 0) batchCost += use * Json.num(m.get("cost"));
				else noCost.add(Json.s(m.get("code")));
				logMove(u, "OUT", Json.s(m.get("code")), use, Json.s(m.get("unit")), woId, "ตัดสต๊อกผลิต " + Json.s(wo.get("product")));
				Map<String, Object> c = new LinkedHashMap<>();
				c.put("code", m.get("code"));
				c.put("qty", use);
				c.put("unit", m.get("unit"));
				consumed.add(c);
			}
		}
		// รันเนอร์ (กรัม/ช็อต) ที่ได้กลับ: ช็อต = ⌈ผลิต ÷ คาวิตี้⌉ → น้ำหนักรวมเข้าสต๊อกเศษรีไซเคิลของสูตร ตีมูลค่าที่ต้นทุนเฉลี่ยของเม็ดต่อ กก.
		// และหักออกจากต้นทุนล็อตนี้ (เม็ดที่กลับมาใช้ซ้ำไม่ใช่ต้นทุนของชิ้นงาน — ไปเป็นต้นทุนตอนนำเศษไปใช้ต่อ)
		double runnerKg = 0;
		// สินค้าเป็นชุด (เช่น ซ้าย+ขวา = 2 ชิ้น/ชุด): 1 ช็อต ได้ (คาวิตี้ ÷ ชิ้นต่อชุด) ชุด → ช็อต = ผลิต(ชุด) × ชิ้นต่อชุด ÷ คาวิตี้
		double ppu = snap.isPresent() ? Math.max(1, Json.num(snap.get().get("piecesPerUnit"))) : 1;
		if (snap.isPresent()) {
			Map<String, Object> sn = snap.get();
			double rwg = Json.num(sn.get("runnerWeight")), cav = Json.num(sn.get("cavities"));
			String target = Json.s(sn.get("regrindItem"));
			if (rwg > 0 && cav >= 1 && !target.isEmpty()) {
				double kg = Json.r3(Math.ceil(produced * ppu / cav) * rwg / 1000d);
				java.util.Optional<String> ts = kg > 0 ? repo.getForUpdate("materials", target) : java.util.Optional.empty();
				if (ts.isPresent()) {
					double kgSum = 0, valSum = 0;
					if (sn.get("lines") instanceof List<?> sl) for (Object lo : sl) {
						if (!(lo instanceof Map<?, ?> l) || !"resin".equals(String.valueOf(l.get("type")))) continue;
						java.util.Optional<String> rs = repo.get("materials", String.valueOf(l.get("item")));
						if (rs.isEmpty()) continue;
						kgSum += Json.num(l.get("qty"));
						valSum += Json.num(l.get("qty")) * Json.num(json.map(rs.get()).get("cost"));
					}
					double unitCost = kgSum > 0 ? valSum / kgSum : 0, value = kg * unitCost;
					Map<String, Object> rm = json.map(ts.get());
					double stock0 = Math.max(0, Json.num(rm.get("stock"))), cost0 = Json.num(rm.get("cost")), newStock = Json.r3(stock0 + kg);
					rm.put("stock", newStock);
					if (unitCost > 0) {
						double newCost = cost0 > 0 && stock0 > 0 ? r4((stock0 * cost0 + value) / newStock) : r4(unitCost);
						if (Math.abs(newCost - cost0) > 1e-9) {
							List<Object> hist = rm.get("costHistory") instanceof List<?> h ? new ArrayList<>(h) : new ArrayList<>();
							Map<String, Object> he = new LinkedHashMap<>();
							he.put("date", LocalDate.now(BKK).toString());
							he.put("cost", newCost);
							he.put("prev", cost0);
							he.put("by", u.fullName());
							he.put("ref", woId);
							he.put("note", "รับรันเนอร์กลับจากการผลิต " + kg + " กก. @ " + r4(unitCost));
							hist.add(he);
							rm.put("cost", newCost);
							rm.put("costHistory", hist);
						}
					}
					save("materials", rm, u);
					logMove(u, "IN", Json.s(rm.get("code")), kg, Json.s(rm.get("unit")), woId, "รับรันเนอร์กลับเป็นเศษรีไซเคิล (" + (long) Math.ceil(produced * ppu / cav) + " ช็อต × " + rwg + " กรัม)");
					batchCost = Math.max(0, batchCost - value);
					runnerKg = kg;
					wo.put("runnerRecovered", Json.r3(Json.num(wo.get("runnerRecovered")) + kg));
				}
			}
		}
		// วัตถุดิบที่เบิกเพิ่ม/คืนเข้าใบสั่งผลิตนี้และยังไม่ถูกรวมในต้นทุน → รวมเข้าล็อตที่มีชิ้นดี (ไม่ให้สูญหายเมื่อล็อตนี้เป็น NG ทั้งหมด)
		if (good > 0 && Math.abs(Json.num(wo.get("pendingExtraCost"))) > 1e-9) {
			batchCost += Json.num(wo.get("pendingExtraCost"));
			wo.put("pendingExtraCost", 0);
		}
		List<String> fgIds = jdbc.queryForList("select id from erp_records where collection='finished' and data->>'code' = ? for update", String.class, productCode);
		if (!fgIds.isEmpty() && good > 0) {
			Map<String, Object> fg = lock("finished", fgIds.get(0), "ไม่พบสินค้า");
			double oldStock = Math.max(0, Json.num(fg.get("stock"))), oldCost = Json.num(fg.get("cost"));
			fg.put("stock", Json.num(fg.get("stock")) + good);
			// ต้นทุนสินค้าสำเร็จรูป = ถัวเฉลี่ยถ่วงน้ำหนัก (ของเดิม + ต้นทุนวัตถุดิบจริงของล็อตนี้ ÷ ชิ้นดี) — ต้นทุนเดิม 0 = ยังไม่เคยมีต้นทุน ไม่นำมาเฉลี่ย
			if (batchCost > 0) {
				double baseVal = oldCost > 0 ? oldStock * oldCost : 0, baseQty = oldCost > 0 ? oldStock : 0;
				newFgCost = r4((baseVal + batchCost) / (baseQty + good));
				List<Object> hist = fg.get("costHistory") instanceof List<?> h ? new ArrayList<>(h) : new ArrayList<>();
				Map<String, Object> he = new LinkedHashMap<>();
				he.put("date", LocalDate.now(BKK).toString());
				he.put("cost", newFgCost);
				he.put("prev", oldCost);
				he.put("by", u.fullName());
				he.put("ref", woId);
				he.put("note", "ต้นทุนผลิตจริง: วัตถุดิบ " + r4(batchCost) + " บาท ÷ ชิ้นดี " + (long) good + (noCost.isEmpty() ? "" : " (ยังไม่มีต้นทุน: " + String.join(", ", noCost) + ")"));
				hist.add(he);
				fg.put("cost", newFgCost);
				fg.put("costHistory", hist);
			}
			save("finished", fg, u);
			logMove(u, "IN", Json.s(fg.get("code")), good, fg.get("unit") == null ? "PCS" : Json.s(fg.get("unit")), woId, "รับเข้าสินค้าสำเร็จรูปจากการผลิต");
		}
		if (wo.get("mold") != null) {
			java.util.Optional<String> ms = repo.getForUpdate("molds", String.valueOf(wo.get("mold")));
			if (ms.isPresent()) {
				Map<String, Object> mold = json.map(ms.get());
				double cav = Math.max(1, mold.get("cavities") != null ? Json.num(mold.get("cavities")) : Math.max(1, Json.num(wo.get("cavities"))));
				mold.put("shots", (long) (Json.num(mold.get("shots")) + Math.ceil(produced * ppu / cav)));
				save("molds", mold, u);
			}
		}
		wo.put("produced", Json.num(wo.get("produced")) + produced);
		wo.put("ng", Json.num(wo.get("ng")) + ng);
		if (batchCost > 0) wo.put("materialCost", r4(Json.num(wo.get("materialCost")) + batchCost));
		List<Object> logs = new ArrayList<>();
		Map<String, Object> entry = new LinkedHashMap<>();
		entry.put("at", nowStr());
		entry.put("by", u.fullName());
		entry.put("produced", produced);
		entry.put("ng", ng);
		entry.put("shift", shift);
		entry.put("supervisor", supervisor);
		entry.put("operator", operator);
		logs.add(entry);
		if (wo.get("logs") instanceof List<?> old) logs.addAll(old);
		wo.put("logs", logs);
		String st = Json.s(wo.get("status"));
		if ("queued".equals(st) || "setup".equals(st)) wo.put("status", "running");
		if (Json.num(wo.get("produced")) - Json.num(wo.get("ng")) >= Json.num(wo.get("quantity"))) {
			wo.put("status", "done");
			if (Json.s(wo.get("doneAt")).isBlank()) wo.put("doneAt", nowStr());   // วันเวลาที่งานเสร็จจริง (ใช้แสดงงานที่เพิ่งเสร็จบนบอร์ด)
		}
		save("workOrders", wo, u);

		if (wo.get("machine") != null) {
			java.util.Optional<String> mcs = repo.getForUpdate("machines", String.valueOf(wo.get("machine")));
			if (mcs.isPresent()) {
				Map<String, Object> mc = json.map(mcs.get());
				boolean done = "done".equals(Json.s(wo.get("status")));
				mc.put("status", done ? "idle" : "running");
				if (done) mc.remove("workOrder"); else mc.put("workOrder", woId);
				save("machines", mc, u);
			}
		}
		audit.log(u, "PRODUCE", "ใบสั่งผลิต", woId, "ผลิต " + (long) produced + " ชิ้น (NG " + (long) ng + ") · ตัดวัตถุดิบ " + consumed.size() + " รายการ");
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("ok", true);
		out.put("consumed", consumed);
		out.put("good", good);
		out.put("hasBom", snap.isPresent());
		out.put("materialCost", r4(batchCost));
		if (runnerKg > 0) out.put("runnerRecoveredKg", runnerKg);
		if (newFgCost != null) out.put("unitCost", newFgCost);
		if (!noCost.isEmpty()) out.put("noCost", noCost);
		return out;
	}

	// ---------- เบิกวัตถุดิบเพิ่ม / คืนวัตถุดิบ เข้าใบสั่งผลิต ----------
	/**
	 * kind = ISSUE: เบิกวัตถุดิบเพิ่มนอกสูตร (ตัดสต๊อก) · RETURN: คืนวัตถุดิบที่เบิกเพิ่มไว้ (คืนได้ไม่เกินยอดเบิกสุทธิของวัตถุดิบนั้นในใบนี้)
	 * มูลค่า (เบิก ณ ต้นทุนถัวเฉลี่ยปัจจุบัน / คืน ณ ต้นทุนเฉลี่ยของที่เบิกไป) สะสมใน pendingExtraCost แล้วรวมเข้าต้นทุนสินค้าสำเร็จรูปในการบันทึกผลิตครั้งถัดไป
	 * ทำได้เฉพาะใบสั่งผลิตที่ยังไม่ปิด (queued / setup / running)
	 */
	@Transactional
	public Map<String, Object> issueWoMaterial(AuthUser u, String woId, String materialId, double qty, String kind, String reason) {
		need(u, "admin", "production");
		boolean ret = "RETURN".equalsIgnoreCase(kind);
		if (!ret && !"ISSUE".equalsIgnoreCase(kind)) throw ApiException.badRequest("ประเภทต้องเป็น ISSUE (เบิกเพิ่ม) หรือ RETURN (คืน)");
		if (!(qty > 0) || Double.isInfinite(qty)) throw ApiException.badRequest("จำนวนต้องมากกว่า 0");
		if (reason == null || reason.isBlank()) throw ApiException.badRequest("ต้องระบุเหตุผล");
		qty = Json.r3(qty);
		Map<String, Object> wo = lock("workOrders", woId, "ไม่พบใบสั่งผลิต " + woId);
		String st = Json.s(wo.get("status"));
		boolean open = st.equals("queued") || st.equals("setup") || st.equals("running");
		boolean doneReturn = ret && st.equals("done"); // ผลิตเสร็จแล้วคืนวัตถุดิบที่เหลือได้ (เบิกเพิ่มต้องทำก่อนปิดงาน)
		if (!open && !doneReturn) {
			throw ApiException.conflict("WO_CLOSED", "เบิกเพิ่มได้เฉพาะใบสั่งผลิตที่ยังไม่ปิด และคืนวัตถุดิบได้เฉพาะใบที่ยังไม่ปิดหรือปิดแล้ว (สถานะปัจจุบัน " + st + ")");
		}
		java.util.Optional<String> ms = repo.getForUpdate("materials", materialId);
		if (ms.isEmpty()) throw ApiException.unprocessable("MATERIAL_NOT_FOUND", "ไม่พบวัตถุดิบ " + materialId);
		Map<String, Object> m = json.map(ms.get());
		List<Object> issues = new ArrayList<>();
		if (wo.get("extraIssues") instanceof List<?> old) issues.addAll(old);
		double netQty = 0, netVal = 0;
		for (Object o : issues) {
			if (o instanceof Map<?, ?> e && materialId.equals(String.valueOf(e.get("item")))) {
				netQty += Json.num(e.get("qty")) * ("RETURN".equals(String.valueOf(e.get("kind"))) ? -1 : 1);
				netVal += Json.num(e.get("value")) * ("RETURN".equals(String.valueOf(e.get("kind"))) ? -1 : 1);
			}
		}
		double unitCost, value, stock = Json.num(m.get("stock"));
		if (ret) {
			if (qty > netQty + 1e-6) throw ApiException.unprocessable("RETURN_TOO_MUCH", "คืนได้ไม่เกินยอดที่เบิกเพิ่มไว้ในใบนี้ (" + Json.r3(Math.max(0, netQty)) + " " + Json.s(m.get("unit")) + ")");
			unitCost = netQty > 0 ? netVal / netQty : Json.num(m.get("cost"));
			m.put("stock", Json.r3(stock + qty));
		} else {
			if (stock < qty) throw ApiException.unprocessable("INSUFFICIENT_MATERIAL", "วัตถุดิบ " + Json.s(m.get("code")) + " ไม่พอ (คงเหลือ " + Json.r3(stock) + " ต้องการ " + qty + ")");
			unitCost = Json.num(m.get("cost"));
			m.put("stock", Json.r3(stock - qty));
		}
		value = r4(qty * unitCost) * (ret ? -1 : 1);
		save("materials", m, u);
		logMove(u, ret ? "IN" : "OUT", Json.s(m.get("code")), qty, Json.s(m.get("unit")), woId, (ret ? "คืนวัตถุดิบจาก " : "เบิกวัตถุดิบเพิ่มเข้า ") + woId + " · " + reason.trim());
		Map<String, Object> e = new LinkedHashMap<>();
		e.put("at", nowStr());
		e.put("by", u.fullName());
		e.put("kind", ret ? "RETURN" : "ISSUE");
		e.put("item", materialId);
		e.put("code", m.get("code"));
		e.put("name", m.get("name"));
		e.put("qty", qty);
		e.put("unit", m.get("unit"));
		e.put("unitCost", r4(unitCost));
		e.put("value", r4(Math.abs(value)));
		e.put("reason", reason.trim());
		issues.add(0, e);
		wo.put("extraIssues", issues);
		Double newFgCost = null;
		if (doneReturn) {
			// ใบปิดแล้ว: ต้นทุนถูกรวมในสินค้าไปแล้ว → ลดต้นทุนใบสั่งผลิต และลดต้นทุนเฉลี่ยสินค้าสำเร็จรูปตามมูลค่าที่คืน ÷ สต๊อกสินค้าปัจจุบัน
			wo.put("materialCost", r4(Math.max(0, Json.num(wo.get("materialCost")) + value)));
			List<String> fgIds = jdbc.queryForList("select id from erp_records where collection='finished' and data->>'code' = ? for update", String.class, Json.s(wo.get("productCode")));
			if (!fgIds.isEmpty()) {
				Map<String, Object> fg = lock("finished", fgIds.get(0), "ไม่พบสินค้า");
				double fs = Json.num(fg.get("stock")), fc = Json.num(fg.get("cost"));
				if (fs > 0 && fc > 0) {
					newFgCost = r4(Math.max(0.0001, (fs * fc + value) / fs));
					List<Object> hist = fg.get("costHistory") instanceof List<?> h ? new ArrayList<>(h) : new ArrayList<>();
					Map<String, Object> he = new LinkedHashMap<>();
					he.put("date", LocalDate.now(BKK).toString());
					he.put("cost", newFgCost);
					he.put("prev", fc);
					he.put("by", u.fullName());
					he.put("ref", woId);
					he.put("note", "คืนวัตถุดิบหลังปิดงาน " + Json.s(m.get("code")) + " " + qty + " " + Json.s(m.get("unit")) + " (" + r4(-value) + " บาท) · " + reason.trim());
					hist.add(he);
					fg.put("cost", newFgCost);
					fg.put("costHistory", hist);
					save("finished", fg, u);
				}
			}
		} else {
			wo.put("pendingExtraCost", r4(Json.num(wo.get("pendingExtraCost")) + value));
		}
		save("workOrders", wo, u);
		audit.log(u, ret ? "RETURN_MATERIAL" : "ISSUE_MATERIAL", "ใบสั่งผลิต", woId, Json.s(m.get("code")) + " " + (ret ? "-" : "+") + qty + " " + Json.s(m.get("unit")) + " · " + reason.trim());
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("ok", true);
		out.put("stock", Json.num(m.get("stock")));
		out.put("value", r4(value));
		out.put("pendingExtraCost", Json.num(wo.get("pendingExtraCost")));
		if (newFgCost != null) out.put("unitCost", newFgCost);
		return out;
	}
}
