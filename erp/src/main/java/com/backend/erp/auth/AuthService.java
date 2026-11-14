package com.backend.erp.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.backend.erp.common.ApiException;
import com.backend.erp.data.AuditService;

@Service
public class AuthService {
	private static final SecureRandom RNG = new SecureRandom();
	private final BCryptPasswordEncoder enc = new BCryptPasswordEncoder(10);
	private final JdbcTemplate jdbc;
	private final AuditService audit;
	private final int sessionHours;
	private final Map<String, long[]> loginWindow = new ConcurrentHashMap<>();

	public AuthService(JdbcTemplate jdbc, AuditService audit, @Value("${erp.session.hours:12}") int sessionHours) {
		this.jdbc = jdbc;
		this.audit = audit;
		this.sessionHours = sessionHours;
	}

	// ---------- helpers ----------
	static String sha256(String s) {
		try {
			return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
		} catch (Exception e) { throw new IllegalStateException(e); }
	}

	public String hash(String pw) { return enc.encode(pw); }

	public static void checkPasswordPolicy(String pw) {
		if (pw == null || pw.length() < 8) throw ApiException.badRequest("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
	}

	public static String randomPassword() {
		byte[] b = new byte[12];
		RNG.nextBytes(b);
		return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
	}

	/** จำกัด 5 ครั้ง/นาที/IP สำหรับ login */
	private void rateLimit(String ip) {
		long now = System.currentTimeMillis();
		long[] w = loginWindow.compute(ip, (k, v) -> {
			if (v == null || now - v[0] > 60_000) return new long[] { now, 1 };
			v[1]++;
			return v;
		});
		if (w[1] > 5) throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ 1 นาที");
	}

	// ---------- login / session ----------
	/** ไม่ใช้ @Transactional: ต้องบันทึกจำนวนครั้งที่ผิดและ audit แม้ตอบ 401 */
	public Map<String, Object> login(String username, String password, String ip, String ua) {
		rateLimit(ip == null ? "?" : ip);
		List<Map<String, Object>> rows = jdbc.queryForList(
			"select * from erp_users where lower(username) = lower(?)", username == null ? "" : username.trim());
		String badMsg = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
		if (rows.isEmpty()) {
			audit.log(null, "LOGIN_FAIL", "ผู้ใช้", String.valueOf(username), "ไม่พบผู้ใช้");
			throw ApiException.unauthenticated(badMsg);
		}
		Map<String, Object> u = rows.get(0);
		String id = (String) u.get("id");
		if (!"active".equals(u.get("status"))) throw ApiException.forbidden("บัญชีนี้ถูกระงับ กรุณาติดต่อผู้ดูแลระบบ");
		Object lockObj = u.get("locked_until");
		if (lockObj instanceof Timestamp lock && lock.toInstant().isAfter(Instant.now())) {
			throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "ACCOUNT_LOCKED", "บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ภายหลัง");
		}
		boolean ok = false;
		String pw = password == null ? "" : password;
		String bh = (String) u.get("password_hash");
		if (bh != null) {
			ok = enc.matches(pw, bh);
		} else if (u.get("legacy_hash") != null) {
			ok = sha256(u.get("legacy_salt") + ":" + pw).equals(u.get("legacy_hash"));
			if (ok) jdbc.update("update erp_users set password_hash=?, legacy_hash=null, legacy_salt=null where id=?", hash(pw), id);
		}
		if (!ok) {
			int fails = ((Number) u.get("failed_logins")).intValue() + 1;
			if (fails >= 10) {
				jdbc.update("update erp_users set failed_logins=0, locked_until=now() + interval '15 minutes' where id=?", id);
			} else {
				jdbc.update("update erp_users set failed_logins=? where id=?", fails, id);
			}
			audit.log(null, "LOGIN_FAIL", "ผู้ใช้", String.valueOf(username), "รหัสผ่านผิด");
			throw ApiException.unauthenticated(badMsg);
		}
		jdbc.update("update erp_users set failed_logins=0, locked_until=null, last_login=now() where id=?", id);
		byte[] raw = new byte[32];
		RNG.nextBytes(raw);
		String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
		jdbc.update("insert into erp_sessions(token_hash,user_id,expires_at,ip,user_agent) values (?,?,now() + make_interval(hours => ?),?,?)",
			sha256(token), id, sessionHours, ip, ua == null ? null : ua.substring(0, Math.min(ua.length(), 300)));
		Map<String, Object> fresh = jdbc.queryForMap("select * from erp_users where id=?", id);
		AuthUser au = toAuthUser(fresh);
		audit.log(au, "LOGIN", "ผู้ใช้", au.username(), "เข้าสู่ระบบ");
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("token", token);
		out.put("user", publicUser(fresh));
		out.put("mustChange", au.mustChange());
		return out;
	}

	public AuthUser authenticate(String token) {
		String th = sha256(token);
		List<Map<String, Object>> rows = jdbc.queryForList(
			"select u.* from erp_sessions s join erp_users u on u.id = s.user_id " +
			"where s.token_hash = ? and s.expires_at > now() and u.status = 'active'", th);
		if (rows.isEmpty()) throw ApiException.unauthenticated("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
		jdbc.update("update erp_sessions set last_seen = now() where token_hash = ? and last_seen < now() - interval '1 minute'", th);
		return toAuthUser(rows.get(0));
	}

	public Map<String, Object> me(AuthUser u) {
		return publicUser(jdbc.queryForMap("select * from erp_users where id=?", u.id()));
	}

	@Transactional
	public void logout(AuthUser u, String token) {
		jdbc.update("delete from erp_sessions where token_hash = ?", sha256(token));
		audit.log(u, "LOGOUT", "ผู้ใช้", u.username(), "ออกจากระบบ");
	}

	@Transactional
	public void changeOwnPassword(AuthUser u, String oldPw, String newPw, String currentToken) {
		checkPasswordPolicy(newPw);
		Map<String, Object> row = jdbc.queryForMap("select * from erp_users where id=?", u.id());
		String bh = (String) row.get("password_hash");
		String op = oldPw == null ? "" : oldPw;
		boolean ok = bh != null ? enc.matches(op, bh)
			: sha256(row.get("legacy_salt") + ":" + op).equals(row.get("legacy_hash"));
		if (!ok) throw ApiException.badRequest("รหัสผ่านปัจจุบันไม่ถูกต้อง");
		if (newPw.equals(op)) throw ApiException.badRequest("รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม");
		jdbc.update("update erp_users set password_hash=?, legacy_hash=null, legacy_salt=null, must_change=false where id=?", hash(newPw), u.id());
		jdbc.update("delete from erp_sessions where user_id=? and token_hash <> ?", u.id(), sha256(currentToken));
		audit.log(u, "UPDATE", "ผู้ใช้", u.username(), "เปลี่ยนรหัสผ่าน");
	}

	public static AuthUser toAuthUser(Map<String, Object> r) {
		return new AuthUser((String) r.get("id"), (String) r.get("username"), (String) r.get("full_name"),
			(String) r.get("role"), Boolean.TRUE.equals(r.get("must_change")));
	}

	/** รูปแบบเดียวกับ record users ใน Store เดิม (ไม่มี hash/salt) */
	public static Map<String, Object> publicUser(Map<String, Object> r) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", r.get("id"));
		m.put("username", r.get("username"));
		m.put("fullName", r.get("full_name"));
		m.put("name", r.get("full_name"));
		m.put("role", r.get("role"));
		m.put("email", r.get("email"));
		m.put("dept", r.get("dept"));
		m.put("status", r.get("status"));
		m.put("mustChange", r.get("must_change"));
		m.put("createdAt", r.get("created_at") == null ? null : r.get("created_at").toString());
		m.put("lastLogin", r.get("last_login") == null ? null : r.get("last_login").toString());
		return m;
	}
}
