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
 * การเงิน ขั้น A2: รับเงินลูกค้า (RV)
 *
 *  • หนึ่งใบรับเงิน จัดสรรเข้าได้หลายใบกำกับภาษี (ใบกำกับอยู่ใน erp_records collection 'docs', type = INV)
 *  • received (เงินเข้าบัญชีจริง) + bank_fee (ค่าธรรมเนียมที่ธนาคารหัก — ลูกค้าจ่ายครบแล้ว) = Σ alloc.amount + excess
 *  • ภาษีถูกหัก ณ ที่จ่าย (alloc.wht) ตัดใบกำกับเพิ่มโดยไม่มีเงินเข้า — ติดสถานะ "รอ 50 ทวิ" จนกว่าจะบันทึกหนังสือรับรอง
 *  • จัดสรรเกินยอดคงค้างของใบกำกับไม่ได้ · ส่วนเกินจากยอดที่รับต้องยืนยัน keepExcess=true จึงบันทึกเป็น "เงินรอคืนลูกค้า" และคืนผ่านรายการจ่ายเงินอื่น ๆ
 *  • ผู้บันทึก ≠ ผู้อนุมัติ (admin อนุมัติเองได้ ติดป้าย self_approved) · เงินเข้าสมุดเงินเมื่อยืนยันเท่านั้น · ยืนยันแล้วแก้ไม่ได้ ใช้กลับรายการ
 *  • ยอดคงค้างใบกำกับนี้นับเฉพาะใบรับเงินใหม่ (RV) — การรวมกับ INV→RC→PAY เดิมทำในขั้น A4
 */
@Service
public class ReceiptService {
	static final String REFUND_CATEGORY = "คืนเงินลูกค้า";
	private final JdbcTemplate jdbc;
	private final FinanceService fin;
	private final CounterService counters;
	private final AuditService audit;

	public ReceiptService(JdbcTemplate jdbc, FinanceService fin, CounterService counters, AuditService audit) {
		this.jdbc = jdbc;
		this.fin = fin;
		this.counters = counters;
		this.audit = audit;
	}

	private static BigDecimal bd(Object o) { return new BigDecimal(String.valueOf(o)).setScale(2, RoundingMode.HALF_UP); }

	private static final String RC_SEL = "select r.id, to_char(r.rcv_date,'YYYY-MM-DD') as date, r.customer_id as \"customerId\", r.customer_name as \"customerName\", r.account_id as \"accountId\", "
		+ "r.received::float8 as received, r.bank_fee::float8 as \"bankFee\", r.wht::float8 as wht, r.excess::float8 as excess, r.ref_no as \"refNo\", r.note, "
		+ "r.wht_cert_no as \"whtCertNo\", to_char(r.wht_cert_date,'YYYY-MM-DD') as \"whtCertDate\", r.wht_cert_amount::float8 as \"whtCertAmount\", "
		+ "case when r.wht > 0 and r.status = 'confirmed' and r.wht_cert_no is null then true else false end as \"whtCertPending\", r.status, r.created_by as \"createdBy\", "
		+ "to_char(r.created_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI') as \"createdAt\", r.approved_by as \"approvedBy\", r.self_approved as \"selfApproved\", r.reject_reason as \"rejectReason\", "
		+ "r.void_reason as \"voidReason\", r.voided_by as \"voidedBy\", to_char(r.void_date,'YYYY-MM-DD') as \"voidDate\", "
		+ "coalesce((select sum(t.amount) from fin_txns t where t.kind='other_out' and t.category = '" + REFUND_CATEGORY + "' and t.ref_no = r.id and t.status = 'confirmed'),0)::float8 as refunded, "
		+ "coalesce((select sum(t.amount) from fin_txns t where t.kind='other_out' and t.category = '" + REFUND_CATEGORY + "' and t.ref_no = r.id and t.status = 'pending'),0)::float8 as \"refundPending\" from fin_receipts r";

	@SuppressWarnings("unchecked")
	private Map<String, Object> receipt(String id) {
		List<Map<String, Object>> r = jdbc.queryForList(RC_SEL + " where r.id = ?", id);
		if (r.isEmpty()) throw ApiException.notFound("ไม่พบใบรับเงิน " + id);
		Map<String, Object> m = new LinkedHashMap<>(r.get(0));
		// ข้อมูลใบกำกับที่ตัดยอด (ให้ผู้อนุมัติรู้ว่ารับเงินค่าอะไร): วันที่ · ครบกำหนด · ยอดรวม · เลขอ้างอิงลูกค้า (เช่น PO ลูกค้า) · เอกสารต้นทาง
		m.put("allocations", jdbc.queryForList("select a.invoice_id as \"invoiceId\", a.amount::float8 as amount, a.wht::float8 as wht, coalesce(d.data->>'date','') as \"invoiceDate\", coalesce(d.data->>'due','') as due, "
			+ "coalesce(d.data->>'total','0')::float8 as total, coalesce(d.data->>'refNo','') as \"refNo\", coalesce(d.data->>'note','') as note, coalesce(d.data->>'status','') as \"invoiceStatus\", "
			+ "coalesce(d.data->'sourceIds','[]'::jsonb)::text as \"sourceIds\" from fin_receipt_allocs a left join erp_records d on d.collection = 'docs' and d.id = a.invoice_id where a.receipt_id = ? order by a.id", id));
		return m;
	}

	public List<Map<String, Object>> list(AuthUser u, String status, String customerId) {
		FinanceService.needRead(u);
		StringBuilder sql = new StringBuilder(RC_SEL + " where 1=1");
		List<Object> args = new ArrayList<>();
		if (status != null && !status.isBlank()) { sql.append(" and r.status = ?"); args.add(status); }
		if (customerId != null && !customerId.isBlank()) { sql.append(" and r.customer_id = ?"); args.add(customerId); }
		sql.append(" order by r.rcv_date desc, r.created_at desc limit 500");
		List<Map<String, Object>> rows = jdbc.queryForList(sql.toString(), args.toArray());
		List<Map<String, Object>> out = new ArrayList<>();
		for (Map<String, Object> r : rows) out.add(receipt(String.valueOf(r.get("id"))));
		return out;
	}

	public Map<String, Object> get(AuthUser u, String id) {
		FinanceService.needRead(u);
		return receipt(id);
	}

	// ---------- ใบกำกับภาษีที่รอรับเงิน ----------
	/** ยอดคงค้างของใบกำกับ = total − Σ(amount+wht) ของใบรับเงินที่ pending/confirmed */
	private BigDecimal settled(String invoiceId) {
		return jdbc.queryForObject("select coalesce(sum(a.amount + a.wht),0) from fin_receipt_allocs a join fin_receipts r on r.id = a.receipt_id where a.invoice_id = ? and r.status in ('pending','confirmed')", BigDecimal.class, invoiceId);
	}

	private static final String INV_SEL = "select id, data->>'customer' as customer, data->>'customerName' as cname, data->>'status' as status, data->>'type' as type, coalesce(data->>'total','0') as total, "
		+ "coalesce(data->>'wht','0') as wht, coalesce(data->>'date','') as date, coalesce(data->>'due','') as due from erp_records where collection = 'docs' and id = ?";

	/** ใบกำกับภาษีของลูกค้าที่ยังมียอดคงค้าง */
	public List<Map<String, Object>> openInvoices(AuthUser u, String customerId) {
		FinanceService.needRead(u);
		if (customerId == null || customerId.isBlank()) throw ApiException.badRequest("ต้องระบุลูกค้า");
		List<Map<String, Object>> rows = jdbc.queryForList("select id from erp_records where collection = 'docs' and data->>'type' = 'INV' and data->>'customer' = ? and data->>'status' in ('approved','partial','completed') order by data->>'date', id", customerId);
		List<Map<String, Object>> out = new ArrayList<>();
		for (Map<String, Object> r : rows) {
			Map<String, Object> i = jdbc.queryForList(INV_SEL, r.get("id")).get(0);
			BigDecimal total = bd(i.get("total")), done = settled(String.valueOf(i.get("id"))), rem = total.subtract(done);
			if (rem.signum() <= 0) continue;
			Map<String, Object> m = new LinkedHashMap<>();
			m.put("id", i.get("id")); m.put("date", i.get("date")); m.put("due", i.get("due"));
			m.put("total", total.doubleValue()); m.put("wht", bd(i.get("wht")).doubleValue()); m.put("settled", done.doubleValue()); m.put("remaining", rem.doubleValue());
			out.add(m);
		}
		return out;
	}

	// ---------- สร้างใบรับเงิน ----------
	@SuppressWarnings("unchecked")
	@Transactional
	public Map<String, Object> create(AuthUser u, Map<String, Object> b) {
		FinanceService.needRead(u);
		LocalDate date = FinanceService.parseDate(b.get("date"), "วันที่รับเงิน");
		if (date.isAfter(FinanceService.today())) throw ApiException.badRequest("วันที่รับเงินต้องไม่เกินวันนี้");
		fin.assertOpenPeriod(date);
		String customerId = Json.s(b.get("customerId")).trim();
		List<Map<String, Object>> cust = jdbc.queryForList("select data->>'name' as name from erp_records where collection = 'customers' and id = ?", customerId);
		if (cust.isEmpty()) throw ApiException.badRequest("ไม่พบลูกค้า " + customerId);
		String accountId = Json.s(b.get("accountId")).trim();
		BigDecimal received = b.get("received") == null || Json.s(b.get("received")).isBlank() ? BigDecimal.ZERO.setScale(2) : FinanceService.money(b.get("received"), "ยอดเงินที่เข้าบัญชี", true);
		BigDecimal fee = b.get("bankFee") == null || Json.s(b.get("bankFee")).isBlank() ? BigDecimal.ZERO.setScale(2) : FinanceService.money(b.get("bankFee"), "ค่าธรรมเนียมธนาคาร", true);
		if (fee.signum() > 0 && received.signum() == 0) throw ApiException.badRequest("มีค่าธรรมเนียมได้เฉพาะเมื่อมีเงินเข้าบัญชี");
		Object rawAllocs = b.get("allocations");
		if (!(rawAllocs instanceof List<?> al) || al.isEmpty()) throw ApiException.badRequest("ต้องเลือกใบกำกับภาษีอย่างน้อย 1 ใบ");
		boolean keepExcess = Boolean.TRUE.equals(b.get("keepExcess"));

		// ล็อกบัญชี + ใบกำกับ (เรียงตามเลขที่ กัน deadlock) แล้วตรวจยอดคงค้าง
		Map<String, BigDecimal[]> want = new java.util.TreeMap<>(); // invoice -> {amount, wht}
		for (Object o : al) {
			Map<String, Object> a = (Map<String, Object>) o;
			String inv = Json.s(a.get("invoiceId")).trim();
			if (inv.isEmpty()) throw ApiException.badRequest("ทุกรายการจัดสรรต้องระบุเลขที่ใบกำกับ");
			if (want.containsKey(inv)) throw ApiException.badRequest("ใบกำกับ " + inv + " ซ้ำในรายการจัดสรร");
			BigDecimal amt = a.get("amount") == null || Json.s(a.get("amount")).isBlank() ? BigDecimal.ZERO.setScale(2) : FinanceService.money(a.get("amount"), "ยอดตัดใบกำกับ " + inv, true);
			BigDecimal wht = a.get("wht") == null || Json.s(a.get("wht")).isBlank() ? BigDecimal.ZERO.setScale(2) : FinanceService.money(a.get("wht"), "ภาษีถูกหักของ " + inv, true);
			if (amt.add(wht).signum() == 0) throw ApiException.badRequest("ใบกำกับ " + inv + ": ยอดตัดต้องมากกว่า 0");
			want.put(inv, new BigDecimal[] { amt, wht });
		}
		BigDecimal sumAmt = BigDecimal.ZERO, sumWht = BigDecimal.ZERO;
		for (Map.Entry<String, BigDecimal[]> e : want.entrySet()) {
			String inv = e.getKey();
			List<Map<String, Object>> r = jdbc.queryForList(INV_SEL + " for update", inv);
			if (r.isEmpty() || !"INV".equals(r.get(0).get("type"))) throw ApiException.badRequest("ไม่พบใบกำกับภาษี " + inv);
			Map<String, Object> i = r.get(0);
			if (!customerId.equals(i.get("customer"))) throw ApiException.badRequest("ใบกำกับ " + inv + " ไม่ใช่ของลูกค้าที่เลือก");
			if (!List.of("approved", "partial", "completed").contains(String.valueOf(i.get("status")))) throw ApiException.conflict("INVOICE_NOT_OPEN", "ใบกำกับ " + inv + " ยังไม่อนุมัติหรือถูกยกเลิกแล้ว");
			BigDecimal total = bd(i.get("total")), rem = total.subtract(settled(inv));
			BigDecimal pay = e.getValue()[0].add(e.getValue()[1]);
			if (pay.compareTo(rem) > 0) throw ApiException.unprocessable("OVER_ALLOCATION", "ใบกำกับ " + inv + " คงค้าง " + rem + " แต่จัดสรร " + pay + " — จัดสรรเกินยอดคงค้างไม่ได้");
			if (e.getValue()[1].compareTo(bd(i.get("wht"))) > 0) throw ApiException.unprocessable("WHT_EXCEEDS_INVOICE", "ภาษีถูกหักของ " + inv + " (" + e.getValue()[1] + ") เกินที่ระบุในใบกำกับ (" + bd(i.get("wht")) + ")");
			sumAmt = sumAmt.add(e.getValue()[0]);
			sumWht = sumWht.add(e.getValue()[1]);
		}
		BigDecimal excess = received.add(fee).subtract(sumAmt);
		if (excess.signum() < 0) throw ApiException.unprocessable("OVER_ALLOCATION", "ยอดที่จัดสรรเข้าใบกำกับ (" + sumAmt + ") มากกว่าเงินที่รับ + ค่าธรรมเนียม (" + received.add(fee) + ")");
		if (excess.signum() > 0 && !keepExcess) throw ApiException.unprocessable("EXCESS_NEEDS_CONFIRM", "เงินที่รับเกินยอดจัดสรร " + excess + " บาท — ยืนยัน (keepExcess) เพื่อบันทึกเป็นเงินรอคืนลูกค้า หรือแก้ยอดจัดสรร");
		if (received.signum() > 0) {
			if (accountId.isEmpty()) throw ApiException.badRequest("ต้องเลือกบัญชีที่รับเงิน");
			fin.lockAccounts(List.of(accountId), date, true);
		} else if (accountId.isEmpty()) {
			throw ApiException.badRequest("ต้องเลือกบัญชี");
		} else {
			fin.lockAccounts(List.of(accountId), date, true);
		}

		String no = (String) counters.next("RV", date.toString()).get("docNo");
		double threshold = ((Number) fin.settings().get("approvalThreshold")).doubleValue();
		boolean admin = u.isAdmin();
		boolean auto = !admin && threshold > 0 && received.doubleValue() <= threshold;
		String status = (admin || auto) ? "confirmed" : "pending";
		jdbc.update("insert into fin_receipts(id,rcv_date,customer_id,customer_name,account_id,received,bank_fee,wht,excess,ref_no,note,status,created_by,created_by_id,approved_by,approved_by_id,approved_at,self_approved) "
			+ "values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,case when ? then now() else null end,?)",
			no, date, customerId, Json.s(cust.get(0).get("name")), accountId, received, fee, sumWht, excess, Json.s(b.get("refNo")).trim(), Json.s(b.get("note")).trim(),
			status, u.fullName(), u.id(), status.equals("confirmed") ? (admin ? u.fullName() : "อัตโนมัติ (ไม่เกินเกณฑ์ " + threshold + ")") : null, status.equals("confirmed") && admin ? u.id() : null,
			status.equals("confirmed"), admin);
		for (Map.Entry<String, BigDecimal[]> e : want.entrySet())
			jdbc.update("insert into fin_receipt_allocs(receipt_id,invoice_id,amount,wht) values (?,?,?,?)", no, e.getKey(), e.getValue()[0], e.getValue()[1]);
		audit.log(u, "RV_CREATE", "ใบรับเงิน", no, "ลูกค้า " + customerId + " รับ " + received + " ค่าธรรมเนียม " + fee + " ภาษีถูกหัก " + sumWht + " เกิน " + excess + " → " + want.keySet() + " · " + status + (admin ? " (admin อนุมัติเอง)" : ""));
		if (status.equals("confirmed")) post(u, no);
		return receipt(no);
	}

	private void post(AuthUser u, String id) {
		Map<String, Object> r = receipt(id);
		BigDecimal received = bd(r.get("received"));
		if (received.signum() == 0) return; // ตัดด้วยภาษีถูกหักอย่างเดียว ไม่มีเงินเข้า
		LocalDate date = LocalDate.parse(String.valueOf(r.get("date")));
		String acc = String.valueOf(r.get("accountId"));
		fin.lockAccounts(List.of(acc), date, true);
		fin.addMovement(u, acc, date, "in", received, "fin_receipt", id, "รับเงินลูกค้า " + r.get("customerName") + " (" + id + ")", null);
	}

	@Transactional
	public Map<String, Object> approve(AuthUser u, String id) {
		FinanceService.needAdmin(u);
		List<Map<String, Object>> cur = jdbc.queryForList("select status, rcv_date, created_by_id = ? as mine from fin_receipts where id = ? for update", u.id(), id);
		if (cur.isEmpty()) throw ApiException.notFound("ไม่พบใบรับเงิน " + id);
		if (!"pending".equals(cur.get(0).get("status"))) throw ApiException.conflict("NOT_PENDING", "ใบรับเงิน " + id + " ไม่ได้อยู่ในสถานะรออนุมัติ");
		fin.assertOpenPeriod(((java.sql.Date) cur.get(0).get("rcv_date")).toLocalDate());
		jdbc.update("update fin_receipts set status='confirmed', approved_by=?, approved_by_id=?, approved_at=now(), self_approved=? where id=?", u.fullName(), u.id(), cur.get(0).get("mine"), id);
		post(u, id);
		audit.log(u, "RV_APPROVE", "ใบรับเงิน", id, "อนุมัติ" + (Boolean.TRUE.equals(cur.get(0).get("mine")) ? " (admin อนุมัติรายการที่ตนเองบันทึก)" : ""));
		return receipt(id);
	}

	@Transactional
	public Map<String, Object> reject(AuthUser u, String id, String reason) {
		FinanceService.needAdmin(u);
		if (reason == null || reason.isBlank()) throw ApiException.badRequest("ต้องระบุเหตุผลที่ไม่อนุมัติ");
		Map<String, Object> r = receipt(id);
		if (!"pending".equals(r.get("status"))) throw ApiException.conflict("NOT_PENDING", "ใบรับเงิน " + id + " ไม่ได้อยู่ในสถานะรออนุมัติ");
		jdbc.update("update fin_receipts set status='rejected', reject_reason=?, approved_by=?, approved_by_id=?, approved_at=now() where id=?", reason.trim(), u.fullName(), u.id(), id);
		audit.log(u, "RV_REJECT", "ใบรับเงิน", id, "ไม่อนุมัติ: " + reason.trim());
		return receipt(id);
	}

	@Transactional
	public Map<String, Object> cancelPending(AuthUser u, String id, String reason) {
		FinanceService.needRead(u);
		if (reason == null || reason.isBlank()) throw ApiException.badRequest("ต้องระบุเหตุผล");
		List<Map<String, Object>> cur = jdbc.queryForList("select status, created_by_id = ? as mine from fin_receipts where id = ? for update", u.id(), id);
		if (cur.isEmpty()) throw ApiException.notFound("ไม่พบใบรับเงิน " + id);
		if (!"pending".equals(cur.get(0).get("status"))) throw ApiException.conflict("NOT_PENDING", "ใบรับเงิน " + id + " ไม่ได้อยู่ในสถานะรออนุมัติ");
		if (!Boolean.TRUE.equals(cur.get(0).get("mine")) && !u.isAdmin()) throw ApiException.forbidden("ยกเลิกได้เฉพาะผู้บันทึกหรือ admin");
		jdbc.update("update fin_receipts set status='void', void_reason=?, voided_by=?, voided_at=now(), void_date=? where id=?", reason.trim(), u.fullName(), FinanceService.today(), id);
		audit.log(u, "RV_CANCEL", "ใบรับเงิน", id, "ยกเลิกก่อนอนุมัติ: " + reason.trim());
		return receipt(id);
	}

	/** กลับรายการที่ยืนยันแล้ว: เงินออกจากบัญชีลงวันที่กลับรายการ · ใบกำกับกลับมาคงค้าง · ต้องไม่มีการคืนเงินส่วนเกินค้างอยู่ */
	@Transactional
	public Map<String, Object> voidReceipt(AuthUser u, String id, String reason, Object dateObj) {
		FinanceService.needAdmin(u);
		if (reason == null || reason.isBlank()) throw ApiException.badRequest("ต้องระบุเหตุผลการกลับรายการ");
		jdbc.queryForList("select id from fin_receipts where id = ? for update", id).stream().findFirst().orElseThrow(() -> ApiException.notFound("ไม่พบใบรับเงิน " + id));
		Map<String, Object> r = receipt(id);
		if (!"confirmed".equals(r.get("status"))) throw ApiException.conflict("NOT_CONFIRMED", "กลับรายการได้เฉพาะใบรับเงินที่ยืนยันแล้ว");
		if (bd(r.get("refunded")).signum() > 0 || bd(r.get("refundPending")).signum() > 0) throw ApiException.conflict("REFUND_EXISTS", "มีการคืนเงินส่วนเกินของใบนี้แล้ว/รออนุมัติ — กลับรายการการคืนเงินก่อน");
		LocalDate orig = LocalDate.parse(String.valueOf(r.get("date")));
		LocalDate vd = dateObj == null || Json.s(dateObj).isBlank() ? FinanceService.today() : FinanceService.parseDate(dateObj, "วันที่กลับรายการ");
		if (vd.isBefore(orig)) throw ApiException.badRequest("วันที่กลับรายการต้องไม่ก่อนวันที่รับเงินเดิม (" + orig + ")");
		if (vd.isAfter(FinanceService.today())) throw ApiException.badRequest("วันที่กลับรายการต้องไม่เกินวันนี้");
		fin.assertOpenPeriod(vd);
		List<Map<String, Object>> mvs = jdbc.queryForList("select id, account_id, amount from fin_movements where source_type='fin_receipt' and source_id = ? and reversal_of is null", id);
		for (Map<String, Object> m : mvs) {
			String acc = String.valueOf(m.get("account_id"));
			Map<String, Object> a = fin.lockAccounts(List.of(acc), vd, false).get(acc);
			fin.assertEnough(a, (BigDecimal) m.get("amount"));
			fin.addMovement(u, acc, vd, "out", (BigDecimal) m.get("amount"), "fin_receipt", id, "กลับรายการ " + id + ": " + reason.trim(), ((Number) m.get("id")).longValue());
		}
		jdbc.update("update fin_receipts set status='void', void_reason=?, voided_by=?, voided_at=now(), void_date=? where id=?", reason.trim(), u.fullName(), vd, id);
		audit.log(u, "RV_VOID", "ใบรับเงิน", id, "กลับรายการ ลงวันที่ " + vd + ": " + reason.trim());
		return receipt(id);
	}

	/** บันทึกหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) ที่ลูกค้าออกให้ — ล้างสถานะ "รอ 50 ทวิ" */
	@Transactional
	public Map<String, Object> saveWhtCert(AuthUser u, String id, Map<String, Object> b) {
		FinanceService.needRead(u);
		Map<String, Object> r = receipt(id);
		if (!"confirmed".equals(r.get("status"))) throw ApiException.conflict("NOT_CONFIRMED", "บันทึกหนังสือรับรองได้เฉพาะใบรับเงินที่ยืนยันแล้ว");
		if (bd(r.get("wht")).signum() == 0) throw ApiException.badRequest("ใบรับเงินนี้ไม่มีภาษีถูกหัก");
		String no = Json.s(b.get("no")).trim();
		if (no.isEmpty()) throw ApiException.badRequest("ต้องระบุเลขที่หนังสือรับรอง");
		LocalDate d = FinanceService.parseDate(b.get("date"), "วันที่หนังสือรับรอง");
		BigDecimal amt = FinanceService.money(b.get("amount"), "ยอดตามหนังสือรับรอง", false);
		Integer dup = jdbc.queryForObject("select count(*)::int from fin_receipts where id <> ? and customer_id = ? and lower(wht_cert_no) = lower(?)", Integer.class, id, r.get("customerId"), no);
		if (dup != null && dup > 0) throw ApiException.conflict("DUPLICATE", "เลขที่หนังสือรับรอง " + no + " ของลูกค้านี้ถูกบันทึกแล้ว");
		jdbc.update("update fin_receipts set wht_cert_no=?, wht_cert_date=?, wht_cert_amount=? where id=?", no, d, amt, id);
		audit.log(u, "RV_WHT_CERT", "ใบรับเงิน", id, "บันทึกหนังสือรับรอง " + no + " ยอด " + amt + (amt.compareTo(bd(r.get("wht"))) != 0 ? " (ต่างจากภาษีถูกหัก " + r.get("wht") + ")" : ""));
		return receipt(id);
	}

	/** คืนเงินส่วนเกิน: สร้างรายการจ่ายเงินอื่น ๆ (หมวด "คืนเงินลูกค้า", ref = เลขที่ใบรับเงิน) ผ่านขั้นอนุมัติตามปกติ */
	@Transactional
	public Map<String, Object> refund(AuthUser u, String id, Map<String, Object> b) {
		FinanceService.needRead(u);
		jdbc.queryForList("select id from fin_receipts where id = ? for update", id).stream().findFirst().orElseThrow(() -> ApiException.notFound("ไม่พบใบรับเงิน " + id));
		Map<String, Object> r = receipt(id);
		if (!"confirmed".equals(r.get("status"))) throw ApiException.conflict("NOT_CONFIRMED", "คืนเงินได้เฉพาะใบรับเงินที่ยืนยันแล้ว");
		BigDecimal amount = FinanceService.money(b.get("amount"), "ยอดคืนเงิน", false);
		BigDecimal left = bd(r.get("excess")).subtract(bd(r.get("refunded"))).subtract(bd(r.get("refundPending")));
		if (amount.compareTo(left) > 0) throw ApiException.unprocessable("REFUND_EXCEEDS_EXCESS", "คืนเงินได้อีกไม่เกิน " + left + " บาท (เงินรอคืนลูกค้า)");
		Map<String, Object> t = new LinkedHashMap<>();
		t.put("kind", "other_out"); t.put("date", b.get("date")); t.put("accountId", b.get("accountId")); t.put("amount", amount.toPlainString());
		t.put("category", REFUND_CATEGORY); t.put("counterparty", r.get("customerName")); t.put("refNo", id); t.put("note", Json.s(b.get("note")));
		fin.createTxn(u, t);
		return receipt(id);
	}

	/** สรุป: ใบรับเงินรออนุมัติ · รอ 50 ทวิ · เงินรอคืนลูกค้า */
	public Map<String, Object> summary(AuthUser u) {
		FinanceService.needRead(u);
		Map<String, Object> m = new LinkedHashMap<>();
		m.put("pendingCount", jdbc.queryForObject("select count(*)::int from fin_receipts where status = 'pending'", Integer.class));
		m.put("whtCertPendingCount", jdbc.queryForObject("select count(*)::int from fin_receipts where status = 'confirmed' and wht > 0 and wht_cert_no is null", Integer.class));
		m.put("whtCertPendingAmount", jdbc.queryForObject("select coalesce(sum(wht),0)::float8 from fin_receipts where status = 'confirmed' and wht > 0 and wht_cert_no is null", Double.class));
		m.put("refundDue", jdbc.queryForObject("select coalesce(sum(r.excess - coalesce((select sum(t.amount) from fin_txns t where t.kind='other_out' and t.category='" + REFUND_CATEGORY + "' and t.ref_no = r.id and t.status in ('pending','confirmed')),0)),0)::float8 from fin_receipts r where r.status = 'confirmed' and r.excess > 0", Double.class));
		return m;
	}
}
