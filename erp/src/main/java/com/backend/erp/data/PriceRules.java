package com.backend.erp.data;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.backend.erp.auth.AuthUser;
import com.backend.erp.common.ApiException;
import com.backend.erp.common.Json;

/**
 * กลุ่มราคา (ขั้นราคาตามจำนวนลังรวมของสินค้าในกลุ่ม) และสิทธิ์แก้ราคาในใบเสนอราคา / ใบสั่งขาย
 * วิธีคิดต้องตรงกับ Workflow.applyTierPrices ฝั่งหน้าเว็บ
 */
@Component
public class PriceRules {
	/** role ที่แก้ราคาขาย กลุ่มราคา และกำหนดราคาทับในเอกสารขายได้ */
	public static final Set<String> PRICE_ROLES = Set.of("admin", "sales");
	private static final Set<String> PRICED_DOCS = Set.of("QT", "SO");
	/** ล็อกต่อธุรกรรม กันสินค้าเดียวกันถูกใส่สองกลุ่มพร้อมกัน */
	private static final String GROUP_LOCK = "erp.pricegroup";

	private final RecordRepository repo;
	private final JdbcTemplate jdbc;
	private final Json json;

	public PriceRules(RecordRepository repo, JdbcTemplate jdbc, Json json) {
		this.repo = repo;
		this.jdbc = jdbc;
		this.json = json;
	}

	// ---------- ตรวจข้อมูลกลุ่มราคา ----------
	public void validateGroup(String id, Map<String, Object> g) {
		String name = Json.s(g.get("name")).trim();
		if (name.isEmpty()) throw ApiException.badRequest("ต้องระบุชื่อกลุ่มราคา");
		if (!(g.get("tiers") instanceof List<?> tiers) || tiers.isEmpty()) throw ApiException.badRequest("ต้องมีขั้นจำนวนอย่างน้อย 1 ขั้น");
		double prev = 0;
		for (Object t : tiers) {
			if (!(t instanceof Number n && n.doubleValue() >= 1 && n.doubleValue() == Math.rint(n.doubleValue()) && n.doubleValue() > prev)) {
				throw ApiException.badRequest("ขั้นจำนวน (ลัง) ต้องเป็นจำนวนเต็มตั้งแต่ 1 และเรียงจากน้อยไปมากโดยไม่ซ้ำ");
			}
			prev = n.doubleValue();
		}
		if (!(g.get("items") instanceof List<?> items) || items.isEmpty()) throw ApiException.badRequest("ต้องมีสินค้าในกลุ่มอย่างน้อย 1 รายการ");
		Set<String> codes = new HashSet<>();
		for (Object o : items) {
			if (!(o instanceof Map<?, ?> it)) throw ApiException.badRequest("รายการสินค้าในกลุ่มไม่ถูกต้อง");
			String code = Json.s(it.get("code"));
			if (code.isBlank() || !codes.add(code)) throw ApiException.badRequest("สินค้าในกลุ่มต้องมีรหัสและไม่ซ้ำกัน");
			Map<String, Object> fg = product(code);
			if (fg == null) throw ApiException.badRequest("ไม่พบสินค้า " + code);
			if (!(Json.num(fg.get("packSize")) >= 2)) throw ApiException.badRequest("สินค้า " + code + " ยังไม่ได้ตั้งจำนวนต่อลัง");
			if (!(it.get("prices") instanceof List<?> prices) || prices.size() != tiers.size()) throw ApiException.badRequest("สินค้า " + code + " ต้องมีราคาครบทุกขั้น");
			for (Object p : prices) {
				if (!(p instanceof Number n && n.doubleValue() >= 0 && !Double.isInfinite(n.doubleValue()))) {
					throw ApiException.badRequest("ราคาของสินค้า " + code + " ต้องเป็นตัวเลขไม่ติดลบ");
				}
			}
		}
		if (Boolean.FALSE.equals(g.get("active"))) return;
		jdbc.queryForObject("select pg_advisory_xact_lock(hashtext(?))::text", String.class, GROUP_LOCK);
		for (Map<String, Object> other : activeGroups()) {
			if (id.equals(Json.s(other.get("id")))) continue;
			for (String code : codes) {
				if (itemOf(other, code) != null) throw ApiException.conflict("DUPLICATE_GROUP_ITEM", "สินค้า " + code + " อยู่ในกลุ่มราคา " + Json.s(other.get("name")) + " แล้ว");
			}
		}
	}

	// ---------- สิทธิ์แก้ราคาในเอกสาร ----------
	/**
	 * role ที่ไม่มีสิทธิ์แก้ราคา: รายการของสินค้าในกลุ่มราคา (ใบเสนอราคา/ใบสั่งขาย) ต้อง (ก) เหมือนรายการที่บันทึกอยู่เดิม
	 * หรือ (ข) ตรงกับราคาในเอกสารต้นทาง หรือ (ค) เป็นราคาอัตโนมัติที่คำนวณถูกต้อง
	 */
	public void checkDocPricing(AuthUser u, Map<String, Object> cur, Map<String, Object> next) {
		if (PRICE_ROLES.contains(u.role()) || !PRICED_DOCS.contains(Json.s(next.get("type")))) return;
		List<Map<String, Object>> lines = lines(next), old = cur == null ? List.of() : lines(cur);
		List<Map<String, Object>> groups = activeGroups();
		Map<String, Long> cartons = new HashMap<>();
		for (Map<String, Object> l : lines) {
			Map<String, Object> g = groupOf(groups, Json.s(l.get("code")));
			Long n = cartonsOf(l);
			// นับรายการใหม่ และรายการจากใบเสนอราคาที่คิดราคาใหม่ (สั่งน้อยกว่าที่เสนอ) — ตรงกับ priceCounted ฝั่งหน้าเว็บ
			boolean counted = !(l.get("src") instanceof Map<?, ?>) || Boolean.TRUE.equals(l.get("repriced"));
			if (g != null && n != null && counted) cartons.merge(Json.s(g.get("id")), n, Long::sum);
		}
		for (Map<String, Object> l : lines) {
			String code = Json.s(l.get("code"));
			Map<String, Object> g = groupOf(groups, code);
			if (g == null || unchanged(old, l) || matchesSource(l)) continue;
			double expected = Json.num(product(code) == null ? null : product(code).get("price"));
			List<?> tiers = (List<?>) g.get("tiers");
			long total = cartons.getOrDefault(Json.s(g.get("id")), 0L);
			if (cartonsOf(l) != null) {
				for (int i = 0; i < tiers.size(); i++) {
					if (total >= Json.num(tiers.get(i))) expected = Json.num(((List<?>) itemOf(g, code).get("prices")).get(i));
				}
			}
			if (!"auto".equals(l.get("priceMode")) || Math.abs(Json.num(l.get("price")) - expected) > 0.005) {
				throw ApiException.forbidden("สินค้า " + code + " ใช้ราคาตามกลุ่มราคา — แก้ราคาเองได้เฉพาะผู้ดูแลระบบและฝ่ายขาย");
			}
		}
	}

	private static boolean unchanged(List<Map<String, Object>> old, Map<String, Object> l) {
		return old.stream().anyMatch(o -> Json.s(o.get("code")).equals(Json.s(l.get("code")))
			&& Math.abs(Json.num(o.get("price")) - Json.num(l.get("price"))) < 0.005
			&& Json.s(o.get("priceMode")).equals(Json.s(l.get("priceMode"))));
	}

	private boolean matchesSource(Map<String, Object> l) {
		if (!(l.get("src") instanceof Map<?, ?> src)) return false;
		return repo.get("docs", Json.s(src.get("doc"))).map(json::map).map(d -> {
			int i = (int) Json.num(src.get("line"));
			List<Map<String, Object>> s = lines(d);
			return i >= 0 && i < s.size() && Json.s(s.get(i).get("code")).equals(Json.s(l.get("code")))
				&& Math.abs(Json.num(s.get(i).get("price")) - Json.num(l.get("price"))) < 0.005;
		}).orElse(false);
	}

	/** จำนวนลังเต็มของรายการ (null = ไม่ได้ขายเป็นลัง หรือไม่เต็มลัง) */
	private static Long cartonsOf(Map<String, Object> l) {
		double pack = Json.num(l.get("packSize")), qty = Json.num(l.get("qty"));
		if (!(pack >= 2)) return null;
		long n = Math.round(qty / pack);
		return Math.abs(n * pack - qty) < 1e-6 ? n : null;
	}

	@SuppressWarnings("unchecked")
	private static List<Map<String, Object>> lines(Map<String, Object> doc) {
		List<Map<String, Object>> out = new ArrayList<>();
		if (doc.get("lines") instanceof List<?> l) for (Object o : l) if (o instanceof Map<?, ?> m) out.add((Map<String, Object>) m);
		return out;
	}

	private List<Map<String, Object>> activeGroups() {
		return repo.list("priceGroups", null, 5000, 0).stream().map(json::map).filter(g -> !Boolean.FALSE.equals(g.get("active"))).toList();
	}

	@SuppressWarnings("unchecked")
	private static Map<String, Object> itemOf(Map<String, Object> group, String code) {
		if (group.get("items") instanceof List<?> items) {
			for (Object o : items) if (o instanceof Map<?, ?> m && code.equals(Json.s(m.get("code")))) return (Map<String, Object>) m;
		}
		return null;
	}

	private static Map<String, Object> groupOf(List<Map<String, Object>> groups, String code) {
		return groups.stream().filter(g -> itemOf(g, code) != null).findFirst().orElse(null);
	}

	private Map<String, Object> product(String code) {
		List<String> r = jdbc.queryForList("select data::text from erp_records where collection = 'finished' and data->>'code' = ? limit 1", String.class, code);
		return r.isEmpty() ? null : json.map(r.get(0));
	}
}
