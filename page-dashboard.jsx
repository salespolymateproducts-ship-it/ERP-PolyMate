/* global React, I, AreaChart, Donut, PageHeader, Store, useStore, Workflow, Analytics, buildNotifications, exportCSV,
   DocBadge, DocStatusBadge, WO_STATUS, StatusBadge, baht, _fmt, EmptyRow */

// แดชบอร์ด — ทุกตัวเลขคำนวณจากข้อมูลจริงใน Store
function PageDashboard({ role }) {
  useStore();
  const S = Store.state;
  const today = Store.today();
  const ym = today.slice(0, 7);
  const prevYm = Analytics.lastMonths(2)[0].ym;
  const cur = Analytics.month(ym), prev = Analytics.month(prevYm);
  const prod = Analytics.productionOn(today);
  const trend = Analytics.trend(6);
  const top = Analytics.topCustomers(today.slice(0, 4));
  const notes = buildNotifications(role);
  const aging = Analytics.arAging();
  const ar = aging.current + aging.d30 + aging.d60 + aging.d90;
  const openWO = S.workOrders.filter((w) => !["done", "cancelled"].includes(w.status));
  const salesToday = Analytics.invoices().filter((d) => d.date === today).reduce((s, d) => s + d.subtotal, 0);
  const delta = (a, b) => (b ? ((a - b) / b * 100).toFixed(1) + "%" : "—");

  const kpis = [
    { label: "ยอดขายวันนี้ (ใบกำกับภาษี)", value: baht(salesToday), icon: "Wallet", color: "accent", sub: `เดือนนี้ ${baht(cur.revenue)} · เทียบเดือนก่อน ${delta(cur.revenue, prev.revenue)}` },
    { label: "ยอดผลิตวันนี้", value: _fmt(prod.produced), unit: "ชิ้น", icon: "Factory", color: "violet", sub: `ใบสั่งผลิตที่เปิดอยู่ ${openWO.length} ใบ` },
    { label: "กำไรขั้นต้นเดือนนี้", value: baht(cur.gp), icon: "TrendUp", color: "success", sub: cur.revenue ? `Margin ${(cur.gp / cur.revenue * 100).toFixed(1)}%` : "ยังไม่มียอดขาย" },
    { label: "ของเสีย (NG) วันนี้", value: prod.ngRate.toFixed(2), unit: "%", icon: "Alert", color: "amber", sub: `${_fmt(prod.ng)} ชิ้น จาก ${_fmt(prod.produced)}` },
  ];
  const colorVar = { accent: "var(--accent)", violet: "var(--violet)", success: "var(--success)", amber: "var(--amber)" };
  const subVar = { accent: "var(--accent-subtle)", violet: "var(--violet-subtle)", success: "var(--success-subtle)", amber: "var(--amber-subtle)" };
  const colors = ["#2D6CDF", "#7C3AED", "#0EA5C7", "#F59E0B", "#16A34A"];

  function exportSummary() {
    exportCSV(`dashboard-${today}.csv`, ["เดือน", "ยอดขาย (ก่อน VAT)", "ต้นทุนขาย", "ค่าใช้จ่ายดำเนินงาน", "กำไรขั้นต้น"],
      Analytics.lastMonths(12).map((m) => { const x = Analytics.month(m.ym); return [m.ym, x.revenue, x.cogs, x.opex, x.gp]; }));
  }

  return (
    <>
      <PageHeader title="แดชบอร์ดภาพรวม" subtitle={`ข้อมูลจากระบบ ณ ${Store.now().slice(0, 16)} น.`}
        actions={<><button className="btn btn-outline btn-sm" onClick={() => printReport("แดชบอร์ดภาพรวม")}><I.Printer size={14}/> พิมพ์ / PDF</button><button className="btn btn-outline btn-sm" onClick={exportSummary}><I.Download size={14}/> ส่งออกสรุป 12 เดือน</button></>}/>

      <div className="kpi-grid">
        {kpis.map((k, i) => {
          const Ico = I[k.icon];
          return (
            <div className="kpi" key={i}>
              <div className="kpi-label"><span className="kpi-ico" style={{ background: subVar[k.color], color: colorVar[k.color] }}><Ico size={14}/></span>{k.label}</div>
              <div className="kpi-value">{k.value}{k.unit && <span className="kpi-unit"> {k.unit}</span>}</div>
              <div className="kpi-foot"><span>{k.sub}</span></div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.7fr) minmax(0, 1fr)", gap: 14, marginTop: 14 }}>
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">ยอดขาย vs ต้นทุน · 6 เดือนล่าสุด</div><div className="card-sub">หน่วย: ล้านบาท · ยอดขายจากใบกำกับภาษีที่อนุมัติ, ต้นทุน = ต้นทุนขาย + ค่าใช้จ่ายดำเนินงาน</div></div>
          </div>
          <div className="card-body" style={{ padding: 12 }}><AreaChart data={trend} keys={["revenue", "cost"]} unit="M"/></div>
        </div>
        <div className="card">
          <div className="card-head"><div><div className="card-title">ลูกค้าซื้อสูงสุด · ปี {today.slice(0, 4)}</div><div className="card-sub">ส่วนแบ่งยอดขาย</div></div></div>
          <div className="card-body">
            {top.length ? (
              <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                <Donut data={top.map((c) => ({ value: c.value }))} size={150} thickness={20}/>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  {top.map((c, i) => (
                    <div key={c.code} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: colors[i] }}/>
                      <span style={{ flex: 1, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                      <span className="num" style={{ fontWeight: 500 }}>{c.share}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <div style={{ color: "var(--text-tertiary)", fontSize: 13, padding: 20, textAlign: "center" }}>ยังไม่มีใบกำกับภาษีที่อนุมัติในปีนี้</div>}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 14, marginTop: 14 }}>
        <div className="card">
          <div className="card-head"><div><div className="card-title">สถานะเครื่องจักร</div>
            <div className="card-sub">{S.machines.filter((m) => m.condition !== "retired").length} เครื่อง · {S.machines.filter((m) => m.status === "running").length} กำลังผลิต · {S.machines.filter((m) => m.condition === "maintenance").length} ซ่อมบำรุง · {S.machines.filter((m) => m.condition === "due").length} ควรซ่อมบำรุง</div></div></div>
          <div className="grid-3" style={{ padding: 14 }}>
            {S.machines.filter((m) => m.condition !== "retired").map((m) => {
              const wo = S.workOrders.find((w) => w.machine === m.id && ["running", "setup"].includes(w.status)) || S.workOrders.find((w) => w.id === m.workOrder);
              const pct = wo ? Math.min(100, Math.round(((wo.produced - wo.ng) / wo.quantity) * 100)) : 0;
              const meta = ({ running: { tone: "var(--success)", label: "กำลังผลิต" }, setup: { tone: "var(--amber)", label: "ตั้งเครื่อง" },
                idle: { tone: "var(--text-tertiary)", label: "ว่าง" }, maintenance: { tone: "var(--danger)", label: "ซ่อมบำรุง" }, due: { tone: "var(--amber)", label: "ควรซ่อมบำรุง" } })[m.condition === "maintenance" ? "maintenance" : (m.condition === "due" && m.status !== "running") ? "due" : (["running", "setup"].includes(m.status) ? m.status : "idle")] || { tone: "var(--text-tertiary)", label: "ว่าง" };   // สถานะ "ซ่อมบำรุง" ดูจากสภาพเครื่อง (condition) เท่านั้น ให้ตรงหน้าเครื่องจักร
              return (
                <div key={m.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 12.5 }}>{m.id}</span><span className="spacer"/>
                    <span style={{ fontSize: 11, color: meta.tone, fontWeight: 500 }}>{meta.label}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 6 }}>{m.name.split("—")[1] ? m.name.split("—")[1].trim() : m.name} · {m.tonnage}T</div>
                  {wo ? (<>
                    <div style={{ fontSize: 12, marginTop: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><b>{wo.id}</b> · {wo.product}</div>
                    <div style={{ height: 6, background: "var(--bg-subtle)", borderRadius: 99, overflow: "hidden", marginTop: 8 }}><div style={{ width: pct + "%", height: "100%", background: meta.tone }}/></div>
                    <div className="num" style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>{_fmt(wo.produced)} / {_fmt(wo.quantity)} ชิ้น · {pct}%</div>
                  </>) : <div style={{ marginTop: 12, fontSize: 11.5, color: "var(--text-tertiary)" }}>ไม่มีงาน</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div><div className="card-title">สิ่งที่ต้องดำเนินการ</div><div className="card-sub">{notes.length} รายการ</div></div></div>
          <div style={{ maxHeight: 380, overflow: "auto" }}>
            {notes.slice(0, 12).map((n) => {
              const Ico = I[n.icon] || I.Bell;
              const tone = ({ alert: "var(--danger)", warning: "var(--amber)", info: "var(--accent)", success: "var(--success)" })[n.kind];
              return (
                <div key={n.id} style={{ display: "flex", gap: 12, padding: "10px 18px", borderBottom: "1px solid var(--border)" }}>
                  <Ico size={15} style={{ color: tone, flexShrink: 0, marginTop: 2 }}/>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, lineHeight: 1.45 }}>{n.title}</div><div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 3 }}>{n.time}</div></div>
                </div>
              );
            })}
            {!notes.length && <div style={{ padding: 30, textAlign: "center", fontSize: 13, color: "var(--text-tertiary)" }}>ไม่มีรายการค้าง</div>}
          </div>
          <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", fontSize: 12.5 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>ลูกหนี้คงค้าง {baht(ar, 2)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, color: "var(--text-secondary)" }}>
              <span>ยังไม่ครบกำหนด<br/><b className="num">{_fmt(aging.current)}</b></span><span>1–30 วัน<br/><b className="num">{_fmt(aging.d30)}</b></span>
              <span>31–60 วัน<br/><b className="num">{_fmt(aging.d60)}</b></span><span style={{ color: aging.d90 ? "var(--danger)" : undefined }}>60+ วัน<br/><b className="num">{_fmt(aging.d90)}</b></span>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><div><div className="card-title">เอกสารขายล่าสุด</div><div className="card-sub">10 รายการล่าสุด</div></div></div>
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead><tr><th>เลขที่</th><th>ประเภท</th><th>ลูกค้า</th><th>วันที่</th><th className="num">ยอดรวม</th><th>สถานะ</th></tr></thead>
            <tbody>
              {S.docs.slice(0, 10).map((d) => (
                <tr key={d.id}><td className="mono"><b>{d.id}</b></td><td><DocBadge type={d.type}/></td><td>{d.customerName}</td><td className="num">{d.date}</td>
                  <td className="num">{_fmt(d.total, 2)}</td><td><DocStatusBadge doc={d}/></td></tr>
              ))}
              {!S.docs.length && <EmptyRow cols={6} text="ยังไม่มีเอกสาร"/>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

window.PageDashboard = PageDashboard;
