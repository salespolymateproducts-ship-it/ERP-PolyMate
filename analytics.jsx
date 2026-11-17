/* global Store, Workflow */
/* PolyMate ERP — ตัวเลขสรุปสำหรับแดชบอร์ด / บัญชี / รายงาน (คำนวณจากข้อมูลจริงใน Store ทุกครั้ง) */
const Analytics = (function () {
  const S = Store;
  const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const r2 = (n) => Math.round(n * 100) / 100;
  function lastMonths(n) {
    const d = new Date(S.today() + "T00:00:00"); const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push({ ym: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`, label: TH_M[x.getMonth()] });
    }
    return out;
  }
  const invoices = () => S.state.docs.filter((d) => d.type === "INV" && Workflow.isLive(d));
  function unitCost(code) {
    const f = S.state.finished.find((x) => x.code === code); if (f) return f.cost || 0;
    const m = S.state.materials.find((x) => x.code === code); return m ? m.cost || 0 : 0;
  }
  // ต้นทุนต่อหน่วยของรายการเอกสาร: ใช้ต้นทุน ณ วันส่ง (unitCost ที่ใบส่งสินค้าบันทึกไว้ ตามสายเอกสารต้นทาง) — เอกสารเก่าที่ไม่มีค่านี้ใช้ต้นทุนปัจจุบัน
  function lineCost(l, depth) {
    if (l.unitCost != null) return Number(l.unitCost) || 0;
    if (l.src && (depth || 0) < 5) {
      const sd = S.state.docs.find((d) => d.id === l.src.doc);
      const sl = sd && (sd.lines || [])[l.src.line];
      if (sl) return lineCost(sl, (depth || 0) + 1);
    }
    return unitCost(l.code);
  }
  // ต้นทุนขายของใบกำกับภาษี = จำนวน × ต้นทุน ณ วันส่ง
  function cogsOf(inv) { return r2((inv.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * lineCost(l), 0)); }
  function month(ym) {
    const inv = invoices().filter((d) => d.date.slice(0, 7) === ym);
    const exps = S.state.expenses.filter((e) => e.status !== "cancelled" && (e.date || "").slice(0, 7) === ym);
    const revenue = r2(inv.reduce((s, d) => s + d.subtotal, 0));
    const cogs = r2(inv.reduce((s, d) => s + cogsOf(d), 0));
    const opex = r2(exps.filter((e) => e.category !== "วัตถุดิบ" && e.category !== "สีผสม").reduce((s, e) => s + (e.amount || 0), 0));
    const salesVat = r2(inv.filter((d) => d.vatOn).reduce((s, d) => s + d.vat, 0));
    const purchaseVat = r2(exps.reduce((s, e) => s + (e.vat || 0), 0));
    return { ym, revenue, cogs, opex, gp: r2(revenue - cogs), ebit: r2(revenue - cogs - opex), salesVat, purchaseVat, invoices: inv, expenses: exps };
  }
  function trend(n = 6) { return lastMonths(n).map((m) => { const x = month(m.ym); return { m: m.label, ym: m.ym, revenue: x.revenue / 1e6, cost: (x.cogs + x.opex) / 1e6 }; }); }
  function topCustomers(year, n = 5) {
    const by = {};
    invoices().filter((d) => d.date.slice(0, 4) === String(year)).forEach((d) => { by[d.customer] = (by[d.customer] || 0) + d.subtotal; });
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    return Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, n).map(([code, value]) => {
      const c = S.state.customers.find((x) => x.code === code);
      return { code, name: c ? (c.nameEn || c.name) : code, value, share: total ? Math.round(value / total * 100) : 0 };
    });
  }
  function customerStats(code) {
    const inv = invoices().filter((d) => d.customer === code);
    const year = S.today().slice(0, 4);
    let outstanding = 0; inv.forEach((d) => { outstanding += Workflow.paymentInfo(d).outstanding; });
    return { total: r2(inv.reduce((s, d) => s + d.subtotal, 0)), ytd: inv.filter((d) => d.date.slice(0, 4) === year).length,
      outstanding: r2(outstanding), docs: S.state.docs.filter((d) => d.customer === code).length };
  }
  function productionOn(day) {
    let produced = 0, ng = 0;
    S.state.workOrders.forEach((w) => (w.logs || []).forEach((l) => { if (String(l.at).slice(0, 10) === day) { produced += l.produced; ng += l.ng; } }));
    return { produced, ng, ngRate: produced ? ng / produced * 100 : 0 };
  }
  function arAging() {
    const today = new Date(S.today() + "T00:00:00");
    const b = { current: 0, d30: 0, d60: 0, d90: 0 };
    invoices().forEach((d) => {
      const o = Workflow.paymentInfo(d).outstanding; if (!o) return;
      const days = d.due && d.due !== "—" ? Math.floor((today - new Date(d.due + "T00:00:00")) / 864e5) : 0;
      if (days <= 0) b.current += o; else if (days <= 30) b.d30 += o; else if (days <= 60) b.d60 += o; else b.d90 += o;
    });
    return b;
  }
  return { lastMonths, month, trend, topCustomers, customerStats, productionOn, cogsOf, arAging, invoices, TH_M };
})();
window.Analytics = Analytics;
