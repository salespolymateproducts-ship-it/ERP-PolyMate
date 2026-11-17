package com.backend.erp.data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.backend.erp.auth.AuthUser;
import com.backend.erp.common.ApiException;
import com.backend.erp.common.Json;

/**
 * เครื่องจักร: ข้อมูลเครื่อง (ตัน / ระยะห่างเสา / ช่วงความหนาแม่พิมพ์ / รอบ PM), สภาพเครื่อง (พร้อมใช้งาน / ควรซ่อมบำรุง /
 * อยู่ระหว่างซ่อมบำรุง / เลิกใช้ พร้อมเหตุผล) และบันทึกซ่อมบำรุง
 * สถานะการเดินเครื่อง (status idle/running + workOrder) เป็นของระบบผลิต ผู้ใช้แก้ตรงไม่ได้
 */
@Service
public class MachineService {
	static final Set<String> CONDITIONS = Set.of("ready", "due", "maintenance", "retired");
	private static final Set<String> BLOCKING = Set.of("maintenance", "retired");
	private static final Set<String> KINDS = Set.of("PM", "repair");
	private static final String MACHINE_LOCK = "erp.machine";
	private static final ZoneId BKK = ZoneId.of("Asia/Bangkok");
	/** ฟิลด์ที่ server เป็นเจ้าของ: PUT/PATCH แก้ตรงไม่ได้ (คืนค่าเดิมให้เงียบ ๆ เพื่อไม่ขวางการซิงก์ของหน้าจอ) */
	private static final List<String> SERVER_FIELDS = List.of("status", "workOrder", "condition", "conditionReason", "conditionLog", "maintLog", "lastMaint");

	private final RecordRepository repo;
	private final AuditService audit;
	private final Json json;
	private final JdbcTemplate jdbc;

	public MachineService(RecordRepository repo, AuditService audit, Json json, JdbcTemplate jdbc) {
		this.repo = repo;
		this.audit = audit;
		this.json = json;
		this.jdbc = jdbc;
	}

	private static String nowStr() { return LocalDateTime.now(BKK).format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")); }

	private static String today() { return LocalDate.now(BKK).toString(); }

	private static String key(Object v) { return v == null ? "" : String.valueOf(v).replaceAll("\\s+", "").toUpperCase(Locale.ROOT); }

	/** ตัวเลขที่ไม่บังคับ: ไม่มี = null, ไม่ใช่ตัวเลข/ไม่เกิน 0 = error */
	private static Double posOrNull(Map<String, Object> m, String field, String label) {
		Object v = m.get(field);
		if (v == null || (v instanceof String s && s.isBlank())) { m.remove(field); return null; }
		double d;
		try { d = v instanceof Number n ? n.doubleValue() : Double.parseDouble(String.valueOf(v).trim()); }
		catch (NumberFormatException e) { throw ApiException.badRequest(label + " ต้องเป็นตัวเลข"); }
		if (!(d > 0) || Double.isInfinite(d)) throw ApiException.badRequest(label + " ต้องมากกว่า 0");
		m.put(field, d);
		return d;
	}

	// ---------- กฎข้อมูลเครื่อง ----------

	private void validateCore(String id, Map<String, Object> m, boolean creating) {
		if (Json.s(m.get("name")).trim().isEmpty()) throw ApiException.badRequest("ต้องระบุชื่อ/ยี่ห้อรุ่นเครื่อง");
		m.put("name", Json.s(m.get("name")).trim());
		Double ton = posOrNull(m, "tonnage", "ขนาดตัน");
		if (ton == null) throw ApiException.badRequest("ต้องระบุขนาดตัน");
		Double w = posOrNull(m, "tieBarW", "ระยะห่างเสา (กว้าง)"), l = posOrNull(m, "tieBarL", "ระยะห่างเสา (ยาว)");
		if ((w == null) != (l == null)) throw ApiException.badRequest("ระยะห่างเสาต้องกรอกทั้งกว้างและยาว (หรือเว้นว่างทั้งคู่)");
		Double tmin = posOrNull(m, "thkMin", "ความหนาแม่พิมพ์ต่ำสุด"), tmax = posOrNull(m, "thkMax", "ความหนาแม่พิมพ์สูงสุด");
		if ((tmin == null) != (tmax == null)) throw ApiException.badRequest("ช่วงความหนาแม่พิมพ์ต้องกรอกทั้งต่ำสุดและสูงสุด (หรือเว้นว่างทั้งคู่)");
		if (tmin != null && tmin > tmax) throw ApiException.badRequest("ความหนาแม่พิมพ์ต่ำสุดต้องไม่เกินสูงสุด");
		Double pm = posOrNull(m, "pmIntervalDays", "รอบบำรุงรักษา (วัน)");
		m.put("pmIntervalDays", pm == null ? 90 : Math.round(pm));
		if (Json.num(m.get("pmIntervalDays")) > 3650) throw ApiException.badRequest("รอบบำรุงรักษาต้องไม่เกิน 3650 วัน");
		m.put("location", Json.s(m.get("location")).trim());
		m.put("note", Json.s(m.get("note")).trim());
	}

	private void assertUniqueId(String id) {
		jdbc.queryForObject("select pg_advisory_xact_lock(hashtext(?))::text", String.class, MACHINE_LOCK);
		String k = key(id);
		if (k.isEmpty() || !id.matches("^[A-Za-z0-9][A-Za-z0-9._\\-/]*$")) {
			throw ApiException.badRequest("รหัสเครื่องใช้ได้เฉพาะ A-Z 0-9 . _ - /");
		}
		Integer n = jdbc.queryForObject(
			"select count(*)::int from erp_records where collection = 'machines' and upper(regexp_replace(id, '\\s', '', 'g')) = ?", Integer.class, k);
		if (n != null && n > 0) throw ApiException.conflict("DUPLICATE_CODE", "รหัสเครื่อง " + id.trim() + " ซ้ำกับเครื่องที่มีอยู่แล้ว");
	}

	private static Map<String, Object> logEntry(AuthUser u, String from, String to, String reason) {
		Map<String, Object> e = new LinkedHashMap<>();
		e.put("at", nowStr());
		e.put("by", u.fullName());
		e.put("from", from);
		e.put("to", to);
		e.put("reason", reason);
		return e;
	}

	/** สร้างเครื่องใหม่: สถานะเดินเครื่องเริ่มที่ idle, สภาพเริ่มที่ ready (หรือสภาพอื่นที่ระบุพร้อมเหตุผล) */
	public void prepareCreate(AuthUser u, String id, Map<String, Object> m) {
		assertUniqueId(id);
		validateCore(id, m, true);
		String cond = Json.s(m.get("condition")).isBlank() ? "ready" : Json.s(m.get("condition"));
		if (!CONDITIONS.contains(cond)) throw ApiException.badRequest("สภาพเครื่องต้องเป็น พร้อมใช้งาน / ควรซ่อมบำรุง / อยู่ระหว่างซ่อมบำรุง / เลิกใช้");
		String reason = Json.s(m.get("conditionReason")).trim();
		if (!cond.equals("ready") && reason.isEmpty()) throw ApiException.badRequest("ต้องระบุเหตุผลของสภาพเครื่อง");
		m.put("condition", cond);
		m.put("conditionReason", cond.equals("ready") ? "" : reason);
		List<Object> clog = new ArrayList<>();
		if (!cond.equals("ready")) clog.add(logEntry(u, "—", cond, reason));
		m.put("conditionLog", clog);
		m.put("maintLog", new ArrayList<>());
		m.put("status", "idle");
		m.remove("workOrder");
		String lm = Json.s(m.get("lastMaint")).trim();
		try { m.put("lastMaint", lm.isEmpty() ? today() : LocalDate.parse(lm).toString()); }
		catch (DateTimeParseException e) { throw ApiException.badRequest("วันที่บำรุงรักษาล่าสุดไม่ถูกต้อง (รูปแบบ ปี-เดือน-วัน)"); }
	}

	/** แก้ไขข้อมูลเครื่อง: ฟิลด์ที่ server เป็นเจ้าของคืนค่าเดิมเสมอ */
	public void prepareUpdate(Map<String, Object> cur, Map<String, Object> next) {
		validateCore(Json.s(cur.get("id")), next, false);
		for (String k : SERVER_FIELDS) {
			if (cur.containsKey(k)) next.put(k, cur.get(k)); else next.remove(k);
		}
	}

	/** เครื่องที่ใช้เปิดใบสั่งผลิตใหม่ได้ (พร้อมใช้งาน / ควรซ่อมบำรุง) — "—" หรือว่างหมายถึงยังไม่กำหนดเครื่อง */
	public void assertUsable(Object machineId) {
		String id = Json.s(machineId).trim();
		if (id.isEmpty() || id.equals("—")) return;
		Optional<String> ms = repo.get("machines", id);
		if (ms.isEmpty()) throw ApiException.badRequest("ไม่พบเครื่อง " + id + " ในทะเบียนเครื่องจักร");
		Map<String, Object> m = json.map(ms.get());
		String c = Json.s(m.get("condition"));
		if (c.equals("maintenance")) throw ApiException.badRequest("เครื่อง " + id + " อยู่ระหว่างซ่อมบำรุง เปิดใบสั่งผลิตบนเครื่องนี้ไม่ได้" + (Json.s(m.get("conditionReason")).isBlank() ? "" : " (" + Json.s(m.get("conditionReason")) + ")"));
		if (c.equals("retired")) throw ApiException.badRequest("เครื่อง " + id + " เลิกใช้แล้ว เปิดใบสั่งผลิตบนเครื่องนี้ไม่ได้");
	}

	// ---------- สภาพเครื่อง ----------

	private int openWorkOrders(String machineId) {
		Integer n = jdbc.queryForObject(
			"select count(*)::int from erp_records where collection = 'workOrders' and data->>'machine' = ? and data->>'status' in ('queued','setup','running')", Integer.class, machineId);
		return n == null ? 0 : n;
	}

	@Transactional
	public Map<String, Object> setCondition(AuthUser u, String id, String condition, String reason) {
		RecordService.requireWrite(u, RecordService.def("machines"));
		if (!CONDITIONS.contains(condition)) throw ApiException.badRequest("สภาพเครื่องต้องเป็น พร้อมใช้งาน / ควรซ่อมบำรุง / อยู่ระหว่างซ่อมบำรุง / เลิกใช้");
		String why = reason == null ? "" : reason.trim();
		if (!condition.equals("ready") && why.isEmpty()) throw ApiException.badRequest("ต้องระบุเหตุผลทุกครั้งที่เปลี่ยนสภาพเครื่องเป็นอย่างอื่นนอกจากพร้อมใช้งาน");
		Map<String, Object> m = json.map(repo.getForUpdate("machines", id).orElseThrow(() -> ApiException.notFound("ไม่พบเครื่อง " + id)));
		String from = Json.s(m.get("condition")).isBlank() ? "ready" : Json.s(m.get("condition"));
		if (BLOCKING.contains(condition) && openWorkOrders(id) > 0) {
			throw ApiException.conflict("MACHINE_IN_USE", "เครื่อง " + id + " มีใบสั่งผลิตที่ยังเปิดอยู่ " + openWorkOrders(id) + " ใบ — ปิดงานหรือยกเลิก หรือย้ายไปเครื่องอื่นก่อนตั้งเป็นอยู่ระหว่างซ่อมบำรุง/เลิกใช้");
		}
		List<Object> clog = new ArrayList<>();
		clog.add(logEntry(u, from, condition, why.isEmpty() ? "กลับมาใช้งาน" : why));
		if (m.get("conditionLog") instanceof List<?> old) clog.addAll(old);
		m.put("condition", condition);
		m.put("conditionReason", condition.equals("ready") ? "" : why);
		m.put("conditionLog", clog);
		m.remove("_version");
		repo.update("machines", id, json.str(m), null, u.username());
		audit.log(u, "MACHINE_CONDITION", "เครื่องจักร", id, from + " → " + condition + (why.isEmpty() ? "" : " · " + why));
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("id", id);
		out.put("condition", condition);
		return out;
	}

	// ---------- บันทึกซ่อมบำรุง ----------

	@Transactional
	public Map<String, Object> logMaintenance(AuthUser u, String id, Map<String, Object> body) {
		RecordService.requireWrite(u, RecordService.def("machines"));
		String kind = Json.s(body.get("kind")).isBlank() ? "repair" : Json.s(body.get("kind"));
		if (!KINDS.contains(kind)) throw ApiException.badRequest("ประเภทต้องเป็น PM หรือ ซ่อม");
		String note = Json.s(body.get("note")).trim();
		if (note.isEmpty()) throw ApiException.badRequest("ต้องระบุรายละเอียดการซ่อมบำรุง");
		double cost = body.get("cost") == null ? 0 : Json.num(body.get("cost")), down = body.get("downtimeHrs") == null ? 0 : Json.num(body.get("downtimeHrs"));
		if (cost < 0 || down < 0) throw ApiException.badRequest("ค่าใช้จ่ายและเวลาที่เครื่องหยุดต้องไม่ติดลบ");
		LocalDate date;
		try { date = Json.s(body.get("date")).isBlank() ? LocalDate.now(BKK) : LocalDate.parse(Json.s(body.get("date")).trim()); }
		catch (DateTimeParseException e) { throw ApiException.badRequest("วันที่ไม่ถูกต้อง (รูปแบบ ปี-เดือน-วัน)"); }
		if (date.isAfter(LocalDate.now(BKK))) throw ApiException.badRequest("วันที่ซ่อมบำรุงเป็นอนาคตไม่ได้");
		boolean finish = !Boolean.FALSE.equals(body.get("finish"));

		Map<String, Object> m = json.map(repo.getForUpdate("machines", id).orElseThrow(() -> ApiException.notFound("ไม่พบเครื่อง " + id)));
		String cond = Json.s(m.get("condition")).isBlank() ? "ready" : Json.s(m.get("condition"));
		if (cond.equals("retired")) throw ApiException.conflict("MACHINE_RETIRED", "เครื่อง " + id + " เลิกใช้แล้ว บันทึกซ่อมบำรุงไม่ได้");

		Map<String, Object> e = new LinkedHashMap<>();
		e.put("date", date.toString());
		e.put("kind", kind);
		e.put("note", note);
		e.put("cost", cost);
		e.put("downtimeHrs", down);
		e.put("by", u.fullName());
		e.put("at", nowStr());
		List<Object> mlog = new ArrayList<>();
		mlog.add(e);
		if (m.get("maintLog") instanceof List<?> old) mlog.addAll(old);
		m.put("maintLog", mlog);

		if (finish) {
			String last = Json.s(m.get("lastMaint"));
			if (last.isBlank() || date.toString().compareTo(last) > 0) m.put("lastMaint", date.toString());
			if (cond.equals("due") || cond.equals("maintenance")) {
				List<Object> clog = new ArrayList<>();
				clog.add(logEntry(u, cond, "ready", "เสร็จสิ้นการซ่อมบำรุง: " + note));
				if (m.get("conditionLog") instanceof List<?> old) clog.addAll(old);
				m.put("conditionLog", clog);
				m.put("condition", "ready");
				m.put("conditionReason", "");
			}
		}
		m.remove("_version");
		repo.update("machines", id, json.str(m), null, u.username());
		audit.log(u, "MACHINE_MAINT", "เครื่องจักร", id, (kind.equals("PM") ? "PM" : "ซ่อม") + " · " + note + (cost > 0 ? " · " + cost + " บาท" : ""));
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("id", id);
		out.put("condition", m.get("condition"));
		out.put("lastMaint", m.get("lastMaint"));
		return out;
	}
}
