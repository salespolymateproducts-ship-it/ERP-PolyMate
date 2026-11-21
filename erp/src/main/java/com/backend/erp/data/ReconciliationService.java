package com.backend.erp.data;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.backend.erp.auth.AuthUser;
import com.backend.erp.common.ApiException;
import com.backend.erp.common.Json;

/**
 * การเงิน ขั้น 1C: กระทบยอดบัญชีธนาคาร
 *  • ยอดที่กระทบแล้ว (cleared balance) = ยอดยกมา + Σ รายการที่ cleared (เข้า − ออก)
 *  • 1 รอบ: เลือกวันที่/ยอดคงเหลือตาม Statement แล้วติ๊กรายการสมุดเงินที่ยังไม่กระทบ (วันที่ไม่เกินวัน Statement)
 *    ยืนยันได้เมื่อ  ยอดที่กระทบแล้ว + เข้า − ออก (ของรายการที่ติ๊ก) = ยอดตาม Statement  (ผลต่าง 0)
 *  • รายการ "กลับรายการ" เป็นรายการแยกในสมุดเงิน ติ๊กคู่กับรายการเดิมได้ (หักล้างกัน)
 *  • ยกเลิกรอบ (admin) ได้เฉพาะรอบล่าสุดของบัญชี → รายการกลับเป็นยังไม่กระทบ · การกระทบยอดไม่เปลี่ยนยอดเงินในสมุดเงิน
 */
@Service
public class ReconciliationService {
	private static final BigDecimal EPS = new BigDecimal("0.005");
	private final JdbcTemplate jdbc;
	private final CounterService counters;
	private final AuditService audit;

	public ReconciliationService(JdbcTemplate jdbc, CounterService counters, AuditService audit) {
		this.jdbc = jdbc;
		this.counters = counters;
		this.audit = audit;
	}

	private static void needDo(AuthUser u) {
		if (u == null || !(u.isAdmin() || "accounting".equals(u.role()))) throw ApiException.forbidden("เฉพาะผู้ดูแลระบบและฝ่ายบัญชีกระทบยอดได้");
	}

	private Map<String, Object> bankAccount(String id, boolean lock) {
		List<Map<String, Object>> r = jdbc.queryForList("select id, code, name, type, bank_name as \"bankName\", account_no as \"accountNo\", opening_balance, active from fin_accounts where id = ?" + (lock ? " for update" : ""), id);
		if (r.isEmpty()) throw ApiException.notFound("ไม่พบบัญชีเงิน " + id);
		if (!"bank".equals(r.get(0).get("type"))) throw ApiException.badRequest("กระทบยอดได้เฉพาะบัญชีธนาคาร (บัญชีนี้เป็น " + r.get(0).get("type") + ")");
		return r.get(0);
	}

	private BigDecimal clearedBalance(String accountId) {
		return jdbc.queryForObject("select (a.opening_balance + coalesce((select sum(case when m.direction='in' then m.amount else -m.amount end) from fin_movements m where m.account_id = a.id and m.cleared),0)) from fin_accounts a where a.id = ?", BigDecimal.class, accountId);
	}

	private Map<String, Object> lastRec(String accountId) {
		List<Map<String, Object>> r = jdbc.queryForList("select id, to_char(statement_date,'YYYY-MM-DD') as \"statementDate\", statement_balance::float8 as \"statementBalance\" from fin_reconciliations where account_id = ? and status = 'done' order by statement_date desc, created_at desc, id desc limit 1", accountId);
		return r.isEmpty() ? null : r.get(0);
	}

	/** พื้นที่ทำงาน: ยอดที่กระทบแล้ว + รายการที่ยังไม่กระทบ (วันที่ไม่เกินวัน Statement) */
	public Map<String, Object> workspace(AuthUser u, String accountId, String date) {
		FinanceService.needRead(u);
		Map<String, Object> acc = bankAccount(accountId, false);
		LocalDate d = date == null || date.isBlank() ? FinanceService.today() : FinanceService.parseDate(date, "วันที่ Statement");
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("account", Map.of("id", acc.get("id"), "code", acc.get("code"), "name", acc.get("name"), "bankName", acc.get("bankName"), "accountNo", acc.get("accountNo")));
		m.put("statementDate", d.toString());
		m.put("clearedBalance", clearedBalance(accountId).doubleValue());
		m.put("lastReconciliation", lastRec(accountId));
		m.put("items", jdbc.queryForList("select m.id, to_char(m.mv_date,'YYYY-MM-DD') as date, m.direction, m.amount::float8 as amount, m.source_type as \"sourceType\", m.source_id as \"sourceId\", m.description, m.reversal_of as \"reversalOf\" "
			+ "from fin_movements m where m.account_id = ? and not m.cleared and m.mv_date <= ? order by m.mv_date, m.id", accountId, d));
		return m;
	}

	public List<Map<String, Object>> history(AuthUser u, String accountId) {
		FinanceService.needRead(u);
		bankAccount(accountId, false);
		return jdbc.queryForList("select id, to_char(statement_date,'YYYY-MM-DD') as \"statementDate\", statement_balance::float8 as \"statementBalance\", cleared_in::float8 as \"clearedIn\", cleared_out::float8 as \"clearedOut\", "
			+ "item_count as \"itemCount\", note, status, created_by as \"createdBy\", to_char(created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') as \"createdAt\", void_reason as \"voidReason\", voided_by as \"voidedBy\" "
			+ "from fin_reconciliations where account_id = ? order by statement_date desc, created_at desc, id desc limit 100", accountId);
	}

	@Transactional
	public Map<String, Object> create(AuthUser u, Map<String, Object> b) {
		needDo(u);
		String accountId = Json.s(b.get("accountId")).trim();
		bankAccount(accountId, true);                                                // ล็อกบัญชี กันกระทบพร้อมกันสองคน
		LocalDate sd = FinanceService.parseDate(b.get("statementDate"), "วันที่ Statement");
		if (sd.isAfter(FinanceService.today())) throw ApiException.badRequest("วันที่ Statement ต้องไม่เกินวันนี้");
		BigDecimal stBal = FinanceService.money(b.get("statementBalance"), "ยอดคงเหลือตาม Statement", true);
		Map<String, Object> last = lastRec(accountId);
		if (last != null && sd.isBefore(LocalDate.parse(String.valueOf(last.get("statementDate")))))
			throw ApiException.conflict("RECON_ORDER", "วันที่ Statement ต้องไม่ก่อนรอบล่าสุด (" + last.get("statementDate") + " · " + last.get("id") + ")");
		Object raw = b.get("movementIds");
		if (!(raw instanceof List<?> l) || l.isEmpty()) throw ApiException.badRequest("ต้องเลือกรายการที่ตรงกับ Statement อย่างน้อย 1 รายการ");
		Set<Long> ids = new LinkedHashSet<>();
		for (Object o : l) {
			try { ids.add(Long.parseLong(Json.s(o).trim())); } catch (NumberFormatException e) { throw ApiException.badRequest("เลขรายการไม่ถูกต้อง: " + o); }
		}
		if (ids.size() != l.size()) throw ApiException.badRequest("มีรายการซ้ำในที่เลือก");
		BigDecimal in = BigDecimal.ZERO, out = BigDecimal.ZERO;
		for (Long id : ids) {
			List<Map<String, Object>> r = jdbc.queryForList("select account_id, mv_date, direction, amount, cleared from fin_movements where id = ? for update", id);
			if (r.isEmpty() || !accountId.equals(r.get(0).get("account_id"))) throw ApiException.badRequest("รายการ #" + id + " ไม่ใช่ของบัญชีนี้");
			Map<String, Object> m = r.get(0);
			if (Boolean.TRUE.equals(m.get("cleared"))) throw ApiException.conflict("ALREADY_CLEARED", "รายการ #" + id + " กระทบยอดไปแล้ว");
			if (((java.sql.Date) m.get("mv_date")).toLocalDate().isAfter(sd)) throw ApiException.badRequest("รายการ #" + id + " ลงวันที่หลังวัน Statement (" + sd + ")");
			BigDecimal amt = (BigDecimal) m.get("amount");
			if ("in".equals(m.get("direction"))) in = in.add(amt); else out = out.add(amt);
		}
		BigDecimal opening = clearedBalance(accountId);
		BigDecimal computed = opening.add(in).subtract(out).setScale(2, RoundingMode.HALF_UP);
		BigDecimal diff = stBal.subtract(computed);
		if (diff.abs().compareTo(EPS) > 0)
			throw ApiException.conflict("RECON_DIFF", "ยังกระทบไม่ตรง: ยอดตาม Statement " + stBal + " แต่ยอดที่คำนวณได้ " + computed + " (ผลต่าง " + diff.setScale(2, RoundingMode.HALF_UP) + ")");
		String id = (String) counters.next("BR", sd.toString()).get("docNo");
		jdbc.update("insert into fin_reconciliations(id,account_id,statement_date,statement_balance,opening_cleared,cleared_in,cleared_out,item_count,note,status,created_by,created_by_id) values (?,?,?,?,?,?,?,?,?,'done',?,?)",
			id, accountId, sd, stBal, opening, in, out, ids.size(), Json.s(b.get("note")).trim(), u.fullName(), u.id());
		for (Long mid : ids) jdbc.update("update fin_movements set cleared = true, cleared_at = now(), statement_ref = ? where id = ?", id, mid);
		audit.log(u, "FIN_RECON", "กระทบยอดธนาคาร", id, "บัญชี " + accountId + " Statement ณ " + sd + " ยอด " + stBal + " · " + ids.size() + " รายการ (เข้า " + in + " / ออก " + out + ")");
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("id", id); m.put("accountId", accountId); m.put("statementDate", sd.toString()); m.put("statementBalance", stBal.doubleValue()); m.put("itemCount", ids.size());
		return m;
	}

	@Transactional
	public Map<String, Object> voidRec(AuthUser u, String id, String reason) {
		FinanceService.needAdmin(u);
		if (reason == null || reason.isBlank()) throw ApiException.badRequest("ต้องระบุเหตุผลการยกเลิกรอบกระทบยอด");
		List<Map<String, Object>> r = jdbc.queryForList("select account_id, status from fin_reconciliations where id = ? for update", id);
		if (r.isEmpty()) throw ApiException.notFound("ไม่พบรอบกระทบยอด " + id);
		String accountId = (String) r.get(0).get("account_id");
		bankAccount(accountId, true);
		if (!"done".equals(r.get(0).get("status"))) throw ApiException.conflict("NOT_DONE", "รอบนี้ถูกยกเลิกไปแล้ว");
		Map<String, Object> last = lastRec(accountId);
		if (last == null || !id.equals(last.get("id"))) throw ApiException.conflict("NOT_LATEST", "ยกเลิกได้เฉพาะรอบล่าสุดของบัญชี (ล่าสุดคือ " + (last == null ? "-" : last.get("id")) + ")");
		int n = jdbc.update("update fin_movements set cleared = false, cleared_at = null, statement_ref = null where statement_ref = ?", id);
		jdbc.update("update fin_reconciliations set status='void', void_reason=?, voided_by=?, voided_at=now() where id=?", reason.trim(), u.fullName(), id);
		audit.log(u, "FIN_RECON_VOID", "กระทบยอดธนาคาร", id, "ยกเลิกรอบ (" + n + " รายการกลับเป็นยังไม่กระทบ): " + reason.trim());
		return Map.of("id", id, "status", "void", "released", n);
	}
}
