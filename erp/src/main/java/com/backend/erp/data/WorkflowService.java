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
		need(u, "admin");
		if (reason == null || reason.isBlank()) throw ApiException.badRequest("ต้องระบุเหตุผลการปรับต้นทุน");
		if (!(newCost >= 0) || Double.isInfinite(newCost)) throw ApiException.badRequest("ต้นทุนต้องเป็นตัวเลขไม่ติดลบ");
		Map<String, Object> m = lock("materials", id, "ไม่พบวัตถุดิบ " + id);
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
		save("materials", m, u);
		audit.log(u, "ADJUST_COST", "วัตถุดิบ", id, old + " → " + next + " · " + reason.trim());
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
		List<Double> matchedQty = new ArrayList<>();
		List<Double> matchedPrice = new ArrayList<>();
		int idx = 0;
		for (Object lo : lines) {
			idx++;
			if (!(lo instanceof Map<?, ?> raw)) throw ApiException.unprocessable("PO_LINE_INVALID", poId + " รายการที่ " + idx + " ไม่ถูกต้อง");
			@SuppressWarnings("unchecked") Map<String, Object> line = (Map<String, Object>) raw;
			double qty = Json.num(line.get("qty"));
			String label = Json.s(line.get("name")).isBlank() ? Json.s(line.get("item")) : Json.s(line.get("name"));
			if (!(qty > 0)) throw ApiException.unprocessable("PO_LINE_INVALID", poId + " รายการที่ " + idx + " (" + label + ") จำนวนต้องมากกว่า 0");
			Map<String, Object> m = matchMaterial(line);
			if (m == null) {
				throw ApiException.unprocessable("MATERIAL_NOT_FOUND", poId + " รายการที่ " + idx + " (" + label + ") ไม่พบวัตถุดิบในทะเบียน จึงรับเข้าคลังไม่ได้ — ไม่มีการรับเข้าสต๊อกรายการใดเลย กรุณาแก้ไขรายการ (ยกเลิก PO แล้วออกใหม่โดยเลือกวัตถุดิบจากทะเบียน)");
			}
			matchedIds.add(String.valueOf(m.get("id")));
			matchedQty.add(qty);
			matchedPrice.add(Json.num(line.get("price")));
		}
		// ขั้น 2: เพิ่มสต๊อก + บันทึก movement (ทั้งหมดอยู่ในธุรกรรมเดียวกับการเปลี่ยนสถานะ PO)
		for (int k = 0; k < matchedIds.size(); k++) {
			double qty = matchedQty.get(k);
			Map<String, Object> m = lock("materials", matchedIds.get(k), "ไม่พบวัตถุดิบ");
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
			save("materials", m, u);
			logMove(u, "IN", Json.s(m.get("code")), qty, Json.s(m.get("unit")), poId, "รับเข้าจาก " + Json.s(po.get("supplierName")), extra);
			Map<String, Object> r = new LinkedHashMap<>();
			r.put("code", m.get("code"));
			r.put("qty", qty);
			r.put("unit", m.get("unit"));
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
			exp.put("category", "วัตถุดิบ");
			exp.put("vendor", po.get("supplierName"));
			exp.put("desc", "รับของตาม " + poId + " (" + lines.size() + " รายการ)");
			exp.put("amount", po.get("subtotal"));
			exp.put("vat", po.get("vat"));
			exp.put("whtRate", po.get("whtRate") == null ? 0 : po.get("whtRate"));
			exp.put("status", "approved");
			exp.put("ref", poId);
			exp.put("due", LocalDate.now(BKK).plusDays(30).toString());
			repo.insert("expenses", expId, json.str(exp), u.username());
		}
		audit.log(u, "RECEIVE", "ใบสั่งซื้อ", poId, "รับเข้าสต๊อก " + received.size() + " รายการ · ตั้งเจ้าหนี้ " + expId);
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("ok", true);
		out.put("received", received);
		out.put("expenseId", expId);
		return out;
	}

	// ---------- produce WO ----------
	@Transactional
	public Map<String, Object> produceWO(AuthUser u, String woId, double produced, double ng) {
		need(u, "admin", "production");
		Map<String, Object> wo = lock("workOrders", woId, "ไม่พบใบสั่งผลิต " + woId);
		if ("cancelled".equals(Json.s(wo.get("status")))) throw ApiException.conflict("ALREADY_CANCELLED", woId + " ถูกยกเลิกแล้ว");
		if (!(produced > 0)) throw ApiException.badRequest("จำนวนผลิตต้องมากกว่า 0");
		if (ng > produced) throw ApiException.badRequest("จำนวน NG มากกว่าจำนวนผลิต");
		double good = produced - ng;
		String productCode = Json.s(wo.get("productCode"));

		// สูตรที่ใช้ตัดวัตถุดิบ = snapshot ของใบสั่งผลิต (ใบเก่าที่ไม่มี snapshot ใช้สูตรหลักปัจจุบันของสินค้า)
		java.util.Optional<Map<String, Object>> snap = boms.effectiveSnapshot(wo);
		List<Map<String, Object>> consumed = new ArrayList<>();
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
				logMove(u, "OUT", Json.s(m.get("code")), use, Json.s(m.get("unit")), woId, "ตัดสต๊อกผลิต " + Json.s(wo.get("product")));
				Map<String, Object> c = new LinkedHashMap<>();
				c.put("code", m.get("code"));
				c.put("qty", use);
				c.put("unit", m.get("unit"));
				consumed.add(c);
			}
		}
		List<String> fgIds = jdbc.queryForList("select id from erp_records where collection='finished' and data->>'code' = ? for update", String.class, productCode);
		if (!fgIds.isEmpty() && good > 0) {
			Map<String, Object> fg = lock("finished", fgIds.get(0), "ไม่พบสินค้า");
			fg.put("stock", Json.num(fg.get("stock")) + good);
			save("finished", fg, u);
			logMove(u, "IN", Json.s(fg.get("code")), good, fg.get("unit") == null ? "PCS" : Json.s(fg.get("unit")), woId, "รับเข้าสินค้าสำเร็จรูปจากการผลิต");
		}
		if (wo.get("mold") != null) {
			java.util.Optional<String> ms = repo.getForUpdate("molds", String.valueOf(wo.get("mold")));
			if (ms.isPresent()) {
				Map<String, Object> mold = json.map(ms.get());
				double cav = Math.max(1, mold.get("cavities") != null ? Json.num(mold.get("cavities")) : Math.max(1, Json.num(wo.get("cavities"))));
				mold.put("shots", (long) (Json.num(mold.get("shots")) + Math.ceil(produced / cav)));
				save("molds", mold, u);
			}
		}
		wo.put("produced", Json.num(wo.get("produced")) + produced);
		wo.put("ng", Json.num(wo.get("ng")) + ng);
		List<Object> logs = new ArrayList<>();
		Map<String, Object> entry = new LinkedHashMap<>();
		entry.put("at", nowStr());
		entry.put("by", u.fullName());
		entry.put("produced", produced);
		entry.put("ng", ng);
		logs.add(entry);
		if (wo.get("logs") instanceof List<?> old) logs.addAll(old);
		wo.put("logs", logs);
		String st = Json.s(wo.get("status"));
		if ("queued".equals(st) || "setup".equals(st)) wo.put("status", "running");
		if (Json.num(wo.get("produced")) - Json.num(wo.get("ng")) >= Json.num(wo.get("quantity"))) wo.put("status", "done");
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
		return out;
	}
}
