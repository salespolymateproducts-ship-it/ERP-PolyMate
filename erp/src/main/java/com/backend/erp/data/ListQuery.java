package com.backend.erp.data;

import com.backend.erp.common.ApiException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * พารามิเตอร์รายการฝั่งเซิร์ฟเวอร์สำหรับหน้าการเงิน: ค้นหา (q) · ช่วงวันที่ (from/to) · เรียง (sort/dir) · แบ่งหน้า (page/size)
 * ถ้าไม่ส่ง page → คืนรายการทั้งหมด (ไม่ตัดที่ 500 แล้ว) ถ้าส่ง page → คืน {items,total,page,size}
 * ชื่อคอลัมน์เรียงรับเฉพาะที่ service กำหนดไว้ (กัน SQL injection)
 */
final class ListQuery {
	static final int MAX_SIZE = 200;
	final String q, sort;
	final boolean desc;
	final LocalDate from, to;
	final Integer page;
	final int size;

	private ListQuery(String q, LocalDate from, LocalDate to, String sort, boolean desc, Integer page, int size) {
		this.q = q; this.from = from; this.to = to; this.sort = sort; this.desc = desc; this.page = page; this.size = size;
	}

	static ListQuery of(Map<String, String> p) {
		if (p == null) p = Map.of();
		Integer page = null;
		int size = 50;
		try {
			if (p.get("page") != null && !p.get("page").isBlank()) page = Math.max(1, Integer.parseInt(p.get("page").trim()));
			if (p.get("size") != null && !p.get("size").isBlank()) size = Math.min(MAX_SIZE, Math.max(1, Integer.parseInt(p.get("size").trim())));
		} catch (NumberFormatException e) { throw ApiException.badRequest("page/size ต้องเป็นตัวเลข"); }
		return new ListQuery(p.getOrDefault("q", "").trim(), date(p.get("from"), "from"), date(p.get("to"), "to"), p.getOrDefault("sort", "").trim(), "desc".equalsIgnoreCase(p.get("dir")), page, size);
	}

	private static LocalDate date(String s, String name) {
		if (s == null || s.isBlank()) return null;
		try { return LocalDate.parse(s.trim()); } catch (DateTimeParseException e) { throw ApiException.badRequest("รูปแบบวันที่ " + name + " ต้องเป็น YYYY-MM-DD"); }
	}

	boolean paged() { return page != null; }

	/** ต่อเงื่อนไขค้นหา/ช่วงวันที่ — searchExpr = นิพจน์ SQL ข้อความรวมที่ค้นได้, dateCol = คอลัมน์วันที่ */
	void where(StringBuilder sql, List<Object> args, String searchExpr, String dateCol) {
		if (!q.isEmpty()) {
			for (String w : q.toLowerCase().split("\s+")) {
				sql.append(" and lower(").append(searchExpr).append(") like ? escape '\'");
				args.add("%" + w.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%");
			}
		}
		if (from != null) { sql.append(" and ").append(dateCol).append(" >= ?"); args.add(from); }
		if (to != null) { sql.append(" and ").append(dateCol).append(" <= ?"); args.add(to); }
	}

	/** sorts: คีย์ที่ client ส่งมา → นิพจน์ SQL ; ไม่รู้จัก → ใช้ค่าเริ่มต้น (เลขเอกสารเป็นตัวตัดสินท้ายสุดเพื่อให้แบ่งหน้านิ่ง) */
	String orderBy(Map<String, String> sorts, String dflt, String tiebreak) {
		String col = sorts.get(sort);
		if (col == null) return " order by " + dflt;
		return " order by " + col + (desc ? " desc" : " asc") + " nulls last, " + tiebreak;
	}

	String limit() { return paged() ? " limit " + size + " offset " + (long) (page - 1) * size : ""; }

	Object wrap(List<Map<String, Object>> items, long total) {
		if (!paged()) return items;
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("items", items); m.put("total", total); m.put("page", page); m.put("size", size);
		return m;
	}
}
