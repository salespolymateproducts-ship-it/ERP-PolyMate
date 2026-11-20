package com.backend.erp.data;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.backend.erp.auth.AuthUser;
import com.backend.erp.common.ApiException;
import com.backend.erp.common.Json;

/**
 * การเงิน ขั้น 1A: บัญชีเงินสด/ธนาคาร · สมุดเงิน · รับ/จ่ายเงินอื่น ๆ · โอนระหว่างบัญชี
 *
 * หลักการ
 *  • ยอดคงเหลือ = ยอดยกมา + เงินเข้า − เงินออก จากสมุดเงิน (fin_movements) เท่านั้น — ไม่เก็บยอดซ้ำ
 *  • สมุดเงินเป็น append-only (trigger กันแก้/ลบ) · ยืนยันแล้วลบไม่ได้ ใช้ "กลับรายการ" (สร้างรายการตรงข้ามลงวันที่ในงวดที่เปิดอยู่)
 *  • ผู้บันทึก ≠ ผู้อนุมัติ ยกเว้น admin (บันทึกและยืนยันเองได้ — ติดป้าย self_approved เพื่อตรวจย้อนหลัง)
 *  • บัญชีเงินสด/เช็ค ยอดติดลบไม่ได้ · บัญชีธนาคารเบิกเกินบัญชีได้ (แต่แสดงเตือน)
 *  • วันล็อกงวด (fin.lockDate): ห้ามบันทึก/ยืนยัน/กลับรายการที่วันที่ไม่เกินวันล็อก
 */
@Service
public class FinanceService {
	private static final ZoneId BKK = ZoneId.of("Asia/Bangkok");
	private final JdbcTemplate jdbc;
	private final CounterService counters;
	private final AuditService audit;

	public FinanceService(JdbcTemplate jdbc, CounterService counters, AuditService audit) {
		this.jdbc = jdbc;
		this.counters = counters;
		this.audit = audit;
	}

	// ---------- สิทธิ์ ----------
	static void needRead(AuthUser u) {
		if (u == null || !(u.isAdmin() || "accounting".equals(u.role()))) throw ApiException.forbidden("เฉพาะผู้ดูแลระบบและฝ่ายบัญชีเข้าถึงข้อมูลการเงินได้");
	}
	static void needAdmin(AuthUser u) {
		if (u == null || !u.isAdmin()) throw ApiException.forbidden("เฉพาะผู้ดูแลระบบ (admin) ทำรายการนี้ได้");
	}
	static LocalDate today() { return LocalDate.now(BKK); }

	static LocalDate parseDate(Object v, String label) {
		try { return LocalDate.parse(Json.s(v).substring(0, 10)); }
		catch (Exception e) { throw ApiException.badRequest(label + " ไม่ถูกต้อง (ต้องเป็น yyyy-mm-dd)"); }
	}

	static BigDecimal money(Object v, String label, boolean allowZero) {
		BigDecimal b;
		try { b = new BigDecimal(Json.s(v).trim()); } catch (Exception e) { throw ApiException.badRequest(label + " ไม่ถูกต้อง"); }
		if (b.scale() > 2 && b.stripTrailingZeros().scale() > 2) throw ApiException.badRequest(label + " ต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง");
		b = b.setScale(2, java.math.RoundingMode.HALF_UP);
		if (b.signum() < 0 || (!allowZero && b.signum() == 0)) throw ApiException.badRequest(label + (allowZero ? " ต้องไม่ติดลบ" : " ต้องมากกว่า 0"));
		if (b.compareTo(new BigDecimal("999999999999.99")) > 0) throw ApiException.badRequest(label + " สูงเกินไป");
		return b;
	}

	// ---------- ตั้งค่า ----------
	public Map<String, Object> getSettings(AuthUser u) {
		needRead(u);
		return settings();
	}

	Map<String, Object> settings() {
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("lockDate", setting("fin.lockDate"));
		Object th = setting("fin.approvalThreshold");
		m.put("approvalThreshold", th instanceof Number n ? n.doubleValue() : 0d);
		return m;
	}

	private Object setting(String key) {
		List<String> r = jdbc.queryForList("select value::text from erp_settings where key = ?", String.class, key);
		if (r.isEmpty()) return null;
		String s = r.get(0);
		if (s == null || s.equals("null")) return null;
		if (s.startsWith("\"")) return s.substring(1, s.length() - 1);
		try { return Double.parseDouble(s); } catch (Exception e) { return s; }
	}

	private void putSetting(AuthUser u, String key, String jsonValue) {
		jdbc.update("insert into erp_settings(key,value,updated_by) values (?, ?::jsonb, ?) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()",
			key, jsonValue, u.fullName());
	}

	@Transactional
	public Map<String, Object> saveSettings(AuthUser u, Map<String, Object> body) {
		needAdmin(u);
		if (body.containsKey("lockDate")) {
			Object ld = body.get("lockDate");
			if (ld == null || Json.s(ld).isBlank()) {
				putSetting(u, "fin.lockDate", "null");
				audit.log(u, "FIN_SETTINGS", "การเงิน", "lockDate", "ยกเลิกวันล็อกงวด");
			} else {
				LocalDate d = parseDate(ld, "วันล็อกงวด");
				if (d.isAfter(today())) throw ApiException.badRequest("วันล็อกงวดต้องไม่เกินวันนี้");
				putSetting(u, "fin.lockDate", "\"" + d + "\"");
				audit.log(u, "FIN_SETTINGS", "การเงิน", "lockDate", "ตั้งวันล็อกงวด " + d);
			}
		}
		if (body.containsKey("approvalThreshold")) {
			BigDecimal t = money(body.get("approvalThreshold"), "เกณฑ์ยอดอนุมัติ", true);
			putSetting(u, "fin.approvalThreshold", t.toPlainString());
			audit.log(u, "FIN_SETTINGS", "การเงิน", "approvalThreshold", "ตั้งเกณฑ์ยอด " + t);
		}
		return settings();
	}

	void assertOpenPeriod(LocalDate d) {
		Object ld = setting("fin.lockDate");
		if (ld != null && !d.isAfter(LocalDate.parse(String.valueOf(ld)))) throw ApiException.conflict("PERIOD_LOCKED", "วันที่ " + d + " อยู่ในงวดที่ล็อกแล้ว (ล็อกถึง " + ld + ")");
	}

	// ---------- บัญชีเงิน ----------
	private static final String ACC_SEL = "select a.id, a.code, a.name, a.type, a.bank_name as \"bankName\", a.account_no as \"accountNo\", a.opening_balance::float8 as \"openingBalance\", "
		+ "to_char(a.opening_date,'YYYY-MM-DD') as \"openingDate\", a.active, a.note, "
		+ "(a.opening_balance + coalesce((select sum(case when m.direction='in' then m.amount else -m.amount end) from fin_movements m where m.account_id = a.id),0))::float8 as balance, "
		+ "(select count(*) from fin_movements m where m.account_id = a.id)::int as \"movementCount\" from fin_accounts a";

	public List<Map<String, Object>> listAccounts(AuthUser u) {
		needRead(u);
		return jdbc.queryForList(ACC_SEL + " order by a.active desc, a.code");
	}

	private Map<String, Object> account(String id) {
		List<Map<String, Object>> r = jdbc.queryForList(ACC_SEL + " where a.id = ?", id);
		if (r.isEmpty()) throw ApiException.notFound("ไม่พบบัญชีเงิน " + id);
		return r.get(0);
	}

	@Transactional
	public Map<String, Object> createAccount(AuthUser u, Map<String, Object> b) {
		needRead(u);
		String code = Json.s(b.get("code")).trim().toUpperCase();
		if (!code.matches("[A-Z0-9][A-Z0-9._\\-/]{0,29}")) throw ApiException.badRequest("รหัสบัญชีใช้ได้เฉพาะ A-Z 0-9 . _ - / (ไม่เกิน 30 ตัว) และห้ามมีช่องว่าง");
		String name = Json.s(b.get("name")).trim();
		if (name.isEmpty()) throw ApiException.badRequest("ต้องระบุชื่อบัญชี");
		String type = Json.s(b.get("type"));
		if (!List.of("cash", "bank", "cheque").contains(type)) throw ApiException.badRequest("ประเภทบัญชีต้องเป็น cash / bank / cheque");
		BigDecimal opening = b.get("openingBalance") == null || Json.s(b.get("openingBalance")).isBlank() ? BigDecimal.ZERO.setScale(2) : money(b.get("openingBalance"), "ยอดยกมา", true);
		LocalDate od = b.get("openingDate") == null || Json.s(b.get("openingDate")).isBlank() ? today() : parseDate(b.get("openingDate"), "วันที่ยอดยกมา");
		if (od.isAfter(today())) throw ApiException.badRequest("วันที่ยอดยกมาต้องไม่เกินวันนี้");
		assertOpenPeriod(od);
		Integer dup = jdbc.queryForObject("select count(*)::int from fin_accounts where lower(code) = lower(?)", Integer.class, code);
		if (dup != null && dup > 0) throw ApiException.conflict("DUPLICATE", "รหัสบัญชี " + code + " มีอยู่แล้ว");
		jdbc.update("insert into fin_accounts(id,code,name,type,bank_name,account_no,opening_balance,opening_date,note,created_by) values (?,?,?,?,?,?,?,?,?,?)",
			code, code, name, type, Json.s(b.get("bankName")).trim(), Json.s(b.get("accountNo")).trim(), opening, od, Json.s(b.get("note")).trim(), u.fullName());
		audit.log(u, "FIN_ACCOUNT", "บัญชีเงิน", code, "สร้างบัญชี " + name + " (" + type + ") ยอดยกมา " + opening + " ณ " + od);
		return account(code);
	}

	@Transactional
	public Map<String, Object> updateAccount(AuthUser u, String id, Map<String, Object> b) {
		needRead(u);
		Map<String, Object> cur = account(id);
		String name = b.containsKey("name") ? Json.s(b.get("name")).trim() : Json.s(cur.get("name"));
		if (name.isEmpty()) throw ApiException.badRequest("ต้องระบุชื่อบัญชี");
		boolean active = b.containsKey("active") ? Boolean.TRUE.equals(b.get("active")) : Boolean.TRUE.equals(cur.get("active"));
		int mvCount = ((Number) cur.get("movementCount")).intValue();
		BigDecimal opening = new BigDecimal(String.valueOf(cur.get("openingBalance"))).setScale(2, java.math.RoundingMode.HALF_UP);
		LocalDate od = LocalDate.parse(String.valueOf(cur.get("openingDate")));
		if (b.containsKey("openingBalance") || b.containsKey("openingDate")) {
			if (mvCount > 0) throw ApiException.conflict("ACCOUNT_IN_USE", "บัญชีนี้มีรายการเคลื่อนไหวแล้ว แก้ยอดยกมาไม่ได้");
			if (b.containsKey("openingBalance")) opening = money(b.get("openingBalance"), "ยอดยกมา", true);
			if (b.containsKey("openingDate")) { od = parseDate(b.get("openingDate"), "วันที่ยอดยกมา"); assertOpenPeriod(od); }
		}
		if (!active && new BigDecimal(String.valueOf(cur.get("balance"))).abs().compareTo(new BigDecimal("0.005")) > 0)
			throw ApiException.conflict("ACCOUNT_HAS_BALANCE", "บัญชีนี้ยังมียอดคงเหลือ " + cur.get("balance") + " — โอนออกให้เป็น 0 ก่อนจึงปิดใช้งานได้");
		jdbc.update("update fin_accounts set name=?, bank_name=?, account_no=?, note=?, active=?, opening_balance=?, opening_date=? where id=?",
			name, b.containsKey("bankName") ? Json.s(b.get("bankName")).trim() : cur.get("bankName"), b.containsKey("accountNo") ? Json.s(b.get("accountNo")).trim() : cur.get("accountNo"),
			b.containsKey("note") ? Json.s(b.get("note")).trim() : cur.get("note"), active, opening, od, id);
		audit.log(u, "FIN_ACCOUNT", "บัญชีเงิน", id, "แก้ไขบัญชี" + (active ? "" : " · ปิดใช้งาน"));
		return account(id);
	}

	// ---------- สมุดเงิน ----------
	public Map<String, Object> ledger(AuthUser u, String accountId, String from, String to) {
		needRead(u);
		Map<String, Object> acc = account(accountId);
		List<Map<String, Object>> rows = jdbc.queryForList(
			"select m.id, to_char(m.mv_date,'YYYY-MM-DD') as date, m.direction, m.amount::float8 as amount, m.source_type as \"sourceType\", m.source_id as \"sourceId\", m.description, m.reversal_of as \"reversalOf\", "
			+ "m.created_by as \"createdBy\", m.cleared from fin_movements m where m.account_id = ? order by m.mv_date, m.id", accountId);
		double bal = ((Number) acc.get("openingBalance")).doubleValue();
		List<Map<String, Object>> out = new ArrayList<>();
		for (Map<String, Object> r : rows) {
			double amt = ((Number) r.get("amount")).doubleValue();
			bal = Math.round((bal + ("in".equals(r.get("direction")) ? amt : -amt)) * 100d) / 100d;
			r.put("balance", bal);
			String d = String.valueOf(r.get("date"));
			if ((from != null && !from.isBlank() && d.compareTo(from) < 0) || (to != null && !to.isBlank() && d.compareTo(to) > 0)) continue;
			out.add(r);
		}
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("account", acc);
		m.put("movements", out);
		return m;
	}

	void addMovement(AuthUser u, String accountId, LocalDate date, String direction, BigDecimal amount, String sourceType, String sourceId, String desc, Long reversalOf) {
		jdbc.update("insert into fin_movements(account_id,mv_date,direction,amount,source_type,source_id,description,reversal_of,created_by) values (?,?,?,?,?,?,?,?,?)",
			accountId, date, direction, amount, sourceType, sourceId, desc, reversalOf, u.fullName());
	}

	private BigDecimal balanceOf(String accountId) {
		return jdbc.queryForObject("select (a.opening_balance + coalesce((select sum(case when m.direction='in' then m.amount else -m.amount end) from fin_movements m where m.account_id = a.id),0)) from fin_accounts a where a.id = ?", BigDecimal.class, accountId);
	}

	/** ล็อกแถวบัญชี (เรียงตามรหัส กัน deadlock) แล้วตรวจสถานะ/วันที่เปิดบัญชี */
	Map<String, Map<String, Object>> lockAccounts(List<String> ids, LocalDate txnDate, boolean requireActive) {
		Map<String, Map<String, Object>> out = new LinkedHashMap<>();
		for (String id : ids.stream().distinct().sorted().toList()) {
			List<Map<String, Object>> r = jdbc.queryForList("select id, type, active, to_char(opening_date,'YYYY-MM-DD') as od, name from fin_accounts where id = ? for update", id);
			if (r.isEmpty()) throw ApiException.badRequest("ไม่พบบัญชีเงิน " + id);
			Map<String, Object> a = r.get(0);
			if (requireActive && !Boolean.TRUE.equals(a.get("active"))) throw ApiException.conflict("ACCOUNT_INACTIVE", "บัญชี " + a.get("name") + " ปิดใช้งานแล้ว");
			if (txnDate.isBefore(LocalDate.parse(String.valueOf(a.get("od"))))) throw ApiException.badRequest("วันที่รายการต้องไม่ก่อนวันที่ยอดยกมาของบัญชี " + a.get("name") + " (" + a.get("od") + ")");
			out.put(id, a);
		}
		return out;
	}

	void assertEnough(Map<String, Object> acc, BigDecimal outflow) {
		String type = Json.s(acc.get("type"));
		if (type.equals("bank")) return; // ธนาคาร: เบิกเกินบัญชีได้ (UI เตือน)
		BigDecimal bal = balanceOf(Json.s(acc.get("id")));
		if (bal.subtract(outflow).signum() < 0) throw ApiException.unprocessable("INSUFFICIENT_FUNDS", "ยอดคงเหลือบัญชี " + acc.get("name") + " (" + bal + ") ไม่พอสำหรับรายการนี้ (" + outflow + ")");
	}

	// ---------- รับ/จ่ายเงินอื่น ๆ · โอนระหว่างบัญชี ----------
	private static final Map<String, String> PREFIX = Map.of("other_in", "RX", "other_out", "PX", "transfer", "TF");
	private static final String TXN_SEL = "select t.id, t.kind, to_char(t.txn_date,'YYYY-MM-DD') as date, t.account_id as \"accountId\", t.to_account_id as \"toAccountId\", t.amount::float8 as amount, t.category, t.counterparty, t.ref_no as \"refNo\", t.note, t.status, "
		+ "t.created_by as \"createdBy\", to_char(t.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') as \"createdAt\", t.approved_by as \"approvedBy\", to_char(t.approved_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') as \"approvedAt\", "
		+ "t.self_approved as \"selfApproved\", t.reject_reason as \"rejectReason\", t.void_reason as \"voidReason\", t.voided_by as \"voidedBy\", to_char(t.void_date,'YYYY-MM-DD') as \"voidDate\" from fin_txns t";

	private static final Map<String, String> TXN_SORTS = Map.of("id", "t.id", "date", "t.txn_date", "amount", "t.amount", "category", "t.category", "status", "t.status", "createdBy", "t.created_by");

	/** ไม่ส่ง page → คืนทั้งหมด · ส่ง page → {items,total,page,size} ค้นหา/ช่วงวันที่/เรียงที่ฝั่งเซิร์ฟเวอร์ */
	public Object listTxns(AuthUser u, String kind, String status, Map<String, String> params) {
		needRead(u);
		ListQuery lq = ListQuery.of(params);
		StringBuilder where = new StringBuilder(" where 1=1");
		List<Object> args = new ArrayList<>();
		if (kind != null && !kind.isBlank()) { where.append(" and t.kind = ?"); args.add(kind); }
		if (status != null && !status.isBlank()) { where.append(" and t.status = ?"); args.add(status); }
		lq.where(where, args, "concat_ws(' ', t.id, t.category, t.counterparty, t.ref_no, t.note, t.account_id, t.to_account_id, t.created_by)", "t.txn_date");
		long total = lq.paged() ? jdbc.queryForObject("select count(*) from fin_txns t" + where, Long.class, args.toArray()) : 0;
		String sql = TXN_SEL + where + lq.orderBy(TXN_SORTS, "t.txn_date desc, t.created_at desc, t.id desc", "t.id desc") + lq.limit();
		return lq.wrap(jdbc.queryForList(sql, args.toArray()), total);
	}

	Map<String, Object> txn(String id) {
		List<Map<String, Object>> r = jdbc.queryForList(TXN_SEL + " where t.id = ?", id);
		if (r.isEmpty()) throw ApiException.notFound("ไม่พบรายการ " + id);
		return r.get(0);
	}

	@Transactional
	public Map<String, Object> createTxn(AuthUser u, Map<String, Object> b) {
		needRead(u);
		String kind = Json.s(b.get("kind"));
		if (!PREFIX.containsKey(kind)) throw ApiException.badRequest("ประเภทรายการต้องเป็น other_in / other_out / transfer");
		LocalDate date = parseDate(b.get("date"), "วันที่");
		if (date.isAfter(today())) throw ApiException.badRequest("วันที่รายการต้องไม่เกินวันนี้");
		assertOpenPeriod(date);
		BigDecimal amount = money(b.get("amount"), "จำนวนเงิน", false);
		String accountId = Json.s(b.get("accountId")).trim();
		String toAccountId = Json.s(b.get("toAccountId")).trim();
		String category = Json.s(b.get("category")).trim();
		if (kind.equals("transfer")) {
			if (toAccountId.isEmpty() || toAccountId.equals(accountId)) throw ApiException.badRequest("โอนระหว่างบัญชีต้องเลือกบัญชีต้นทางและปลายทางที่ต่างกัน");
		} else {
			toAccountId = "";
			if (category.isEmpty()) throw ApiException.badRequest("ต้องระบุหมวดของรายการ (เช่น เงินทุนเจ้าของ เงินเดือน นำส่งภาษี)");
		}
		List<String> ids = kind.equals("transfer") ? List.of(accountId, toAccountId) : List.of(accountId);
		lockAccounts(ids, date, true);
		// เงินออกต้องมีพอตั้งแต่ตอนบันทึก (ตรวจซ้ำอีกครั้งตอนยืนยัน)
		if (!kind.equals("other_in")) assertEnough(lockAccounts(List.of(accountId), date, true).get(accountId), amount);
		String no = (String) counters.next(PREFIX.get(kind), date.toString()).get("docNo");
		double threshold = ((Number) settings().get("approvalThreshold")).doubleValue();
		boolean admin = u.isAdmin();
		boolean autoByThreshold = !admin && threshold > 0 && amount.doubleValue() <= threshold;
		String status = (admin || autoByThreshold) ? "confirmed" : "pending";
		jdbc.update("insert into fin_txns(id,kind,txn_date,account_id,to_account_id,amount,category,counterparty,ref_no,note,status,created_by,created_by_id,approved_by,approved_by_id,approved_at,self_approved) "
			+ "values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,case when ? then now() else null end,?)",
			no, kind, date, accountId, toAccountId.isEmpty() ? null : toAccountId, amount, category, Json.s(b.get("counterparty")).trim(), Json.s(b.get("refNo")).trim(), Json.s(b.get("note")).trim(),
			status, u.fullName(), u.id(), status.equals("confirmed") ? (admin ? u.fullName() : "อัตโนมัติ (ไม่เกินเกณฑ์ " + threshold + ")") : null, status.equals("confirmed") && admin ? u.id() : null,
			status.equals("confirmed"), admin);
		audit.log(u, "FIN_CREATE", "รายการเงิน", no, kind + " " + amount + " บัญชี " + accountId + (kind.equals("transfer") ? " → " + toAccountId : " · " + category) + " · " + status + (admin ? " (admin อนุมัติเอง)" : ""));
		if (status.equals("confirmed")) postMovements(u, no);
		return txn(no);
	}

	/** เขียนสมุดเงินของรายการที่ยืนยันแล้ว (เรียกครั้งเดียวต่อรายการ ภายในธุรกรรมเดียวกับการเปลี่ยนสถานะ) */
	private void postMovements(AuthUser u, String id) {
		Map<String, Object> t = txn(id);
		LocalDate date = LocalDate.parse(String.valueOf(t.get("date")));
		BigDecimal amount = new BigDecimal(String.valueOf(t.get("amount"))).setScale(2, java.math.RoundingMode.HALF_UP);
		String kind = Json.s(t.get("kind")), acc = Json.s(t.get("accountId")), to = Json.s(t.get("toAccountId"));
		String desc = switch (kind) {
			case "other_in" -> "รับเงินอื่น ๆ: " + t.get("category") + (Json.s(t.get("counterparty")).isEmpty() ? "" : " · " + t.get("counterparty"));
			case "other_out" -> "จ่ายเงินอื่น ๆ: " + t.get("category") + (Json.s(t.get("counterparty")).isEmpty() ? "" : " · " + t.get("counterparty"));
			default -> "โอนระหว่างบัญชี " + acc + " → " + to;
		};
		lockAccounts(kind.equals("transfer") ? List.of(acc, to) : List.of(acc), date, true);
		if (kind.equals("other_in")) addMovement(u, acc, date, "in", amount, "fin_txn", id, desc, null);
		else {
			assertEnough(lockAccounts(List.of(acc), date, true).get(acc), amount);
			addMovement(u, acc, date, "out", amount, "fin_txn", id, desc, null);
			if (kind.equals("transfer")) addMovement(u, to, date, "in", amount, "fin_txn", id, desc, null);
		}
	}

	@Transactional
	public Map<String, Object> approve(AuthUser u, String id) {
		needAdmin(u);
		Map<String, Object> t = jdbc.queryForList(TXN_SEL + " where t.id = ? for update of t", id).stream().findFirst().orElseThrow(() -> ApiException.notFound("ไม่พบรายการ " + id));
		if (!"pending".equals(t.get("status"))) throw ApiException.conflict("NOT_PENDING", "รายการ " + id + " ไม่ได้อยู่ในสถานะรออนุมัติ");
		LocalDate date = LocalDate.parse(String.valueOf(t.get("date")));
		assertOpenPeriod(date);
		boolean self = jdbc.queryForObject("select created_by_id = ? from fin_txns where id = ?", Boolean.class, u.id(), id);
		jdbc.update("update fin_txns set status='confirmed', approved_by=?, approved_by_id=?, approved_at=now(), self_approved=? where id=?", u.fullName(), u.id(), self, id);
		postMovements(u, id);
		audit.log(u, "FIN_APPROVE", "รายการเงิน", id, "อนุมัติ" + (self ? " (admin อนุมัติรายการที่ตนเองบันทึก)" : ""));
		return txn(id);
	}

	@Transactional
	public Map<String, Object> reject(AuthUser u, String id, String reason) {
		needAdmin(u);
		if (reason == null || reason.isBlank()) throw ApiException.badRequest("ต้องระบุเหตุผลที่ไม่อนุมัติ");
		Map<String, Object> t = txn(id);
		if (!"pending".equals(t.get("status"))) throw ApiException.conflict("NOT_PENDING", "รายการ " + id + " ไม่ได้อยู่ในสถานะรออนุมัติ");
		jdbc.update("update fin_txns set status='rejected', reject_reason=?, approved_by=?, approved_by_id=?, approved_at=now() where id=?", reason.trim(), u.fullName(), u.id(), id);
		audit.log(u, "FIN_REJECT", "รายการเงิน", id, "ไม่อนุมัติ: " + reason.trim());
		return txn(id);
	}

	/** ผู้บันทึกหรือ admin ยกเลิกรายการที่ยังรออนุมัติได้ (ยังไม่มีเงินเคลื่อนไหว) */
	@Transactional
	public Map<String, Object> cancelPending(AuthUser u, String id, String reason) {
		needRead(u);
		if (reason == null || reason.isBlank()) throw ApiException.badRequest("ต้องระบุเหตุผล");
		Map<String, Object> t = txn(id);
		if (!"pending".equals(t.get("status"))) throw ApiException.conflict("NOT_PENDING", "รายการ " + id + " ไม่ได้อยู่ในสถานะรออนุมัติ");
		boolean mine = jdbc.queryForObject("select created_by_id = ? from fin_txns where id = ?", Boolean.class, u.id(), id);
		if (!mine && !u.isAdmin()) throw ApiException.forbidden("ยกเลิกได้เฉพาะผู้บันทึกหรือ admin");
		jdbc.update("update fin_txns set status='void', void_reason=?, voided_by=?, voided_at=now(), void_date=? where id=?", reason.trim(), u.fullName(), today(), id);
		audit.log(u, "FIN_CANCEL", "รายการเงิน", id, "ยกเลิกก่อนอนุมัติ: " + reason.trim());
		return txn(id);
	}

	/** กลับรายการที่ยืนยันแล้ว: สร้างรายการเคลื่อนไหวตรงข้าม ลงวันที่ void_date (ต้องอยู่ในงวดที่เปิดอยู่ และไม่ก่อนวันที่รายการเดิม) */
	@Transactional
	public Map<String, Object> voidTxn(AuthUser u, String id, String reason, Object dateObj) {
		needAdmin(u);
		if (reason == null || reason.isBlank()) throw ApiException.badRequest("ต้องระบุเหตุผลการกลับรายการ");
		Map<String, Object> t = jdbc.queryForList(TXN_SEL + " where t.id = ? for update of t", id).stream().findFirst().orElseThrow(() -> ApiException.notFound("ไม่พบรายการ " + id));
		if (!"confirmed".equals(t.get("status"))) throw ApiException.conflict("NOT_CONFIRMED", "กลับรายการได้เฉพาะรายการที่ยืนยันแล้ว");
		LocalDate orig = LocalDate.parse(String.valueOf(t.get("date")));
		LocalDate vd = dateObj == null || Json.s(dateObj).isBlank() ? today() : parseDate(dateObj, "วันที่กลับรายการ");
		if (vd.isBefore(orig)) throw ApiException.badRequest("วันที่กลับรายการต้องไม่ก่อนวันที่รายการเดิม (" + orig + ")");
		if (vd.isAfter(today())) throw ApiException.badRequest("วันที่กลับรายการต้องไม่เกินวันนี้");
		assertOpenPeriod(vd);
		List<Map<String, Object>> mvs = jdbc.queryForList("select id, account_id, direction, amount from fin_movements where source_type='fin_txn' and source_id = ? and reversal_of is null order by id", id);
		List<String> accs = mvs.stream().map(m -> String.valueOf(m.get("account_id"))).toList();
		Map<String, Map<String, Object>> locked = lockAccounts(accs, vd, false);
		// กลับเงินเข้า = เงินออก ต้องมียอดพอ (เงินสด/เช็ค)
		for (Map<String, Object> m : mvs) if ("in".equals(m.get("direction"))) assertEnough(locked.get(String.valueOf(m.get("account_id"))), (BigDecimal) m.get("amount"));
		for (Map<String, Object> m : mvs) {
			addMovement(u, String.valueOf(m.get("account_id")), vd, "in".equals(m.get("direction")) ? "out" : "in", (BigDecimal) m.get("amount"), "fin_txn", id,
				"กลับรายการ " + id + ": " + reason.trim(), ((Number) m.get("id")).longValue());
		}
		jdbc.update("update fin_txns set status='void', void_reason=?, voided_by=?, voided_at=now(), void_date=? where id=?", reason.trim(), u.fullName(), vd, id);
		audit.log(u, "FIN_VOID", "รายการเงิน", id, "กลับรายการ ลงวันที่ " + vd + ": " + reason.trim());
		return txn(id);
	}

	public Map<String, Object> summary(AuthUser u) {
		needRead(u);
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("pendingCount", jdbc.queryForObject("select count(*)::int from fin_txns where status = 'pending'", Integer.class));
		m.put("totalBalance", jdbc.queryForObject("select coalesce(sum(a.opening_balance + coalesce((select sum(case when m.direction='in' then m.amount else -m.amount end) from fin_movements m where m.account_id = a.id),0)),0)::float8 from fin_accounts a where a.active", Double.class));
		m.put("settings", settings());
		return m;
	}
}
