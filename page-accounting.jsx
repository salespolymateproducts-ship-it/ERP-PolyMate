/* global React, I, EXPENSES, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_GROUPS, EMPLOYEES, BarChart, Donut, PageHeader, Tabs, baht, _fmt, whtAmount, Store, useStore, Analytics, Workflow, runAction, notify, exportCSV, TaxReport */

// ห่อทั้งไฟล์ไว้ในฟังก์ชัน เพื่อไม่ให้ชื่อตัวแปรชนกับไฟล์อื่น (สาเหตุหน้าขาว)
(function () {

// =====================================================================
//  Helpers: เก็บข้อมูลถาวร (localStorage), วันที่, CSV
// =====================================================================
function usePersistentState(key, initial) {
  const [v, setV] = React.useState(() => {
    try {
      const s = localStorage.getItem(key);
      if (s) return JSON.parse(s);
    } catch (e) {}
    return typeof initial === "function" ? initial() : initial;
  });
  React.useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {}
  }, [key, v]);
  return [v, setV];
}

const localISO = (d) => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
};
const todayISO = () => localISO(new Date());
const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localISO(d);
};
const daysBetween = (a, b) =>
  Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const monthKey = (iso) => String(iso || "").slice(0, 7);
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_MONTHS_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const monthLabel = (k, full) => {
  const [y, m] = k.split("-");
  return (full ? TH_MONTHS_FULL : TH_MONTHS)[+m - 1] + " " + y;
};

function downloadCSV(filename, rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = "\uFEFF" + rows.map((r) => r.map(esc).join(",")).join("\n"); // BOM ให้ Excel อ่านภาษาไทยได้
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const VAT_RATE = 7;
const WHT_RATES = [0, 1, 2, 3, 5];
const netPayable = (e) => e.amount + (e.vat || 0) - whtAmount(e.amount, e.whtRate || 0);

// =====================================================================
//  UI ย่อย: Modal / Field / input
// =====================================================================
const inputStyle = {
  height: 34, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 8,
  background: "var(--bg-surface, var(--bg, #fff))", color: "var(--text-primary)",
  fontSize: 13, fontFamily: "inherit", width: "100%", boxSizing: "border-box",
};

function Modal({ title, onClose, children, footer }) {
  React.useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 1000, padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 540, maxHeight: "90vh", overflow: "auto" }}>
        <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="card-title">{title}</div>
          <button className="btn btn-outline btn-sm" onClick={onClose} aria-label="ปิด">✕</button>
        </div>
        <div style={{ padding: 18, display: "grid", gap: 12 }}>{children}</div>
        {footer && (
          <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, error, children }) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
      {label}
      {children}
      {error && <span style={{ color: "var(--danger)", fontSize: 11.5 }}>{error}</span>}
    </label>
  );
}

function MonthSelect({ months, value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, width: "auto", height: 30 }}>
      {months.map((m) => <option key={m} value={m}>{monthLabel(m, true)}</option>)}
    </select>
  );
}

// =====================================================================
//  บัญชี / ค่าใช้จ่าย
// =====================================================================
function seedExpenses() {
  return EXPENSES.map((e) => ({
    ...e,
    whtRate: e.whtRate || 0,
    vat: e.vat || 0,
    due: e.due || addDays(e.date, 30),
    status: e.status === "paid" ? "paid" : "approved",
  }));
}

/** ป้ายแหล่งที่มาของค่าใช้จ่าย: จากใบสั่งซื้อ (ตั้งอัตโนมัติตอนรับของ) · ซ่อมแม่พิมพ์ · คีย์เอง — รายการเก่าไม่มี source ให้เดาจากเลขอ้างอิง */
function expenseSource(e) {
  const s = e.source || (e.ref ? (/^PO/i.test(String(e.ref)) ? "po" : /^M/i.test(String(e.ref)) ? "mold" : "other") : "manual");
  if (s === "po") return { th: "จาก PO " + (e.ref || ""), cls: "badge-info" };
  if (s === "mold") return { th: "ซ่อมแม่พิมพ์ " + (e.ref || ""), cls: "badge-neutral" };
  if (s === "manual") return { th: "คีย์เอง", cls: "badge-neutral" };
  return { th: "อ้างอิง " + (e.ref || ""), cls: "badge-neutral" };
}
function ExpenseSourceTag({ e }) {
  const s = expenseSource(e);
  return <span className={"badge " + s.cls} style={{ fontSize: 10.5, fontWeight: 500 }}>{s.th}</span>;
}

function PageAccounting() {
  const [tab, setTab] = React.useState("EXP");
  useStore();
  // ค่าใช้จ่ายทั้งหมดอยู่ใน Store กลาง (รวมรายการที่ตั้งเจ้าหนี้อัตโนมัติจากการรับของตาม PO)
  const expenses = Store.state.expenses.filter((e) => e.status !== "cancelled").map((e) => ({ ...e, vat: e.vat || 0, whtRate: e.whtRate || 0, due: e.due || addDays(e.date, 30) }));
  const [showForm, setShowForm] = React.useState(false);
  const [whtExp, setWhtExp] = React.useState(null);
  const today = todayISO();

  // เดือนที่มีข้อมูล + เดือนปัจจุบัน (ใหม่สุดก่อน)
  const months = React.useMemo(() => {
    const s = new Set(expenses.map((e) => monthKey(e.date)));
    s.add(monthKey(today));
    return [...s].filter(Boolean).sort().reverse();
  }, [expenses, today]);
  const latestWithData = months.find((m) => expenses.some((e) => monthKey(e.date) === m)) || months[0];
  const [month, setMonth] = React.useState(latestWithData);

  const monthExp = expenses.filter((e) => monthKey(e.date) === month).sort((a, b) => (a.date < b.date ? 1 : -1));
  const totalExp = monthExp.reduce((s, e) => s + e.amount, 0);
  const totalWht = monthExp.reduce((s, e) => s + whtAmount(e.amount, e.whtRate), 0);
  const totalVat = monthExp.reduce((s, e) => s + e.vat, 0);

  const byCat = EXPENSE_CATEGORIES.map((c) => ({
    name: c,
    value: monthExp.filter((e) => e.category === c).reduce((s, e) => s + e.amount, 0),
  })).filter((c) => c.value > 0);

  // เจ้าหนี้ค้างจ่าย = รายการที่ยังไม่ชำระ (ทุกเดือน)
  const payables = expenses
    .filter((e) => e.status !== "paid")
    .map((e) => ({ ...e, net: netPayable(e), days: daysBetween(today, e.due) }))
    .sort((a, b) => a.days - b.days);
  const apTotal = payables.reduce((s, p) => s + p.net, 0);
  const dueSoon = payables.filter((p) => p.days <= 7).reduce((s, p) => s + p.net, 0);

  // รายการค่าใช้จ่าย: ค้นหา (เลขที่/ผู้ขาย/รายละเอียด/PO/เลขผู้เสียภาษี) · หมวด · สถานะ · ช่วงวันที่ (เริ่มต้น = เดือนที่เลือกด้านบน แก้ได้) · เรียง · แบ่งหน้า
  const [expCat, setExpCat] = React.useState("ALL");
  const [expSt, setExpSt] = React.useState("ALL");
  const expView = useListView(expenses, {
    text: (e) => [e.id, e.vendor, e.desc, e.category, e.ref, e.vendorTaxId, e.supplierId].join(" "),
    dateKey: (e) => e.date, dateLabel: "วันที่",
    filter: (e) => (expCat === "ALL" || e.category === expCat) && (expSt === "ALL" || (expSt === "paid" ? e.status === "paid" : e.status !== "paid")), filterKey: expCat + "|" + expSt,
    defaultSort: { key: "date", dir: "desc" },
    sorts: { id: (e) => e.id, date: (e) => e.date, category: (e) => e.category, vendor: (e) => e.vendor, amount: (e) => e.amount || 0, vat: (e) => e.vat || 0, wht: (e) => whtAmount(e.amount, e.whtRate), status: (e) => (e.status === "paid" ? 1 : 0) },
  });
  React.useEffect(() => {   // เปลี่ยนเดือนด้านบน → ช่วงวันที่ของรายการตามเดือนนั้น (ล้างหรือเปลี่ยนช่วงเองได้)
    if (!month) return;
    const [y, m] = month.split("-").map(Number), p = (n) => String(n).padStart(2, "0");
    expView.setFrom(y + "-" + p(m) + "-01"); expView.setTo(y + "-" + p(m) + "-" + p(new Date(y, m, 0).getDate()));
  }, [month]);
  // เจ้าหนี้ค้างจ่าย: ค้นหา · ความเร่งด่วน · ช่วงวันครบกำหนด · เรียง · แบ่งหน้า
  const [apUrg, setApUrg] = React.useState("ALL");
  const apView = useListView(payables, {
    text: (p) => [p.id, p.vendor, p.desc, p.category, p.ref].join(" "),
    dateKey: (p) => p.due, dateLabel: "ครบกำหนด",
    filter: (p) => apUrg === "ALL" || (apUrg === "late" ? p.days < 0 : apUrg === "soon" ? p.days >= 0 && p.days <= 7 : p.days > 7), filterKey: apUrg,
    defaultSort: { key: "days", dir: "asc" },
    sorts: { id: (p) => p.id, vendor: (p) => p.vendor, net: (p) => p.net, due: (p) => p.due, days: (p) => p.days },
  });
  const addExpense = (e) => runAction(() => Store.add("expenses", e, `${e.category} ${e.vendor} ${e.amount}`), `บันทึก ${e.id} แล้ว`);
  // การจ่ายเงินทำผ่านใบสำคัญจ่ายเท่านั้น (ลงสมุดบัญชี + ออกเลข 50 ทวิ ณ วันจ่ายจริง) — ไม่มีปุ่มจ่ายลัดที่ข้ามสมุดบัญชี
  // กดที่รายการไหน → ไปหน้าจ่ายเงินและเปิดฟอร์มสร้างใบสำคัญจ่ายโดยติ๊กรายการนั้นไว้ให้
  const goPay = (expenseId) => window.dispatchEvent(new CustomEvent("erp-goto", { detail: { page: "fin-payments", focus: { pvExpense: expenseId } } }));
  const removeExpense = (id) => {
    const rec = Store.find("expenses", id);
    if (rec && rec.status === "paid") { notify("รายการที่จ่ายแล้วยกเลิกไม่ได้", "error"); return; }
    const reason = window.prompt("ยกเลิกรายการ " + id + " — ระบุเหตุผล:");
    if (reason && reason.trim()) runAction(() => Store.update("expenses", id, { status: "cancelled", cancel: { reason: reason.trim(), by: Store.userName(), at: Store.now() } }, "id", "ยกเลิก: " + reason.trim()), `ยกเลิก ${id} แล้ว`);
  };

  const exportCurrent = () => {
    if (tab === "AP") {
      downloadCSV(`เจ้าหนี้ค้างจ่าย_${today}.csv`, [
        ["เลขที่", "ผู้ขาย", "รายละเอียด", "ยอดสุทธิที่ต้องจ่าย", "กำหนดชำระ", "เหลือ (วัน)"],
        ...apView.sorted.map((p) => [p.id, p.vendor, p.desc, p.net.toFixed(2), p.due, p.days]),
      ]);
    } else {
      downloadCSV(`ค่าใช้จ่าย_${expView.from || "ทั้งหมด"}_${expView.to || ""}.csv`, [
        ["เลขที่", "วันที่", "หมวด", "ผู้ขาย", "รายละเอียด", "ก่อน VAT", "VAT", "หัก ณ ที่จ่าย %", "หัก ณ ที่จ่าย", "ยอดจ่ายสุทธิ", "กำหนดชำระ", "สถานะ"],
        ...expView.sorted.map((e) => [
          e.id, e.date, e.category, e.vendor, e.desc, e.amount.toFixed(2), e.vat.toFixed(2),
          e.whtRate, whtAmount(e.amount, e.whtRate).toFixed(2), netPayable(e).toFixed(2), e.due,
          e.status === "paid" ? "ชำระแล้ว" : "รอชำระ",
        ]),
      ]);
    }
  };


  return (
    <>
      <PageHeader
        title="บัญชี / ค่าใช้จ่าย"
        subtitle="บันทึกซื้อ · ค่าแรง · ค่าใช้จ่ายโรงงาน · เจ้าหนี้ค้างจ่าย"
        actions={
          <>
            <MonthSelect months={months} value={month} onChange={setMonth} />
            <button className="btn btn-outline btn-sm" onClick={() => printReport("บัญชี · " + month)}><I.Printer size={14}/> พิมพ์ / PDF</button>
            <button className="btn btn-outline btn-sm" onClick={exportCurrent}><I.Download size={14}/> ส่งออก</button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}><I.Plus size={14}/> บันทึกค่าใช้จ่าย</button>
          </>
        }
      />

      <div className="grid-4" style={{ marginBottom: 14 }}>
        <SmallStat label={"ค่าใช้จ่าย " + monthLabel(month)} value={baht(totalExp)} tone="amber" icon="Wallet"/>
        <SmallStat label="เจ้าหนี้ค้างจ่าย" value={baht(apTotal)} tone="violet" icon="Clock"/>
        <SmallStat label="ครบ/เกินกำหนดใน 7 วัน" value={baht(dueSoon)} tone="amber" icon="Alert"/>
        <SmallStat label={"ภาษีซื้อ " + monthLabel(month)} value={baht(totalVat)} tone="success" icon="TrendUp"/>
      </div>

      <Tabs
        items={[
          { id: "EXP", label: "ค่าใช้จ่าย", count: monthExp.length },
          { id: "AP", label: "เจ้าหนี้ค้างจ่าย", count: payables.length },
          { id: "PL", label: "P&L สรุป" },
          { id: "TAX", label: "ภพ.30 / ภาษีซื้อขาย" },
          { id: "WHT", label: "ภาษีถูกหัก (50 ทวิ)", count: Store.state.docs.filter((d) => { const w = Workflow.whtCertStatus(d); return w && w.state === "pending"; }).length },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "EXP" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 14 }}>
          <div className="card" style={{ overflowX: "auto" }}>
            <ListToolbar view={expView} placeholder="เลขที่ / ผู้ขาย / รายละเอียด / PO…">
              <select className="select" style={{ width: 190 }} value={expCat} onChange={(e) => setExpCat(e.target.value)}><option value="ALL">ทุกหมวด</option>{EXPENSE_CATEGORY_GROUPS.map((g) => <optgroup key={g.group} label={g.group}>{g.items.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>)}</select>
              <select className="select" style={{ width: 130 }} value={expSt} onChange={(e) => setExpSt(e.target.value)}><option value="ALL">ทุกสถานะ</option><option value="unpaid">รอชำระ</option><option value="paid">ชำระแล้ว</option></select>
            </ListToolbar>
            <table className="table">
              <thead>
                <tr>
                  <SortTh view={expView} k="id">เลขที่</SortTh><SortTh view={expView} k="date">วันที่</SortTh><SortTh view={expView} k="category">หมวด</SortTh><SortTh view={expView} k="vendor">ผู้ขาย</SortTh><th>รายละเอียด</th>
                  <SortTh view={expView} k="amount" className="num">ก่อน VAT</SortTh><SortTh view={expView} k="vat" className="num">VAT</SortTh><SortTh view={expView} k="wht" className="num">หัก ณ ที่จ่าย</SortTh>
                  <SortTh view={expView} k="status">สถานะ</SortTh><th></th>
                </tr>
              </thead>
              <tbody>
                {expView.total === 0 && (
                  <tr><td colSpan={10} style={{ textAlign: "center", padding: 28, color: "var(--text-tertiary)" }}>
                    {expenses.length ? "ไม่พบรายการตามเงื่อนไข — ลองเปลี่ยนช่วงวันที่หรือกด \"ล้างตัวกรอง\"" : "ยังไม่มีรายการ — กด \"บันทึกค่าใช้จ่าย\" เพื่อเพิ่ม"}
                  </td></tr>
                )}
                {expView.pageRows.map((e) => (
                  <tr key={e.id}>
                    <td className="mono"><b>{e.id}</b><div><ExpenseSourceTag e={e}/></div></td>
                    <td className="num" style={{ fontSize: 12.5 }}>{e.date}</td>
                    <td><span className="badge badge-neutral">{e.category}</span></td>
                    <td style={{ fontSize: 12.5 }}>{e.vendor}</td>
                    <td style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{e.desc}</td>
                    <td className="num">{_fmt(e.amount)}</td>
                    <td className="num" style={{ color: "var(--text-secondary)" }}>{_fmt(e.vat)}</td>
                    <td className="num" style={{ color: e.whtRate ? "var(--amber)" : "var(--text-tertiary)" }}>
                      {e.whtRate ? <>({_fmt(whtAmount(e.amount, e.whtRate))})<span style={{ fontSize: 10, color: "var(--text-tertiary)", marginLeft: 3 }}>{e.whtRate}%</span></> : "—"}
                    </td>
                    <td>{e.status === "paid"
                      ? <><span className="badge badge-success">ชำระแล้ว</span>{e.payVoucher ? <div className="mono" style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>{e.payVoucher}</div> : <div style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>ข้อมูลเดิม ไม่มี PV</div>}</>
                      : <span className="badge badge-warning">รอชำระ</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {e.status !== "paid" && e.status !== "cancelled" && <button className="btn btn-outline btn-sm" onClick={() => goPay(e.id)} title="จ่ายเงินต้องทำผ่านใบสำคัญจ่าย">ทำใบสำคัญจ่าย</button>}
                      {e.whtRate > 0 && e.status === "paid" && <button className="btn btn-outline btn-sm" style={{ marginLeft: 4 }} onClick={() => setWhtExp(e)} title="หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)">{e.whtCert ? "50 ทวิ " + e.whtCert.no.slice(-4) : "ออก 50 ทวิ"}</button>}
                      <button className="btn btn-outline btn-sm" style={{ marginLeft: 4, color: "var(--danger)" }} onClick={() => removeExpense(e.id)} title="ยกเลิกรายการ" aria-label="ยกเลิกรายการ">✕</button>
                    </td>
                  </tr>
                ))}
                {expView.total > 0 && (
                  <tr style={{ background: "var(--bg-subtle)", fontWeight: 600 }}>
                    <td colSpan={5} style={{ textAlign: "right" }}>รวมตามที่กรอง ({expView.total} รายการ)</td>
                    <td className="num">{_fmt(expView.sorted.reduce((t, e) => t + e.amount, 0))}</td>
                    <td className="num" style={{ color: "var(--text-secondary)" }}>{_fmt(expView.sorted.reduce((t, e) => t + e.vat, 0))}</td>
                    <td className="num" style={{ color: "var(--amber)" }}>({_fmt(expView.sorted.reduce((t, e) => t + whtAmount(e.amount, e.whtRate), 0))})</td>
                    <td colSpan={2}></td>
                  </tr>
                )}
              </tbody>
            </table>
            <Pager view={expView}/>
          </div>
          <div className="card">
            <div className="card-head"><div className="card-title">สัดส่วนค่าใช้จ่าย · {monthLabel(month)}</div></div>
            <div className="card-body" style={{ display: "grid", placeItems: "center", paddingBottom: 12 }}>
              {byCat.length === 0 ? (
                <div style={{ padding: 24, color: "var(--text-tertiary)", fontSize: 12.5 }}>ไม่มีข้อมูล</div>
              ) : (
                <>
                  <Donut data={byCat} size={160} thickness={22}/>
                  <div style={{ marginTop: 12, width: "100%" }}>
                    {byCat.map((c, i) => {
                      const colors = ["#2D6CDF", "#7C3AED", "#0EA5C7", "#F59E0B", "#16A34A", "#94A3B8", "#EC4899", "#D97706", "#475569"];
                      return (
                        <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0" }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: colors[i % colors.length] }} />
                          <span style={{ flex: 1, color: "var(--text-secondary)" }}>{c.name}</span>
                          <span className="num" style={{ fontWeight: 500 }}>{_fmt((c.value / totalExp) * 100, 1)}%</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "AP" && (
        <div className="card" style={{ overflowX: "auto" }}>
          <ListToolbar view={apView} placeholder="เลขที่ / ผู้ขาย / รายละเอียด…">
            <select className="select" style={{ width: 160 }} value={apUrg} onChange={(e) => setApUrg(e.target.value)}><option value="ALL">ทุกความเร่งด่วน</option><option value="late">เกินกำหนด</option><option value="soon">ครบใน 7 วัน</option><option value="ok">ปกติ</option></select>
          </ListToolbar>
          <table className="table">
            <thead><tr><SortTh view={apView} k="id">เลขที่</SortTh><SortTh view={apView} k="vendor">ผู้ขาย</SortTh><th>รายละเอียด</th><SortTh view={apView} k="net" className="num">ยอดจ่ายสุทธิ</SortTh><SortTh view={apView} k="due">กำหนดชำระ</SortTh><SortTh view={apView} k="days">ระยะเวลา</SortTh><th>เร่งด่วน</th><th></th></tr></thead>
            <tbody>
              {apView.total === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: 28, color: "var(--text-tertiary)" }}>{payables.length ? "ไม่พบเจ้าหนี้ตามเงื่อนไข" : "ไม่มีเจ้าหนี้ค้างจ่าย"}</td></tr>
              )}
              {apView.pageRows.map((p) => (
                <tr key={p.id}>
                  <td className="mono"><b>{p.id}</b></td>
                  <td style={{ fontWeight: 500 }}>{p.vendor}</td>
                  <td style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{p.desc}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{baht(p.net)}</td>
                  <td className="num">{p.due}</td>
                  <td className="num" style={{ color: p.days <= 7 ? "var(--danger)" : "var(--text-secondary)" }}>
                    {p.days < 0 ? `เกิน ${-p.days} วัน` : p.days === 0 ? "วันนี้" : `อีก ${p.days} วัน`}
                  </td>
                  <td>{p.days < 0
                    ? <span className="badge badge-danger">เกินกำหนด</span>
                    : p.days <= 7
                      ? <span className="badge badge-warning">ใกล้ครบกำหนด</span>
                      : <span className="badge badge-neutral">ปกติ</span>}</td>
                  <td><button className="btn btn-outline btn-sm" onClick={() => goPay(p.id)} title={"ทำใบสำคัญจ่ายสำหรับ " + p.id}>ทำใบสำคัญจ่าย</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager view={apView}/>
        </div>
      )}

      {tab === "PL" && <PLPanel month={month}/>}
      {tab === "TAX" && <TaxReport month={month}/>}
      {tab === "WHT" && <WhtCertPanel/>}
      {whtExp && <WhtIssueModal exp0={whtExp} onClose={() => setWhtExp(null)}/>}

      {showForm && (
        <ExpenseForm
          existing={expenses}
          onClose={() => setShowForm(false)}
          onSave={(e) => { addExpense(e); setMonth(monthKey(e.date)); setShowForm(false); }}
        />
      )}
    </>
  );
}

function nextId(prefix, existing) {
  let max = 0;
  existing.forEach((x) => {
    const m = String(x.id || "").match(/(\d+)$/);
    if (m && String(x.id).startsWith(prefix)) max = Math.max(max, +m[1]);
  });
  return prefix + String(max + 1).padStart(4, "0");
}

function ExpenseForm({ existing, onClose, onSave }) {
  useStore();
  const today = todayISO();
  // ผู้ขายเลือกได้เฉพาะที่ลงทะเบียนไว้ (จัดซื้อ → Supplier) — เก็บเลข/ที่อยู่ผู้เสียภาษีตามทะเบียน ณ วันที่บันทึก
  const suppliers = Store.state.suppliers.filter((x) => x.status !== "inactive").sort((a, b) => String(a.name).localeCompare(String(b.name), "th"));
  const [f, setF] = React.useState({
    date: today, category: EXPENSE_CATEGORIES[0], supplierId: "", desc: "",
    amount: "", priceMode: "ex", hasVat: false, whtRate: 0, creditDays: 30, status: "approved",
  });
  const [err, setErr] = React.useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const sup = suppliers.find((x) => x.id === f.supplierId) || null;
  const pickSupplier = (e) => {
    const s2 = suppliers.find((x) => x.id === e.target.value);
    setF({ ...f, supplierId: e.target.value, ...(s2 && s2.credit != null ? { creditDays: s2.credit } : {}) });
  };

  // ยอดที่กรอก: "ไม่รวม VAT" (ฐานภาษี) หรือ "รวม VAT" (ถอด VAT ออกจากยอดรวม) — ติ๊ก VAT เองเท่านั้น
  const r2 = (n) => Math.round(n * 100) / 100;
  const entered = parseFloat(f.amount) || 0;
  const incl = f.hasVat && f.priceMode === "inc";
  const amount = incl ? r2(entered * 100 / (100 + VAT_RATE)) : r2(entered);          // ฐานภาษี (ก่อน VAT)
  const vat = f.hasVat ? (incl ? r2(entered - amount) : r2(amount * VAT_RATE / 100)) : 0;
  const wht = whtAmount(amount, +f.whtRate);

  const save = () => {
    const er = {};
    if (!sup) er.vendor = "กรุณาเลือกผู้ขายจากทะเบียน (ถ้ายังไม่มี ให้เพิ่มที่ จัดซื้อ → Supplier ก่อน)";
    if (!(amount > 0)) er.amount = "จำนวนเงินต้องมากกว่า 0";
    if (!f.date) er.date = "กรุณาระบุวันที่";
    setErr(er);
    if (Object.keys(er).length) return;
    onSave({
      id: nextId("EXP-", existing),
      date: f.date,
      category: f.category,
      vendor: sup.name,
      supplierId: sup.id,
      vendorTaxId: sup.taxId && sup.taxId !== "—" ? sup.taxId : "",
      vendorAddress: sup.address || "",
      desc: f.desc.trim(),
      amount,
      vat,
      priceMode: f.hasVat ? f.priceMode : "ex",
      enteredAmount: r2(entered),
      whtRate: +f.whtRate,
      due: addDays(f.date, +f.creditDays || 0),
      status: "approved",   // จ่ายเงินทำผ่านใบสำคัญจ่ายเท่านั้น
      source: "manual",
    });
  };

  return (
    <Modal
      title="บันทึกค่าใช้จ่าย"
      onClose={onClose}
      footer={<>
        <button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary btn-sm" onClick={save}>บันทึก</button>
      </>}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="วันที่" error={err.date}><DateInput style={inputStyle} value={f.date} onChange={set("date")}/></Field>
        <Field label="หมวด">
          <select style={inputStyle} value={f.category} onChange={set("category")}>
            {EXPENSE_CATEGORY_GROUPS.map((g) => <optgroup key={g.group} label={g.group}>{g.items.map((c) => <option key={c}>{c}</option>)}</optgroup>)}
          </select>
        </Field>
      </div>
      <Field label="ผู้ขาย (เลือกจากทะเบียน Supplier)" error={err.vendor}>
        <select style={inputStyle} value={f.supplierId} onChange={pickSupplier} autoFocus>
          <option value="">— เลือกผู้ขาย —</option>
          {suppliers.map((x) => <option key={x.id} value={x.id}>{x.code ? x.code + " · " : ""}{x.name}</option>)}
        </select>
      </Field>
      {!suppliers.length && <div style={{ fontSize: 12, color: "var(--amber)" }}>ยังไม่มีผู้ขายในทะเบียน — เพิ่มที่เมนู จัดซื้อ → Supplier ก่อน</div>}
      {sup && (
        <div style={{ background: "var(--bg-subtle)", borderRadius: 8, padding: "8px 12px", fontSize: 12, display: "grid", gap: 3 }}>
          <div><span style={{ color: "var(--text-secondary)" }}>เลขประจำตัวผู้เสียภาษี: </span><b className="mono">{sup.taxId && sup.taxId !== "—" ? sup.taxId : "ไม่ระบุ (ควรเพิ่มในทะเบียนผู้ขาย)"}</b></div>
          <div><span style={{ color: "var(--text-secondary)" }}>ที่อยู่: </span>{sup.address || "ไม่ระบุ (ควรเพิ่มในทะเบียนผู้ขาย)"}</div>
        </div>
      )}
      <Field label="รายละเอียด"><input style={inputStyle} value={f.desc} onChange={set("desc")}/></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={"จำนวนเงิน (" + (incl ? "รวม VAT" : "ไม่รวม VAT") + ")"} error={err.amount}>
          <input type="number" min="0" step="0.01" style={inputStyle} value={f.amount} onChange={set("amount")}/>
        </Field>
        <Field label="หัก ณ ที่จ่าย">
          <select style={inputStyle} value={f.whtRate} onChange={set("whtRate")}>
            {WHT_RATES.map((r) => <option key={r} value={r}>{r ? r + "%" : "ไม่หัก"}</option>)}
          </select>
        </Field>
        <Field label="เครดิต (วัน)"><input type="number" min="0" style={inputStyle} value={f.creditDays} onChange={set("creditDays")}/></Field>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>บันทึกแล้วจะอยู่สถานะ "รอชำระ" — จ่ายเงินที่เมนู การเงิน → จ่ายเงิน (ใบสำคัญจ่าย) ซึ่งมี "บันทึกและจ่ายทันที" สำหรับรายการเล็ก</div>
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", fontSize: 13 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={f.hasVat} onChange={set("hasVat")}/> มีใบกำกับภาษี (VAT {VAT_RATE}%)
        </label>
        {f.hasVat && (
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 5 }}><input type="radio" name="expPriceMode" checked={f.priceMode === "ex"} onChange={() => setF({ ...f, priceMode: "ex" })}/> ยอดที่กรอก <b>ไม่รวม</b> VAT</label>
            <label style={{ display: "flex", alignItems: "center", gap: 5 }}><input type="radio" name="expPriceMode" checked={f.priceMode === "inc"} onChange={() => setF({ ...f, priceMode: "inc" })}/> ยอดที่กรอก <b>รวม</b> VAT แล้ว</label>
          </span>
        )}
      </div>
      <div style={{ background: "var(--bg-subtle)", borderRadius: 8, padding: "10px 12px", fontSize: 12.5, display: "grid", gap: 4 }}>
        <Row k="ฐานภาษี (ก่อน VAT)" v={_fmt(amount)}/>
        <Row k={f.hasVat ? `VAT ${VAT_RATE}%` : "VAT (ไม่มีใบกำกับภาษี)"} v={_fmt(vat)}/>
        {f.hasVat && <Row k="รวม VAT" v={_fmt(amount + vat)}/>}
        <Row k={`หัก ณ ที่จ่าย ${f.whtRate}%`} v={"(" + _fmt(wht) + ")"}/>
        <Row k={<b>ยอดจ่ายสุทธิ</b>} v={<b>{_fmt(amount + vat - wht)}</b>}/>
        <Row k="กำหนดชำระ" v={addDays(f.date || today, +f.creditDays || 0)}/>
      </div>
    </Modal>
  );
}

function Row({ k, v }) {
  return <div style={{ display: "flex", justifyContent: "space-between" }}><span>{k}</span><span className="num">{v}</span></div>;
}

// =====================================================================
//  P&L — รายได้/ต้นทุนขายกรอกเองต่อเดือน, ค่าใช้จ่ายดึงจากรายการจริง
// =====================================================================
// งบกำไรขาดทุน — ดึงจากใบกำกับภาษีที่อนุมัติ (รายได้), ต้นทุนมาตรฐานสินค้า (ต้นทุนขาย) และค่าใช้จ่ายที่บันทึก
function PLPanel({ month }) {
  useStore();
  const x = Analytics.month(month);
  const revenue = x.revenue, cogs = x.cogs, opex = x.opex;
  const gp = revenue - cogs;
  const ebit = gp - opex;
  const tax = ebit > 0 ? ebit * 0.2 : 0;
  const net = ebit - tax;
  const pct = (v) => (revenue ? _fmt((v / revenue) * 100, 1) + "%" : "—");
  const rows = [
    ["รายได้จากการขาย (ใบกำกับภาษี " + x.invoices.length + " ใบ)", revenue, false],
    ["ต้นทุนขาย (จำนวน × ต้นทุนมาตรฐานสินค้า)", -cogs, false],
    ["กำไรขั้นต้น", gp, true],
    ["ค่าใช้จ่ายดำเนินงาน (ไม่รวมวัตถุดิบ/สีผสม)", -opex, false],
    ["EBIT", ebit, true],
    ["ภาษีเงินได้ประมาณการ (20%)", -tax, false],
    ["กำไรสุทธิ", net, true],
  ];
  const trend = Analytics.lastMonths(12).map((m) => { const y = Analytics.month(m.ym); return { m: m.label, v: (y.revenue - y.cogs) / 1e6 }; });
  return (
    <div className="grid-2">
      <div className="card">
        <div className="card-head"><div className="card-title">งบกำไรขาดทุน · {monthLabel(month, true)}</div></div>
        <div style={{ padding: "8px 18px 18px" }}>
          {rows.map(([k, v, total], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)", fontWeight: total ? 600 : 400 }}>
              <span style={{ flex: 1, fontSize: total ? 14 : 13 }}>{k}</span>
              <span className="num" style={{ color: v < 0 ? "var(--danger)" : "var(--text-primary)" }}>{v < 0 ? "(" + _fmt(Math.abs(v), 2) + ")" : _fmt(v, 2)}</span>
            </div>
          ))}
          <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-secondary)" }}><span>อัตรากำไรขั้นต้น</span><span className="num">{pct(gp)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}><span>อัตรากำไรสุทธิ</span><span className="num">{pct(net)}</span></div>
          <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 10 }}>ต้นทุนมาตรฐานแก้ไขได้ที่ทะเบียนสินค้า (คลังสินค้า)</div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><div className="card-title">กำไรขั้นต้น · 12 เดือน (ล้านบาท)</div></div>
        <div style={{ padding: "8px 12px 14px" }}><BarChart data={trend} keyV="v" keyL="m" color="#16A34A"/></div>
      </div>
    </div>
  );
}

function SmallStat({ label, value, tone, icon }) {
  const Ico = I[icon] || I.Wallet;
  const c = ({
    accent: { c: "var(--accent)", b: "var(--accent-subtle)" },
    violet: { c: "var(--violet)", b: "var(--violet-subtle)" },
    success: { c: "var(--success)", b: "var(--success-subtle)" },
    amber: { c: "var(--amber)", b: "var(--amber-subtle)" },
  })[tone];
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: c.b, color: c.c, display: "grid", placeItems: "center" }}>
          <Ico size={15}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</div>
          <div className="num" style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", marginTop: 2 }}>{value}</div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
//  HR
// =====================================================================
function PageHR() {
  useStore();
  const employees = Store.state.employees;
  const [showForm, setShowForm] = React.useState(false);
  // ค้นหา (รหัส/ชื่อ/ตำแหน่ง/แผนก/โทร) · แผนก · ช่วงวันที่เริ่มงาน · เรียง · แบ่งหน้า
  const [hrDept, setHrDept] = React.useState("ALL");
  const depts = [...new Set(employees.map((e) => e.dept).filter(Boolean))];
  const view = useListView(employees, {
    text: (e) => [e.id, e.name, e.role, e.dept, e.phone].join(" "),
    dateKey: (e) => e.joined, dateLabel: "เริ่มงาน",
    filter: (e) => hrDept === "ALL" || e.dept === hrDept, filterKey: hrDept,
    defaultSort: { key: "id", dir: "asc" },
    sorts: { id: (e) => e.id, name: (e) => e.name, role: (e) => e.role, dept: (e) => e.dept, phone: (e) => e.phone, joined: (e) => e.joined || "", salary: (e) => +e.salary || 0 },
  });
  const payroll = employees.reduce((s, e) => s + (+e.salary || 0), 0);

  const exportPayroll = () => downloadCSV(`เงินเดือน_${monthKey(todayISO())}.csv`, [
    ["รหัส", "ชื่อ", "ตำแหน่ง", "แผนก", "เงินเดือน"],
    ...employees.map((e) => [e.id, e.name, e.role, e.dept, (+e.salary).toFixed(2)]),
    ["", "", "", "รวม", payroll.toFixed(2)],
  ]);
  const remove = (id) => {
    if (window.confirm("ลบพนักงาน " + id + " ?")) runAction(() => Store.remove("employees", id), "ลบ " + id + " แล้ว");
  };

  return (
    <>
      <PageHeader
        title="พนักงาน"
        subtitle={`${employees.length} คน · ${new Set(employees.map((e) => e.dept)).size} แผนก · ค่าแรงเดือน ${baht(payroll)}`}
        actions={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => printReport("รายงานพนักงาน")}><I.Printer size={14}/> พิมพ์ / PDF</button>
            <button className="btn btn-outline btn-sm" onClick={exportPayroll}><I.Download size={14}/> รายงานเงินเดือน</button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}><I.Plus size={14}/> เพิ่มพนักงาน</button>
          </>
        }
      />
      <div className="card" style={{ overflowX: "auto" }}>
        <ListToolbar view={view} placeholder="รหัส / ชื่อ / ตำแหน่ง / แผนก / โทร…">
          <select className="select" style={{ width: 150 }} value={hrDept} onChange={(e) => setHrDept(e.target.value)}><option value="ALL">ทุกแผนก</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        </ListToolbar>
        <table className="table">
          <thead><tr><SortTh view={view} k="id">รหัส</SortTh><SortTh view={view} k="name">ชื่อ</SortTh><SortTh view={view} k="role">ตำแหน่ง</SortTh><SortTh view={view} k="dept">แผนก</SortTh><SortTh view={view} k="phone">โทรศัพท์</SortTh><SortTh view={view} k="joined">เริ่มงาน</SortTh><SortTh view={view} k="salary" className="num">เงินเดือน</SortTh><th></th></tr></thead>
          <tbody>
            {view.total === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 28, color: "var(--text-tertiary)" }}>ไม่พบพนักงาน</td></tr>
            )}
            {view.pageRows.map((e) => (
              <tr key={e.id}>
                <td className="mono"><b>{e.id}</b></td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 99, background: "var(--accent-subtle)", color: "var(--accent)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600 }}>
                      {e.name.split(" ").map((s) => s[0]).join("").slice(0, 2)}
                    </div>
                    <span style={{ fontWeight: 500 }}>{e.name}</span>
                  </div>
                </td>
                <td>{e.role}</td>
                <td><span className="badge badge-neutral">{e.dept}</span></td>
                <td style={{ fontSize: 12.5 }}>{e.phone}</td>
                <td className="num" style={{ fontSize: 12.5 }}>{e.joined}</td>
                <td className="num" style={{ fontWeight: 500 }}>{baht(+e.salary)}</td>
                <td><button className="btn btn-outline btn-sm" style={{ color: "var(--danger)" }} onClick={() => remove(e.id)} title="ลบ">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager view={view}/>
      </div>
      {showForm && (
        <EmployeeForm
          existing={employees}
          onClose={() => setShowForm(false)}
          onSave={(e) => { runAction(() => Store.add("employees", e, e.name), "เพิ่มพนักงาน " + e.name + " แล้ว"); setShowForm(false); }}
        />
      )}
    </>
  );
}

function EmployeeForm({ existing, onClose, onSave }) {
  const depts = [...new Set(existing.map((e) => e.dept))];
  const [f, setF] = React.useState({ name: "", role: "", dept: depts[0] || "", phone: "", joined: todayISO(), salary: "" });
  const [err, setErr] = React.useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const prefix = (String(existing[0]?.id || "EMP-").match(/^\D+/) || ["EMP-"])[0];

  const save = () => {
    const er = {};
    if (!f.name.trim()) er.name = "กรุณาระบุชื่อ";
    if (!f.dept.trim()) er.dept = "กรุณาระบุแผนก";
    if (!(parseFloat(f.salary) > 0)) er.salary = "เงินเดือนต้องมากกว่า 0";
    setErr(er);
    if (Object.keys(er).length) return;
    onSave({ ...f, id: nextId(prefix, existing), name: f.name.trim(), dept: f.dept.trim(), salary: parseFloat(f.salary) });
  };

  return (
    <Modal
      title="เพิ่มพนักงาน"
      onClose={onClose}
      footer={<>
        <button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary btn-sm" onClick={save}>บันทึก</button>
      </>}
    >
      <Field label="ชื่อ-นามสกุล" error={err.name}><input style={inputStyle} value={f.name} onChange={set("name")} autoFocus/></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="ตำแหน่ง"><input style={inputStyle} value={f.role} onChange={set("role")}/></Field>
        <Field label="แผนก" error={err.dept}>
          <input style={inputStyle} list="dept-list" value={f.dept} onChange={set("dept")}/>
          <datalist id="dept-list">{depts.map((d) => <option key={d} value={d}/>)}</datalist>
        </Field>
        <Field label="โทรศัพท์"><input style={inputStyle} value={f.phone} onChange={set("phone")}/></Field>
        <Field label="เริ่มงาน"><DateInput style={inputStyle} value={f.joined} onChange={set("joined")}/></Field>
        <Field label="เงินเดือน (บาท)" error={err.salary}><input type="number" min="0" style={inputStyle} value={f.salary} onChange={set("salary")}/></Field>
      </div>
    </Modal>
  );
}

// =====================================================================
//  Reports
// =====================================================================
// รายงาน — คำนวณจากข้อมูลจริงทั้งหมด
function PageReports() {
  useStore();
  const S = Store.state;
  const trend = Analytics.trend(12);
  // NG ตามผลิตภัณฑ์ (จากใบสั่งผลิตทั้งหมด)
  const ng = {};
  S.workOrders.forEach((w) => { if (!w.produced) return; const k = w.productCode; ng[k] = ng[k] || { p: 0, n: 0 }; ng[k].p += w.produced; ng[k].n += w.ng; });
  const ngRows = Object.entries(ng).map(([k, v]) => [k, +(v.n / v.p * 100).toFixed(2), v.n / v.p > 0.02 ? "เฝ้าระวัง" : "ปกติ"]);
  // ผลิตตามเครื่อง (30 วันล่าสุด)
  const since = new Date(Store.today() + "T00:00:00"); since.setDate(since.getDate() - 30);
  const sinceISO = since.toISOString().slice(0, 10);
  const byMc = {};
  S.workOrders.forEach((w) => (w.logs || []).forEach((l) => { if (String(l.at).slice(0, 10) >= sinceISO) byMc[w.machine] = (byMc[w.machine] || 0) + l.produced; }));
  const mcRows = S.machines.map((m) => [m.id, byMc[m.id] ? _fmt(byMc[m.id]) + " ชิ้น" : null, m.condition === "maintenance" ? "maintenance" : m.status]);
  // สินค้าขายดี (มูลค่าใบกำกับภาษี)
  const prod = {};
  Analytics.invoices().forEach((d) => (d.lines || []).forEach((l) => { prod[l.code] = (prod[l.code] || 0) + Workflow.lineAmount(l); }));
  const prodRows = Object.entries(prod).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [k, _fmt(v) + " ฿", ""]);
  const aging = Analytics.arAging();
  return (
    <>
      <PageHeader title="รายงาน" subtitle="วิเคราะห์ยอดขาย · ต้นทุน · การผลิต — คำนวณจากเอกสารและบันทึกจริงในระบบ"
        actions={<><button className="btn btn-outline btn-sm" onClick={() => printReport("รายงานผู้บริหาร")}><I.Printer size={14}/> พิมพ์ / PDF</button><button className="btn btn-outline btn-sm" onClick={() => exportCSV(`รายงานรายเดือน-${Store.today()}.csv`, ["เดือน", "ยอดขาย (ล้านบาท)", "ต้นทุนรวม (ล้านบาท)"], trend.map((t) => [t.ym, t.revenue.toFixed(4), t.cost.toFixed(4)]))}><I.Download size={14}/> ส่งออก CSV</button></>}/>
      <div className="grid-2">
        <div className="card"><div className="card-head"><div><div className="card-title">ยอดขายรายเดือน · 12 เดือน</div><div className="card-sub">ล้านบาท (ใบกำกับภาษีที่อนุมัติ ก่อน VAT)</div></div></div>
          <div style={{ padding: 12 }}><BarChart data={trend} keyV="revenue" keyL="m" color="#2D6CDF"/></div></div>
        <div className="card"><div className="card-head"><div><div className="card-title">ต้นทุนรายเดือน · 12 เดือน</div><div className="card-sub">ล้านบาท (ต้นทุนขาย + ค่าใช้จ่ายดำเนินงาน)</div></div></div>
          <div style={{ padding: 12 }}><BarChart data={trend} keyV="cost" keyL="m" color="#7C3AED"/></div></div>
      </div>
      <div className="grid-4" style={{ marginTop: 14 }}>
        <ReportCard title="ผลิตตามเครื่อง · 30 วัน" rows={mcRows}/>
        <ReportCard title="ของเสีย NG % · ตามผลิตภัณฑ์" rows={ngRows} empty="ยังไม่มีการบันทึกผลิต"/>
        <ReportCard title="สินค้าขายดี (มูลค่า)" rows={prodRows} empty="ยังไม่มีใบกำกับภาษี"/>
        <ReportCard title="อายุลูกหนี้" rows={[["ยังไม่ครบกำหนด", _fmt(aging.current), ""], ["1–30 วัน", _fmt(aging.d30), ""], ["31–60 วัน", _fmt(aging.d60), ""], ["เกิน 60 วัน", _fmt(aging.d90), aging.d90 ? "ติดตาม" : ""]]}/>
      </div>
    </>
  );
}

function ReportCard({ title, rows, empty }) {
  return (
    <div className="card">
      <div className="card-head"><div className="card-title">{title}</div></div>
      <div style={{ padding: "4px 18px 14px" }}>
        {!rows.length && <div style={{ padding: 16, fontSize: 12.5, color: "var(--text-tertiary)" }}>{empty || "ไม่มีข้อมูล"}</div>}
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--border)", gap: 8 }}>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)", flex: 1 }}>{r[0]}</span>
            <span className="num" style={{ fontWeight: 500 }}>{r[1] == null ? "—" : typeof r[1] === "number" ? r[1] + "%" : r[1]}</span>
            {r[2] && <span className="badge badge-neutral">{r[2]}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

window.PageAccounting = PageAccounting;
window.MonthSelect = MonthSelect;   // ใช้ร่วมกับหน้าภาษีหัก ณ ที่จ่าย (page-more.jsx)
window.PageHR = PageHR;
window.PageReports = PageReports;
// เผื่อไฟล์อื่นเรียกใช้ component เหล่านี้ (เหมือนเวอร์ชันเดิม)
// ================= หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) ที่ลูกค้าออกให้เรา =================
// บันทึกเลขที่/วันที่/ยอด ผูกกับใบเสร็จที่มีหัก ณ ที่จ่าย (ไม่แนบไฟล์) — ใช้ติดตามที่ยังไม่ได้รับ และสรุปเครดิตภาษี
function WhtCertModal({ rc, onClose, onDone }) {
  const c0 = rc.whtCert;
  const [no, setNo] = React.useState(c0 ? c0.no : "");
  const [date, setDate] = React.useState(c0 ? c0.date : todayISO());
  const [amount, setAmount] = React.useState(String(c0 ? c0.amount : rc.wht));
  const [note, setNote] = React.useState(c0 ? c0.note || "" : "");
  const [err, setErr] = React.useState("");
  const diff = Math.round((Number(amount) - rc.wht) * 100) / 100;
  const save = () => {
    setErr("");
    try { Workflow.setWhtCert(rc.id, { no, date, amount: Number(amount), note }); notify("บันทึกหนังสือรับรองหัก ณ ที่จ่ายของ " + rc.id + " แล้ว", "success"); onDone && onDone(); onClose(); }
    catch (e) { setErr(e && e.message ? e.message : String(e)); }
  };
  const remove = () => {
    if (!window.confirm("ลบหนังสือรับรองของ " + rc.id + " ? (จะกลับเป็นสถานะรอรับหนังสือ)")) return;
    try { Workflow.setWhtCert(rc.id, null); notify("ลบหนังสือรับรองแล้ว", "success"); onDone && onDone(); onClose(); } catch (e) { setErr(e && e.message ? e.message : String(e)); }
  };
  const lbl = { fontSize: 12, color: "var(--text-secondary)", fontWeight: 500, display: "block", margin: "10px 0 4px" };
  return (
    <ErpModal title={"หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) · " + rc.id} width={520} onClose={onClose}
      footer={<>{c0 && <button className="btn btn-ghost btn-sm" style={{ marginRight: "auto", color: "var(--danger)" }} onClick={remove}>ลบ</button>}<button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={save}>บันทึก</button></>}>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
        {rc.customerName} · ใบเสร็จวันที่ {rc.date} · ฐานภาษี {_fmt(rc.subtotal, 2)} · หัก {rc.whtRate}% = <b>{_fmt(rc.wht, 2)}</b> บาท
      </div>
      <label style={lbl}>เลขที่หนังสือรับรอง (จากลูกค้า) *</label>
      <input className="input" value={no} onChange={(e) => setNo(e.target.value)} placeholder="เลขที่ที่ระบุบนหนังสือ 50 ทวิ"/>
      <label style={lbl}>วันที่หนังสือ *</label>
      <DateInput className="input" value={date} onChange={(e) => setDate(e.target.value)}/>
      <label style={lbl}>ยอดภาษีที่ถูกหักตามหนังสือ (บาท) *</label>
      <input className="input num" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}/>
      {Math.abs(diff) > 0.005 && <div style={{ fontSize: 12, color: "var(--amber)", marginTop: 4 }}>ต่างจากยอดที่คำนวณ ({_fmt(rc.wht, 2)}) อยู่ {diff > 0 ? "+" : ""}{_fmt(diff, 2)} บาท — บันทึกได้ แต่ควรตรวจกับลูกค้า</div>}
      <label style={lbl}>หมายเหตุ</label>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)}/>
      {err && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

function WhtCertPanel() {
  useStore();
  const [status, setStatus] = React.useState("ALL");
  const [year, setYear] = React.useState("ALL");
  const [edit, setEdit] = React.useState(null);
  const role = Store.user() ? Store.user().role : null;
  const canEdit = role === "admin" || role === "accounting";
  const all = Store.state.docs.filter((d) => Workflow.whtCertStatus(d)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const years = [...new Set(all.map((d) => d.date.slice(0, 4)))].sort().reverse();
  const st = (d) => Workflow.whtCertStatus(d);
  const rows = all.filter((d) => (year === "ALL" || d.date.startsWith(year)) && (status === "ALL" || st(d).state === status));
  const wv = useListView(rows, {
    text: (d) => [d.id, d.customerName, d.whtCert ? d.whtCert.no : ""].join(" "), dateKey: (d) => d.date, dateLabel: "วันที่ใบเสร็จ", filterKey: status + "|" + year,
    sorts: { date: (d) => d.date, id: (d) => d.id, cust: (d) => d.customerName, base: (d) => d.subtotal, rate: (d) => d.whtRate, wht: (d) => d.wht, st: (d) => st(d).state, cert: (d) => (d.whtCert ? d.whtCert.no : "") },
    defaultSort: { key: "date", dir: "desc" },
  });
  const sum = (list, f) => list.reduce((t, d) => t + f(d), 0);
  const pending = all.filter((d) => st(d).state === "pending"), overdue = pending.filter((d) => st(d).overdue), received = all.filter((d) => st(d).state === "received");
  // เครดิตภาษีที่ได้รับหนังสือแล้ว สรุปรายเดือน (ตามวันที่หนังสือ)
  const byMonth = {};
  received.filter((d) => year === "ALL" || d.whtCert.date.startsWith(year)).forEach((d) => { const k = d.whtCert.date.slice(0, 7); (byMonth[k] = byMonth[k] || { n: 0, amt: 0 }); byMonth[k].n++; byMonth[k].amt += d.whtCert.amount; });
  const monthsSorted = Object.keys(byMonth).sort().reverse();
  const exportRows = () => exportCSV("ภาษีถูกหัก-50ทวิ.csv", ["วันที่ใบเสร็จ", "เลขที่ใบเสร็จ", "ลูกค้า", "ฐานภาษี", "อัตรา %", "ยอดที่ควรถูกหัก", "สถานะ", "เลขที่หนังสือ", "วันที่หนังสือ", "ยอดตามหนังสือ", "หมายเหตุ"],
    rows.map((d) => [d.date, d.id, d.customerName, d.subtotal, d.whtRate, d.wht, st(d).state === "received" ? "รับแล้ว" : "รอรับหนังสือ", d.whtCert ? d.whtCert.no : "", d.whtCert ? d.whtCert.date : "", d.whtCert ? d.whtCert.amount : "", d.whtCert ? d.whtCert.note : ""]));
  return (
    <div>
      <div className="grid-4" style={{ margin: "14px 0" }}>
        <SmallStat label="รอรับหนังสือ" value={pending.length + " ใบ · " + baht(sum(pending, (d) => d.wht))} tone="amber" icon="Clock"/>
        <SmallStat label={"เกินกำหนด " + Workflow.WHT_CERT_DAYS + " วัน"} value={overdue.length + " ใบ · " + baht(sum(overdue, (d) => d.wht))} tone="accent" icon="Alert"/>
        <SmallStat label="รับหนังสือแล้ว" value={received.length + " ใบ · " + baht(sum(received, (d) => d.whtCert.amount))} tone="success" icon="Check"/>
        <SmallStat label="ภาษีถูกหักทั้งหมด (ตามใบเสร็จ)" value={baht(sum(all, (d) => d.wht))} tone="violet" icon="Wallet"/>
      </div>
      <div className="card">
        <div style={{ padding: "12px 16px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select className="input" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ALL">ทุกสถานะ</option><option value="pending">รอรับหนังสือ</option><option value="received">รับแล้ว</option>
          </select>
          <select className="input" style={{ width: 130 }} value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="ALL">ทุกปี</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="spacer"/>
          <button className="btn btn-outline btn-sm" disabled={!rows.length} onClick={exportRows}><I.Download size={14}/> ส่งออก CSV</button>
        </div>
        <ListToolbar view={wv} placeholder="ค้นหาใบเสร็จ / ลูกค้า / เลขหนังสือ…"/>
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead><tr><SortTh view={wv} k="date">วันที่</SortTh><SortTh view={wv} k="id">ใบเสร็จ</SortTh><SortTh view={wv} k="cust">ลูกค้า</SortTh><SortTh view={wv} k="base" className="num">ฐานภาษี</SortTh><SortTh view={wv} k="rate" className="num">หัก %</SortTh><SortTh view={wv} k="wht" className="num">ภาษีที่ควรถูกหัก</SortTh><SortTh view={wv} k="st">สถานะ</SortTh><SortTh view={wv} k="cert">หนังสือรับรอง</SortTh><th></th></tr></thead>
            <tbody>
              {wv.pageRows.map((d) => {
                const w = st(d);
                return (
                  <tr key={d.id}>
                    <td>{d.date}</td><td className="mono"><b>{d.id}</b></td><td>{d.customerName}</td>
                    <td className="num">{_fmt(d.subtotal, 2)}</td><td className="num">{d.whtRate}%</td><td className="num"><b>{_fmt(d.wht, 2)}</b></td>
                    <td>{w.state === "received" ? <span className="badge badge-success"><span className="b-dot"/>รับแล้ว</span>
                      : <span className={"badge " + (w.overdue ? "badge-danger" : "badge-warning")}><span className="b-dot"/>รอรับ {w.days} วัน{w.overdue ? " · เกินกำหนด" : ""}</span>}</td>
                    <td style={{ fontSize: 12 }}>{d.whtCert ? <><div className="mono">{d.whtCert.no}</div><div style={{ color: "var(--text-tertiary)" }}>{d.whtCert.date} · {_fmt(d.whtCert.amount, 2)}{Math.abs(d.whtCert.amount - d.wht) > 0.005 ? " ⚠ ต่างจากที่คำนวณ" : ""}</div></> : <span style={{ color: "var(--text-tertiary)" }}>—</span>}</td>
                    <td>{canEdit && <button className="btn btn-outline btn-sm" onClick={() => setEdit(d)}>{d.whtCert ? "แก้ไข" : "บันทึกหนังสือ"}</button>}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={9} style={{ textAlign: "center", padding: 28, color: "var(--text-tertiary)" }}>ไม่มีใบเสร็จที่ลูกค้าหัก ณ ที่จ่าย{all.length ? " ตามตัวกรองนี้" : " (เลือกอัตราหัก ณ ที่จ่ายในใบกำกับ/ใบเสร็จ แล้วจะมีรายการที่นี่)"}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager view={wv}/>
      </div>
      {monthsSorted.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-head"><div><div className="card-title">สรุปเครดิตภาษีที่ได้รับหนังสือแล้ว (รายเดือน ตามวันที่หนังสือ)</div><div className="card-sub">ใช้เป็นเครดิตภาษีตอนยื่น ภงด.50/51</div></div></div>
          <table className="table"><thead><tr><th>เดือน</th><th className="num">จำนวนฉบับ</th><th className="num">ภาษีที่ถูกหัก (บาท)</th></tr></thead>
            <tbody>{monthsSorted.map((k) => <tr key={k}><td>{monthLabel(k)}</td><td className="num">{byMonth[k].n}</td><td className="num"><b>{_fmt(byMonth[k].amt, 2)}</b></td></tr>)}
              <tr style={{ background: "var(--bg-subtle)" }}><td><b>รวม</b></td><td className="num"><b>{monthsSorted.reduce((t, k) => t + byMonth[k].n, 0)}</b></td><td className="num"><b>{_fmt(monthsSorted.reduce((t, k) => t + byMonth[k].amt, 0), 2)}</b></td></tr></tbody></table>
        </div>
      )}
      {edit && <WhtCertModal rc={Store.state.docs.find((x) => x.id === edit.id) || edit} onClose={() => setEdit(null)}/>}
    </div>
  );
}
window.WhtCertModal = WhtCertModal;

if (!window.SmallStat) window.SmallStat = SmallStat;
if (!window.PLPanel) window.PLPanel = PLPanel;
if (!window.ReportCard) window.ReportCard = ReportCard;

})();