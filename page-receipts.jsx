/* global React, I, Store, useStore, Workflow, ErpModal, DateInput, notify, baht, _fmt, fmtDate, finErr, finMoney, FIN_STATUS */

/*
  การเงิน ขั้น A2: รับเงินลูกค้า (RV) — จัดสรรเข้าใบกำกับภาษีหลายใบ · ค่าธรรมเนียมธนาคาร · ภาษีถูกหัก (รอ 50 ทวิ) · เงินรอคืนลูกค้า
  กฎทั้งหมดอยู่ที่เซิร์ฟเวอร์ (ReceiptService) — หน้านี้แสดงผลและส่งคำขอ
*/

const rvNum = (v) => Math.round((Number(v) || 0) * 100) / 100;

function FinReceiptModal({ accounts, onClose, onDone, prefill }) {
  const customers = (Store.state.customers || []).filter((c) => c.status !== "inactive");
  const bankAccs = accounts.filter((a) => a.active);
  const [f, setF] = React.useState({ date: Store.today(), customerId: prefill ? prefill.customerId : "", accountId: "", received: prefill && prefill.received > 0 ? String(prefill.received) : "", bankFee: "", refNo: "", note: "" });
  const appliedRef = React.useRef(false);
  const [open, setOpen] = React.useState([]);        // ใบกำกับค้างของลูกค้า
  const [al, setAl] = React.useState({});            // invoiceId -> { amount, wht }
  const [keepExcess, setKeepExcess] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const set = (k, v) => setF((x) => Object.assign({}, x, { [k]: v }));

  React.useEffect(() => {
    if (!f.customerId) { setOpen([]); setAl({}); return undefined; }
    let live = true;
    Store.finApi("GET", "/receipts/open-invoices?customerId=" + encodeURIComponent(f.customerId))
      .then((l) => {
        if (!live) return;
        setOpen(l);
        if (prefill && !appliedRef.current) {
          // เติมการจัดสรรให้จากใบเสร็จที่เลือก: ใบกำกับที่ใบเสร็จครอบคลุม ตามลำดับ ใช้เงินที่คาดว่าจะได้รับ (แก้ไขได้)
          appliedRef.current = true;
          let left = rvNum(prefill.received); const res = {};
          (prefill.invoiceIds || []).forEach((id) => {
            const inv = l.find((x) => x.id === id); if (!inv) return;
            const wht = Math.min(inv.wht, inv.remaining), full = rvNum(inv.remaining - wht);
            const amt = Math.max(0, Math.min(full, left));
            res[id] = { amount: amt ? String(amt) : "", wht: amt >= full ? String(wht || "") : "" };
            left = rvNum(left - amt);
          });
          setAl(res);
        } else setAl({});
      }).catch((e) => setErr(e.message || String(e)));
    return () => { live = false; };
  }, [f.customerId]);

  const setA = (id, k, v) => setAl((x) => Object.assign({}, x, { [id]: Object.assign({ amount: "", wht: "" }, x[id], { [k]: v }) }));
  const rows = open.map((i) => ({ i, a: al[i.id] || { amount: "", wht: "" } }));
  const sumAmt = rvNum(rows.reduce((s, r) => s + (Number(r.a.amount) || 0), 0));
  const sumWht = rvNum(rows.reduce((s, r) => s + (Number(r.a.wht) || 0), 0));
  const received = rvNum(f.received), fee = rvNum(f.bankFee);
  const excess = rvNum(received + fee - sumAmt);
  // เติมยอดคงค้างให้ใบกำกับ (หักภาษีถูกหักตามใบกำกับ) จากเงินที่ยังไม่ได้จัดสรร
  const fill = (i) => {
    const left = rvNum(received + fee - sumAmt + (Number(al[i.id] && al[i.id].amount) || 0));
    const wht = Math.min(i.wht, i.remaining);
    const amt = Math.max(0, Math.min(rvNum(i.remaining - wht), left));
    setAl((x) => Object.assign({}, x, { [i.id]: { amount: amt ? String(amt) : "", wht: amt >= rvNum(i.remaining - wht) ? String(wht || "") : "" } }));
  };

  const save = async () => {
    setErr(""); setBusy(true);
    try {
      const allocations = rows.filter((r) => (Number(r.a.amount) || 0) + (Number(r.a.wht) || 0) > 0).map((r) => ({ invoiceId: r.i.id, amount: r.a.amount || 0, wht: r.a.wht || 0 }));
      const rc = await Store.finApi("POST", "/receipts", { ...f, received: f.received || 0, bankFee: f.bankFee || 0, allocations, keepExcess, rcIds: prefill ? prefill.rcIds : [] });
      notify((rc.status === "pending" ? "บันทึกใบรับเงิน " : "รับเงินแล้ว ") + rc.id + (rc.status === "pending" ? " — รอ admin อนุมัติ" : ""), "success");
      onDone();
    } catch (e) { setErr(e && e.message ? e.message : String(e)); setBusy(false); }
  };
  const lbl = { fontSize: 12, color: "var(--text-secondary)", fontWeight: 500, display: "block", margin: "10px 0 4px" };
  const user = Store.user();
  return (
    <ErpModal title="รับเงินลูกค้า" width={860} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" disabled={busy || !f.customerId || !f.accountId} onClick={save}>บันทึกรับเงิน</button></>}>
      {prefill && <div style={{ marginBottom: 8, padding: "8px 12px", borderRadius: 8, background: "var(--accent-subtle, #eef4ff)", fontSize: 12.5 }}>บันทึกรับเงินสำหรับใบเสร็จ <b className="mono">{(prefill.rcIds || []).join(", ")}</b> · เติมยอดตามใบเสร็จให้แล้ว ตรวจและแก้ให้ตรงกับเงินที่ได้รับจริง (ค่าธรรมเนียม/ภาษีถูกหัก)</div>}
      <div className="grid-2" style={{ gap: 10 }}>
        <div><label style={lbl}>วันที่รับเงิน *</label><DateInput className="input" value={f.date} max={Store.today()} onChange={(e) => set("date", e.target.value)}/></div>
        <div><label style={lbl}>ลูกค้า *</label>
          <select className="select" value={f.customerId} onChange={(e) => set("customerId", e.target.value)}><option value="">— เลือกลูกค้า —</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.code ? c.code + " · " : ""}{c.name}</option>)}</select></div>
        <div><label style={lbl}>เข้าบัญชี *</label>
          <select className="select" value={f.accountId} onChange={(e) => set("accountId", e.target.value)}><option value="">— เลือกบัญชีที่เงินเข้า —</option>{bankAccs.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}{a.bankName ? " · " + a.bankName : ""}{a.accountNo ? " (…" + String(a.accountNo).replace(/\D/g, "").slice(-4) + ")" : ""}</option>)}</select></div>
        <div><label style={lbl}>เลขที่อ้างอิง (สลิป/เช็ค)</label><input className="input" value={f.refNo} onChange={(e) => set("refNo", e.target.value)}/></div>
        <div><label style={lbl}>เงินที่เข้าบัญชีจริง (บาท)</label><input className="input num" type="number" min="0" step="0.01" value={f.received} onChange={(e) => set("received", e.target.value)}/></div>
        <div><label style={lbl}>ค่าธรรมเนียมที่ธนาคารหัก (ลูกค้าจ่ายครบแล้ว)</label><input className="input num" type="number" min="0" step="0.01" value={f.bankFee} onChange={(e) => set("bankFee", e.target.value)}/></div>
      </div>

      <div style={{ fontWeight: 600, fontSize: 13, margin: "16px 0 6px" }}>จัดสรรเข้าใบกำกับภาษี</div>
      {!f.customerId ? <div style={{ color: "var(--text-tertiary)", fontSize: 12.5 }}>เลือกลูกค้าเพื่อดูใบกำกับที่ค้างชำระ</div> : (
        <table className="table">
          <thead><tr><th>ใบกำกับ</th><th>ครบกำหนด</th><th className="num">ยอดรวม</th><th className="num">คงค้าง</th><th className="num" style={{ width: 130 }}>ตัดยอด (เงินรับ)</th><th className="num" style={{ width: 120 }}>ภาษีถูกหัก{" "}</th><th></th></tr></thead>
          <tbody>
            {rows.map(({ i, a }) => (
              <tr key={i.id}>
                <td className="mono"><b>{i.id}</b></td><td>{i.due && i.due !== "—" ? fmtDate(i.due) : "—"}</td><td className="num">{finMoney(i.total)}</td><td className="num"><b>{finMoney(i.remaining)}</b></td>
                <td><input className="input num" type="number" min="0" step="0.01" value={a.amount} onChange={(e) => setA(i.id, "amount", e.target.value)}/></td>
                <td><input className="input num" type="number" min="0" step="0.01" max={i.wht} placeholder={i.wht ? "≤ " + i.wht : "0"} value={a.wht} disabled={!i.wht} onChange={(e) => setA(i.id, "wht", e.target.value)}/></td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => fill(i)}>เต็มจำนวน</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} style={{ textAlign: "center", padding: 18, color: "var(--text-tertiary)" }}>ลูกค้านี้ไม่มีใบกำกับภาษีที่ค้างชำระ (ต้องเป็นใบกำกับที่อนุมัติแล้ว)</td></tr>}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "var(--bg-subtle, #f5f5f5)", fontSize: 12.5, lineHeight: 1.7 }}>
        เงินเข้าบัญชี <b>{finMoney(received)}</b> + ค่าธรรมเนียม <b>{finMoney(fee)}</b> = <b>{finMoney(received + fee)}</b> · ตัดใบกำกับ <b>{finMoney(sumAmt)}</b> · ภาษีถูกหัก <b>{finMoney(sumWht)}</b>
        {sumWht > 0 && <> <span className="badge badge-warning">รอ 50 ทวิ</span></>}
        <br/>
        {excess < 0 && <span style={{ color: "var(--danger)" }}>ตัดใบกำกับมากกว่าเงินที่รับ {finMoney(-excess)} บาท — ลดยอดตัดหรือเพิ่มเงินที่รับ</span>}
        {excess === 0 && <span style={{ color: "var(--success)" }}>ยอดสมดุล</span>}
        {excess > 0 && <label style={{ display: "inline-flex", gap: 6, alignItems: "center", color: "var(--amber)" }}><input type="checkbox" checked={keepExcess} onChange={(e) => setKeepExcess(e.target.checked)}/> เงินเกิน {finMoney(excess)} บาท — บันทึกเป็น "เงินรอคืนลูกค้า"</label>}
      </div>
      <label style={lbl}>หมายเหตุ</label><input className="input" value={f.note} onChange={(e) => set("note", e.target.value)}/>
      <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 8 }}>
        {user && user.role === "admin" ? "admin บันทึกแล้วยืนยันทันที (ติดป้าย \"อนุมัติเอง\")" : "ใบรับเงินจะอยู่สถานะ รออนุมัติ จนกว่า admin อนุมัติ — ระหว่างนั้นยอดใบกำกับถูกจองไว้แล้ว แต่เงินยังไม่เข้าสมุดเงิน"}
      </div>
      {err && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

function FinWhtCertModal({ rc, onClose, onDone }) {
  const [f, setF] = React.useState({ no: rc.whtCertNo || "", date: rc.whtCertDate || Store.today(), amount: String(rc.whtCertAmount != null ? rc.whtCertAmount : rc.wht) });
  const [err, setErr] = React.useState("");
  const save = async () => {
    setErr("");
    try { await Store.finApi("POST", "/receipts/" + rc.id + "/wht-cert", f); notify("บันทึกหนังสือรับรองหัก ณ ที่จ่ายแล้ว", "success"); onDone(); }
    catch (e) { setErr(e && e.message ? e.message : String(e)); }
  };
  const lbl = { fontSize: 12, color: "var(--text-secondary)", display: "block", margin: "10px 0 4px" };
  const diff = rvNum(Number(f.amount) - rc.wht);
  return (
    <ErpModal title={"หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) · " + rc.id} width={480} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={save}>บันทึก</button></>}>
      <div style={{ fontSize: 12.5 }}>{rc.customerName} · ภาษีถูกหักตามใบรับเงิน <b>{finMoney(rc.wht)}</b> บาท</div>
      <label style={lbl}>เลขที่หนังสือรับรอง *</label><input className="input" value={f.no} onChange={(e) => setF({ ...f, no: e.target.value })}/>
      <label style={lbl}>วันที่ในหนังสือ *</label><DateInput className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })}/>
      <label style={lbl}>ยอดภาษีตามหนังสือ *</label><input className="input num" type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })}/>
      {Math.abs(diff) > 0.005 && <div style={{ fontSize: 12, color: "var(--amber)", marginTop: 6 }}>ต่างจากภาษีถูกหักในใบรับเงิน {diff > 0 ? "+" : ""}{finMoney(diff)} บาท — บันทึกได้ แต่ควรตรวจกับลูกค้า</div>}
      {err && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

function FinRefundModal({ rc, accounts, onClose, onDone }) {
  const left = rvNum(rc.excess - rc.refunded - rc.refundPending);
  const [f, setF] = React.useState({ date: Store.today(), accountId: rc.accountId, amount: String(left), note: "" });
  const [err, setErr] = React.useState("");
  const save = async () => {
    setErr("");
    try { await Store.finApi("POST", "/receipts/" + rc.id + "/refund", f); notify("สร้างรายการคืนเงินลูกค้าแล้ว", "success"); onDone(); }
    catch (e) { setErr(e && e.message ? e.message : String(e)); }
  };
  const lbl = { fontSize: 12, color: "var(--text-secondary)", display: "block", margin: "10px 0 4px" };
  return (
    <ErpModal title={"คืนเงินลูกค้า · " + rc.id} width={480} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={save}>สร้างรายการคืนเงิน</button></>}>
      <div style={{ fontSize: 12.5 }}>{rc.customerName} · เงินรอคืนคงเหลือ <b>{finMoney(left)}</b> บาท (รายการนี้เป็น "จ่ายเงินอื่น ๆ" ต้องผ่านการอนุมัติตามปกติ)</div>
      <label style={lbl}>วันที่คืน</label><DateInput className="input" value={f.date} max={Store.today()} onChange={(e) => setF({ ...f, date: e.target.value })}/>
      <label style={lbl}>จากบัญชี</label>
      <select className="select" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
      <label style={lbl}>จำนวนเงิน</label><input className="input num" type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })}/>
      {err && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

/** รายละเอียดใบรับเงิน: ลูกค้า · เงินเข้าบัญชีไหน · ตัดใบกำกับใบใด — ให้ผู้อนุมัติตรวจก่อนกด */
function FinReceiptDetailModal({ r, isAdmin, user, onClose, onApprove, onReject, onCancel }) {
  const st = FIN_STATUS[r.status] || { th: r.status, cls: "badge-neutral" };
  const mine = user && r.createdBy === user.fullName;
  const cell = { fontSize: 12.5, padding: "2px 0" };
  return (
    <ErpModal title={"ใบรับเงิน " + r.id} width={860} onClose={onClose}
      footer={<>
        <button className="btn btn-outline btn-sm" onClick={onClose}>ปิด</button>
        {r.status === "pending" && isAdmin && <><button className="btn btn-outline btn-sm" onClick={() => onReject(r)}>ไม่อนุมัติ</button><button className="btn btn-primary btn-sm" onClick={() => onApprove(r)}>อนุมัติ</button></>}
        {r.status === "pending" && (mine || isAdmin) && <button className="btn btn-ghost btn-sm" onClick={() => onCancel(r)}>ยกเลิก</button>}
      </>}>
      <div className="grid-2" style={{ gap: 6 }}>
        <div style={cell}>ลูกค้า: <b>{r.customerName}</b></div><div style={cell}>สถานะ: <span className={"badge " + st.cls}>{st.th}</span></div>
        <div style={cell}>วันที่รับเงิน: {fmtDate(r.date)}</div><div style={cell}>เข้าบัญชี: <b>{r.accountId}</b>{r.refNo ? " · อ้างอิง " + r.refNo : ""}</div>
        <div style={cell}>ผู้บันทึก: {r.createdBy} · {r.createdAt}</div>
        {(r.rcIds || []).length ? <div style={cell}>ใบเสร็จรับเงินที่ออกไว้: <b className="mono">{r.rcIds.join(", ")}</b></div> : null}
        <div style={cell}>เงินเข้าบัญชี <b>{finMoney(r.received)}</b> · ค่าธรรมเนียม {finMoney(r.bankFee)} · ภาษีถูกหัก {finMoney(r.wht)}{r.excess ? " · เงินรอคืน " + finMoney(r.excess) : ""}</div>
        {r.note ? <div style={{ ...cell, gridColumn: "1 / -1" }}>หมายเหตุ: {r.note}</div> : null}
      </div>
      <table className="table" style={{ marginTop: 10 }}>
        <thead><tr><th>ใบกำกับภาษี</th><th>วันที่ออก</th><th>ครบกำหนด</th><th>อ้างอิงลูกค้า / หมายเหตุ</th><th>ต้นทาง</th><th className="num">ยอดใบกำกับ</th><th className="num">ตัดยอด (เงินรับ)</th><th className="num">ภาษีถูกหัก</th></tr></thead>
        <tbody>
          {r.allocations.map((a) => {
            let src = []; try { src = JSON.parse(a.sourceIds || "[]"); } catch (e) { src = []; }
            return (
              <tr key={a.invoiceId}>
                <td className="mono"><b>{a.invoiceId}</b></td><td>{a.invoiceDate ? fmtDate(a.invoiceDate) : "—"}</td><td>{a.due && a.due !== "—" ? fmtDate(a.due) : "—"}</td>
                <td style={{ fontSize: 12 }}>{a.refNo || "—"}{a.note ? <div style={{ color: "var(--text-tertiary)" }}>{a.note}</div> : null}</td>
                <td className="mono" style={{ fontSize: 11.5 }}>{src.length ? src.join(", ") : "—"}</td>
                <td className="num">{finMoney(a.total)}</td><td className="num"><b>{finMoney(a.amount)}</b></td><td className="num">{a.wht ? finMoney(a.wht) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ErpModal>
  );
}

function FinReceipts({ accounts, isAdmin, user, setModal, reload, tick }) {
  const [rows, setRows] = React.useState([]);
  const [sum, setSum] = React.useState(null);
  const [filter, setFilter] = React.useState("ALL");
  const [sub, setSub] = React.useState(null);
  React.useEffect(() => {
    let live = true;
    Promise.all([Store.finApi("GET", "/receipts"), Store.finApi("GET", "/receipts/summary")])
      .then(([r, s]) => { if (live) { setRows(r); setSum(s); } }).catch(finErr);
    return () => { live = false; };
  }, [tick]);
  const list = rows.filter((r) => filter === "ALL" || (filter === "WHT" ? r.whtCertPending : filter === "REFUND" ? r.status === "confirmed" && r.excess - r.refunded - r.refundPending > 0.004 : r.status === filter));
  const approve = async (id) => { try { await Store.finApi("POST", "/receipts/" + id + "/approve"); notify("อนุมัติ " + id + " แล้ว", "success"); reload(); } catch (e) { finErr(e); } };
  const done = () => { setSub(null); reload(); };
  return (
    <>
      <div className="grid-4" style={{ margin: "0 0 12px" }}>
        <div className="card" style={{ padding: 12 }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>ใบรับเงินรออนุมัติ</div><div style={{ fontSize: 18, fontWeight: 700 }}>{sum ? sum.pendingCount : 0} ใบ</div></div>
        <div className="card" style={{ padding: 12 }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>รอหนังสือ 50 ทวิ</div><div style={{ fontSize: 18, fontWeight: 700, color: "var(--amber)" }}>{sum ? sum.whtCertPendingCount : 0} ใบ · {finMoney(sum ? sum.whtCertPendingAmount : 0)}</div></div>
        <div className="card" style={{ padding: 12 }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>เงินรอคืนลูกค้า</div><div style={{ fontSize: 18, fontWeight: 700, color: "var(--danger)" }}>{finMoney(sum ? sum.refundDue : 0)}</div></div>
        <div className="card" style={{ padding: 12, display: "flex", alignItems: "center" }}><button className="btn btn-primary btn-sm" onClick={() => setSub({ t: "new" })}><I.Plus size={14}/> รับเงินลูกค้า</button></div>
      </div>
      <div className="card">
        <div style={{ padding: "12px 16px", display: "flex", gap: 8 }}>
          <select className="select" style={{ width: 220 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="ALL">ทุกสถานะ</option><option value="pending">รออนุมัติ</option><option value="confirmed">ยืนยันแล้ว</option><option value="void">ยกเลิก/กลับรายการ</option><option value="WHT">รอ 50 ทวิ</option><option value="REFUND">มีเงินรอคืน</option>
          </select>
        </div>
        <table className="table">
          <thead><tr><th>เลขที่</th><th>วันที่</th><th>ลูกค้า</th><th>ใบกำกับที่ตัด</th><th className="num">เงินเข้าบัญชี</th><th className="num">ค่าธรรมเนียม</th><th className="num">ภาษีถูกหัก</th><th className="num">เงินรอคืน</th><th>สถานะ</th><th></th></tr></thead>
          <tbody>
            {list.map((r) => {
              const st = FIN_STATUS[r.status] || { th: r.status, cls: "badge-neutral" };
              const refundLeft = rvNum(r.excess - r.refunded - r.refundPending);
              const mine = user && r.createdBy === user.fullName;
              return (
                <tr key={r.id}>
                  <td className="mono"><b>{r.id}</b><div style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>{r.accountId}{r.refNo ? " · " + r.refNo : ""}</div>{(r.rcIds || []).length ? <div style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>ใบเสร็จ {r.rcIds.join(", ")}</div> : null}</td>
                  <td>{fmtDate(r.date)}</td><td>{r.customerName}</td>
                  <td style={{ fontSize: 12 }}>{r.allocations.map((a) => <div key={a.invoiceId}><span className="mono">{a.invoiceId}</span> · {finMoney(a.amount + a.wht)}{a.refNo ? <div style={{ color: "var(--text-tertiary)" }}>อ้างอิง {a.refNo}</div> : null}</div>)}</td>
                  <td className="num" style={{ fontWeight: 600, color: "var(--success)" }}>{finMoney(r.received)}</td>
                  <td className="num">{r.bankFee ? finMoney(r.bankFee) : "—"}</td>
                  <td className="num">{r.wht ? <>{finMoney(r.wht)}<div style={{ fontSize: 10.5 }}>{r.whtCertNo ? <span style={{ color: "var(--success)" }}>50 ทวิ {r.whtCertNo}</span> : r.status === "confirmed" ? <span className="badge badge-warning">รอ 50 ทวิ</span> : null}</div></> : "—"}</td>
                  <td className="num">{r.excess ? <>{finMoney(refundLeft)}<div style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>จาก {finMoney(r.excess)}</div></> : "—"}</td>
                  <td><span className={"badge " + st.cls}>{st.th}</span>{r.status === "rejected" && r.rejectReason ? <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{r.rejectReason}</div> : null}{r.status === "void" && r.voidReason ? <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{r.voidReason}</div> : null}
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{r.createdBy}{r.selfApproved ? <span className="badge badge-warning" style={{ marginLeft: 4 }}>อนุมัติเอง</span> : null}</div></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSub({ t: "detail", rc: r })}>รายละเอียด</button>
                    {r.status === "pending" && isAdmin && <><button className="btn btn-primary btn-sm" onClick={() => approve(r.id)}>อนุมัติ</button> <button className="btn btn-outline btn-sm" onClick={() => setModal({ t: "rvreject", id: r.id })}>ไม่อนุมัติ</button> </>}
                    {r.status === "pending" && (mine || isAdmin) && <button className="btn btn-ghost btn-sm" onClick={() => setModal({ t: "rvcancel", id: r.id })}>ยกเลิก</button>}
                    {r.status === "confirmed" && r.wht > 0 && <button className="btn btn-outline btn-sm" onClick={() => setSub({ t: "wht", rc: r })}>{r.whtCertNo ? "แก้ 50 ทวิ" : "บันทึก 50 ทวิ"}</button>}
                    {r.status === "confirmed" && refundLeft > 0.004 && <button className="btn btn-outline btn-sm" style={{ marginLeft: 4 }} onClick={() => setSub({ t: "refund", rc: r })}>คืนเงิน</button>}
                    {r.status === "confirmed" && isAdmin && <button className="btn btn-outline btn-sm" style={{ marginLeft: 4 }} onClick={() => setModal({ t: "rvvoid", id: r.id })}>กลับรายการ</button>}
                  </td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={10} style={{ textAlign: "center", padding: 28, color: "var(--text-tertiary)" }}>ยังไม่มีใบรับเงิน</td></tr>}
          </tbody>
        </table>
      </div>
      {sub && sub.t === "new" && <FinReceiptModal accounts={accounts} onClose={() => setSub(null)} onDone={done}/>}
      {sub && sub.t === "detail" && <FinReceiptDetailModal r={sub.rc} isAdmin={isAdmin} user={user} onClose={() => setSub(null)}
        onApprove={async (x) => { await approve(x.id); setSub(null); }} onReject={(x) => { setSub(null); setModal({ t: "rvreject", id: x.id }); }} onCancel={(x) => { setSub(null); setModal({ t: "rvcancel", id: x.id }); }}/>}
      {sub && sub.t === "wht" && <FinWhtCertModal rc={sub.rc} onClose={() => setSub(null)} onDone={done}/>}
      {sub && sub.t === "refund" && <FinRefundModal rc={sub.rc} accounts={accounts} onClose={() => setSub(null)} onDone={done}/>}
    </>
  );
}

window.FinReceipts = FinReceipts;

/** ใบกำกับที่ใบเสร็จ (RC) ครอบคลุม — ไล่ขึ้นไปตามเอกสารต้นทาง (RC → BN/INV) */
function rcInvoiceIds(rc) {
  const out = [];
  const walk = (id, depth) => {
    const d = Workflow.get(id); if (!d || depth > 6) return;
    if (d.type === "INV") { if (!out.includes(d.id)) out.push(d.id); return; }
    (d.sourceIds || []).forEach((x) => walk(x, depth + 1));
  };
  (rc.sourceIds || []).forEach((x) => walk(x, 0));
  return out;
}
window.rcInvoiceIds = rcInvoiceIds;

/** ข้อมูลเตรียมเปิดหน้ารับเงินจากใบเสร็จ */
function rcPrefill(rc) {
  const a = Workflow.rcAmounts(rc);
  return { customerId: rc.customer, rcIds: [rc.id], invoiceIds: rcInvoiceIds(rc), received: Math.max(0, a.outstanding) };
}
window.rcPrefill = rcPrefill;

/** ป้ายสถานะเก็บเงินของใบเสร็จ: รอเก็บเงิน (กี่วัน) / รอยืนยัน / รับเงินแล้ว — เฉพาะผู้มีสิทธิ์การเงิน */
function RcCollectBadge({ doc }) {
  const [st, setSt] = React.useState(undefined);
  React.useEffect(() => {
    let live = true;
    Store.finApi("GET", "/receipts/rc-status").then((l) => { if (live) setSt(l.filter((x) => x.rcId === doc.id)); }).catch(() => { if (live) setSt(null); });
    return () => { live = false; };
  }, [doc.id]);
  if (st === undefined || st === null || !["approved", "partial"].includes(doc.status)) return null;
  const conf = st.find((x) => x.status === "confirmed"), pend = st.find((x) => x.status === "pending");
  const days = Math.max(0, Math.round((Date.now() - new Date(doc.date).getTime()) / 86400000));
  return (
    <div style={{ margin: "8px 0", fontSize: 12.5 }}>
      {conf ? <span className="badge badge-success">รับเงินแล้ว · {conf.receiptId}</span>
        : pend ? <span className="badge badge-warning">รอ admin อนุมัติการรับเงิน · {pend.receiptId}</span>
        : <span className="badge badge-warning">ออกแล้ว · รอเก็บเงิน ({days} วัน){doc.collector ? " · ผู้เก็บเงิน " + doc.collector : ""}</span>}
    </div>
  );
}
window.RcCollectBadge = RcCollectBadge;

/** หน้า "ใบเสร็จรอเก็บเงิน": ใบเสร็จที่ออกให้ลูกค้าแล้วแต่ยังไม่มีการบันทึกรับเงินจริง เรียงตามอายุ */
function FinRcWaiting({ accounts, reload, tick }) {
  useStore();
  const [links, setLinks] = React.useState([]);
  const [open, setOpen] = React.useState(null);
  const [collector, setCollector] = React.useState("ALL");
  React.useEffect(() => { let live = true; Store.finApi("GET", "/receipts/rc-status").then((l) => { if (live) setLinks(l); }).catch(finErr); return () => { live = false; }; }, [tick]);
  const linked = new Set(links.map((x) => x.rcId));
  const day = (d) => Math.max(0, Math.round((Date.now() - new Date(d.date).getTime()) / 86400000));
  const rows = Store.state.docs.filter((d) => d.type === "RC" && ["approved", "partial"].includes(d.status) && !linked.has(d.id) && Workflow.rcAmounts(d).outstanding > 0.005)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const collectors = [...new Set(rows.map((d) => d.collector || "—"))];
  const list = rows.filter((d) => collector === "ALL" || (d.collector || "—") === collector);
  const total = list.reduce((s, d) => s + Workflow.rcAmounts(d).outstanding, 0);
  const late = list.filter((d) => day(d) > 30);
  return (
    <>
      <div className="grid-4" style={{ margin: "0 0 12px" }}>
        <div className="card" style={{ padding: 12 }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>ใบเสร็จรอเก็บเงิน</div><div style={{ fontSize: 18, fontWeight: 700 }}>{list.length} ใบ</div></div>
        <div className="card" style={{ padding: 12 }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>ยอดที่ต้องเก็บ</div><div style={{ fontSize: 18, fontWeight: 700, color: "var(--accent)" }}>{finMoney(total)}</div></div>
        <div className="card" style={{ padding: 12 }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>เกิน 30 วัน</div><div style={{ fontSize: 18, fontWeight: 700, color: late.length ? "var(--danger)" : "inherit" }}>{late.length} ใบ</div></div>
        <div className="card" style={{ padding: 12 }}><select className="select" value={collector} onChange={(e) => setCollector(e.target.value)}><option value="ALL">ทุกผู้เก็บเงิน</option>{collectors.map((c) => <option key={c} value={c}>{c === "—" ? "ยังไม่ระบุผู้เก็บเงิน" : c}</option>)}</select></div>
      </div>
      <div className="card">
        <div style={{ padding: "12px 16px", fontSize: 12.5, color: "var(--text-secondary)" }}>ใบเสร็จที่ออกให้ลูกค้าแล้ว (พนักงานพกไปเก็บเงิน) ที่ยังไม่มีการบันทึกรับเงิน — เก็บเงินได้แล้วกด "บันทึกรับเงิน" ระบบเติมลูกค้าและใบกำกับให้ ถ้าลูกค้าไม่จ่าย ให้ยกเลิกใบเสร็จที่หน้าเอกสารขาย</div>
        <table className="table">
          <thead><tr><th>ใบเสร็จ</th><th>วันที่ออก</th><th className="num">อายุ (วัน)</th><th>ลูกค้า</th><th>ใบกำกับ</th><th>ผู้เก็บเงิน</th><th className="num">ยอดที่ต้องเก็บ</th><th></th></tr></thead>
          <tbody>
            {list.map((d) => {
              const age = day(d);
              return (
                <tr key={d.id}>
                  <td className="mono"><b>{d.id}</b></td><td>{fmtDate(d.date)}</td>
                  <td className="num" style={{ fontWeight: 600, color: age > 30 ? "var(--danger)" : age > 14 ? "var(--amber)" : "inherit" }}>{age}</td>
                  <td>{d.customerName}</td><td className="mono" style={{ fontSize: 12 }}>{rcInvoiceIds(d).join(", ") || "—"}</td>
                  <td>{d.collector || <span style={{ color: "var(--text-tertiary)" }}>—</span>}</td>
                  <td className="num"><b>{finMoney(Workflow.rcAmounts(d).outstanding)}</b></td>
                  <td><button className="btn btn-primary btn-sm" onClick={() => setOpen(d)}>บันทึกรับเงิน</button></td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={8} style={{ textAlign: "center", padding: 28, color: "var(--text-tertiary)" }}>ไม่มีใบเสร็จรอเก็บเงิน</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <FinReceiptModal accounts={accounts} prefill={rcPrefill(open)} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); }}/>}
    </>
  );
}
window.FinRcWaiting = FinRcWaiting;
