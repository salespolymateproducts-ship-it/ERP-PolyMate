package com.backend.erp.auth;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.backend.erp.common.ApiException;
import com.backend.erp.data.AuditService;

@Service
public class UserAdminService {
	private static final List<String> ROLES = List.of("admin", "sales", "production", "procurement", "accounting");
	private final JdbcTemplate jdbc;
	private final AuthService auth;
	private final AuditService audit;

	public UserAdminService(JdbcTemplate jdbc, AuthService auth, AuditService audit) {
		this.jdbc = jdbc;
		this.auth = auth;
		this.audit = audit;
	}

	private static void admin(AuthUser u) {
		if (!u.isAdmin()) throw ApiException.forbidden("เฉพาะผู้ดูแลระบบ");
	}

	public List<Map<String, Object>> list(AuthUser u) {
		admin(u);
		return jdbc.queryForList("select * from erp_users order by created_at desc").stream().map(AuthService::publicUser).toList();
	}

	private Map<String, Object> row(String id) {
		List<Map<String, Object>> r = jdbc.queryForList("select * from erp_users where id=?", id);
		if (r.isEmpty()) throw ApiException.notFound("ไม่พบผู้ใช้");
		return r.get(0);
	}

	public Map<String, Object> get(AuthUser u, String id) {
		admin(u);
		return AuthService.publicUser(row(id));
	}

	@Transactional
	public Map<String, Object> create(AuthUser u, Map<String, Object> b) {
		admin(u);
		String username = String.valueOf(b.getOrDefault("username", "")).trim();
		if (!username.matches("(?i)[a-z0-9._-]{3,}")) throw ApiException.badRequest("ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษ/ตัวเลข อย่างน้อย 3 ตัว");
		String role = String.valueOf(b.getOrDefault("role", ""));
		if (!ROLES.contains(role)) throw ApiException.badRequest("role ไม่ถูกต้อง");
		Integer exists = jdbc.queryForObject("select count(*) from erp_users where lower(username)=lower(?)", Integer.class, username);
		if (exists != null && exists > 0) throw ApiException.conflict("DUPLICATE", "ชื่อผู้ใช้นี้มีอยู่แล้ว");
		String pw = b.get("password") == null ? null : String.valueOf(b.get("password"));
		boolean generated = pw == null || pw.isBlank();
		if (generated) pw = AuthService.randomPassword(); else AuthService.checkPasswordPolicy(pw);
		boolean mustChange = !(b.get("mustChange") instanceof Boolean mc) || mc;
		String id = "USR-" + Long.toString(System.currentTimeMillis(), 36);
		jdbc.update("insert into erp_users(id,username,full_name,role,email,dept,password_hash,must_change) values (?,?,?,?,?,?,?,?)",
			id, username, String.valueOf(b.getOrDefault("fullName", "")), role,
			String.valueOf(b.getOrDefault("email", "")), String.valueOf(b.getOrDefault("dept", "")), auth.hash(pw), mustChange);
		audit.log(u, "CREATE", "ผู้ใช้", username, "สร้างบัญชี " + username + " (" + role + ")");
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("user", AuthService.publicUser(row(id)));
		if (generated) out.put("temporaryPassword", pw);
		return out;
	}

	@Transactional
	public Map<String, Object> update(AuthUser u, String id, Map<String, Object> b) {
		admin(u);
		Map<String, Object> cur = row(id);
		String role = b.get("role") == null ? (String) cur.get("role") : String.valueOf(b.get("role"));
		if (!ROLES.contains(role)) throw ApiException.badRequest("role ไม่ถูกต้อง");
		if (id.equals(u.id()) && !"admin".equals(role)) throw ApiException.conflict("SELF_DEMOTE", "ไม่สามารถลดสิทธิ์ผู้ดูแลระบบของตนเอง");
		jdbc.update("update erp_users set full_name=?, role=?, email=?, dept=? where id=?",
			b.get("fullName") == null ? cur.get("full_name") : String.valueOf(b.get("fullName")), role,
			b.get("email") == null ? cur.get("email") : String.valueOf(b.get("email")),
			b.get("dept") == null ? cur.get("dept") : String.valueOf(b.get("dept")), id);
		audit.log(u, "UPDATE", "ผู้ใช้", String.valueOf(cur.get("username")), "แก้ไขบัญชี");
		return AuthService.publicUser(row(id));
	}

	@Transactional
	public Map<String, Object> resetPassword(AuthUser u, String id, String newPassword) {
		admin(u);
		Map<String, Object> cur = row(id);
		boolean generated = newPassword == null || newPassword.isBlank();
		String pw = generated ? AuthService.randomPassword() : newPassword;
		AuthService.checkPasswordPolicy(pw);
		jdbc.update("update erp_users set password_hash=?, legacy_hash=null, legacy_salt=null, must_change=true, failed_logins=0, locked_until=null where id=?", auth.hash(pw), id);
		jdbc.update("delete from erp_sessions where user_id=?", id);
		audit.log(u, "UPDATE", "ผู้ใช้", String.valueOf(cur.get("username")), "รีเซ็ตรหัสผ่านโดยผู้ดูแลระบบ");
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("temporaryPassword", pw);
		return out;
	}

	@Transactional
	public void delete(AuthUser u, String id) {
		admin(u);
		Map<String, Object> cur = row(id);
		if (id.equals(u.id())) throw ApiException.conflict("SELF_DELETE", "ลบบัญชีของตนเองไม่ได้");
		if (cur.get("last_login") != null) throw ApiException.conflict("HAS_HISTORY", "บัญชีนี้เคยใช้งานแล้ว ใช้การระงับแทนการลบ");
		jdbc.update("delete from erp_users where id=?", id);
		audit.log(u, "DELETE", "ผู้ใช้", String.valueOf(cur.get("username")), "ลบบัญชี");
	}

	@Transactional
	public Map<String, Object> setStatus(AuthUser u, String id, boolean active) {
		admin(u);
		Map<String, Object> cur = row(id);
		if (!active && id.equals(u.id())) throw ApiException.conflict("SELF_SUSPEND", "ไม่สามารถระงับบัญชีของตนเอง");
		jdbc.update("update erp_users set status=? where id=?", active ? "active" : "suspended", id);
		if (!active) jdbc.update("delete from erp_sessions where user_id=?", id);
		audit.log(u, "UPDATE", "ผู้ใช้", String.valueOf(cur.get("username")), active ? "เปิดใช้งานบัญชี" : "ระงับบัญชี");
		return AuthService.publicUser(row(id));
	}
}
