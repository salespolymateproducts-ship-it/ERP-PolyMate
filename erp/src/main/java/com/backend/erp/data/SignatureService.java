package com.backend.erp.data;

import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.backend.erp.auth.AuthUser;
import com.backend.erp.common.ApiException;

/**
 * ลายเซ็นอิเล็กทรอนิกส์ ระดับ 2 — ภาพลายเซ็นของผู้ใช้แต่ละคน
 *  • ตั้ง/ลบได้เฉพาะเจ้าของ (PNG/JPEG ไม่เกิน 300 KB) — ไม่มี API ให้คนอื่นอ่านหรือแก้ภาพของเรา
 *  • ภาพถูกส่งออกได้ทางเดียวคือ "เปิดเอกสารที่ผู้นั้นอนุมัติ/จ่ายแล้ว" (forPv / forDoc) โดยผู้ที่มีสิทธิ์ดูเอกสารนั้น และบันทึก Audit Log ทุกครั้ง
 *  • เอกสารที่ยังไม่อนุมัติ/ยกเลิก/กลับรายการ → ไม่ส่งภาพ (ส่งชื่อและเวลาเท่านั้น)
 *  หมายเหตุ: ภาพลายเซ็นยืนยันตัวผู้ลงนามในทางกฎหมายได้เพียงใด ให้ผู้ทำบัญชี/ทนายยืนยัน — ระบบนี้เป็นระดับ "แสดงผลบนเอกสารภายใน" (ไม่ใช่ลายเซ็นดิจิทัลพร้อมใบรับรอง)
 */
@Service
public class SignatureService {
	static final int MAX_BYTES = 300 * 1024;
	static final int MAX_PX = 2000;
	private static final Pattern DATA_URL = Pattern.compile("^data:(image/png|image/jpeg);base64,([A-Za-z0-9+/=\\s]+)$");

	private final JdbcTemplate jdbc;
	private final AuditService audit;

	public SignatureService(JdbcTemplate jdbc, AuditService audit) {
		this.jdbc = jdbc;
		this.audit = audit;
	}

	private static String dataUrl(String ct, byte[] img) { return "data:" + ct + ";base64," + Base64.getEncoder().encodeToString(img); }

	// ---------- ของฉัน ----------
	public Map<String, Object> mine(AuthUser u) {
		List<Map<String, Object>> r = jdbc.queryForList("select content_type, image, to_char(updated_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') as at from erp_user_signatures where user_id = ?", u.id());
		Map<String, Object> m = new LinkedHashMap<>();
		if (r.isEmpty()) { m.put("has", false); return m; }
		m.put("has", true);
		m.put("updatedAt", r.get(0).get("at"));
		m.put("image", dataUrl((String) r.get(0).get("content_type"), (byte[]) r.get(0).get("image")));
		return m;
	}

	@Transactional
	public Map<String, Object> set(AuthUser u, Object imageObj) {
		String s = imageObj == null ? "" : String.valueOf(imageObj).trim();
		Matcher mt = DATA_URL.matcher(s);
		if (!mt.matches()) throw ApiException.badRequest("ไฟล์ลายเซ็นต้องเป็นภาพ PNG หรือ JPEG");
		byte[] img;
		try { img = Base64.getMimeDecoder().decode(mt.group(2)); } catch (IllegalArgumentException e) { throw ApiException.badRequest("ข้อมูลภาพไม่ถูกต้อง"); }
		if (img.length == 0) throw ApiException.badRequest("ไม่พบข้อมูลภาพ");
		if (img.length > MAX_BYTES) throw ApiException.badRequest("ภาพลายเซ็นใหญ่เกินไป (สูงสุด " + (MAX_BYTES / 1024) + " KB)");
		String ct = mt.group(1);
		if ("image/png".equals(ct)) {
			if (img.length < 24 || (img[0] & 0xFF) != 0x89 || img[1] != 'P' || img[2] != 'N' || img[3] != 'G') throw ApiException.badRequest("ไฟล์ไม่ใช่ภาพ PNG");
			int w = ((img[16] & 0xFF) << 24) | ((img[17] & 0xFF) << 16) | ((img[18] & 0xFF) << 8) | (img[19] & 0xFF);
			int h = ((img[20] & 0xFF) << 24) | ((img[21] & 0xFF) << 16) | ((img[22] & 0xFF) << 8) | (img[23] & 0xFF);
			if (w <= 0 || h <= 0 || w > MAX_PX || h > MAX_PX) throw ApiException.badRequest("ขนาดภาพต้องไม่เกิน " + MAX_PX + "×" + MAX_PX + " พิกเซล");
		} else if (img.length < 4 || (img[0] & 0xFF) != 0xFF || (img[1] & 0xFF) != 0xD8 || (img[2] & 0xFF) != 0xFF) {
			throw ApiException.badRequest("ไฟล์ไม่ใช่ภาพ JPEG");
		}
		jdbc.update("insert into erp_user_signatures(user_id, content_type, image, updated_at) values (?,?,?,now()) "
			+ "on conflict (user_id) do update set content_type = excluded.content_type, image = excluded.image, updated_at = now()", u.id(), ct, img);
		audit.log(u, "SIGNATURE_SET", "ลายเซ็น", u.username(), "ตั้ง/เปลี่ยนภาพลายเซ็น (" + (img.length / 1024) + " KB)");
		return mine(u);
	}

	@Transactional
	public Map<String, Object> remove(AuthUser u) {
		int n = jdbc.update("delete from erp_user_signatures where user_id = ?", u.id());
		if (n > 0) audit.log(u, "SIGNATURE_DEL", "ลายเซ็น", u.username(), "ลบภาพลายเซ็น");
		return Map.of("has", false);
	}

	// ---------- ใช้บนเอกสาร ----------
	private String idByName(String name) {
		if (name == null || name.isBlank()) return null;
		List<String> ids = jdbc.queryForList("select id from erp_users where full_name = ?", String.class, name);
		return ids.size() == 1 ? ids.get(0) : null;     // ชื่อซ้ำหลายคน → ไม่เดา ไม่แสดงภาพ
	}

	private String imageOf(String userId) {
		if (userId == null) return null;
		List<Map<String, Object>> r = jdbc.queryForList("select content_type, image from erp_user_signatures where user_id = ?", userId);
		return r.isEmpty() ? null : dataUrl((String) r.get(0).get("content_type"), (byte[]) r.get(0).get("image"));
	}

	private Map<String, Object> signer(String role, String name, String at, String userId, boolean withImage) {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("role", role); m.put("name", name); m.put("at", at);
		m.put("image", withImage ? imageOf(userId) : null);
		return m;
	}

	private Map<String, Object> result(AuthUser u, String entity, String id, List<Map<String, Object>> signers) {
		List<String> used = new ArrayList<>();
		for (Map<String, Object> s : signers) if (s.get("image") != null) used.add(s.get("role") + "=" + s.get("name"));
		if (!used.isEmpty()) audit.log(u, "SIGNATURE_USE", entity, id, "เปิดเอกสารพร้อมลายเซ็น: " + String.join(", ", used));
		return Map.of("signers", signers);
	}

	/** ใบสำคัญจ่าย: ผู้จัดทำ / ผู้อนุมัติ / ผู้จ่าย — แสดงภาพเมื่อใบอนุมัติแล้วหรือจ่ายแล้วเท่านั้น (สิทธิ์เดียวกับดูใบสำคัญจ่าย) */
	public Map<String, Object> forPv(AuthUser u, String id) {
		FinanceService.needRead(u);
		List<Map<String, Object>> r = jdbc.queryForList("select status, created_by, created_by_id, to_char(created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') as created_at, "
			+ "approved_by, approved_by_id, to_char(approved_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') as approved_at, "
			+ "paid_by, paid_by_id, to_char(paid_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') as paid_at from fin_pay_vouchers where id = ?", id);
		if (r.isEmpty()) throw ApiException.notFound("ไม่พบใบสำคัญจ่าย " + id);
		Map<String, Object> v = r.get(0);
		String st = String.valueOf(v.get("status"));
		boolean show = "approved".equals(st) || "paid".equals(st);
		List<Map<String, Object>> out = new ArrayList<>();
		out.add(signer("creator", (String) v.get("created_by"), (String) v.get("created_at"), (String) v.get("created_by_id"), show));
		if (v.get("approved_by") != null) out.add(signer("approver", (String) v.get("approved_by"), (String) v.get("approved_at"), v.get("approved_by_id") != null ? (String) v.get("approved_by_id") : idByName((String) v.get("approved_by")), show));
		if (v.get("paid_by") != null) out.add(signer("payer", (String) v.get("paid_by"), (String) v.get("paid_at"), v.get("paid_by_id") != null ? (String) v.get("paid_by_id") : idByName((String) v.get("paid_by")), show && "paid".equals(st)));
		return result(u, "ใบสำคัญจ่าย", id, out);
	}

	/** เอกสารขาย: ผู้อนุมัติ ("ผู้มีอำนาจลงนาม") — เฉพาะเอกสารที่อนุมัติแล้วและไม่ถูกยกเลิก · สิทธิ์เดียวกับดูเอกสาร (admin / sales / accounting) */
	public Map<String, Object> forDoc(AuthUser u, String id) {
		if (u == null || !(u.isAdmin() || "sales".equals(u.role()) || "accounting".equals(u.role()))) throw ApiException.forbidden("ไม่มีสิทธิ์ดูเอกสารนี้");
		List<Map<String, Object>> r = jdbc.queryForList("select data->>'status' as status, data->>'approvedBy' as approved_by, data->>'approvedAt' as approved_at from erp_records where collection = 'docs' and id = ?", id);
		if (r.isEmpty()) throw ApiException.notFound("ไม่พบเอกสาร " + id);
		Map<String, Object> d = r.get(0);
		String st = String.valueOf(d.get("status"));
		boolean show = "approved".equals(st) || "partial".equals(st) || "completed".equals(st);
		List<Map<String, Object>> out = new ArrayList<>();
		String by = (String) d.get("approved_by");
		if (by != null && !by.isBlank()) out.add(signer("approver", by, (String) d.get("approved_at"), idByName(by), show));
		return result(u, "เอกสารขาย", id, out);
	}
}
