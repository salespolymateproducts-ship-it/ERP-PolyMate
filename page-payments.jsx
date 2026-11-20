/* global React, I, Store, ErpModal, DateInput, notify, _fmt, fmtDate, finErr, finMoney */

/*
  การเงิน ขั้น A3: ใบสำคัญจ่าย (PV) → อนุมัติ → จ่ายเงิน (เลือกบัญชี/วันที่/อ้างอิง) · หัก ณ ที่จ่าย ออกเลขหนังสือตอนจ่ายจริง
  กฎทั้งหมดอยู่ที่เซิร์ฟเวอร์ (PaymentService) — หน้านี้แสดงผลและส่งคำขอ
*/

const PV_STATUS = {
  pending: { th: "รออนุมัติ", cls: "badge-warning" }, approved: { th: "อนุมัติแล้ว · รอจ่าย", cls: "badge-info" }, paid: { th: "จ่ายแล้ว", cls: "badge-success" },
  rejected: { th: "ไม่อนุมัติ", cls: "badge-danger" }, void: { th: "ยกเลิก/กลับรายการ", cls: "badge-neutral" },
};

function PayAccountFields({ accounts, f, set }) {
  const lbl = { fontSize: 12, color: "var(--text-secondary)", fontWeight: 500, display: "block", margin: "10px 0 4px" };
  return (
    <div className="grid-2" style={{ gap: 10 }}>
      <div><label style={lbl}>จ่ายจากบัญชี *</label>
        <select className="select" value={f.accountId} onChange={(e) => set("accountId", e.target.value)}>
          <option value="">— เลือกบัญชีที่จ่ายเงิน —</option>
          {accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}{a.bankName ? " · " + a.bankName : ""}{a.accountNo ? " (…" + String(a.accountNo).replace(/\D/g, "").slice(-4) + ")" : ""} · คงเหลือ {finMoney(a.balance)}</option>)}
        </select></div>
      <div><label style={lbl}>วันที่จ่ายจริง *</label><DateInput className="input" value={f.payDate} max={Store.today()} onChange={(e) => set("payDate", e.target.value)}/></div>
      <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>เลขที่อ้างอิง (สลิป/เช็ค)</label><input className="input" value={f.refNo} onChange={(e) => set("refNo", e.target.value)}/></div>
    </div>
  );
}

function FinPayVoucherModal({ accounts, onClose, onDone }) {
  const [rows, setRows] = React.useState([]);
  const [sel, setSel] = React.useState({});
  const [f, setF] = React.useState({ date: Store.today(), note: "" });
  const [now, setNow] = React.useState(false);
  const [p, setP] = React.useState({ accountId: "", payDate: Store.today(), refNo: "" });
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { Store.finApi("GET", "/payments/payables").then(setRows).catch((e) => setErr(e.message || String(e))); }, []);
  const chosen = rows.filter((r) => sel[r.id]);
  const payee = chosen[0] ? chosen[0].vendor : "";
  const sum = (k) => Math.round(chosen.reduce((s, r) => s + r[k], 0) * 100) / 100;
  const toggle = (r) => setSel((x) => Object.assign({}, x, { [r.id]: !x[r.id] }));
  const mixed = chosen.some((r) => String(r.vendor).trim().toLowerCase() !== String(payee).trim().toLowerCase());
  const save = async () => {
    setErr(""); setBusy(true);
    try {
      const body = { date: f.date, note: f.note, expenseIds: chosen.map((r) => r.id) };
      if (now) body.pay = p;
      const v = await Store.finApi("POST", "/payments", body);
      notify(v.status === "paid" ? "จ่ายแล้ว " + v.id : v.status === "approved" ? "สร้างใบสำคัญจ่าย " + v.id + " (อนุมัติแล้ว รอจ่าย)" : "สร้างใบสำคัญจ่าย " + v.id + " — รอ admin อนุมัติ", "success");
      onDone();
    } catch (e) { setErr(e && e.message ? e.message : String(e)); setBusy(false); }
  };
  const lbl = { fontSize: 12, color: "var(--text-secondary)", fontWeight: 500, display: "block", margin: "10px 0 4px" };
  const isAdmin = (Store.user() || {}).role === "admin";
  return (
    <ErpModal title="สร้างใบสำคัญจ่าย" width={820} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" disabled={busy || !chosen.length || mixed || (now && !p.accountId)} onClick={save}>{now ? "บันทึกและจ่ายทันที" : "บันทึกใบสำคัญจ่าย"}</button></>}>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>เลือกค่าใช้จ่ายที่อนุมัติแล้วและยังไม่ได้จ่าย — ใบสำคัญจ่าย 1 ใบ จ่ายผู้รับเงินคนเดียว</div>
      <table className="table" style={{ marginTop: 8 }}>
        <thead><tr><th></th><th>เลขที่</th><th>มาจาก</th><th>วันที่</th><th>ผู้รับเงิน</th><th>รายการ</th><th className="num">ฐาน</th><th className="num">VAT</th><th className="num">หัก ณ ที่จ่าย</th><th className="num">จ่ายสุทธิ</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onClick={() => toggle(r)} style={{ cursor: "pointer", background: sel[r.id] ? "var(--bg-subtle, #f5f5f5)" : undefined }}>
              <td><input type="checkbox" checked={!!sel[r.id]} readOnly/></td><td className="mono">{r.id}</td><td className="mono" style={{ fontSize: 11.5 }}>{r.ref || <span style={{ color: "var(--text-tertiary)" }}>คีย์เอง</span>}</td><td>{fmtDate(r.date)}</td><td>{r.vendor}</td><td style={{ fontSize: 12 }}>{r.desc || r.category}</td>
              <td className="num">{finMoney(r.base)}</td><td className="num">{r.vat ? finMoney(r.vat) : "—"}</td><td className="num">{r.wht ? finMoney(r.wht) : "—"}</td><td className="num"><b>{finMoney(r.net)}</b></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={10} style={{ textAlign: "center", padding: 22, color: "var(--text-tertiary)" }}>ไม่มีค่าใช้จ่ายรอจ่าย (บันทึกค่าใช้จ่ายและอนุมัติในหน้า บัญชี / ค่าใช้จ่าย ก่อน)</td></tr>}
        </tbody>
      </table>
      <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 8, background: "var(--bg-subtle, #f5f5f5)", fontSize: 12.5, lineHeight: 1.7 }}>
        {chosen.length ? <>ผู้รับเงิน <b>{payee}</b> · {chosen.length} รายการ · รวม <b>{finMoney(sum("base") + sum("vat"))}</b> · หัก ณ ที่จ่าย <b>{finMoney(sum("wht"))}</b> · <b>จ่ายสุทธิ {finMoney(sum("net"))}</b></> : "ยังไม่ได้เลือกรายการ"}
        {mixed && <div style={{ color: "var(--danger)" }}>เลือกผู้รับเงินหลายราย — ใบสำคัญจ่าย 1 ใบจ่ายได้คนเดียว</div>}
      </div>
      <div className="grid-2" style={{ gap: 10 }}>
        <div><label style={lbl}>วันที่ใบสำคัญจ่าย</label><DateInput className="input" value={f.date} max={Store.today()} onChange={(e) => setF({ ...f, date: e.target.value })}/></div>
        <div><label style={lbl}>หมายเหตุ</label><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })}/></div>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, marginTop: 12 }}><input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)}/> บันทึกและจ่ายทันที (สำหรับรายการเล็ก) {!isAdmin && <span style={{ color: "var(--text-tertiary)" }}>— ต้องให้ admin อนุมัติก่อนจึงจ่ายได้ ผู้ใช้อื่นจะได้ใบรออนุมัติ</span>}</label>
      {now && <PayAccountFields accounts={accounts} f={p} set={(k, v) => setP({ ...p, [k]: v })}/>}
      {err && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

function FinPayModal({ v, accounts, onClose, onDone }) {
  const [p, setP] = React.useState({ accountId: "", payDate: Store.today(), refNo: "" });
  const [err, setErr] = React.useState("");
  const save = async () => {
    setErr("");
    try { const r = await Store.finApi("POST", "/payments/" + v.id + "/pay", p); notify("จ่ายแล้ว " + v.id + (r.whtCertNo ? " · หนังสือหัก ณ ที่จ่าย " + r.whtCertNo : ""), "success"); onDone(); }
    catch (e) { setErr(e && e.message ? e.message : String(e)); }
  };
  return (
    <ErpModal title={"จ่ายเงิน · " + v.id} width={560} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" disabled={!p.accountId} onClick={save}>ยืนยันจ่ายเงิน</button></>}>
      <div style={{ fontSize: 12.5 }}>{v.payee} · จ่ายสุทธิ <b>{finMoney(v.net)}</b> บาท{v.wht > 0 ? <> · หัก ณ ที่จ่าย {finMoney(v.wht)} (ออกเลขหนังสือตามวันที่จ่ายจริง)</> : null}</div>
      <PayAccountFields accounts={accounts} f={p} set={(k, x) => setP({ ...p, [k]: x })}/>
      {err && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

/** รายละเอียดใบสำคัญจ่าย: จ่ายใคร · ค่าอะไร · มาจากเอกสารใด — ให้ผู้อนุมัติตรวจก่อนกด */
function FinPayDetailModal({ v, isAdmin, user, onClose, onApprove, onReject, onPay, onCancel }) {
  const st = PV_STATUS[v.status] || { th: v.status, cls: "badge-neutral" };
  const mine = user && v.createdBy === user.fullName;
  const cell = { fontSize: 12.5, padding: "2px 0" };
  return (
    <ErpModal title={"ใบสำคัญจ่าย " + v.id} width={860} onClose={onClose}
      footer={<>
        <button className="btn btn-outline btn-sm" onClick={onClose}>ปิด</button>
        {v.status === "pending" && isAdmin && <><button className="btn btn-outline btn-sm" onClick={() => onReject(v)}>ไม่อนุมัติ</button><button className="btn btn-primary btn-sm" onClick={() => onApprove(v)}>อนุมัติ</button></>}
        {v.status === "approved" && <button className="btn btn-primary btn-sm" onClick={() => onPay(v)}>จ่ายเงิน</button>}
        {(v.status === "pending" || v.status === "approved") && (mine || isAdmin) && <button className="btn btn-ghost btn-sm" onClick={() => onCancel(v)}>ยกเลิก</button>}
      </>}>
      <div className="grid-2" style={{ gap: 6 }}>
        <div style={cell}>ผู้รับเงิน: <b>{v.payee}</b></div><div style={cell}>สถานะ: <span className={"badge " + st.cls}>{st.th}</span></div>
        <div style={cell}>วันที่ใบสำคัญจ่าย: {fmtDate(v.date)}</div><div style={cell}>ผู้บันทึก: {v.createdBy} · {v.createdAt}</div>
        {v.note ? <div style={{ ...cell, gridColumn: "1 / -1" }}>หมายเหตุ: {v.note}</div> : null}
        {v.status === "paid" && <div style={{ ...cell, gridColumn: "1 / -1" }}>จ่ายเมื่อ {fmtDate(v.payDate)} จากบัญชี {v.accountId}{v.refNo ? " · อ้างอิง " + v.refNo : ""}{v.whtCertNo ? " · หนังสือหัก ณ ที่จ่าย " + v.whtCertNo : ""}</div>}
      </div>
      <table className="table" style={{ marginTop: 10 }}>
        <thead><tr><th>ค่าใช้จ่าย</th><th>มาจากเอกสาร</th><th>รายการ / หมวด</th><th>วันที่</th><th>ครบกำหนด</th><th className="num">ฐาน</th><th className="num">VAT</th><th className="num">หัก ณ ที่จ่าย</th><th className="num">จ่ายสุทธิ</th></tr></thead>
        <tbody>
          {v.items.map((i) => (
            <tr key={i.expenseId}>
              <td className="mono"><b>{i.expenseId}</b></td>
              <td className="mono">{i.ref ? <span className="badge badge-info">{i.ref}</span> : <span style={{ color: "var(--text-tertiary)" }}>คีย์เองในหน้าบัญชี</span>}</td>
              <td style={{ fontSize: 12 }}>{i.descr || "—"}<div style={{ color: "var(--text-tertiary)" }}>{i.category}</div></td>
              <td>{i.expenseDate ? fmtDate(i.expenseDate) : "—"}</td><td>{i.due && i.due !== "—" ? fmtDate(i.due) : "—"}</td>
              <td className="num">{finMoney(i.base)}</td><td className="num">{i.vat ? finMoney(i.vat) : "—"}</td>
              <td className="num">{i.wht ? finMoney(i.wht) + " (" + i.whtRate + "%)" : "—"}</td><td className="num"><b>{finMoney(i.net)}</b></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr style={{ fontWeight: 700 }}><td colSpan={5} style={{ textAlign: "right" }}>รวม</td><td className="num" colSpan={2}>{finMoney(v.gross)}</td><td className="num">{v.wht ? finMoney(v.wht) : "—"}</td><td className="num" style={{ color: "var(--danger)" }}>{finMoney(v.net)}</td></tr></tfoot>
      </table>
    </ErpModal>
  );
}

function FinPayments({ accounts, isAdmin, user, setModal, reload, tick }) {
  const [sum, setSum] = React.useState(null);
  const [filter, setFilter] = React.useState("ALL");
  const [sub, setSub] = React.useState(null);
  const v0 = useServerListView("/payments", { params: { status: filter }, tick, onError: finErr });
  const list = v0.pageRows;
  React.useEffect(() => {
    let live = true;
    Store.finApi("GET", "/payments/summary").then((s) => { if (live) setSum(s); }).catch(finErr);
    return () => { live = false; };
  }, [tick]);
  const approve = async (id) => { try { await Store.finApi("POST", "/payments/" + id + "/approve"); notify("อนุมัติ " + id + " แล้ว", "success"); reload(); } catch (e) { finErr(e); } };
  const done = () => { setSub(null); reload(); };
  return (
    <>
      <div className="grid-4" style={{ margin: "0 0 12px" }}>
        <div className="card" style={{ padding: 12 }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>ค่าใช้จ่ายรอทำใบสำคัญจ่าย</div><div style={{ fontSize: 18, fontWeight: 700 }}>{sum ? sum.payableCount : 0} รายการ</div></div>
        <div className="card" style={{ padding: 12 }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>ใบรออนุมัติ</div><div style={{ fontSize: 18, fontWeight: 700, color: "var(--amber)" }}>{sum ? sum.pendingCount : 0} ใบ</div></div>
        <div className="card" style={{ padding: 12 }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>อนุมัติแล้ว รอจ่าย</div><div style={{ fontSize: 18, fontWeight: 700, color: "var(--danger)" }}>{sum ? sum.toPayCount : 0} ใบ · {finMoney(sum ? sum.toPayAmount : 0)}</div></div>
        <div className="card" style={{ padding: 12, display: "flex", alignItems: "center" }}><button className="btn btn-primary btn-sm" onClick={() => setSub({ t: "new" })}><I.Plus size={14}/> สร้างใบสำคัญจ่าย</button></div>
      </div>
      <div className="card">
        <ListToolbar view={v0} placeholder="ค้นหาเลขที่ ผู้รับเงิน ค่าใช้จ่าย เลข PO…">
          <select className="select" style={{ width: 220 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="ALL">ทุกสถานะ</option>{Object.keys(PV_STATUS).map((k) => <option key={k} value={k}>{PV_STATUS[k].th}</option>)}
          </select>
        </ListToolbar>
        <table className="table">
          <thead><tr><SortTh view={v0} k="id">เลขที่</SortTh><SortTh view={v0} k="date">วันที่</SortTh><SortTh view={v0} k="payee">ผู้รับเงิน</SortTh><th>ค่าใช้จ่าย</th><SortTh view={v0} k="gross" className="num">รวม</SortTh><th className="num">หัก ณ ที่จ่าย</th><SortTh view={v0} k="net" className="num">จ่ายสุทธิ</SortTh><SortTh view={v0} k="status">สถานะ / การจ่าย</SortTh><th></th></tr></thead>
          <tbody>
            {list.map((v) => {
              const st = PV_STATUS[v.status] || { th: v.status, cls: "badge-neutral" };
              const mine = user && v.createdBy === user.fullName;
              return (
                <tr key={v.id}>
                  <td className="mono"><b>{v.id}</b></td><td>{fmtDate(v.date)}</td><td>{v.payee}</td>
                  <td style={{ fontSize: 12 }}>{v.items.map((i) => <div key={i.expenseId}><span className="mono">{i.expenseId}</span>{i.ref ? <> · <span className="mono">{i.ref}</span></> : null}{i.descr ? <div style={{ color: "var(--text-tertiary)" }}>{i.descr}</div> : null}</div>)}</td>
                  <td className="num">{finMoney(v.gross)}</td><td className="num">{v.wht ? finMoney(v.wht) : "—"}</td><td className="num" style={{ fontWeight: 600, color: "var(--danger)" }}>{finMoney(v.net)}</td>
                  <td><span className={"badge " + st.cls}>{st.th}</span>
                    {v.status === "paid" && <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{fmtDate(v.payDate)} · {v.accountId}{v.refNo ? " · " + v.refNo : ""}{v.whtCertNo ? " · " + v.whtCertNo : ""}</div>}
                    {v.status === "rejected" && v.rejectReason ? <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{v.rejectReason}</div> : null}
                    {v.status === "void" && v.voidReason ? <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{v.voidReason}</div> : null}
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{v.createdBy}{v.selfApproved ? <span className="badge badge-warning" style={{ marginLeft: 4 }}>อนุมัติเอง</span> : null}</div></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSub({ t: "detail", v })}>รายละเอียด</button>
                    {v.status === "pending" && isAdmin && <><button className="btn btn-primary btn-sm" onClick={() => approve(v.id)}>อนุมัติ</button> <button className="btn btn-outline btn-sm" onClick={() => setModal({ t: "pvreject", id: v.id })}>ไม่อนุมัติ</button> </>}
                    {v.status === "approved" && <button className="btn btn-primary btn-sm" onClick={() => setSub({ t: "pay", v })}>จ่ายเงิน</button>}
                    {(v.status === "pending" || v.status === "approved") && (mine || isAdmin) && <button className="btn btn-ghost btn-sm" onClick={() => setModal({ t: "pvcancel", id: v.id })}>ยกเลิก</button>}
                    {v.status === "paid" && isAdmin && <button className="btn btn-outline btn-sm" onClick={() => setModal({ t: "pvvoid", id: v.id })}>กลับรายการ</button>}
                  </td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={9} style={{ textAlign: "center", padding: 28, color: "var(--text-tertiary)" }}>{v0.loading ? "กำลังโหลด…" : v0.active || filter !== "ALL" ? "ไม่พบใบสำคัญจ่ายที่ตรงกับตัวกรอง" : "ยังไม่มีใบสำคัญจ่าย"}</td></tr>}
          </tbody>
        </table>
        <Pager view={v0}/>
      </div>
      {sub && sub.t === "new" && <FinPayVoucherModal accounts={accounts} onClose={() => setSub(null)} onDone={done}/>}
      {sub && sub.t === "detail" && <FinPayDetailModal v={sub.v} isAdmin={isAdmin} user={user} onClose={() => setSub(null)}
        onApprove={async (x) => { await approve(x.id); setSub(null); }} onReject={(x) => { setSub(null); setModal({ t: "pvreject", id: x.id }); }}
        onPay={(x) => setSub({ t: "pay", v: x })} onCancel={(x) => { setSub(null); setModal({ t: "pvcancel", id: x.id }); }}/>}
      {sub && sub.t === "pay" && <FinPayModal v={sub.v} accounts={accounts} onClose={() => setSub(null)} onDone={done}/>}
    </>
  );
}

window.FinPayments = FinPayments;

/** คิวอนุมัติรวม: รายการรับ/จ่าย/โอน + ใบรับเงินลูกค้า + ใบสำคัญจ่าย — บอกชนิดเอกสารและสิ่งที่กำลังอนุมัติให้ชัด */
function FinApprovals({ txns, receipts, vouchers, accName, isAdmin, user, setModal, reload }) {
  const [sub, setSub] = React.useState(null);
  const rows = [
    ...txns.map((t) => ({ kind: "txn", id: t.id, date: t.date, label: "รับ/จ่าย/โอนเงิน", cls: "badge-neutral",
      what: ({ other_in: "รับเงินอื่น ๆ", other_out: "จ่ายเงินอื่น ๆ", transfer: "โอนระหว่างบัญชี" })[t.kind] + " · " + (t.kind === "transfer" ? accName(t.accountId) + " → " + accName(t.toAccountId) : accName(t.accountId)) + " · " + [t.category, t.counterparty].filter(Boolean).join(" · "),
      amount: t.amount, sign: t.kind === "other_in" ? 1 : t.kind === "other_out" ? -1 : 0, by: t.createdBy, raw: t })),
    ...receipts.map((r) => ({ kind: "rv", id: r.id, date: r.date, label: "รับเงินลูกค้า", cls: "badge-success",
      what: r.customerName + " · ตัดใบกำกับ " + r.allocations.map((a) => a.invoiceId).join(", ") + " · เข้าบัญชี " + r.accountId, amount: r.received, sign: 1, by: r.createdBy, raw: r })),
    ...vouchers.map((v) => ({ kind: "pv", id: v.id, date: v.date, label: "ใบสำคัญจ่าย", cls: "badge-info",
      what: v.payee + " · " + v.items.map((i) => i.expenseId + (i.ref ? " (" + i.ref + ")" : "")).join(", "), amount: v.net, sign: -1, by: v.createdBy, raw: v })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
  const base = { txn: "/txns/", rv: "/receipts/", pv: "/payments/" };
  const approve = async (x) => { try { await Store.finApi("POST", base[x.kind] + x.id + "/approve"); notify("อนุมัติ " + x.id + " แล้ว", "success"); setSub(null); reload(); } catch (e) { finErr(e); } };
  const reject = (x) => setModal({ t: { txn: "reject", rv: "rvreject", pv: "pvreject" }[x.kind], id: x.id });
  const cancel = (x) => setModal({ t: { txn: "cancel", rv: "rvcancel", pv: "pvcancel" }[x.kind], id: x.id });
  return (
    <div className="card">
      <div style={{ padding: "12px 16px", fontSize: 12.5, color: "var(--text-secondary)" }}>รวมทุกเอกสารที่รออนุมัติ — กด "รายละเอียด" เพื่อดูว่าเป็นเอกสารที่มาจากใบกำกับ/ค่าใช้จ่าย/PO ใบไหน ก่อนอนุมัติ</div>
      <table className="table">
        <thead><tr><th>ชนิดเอกสาร</th><th>เลขที่</th><th>วันที่</th><th>เรื่อง / ที่มา</th><th className="num">จำนวนเงิน</th><th>ผู้บันทึก</th><th></th></tr></thead>
        <tbody>
          {rows.map((x) => {
            const mine = user && x.by === user.fullName;
            return (
              <tr key={x.kind + x.id}>
                <td><span className={"badge " + x.cls}>{x.label}</span></td><td className="mono"><b>{x.id}</b></td><td>{fmtDate(x.date)}</td>
                <td style={{ fontSize: 12.5, maxWidth: 420 }}>{x.what}</td>
                <td className="num" style={{ fontWeight: 600, color: x.sign > 0 ? "var(--success)" : x.sign < 0 ? "var(--danger)" : "inherit" }}>{finMoney(x.amount)}</td>
                <td style={{ fontSize: 11.5 }}>{x.by}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {x.kind !== "txn" && <button className="btn btn-ghost btn-sm" onClick={() => setSub(x)}>รายละเอียด</button>}
                  {isAdmin && <><button className="btn btn-primary btn-sm" onClick={() => approve(x)}>อนุมัติ</button> <button className="btn btn-outline btn-sm" onClick={() => reject(x)}>ไม่อนุมัติ</button> </>}
                  {(mine || isAdmin) && <button className="btn btn-ghost btn-sm" onClick={() => cancel(x)}>ยกเลิก</button>}
                </td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, color: "var(--text-tertiary)" }}>ไม่มีรายการรออนุมัติ</td></tr>}
        </tbody>
      </table>
      {sub && sub.kind === "pv" && <FinPayDetailModal v={sub.raw} isAdmin={isAdmin} user={user} onClose={() => setSub(null)} onApprove={() => approve(sub)} onReject={() => { setSub(null); reject(sub); }} onPay={() => setSub(null)} onCancel={() => { setSub(null); cancel(sub); }}/>}
      {sub && sub.kind === "rv" && <FinReceiptDetailModal r={sub.raw} isAdmin={isAdmin} user={user} onClose={() => setSub(null)} onApprove={() => approve(sub)} onReject={() => { setSub(null); reject(sub); }} onCancel={() => { setSub(null); cancel(sub); }}/>}
    </div>
  );
}

window.FinApprovals = FinApprovals;
