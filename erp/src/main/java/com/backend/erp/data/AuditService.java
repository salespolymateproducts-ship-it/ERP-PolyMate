package com.backend.erp.data;

import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.backend.erp.auth.AuthUser;

/** Audit log แบบ append-only (ตารางมี trigger กันแก้/ลบ) */
@Service
public class AuditService {
	private final JdbcTemplate jdbc;

	public AuditService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

	/** client ส่ง header X-Client-Audit → ไม่บันทึก CREATE/UPDATE/DELETE ซ้ำ (client ส่งรายละเอียดเองผ่าน POST /audit-logs) */
	public static final ThreadLocal<Boolean> QUIET = ThreadLocal.withInitial(() -> false);

	public void log(AuthUser u, String action, String entity, String entityId, String detail) {
		if (QUIET.get() && (action.equals("CREATE") || action.equals("UPDATE") || action.equals("DELETE"))) return;
		jdbc.update("insert into erp_audit_logs(user_name, role, action, entity, entity_id, detail) values (?,?,?,?,?,?)",
			u == null ? "ระบบ" : u.fullName(), u == null ? "—" : u.role(), action, entity,
			entityId == null || entityId.isBlank() ? "—" : entityId, detail == null ? "" : detail);
	}

	private static final String SEL =
		"json_build_object('id', id::text, 'at', to_char(at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS'), " +
		"'user', user_name, 'role', role, 'action', action, 'entity', entity, 'entityId', entity_id, 'detail', detail)::text";

	public List<String> search(String q, String action, String entity, String user, String from, String to, int limit, int offset) {
		StringBuilder sql = new StringBuilder("select " + SEL + " from erp_audit_logs where 1=1");
		java.util.ArrayList<Object> args = new java.util.ArrayList<>();
		if (q != null && !q.isBlank()) {
			sql.append(" and (detail ilike ? or entity_id ilike ? or entity ilike ?)");
			String p = "%" + q.trim() + "%";
			args.add(p); args.add(p); args.add(p);
		}
		if (action != null && !action.isBlank()) { sql.append(" and action = ?"); args.add(action); }
		if (entity != null && !entity.isBlank()) { sql.append(" and entity = ?"); args.add(entity); }
		if (user != null && !user.isBlank()) { sql.append(" and user_name = ?"); args.add(user); }
		if (from != null && !from.isBlank()) { sql.append(" and at >= ?::date"); args.add(from); }
		if (to != null && !to.isBlank()) { sql.append(" and at < (?::date + 1)"); args.add(to); }
		sql.append(" order by id desc limit ? offset ?");
		args.add(limit); args.add(offset);
		return jdbc.queryForList(sql.toString(), String.class, args.toArray());
	}
}
