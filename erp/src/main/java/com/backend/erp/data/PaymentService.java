package com.backend.erp.data;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
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
 * การเงิน ขั้น A3: ใบสำคัญจ่าย (PV) → อนุมัติ → จ่ายเงิน
 *
 *  • ใบสำคัญจ่ายผูกกับค่าใช้จ่าย (erp_records collection 'expenses', status = approved) ผู้รับเงินเดียวกัน · ค่าใช้จ่ายหนึ่งรายการอยู่ในใบสำคัญจ่ายที่ยังไม่ยกเลิกได้ใบเดียว
 *  • ยอดจ่ายสุทธิ = Σ(ฐาน + VAT − หัก ณ ที่จ่าย) · หัก ณ ที่จ่าย (WT) ออกเลขหนังสือ ณ วันจ่ายจริง (ไม่ใช่วันบันทึกค่าใช้จ่าย)
 *  • ผู้บันทึก ≠ ผู้อนุมัติ (admin อนุมัติเองได้ ติดป้าย self_approved) · เงินออกสมุดเงินเมื่อ "จ่าย" เท่านั้น · จ่ายแล้วแก้ไม่ได้ ใช้กลับรายการ
 *  • เมื่อจ่าย ค่าใช้จ่ายถูกปรับเป็น paid (paidDate/paidBy/payVoucher) · กลับรายการแล้วคืนเป็น approved
 *  • การออกหนังสือ 50 ทวิ แบบเดิมในหน้าบัญชี (expense.whtCert) ยังแยกอยู่ — รวมกันในขั้น A4
 */
@Service
public class PaymentService {
	private final JdbcTemplate jdbc;
	private final FinanceService fin;
	private final CounterService counters;
	private final AuditService audit;

	public PaymentService(JdbcTemplate jdbc, FinanceService fin, CounterService counters, AuditService audit) {
		this.jdbc = jdbc;
		this.fin = fin;
		this.counters = counters;
		this.audit = audit;
	}

	private static BigDecimal bd(Object o) { return o == null || String.valueOf(o).isBlank() ? BigDecimal.ZERO.setScale(2) : new BigDecimal(String.valueOf(o)).setScale(2, RoundingMode.HALF_UP); }

	private static final String PV_SEL = "select v.id, to_char(v.pv_date,'YYYY-MM-DD') as date, v.payee, v.gross::float8 as gross, v.wht::float8 as wht, v.net::float8 as net, v.note, v.status, v.account_id as \"accountId\", "
		+ "to_char(v.pay_date,'YYYY-MM-DD') as \"payDate\", v.ref_no as \"refNo\", v.wht_cert_no as \"whtCertNo\", to_char(v.wht_cert_date,'YYYY-MM-DD') as \"whtCertDate\", v.created_by as \"createdBy\", "
		+ "to_char(v.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') as \"createdAt\", v.approved_by as \"approvedBy\", v.self_approved as \"selfApproved\", v.paid_by as \"paidBy\", "
		+ "v.reject_reason as \"rejectReason\", v.void_reason as \"voidReason\", v.voided_by as \"voidedBy\", to_char(v.void_date,'YYYY-MM-DD') as \"voidDate\" from fin_pay_vouchers v";

	private Map<String, Object> voucher(String id) {
		List<Map<String, Object>> r = jdbc.queryForList(PV_SEL + " where v.id = ?", id);
		if (r.isEmpty()) throw ApiException.notFound("ไม่พบใบสำคัญจ่าย " + id);
		Map<String, Object> m = new LinkedHashMap<>(r.get(0));
		// ข้อมูลที่มาของค่าใช้จ่าย (ให้ผู้อนุมัติรู้ว่าจ่ายค่าอะไร มาจากเอกสารใด): รายการ · หมวด · เลข PO (ref) · วันที่ · ครบกำหนด
		m.put("items", jdbc.queryForList("select i.expense_id as \"expenseId\", i.base::float8 as base, i.vat::float8 as vat, i.wht::float8 as wht, (i.base + i.vat - i.wht)::float8 as net, "
			+ "coalesce(e.data->>'desc','') as descr, coalesce(e.data->>'category','') as category, coalesce(e.data->>'ref','') as ref, coalesce(e.data->>'date','') as \"expenseDate\", coalesce(e.data->>'due','') as due, "
			+ "coalesce(e.data->>'whtRate','0') as \"whtRate\" from fin_pay_items i left join erp_records e on e.collection = 'expenses' and e.id = i.expense_id where i.voucher_id = ? order by i.id", id));
		return m;
	}

	public List<Map<String, Object>> list(AuthUser u, String status) {
		FinanceService.needRead(u);
		StringBuilder sql = new StringBuilder(PV_SEL + " where 1=1");
		List<Object> args = new ArrayList<>();
		if (status != null && !status.isBlank()) { sql.append(" and v.status = ?"); args.add(status); }
		sql.append(" order by v.pv_date desc, v.created_at desc limit 500");
		List<Map<String, Object>> out = new ArrayList<>();
		for (Map<String, Object> r : jdbc.queryForList(sql.toString(), args.toArray())) out.add(voucher(String.valueOf(r.get("id"))));
		return out;
	}

	public Map<String, Object> get(AuthUser u, String id) {
		FinanceService.needRead(u);
		return voucher(id);
	}

	private static final String EXP_SEL = "select id, data->>'vendor' as vendor, data->>'status' as status, coalesce(data->>'amount','0') as amount, coalesce(data->>'vat','0') as vat, "
		+ "coalesce(data->>'whtRate','0') as \"whtRate\", coalesce(data->>'date','') as date, coalesce(data->>'due','') as due, coalesce(data->>'desc','') as descr, coalesce(data->>'category','') as category, coalesce(data->>'ref','') as ref from erp_records where collection = 'expenses'";

	private static BigDecimal whtOf(BigDecimal base, Object rate) { return base.multiply(bd(rate)).divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP); }

	private boolean inActiveVoucher(String expenseId) {
		Integer n = jdbc.queryForObject("select count(*)::int from fin_pay_items i join fin_pay_vouchers v on v.id = i.voucher_id where i.expense_id = ? and v.status in ('pending','approved','paid')", Integer.class, expenseId);
		return n != null && n > 0;
	}

	/** ค่าใช้จ่ายที่อนุมัติแล้วและยังไม่ถูกผูกกับใบสำคัญจ่าย (รอจ่าย) */
	public List<Map<String, Object>> payables(AuthUser u) {
		FinanceService.needRead(u);
		List<Map<String, Object>> out = new ArrayList<>();
		for (Map<String, Object> e : jdbc.queryForList(EXP_SEL + " and data->>'status' = 'approved' order by data->>'date', id")) {
			String id = String.valueOf(e.get("id"));
			if (inActiveVoucher(id)) continue;
			BigDecimal base = bd(e.get("amount")), vat = bd(e.get("vat")), wht = whtOf(base, e.get("whtRate"));
			Map<String, Object> m = new LinkedHashMap<>();
			m.put("id", id); m.put("vendor", e.get("vendor")); m.put("date", e.get("date")); m.put("due", e.get("due")); m.put("desc", e.get("descr")); m.put("category", e.get("category")); m.put("ref", e.get("ref"));
			m.put("base", base.doubleValue()); m.put("vat", vat.doubleValue()); m.put("wht", wht.doubleValue()); m.put("net", base.add(vat).subtract(wht).doubleValue());
			out.add(m);
		}
		return out;
	}

	// ---------- สร้าง ----------
	/**
	 * body: { date, expenseIds[], note, pay?: { accountId, payDate, refNo } }  — pay = "บันทึกและจ่ายทันที"
	 * admin (หรือยอดไม่เกินเกณฑ์) → approved ทันที แล้วจ่ายต่อถ้าส่ง pay มา · ผู้ใช้อื่น → pending (ยังไม่จ่าย)
	 */
	@SuppressWarnings("unchecked")
	@Transactional
	public Map<String, Object> create(AuthUser u, Map<String, Object> b) {
		FinanceService.needRead(u);
		LocalDate date = FinanceService.parseDate(b.get("date"), "วันที่ใบสำคัญจ่าย");
		if (date.isAfter(FinanceService.today())) throw ApiException.badRequest("วันที่ใบสำคัญจ่ายต้องไม่เกินวันนี้");
		fin.assertOpenPeriod(date);
		if (!(b.get("expenseIds") instanceof List<?> ids) || ids.isEmpty()) throw ApiException.badRequest("ต้องเลือกค่าใช้จ่ายอย่างน้อย 1 รายการ");
		List<String> sorted = ((List<Object>) ids).stream().map(o -> Json.s(o).trim()).sorted().toList();
		if (sorted.stream().distinct().count() != sorted.size()) throw ApiException.badRequest("มีค่าใช้จ่ายซ้ำในรายการที่เลือก");
		String payee = null;
		BigDecimal gross = BigDecimal.ZERO, wht = BigDecimal.ZERO;
		List<Object[]> items = new ArrayList<>();
		for (String eid : sorted) {
			List<Map<String, Object>> r = jdbc.queryForList(EXP_SEL + " and id = ? for update", eid);
			if (r.isEmpty()) throw ApiException.badRequest("ไม่พบค่าใช้จ่าย " + eid);
			Map<String, Object> e = r.get(0);
			if (!"approved".equals(e.get("status"))) throw ApiException.conflict("EXPENSE_NOT_PAYABLE", "ค่าใช้จ่าย " + eid + " ไม่อยู่ในสถานะรอจ่าย (สถานะ: " + e.get("status") + ")");
			if (inActiveVoucher(eid)) throw ApiException.conflict("EXPENSE_IN_VOUCHER", "ค่าใช้จ่าย " + eid + " อยู่ในใบสำคัญจ่ายอื่นแล้ว");
			String v = Json.s(e.get("vendor")).trim();
			if (v.isEmpty()) throw ApiException.badRequest("ค่าใช้จ่าย " + eid + " ไม่ระบุผู้รับเงิน");
			if (payee == null) payee = v;
			else if (!payee.equalsIgnoreCase(v)) throw ApiException.badRequest("ใบสำคัญจ่ายหนึ่งใบจ่ายผู้รับเงินคนเดียว (พบ " + payee + " และ " + v + ")");
			BigDecimal base = bd(e.get("amount")), vat = bd(e.get("vat")), w = whtOf(base, e.get("whtRate"));
			if (base.signum() <= 0) throw ApiException.badRequest("ค่าใช้จ่าย " + eid + " ยอดไม่ถูกต้อง");
			gross = gross.add(base).add(vat);
			wht = wht.add(w);
			items.add(new Object[] { eid, base, vat, w });
		}
		BigDecimal net = gross.subtract(wht);
		String no = (String) counters.next("PV", date.toString()).get("docNo");
		double threshold = ((Number) fin.settings().get("approvalThreshold")).doubleValue();
		boolean admin = u.isAdmin();
		boolean auto = !admin && threshold > 0 && net.doubleValue() <= threshold;
		boolean approved = admin || auto;
		jdbc.update("insert into fin_pay_vouchers(id,pv_date,payee,gross,wht,net,note,status,created_by,created_by_id,approved_by,approved_by_id,approved_at,self_approved) values (?,?,?,?,?,?,?,?,?,?,?,?,case when ? then now() else null end,?)",
			no, date, payee, gross, wht, net, Json.s(b.get("note")).trim(), approved ? "approved" : "pending", u.fullName(), u.id(),
			approved ? (admin ? u.fullName() : "อัตโนมัติ (ไม่เกินเกณฑ์ " + threshold + ")") : null, approved && admin ? u.id() : null, approved, admin);
		for (Object[] it : items) jdbc.update("insert into fin_pay_items(voucher_id,expense_id,base,vat,wht) values (?,?,?,?,?)", no, it[0], it[1], it[2], it[3]);
		audit.log(u, "PV_CREATE", "ใบสำคัญจ่าย", no, "ผู้รับเงิน " + payee + " สุทธิ " + net + " (หัก ณ ที่จ่าย " + wht + ") ค่าใช้จ่าย " + sorted + " · " + (approved ? "approved" : "pending") + (admin ? " (admin อนุมัติเอง)" : ""));
		if (approved && b.get("pay") instanceof Map<?, ?> pay) doPay(u, no, (Map<String, Object>) pay);
		return voucher(no);
	}

	@Transactional
	public Map<String, Object> approve(AuthUser u, String id) {
		FinanceService.needAdmin(u);
		List<Map<String, Object>> cur = jdbc.queryForList("select status, pv_date, created_by_id = ? as mine from fin_pay_vouchers where id = ? for update", u.id(), id);
		if (cur.isEmpty()) throw ApiException.notFound("ไม่พบใบสำคัญจ่าย " + id);
		if (!"pending".equals(cur.get(0).get("status"))) throw ApiException.conflict("NOT_PENDING", "ใบสำคัญจ่าย " + id + " ไม่ได้อยู่ในสถานะรออนุมัติ");
		jdbc.update("update fin_pay_vouchers set status='approved', approved_by=?, approved_by_id=?, approved_at=now(), self_approved=? where id=?", u.fullName(), u.id(), cur.get(0).get("mine"), id);
		audit.log(u, "PV_APPROVE", "ใบสำคัญจ่าย", id, "อนุมัติ" + (Boolean.TRUE.equals(cur.get(0).get("mine")) ? " (admin อนุมัติรายการที่ตนเองบันทึก)" : ""));
		return voucher(id);
	}

	@Transactional
	public Map<String, Object> reject(AuthUser u, String id, String reason) {
		FinanceService.needAdmin(u);
		if (reason == null || reason.isBlank()) throw ApiException.badRequest("ต้องระบุเหตุผลที่ไม่อนุมัติ");
		jdbc.queryForList("select id from fin_pay_vouchers where id = ? for update", id).stream().findFirst().orElseThrow(() -> ApiException.notFound("ไม่พบใบสำคัญจ่าย " + id));
		if (!"pending".equals(voucher(id).get("status"))) throw ApiException.conflict("NOT_PENDING", "ใบสำคัญจ่าย " + id + " ไม่ได้อยู่ในสถานะรออนุมัติ");
		jdbc.update("update fin_pay_vouchers set status='rejected', reject_reason=?, approved_by=?, approved_by_id=?, approved_at=now() where id=?", reason.trim(), u.fullName(), u.id(), id);
		audit.log(u, "PV_REJECT", "ใบสำคัญจ่าย", id, "ไม่อนุมัติ: " + reason.trim());
		return voucher(id);
	}

	/** ผู้บันทึกหรือ admin ยกเลิกใบที่ยังไม่จ่าย (pending/approved) — ค่าใช้จ่ายกลับไปรอจ่าย */
	@Transactional
	public Map<String, Object> cancel(AuthUser u, String id, String reason) {
		FinanceService.needRead(u);
		if (reason == null || reason.isBlank()) throw ApiException.badRequest("ต้องระบุเหตุผล");
		List<Map<String, Object>> cur = jdbc.queryForList("select status, created_by_id = ? as mine from fin_pay_vouchers where id = ? for update", u.id(), id);
		if (cur.isEmpty()) throw ApiException.notFound("ไม่พบใบสำคัญจ่าย " + id);
		String st = String.valueOf(cur.get(0).get("status"));
		if (!List.of("pending", "approved").contains(st)) throw ApiException.conflict("NOT_CANCELLABLE", "ยกเลิกได้เฉพาะใบที่ยังไม่จ่าย (ใบที่จ่ายแล้วใช้กลับรายการ)");
		if (!Boolean.TRUE.equals(cur.get(0).get("mine")) && !u.isAdmin()) throw ApiException.forbidden("ยกเลิกได้เฉพาะผู้บันทึกหรือ admin");
		jdbc.update("update fin_pay_vouchers set status='void', void_reason=?, voided_by=?, voided_at=now(), void_date=? where id=?", reason.trim(), u.fullName(), FinanceService.today(), id);
		audit.log(u, "PV_CANCEL", "ใบสำคัญจ่าย", id, "ยกเลิกก่อนจ่าย: " + reason.trim());
		return voucher(id);
	}

	// ---------- จ่ายเงิน ----------
	@Transactional
	public Map<String, Object> pay(AuthUser u, String id, Map<String, Object> b) {
		FinanceService.needRead(u);
		doPay(u, id, b);
		return voucher(id);
	}

	private void doPay(AuthUser u, String id, Map<String, Object> b) {
		List<Map<String, Object>> cur = jdbc.queryForList("select status, to_char(pv_date,'YYYY-MM-DD') as d, net, wht, payee from fin_pay_vouchers where id = ? for update", id);
		if (cur.isEmpty()) throw ApiException.notFound("ไม่พบใบสำคัญจ่าย " + id);
		Map<String, Object> v = cur.get(0);
		if (!"approved".equals(v.get("status"))) throw ApiException.conflict("NOT_APPROVED", "จ่ายได้เฉพาะใบสำคัญจ่ายที่อนุมัติแล้ว (สถานะปัจจุบัน: " + v.get("status") + ")");
		LocalDate payDate = FinanceService.parseDate(b.get("payDate"), "วันที่จ่ายเงิน");
		if (payDate.isAfter(FinanceService.today())) throw ApiException.badRequest("วันที่จ่ายเงินต้องไม่เกินวันนี้");
		if (payDate.isBefore(LocalDate.parse(String.valueOf(v.get("d"))))) throw ApiException.badRequest("วันที่จ่ายเงินต้องไม่ก่อนวันที่ใบสำคัญจ่าย (" + v.get("d") + ")");
		fin.assertOpenPeriod(payDate);
		String acc = Json.s(b.get("accountId")).trim();
		if (acc.isEmpty()) throw ApiException.badRequest("ต้องเลือกบัญชีที่จ่ายเงิน");
		BigDecimal net = bd(v.get("net")), wht = bd(v.get("wht"));
		Map<String, Object> a = fin.lockAccounts(List.of(acc), payDate, true).get(acc);
		if (net.signum() > 0) {
			fin.assertEnough(a, net);
			fin.addMovement(u, acc, payDate, "out", net, "fin_pay", id, "จ่าย " + v.get("payee") + " (" + id + ")", null);
		}
		String cert = null;
		if (wht.signum() > 0) cert = (String) counters.next("WT", payDate.toString()).get("docNo");
		jdbc.update("update fin_pay_vouchers set status='paid', account_id=?, pay_date=?, ref_no=?, paid_by=?, paid_at=now(), wht_cert_no=?, wht_cert_date=? where id=?",
			acc, payDate, Json.s(b.get("refNo")).trim(), u.fullName(), cert, cert == null ? null : payDate, id);
		for (Map<String, Object> it : jdbc.queryForList("select expense_id from fin_pay_items where voucher_id = ?", id))
			jdbc.update("update erp_records set data = data || jsonb_build_object('status','paid','paidDate',?::text,'paidBy',?::text,'payVoucher',?::text), version = version + 1, updated_at = now(), updated_by = ? where collection = 'expenses' and id = ?",
				payDate.toString(), u.fullName(), id, u.fullName(), it.get("expense_id"));
		audit.log(u, "PV_PAY", "ใบสำคัญจ่าย", id, "จ่าย " + net + " จากบัญชี " + acc + " ณ " + payDate + (cert != null ? " · หนังสือหัก ณ ที่จ่าย " + cert + " ยอด " + wht : ""));
	}

	/** กลับรายการใบที่จ่ายแล้ว: เงินกลับเข้าบัญชีลงวันที่กลับรายการ · ค่าใช้จ่ายกลับเป็นรอจ่าย · เลขหนังสือหัก ณ ที่จ่ายถือเป็นโมฆะ */
	@Transactional
	public Map<String, Object> voidPaid(AuthUser u, String id, String reason, Object dateObj) {
		FinanceService.needAdmin(u);
		if (reason == null || reason.isBlank()) throw ApiException.badRequest("ต้องระบุเหตุผลการกลับรายการ");
		jdbc.queryForList("select id from fin_pay_vouchers where id = ? for update", id).stream().findFirst().orElseThrow(() -> ApiException.notFound("ไม่พบใบสำคัญจ่าย " + id));
		Map<String, Object> v = voucher(id);
		if (!"paid".equals(v.get("status"))) throw ApiException.conflict("NOT_PAID", "กลับรายการได้เฉพาะใบสำคัญจ่ายที่จ่ายแล้ว");
		LocalDate orig = LocalDate.parse(String.valueOf(v.get("payDate")));
		LocalDate vd = dateObj == null || Json.s(dateObj).isBlank() ? FinanceService.today() : FinanceService.parseDate(dateObj, "วันที่กลับรายการ");
		if (vd.isBefore(orig)) throw ApiException.badRequest("วันที่กลับรายการต้องไม่ก่อนวันที่จ่ายเดิม (" + orig + ")");
		if (vd.isAfter(FinanceService.today())) throw ApiException.badRequest("วันที่กลับรายการต้องไม่เกินวันนี้");
		fin.assertOpenPeriod(vd);
		for (Map<String, Object> m : jdbc.queryForList("select id, account_id, amount from fin_movements where source_type='fin_pay' and source_id = ? and reversal_of is null", id)) {
			String acc = String.valueOf(m.get("account_id"));
			fin.lockAccounts(List.of(acc), vd, false);
			fin.addMovement(u, acc, vd, "in", (BigDecimal) m.get("amount"), "fin_pay", id, "กลับรายการ " + id + ": " + reason.trim(), ((Number) m.get("id")).longValue());
		}
		for (Map<String, Object> it : jdbc.queryForList("select expense_id from fin_pay_items where voucher_id = ?", id))
			jdbc.update("update erp_records set data = (data - 'paidDate' - 'paidBy' - 'payVoucher') || '{\"status\":\"approved\"}'::jsonb, version = version + 1, updated_at = now(), updated_by = ? where collection = 'expenses' and id = ?", u.fullName(), it.get("expense_id"));
		jdbc.update("update fin_pay_vouchers set status='void', void_reason=?, voided_by=?, voided_at=now(), void_date=? where id=?", reason.trim(), u.fullName(), vd, id);
		audit.log(u, "PV_VOID", "ใบสำคัญจ่าย", id, "กลับรายการ ลงวันที่ " + vd + ": " + reason.trim() + (v.get("whtCertNo") != null ? " · หนังสือหัก ณ ที่จ่าย " + v.get("whtCertNo") + " เป็นโมฆะ" : ""));
		return voucher(id);
	}

	public Map<String, Object> summary(AuthUser u) {
		FinanceService.needRead(u);
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("pendingCount", jdbc.queryForObject("select count(*)::int from fin_pay_vouchers where status = 'pending'", Integer.class));
		m.put("toPayCount", jdbc.queryForObject("select count(*)::int from fin_pay_vouchers where status = 'approved'", Integer.class));
		m.put("toPayAmount", jdbc.queryForObject("select coalesce(sum(net),0)::float8 from fin_pay_vouchers where status = 'approved'", Double.class));
		m.put("payableCount", payables(u).size());
		return m;
	}
}
