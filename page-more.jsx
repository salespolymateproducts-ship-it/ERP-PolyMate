/* global React, I, BOMS, MOLDS, ROLES, DOC_LABEL, Store, useStore, Analytics, exportCSV, notify, runAction, ErpModal, EmptyRow, baht, _fmt */

function Step({ done, text }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 20, height: 20, borderRadius: 99, background: done ? "var(--success)" : "var(--bg-subtle)", color: done ? "white" : "var(--text-tertiary)", display: "grid", placeItems: "center", border: done ? "none" : "1px solid var(--border)" }}>
        {done && <I.Check size={12}/>}
      </div>
      <span style={{ fontSize: 13, color: done ? "var(--text-primary)" : "var(--text-secondary)" }}>{text}</span>
    </div>
  );
}

// Helper KV
function PageHeader_KV({ k, v }) {
  return <div><div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{k}</div><div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{v}</div></div>;
}
window.PageHeader_KV = PageHeader_KV;

function KPICard({ icon, tone, label, value, unit, foot }) {
  const Ico = I[icon];
  const c = ({ accent: { c:"var(--accent)", b:"var(--accent-subtle)" }, amber: { c:"var(--amber)", b:"var(--amber-subtle)" }, success: { c:"var(--success)", b:"var(--success-subtle)" }, violet: { c:"var(--violet)", b:"var(--violet-subtle)" } })[tone];
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="kpi-label"><span className="kpi-ico" style={{ background: c.b, color: c.c }}><Ico size={14}/></span>{label}</div>
      <div className="kpi-value">{typeof value === "number" ? _fmt(value) : value}{unit && <span className="kpi-unit"> {unit}</span>}</div>
      <div className="kpi-foot" style={{ marginTop: 6 }}>{foot}</div>
    </div>
  );
}

// ===== Audit Log =====

function BOMViewer() {
  return (
    <div className="grid-2">
      {Object.entries(BOMS).map(([id, b]) => {
        const rmTotal = b.lines.reduce((s, l) => s + l.qty * l.cost, 0);
        const withWaste = rmTotal * (1 + b.wasteRate / 100);
        return (
          <div key={id} className="card" style={{ padding: 0 }}>
            <div style={{ padding: 14, borderBottom: "1px solid var(--border)", background: "var(--bg-subtle)" }}>
              <div className="mono" style={{ fontSize: 11, color: "var(--text-secondary)" }}>{b.productCode}</div>
              <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>{b.product}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 4, display: "flex", gap: 8 }}>
                <span><I.Mold size={11} style={{ verticalAlign: "middle" }}/> {b.mold}</span>
                <span>·</span>
                <span><I.Package size={11} style={{ verticalAlign: "middle" }}/> {b.packaging}</span>
              </div>
            </div>
            <table className="table" style={{ fontSize: 12 }}>
              <thead>
                <tr><th>วัตถุดิบ</th><th className="num">ต่อชิ้น</th><th className="num">ราคาทุน</th><th className="num">ต้นทุน</th></tr>
              </thead>
              <tbody>
                {b.lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <div className="mono" style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{l.item}</div>
                      <div style={{ fontSize: 12 }}>{l.name}</div>
                    </td>
                    <td className="num" style={{ fontSize: 11.5 }}>{_fmt(l.qty, 4)} {l.unit.replace("/PCS","")}</td>
                    <td className="num" style={{ fontSize: 11.5 }}>{_fmt(l.cost, 2)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{_fmt(l.qty * l.cost, 4)}</td>
                  </tr>
                ))}
                <tr style={{ background: "var(--bg-subtle)" }}>
                  <td colSpan={3} style={{ textAlign: "right", fontSize: 11, color: "var(--text-secondary)" }}>+ Waste {b.wasteRate}%</td>
                  <td className="num" style={{ fontSize: 11, color: "var(--amber)" }}>+{_fmt((withWaste - rmTotal), 4)}</td>
                </tr>
                <tr style={{ background: "var(--text-primary)", color: "white" }}>
                  <td colSpan={3} style={{ textAlign: "right", fontWeight: 600 }}>ต้นทุนวัตถุดิบ/ชิ้น</td>
                  <td className="num" style={{ fontWeight: 700 }}>฿{_fmt(withWaste, 4)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ================= Log การใช้งาน (Audit Log จริงจาก Store) =================
const AUDIT_ACTION_TONE = { LOGIN: "info", LOGOUT: "neutral", LOGIN_FAIL: "danger", CREATE: "success", UPDATE: "warning", DELETE: "danger",
  APPROVE: "success", SUBMIT: "info", REJECT: "warning", CANCEL: "danger", CONVERT: "violet", RECEIVE: "success", PRODUCE: "info",
  SHIP: "info", STOCK: "warning", EXPORT: "neutral", IMPORT: "warning", PRINT: "neutral" };
function PageAuditLog() {
  useStore();
  const logs = Store.state.auditLogs;
  const [action, setAction] = useState("ALL");
  const [user, setUser] = useState("ALL");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(200);
  const actions = ["ALL", ...Array.from(new Set(logs.map((l) => l.action))).sort()];
  const users = ["ALL", ...Array.from(new Set(logs.map((l) => l.user)))];
  const term = q.trim().toLowerCase();
  const filtered = logs.filter((l) => (action === "ALL" || l.action === action) && (user === "ALL" || l.user === user)
    && (!term || [l.entity, l.entityId, l.detail, l.user].join(" ").toLowerCase().includes(term)));
  return (
    <>
      <window.PageHeader title="Log การใช้งานระบบ" subtitle="บันทึกอัตโนมัติทุกการเข้าใช้งาน การสร้าง แก้ไข อนุมัติ ยกเลิก และการเปลี่ยนแปลงสต๊อก"
        actions={<><button className="btn btn-outline btn-sm" onClick={() => printReport("Log การใช้งานระบบ")}><I.Printer size={14}/> พิมพ์ / PDF</button><button className="btn btn-outline btn-sm" disabled={!filtered.length}
          onClick={() => exportCSV(`audit-log-${Store.today()}.csv`, ["วันเวลา", "ผู้ใช้", "Role", "การกระทำ", "ประเภท", "อ้างอิง", "รายละเอียด"],
            filtered.map((l) => [l.at, l.user, l.role, l.action, l.entity, l.entityId, l.detail]))}><I.Download size={14}/> ส่งออก CSV</button></>}/>
      <div className="card">
        <div style={{ display: "flex", gap: 8, padding: 14, flexWrap: "wrap", alignItems: "center" }}>
          <select className="input" style={{ width: 170 }} aria-label="การกระทำ" value={action} onChange={(e) => setAction(e.target.value)}>
            {actions.map((a) => <option key={a} value={a}>{a === "ALL" ? "ทุกการกระทำ" : a}</option>)}</select>
          <select className="input" style={{ width: 170 }} aria-label="ผู้ใช้" value={user} onChange={(e) => setUser(e.target.value)}>
            {users.map((a) => <option key={a} value={a}>{a === "ALL" ? "ผู้ใช้ทั้งหมด" : a}</option>)}</select>
          <input className="input" style={{ maxWidth: 280 }} placeholder="ค้นหาเลขที่เอกสาร / รายละเอียด" value={q} onChange={(e) => setQ(e.target.value)}/>
          <span className="badge badge-neutral">{filtered.length} รายการ</span>
        </div>
        <div style={{ overflow: "auto" }}>
          <table className="table" style={{ fontSize: 12.5 }}>
            <thead><tr><th>วันเวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>ประเภท</th><th>อ้างอิง</th><th>รายละเอียด</th></tr></thead>
            <tbody>
              {filtered.slice(0, limit).map((l) => (
                <tr key={l.id}><td className="num" style={{ whiteSpace: "nowrap" }}>{l.at}</td><td>{l.user}<div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{l.role}</div></td>
                  <td><span className={"badge badge-" + (AUDIT_ACTION_TONE[l.action] || "neutral")}>{l.action}</span></td><td>{l.entity}</td>
                  <td className="mono">{l.entityId}</td><td>{l.detail}</td></tr>
              ))}
              {!filtered.length && <EmptyRow cols={6} text="ยังไม่มีบันทึก"/>}
            </tbody>
          </table>
          {filtered.length > limit && <div style={{ padding: 12, textAlign: "center" }}><button className="btn btn-outline btn-sm" onClick={() => setLimit((n) => n + 200)}>แสดงเพิ่ม ({filtered.length - limit} รายการ)</button></div>}
        </div>
      </div>
    </>
  );
}

// ================= ปฏิทินซ่อมบำรุงแม่พิมพ์ (คำนวณจากข้อมูลแม่พิมพ์) =================
const MOLD_PM_DAYS = 90; // รอบบำรุงรักษาตามเวลา
function moldNextPM(m) {
  if (!m.lastMaint) return Store.today();
  const d = new Date(m.lastMaint + "T00:00:00"); d.setDate(d.getDate() + MOLD_PM_DAYS);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function MaintenanceCalendar() {
  useStore();
  const [offset, setOffset] = useState(0);
  const base = new Date(Store.today() + "T00:00:00");
  const first = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const p = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const today = Store.today();
  const events = [];
  Store.state.molds.forEach((m) => {
    const due = moldNextPM(m);
    events.push({ date: due < today ? today : due, mold: m, overdue: due < today, kind: "PM", text: `PM ${m.code}` });
    (m.maintLog || []).forEach((x) => events.push({ date: x.date, mold: m, done: true, text: `ซ่อม ${m.code}: ${x.note}` }));
  });
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) { const date = new Date(start); date.setDate(start.getDate() + w * 7 + d); const k = iso(date); days.push({ date, k, ev: events.filter((e) => e.date === k) }); }
    weeks.push(days);
  }
  const TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return (
    <div className="card">
      <div className="card-head">
        <div><div className="card-title">ปฏิทินซ่อมบำรุง · {TH[first.getMonth()]} {first.getFullYear()}</div>
          <div className="card-sub">กำหนด PM ทุก {MOLD_PM_DAYS} วันนับจากซ่อมครั้งล่าสุด · สีแดง = เลยกำหนด · สีเขียว = ซ่อมแล้ว</div></div>
        <div className="card-actions">
          <button className="btn btn-ghost btn-sm" aria-label="เดือนก่อน" onClick={() => setOffset((o) => o - 1)}><I.ChevronLeft size={13}/></button>
          <button className="btn btn-ghost btn-sm" onClick={() => setOffset(0)}>เดือนนี้</button>
          <button className="btn btn-ghost btn-sm" aria-label="เดือนถัดไป" onClick={() => setOffset((o) => o + 1)}><I.ChevronRight size={13}/></button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, background: "var(--border)", padding: 1 }}>
        {["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"].map((d) => <div key={d} style={{ background: "var(--bg-subtle)", padding: 6, fontSize: 11.5, textAlign: "center", fontWeight: 600 }}>{d}</div>)}
        {weeks.flat().map((d) => (
          <div key={d.k} style={{ background: "var(--bg-elevated)", minHeight: 74, padding: 6, opacity: d.date.getMonth() === first.getMonth() ? 1 : 0.45 }}>
            <div className="num" style={{ fontSize: 11.5, fontWeight: d.k === today ? 700 : 400, color: d.k === today ? "var(--accent)" : "var(--text-secondary)" }}>{d.date.getDate()}</div>
            {d.ev.map((e, i) => (
              <div key={i} title={e.text} style={{ fontSize: 10.5, marginTop: 3, padding: "2px 4px", borderRadius: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                background: e.done ? "var(--success-subtle)" : e.overdue ? "var(--danger-subtle)" : "var(--amber-subtle)",
                color: e.done ? "var(--success)" : e.overdue ? "var(--danger)" : "var(--amber)" }}>{e.text}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ================= รายงานภาษี ภพ.30 / ภงด.53 (จากเอกสารจริง) =================
function TaxReport({ month }) {
  useStore();
  const ym = month || Store.today().slice(0, 7);
  const m = Analytics.month(ym);
  const sales = m.invoices.filter((d) => d.vatOn).map((d) => ({ date: d.date, doc: d.id, customer: (d.customerSnap && d.customerSnap.name) || d.customerName, taxId: (d.customerSnap && d.customerSnap.taxId) || "—", subtotal: d.subtotal, vat: d.vat }));
  const supplier = (name) => Store.state.suppliers.find((s) => name && (s.name.includes(name) || name.includes(s.code))) || null;
  const purchases = m.expenses.filter((e) => e.vat > 0).map((e) => ({ date: e.date, doc: e.id, vendor: e.vendor, taxId: (supplier(e.vendor) || {}).taxId || "—", subtotal: e.amount, vat: e.vat }));
  const wht = m.expenses.filter((e) => e.whtRate > 0).map((e) => ({ date: e.date, doc: e.id, payee: e.vendor, type: e.category, base: e.amount, rate: e.whtRate }));
  const salesVat = sales.reduce((s, x) => s + x.vat, 0), purchaseVat = purchases.reduce((s, x) => s + x.vat, 0), net = salesVat - purchaseVat;
  const whtTotal = wht.reduce((s, w) => s + w.base * w.rate / 100, 0);
  const tbl = (head, rows, empty) => (
    <table className="table" style={{ fontSize: 12.5 }}><thead><tr>{head.map((h, i) => <th key={i} className={i >= head.length - 2 ? "num" : ""}>{h}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j >= r.length - 2 ? "num" : j === 1 ? "mono" : ""}>{c}</td>)}</tr>) : <EmptyRow cols={head.length} text={empty}/>}</tbody></table>
  );
  return (
    <>
      <div className="grid-3" style={{ marginBottom: 14 }}>
        <KPICard icon="TrendUp" tone="accent" label="ภาษีขาย" value={baht(salesVat, 2)} foot={`${sales.length} ใบกำกับภาษี`}/>
        <KPICard icon="TrendDown" tone="violet" label="ภาษีซื้อ" value={baht(purchaseVat, 2)} foot={`${purchases.length} รายการค่าใช้จ่าย`}/>
        <KPICard icon="Wallet" tone={net >= 0 ? "amber" : "success"} label={net >= 0 ? "ภาษีต้องชำระ" : "ภาษีชำระเกิน (ขอคืน/ยกไป)"} value={baht(Math.abs(net), 2)} foot={"ภพ.30 เดือน " + ym}/>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><div className="card-title">รายงานภาษีขาย</div>
          <div className="card-actions"><button className="btn btn-outline btn-sm" disabled={!sales.length} onClick={() => exportCSV(`ภาษีขาย-${ym}.csv`, ["วันที่", "เลขที่", "ลูกค้า", "เลขผู้เสียภาษี", "มูลค่า", "VAT"], sales.map((x) => [x.date, x.doc, x.customer, x.taxId, x.subtotal, x.vat]))}><I.Download size={13}/> CSV</button></div></div>
        {tbl(["วันที่", "เลขที่", "ลูกค้า", "เลขผู้เสียภาษี", "มูลค่า", "VAT"], sales.map((x) => [x.date, x.doc, x.customer, x.taxId, _fmt(x.subtotal, 2), _fmt(x.vat, 2)]), "ไม่มีใบกำกับภาษีในเดือนนี้")}
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><div className="card-title">รายงานภาษีซื้อ</div>
          <div className="card-actions"><button className="btn btn-outline btn-sm" disabled={!purchases.length} onClick={() => exportCSV(`ภาษีซื้อ-${ym}.csv`, ["วันที่", "เลขที่", "ผู้ขาย", "เลขผู้เสียภาษี", "มูลค่า", "VAT"], purchases.map((x) => [x.date, x.doc, x.vendor, x.taxId, x.subtotal, x.vat]))}><I.Download size={13}/> CSV</button></div></div>
        {tbl(["วันที่", "เลขที่", "ผู้ขาย", "เลขผู้เสียภาษี", "มูลค่า", "VAT"], purchases.map((x) => [x.date, x.doc, x.vendor, x.taxId, _fmt(x.subtotal, 2), _fmt(x.vat, 2)]), "ไม่มีภาษีซื้อในเดือนนี้")}
      </div>
      <div className="card">
        <div className="card-head"><div><div className="card-title">ภาษีหัก ณ ที่จ่าย (ภงด.53)</div><div className="card-sub">รวม {baht(whtTotal, 2)}</div></div>
          <div className="card-actions"><button className="btn btn-outline btn-sm" disabled={!wht.length} onClick={() => exportCSV(`ภงด53-${ym}.csv`, ["วันที่", "เลขที่", "ผู้รับเงิน", "ประเภทเงินได้", "ฐานภาษี", "อัตรา %", "ภาษีที่หัก"], wht.map((w) => [w.date, w.doc, w.payee, w.type, w.base, w.rate, w.base * w.rate / 100]))}><I.Download size={13}/> CSV</button></div></div>
        {tbl(["วันที่", "เลขที่", "ผู้รับเงิน", "ประเภท", "ฐานภาษี", "ภาษีที่หัก"], wht.map((w) => [w.date, w.doc, w.payee, w.type, _fmt(w.base, 2), `${_fmt(w.base * w.rate / 100, 2)} (${w.rate}%)`]), "ไม่มีรายการหัก ณ ที่จ่ายในเดือนนี้")}
      </div>
    </>
  );
}

// ================= จัดการผู้ใช้ (บัญชีจริงใน Store) =================
const DEPT_LABEL = { admin: "ผู้บริหาร / IT", sales: "ฝ่ายขาย", production: "ฝ่ายผลิต", procurement: "ฝ่ายจัดซื้อ", accounting: "ฝ่ายบัญชี" };
function genTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const a = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(a).map((b) => chars[b % chars.length]).join("") + "!";
}
function PageUsers({ role }) {
  useStore();
  const me = Store.user();
  const users = Store.state.users;
  const [q, setQ] = useState("");
  const [form, setForm] = useState(null); // {mode:'new'|'edit', ...}
  const [tempPw, setTempPw] = useState(null);
  if (!me || me.role !== "admin") {
    return (<><window.PageHeader title="จัดการผู้ใช้" subtitle="เฉพาะผู้ดูแลระบบ"/><div className="card" style={{ padding: 48, textAlign: "center" }}>ไม่มีสิทธิ์เข้าถึง</div></>);
  }
  const list = users.filter((u) => !q || [u.username, u.fullName, u.email].join(" ").toLowerCase().includes(q.toLowerCase()));
  const admins = users.filter((u) => u.role === "admin" && u.status === "active");

  async function save() {
    try {
      if (form.mode === "new") {
        const pw = genTempPassword();
        await Store.createUser(form, pw, true);
        setTempPw({ username: form.username, pw });
      } else {
        const u = Store.find("users", form.id);
        if (u.role === "admin" && form.role !== "admin" && admins.length <= 1) throw new Store.ERPError("ต้องมีผู้ดูแลระบบอย่างน้อย 1 บัญชี");
        Store.update("users", form.id, { fullName: form.fullName, role: form.role, email: form.email, dept: form.dept }, "id", `แก้ไขบัญชี ${u.username}`);
        notify("บันทึกข้อมูลผู้ใช้แล้ว");
      }
      setForm(null);
    } catch (e) { notify(e.message, "error"); }
  }
  async function resetPw(u) {
    if (!window.confirm(`รีเซ็ตรหัสผ่านของ ${u.username}?`)) return;
    const pw = genTempPassword();
    try { await Store.setPassword(u.id, pw); Store.update("users", u.id, { mustChange: true }, "id", "รีเซ็ตรหัสผ่าน (บังคับเปลี่ยนเมื่อเข้าครั้งถัดไป)"); setTempPw({ username: u.username, pw }); }
    catch (e) { notify(e.message, "error"); }
  }
  function toggle(u) {
    if (u.id === me.id) { notify("ระงับบัญชีของตัวเองไม่ได้", "error"); return; }
    if (u.status === "active" && u.role === "admin" && admins.length <= 1) { notify("ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 บัญชี", "error"); return; }
    runAction(() => Store.update("users", u.id, { status: u.status === "active" ? "suspended" : "active" }, "id", u.status === "active" ? "ระงับบัญชี" : "เปิดใช้งานบัญชี"), "อัปเดตสถานะบัญชีแล้ว");
  }
  function del(u) {
    if (u.id === me.id) { notify("ลบบัญชีของตัวเองไม่ได้", "error"); return; }
    if (u.role === "admin" && admins.length <= 1) { notify("ต้องมีผู้ดูแลระบบอย่างน้อย 1 บัญชี", "error"); return; }
    if (u.lastLogin) { notify("บัญชีนี้เคยใช้งานแล้ว (มีประวัติใน Log) — ใช้การระงับแทนการลบ", "error"); return; }
    if (window.confirm(`ลบบัญชี ${u.username}?`)) runAction(() => Store.remove("users", u.id), "ลบบัญชีแล้ว");
  }
  const lbl = { fontSize: 12, color: "var(--text-secondary)", display: "block", margin: "8px 0 4px" };
  return (
    <>
      <window.PageHeader title="จัดการผู้ใช้" subtitle="สร้างบัญชี กำหนด Role/สิทธิ์ ระงับ และรีเซ็ตรหัสผ่าน"
        actions={<button className="btn btn-primary btn-sm" onClick={() => setForm({ mode: "new", username: "", fullName: "", role: "sales", email: "", dept: "" })}><I.Plus size={14}/> เพิ่มผู้ใช้</button>}/>
      <div className="card">
        <div style={{ padding: 14 }}><input className="input" style={{ maxWidth: 300 }} placeholder="ค้นหาชื่อ / username / อีเมล" value={q} onChange={(e) => setQ(e.target.value)}/></div>
        <table className="table">
          <thead><tr><th>ผู้ใช้</th><th>Role / สิทธิ์</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th style={{ width: 300 }}></th></tr></thead>
          <tbody>{list.map((u) => (
            <tr key={u.id}>
              <td><b>{u.fullName}</b>{u.id === me.id && <span className="badge badge-info" style={{ marginLeft: 6 }}>คุณ</span>}<div className="mono" style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{u.username} {u.email && "· " + u.email}</div></td>
              <td>{(ROLES[u.role] || {}).label || u.role}<div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>อนุมัติได้: {ROLES[u.role] && ROLES[u.role].approve === "*" ? "ทุกเอกสาร" : ((ROLES[u.role] || {}).approve || []).map((t) => DOC_LABEL[t].th).join(", ") || "—"}</div></td>
              <td><span className={"badge badge-" + (u.status === "active" ? "success" : "danger")}>{u.status === "active" ? "ใช้งาน" : "ระงับ"}</span>{u.mustChange && <div style={{ fontSize: 11, color: "var(--amber)" }}>รอเปลี่ยนรหัสผ่าน</div>}</td>
              <td className="num" style={{ fontSize: 12 }}>{u.lastLogin || "—"}</td>
              <td style={{ textAlign: "right" }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setForm({ mode: "edit", ...u })}><I.Edit size={13}/> แก้ไข</button>
                <button className="btn btn-ghost btn-sm" onClick={() => resetPw(u)}>รีเซ็ตรหัส</button>
                <button className="btn btn-ghost btn-sm" onClick={() => toggle(u)}>{u.status === "active" ? "ระงับ" : "เปิดใช้"}</button>
                <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} aria-label="ลบ" onClick={() => del(u)}><I.Trash size={13}/></button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {form && (
        <ErpModal title={form.mode === "new" ? "เพิ่มผู้ใช้" : "แก้ไข " + form.username} width={460} onClose={() => setForm(null)}
          footer={<><button className="btn btn-outline btn-sm" onClick={() => setForm(null)}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={save} disabled={!form.fullName || !form.username}>บันทึก</button></>}>
          <label style={lbl}>ชื่อผู้ใช้ (username)</label><input className="input" disabled={form.mode !== "new"} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.trim() })}/>
          <label style={lbl}>ชื่อ-นามสกุล</label><input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })}/>
          <label style={lbl}>Role</label><select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select>
          <label style={lbl}>อีเมล</label><input className="input" type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })}/>
          {form.mode === "new" && <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 10 }}>ระบบจะสร้างรหัสผ่านชั่วคราวให้ และบังคับเปลี่ยนเมื่อเข้าใช้ครั้งแรก</div>}
        </ErpModal>
      )}
      {tempPw && (
        <ErpModal title="รหัสผ่านชั่วคราว" width={420} onClose={() => setTempPw(null)} footer={<button className="btn btn-primary btn-sm" onClick={() => setTempPw(null)}>เรียบร้อย</button>}>
          <div style={{ fontSize: 13 }}>แจ้งรหัสผ่านนี้ให้ <b>{tempPw.username}</b> (แสดงครั้งเดียว ระบบไม่เก็บรหัสจริง):</div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 700, padding: 14, background: "var(--bg-subtle)", borderRadius: 10, marginTop: 10, textAlign: "center", userSelect: "all" }}>{tempPw.pw}</div>
        </ErpModal>
      )}
    </>
  );
}

Object.assign(window, { PageAuditLog, MaintenanceCalendar, TaxReport, BOMViewer, PageUsers, KPICard, Step, moldNextPM });
