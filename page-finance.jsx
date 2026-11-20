/* global React, I, Store, useStore, PageHeader, Tabs, ErpModal, DateInput, notify, exportCSV, baht, _fmt, EmptyRow, fmtDate */

/*
  การเงิน (ขั้น 1A): บัญชีเงินสด/ธนาคาร · สมุดเงิน · รับ/จ่ายเงินอื่น ๆ · โอนระหว่างบัญชี · คิวอนุมัติ · ตั้งค่า
  กฎทั้งหมดอยู่ที่เซิร์ฟเวอร์ (FinanceService) — หน้านี้เรียก API /finance/* แล้วแสดงผล
  • ยอดคงเหลือมาจากสมุดเงินเท่านั้น · ยืนยันแล้วลบไม่ได้ ใช้ "กลับรายการ"
  • ผู้บันทึก ≠ ผู้อนุมัติ (admin บันทึกและอนุมัติเองได้ ติดป้าย "อนุมัติเอง")
*/

const FIN_TYPE = { cash: "เงินสดย่อย", bank: "ธนาคาร", cheque: "เช็ค" };
const FIN_KIND = { other_in: "รับเงินอื่น ๆ", other_out: "จ่ายเงินอื่น ๆ", transfer: "โอนระหว่างบัญชี" };
const FIN_STATUS = {
  pending: { th: "รออนุมัติ", cls: "badge-warning" }, confirmed: { th: "ยืนยันแล้ว", cls: "badge-success" },
  rejected: { th: "ไม่อนุมัติ", cls: "badge-danger" }, void: { th: "ยกเลิก/กลับรายการ", cls: "badge-neutral" },
};
const FIN_CATS = {
  other_in: ["เงินทุนเจ้าของ", "เงินกู้ยืม", "ดอกเบี้ยรับ", "ผู้ขายคืนเงิน/มัดจำ", "รับเงินอื่น ๆ"],
  other_out: ["เงินเดือน", "ประกันสังคม", "นำส่งภาษี ภพ.30", "นำส่งภาษี ภงด.3/53", "ผ่อนชำระเงินกู้", "ค่าสาธารณูปโภค", "จ่ายเงินอื่น ๆ"],
};
const finErr = (e) => notify(e && e.message ? e.message : String(e), "error");
const finMoney = (v) => (v == null ? "" : _fmt(Number(v), 2));

function FinAccountModal({ acc, onClose, onDone }) {
  const editing = !!acc;
  const [f, setF] = React.useState(editing
    ? { code: acc.code, name: acc.name, type: acc.type, bankName: acc.bankName || "", accountNo: acc.accountNo || "", openingBalance: String(acc.openingBalance), openingDate: acc.openingDate, note: acc.note || "", active: acc.active }
    : { code: "", name: "", type: "bank", bankName: "", accountNo: "", openingBalance: "0", openingDate: Store.today(), note: "", active: true });
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const set = (k, v) => setF((x) => Object.assign({}, x, { [k]: v }));
  const locked = editing && acc.movementCount > 0;
  const save = async () => {
    setErr(""); setBusy(true);
    try {
      if (editing) await Store.finApi("PUT", "/accounts/" + encodeURIComponent(acc.id), { name: f.name, bankName: f.bankName, accountNo: f.accountNo, note: f.note, active: f.active, ...(locked ? {} : { openingBalance: f.openingBalance, openingDate: f.openingDate }) });
      else await Store.finApi("POST", "/accounts", f);
      notify(editing ? "บันทึกบัญชีเงินแล้ว" : "เพิ่มบัญชีเงิน " + f.code + " แล้ว", "success");
      onDone();
    } catch (e) { setErr(e && e.message ? e.message : String(e)); setBusy(false); }
  };
  const lbl = { fontSize: 12, color: "var(--text-secondary)", fontWeight: 500, display: "block", margin: "10px 0 4px" };
  return (
    <ErpModal title={editing ? "แก้ไขบัญชีเงิน " + acc.code : "เพิ่มบัญชีเงิน"} width={560} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>บันทึก</button></>}>
      <div className="grid-2" style={{ gap: 10 }}>
        <div><label style={lbl}>รหัสบัญชี *</label><input className="input" style={{ fontFamily: "var(--font-mono)" }} value={f.code} disabled={editing} placeholder="เช่น KBANK-01 / PETTY" onChange={(e) => set("code", e.target.value)}/></div>
        <div><label style={lbl}>ประเภท *</label><select className="select" value={f.type} disabled={editing} onChange={(e) => set("type", e.target.value)}>{Object.keys(FIN_TYPE).map((k) => <option key={k} value={k}>{FIN_TYPE[k]}</option>)}</select></div>
        <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>ชื่อบัญชี *</label><input className="input" value={f.name} placeholder="เช่น กสิกรไทย ออมทรัพย์ / เงินสดย่อยสำนักงาน" onChange={(e) => set("name", e.target.value)}/></div>
        {f.type !== "cash" && <><div><label style={lbl}>ธนาคาร</label><input className="input" value={f.bankName} onChange={(e) => set("bankName", e.target.value)}/></div>
          <div><label style={lbl}>เลขที่บัญชี</label><input className="input" value={f.accountNo} onChange={(e) => set("accountNo", e.target.value)}/></div></>}
        <div><label style={lbl}>ยอดยกมา (บาท)</label><input className="input num" type="number" min="0" step="0.01" value={f.openingBalance} disabled={locked} onChange={(e) => set("openingBalance", e.target.value)}/></div>
        <div><label style={lbl}>วันที่ยอดยกมา</label><DateInput className="input" value={f.openingDate} max={Store.today()} onChange={(e) => set("openingDate", e.target.value)}/></div>
        <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>หมายเหตุ</label><input className="input" value={f.note} onChange={(e) => set("note", e.target.value)}/></div>
        {editing && <label style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)}/> ใช้งานอยู่ (ปิดใช้งานได้เมื่อยอดคงเหลือเป็น 0)</label>}
      </div>
      {locked && <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 8 }}>บัญชีนี้มีรายการเคลื่อนไหวแล้ว — แก้ยอดยกมาและวันที่ไม่ได้</div>}
      {err && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

function FinTxnModal({ kind, accounts, onClose, onDone }) {
  const active = accounts.filter((a) => a.active);
  const [f, setF] = React.useState({ kind, date: Store.today(), accountId: active[0] ? active[0].id : "", toAccountId: "", amount: "", category: "", counterparty: "", refNo: "", note: "" });
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const set = (k, v) => setF((x) => Object.assign({}, x, { [k]: v }));
  const user = Store.user();
  const src = accounts.find((a) => a.id === f.accountId);
  const amt = Number(f.amount) || 0;
  const overdraft = kind !== "other_in" && src && src.type === "bank" && src.balance - amt < 0;
  const save = async () => {
    setErr(""); setBusy(true);
    try {
      const r = await Store.finApi("POST", "/txns", f);
      notify(r.status === "confirmed" ? "บันทึกและยืนยัน " + r.id + " แล้ว" : "บันทึก " + r.id + " แล้ว — รอ admin อนุมัติ", "success");
      onDone();
    } catch (e) { setErr(e && e.message ? e.message : String(e)); setBusy(false); }
  };
  const lbl = { fontSize: 12, color: "var(--text-secondary)", fontWeight: 500, display: "block", margin: "10px 0 4px" };
  const accOpts = (list) => list.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name} (คงเหลือ {finMoney(a.balance)})</option>);
  return (
    <ErpModal title={FIN_KIND[kind]} width={600} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" disabled={busy || !active.length} onClick={save}>{user && user.role === "admin" ? "บันทึกและยืนยัน" : "บันทึก (ส่งอนุมัติ)"}</button></>}>
      {!active.length && <div style={{ color: "var(--amber)", fontSize: 12.5 }}>ยังไม่มีบัญชีเงิน — เพิ่มบัญชีที่แท็บ "บัญชีเงิน" ก่อน</div>}
      <div className="grid-2" style={{ gap: 10 }}>
        <div><label style={lbl}>วันที่ *</label><DateInput className="input" value={f.date} max={Store.today()} onChange={(e) => set("date", e.target.value)}/></div>
        <div><label style={lbl}>จำนวนเงิน (บาท) *</label><input className="input num" type="number" min="0" step="0.01" value={f.amount} onChange={(e) => set("amount", e.target.value)}/></div>
        <div style={{ gridColumn: kind === "transfer" ? "auto" : "1 / -1" }}><label style={lbl}>{kind === "other_in" ? "เงินเข้าบัญชี *" : kind === "other_out" ? "จ่ายจากบัญชี *" : "โอนจากบัญชี *"}</label>
          <select className="select" value={f.accountId} onChange={(e) => set("accountId", e.target.value)}>{accOpts(active)}</select></div>
        {kind === "transfer" && <div><label style={lbl}>โอนเข้าบัญชี *</label>
          <select className="select" value={f.toAccountId} onChange={(e) => set("toAccountId", e.target.value)}><option value="">— เลือก —</option>{accOpts(active.filter((a) => a.id !== f.accountId))}</select></div>}
        {kind !== "transfer" && <div><label style={lbl}>หมวด *</label>
          <input className="input" list="fin-cats" value={f.category} placeholder="เลือกหรือพิมพ์เอง" onChange={(e) => set("category", e.target.value)}/>
          <datalist id="fin-cats">{FIN_CATS[kind].map((c) => <option key={c} value={c}/>)}</datalist></div>}
        {kind !== "transfer" && <div><label style={lbl}>{kind === "other_in" ? "ผู้จ่ายเงิน" : "ผู้รับเงิน"}</label><input className="input" value={f.counterparty} onChange={(e) => set("counterparty", e.target.value)}/></div>}
        <div><label style={lbl}>เลขที่อ้างอิง / เลขโอน</label><input className="input" value={f.refNo} onChange={(e) => set("refNo", e.target.value)}/></div>
        <div><label style={lbl}>หมายเหตุ</label><input className="input" value={f.note} onChange={(e) => set("note", e.target.value)}/></div>
      </div>
      {overdraft && <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--amber)" }}>⚠ ยอดหลังรายการนี้ติดลบ (เบิกเกินบัญชีธนาคาร) — ตรวจสอบก่อนบันทึก</div>}
      <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 8 }}>
        {user && user.role === "admin" ? "admin บันทึกแล้วยืนยันทันที (ติดป้าย \"อนุมัติเอง\" ใน Audit Log)" : "รายการจะอยู่สถานะ รออนุมัติ จนกว่า admin อนุมัติ (ยอดไม่เกินเกณฑ์ที่ตั้งไว้จะยืนยันอัตโนมัติ)"}
      </div>
      {err && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

function FinReasonModal({ title, label, withDate, onClose, onSubmit }) {
  const [reason, setReason] = React.useState("");
  const [date, setDate] = React.useState(Store.today());
  const [err, setErr] = React.useState("");
  const go = async () => { setErr(""); try { await onSubmit(reason, date); } catch (e) { setErr(e && e.message ? e.message : String(e)); } };
  return (
    <ErpModal title={title} width={480} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={go}>ยืนยัน</button></>}>
      <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>{label} *</label>
      <textarea className="input" rows={3} style={{ width: "100%", height: "auto", padding: 8 }} value={reason} onChange={(e) => setReason(e.target.value)}/>
      {withDate && <><label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", margin: "10px 0 4px" }}>วันที่กลับรายการ (ต้องอยู่ในงวดที่เปิดอยู่)</label><DateInput className="input" value={date} max={Store.today()} onChange={(e) => setDate(e.target.value)}/></>}
      {err && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

function PageFinance({ view }) {
  useStore();
  const user = Store.user();
  const isAdmin = !!user && user.role === "admin";
  const tab = view || "ACC";   // หน้าย่อยเลือกจากเมนูซ้าย (ไม่ใช้แท็บในหน้าแล้ว)
  const [accounts, setAccounts] = React.useState([]);
  const [txns, setTxns] = React.useState([]);
  const [summary, setSummary] = React.useState(null);
  const [pendRc, setPendRc] = React.useState([]);
  const [pendPv, setPendPv] = React.useState([]);
  const [tick, setTick] = React.useState(0);
  const [loadErr, setLoadErr] = React.useState("");
  const [modal, setModal] = React.useState(null);
  const reload = () => { setTick((n) => n + 1); try { window.dispatchEvent(new Event("fin-changed")); } catch (e) { /* ignore */ } };

  React.useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [a, t, s, rp, pp] = await Promise.all([Store.finApi("GET", "/accounts"), Store.finApi("GET", "/txns"), Store.finApi("GET", "/summary"),
          Store.finApi("GET", "/receipts?status=pending"), Store.finApi("GET", "/payments?status=pending")]);
        if (live) { setAccounts(a); setTxns(t); setSummary(s); setPendRc(rp); setPendPv(pp); setLoadErr(""); }
      } catch (e) { if (live) setLoadErr(e && e.message ? e.message : String(e)); }
    })();
    return () => { live = false; };
  }, [tick]);

  if (loadErr) return <div className="card" style={{ padding: 24, color: "var(--danger)" }}>{loadErr}</div>;
  const pendingTx = txns.filter((t) => t.status === "pending");
  const pending = { length: pendingTx.length + pendRc.length + pendPv.length };   // รวมทุกชนิดเอกสารที่รออนุมัติ
  const settings = summary ? summary.settings : { lockDate: null, approvalThreshold: 0 };
  const accName = (id) => { const a = accounts.find((x) => x.id === id); return a ? a.code : id; };
  const close = () => setModal(null);
  const done = () => { setModal(null); reload(); };

  const addBtn = (kind, label) => <button className="btn btn-outline btn-sm" onClick={() => setModal({ t: "txn", kind })}><I.Plus size={14}/> {label}</button>;
  const META = {
    ACC: { title: "บัญชีเงิน", sub: "เงินสดย่อย · ธนาคาร — ยอดคงเหลือคำนวณจากสมุดเงิน", actions: <button className="btn btn-primary btn-sm" onClick={() => setModal({ t: "acc" })}><I.Plus size={14}/> เพิ่มบัญชีเงิน</button> },
    RCW: { title: "ใบเสร็จรอเก็บเงิน", sub: "ใบเสร็จที่ออกให้ลูกค้าแล้วแต่ยังไม่มีการบันทึกรับเงินจริง — ติดตามตามอายุและผู้เก็บเงิน" },
    LED: { title: "สมุดเงิน", sub: "ทุกรายการเงินเข้า/ออกของแต่ละบัญชี ยืนยันแล้วลบไม่ได้ (กลับรายการเท่านั้น)" },
    RCV: { title: "รับเงินลูกค้า", sub: "รับเงินตามใบกำกับภาษี · ค่าธรรมเนียมธนาคาร · ภาษีถูกหัก ณ ที่จ่าย (รอ 50 ทวิ) · เงินรอคืนลูกค้า" },
    PAYV: { title: "จ่ายเงิน (ใบสำคัญจ่าย)", sub: "ค่าใช้จ่าย → ใบสำคัญจ่าย → อนุมัติ → จ่ายเงิน · หัก ณ ที่จ่ายออกเลขหนังสือตามวันที่จ่ายจริง" },
    TX: { title: "รับ/จ่าย/โอนอื่น ๆ", sub: "รายการที่ไม่เกี่ยวกับใบกำกับหรือค่าใช้จ่าย เช่น เงินทุนเจ้าของ เงินเดือน นำส่งภาษี โอนระหว่างบัญชี",
      actions: <>{addBtn("other_in", "รับเงินอื่น ๆ")}{addBtn("other_out", "จ่ายเงินอื่น ๆ")}{addBtn("transfer", "โอนระหว่างบัญชี")}</> },
    APR: { title: "รออนุมัติ", sub: "รวมทุกเอกสารการเงินที่รอ admin อนุมัติ — กด \"รายละเอียด\" เพื่อดูที่มาก่อนอนุมัติ" },
    SET: { title: "ตั้งค่าการเงิน", sub: "วันล็อกงวด · เกณฑ์ยอดอนุมัติ (เฉพาะ admin)" },
  };
  const meta = META[tab] || META.ACC;

  return (
    <>
      <PageHeader title={meta.title} subtitle={meta.sub} actions={meta.actions}/>
      {tab === "ACC" && (
        <div className="grid-4" style={{ marginBottom: 14 }}>
          <FinStat label="เงินรวมทุกบัญชี (ที่ใช้งาน)" value={baht(Number(summary && summary.totalBalance) || 0, 2)} tone="success"/>
          <FinStat label="บัญชีเงิน" value={accounts.filter((a) => a.active).length + " บัญชี"} tone="accent"/>
          <FinStat label="รออนุมัติ (ทุกเอกสาร)" value={pending.length + " รายการ"} tone={pending.length ? "amber" : "neutral"}/>
          <FinStat label="ล็อกงวดถึง" value={settings.lockDate ? fmtDate(settings.lockDate) : "ยังไม่ล็อก"} tone="violet"/>
        </div>
      )}

      {tab === "ACC" && <FinAccounts accounts={accounts} onEdit={(a) => setModal({ t: "acc", acc: a })}/>}
      {tab === "LED" && <FinLedger accounts={accounts} tick={tick}/>}
      {tab === "RCW" && <FinRcWaiting accounts={accounts} reload={reload} tick={tick}/>}
      {tab === "RCV" && <FinReceipts accounts={accounts} isAdmin={isAdmin} user={user} setModal={setModal} reload={reload} tick={tick}/>}
      {tab === "PAYV" && <FinPayments accounts={accounts} isAdmin={isAdmin} user={user} setModal={setModal} reload={reload} tick={tick}/>}
      {tab === "TX" && <FinTxnList txns={txns} accName={accName} isAdmin={isAdmin} user={user} setModal={setModal} reload={reload}/>}
      {tab === "APR" && <FinApprovals txns={pendingTx} receipts={pendRc} vouchers={pendPv} accName={accName} isAdmin={isAdmin} user={user} setModal={setModal} reload={reload}/>}
      {tab === "SET" && (isAdmin ? <FinSettings settings={settings} onSaved={reload}/> : <div className="card" style={{ padding: 24, color: "var(--text-tertiary)" }}>เฉพาะผู้ดูแลระบบ (admin) ตั้งค่าได้</div>)}

      {modal && modal.t === "acc" && <FinAccountModal acc={modal.acc} onClose={close} onDone={done}/>}
      {modal && modal.t === "txn" && <FinTxnModal kind={modal.kind} accounts={accounts} onClose={close} onDone={done}/>}
      {modal && modal.t === "reject" && <FinReasonModal title={"ไม่อนุมัติ " + modal.id} label="เหตุผลที่ไม่อนุมัติ" onClose={close}
        onSubmit={async (reason) => { await Store.finApi("POST", "/txns/" + modal.id + "/reject", { reason }); notify("ไม่อนุมัติ " + modal.id + " แล้ว", "success"); done(); }}/>}
      {modal && modal.t === "cancel" && <FinReasonModal title={"ยกเลิก " + modal.id} label="เหตุผลที่ยกเลิก" onClose={close}
        onSubmit={async (reason) => { await Store.finApi("POST", "/txns/" + modal.id + "/cancel", { reason }); notify("ยกเลิก " + modal.id + " แล้ว", "success"); done(); }}/>}
      {modal && modal.t === "rvreject" && <FinReasonModal title={"ไม่อนุมัติ " + modal.id} label="เหตุผลที่ไม่อนุมัติ" onClose={close}
        onSubmit={async (reason) => { await Store.finApi("POST", "/receipts/" + modal.id + "/reject", { reason }); notify("ไม่อนุมัติ " + modal.id + " แล้ว", "success"); done(); }}/>}
      {modal && modal.t === "rvcancel" && <FinReasonModal title={"ยกเลิก " + modal.id} label="เหตุผลที่ยกเลิก" onClose={close}
        onSubmit={async (reason) => { await Store.finApi("POST", "/receipts/" + modal.id + "/cancel", { reason }); notify("ยกเลิก " + modal.id + " แล้ว", "success"); done(); }}/>}
      {modal && modal.t === "pvreject" && <FinReasonModal title={"ไม่อนุมัติ " + modal.id} label="เหตุผลที่ไม่อนุมัติ" onClose={close}
        onSubmit={async (reason) => { await Store.finApi("POST", "/payments/" + modal.id + "/reject", { reason }); notify("ไม่อนุมัติ " + modal.id + " แล้ว", "success"); done(); }}/>}
      {modal && modal.t === "pvcancel" && <FinReasonModal title={"ยกเลิก " + modal.id} label="เหตุผลที่ยกเลิก" onClose={close}
        onSubmit={async (reason) => { await Store.finApi("POST", "/payments/" + modal.id + "/cancel", { reason }); notify("ยกเลิก " + modal.id + " แล้ว", "success"); done(); }}/>}
      {modal && modal.t === "pvvoid" && <FinReasonModal title={"กลับรายการ " + modal.id} label="เหตุผลการกลับรายการ" withDate onClose={close}
        onSubmit={async (reason, date) => { await Store.finApi("POST", "/payments/" + modal.id + "/void", { reason, date }); notify("กลับรายการ " + modal.id + " แล้ว", "success"); done(); }}/>}
      {modal && modal.t === "rvvoid" && <FinReasonModal title={"กลับรายการ " + modal.id} label="เหตุผลการกลับรายการ" withDate onClose={close}
        onSubmit={async (reason, date) => { await Store.finApi("POST", "/receipts/" + modal.id + "/void", { reason, date }); notify("กลับรายการ " + modal.id + " แล้ว", "success"); done(); }}/>}
      {modal && modal.t === "void" && <FinReasonModal title={"กลับรายการ " + modal.id} label="เหตุผลการกลับรายการ" withDate onClose={close}
        onSubmit={async (reason, date) => { await Store.finApi("POST", "/txns/" + modal.id + "/void", { reason, date }); notify("กลับรายการ " + modal.id + " แล้ว", "success"); done(); }}/>}
    </>
  );
}

function FinStat({ label, value, tone }) {
  const c = { success: "var(--success)", accent: "var(--accent)", amber: "var(--amber)", violet: "var(--violet)", neutral: "var(--text-secondary)" }[tone] || "var(--text-secondary)";
  return <div className="card" style={{ padding: 14 }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</div><div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: c }}>{value}</div></div>;
}

function FinAccounts({ accounts, onEdit }) {
  return (
    <div className="card">
      <table className="table">
        <thead><tr><th>รหัส</th><th>ชื่อบัญชี</th><th>ประเภท</th><th>ธนาคาร / เลขที่บัญชี</th><th className="num">ยอดยกมา</th><th className="num">คงเหลือ</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id} style={a.active ? undefined : { opacity: 0.55 }}>
              <td className="mono"><b>{a.code}</b></td><td>{a.name}</td><td><span className="badge badge-neutral">{FIN_TYPE[a.type]}</span></td>
              <td style={{ fontSize: 12.5 }}>{[a.bankName, a.accountNo].filter(Boolean).join(" · ") || "—"}</td>
              <td className="num">{finMoney(a.openingBalance)}<div style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>{fmtDate(a.openingDate)}</div></td>
              <td className="num" style={{ fontWeight: 700, color: a.balance < 0 ? "var(--danger)" : "inherit" }}>{finMoney(a.balance)}{a.balance < 0 && <div style={{ fontSize: 10.5 }}>เบิกเกินบัญชี</div>}</td>
              <td>{a.active ? <span className="badge badge-success">ใช้งาน</span> : <span className="badge badge-neutral">ปิด</span>}</td>
              <td><button className="btn btn-outline btn-sm" onClick={() => onEdit(a)}>แก้ไข</button></td>
            </tr>
          ))}
          {!accounts.length && <tr><td colSpan={8} style={{ textAlign: "center", padding: 32, color: "var(--text-tertiary)" }}>ยังไม่มีบัญชีเงิน — กด "เพิ่มบัญชีเงิน" เพื่อเริ่ม (ตั้งยอดยกมาตามจริง ณ วันที่เริ่มใช้งาน)</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function FinLedger({ accounts, tick }) {
  const [accId, setAccId] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [data, setData] = React.useState(null);
  const sel = accId || (accounts[0] ? accounts[0].id : "");
  React.useEffect(() => {
    if (!sel) return undefined;
    let live = true;
    Store.finApi("GET", "/accounts/" + encodeURIComponent(sel) + "/ledger" + (from || to ? "?from=" + from + "&to=" + to : "")).then((d) => { if (live) setData(d); }).catch(finErr);
    return () => { live = false; };
  }, [sel, from, to, tick]);
  if (!accounts.length) return <div className="card" style={{ padding: 28, color: "var(--text-tertiary)", textAlign: "center" }}>ยังไม่มีบัญชีเงิน</div>;
  const mv = data ? data.movements : [];
  const acc = data ? data.account : null;
  const totalIn = mv.filter((m) => m.direction === "in").reduce((t, m) => t + m.amount, 0), totalOut = mv.filter((m) => m.direction === "out").reduce((t, m) => t + m.amount, 0);
  return (
    <div className="card">
      <div style={{ padding: "12px 16px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select className="select" style={{ width: 280 }} value={sel} onChange={(e) => setAccId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
        <div style={{ width: 150 }}><DateInput className="input" value={from} placeholder="ตั้งแต่วันที่" onChange={(e) => setFrom(e.target.value)}/></div>
        <div style={{ width: 150 }}><DateInput className="input" value={to} placeholder="ถึงวันที่" onChange={(e) => setTo(e.target.value)}/></div>
        <span className="spacer"/>
        <button className="btn btn-outline btn-sm" disabled={!mv.length} onClick={() => exportCSV("สมุดเงิน-" + sel + ".csv", ["วันที่", "รายการ", "อ้างอิง", "เงินเข้า", "เงินออก", "คงเหลือ"], mv.map((m) => [m.date, m.description, m.sourceId, m.direction === "in" ? m.amount : "", m.direction === "out" ? m.amount : "", m.balance]))}><I.Download size={14}/> CSV</button>
      </div>
      {acc && <div style={{ padding: "0 16px 10px", fontSize: 12.5, color: "var(--text-secondary)" }}>ยอดยกมา {finMoney(acc.openingBalance)} ({fmtDate(acc.openingDate)}) · เข้า {finMoney(totalIn)} · ออก {finMoney(totalOut)} · <b>คงเหลือปัจจุบัน {finMoney(acc.balance)}</b></div>}
      <table className="table">
        <thead><tr><th>วันที่</th><th>รายการ</th><th>อ้างอิง</th><th className="num">เงินเข้า</th><th className="num">เงินออก</th><th className="num">คงเหลือ</th></tr></thead>
        <tbody>
          {mv.map((m) => (
            <tr key={m.id} style={m.reversalOf ? { background: "var(--amber-subtle)" } : undefined}>
              <td>{fmtDate(m.date)}</td><td>{m.description}{m.reversalOf ? <span className="badge badge-warning" style={{ marginLeft: 6 }}>กลับรายการ</span> : null}</td><td className="mono">{m.sourceId}</td>
              <td className="num" style={{ color: "var(--success)" }}>{m.direction === "in" ? finMoney(m.amount) : ""}</td>
              <td className="num" style={{ color: "var(--danger)" }}>{m.direction === "out" ? finMoney(m.amount) : ""}</td>
              <td className="num" style={{ fontWeight: 600 }}>{finMoney(m.balance)}</td>
            </tr>
          ))}
          {!mv.length && <tr><td colSpan={6} style={{ textAlign: "center", padding: 28, color: "var(--text-tertiary)" }}>ยังไม่มีรายการเคลื่อนไหว</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function FinTxnList({ txns, accName, isAdmin, user, setModal, reload, emptyText }) {
  const [kind, setKind] = React.useState("ALL");
  const rows = txns.filter((t) => kind === "ALL" || t.kind === kind);
  const approve = async (id) => { try { await Store.finApi("POST", "/txns/" + id + "/approve"); notify("อนุมัติ " + id + " แล้ว", "success"); reload(); } catch (e) { finErr(e); } };
  return (
    <div className="card">
      <div style={{ padding: "12px 16px", display: "flex", gap: 8 }}>
        <select className="select" style={{ width: 200 }} value={kind} onChange={(e) => setKind(e.target.value)}><option value="ALL">ทุกประเภท</option>{Object.keys(FIN_KIND).map((k) => <option key={k} value={k}>{FIN_KIND[k]}</option>)}</select>
      </div>
      <table className="table">
        <thead><tr><th>เลขที่</th><th>วันที่</th><th>ประเภท</th><th>บัญชี</th><th>หมวด / ผู้เกี่ยวข้อง</th><th className="num">จำนวนเงิน</th><th>สถานะ</th><th>ผู้บันทึก / อนุมัติ</th><th></th></tr></thead>
        <tbody>
          {rows.map((t) => {
            const st = FIN_STATUS[t.status] || { th: t.status, cls: "badge-neutral" };
            const mine = user && t.createdBy === user.fullName;
            return (
              <tr key={t.id}>
                <td className="mono"><b>{t.id}</b></td><td>{fmtDate(t.date)}</td><td>{FIN_KIND[t.kind]}</td>
                <td className="mono" style={{ fontSize: 12 }}>{t.kind === "transfer" ? accName(t.accountId) + " → " + accName(t.toAccountId) : accName(t.accountId)}</td>
                <td style={{ fontSize: 12.5 }}>{[t.category, t.counterparty].filter(Boolean).join(" · ") || "—"}{t.note ? <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{t.note}</div> : null}</td>
                <td className="num" style={{ fontWeight: 600, color: t.kind === "other_in" ? "var(--success)" : t.kind === "other_out" ? "var(--danger)" : "inherit" }}>{finMoney(t.amount)}</td>
                <td><span className={"badge " + st.cls}>{st.th}</span>{t.status === "rejected" && t.rejectReason ? <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{t.rejectReason}</div> : null}{t.status === "void" && t.voidReason ? <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{t.voidReason}{t.voidDate ? " · " + fmtDate(t.voidDate) : ""}</div> : null}</td>
                <td style={{ fontSize: 11.5 }}>{t.createdBy}<div style={{ color: "var(--text-tertiary)" }}>{t.approvedBy ? "อนุมัติ: " + t.approvedBy : ""}{t.selfApproved ? <span className="badge badge-warning" style={{ marginLeft: 4 }}>อนุมัติเอง</span> : null}</div></td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {t.status === "pending" && isAdmin && <><button className="btn btn-primary btn-sm" onClick={() => approve(t.id)}>อนุมัติ</button> <button className="btn btn-outline btn-sm" onClick={() => setModal({ t: "reject", id: t.id })}>ไม่อนุมัติ</button> </>}
                  {t.status === "pending" && (mine || isAdmin) && <button className="btn btn-ghost btn-sm" onClick={() => setModal({ t: "cancel", id: t.id })}>ยกเลิก</button>}
                  {t.status === "confirmed" && isAdmin && <button className="btn btn-outline btn-sm" onClick={() => setModal({ t: "void", id: t.id })}>กลับรายการ</button>}
                </td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={9} style={{ textAlign: "center", padding: 28, color: "var(--text-tertiary)" }}>{emptyText || "ยังไม่มีรายการ"}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function FinSettings({ settings, onSaved }) {
  const [lock, setLock] = React.useState(settings.lockDate || "");
  const [th, setTh] = React.useState(String(settings.approvalThreshold || 0));
  const save = async () => {
    try { await Store.finApi("PUT", "/settings", { lockDate: lock || null, approvalThreshold: th === "" ? 0 : th }); notify("บันทึกการตั้งค่าแล้ว", "success"); onSaved(); } catch (e) { finErr(e); }
  };
  const lbl = { fontSize: 12, color: "var(--text-secondary)", fontWeight: 500, display: "block", margin: "12px 0 4px" };
  return (
    <div className="card" style={{ padding: 18, maxWidth: 640 }}>
      <label style={lbl}>วันล็อกงวด (ห้ามบันทึก/ยืนยัน/กลับรายการที่วันที่ไม่เกินวันนี้)</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}><div style={{ width: 200 }}><DateInput className="input" value={lock} max={Store.today()} onChange={(e) => setLock(e.target.value)}/></div>
        <button className="btn btn-ghost btn-sm" onClick={() => setLock("")}>ไม่ล็อก</button></div>
      <label style={lbl}>เกณฑ์ยอดอนุมัติ (บาท) — รายการของผู้ใช้ที่ไม่ใช่ admin ที่ยอด <b>ไม่เกิน</b> เกณฑ์นี้ยืนยันเองได้ · 0 = ทุกรายการต้องให้ admin อนุมัติ</label>
      <input className="input num" style={{ width: 200 }} type="number" min="0" step="0.01" value={th} onChange={(e) => setTh(e.target.value)}/>
      <div style={{ marginTop: 16 }}><button className="btn btn-primary btn-sm" onClick={save}>บันทึกการตั้งค่า</button></div>
      <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 12 }}>เฉพาะ admin เปลี่ยนค่านี้ได้ ทุกการเปลี่ยนแปลงถูกบันทึกใน Audit Log</div>
    </div>
  );
}

window.PageFinance = PageFinance;
// หน้าย่อยของเมนู "การเงิน" (เมนูซ้ายแต่ละรายการเปิดหน้าเดียวกันแต่ต่างมุมมอง)
window.PageFinApprovals = () => <PageFinance view="APR"/>;
window.PageFinReceipts = () => <PageFinance view="RCV"/>;
window.PageFinRcWait = () => <PageFinance view="RCW"/>;
window.PageFinPayments = () => <PageFinance view="PAYV"/>;
window.PageFinOther = () => <PageFinance view="TX"/>;
window.PageFinLedger = () => <PageFinance view="LED"/>;
window.PageFinSettings = () => <PageFinance view="SET"/>;
