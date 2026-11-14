/* global React, I, PageHeader, Tabs, Store, useStore, Workflow, ShipModal, DocDrawer, DocStatusBadge, exportCSV, EmptyRow, _fmt */

/*
  การจัดส่งสินค้า — ติดตามจากใบส่งสินค้า (DO) จริง
  ใบส่งสินค้าที่อนุมัติแล้ว (ตัดสต๊อกแล้ว) → ออกจัดส่ง (เลือกรถ) → ส่งถึงลูกค้า (ชื่อผู้รับ)
  การเปิดใบส่งสินค้าทำจากใบสั่งขายในเมนู "เอกสารขาย" เพื่อไม่ต้องกรอกข้อมูลซ้ำ
*/
const SHIP_LABEL = { waiting: { th: "รอจัดส่ง", color: "warning" }, "in-transit": { th: "กำลังจัดส่ง", color: "info" }, delivered: { th: "ส่งถึงแล้ว", color: "success" } };

function PageShipping({ role }) {
  useStore();
  const [tab, setTab] = useState("ACTIVE");
  const [ship, setShip] = useState(null); // { id, to }
  const [openId, setOpenId] = useState(null);
  const canShip = role && (role.canEdit === "*" || (role.canEdit || []).includes("shipping") || (role.canEdit || []).includes("sales"));
  const dos = Store.state.docs.filter((d) => d.type === "DO" && d.status !== "draft" && d.status !== "pending" && d.status !== "cancelled");
  const drafts = Store.state.docs.filter((d) => d.type === "DO" && (d.status === "draft" || d.status === "pending"));
  const st = (d) => (d.ship && d.ship.status) || "waiting";
  const today = Store.today();
  const counts = { waiting: dos.filter((d) => st(d) === "waiting").length, transit: dos.filter((d) => st(d) === "in-transit").length,
    deliveredToday: dos.filter((d) => st(d) === "delivered" && String(d.ship.deliveredAt).slice(0, 10) === today).length };
  const list = tab === "ACTIVE" ? dos.filter((d) => st(d) !== "delivered") : tab === "DONE" ? dos.filter((d) => st(d) === "delivered") : tab === "DRAFT" ? drafts : dos;
  const qty = (d) => (d.lines || []).reduce((s, l) => s + (Number(l.qty) || 0), 0);

  return (
    <>
      <PageHeader title="การจัดส่งสินค้า" subtitle="ติดตามใบส่งสินค้าที่อนุมัติแล้ว · ออกจัดส่ง · ยืนยันส่งถึง (เปิดใบส่งสินค้าจากใบสั่งขายในเมนูเอกสารขาย)"
        actions={<><button className="btn btn-outline btn-sm" onClick={() => printReport("รายงานการจัดส่งสินค้า")}><I.Printer size={14}/> พิมพ์ / PDF</button><button className="btn btn-outline btn-sm" disabled={!list.length} onClick={() => exportCSV(`การจัดส่ง-${today}.csv`,
          ["ใบส่งสินค้า", "ลูกค้า", "วันที่", "อ้างอิง", "จำนวนรวม", "สถานะจัดส่ง", "รถ/ผู้ขนส่ง", "ออกจัดส่ง", "ส่งถึง", "ผู้รับ"],
          list.map((d) => [d.id, d.customerName, d.date, (d.sourceIds || []).join(" "), qty(d), (SHIP_LABEL[st(d)] || {}).th, (d.ship || {}).vehicle, (d.ship || {}).shippedAt, (d.ship || {}).deliveredAt, (d.ship || {}).receivedBy]))}>
          <I.Download size={14}/> ส่งออก CSV</button></>}/>

      <div className="grid-4" style={{ marginBottom: 14 }}>
        <ShipKpi icon="Clock" tone="amber" label="รอจัดส่ง" value={counts.waiting}/>
        <ShipKpi icon="Truck" tone="accent" label="กำลังจัดส่ง" value={counts.transit}/>
        <ShipKpi icon="Check" tone="success" label="ส่งถึงวันนี้" value={counts.deliveredToday}/>
        <ShipKpi icon="FileText" tone="violet" label="ใบส่งสินค้ารออนุมัติ" value={drafts.length}/>
      </div>

      <div className="card">
        <div style={{ padding: "12px 16px 0" }}>
          <Tabs value={tab} onChange={setTab} items={[
            { id: "ACTIVE", label: "ต้องดำเนินการ", count: counts.waiting + counts.transit },
            { id: "DONE", label: "ส่งถึงแล้ว", count: dos.length - counts.waiting - counts.transit },
            { id: "DRAFT", label: "รออนุมัติ (ยังไม่ตัดสต๊อก)", count: drafts.length },
            { id: "ALL", label: "ทั้งหมด", count: dos.length },
          ]}/>
        </div>
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead><tr><th>ใบส่งสินค้า</th><th>ลูกค้า</th><th>วันที่</th><th>อ้างอิง</th><th className="num">จำนวนรวม</th><th>สถานะจัดส่ง</th><th>รถ / ผู้รับ</th><th></th></tr></thead>
            <tbody>
              {list.map((d) => {
                const s = st(d); const live = Workflow.isLive(d);
                return (
                  <tr key={d.id}>
                    <td className="mono" style={{ cursor: "pointer" }} onClick={() => setOpenId(d.id)}><b>{d.id}</b></td>
                    <td>{d.customerName}</td><td className="num">{d.date}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{(d.sourceIds || []).join(", ") || "—"}</td>
                    <td className="num">{_fmt(qty(d))}</td>
                    <td>{live ? <span className={"badge badge-" + SHIP_LABEL[s].color}>{SHIP_LABEL[s].th}</span> : <DocStatusBadge doc={d}/>}</td>
                    <td style={{ fontSize: 12 }}>{d.ship && d.ship.vehicle ? d.ship.vehicle : "—"}{d.ship && d.ship.receivedBy ? <div style={{ color: "var(--success)" }}>รับโดย {d.ship.receivedBy}</div> : null}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {live && canShip && s === "waiting" && <button className="btn btn-primary btn-sm" onClick={() => setShip({ id: d.id, to: "in-transit" })}><I.Truck size={13}/> ออกจัดส่ง</button>}
                      {live && canShip && s === "in-transit" && <button className="btn btn-primary btn-sm" onClick={() => setShip({ id: d.id, to: "delivered" })}><I.Check size={13}/> ยืนยันส่งถึง</button>}
                      <button className="btn btn-ghost btn-sm" onClick={() => setOpenId(d.id)}><I.Eye size={13}/> เปิด</button>
                    </td>
                  </tr>
                );
              })}
              {!list.length && <EmptyRow cols={8} text="ไม่มีรายการ"/>}
            </tbody>
          </table>
        </div>
      </div>
      {ship && <ShipModal doc={Workflow.get(ship.id)} to={ship.to} onClose={() => setShip(null)}/>}
      {openId && <DocDrawer id={openId} onClose={() => setOpenId(null)} onOpen={setOpenId}
        onEdit={() => notify("แก้ไขเอกสารได้ที่เมนู เอกสารขาย", "info")} onConvert={() => notify("สร้างเอกสารถัดไปได้ที่เมนู เอกสารขาย", "info")}/>}
    </>
  );
}

function ShipKpi({ icon, tone, label, value }) {
  const Ico = I[icon];
  return (
    <div className="card" style={{ padding: 14, display: "flex", gap: 10, alignItems: "center" }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: `var(--${tone}-subtle)`, color: `var(--${tone})`, display: "grid", placeItems: "center" }}><Ico size={15}/></div>
      <div><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</div><div className="num" style={{ fontSize: 18, fontWeight: 600 }}>{_fmt(value)}</div></div>
    </div>
  );
}

window.PageShipping = PageShipping;
