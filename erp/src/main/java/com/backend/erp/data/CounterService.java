package com.backend.erp.data;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.backend.erp.common.ApiException;

/** เลขที่เอกสาร: PREFIX + YYYY + MM + NNNN (เหมือน Store.nextDocNo เดิม) — atomic ด้วย upsert */
@Service
public class CounterService {
	private final JdbcTemplate jdbc;

	public CounterService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

	static String key(String prefix, String date) {
		if (prefix == null || !prefix.matches("[A-Za-z]{1,8}")) throw ApiException.badRequest("prefix ไม่ถูกต้อง");
		LocalDate d;
		try { d = (date == null || date.isBlank()) ? LocalDate.now() : LocalDate.parse(date.substring(0, 10)); }
		catch (Exception e) { throw ApiException.badRequest("วันที่ไม่ถูกต้อง"); }
		return prefix + d.getYear() + String.format("%02d", d.getMonthValue());
	}

	private Map<String, Object> shape(String k, int seq) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("docNo", k + String.format("%04d", seq));
		m.put("seq", seq);
		m.put("counterKey", k);
		return m;
	}

	public Map<String, Object> peek(String prefix, String date) {
		String k = key(prefix, date);
		Integer cur = jdbc.query("select last_value from erp_counters where counter_key=?", rs -> rs.next() ? rs.getInt(1) : 0, k);
		return shape(k, (cur == null ? 0 : cur) + 1);
	}

	public Map<String, Object> next(String prefix, String date) {
		String k = key(prefix, date);
		Integer seq = jdbc.queryForObject(
			"insert into erp_counters(counter_key,last_value) values (?,1) on conflict (counter_key) do update set last_value = erp_counters.last_value + 1 returning last_value",
			Integer.class, k);
		return shape(k, seq == null ? 1 : seq);
	}

	/** คืนเลขเฉพาะกรณีเป็นเลขล่าสุดจริง (ลบเอกสารล่าสุด) */
	public void releaseIfLast(String counterKey, int seq) {
		jdbc.update("update erp_counters set last_value = last_value - 1 where counter_key=? and last_value=? and last_value > 0", counterKey, seq);
	}

	public Map<String, Object> all() {
		Map<String, Object> m = new LinkedHashMap<>();
		jdbc.query("select counter_key, last_value from erp_counters", rs -> { m.put(rs.getString(1), rs.getInt(2)); });
		return m;
	}

	public void mergeMax(Map<String, Object> counters) {
		counters.forEach((k, v) -> {
			if (v instanceof Number n && k.matches("[A-Za-z]{1,8}\\d{6}")) {
				jdbc.update("insert into erp_counters(counter_key,last_value) values (?,?) on conflict (counter_key) do update set last_value = greatest(erp_counters.last_value, excluded.last_value)", k, n.intValue());
			}
		});
	}

	public void replaceAll(Map<String, Object> counters) {
		jdbc.update("delete from erp_counters");
		if (counters == null) return;
		counters.forEach((k, v) -> {
			if (v instanceof Number n) jdbc.update("insert into erp_counters(counter_key,last_value) values (?,?)", k, n.intValue());
		});
	}
}
