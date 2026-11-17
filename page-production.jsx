/* global React, I, WORK_ORDERS, WO_STATUS, MACHINES, MOLDS, MATERIALS, FINISHED, CUSTOMERS, DELIVERY_STATUS, Store, useStore, Workflow, StatusBadge, PageHeader, Drawer, Tabs, baht, _fmt, runAction, printDoc, ReasonModal, DocStatusBadge, EmptyRow */

function PageProduction() {
  const [tab, setTab] = useState("BOARD");
  const [openWO, setOpenWO] = useState(() => { const id = window.takeFocus("wo"); return id ? WORK_ORDERS.find((w) => w.id === id) || null : null; });
  const [cancelWO, setCancelWO] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState(null);
  useStore();
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  // keep the open drawer in sync with the live record after edits
  const liveWO = openWO ? WORK_ORDERS.find((w) => w.id === openWO.id) || openWO : null;

  return (
    <>
      <PageHeader
        title="ใบสั่งผลิต (Work Orders)"
        subtitle="วางแผน · มอบหมายเครื่อง · ติดตามจำนวนผลิต · บันทึก NG · คำนวณต้นทุนอัตโนมัติ"
        actions={
          <>
            <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}><I.Plus size={14}/> เปิดใบสั่งผลิต</button>
          </>
        }
      />

      <Tabs
        items={[
          { id: "BOARD", label: "Kanban" },
          { id: "LIST", label: "รายการทั้งหมด", count: WORK_ORDERS.length },
          { id: "MACHINE", label: "สถานะเครื่องจักร", count: MACHINES.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "BOARD" && <KanbanBoard onOpen={setOpenWO}/>}
      {tab === "LIST"  && <WorkOrderList onOpen={setOpenWO}/>}
      {tab === "MACHINE" && <MachineGrid/>}

      <Drawer
        open={!!openWO}
        onClose={() => setOpenWO(null)}
        title={liveWO ? `ใบสั่งผลิต · ${liveWO.id}` : ""}
        width={820}
        footer={
          liveWO && (
            <>
              <button className="btn btn-outline btn-sm" onClick={() => printDoc(liveWO.id)}><I.Printer size={13}/> พิมพ์ใบงาน</button>
              {!["done", "cancelled"].includes(liveWO.status) && <button className="btn btn-outline btn-sm" onClick={() => runAction(() => Store.update("workOrders", liveWO.id, { status: liveWO.status === "hold" ? (liveWO.produced ? "running" : "queued") : "hold" }, "id", liveWO.status === "hold" ? "กลับมาผลิตต่อ" : "พักงาน"))}>{liveWO.status === "hold" ? "ผลิตต่อ" : "พักงาน"}</button>}
              {!["done", "cancelled"].includes(liveWO.status) && !liveWO.produced && <button className="btn btn-outline btn-sm" style={{ color: "var(--danger)" }} onClick={() => setCancelWO(liveWO.id)}>ยกเลิกใบสั่งผลิต</button>}
              {liveWO.status === "cancelled" && <span className="badge badge-danger">ยกเลิก: {liveWO.cancel && liveWO.cancel.reason}</span>}
              <span className="spacer"/>
              {liveWO.status === "cancelled" ? null : liveWO.status === "done"
                ? <span className="badge badge-success" style={{ padding: "6px 12px" }}><I.Check size={13}/> ปิดงานแล้ว</span>
                : <button className="btn btn-primary btn-sm" onClick={() => { Store.update("workOrders", liveWO.id, { status: "done", closedAt: Store.now(), closedBy: Store.userName() }, "id", "ปิดงาน"); showToast(`ปิดงาน ${liveWO.id} เรียบร้อย`); }}>ปิดงาน (Close WO)</button>}
            </>
          )
        }
      >
        {liveWO && <div className="print-area" style={{ background: "var(--bg-elevated)" }}><div style={{ padding: "0 20px" }}><PrintHead title="ใบสั่งผลิต" en="Work Order" no={liveWO.id} date={liveWO.date || ""}/></div><WorkOrderDetail wo={liveWO} onProduce={showToast}/></div>}
      </Drawer>

      <Drawer open={addOpen} onClose={() => setAddOpen(false)} title="เปิดใบสั่งผลิตใหม่ (Work Order)" width={680}>
        {addOpen && <AddWorkOrderForm
          onCancel={() => setAddOpen(false)}
          onSubmit={(rec) => { Store.add("workOrders", rec); setAddOpen(false); showToast(`เปิดใบสั่งผลิต ${rec.id} เรียบร้อย`); }}
        />}
      </Drawer>

      {cancelWO && <ReasonModal title={"ยกเลิกใบสั่งผลิต " + cancelWO} label="เหตุผลการยกเลิก" danger confirmLabel="ยกเลิกใบสั่งผลิต" onClose={() => setCancelWO(null)}
        onConfirm={(r) => { if (runAction(() => Store.update("workOrders", cancelWO, { status: "cancelled", cancel: { reason: r, by: Store.userName(), at: Store.now() } }, "id", "ยกเลิก: " + r), "ยกเลิกใบสั่งผลิตแล้ว")) setCancelWO(null); }}/>}

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 100,
          background: "var(--text-primary)", color: "white", padding: "12px 18px",
          borderRadius: 10, boxShadow: "var(--shadow-lg)", fontSize: 13, fontWeight: 500,
          display: "flex", alignItems: "center", gap: 10, maxWidth: 440,
        }}>
          <I.Check size={16}/> {toast}
        </div>
      )}
    </>
  );
}

function KanbanBoard({ onOpen }) {
  const cols = [
    { id: "queued", title: "รอผลิต", tone: "var(--text-secondary)" },
    { id: "setup", title: "ตั้งเครื่อง", tone: "var(--amber)" },
    { id: "running", title: "กำลังผลิต", tone: "var(--accent)" },
    { id: "done", title: "เสร็จแล้ว", tone: "var(--success)" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
      {cols.map((col) => {
        const items = WORK_ORDERS.filter((w) => w.status === col.id);
        return (
          <div key={col.id} style={{ background: "var(--bg-subtle)", borderRadius: 12, padding: 10, minHeight: 360 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px 10px" }}>
              <span style={{ width: 10, height: 10, borderRadius: 99, background: col.tone, boxShadow: `0 0 0 3px ${col.tone}22` }} />
              <span style={{ fontWeight: 600, fontSize: 13 }}>{col.title}</span>
              <span className="badge badge-neutral" style={{ marginLeft: "auto" }}>{items.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((w) => {
                const pct = Math.round((w.produced / w.quantity) * 100);
                return (
                  <div key={w.id} onClick={() => onOpen(w)} style={{
                    background: "var(--bg-elevated)", border: "1px solid var(--border)",
                    borderRadius: 10, padding: 12, cursor: "pointer",
                    boxShadow: "var(--shadow-xs)"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="mono" style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>{w.id}</span>
                      <span className="spacer" />
                      {["queued", "setup", "running"].includes(w.status) && Store.woShortage(w).anyShort && <span className="badge badge-danger" title="วัตถุดิบไม่พอ ผลิตไม่ได้จนกว่าจะเพิ่มสต๊อก">ขาดวัตถุดิบ</span>}
                      {w.priority === "high" && <span className="badge badge-danger">ด่วน</span>}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6, lineHeight: 1.3 }}>{w.product}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 2 }}>{w.customerName}</div>

                    <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span className="badge badge-neutral"><I.Factory size={11}/> {w.machine}</span>
                      <span className="badge badge-neutral"><I.Mold size={11}/> {w.cavities}c · {w.cycleTime}s</span>
                    </div>

                    {(w.status === "running" || w.status === "done") && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ height: 5, background: "var(--bg-subtle)", borderRadius: 99, overflow: "hidden" }}>
                          <div style={{ width: pct + "%", height: "100%", background: w.status === "done" ? "var(--success)" : "var(--accent)" }} />
                        </div>
                        <div className="num" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                          <span>{_fmt(w.produced)} / {_fmt(w.quantity)}</span>
                          <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>{pct}%</span>
                        </div>
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 10, display: "flex", alignItems: "center", gap: 4 }}>
                      <I.Clock size={11}/> กำหนดส่ง {w.due}
                      {w.deliverySchedule && w.deliverySchedule.length > 1 && (
                        <span style={{ marginLeft: "auto", color: "var(--accent)" }}>
                          <I.Truck size={11} style={{ verticalAlign: "middle" }}/> {w.deliverySchedule.filter(d=>d.shipped>=d.qty).length}/{w.deliverySchedule.length} งวด
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WorkOrderList({ onOpen }) {
  return (
    <div className="card">
      <div style={{ overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>เลขที่</th>
              <th>สินค้า / ลูกค้า</th>
              <th>เครื่อง / แม่พิมพ์</th>
              <th>Cavity / Cycle</th>
              <th className="num">เป้าหมาย</th>
              <th className="num">ผลิตแล้ว</th>
              <th className="num">NG</th>
              <th>สถานะ</th>
              <th>กำหนดส่ง</th>
            </tr>
          </thead>
          <tbody>
            {WORK_ORDERS.map((w) => {
              const pct = Math.round((w.produced / w.quantity) * 100);
              const ngPct = w.produced ? (w.ng / w.produced) * 100 : 0;
              return (
                <tr key={w.id} onClick={() => onOpen(w)} style={{ cursor: "pointer" }}>
                  <td className="mono"><b style={{ color: "var(--text-primary)" }}>{w.id}</b>{["queued", "setup", "running"].includes(w.status) && Store.woShortage(w).anyShort && <span className="badge badge-danger" style={{ marginLeft: 6 }}>ขาดวัตถุดิบ</span>}{w.priority === "high" && <span className="badge badge-danger" style={{ marginLeft: 6 }}>ด่วน</span>}</td>
                  <td>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{w.product}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{w.customerName}</div>
                  </td>
                  <td>
                    <span className="badge badge-neutral">{w.machine}</span>
                    <span className="badge badge-neutral" style={{ marginLeft: 4 }}>{w.mold}</span>
                  </td>
                  <td className="num" style={{ fontSize: 12.5 }}>{w.cavities}c × {w.cycleTime}s</td>
                  <td className="num">{_fmt(w.quantity)}</td>
                  <td className="num">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                      <span>{_fmt(w.produced)}</span>
                      <span style={{ width: 36, height: 4, background: "var(--bg-subtle)", borderRadius: 99, overflow: "hidden" }}>
                        <span style={{ display: "block", width: pct + "%", height: "100%", background: w.status === "done" ? "var(--success)" : "var(--accent)" }} />
                      </span>
                    </div>
                  </td>
                  <td className="num" style={{ color: ngPct > 2 ? "var(--danger)" : "var(--text-secondary)" }}>
                    {_fmt(w.ng)} <span style={{ fontSize: 11 }}>({_fmt(ngPct, 2)}%)</span>
                  </td>
                  <td><StatusBadge status={w.status} dict={WO_STATUS}/></td>
                  <td className="num" style={{ fontSize: 12.5 }}>{w.due}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MachineGrid() {
  return (
    <div className="grid-3">
      {MACHINES.map((m) => {
        const wo = WORK_ORDERS.find((w) => w.id === m.workOrder);
        const pct = wo ? Math.round((wo.produced / wo.quantity) * 100) : 0;
        const meta = ({
          running: { tone: "var(--success)", b: "var(--success-subtle)", label: "กำลังผลิต" },
          setup: { tone: "var(--amber)", b: "var(--amber-subtle)", label: "ตั้งเครื่อง" },
          idle: { tone: "var(--text-secondary)", b: "var(--bg-subtle)", label: "ว่าง" },
          maintenance: { tone: "var(--danger)", b: "var(--danger-subtle)", label: "บำรุงรักษา" },
        })[m.status];
        return (
          <div key={m.id} className="card" style={{ padding: 0 }}>
            <div style={{ padding: 16, display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border)" }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: meta.b, color: meta.tone, display: "grid", placeItems: "center" }}>
                <I.Factory size={20}/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <b style={{ fontSize: 14 }}>{m.id}</b>
                  <span className="badge" style={{ background: meta.b, color: meta.tone }}><span className="b-dot"/>{meta.label}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                  {m.name.split("—")[1] ? m.name.split("—")[1].trim() : m.name} · {m.tonnage} ตัน
                </div>
              </div>
            </div>
            <div style={{ padding: 16 }}>
              {wo ? (
                <>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>กำลังผลิต</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>{wo.product}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{wo.id} · {wo.customerName}</div>
                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                    <WOMini k="ผลิต" v={_fmt(wo.produced)} unit="ชิ้น"/>
                    <WOMini k="เป้า" v={_fmt(wo.quantity)} unit="ชิ้น"/>
                    <WOMini k="NG" v={_fmt(wo.ng)} unit="ชิ้น"/>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <div style={{ height: 8, background: "var(--bg-subtle)", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: pct + "%", height: "100%", background: meta.tone }} />
                    </div>
                    <div className="num" style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4, textAlign: "right" }}>{pct}% · เหลือ ~{Math.ceil((wo.quantity - wo.produced) * wo.cycleTime / wo.cavities / 3600 * 10) / 10} ชม.</div>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-secondary)", fontSize: 12.5 }}>
                  {m.status === "setup" && <>เปลี่ยนแม่พิมพ์ → MLD-001<br/><span style={{ fontSize: 11 }}>คาดเสร็จใน ~45 นาที</span></>}
                  {m.status === "maintenance" && <>ซ่อม Hot Runner<br/><span style={{ fontSize: 11 }}>คาดกลับมาใช้ได้ พรุ่งนี้</span></>}
                  {m.status === "idle" && <>พร้อมรับงาน · รอแผนผลิต</>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function WOMini({ k, v, unit }) {
  return (
    <div style={{ background: "var(--bg-subtle)", borderRadius: 6, padding: "6px 8px" }}>
      <div style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{k}</div>
      <div className="num" style={{ fontSize: 13, fontWeight: 600 }}>{v}<span style={{ fontWeight: 400, color: "var(--text-secondary)", fontSize: 11, marginLeft: 3 }}>{unit}</span></div>
    </div>
  );
}

// ----- Material check & reservation helpers -----
// สูตรที่ใช้กับใบสั่งผลิต = snapshot ที่เก็บไว้ตอนเปิดใบสั่ง (ใบเก่าที่ไม่มี snapshot ใช้สูตรหลักปัจจุบันของสินค้า)
function _bomOfWo(wo) { return Store.woBom(wo); }
function _woReq(wo) {
  const bom = _bomOfWo(wo);
  if (!bom) return [];
  return bom.lines.map((l) => ({ item: l.item, name: l.name, perPc: l.qty, kg: wo.quantity * l.qty * (1 + (bom.wasteRate || 0) / 100) }));
}
// วัตถุดิบในสูตร BOM ที่ถูกปิดใช้งาน (active === false) — ใช้แจ้งเตือน ไม่บล็อกงานผลิตที่กำลังทำอยู่
function _inactiveInBom(bom) {
  if (!bom) return [];
  return bom.lines.map((l) => MATERIALS.find((x) => x.id === l.item)).filter((m) => m && m.active === false);
}
function _reservedByOthers(materialId, currentWoId) {
  const cur = currentWoId ? Store.state.workOrders.find((w) => w.id === currentWoId) : null;
  return Store.reservedAhead(materialId, cur || null);
}

function MaterialReservation({ wo }) {
  const bom = _bomOfWo(wo);
  const reqs = _woReq(wo).map((r) => {
    const m = MATERIALS.find((x) => x.id === r.item);
    const reservedOther = _reservedByOthers(r.item, wo.id);
    const stock = m ? m.stock : 0;
    const available = stock - reservedOther;
    return { ...r, unit: m ? m.unit : "KG", stock, reservedOther, available, ok: available >= r.kg, m };
  });
  const hasData = reqs.length > 0;
  const allOk = hasData && reqs.every((r) => r.ok);
  const shortItems = reqs.filter((r) => !r.ok);
  const inactiveReqs = reqs.filter((r) => r.m && r.m.active === false);
  const shortActive = shortItems.filter((r) => !(r.m && r.m.active === false)); // สั่งซื้อได้เฉพาะวัตถุดิบที่ยังใช้งานอยู่
  const alreadyReserved = ["running", "setup", "done"].includes(wo.status);
  const reserved = !!wo.reserved || alreadyReserved;
  const setReserved = (v) => runAction(() => Store.update("workOrders", wo.id, { reserved: v }, "id", v ? "จองวัตถุดิบ" : "ยกเลิกจองวัตถุดิบ"), v ? "จองวัตถุดิบแล้ว" : "ยกเลิกการจองแล้ว");

  // overall status pill
  let pill;
  if (!hasData) pill = { th: "ไม่มีสูตร BOM", color: "neutral" };
  else if (!allOk) pill = { th: "วัตถุดิบไม่พอ · รอจัดซื้อ", color: "danger" };
  else if (reserved) pill = { th: "จองแล้ว · พร้อมผลิต", color: "success" };
  else pill = { th: "พร้อมจองวัตถุดิบ", color: "info" };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <div>
          <div className="card-title">ตรวจสอบ & จองวัตถุดิบ (Reserve Material)</div>
          <div className="card-sub">
            ระบบเช็คอัตโนมัติจาก BOM — หักสต็อกที่งานอื่นจองไว้แล้ว{bom && bom.estimated ? " · ประเมิน (ยังไม่มี BOM)" : ""}
          </div>
        </div>
        <div className="card-actions">
          {inactiveReqs.length > 0 && <span className="badge badge-warning"><I.Alert size={11}/> BOM อ้างวัตถุดิบที่ปิดใช้งาน</span>}
          <span className={"badge badge-" + pill.color}><span className="b-dot"/>{pill.th}</span>
        </div>
      </div>
      <div style={{ padding: "4px 18px 16px" }}>
        {!hasData ? (
          <div style={{ textAlign: "center", padding: 24, color: "var(--text-tertiary)", fontSize: 13 }}>
            ยังไม่ได้กำหนด BOM ของสินค้านี้ — กรุณาตั้งสูตรก่อนเพื่อตรวจสอบวัตถุดิบ
          </div>
        ) : (
          <>
            <table className="table" style={{ fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th>วัตถุดิบ</th>
                  <th className="num">ต้องใช้</th>
                  <th className="num">คงคลัง</th>
                  <th className="num">จองโดยงานอื่น</th>
                  <th className="num">พร้อมใช้</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {reqs.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{r.name}{r.m && r.m.active === false && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>ปิดใช้งาน</span>}</div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-secondary)" }}>{r.item} · {_fmt(r.perPc, 4)} {r.unit}/ชิ้น</div>
                    </td>
                    <td className="num" style={{ fontWeight: 600 }}>{_fmt(r.kg, 1)} <span style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{r.unit}</span></td>
                    <td className="num">{_fmt(r.stock, 0)}</td>
                    <td className="num" style={{ color: r.reservedOther > 0 ? "var(--amber)" : "var(--text-tertiary)" }}>{r.reservedOther > 0 ? "−" + _fmt(r.reservedOther, 1) : "—"}</td>
                    <td className="num" style={{ fontWeight: 600, color: r.ok ? "var(--text-primary)" : "var(--danger)" }}>{_fmt(r.available, 1)}</td>
                    <td>
                      {r.ok
                        ? <span className="badge badge-success"><I.Check size={11}/> เพียงพอ</span>
                        : <span className="badge badge-danger"><I.Alert size={11}/> ขาด {_fmt(r.kg - r.available, 1)} {r.unit}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {inactiveReqs.length > 0 && (
              <div style={{ marginTop: 10, padding: "9px 12px", borderRadius: 8, background: "var(--amber-subtle)", color: "var(--amber)", fontSize: 12.5, display: "flex", gap: 8, alignItems: "flex-start" }}>
                <I.Alert size={14}/>
                <span>สูตรนี้ใช้วัตถุดิบที่<b>ปิดใช้งาน</b>: <b>{inactiveReqs.map((r) => r.m.code).join(", ")}</b> — งานผลิตที่กำลังดำเนินการทำต่อได้ตามปกติ แต่ระบบจะไม่สร้างใบสั่งซื้อวัตถุดิบเหล่านี้ให้ กรุณาเปิดใช้งานวัตถุดิบหรือตรวจสอบสูตรก่อน</span>
              </div>
            )}

            {bom && bom.packaging && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12, color: "var(--text-secondary)" }}>
                <I.Package size={13}/> บรรจุภัณฑ์: <b style={{ color: "var(--text-primary)" }}>{bom.packaging}</b>
              </div>
            )}

            {/* action footer */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, padding: "12px 14px", borderRadius: 10,
              background: !allOk ? "var(--danger-subtle)" : reserved ? "var(--success-subtle)" : "var(--bg-subtle)" }}>
              <div style={{ flex: 1, fontSize: 12.5 }}>
                {!allOk ? (
                  <span style={{ color: "var(--danger)" }}>
                    <b>วัตถุดิบไม่พอ {shortItems.length} รายการ</b> — ระบบจะตั้งสถานะ “รอจัดซื้อ” ให้อัตโนมัติ
                  </span>
                ) : reserved ? (
                  <span style={{ color: "var(--success)" }}>
                    <b>จองวัตถุดิบสำเร็จ</b> — สต็อกถูกกันไว้ให้ WO นี้แล้ว · สถานะ “พร้อมผลิต”
                  </span>
                ) : (
                  <span style={{ color: "var(--text-secondary)" }}>
                    วัตถุดิบเพียงพอทุกรายการ — กด “จองวัตถุดิบ” เพื่อกันไม่ให้ WO อื่นดึงไปใช้
                  </span>
                )}
              </div>
              {!allOk ? (
                <button className="btn btn-outline btn-sm" disabled={shortActive.length === 0} title={shortActive.length === 0 ? "วัตถุดิบที่ขาดปิดใช้งานอยู่ — เปิดใช้งานก่อนจึงจะสั่งซื้อได้" : undefined}
                  onClick={() => createPOFromShortage(wo, shortItems)}><I.Boxes size={13}/> สร้างใบสั่งซื้อวัตถุดิบที่ขาด</button>
              ) : reserved ? (
                <button className="btn btn-outline btn-sm" onClick={() => setReserved(false)}>ยกเลิกจอง</button>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={() => setReserved(true)}><I.Check size={13}/> จองวัตถุดิบทั้งหมด</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Detailed WO drawer with cost breakdown
function WorkOrderDetail({ wo, onProduce }) {
  const bc = woBomCost(wo);
  const cycleHr = (wo.quantity * (wo.cycleTime || 0)) / Math.max(1, wo.cavities || 1) / 3600; // เวลาผลิตโดยประมาณ (ชม.)
  const fg = Store.state.finished.find((f) => f.code === wo.productCode);
  const costTotal = bc.total;
  const unitCost = bc.basis ? costTotal / bc.basis : 0;

  return (
    <div style={{ padding: 20 }}>
      {/* Header strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 16, background: "var(--bg-subtle)", borderRadius: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: "var(--accent-subtle)", color: "var(--accent)", display: "grid", placeItems: "center" }}>
          <I.Factory size={22}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{wo.product}</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{wo.productCode} · {wo.customerName}</div>
        </div>
        <StatusBadge status={wo.status} dict={WO_STATUS}/>
      </div>

      <div className="grid-2" style={{ marginBottom: 14 }}>
        <Field k="วันที่เปิดงาน" v={wo.date}/>
        <Field k="กำหนดส่ง" v={wo.due}/>
        <Field k="เครื่องฉีด" v={wo.machine}/>
        <Field k="แม่พิมพ์" v={wo.mold}/>
        <Field k="จำนวน Cavities" v={wo.cavities + " ช่อง"}/>
        <Field k="Cycle Time" v={wo.cycleTime + " วินาที / ครั้ง"}/>
      </div>

      <MaterialReservation key={wo.id} wo={wo}/>

      <ProductionRecorder wo={wo} onProduce={onProduce}/>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div>
            <div className="card-title">ความคืบหน้าการผลิต</div>
            <div className="card-sub">บันทึกล่าสุดเมื่อ 14:22 น. โดย คุณสมศักดิ์ (Operator)</div>
          </div>
        </div>
        <div className="card-body">
          <div className="grid-4">
            <BigStat k="จำนวนเป้า" v={_fmt(wo.quantity)} unit="ชิ้น" tone="neutral"/>
            <BigStat k="ผลิตจริง" v={_fmt(wo.produced)} unit="ชิ้น" tone="accent"/>
            <BigStat k="ของเสีย (NG)" v={_fmt(wo.ng)} unit="ชิ้น" tone="amber"/>
            <BigStat k="คงเหลือ" v={_fmt(wo.quantity - wo.produced)} unit="ชิ้น" tone="violet"/>
          </div>
          <div style={{ marginTop: 16 }}>
            <div className="num" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
              <span>ความคืบหน้า</span>
              <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{Math.round((wo.produced / wo.quantity) * 100)}%</span>
            </div>
            <div style={{ height: 10, background: "var(--bg-subtle)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ width: ((wo.produced / wo.quantity) * 100) + "%", height: "100%", background: "linear-gradient(90deg,#2D6CDF,#0EA5C7)" }}/>
            </div>
          </div>
          <div className="num" style={{ marginTop: 12, fontSize: 12, color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}>
            <span>เวลาผลิตประเมิน · {Math.ceil(cycleHr * 10) / 10} ชม. ({wo.cavities} cavity × {wo.cycleTime}s)</span>
            <span>NG rate: {_fmt(wo.produced ? wo.ng / wo.produced * 100 : 0, 2)}%</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">การส่งมอบตามใบสั่งขาย</div>
            <div className="card-sub">ใบส่งสินค้าที่ออกจากใบสั่งขายต้นทางของงานนี้</div>
          </div>
        </div>
        <div style={{ padding: "8px 18px 18px" }}>
          <WODeliveries wo={wo}/>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <div>
            <div className="card-title">ต้นทุนวัตถุดิบตามสูตร BOM</div>
            <div className="card-sub">คิดจาก{wo.produced ? "จำนวนที่ผลิตจริง" : "จำนวนสั่งผลิต"} {_fmt(bc.basis)} ชิ้น × ต้นทุนวัตถุดิบในทะเบียน</div>
          </div>
        </div>
        <div style={{ padding: "8px 18px 18px" }}>
          {!bc.hasBom && <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>สินค้านี้ยังไม่มีสูตร BOM — เพิ่มสูตรเพื่อคำนวณต้นทุนวัตถุดิบ</div>}
          {bc.lines.map((l, i) => <CostLine key={i} label={l.name} calc={`${_fmt(l.qty, 2)} ${l.unit} × ${l.cost > 0 ? "฿" + _fmt(l.cost, 2) : "ยังไม่มีต้นทุน"} (รวมเผื่อเสีย ${bc.wasteRate}%)`} v={l.v}/>)}
          {fg && <CostLine label="ต้นทุนมาตรฐานในทะเบียนสินค้า" calc={`${_fmt(bc.basis)} ชิ้น × ฿${_fmt(fg.cost, 2)}`} v={bc.basis * fg.cost} note tone="amber"/>}
          <div style={{ height: 1, background: "var(--border)", margin: "10px 0" }}/>
          <div style={{ display: "flex", alignItems: "center", padding: "8px 0" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>ต้นทุนวัตถุดิบรวม</div>
            <div className="spacer"/>
            <div className="num" style={{ fontWeight: 600, fontSize: 15 }}>{baht(costTotal, 2)}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", padding: "6px 0" }}>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>ต้นทุน / ชิ้น</div>
            <div className="spacer"/>
            <div className="num" style={{ fontWeight: 600, fontSize: 13 }}>{baht(unitCost, 2)} / ชิ้น</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ k, v }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{v}</div>
    </div>
  );
}
function BigStat({ k, v, unit, tone }) {
  const tones = {
    neutral: { c: "var(--text-primary)", b: "var(--bg-subtle)" },
    accent:  { c: "var(--accent)", b: "var(--accent-subtle)" },
    amber:   { c: "var(--amber)", b: "var(--amber-subtle)" },
    violet:  { c: "var(--violet)", b: "var(--violet-subtle)" },
  }[tone];
  return (
    <div style={{ background: tones.b, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{k}</div>
      <div className="num" style={{ fontSize: 20, fontWeight: 600, color: tones.c, letterSpacing: "-0.01em", marginTop: 2 }}>
        {v}<span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 400, marginLeft: 3 }}>{unit}</span>
      </div>
    </div>
  );
}
function CostLine({ label, calc, v, tone, note }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        <div className="num" style={{ fontSize: 11, color: "var(--text-secondary)" }}>{calc}</div>
      </div>
      <div className="num" style={{ fontWeight: 500, fontSize: 13, color: tone === "amber" ? "var(--amber)" : "var(--text-primary)" }}>
        {note ? "—" : "฿" + _fmt(v, 2)}
      </div>
    </div>
  );
}

// การส่งมอบ: ใบส่งสินค้าที่ออกจากใบสั่งขายต้นทางของใบสั่งผลิตนี้
function WODeliveries({ wo }) {
  if (!wo.soId) return <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", padding: 8 }}>ใบสั่งผลิตนี้ไม่ได้เปิดจากใบสั่งขาย (ผลิตเข้าสต๊อก)</div>;
  const so = Workflow.get(wo.soId);
  const line = so && wo.src ? so.lines[wo.src.line] : null;
  const dos = Store.state.docs.filter((d) => d.type === "DO" && (d.sourceIds || []).includes(wo.soId));
  const rows = dos.map((d) => ({ d, qty: (d.lines || []).filter((l) => l.src && l.src.doc === wo.soId && (!wo.src || l.src.line === wo.src.line)).reduce((s, l) => s + l.qty, 0) })).filter((r) => r.qty > 0);
  const shipped = rows.filter((r) => Workflow.isLive(r.d)).reduce((s, r) => s + r.qty, 0);
  return (
    <>
      <div style={{ fontSize: 12.5, marginBottom: 8 }}>ใบสั่งขาย <b className="mono">{wo.soId}</b> {so && <DocStatusBadge doc={so}/>} · สั่ง {_fmt(line ? line.qty : 0)} · ออกใบส่งสินค้าแล้ว <b>{_fmt(shipped)}</b></div>
      <table className="table" style={{ fontSize: 12.5 }}>
        <thead><tr><th>ใบส่งสินค้า</th><th>วันที่</th><th className="num">จำนวน</th><th>สถานะเอกสาร</th><th>จัดส่ง</th></tr></thead>
        <tbody>
          {rows.map(({ d, qty }) => <tr key={d.id}><td className="mono">{d.id}</td><td>{d.date}</td><td className="num">{_fmt(qty)}</td><td><DocStatusBadge doc={d}/></td><td>{d.ship ? d.ship.status : "—"}</td></tr>)}
          {!rows.length && <EmptyRow cols={5} text="ยังไม่มีใบส่งสินค้า — สร้างจากใบสั่งขายในเมนูเอกสารขาย"/>}
        </tbody>
      </table>
    </>
  );
}

// สร้างใบสั่งซื้อ (สถานะรออนุมัติ) สำหรับวัตถุดิบที่ไม่พอ แยกตามผู้ขายหลักของวัตถุดิบ
function createPOFromShortage(wo, shortItems) {
  // วัตถุดิบที่ปิดใช้งาน (active === false) ไม่ถูกนำไปสร้างใบสั่งซื้อใหม่
  const skipped = shortItems.filter((r) => r.m && r.m.active === false).map((r) => r.m.code);
  runAction(() => Store.tx("PO from shortage", () => {
    const bySup = {};
    shortItems.forEach((r) => {
      const m = r.m; if (!m) return;
      if (m.active === false) return;
      const need = Math.ceil(r.kg - Math.max(0, r.available));
      if (need <= 0) return;
      // ราคาอ้างอิง = ราคาซื้อล่าสุด (ไม่มีก็ใช้ต้นทุนถัวเฉลี่ย) — ถ้าไม่เคยซื้อเลยต้องกรอกราคาที่หน้าจัดซื้อ
      const ps = window.materialPurchaseStats ? window.materialPurchaseStats(m) : null;
      const price = (ps && ps.last > 0 ? ps.last : 0) || (m.cost > 0 ? m.cost : 0);
      if (!(price > 0)) Store.fail(`วัตถุดิบ ${m.code} ยังไม่เคยซื้อ จึงไม่มีราคาอ้างอิง — กรุณาออก PO ที่หน้าจัดซื้อและกรอกราคา`);
      (bySup[m.supplier || "—"] = bySup[m.supplier || "—"] || []).push({ item: m.id, name: `${m.code} ${m.name}`, qty: need, unit: m.unit, price, amount: Math.round(need * price * 100) / 100 });
    });
    const made = Object.entries(bySup).map(([supName, lines]) => {
      const sup = Store.state.suppliers.find((s) => s.name.toLowerCase().includes(supName.toLowerCase().split(" ")[0])) || null;
      if (!sup) Store.fail(`ไม่พบ Supplier "${supName}" ในทะเบียน — กำหนดผู้ขายหลักของวัตถุดิบให้ตรงกับทะเบียน Supplier หรือออก PO ที่หน้าจัดซื้อ`);
      const n = Store.nextDocNo("PO");
      const subtotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
      const vat = Math.round(subtotal * 7) / 100;
      const po = { id: n.docNo, seq: n.seq, counterKey: n.counterKey, date: Store.today(), supplier: sup ? sup.code : supName, supplierName: sup ? sup.name : supName,
        items: lines.length, subtotal, vat, whtRate: 0, total: Math.round((subtotal + vat) * 100) / 100, expectedDate: "—", status: "pending",
        createdBy: Store.userName(), lines, ref: wo.id };
      Store.state.purchaseOrders.unshift(po);
      Store.log("CREATE", "ใบสั่งซื้อ", po.id, `สร้างจากวัตถุดิบไม่พอของ ${wo.id}`);
      return po.id;
    });
    if (!made.length) Store.fail(skipped.length ? `วัตถุดิบที่ขาดปิดใช้งานอยู่ (${skipped.join(", ")}) — ไม่สร้างใบสั่งซื้อ กรุณาเปิดใช้งานวัตถุดิบก่อน` : "ไม่มีรายการที่ต้องสั่งซื้อ");
    return made;
  }), (ids) => `สร้างใบสั่งซื้อ ${ids.join(", ")} (รออนุมัติ) — ดูได้ที่เมนูใบสั่งซื้อ` + (skipped.length ? ` · ข้าม ${skipped.join(", ")} (ปิดใช้งาน)` : ""));
}

// ต้นทุนวัตถุดิบตามสูตรของใบสั่ง (snapshot) ใช้ต้นทุนถัวเฉลี่ยปัจจุบันของวัตถุดิบในทะเบียน
function woBomCost(wo) {
  const bom = Store.woBom(wo);
  const basis = wo.produced || wo.quantity;
  if (!bom) return { basis, lines: [], total: 0, hasBom: false };
  const waste = 1 + (bom.wasteRate || 0) / 100;
  const lines = bom.lines.map((l) => {
    const m = Store.state.materials.find((x) => x.id === l.item);
    const cost = m ? Number(m.cost) || 0 : 0;
    const qty = l.qty * basis * waste;
    return { name: l.name, qty, unit: m ? m.unit : "KG", cost, v: qty * cost };
  });
  return { basis, lines, total: lines.reduce((t, l) => t + l.v, 0), hasBom: true, wasteRate: bom.wasteRate, bomName: bom.name, revision: bom.revision };
}

function ProductionRecorder({ wo, onProduce }) {
  const remaining = Math.max(0, wo.quantity - (wo.produced || 0));
  const [qty, setQty] = useState("");
  const [ng, setNg] = useState("");
  const bom = _bomOfWo(wo);
  const [busy, setBusy] = useState(false);
  const sh = Store.woShortage(wo);
  const openPOs = Store.state.purchaseOrders.filter((p) => p.ref === wo.id && !["received", "cancelled"].includes(p.status));
  const n = parseInt(qty, 10) || 0;
  const ngN = parseInt(ng, 10) || 0;
  const good = Math.max(0, n - ngN);
  const done = wo.status === "done";

  const preview = (bom && n > 0) ? bom.lines.map((bl) => {
    const m = MATERIALS.find((x) => x.id === bl.item);
    const use = Math.round(bl.qty * n * (1 + (bom.wasteRate || 0) / 100) * 1000) / 1000;
    return { name: m ? m.name : bl.item, code: m ? m.code : bl.item, use, unit: m ? m.unit : "KG", stock: m ? m.stock : 0, short: m ? m.stock < use : false, inactive: !!m && m.active === false };
  }) : [];
  const inactiveBom = _inactiveInBom(bom);
  const fg = FINISHED.find((f) => f.code === wo.productCode);
  const anyShort = preview.some((p) => p.short);
  const valid = n > 0 && ngN <= n && !done && !busy;

  // server ตัดวัตถุดิบ + เพิ่มสินค้าสำเร็จรูปใน transaction เดียว; วัตถุดิบไม่พอ = ปฏิเสธทั้งหมด
  const commit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const r = await Store.produceWO(wo.id, n, ngN);
      setQty(""); setNg("");
      if (r.ok) onProduce(
        `บันทึกผลิต ${wo.id}: +${_fmt(r.good)} ชิ้นเข้าคลัง` +
        (r.consumed.length ? ` · ตัดวัตถุดิบ ${r.consumed.length} รายการ` : "")
      );
    } catch (e) {
      notify(e && e.message ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <div>
          <div className="card-title">บันทึกผลิต & ตัดสต๊อกอัตโนมัติ</div>
          <div className="card-sub">ระบุจำนวนที่ผลิตได้ → ตัดวัตถุดิบตาม BOM และเพิ่มสินค้าสำเร็จรูปเข้าคลังอัตโนมัติ</div>
        </div>
        <div className="card-actions">
          <span className="badge badge-neutral">คงเหลือ {_fmt(remaining)} ชิ้น</span>
        </div>
      </div>
      <div style={{ padding: "4px 18px 16px" }}>
        {done ? (
          <div style={{ textAlign: "center", padding: 18, color: "var(--success)", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <I.Check size={16}/> งานนี้ปิดแล้ว — ผลิตครบ {_fmt(wo.produced)} ชิ้น
          </div>
        ) : (
          <>
            {inactiveBom.length > 0 && (
              <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 8, background: "var(--amber-subtle)", color: "var(--amber)", fontSize: 12.5, display: "flex", gap: 8, alignItems: "flex-start" }}>
                <I.Alert size={14}/>
                <span>สูตรนี้ใช้วัตถุดิบที่<b>ปิดใช้งาน</b>: <b>{inactiveBom.map((m) => m.code).join(", ")}</b> — บันทึกผลิตและตัดสต๊อกต่อได้ตามปกติ แต่ควรเปิดใช้งานวัตถุดิบหรือตรวจสอบสูตร</span>
              </div>
            )}
            {sh.anyShort && (
              <div style={{ marginBottom: 12, border: "1px solid var(--danger)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "9px 12px", background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5, fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}>
                  <I.Alert size={14}/> วัตถุดิบไม่พอสำหรับที่เหลือ {_fmt(sh.remaining)} ชิ้น — ผลิตได้สูงสุด {_fmt(sh.maxPieces)} ชิ้นจากของที่มี (หักของที่ใบสั่งผลิตก่อนหน้าจองไว้แล้ว) ต้องเพิ่มสต๊อก
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 100px 90px", gap: 8, padding: "6px 12px", background: "var(--bg-subtle)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>
                  <div>วัตถุดิบที่ขาด</div><div style={{ textAlign: "right" }}>ต้องใช้</div><div style={{ textAlign: "right" }}>มีอยู่</div><div style={{ textAlign: "right" }}>จองโดยงานอื่น</div><div style={{ textAlign: "right" }}>ขาด</div>
                </div>
                {sh.rows.filter((r) => r.short > 0.0005).map((r, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 100px 90px", gap: 8, padding: "6px 12px", borderTop: "1px solid var(--border)", fontSize: 12.5 }}>
                    <div><b style={{ fontWeight: 500 }}>{r.name}</b> <span className="mono" style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{r.code}</span></div>
                    <div className="num" style={{ textAlign: "right" }}>{_fmt(r.need, 1)} {r.unit}</div>
                    <div className="num" style={{ textAlign: "right" }}>{_fmt(r.stock, 1)}</div>
                    <div className="num" style={{ textAlign: "right", color: r.reserved > 0 ? "var(--amber)" : "var(--text-tertiary)" }}>{r.reserved > 0 ? "−" + _fmt(r.reserved, 1) : "—"}</div>
                    <div className="num" style={{ textAlign: "right", color: "var(--danger)", fontWeight: 600 }}>{_fmt(r.short, 1)}</div>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderTop: "1px solid var(--border)", flexWrap: "wrap", alignItems: "center" }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => createPOFromShortage(wo, sh.rows.filter((r) => r.short > 0.0005).map((r) => ({ m: r.m, kg: r.need, available: r.available })))}><I.Boxes size={13}/> สร้างใบสั่งซื้อวัตถุดิบที่ขาด</button>
                  {sh.maxPieces > 0 && <button type="button" className="btn btn-outline btn-sm" onClick={() => setQty(String(sh.maxPieces))}>ผลิตเท่าที่ทำได้ ({_fmt(sh.maxPieces)} ชิ้น)</button>}
                  {openPOs.length > 0 && <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>สั่งซื้อแล้ว: {openPOs.map((p) => p.id).join(", ")} (รอรับของ)</span>}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ width: 150 }}>
                <label className="field-label">จำนวนที่ผลิต (ชิ้น)</label>
                <input type="number" min="0" className="input num" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value)}/>
              </div>
              <div style={{ width: 130 }}>
                <label className="field-label">ของเสีย NG (ชิ้น)</label>
                <input type="number" min="0" className="input num" placeholder="0" value={ng} onChange={(e) => setNg(e.target.value)}/>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQty(String(remaining))} style={{ marginBottom: 2 }}>เติมยอดคงเหลือ</button>
              <div className="spacer"/>
              {good > 0 && <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>เข้าคลังสุทธิ <b className="num" style={{ color: "var(--success)" }}>{_fmt(good)}</b> ชิ้น</div>}
            </div>

            {n > 0 && preview.length > 0 && (
              <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px", gap: 8, padding: "7px 12px", background: "var(--bg-subtle)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>
                  <div>วัตถุดิบที่จะตัด</div><div style={{ textAlign: "right" }}>ใช้</div><div style={{ textAlign: "right" }}>คงเหลือหลังตัด</div>
                </div>
                {preview.map((p, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px", gap: 8, padding: "7px 12px", borderTop: "1px solid var(--border)", fontSize: 12.5, alignItems: "center" }}>
                    <div><b style={{ fontWeight: 500 }}>{p.name}</b> <span className="mono" style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{p.code}</span>{p.inactive && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>ปิดใช้งาน</span>}</div>
                    <div className="num" style={{ textAlign: "right", color: "var(--amber)", fontWeight: 600 }}>−{_fmt(p.use, 2)} {p.unit}</div>
                    <div className="num" style={{ textAlign: "right", color: p.short ? "var(--danger)" : "var(--text-secondary)" }}>{_fmt(p.stock - p.use, 1)} {p.unit}</div>
                  </div>
                ))}
                {fg && <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px", gap: 8, padding: "7px 12px", borderTop: "1px solid var(--border)", fontSize: 12.5, alignItems: "center", background: "var(--success-subtle)" }}>
                  <div><b style={{ fontWeight: 500 }}>{fg.name}</b> <span className="mono" style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{fg.code}</span></div>
                  <div className="num" style={{ textAlign: "right", color: "var(--success)", fontWeight: 600 }}>+{_fmt(good)} {fg.unit}</div>
                  <div className="num" style={{ textAlign: "right", color: "var(--text-secondary)" }}>{_fmt(fg.stock + good)} {fg.unit}</div>
                </div>}
              </div>
            )}
            {n > 0 && !preview.length && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-tertiary)" }}>* สินค้านี้ยังไม่มีสูตร BOM — จะเพิ่มสินค้าสำเร็จรูปเข้าคลังอย่างเดียว (ไม่ตัดวัตถุดิบ)</div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
              {anyShort && <span style={{ fontSize: 12, color: "var(--danger)", display: "flex", alignItems: "center", gap: 5 }}><I.Alert size={13}/> วัตถุดิบบางรายการไม่พอ — ระบบจะปฏิเสธการบันทึกผลิต (ไม่ตัดสต๊อกใดๆ)</span>}
              <div className="spacer"/>
              <button type="button" className="btn btn-primary" disabled={!valid || anyShort} onClick={commit}>
                <I.Check size={14}/> บันทึก & ตัดสต๊อก
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AddWorkOrderForm({ onSubmit, onCancel }) {
  const [productCode, setProductCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [machine, setMachine] = useState("");
  const [mold, setMold] = useState("");
  const [cavities, setCavities] = useState("");
  const [cycleTime, setCycleTime] = useState("");
  const [date, setDate] = useState("2026-06-06");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("normal");
  const [bomId, setBomId] = useState("");

  const product = FINISHED.find((f) => f.code === productCode);
  const variants = productCode ? Store.bomsFor(productCode) : [];
  const bomSel = variants.find((b) => b.id === bomId) || null;
  const bomSnap = bomSel ? Store.bomSnapshot(bomSel) : null;
  const cust = product ? CUSTOMERS.find((c) => c.code === product.customer) : null;

  const onProduct = (code) => {
    setProductCode(code);
    const bom = Store.bomDefaultFor(code);
    setBomId(bom ? bom.id : "");
    if (bom && bom.mold) {
      setMold(bom.mold);
      const mo = MOLDS.find((m) => m.id === bom.mold || m.code === bom.mold);
      if (mo) setCavities(String(mo.cavities));
    }
  };

  const valid = productCode && (parseInt(quantity, 10) || 0) > 0 && machine;

  const nextWoId = () => Store.nextDocNo("WO").docNo;

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    const qty = parseInt(quantity, 10) || 0;
    onSubmit({
      id: nextWoId(), date, due: due || "—",
      product: product ? product.name : productCode, productCode,
      customer: product ? product.customer : "—", customerName: cust ? cust.nameEn || cust.name : (product ? product.customer : "—"),
      quantity: qty, produced: 0, ng: 0,
      machine: machine || "—", mold: mold || "—",
      cavities: parseInt(cavities, 10) || 1, cycleTime: parseInt(cycleTime, 10) || 20,
      status: "queued", priority,
      ...(bomSel ? { bomId: bomSel.id, bomSnapshot: Store.bomSnapshot(bomSel) } : {}),
      deliverySchedule: due ? [{ date: due, qty, shipped: 0, status: "scheduled", note: "" }] : [],
    });
  };

  return (
    <form onSubmit={submit} style={{ padding: 20 }}>
      <div style={{ marginBottom: 12 }}>
        <label className="field-label">สินค้าที่ผลิต *</label>
        <select className="select" value={productCode} onChange={(e) => onProduct(e.target.value)}>
          <option value="">— เลือกสินค้าสำเร็จรูป —</option>
          {FINISHED.map((f) => <option key={f.id} value={f.code}>{f.code} · {f.name}</option>)}
        </select>
        {product && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)", display: "flex", gap: 14 }}>
            <span>ลูกค้า: <b style={{ color: "var(--text-primary)" }}>{cust ? cust.name : (product.customer === "—" ? "—" : product.customer)}</b></span>
            {variants.length
              ? <span style={{ color: "var(--success)" }}><I.Check size={11}/> มีสูตร BOM {variants.length} สูตร — ตัดสต๊อกอัตโนมัติ</span>
              : <span style={{ color: "var(--amber)" }}>⚠ ยังไม่มี BOM ที่ใช้งาน (สร้างได้ที่หน้า สต๊อก / BOM) — จะไม่ตัดวัตถุดิบ</span>}
          </div>
        )}
        {variants.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <label className="field-label">สูตรที่ใช้ผลิต (BOM) *</label>
            <select className="select" value={bomId} onChange={(e) => setBomId(e.target.value)}>
              {variants.map((b) => <option key={b.id} value={b.id}>{b.name}{b.color ? " · " + b.color : ""}{b.isDefault ? " (สูตรหลัก)" : ""} · rev {b.revision}</option>)}
            </select>
            {bomSnap && (() => {
              const qtyN = parseInt(quantity, 10) || 0;
              const cost = Store.bomCost(bomSnap);
              const short = qtyN > 0 ? bomSnap.lines.filter((l) => {
                const m = MATERIALS.find((x) => x.id === l.item);
                return !m || (m.stock - _reservedByOthers(l.item, null)) < qtyN * l.qty * (1 + (bomSnap.wasteRate || 0) / 100);
              }) : [];
              return (
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                  {bomSnap.lines.map((l) => l.name + " " + _fmt(l.qty, 5) + " กก./ชิ้น").join(" · ")}
                  <div style={{ marginTop: 3 }}>
                    ต้นทุนวัสดุ ≈ <b>{cost.perPiece > 0 ? "฿" + _fmt(cost.perPiece, 4) + "/ชิ้น" : "ยังไม่มีต้นทุน"}</b>
                    {cost.missing.length > 0 && <span style={{ color: "var(--amber)" }}> (ยังไม่มีต้นทุน: {cost.missing.join(", ")})</span>}
                    {qtyN > 0 && (short.length ? <span style={{ color: "var(--danger)" }}> · วัตถุดิบไม่พอ {short.length} รายการ</span> : <span style={{ color: "var(--success)" }}> · วัตถุดิบพอ</span>)}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
        {bomSnap && _inactiveInBom(bomSnap).length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--amber)", display: "flex", gap: 6, alignItems: "center" }}>
            <I.Alert size={12}/> สูตรใช้วัตถุดิบที่ปิดใช้งาน: {_inactiveInBom(bomSnap).map((m) => m.code).join(", ")}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="field-label">จำนวนสั่งผลิต (ชิ้น) *</label>
          <input type="number" min="1" className="input num" placeholder="0" value={quantity} onChange={(e) => setQuantity(e.target.value)}/>
        </div>
        <div>
          <label className="field-label">ระดับความสำคัญ</label>
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="normal">ปกติ</option>
            <option value="high">ด่วน</option>
          </select>
        </div>
        <div>
          <label className="field-label">เครื่องฉีด *</label>
          <select className="select" value={machine} onChange={(e) => setMachine(e.target.value)}>
            <option value="">— เลือกเครื่อง —</option>
            {MACHINES.map((m) => <option key={m.id} value={m.id}>{m.id} · {m.tonnage} ตัน</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">แม่พิมพ์</label>
          <select className="select" value={mold} onChange={(e) => setMold(e.target.value)}>
            <option value="">— เลือกแม่พิมพ์ —</option>
            {MOLDS.map((m) => <option key={m.id} value={m.id}>{m.id} · {m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">จำนวน Cavity</label>
          <input type="number" min="1" className="input num" placeholder="1" value={cavities} onChange={(e) => setCavities(e.target.value)}/>
        </div>
        <div>
          <label className="field-label">Cycle Time (วินาที)</label>
          <input type="number" min="1" className="input num" placeholder="20" value={cycleTime} onChange={(e) => setCycleTime(e.target.value)}/>
        </div>
        <div>
          <label className="field-label">วันที่เปิดงาน</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)}/>
        </div>
        <div>
          <label className="field-label">กำหนดส่ง</label>
          <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)}/>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-outline" onClick={onCancel}>ยกเลิก</button>
        <button type="submit" className="btn btn-primary" disabled={!valid}><I.Check size={14}/> เปิดใบสั่งผลิต</button>
      </div>
    </form>
  );
}

window.PageProduction = PageProduction;
