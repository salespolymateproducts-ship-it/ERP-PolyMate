package com.backend.erp.data;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class RecordRepository {
	/** ใส่ _version ลงใน JSON ที่ส่งออก เพื่อให้ client ใช้ optimistic lock */
	public static final String SEL = "(data || jsonb_build_object('_version', version))::text";
	private final JdbcTemplate jdbc;

	public RecordRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

	public List<String> list(String coll, String q, int limit, int offset) {
		ArrayList<Object> args = new ArrayList<>();
		StringBuilder sql = new StringBuilder("select " + SEL + " from erp_records where collection = ?");
		args.add(coll);
		if (q != null && !q.isBlank()) {
			sql.append(" and data::text ilike ?");
			args.add("%" + q.trim() + "%");
		}
		sql.append(" order by seq desc limit ? offset ?");
		args.add(limit);
		args.add(offset);
		return jdbc.queryForList(sql.toString(), String.class, args.toArray());
	}

	public Optional<String> get(String coll, String id) {
		List<String> r = jdbc.queryForList("select " + SEL + " from erp_records where collection = ? and id = ?", String.class, coll, id);
		return r.stream().findFirst();
	}

	/** lock แถวเพื่อทำ read-modify-write ใน transaction */
	public Optional<String> getForUpdate(String coll, String id) {
		List<String> r = jdbc.queryForList("select " + SEL + " from erp_records where collection = ? and id = ? for update", String.class, coll, id);
		return r.stream().findFirst();
	}

	public void insert(String coll, String id, String json, String by) {
		jdbc.update("insert into erp_records(collection, id, data, created_by, updated_by) values (?,?,?::jsonb,?,?)", coll, id, json, by, by);
	}

	/** @return จำนวนแถวที่แก้ (0 = version ไม่ตรง/ไม่พบ) */
	public int update(String coll, String id, String json, Integer expectedVersion, String by) {
		if (expectedVersion != null) {
			return jdbc.update("update erp_records set data=?::jsonb, version=version+1, updated_at=now(), updated_by=? where collection=? and id=? and version=?",
				json, by, coll, id, expectedVersion);
		}
		return jdbc.update("update erp_records set data=?::jsonb, version=version+1, updated_at=now(), updated_by=? where collection=? and id=?",
			json, by, coll, id);
	}

	public boolean delete(String coll, String id) {
		return jdbc.update("delete from erp_records where collection=? and id=?", coll, id) > 0;
	}

	public void deleteAll(String coll) { jdbc.update("delete from erp_records where collection=?", coll); }

	public long count(String coll) {
		Long n = jdbc.queryForObject("select count(*) from erp_records where collection=?", Long.class, coll);
		return n == null ? 0 : n;
	}
}
