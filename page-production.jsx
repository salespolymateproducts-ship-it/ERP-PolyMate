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
                      {["queued", "setup", "running"].includes(w.status) && (() => { const x = Store.woShortage(w); return x.anyShort ? <span className="badge badge-danger" title="วัตถุดิบรวมทุกใบสั่งผลิตไม่พอ ต้องเพิ่มสต๊อก">ขาดวัตถุดิบ</span> : x.anyWait ? <span className="badge badge-warning" title="สั่งซื้อแล้ว รอรับของ">รอรับวัตถุดิบ</span> : null; })()}
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
                  <td className="mono"><b style={{ color: "var(--text-primary)" }}>{w.id}</b>{["queued", "setup", "running"].includes(w.status) && (() => { const x = Store.woShortage(w); return x.anyShort ? <span className="badge badge-danger" style={{ marginLeft: 6 }}>ขาดวัตถุดิบ</span> : x.anyWait ? <span className="badge badge-warning" style={{ marginLeft: 6 }}>รอรับวัตถุดิบ</span> : null; })()}{w.priority === "high" && <span className="badge badge-danger" style={{ marginLeft: 6 }}>ด่วน</span>}</td>
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
  useStore();
  const role = Store.user() ? Store.user().role : null;
  const canEdit = role === "admin" || role === "production";
  const [form, setForm] = useState(null);   // { mode: "new" | "edit", rec }
  const [condM, setCondM] = useState(null); // เครื่องที่จะเปลี่ยนสภาพ
  const [maintM, setMaintM] = useState(null); // เครื่องที่จะบันทึกซ่อมบำรุง
  const [histM, setHistM] = useState(null); // รหัสเครื่องที่ดูประวัติ
  const [showRetired, setShowRetired] = useState(false);
  const [toast, setToast] = useState(null);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2600); };
  const list = MACHINES.filter((m) => showRetired || m.condition !== "retired");
  const retiredCount = MACHINES.filter((m) => m.condition === "retired").length;
  const histRec = histM ? MACHINES.find((m) => m.id === histM) : null;
  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        {retiredCount > 0 && <label style={{ fontSize: 12.5, color: "var(--text-secondary)", display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)}/> แสดงเครื่องที่เลิกใช้ ({retiredCount})
        </label>}
        <div style={{ flex: 1 }}/>
        {canEdit ? <button className="btn btn-primary btn-sm" onClick={() => setForm({ mode: "new" })}><I.Plus size={14}/> เพิ่มเครื่อง</button>
          : <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>ดูได้อย่างเดียว — เพิ่ม/แก้เครื่องได้เฉพาะผู้ดูแลระบบและฝ่ายผลิต</span>}
      </div>
      <div className="grid-3">
        {list.map((m) => {
          const wo = WORK_ORDERS.find((w) => w.id === m.workOrder);
          const pct = wo ? Math.round((wo.produced / wo.quantity) * 100) : 0;
          const cd = Store.machineCond(m);
          const pm = Store.machinePM(m);
          const retired = m.condition === "retired";
          const meta = ({
            running: { tone: "var(--success)", b: "var(--success-subtle)", label: "กำลังผลิต" },
            setup: { tone: "var(--amber)", b: "var(--amber-subtle)", label: "ตั้งเครื่อง" },
            idle: { tone: "var(--text-secondary)", b: "var(--bg-subtle)", label: "ว่าง" },
          })[m.status] || { tone: "var(--text-secondary)", b: "var(--bg-subtle)", label: "ว่าง" };
          const specs = [];
          if (m.tieBarW && m.tieBarL) specs.push("ระยะห่างเสา " + m.tieBarW + "×" + m.tieBarL + " มม.");
          if (m.thkMin && m.thkMax) specs.push("ความหนาแม่พิมพ์ " + m.thkMin + "–" + m.thkMax + " มม.");
          if (m.location) specs.push(m.location);
          return (
            <div key={m.id} className="card" style={{ padding: 0, opacity: retired ? 0.65 : 1 }}>
              <div style={{ padding: 16, display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border)" }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: cd.bg, color: cd.tone, display: "grid", placeItems: "center" }}>
                  <I.Factory size={20}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <b style={{ fontSize: 14 }}>{m.id}</b>
                    <span className="badge" style={{ background: cd.bg, color: cd.tone }}><span className="b-dot"/>{cd.th}</span>
                    {m.status === "running" && <span className="badge badge-success">กำลังผลิต</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                    {m.name.split("—")[1] ? m.name.split("—")[1].trim() : m.name} · {m.tonnage} ตัน
                  </div>
                </div>
              </div>
              <div style={{ padding: 16 }}>
                {specs.length > 0 && <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 8 }}>{specs.join(" · ")}</div>}
                {m.condition && m.condition !== "ready" && m.conditionReason && (
                  <div style={{ fontSize: 12, padding: "6px 10px", borderRadius: 8, background: cd.bg, color: cd.tone, marginBottom: 8 }}>เหตุผล: {m.conditionReason}</div>
                )}
                {!retired && (
                  <div style={{ fontSize: 11.5, marginBottom: 10, color: pm.overdue ? "var(--danger)" : pm.soon ? "var(--amber)" : "var(--text-secondary)" }}>
                    <I.Wrench size={11} style={{ verticalAlign: "middle" }}/> บำรุงล่าสุด {m.lastMaint || "—"} ·{" "}
                    {pm.none ? "ยังไม่มีบันทึก — บันทึกซ่อมบำรุงเพื่อเริ่มนับรอบ PM" : pm.overdue ? "เลยรอบ PM " + (-pm.daysLeft) + " วัน (ครบ " + pm.next + ")" : pm.soon ? "ใกล้ครบรอบ PM อีก " + pm.daysLeft + " วัน" : "PM ถัดไป " + pm.next}
                  </div>
                )}
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
                  <div style={{ textAlign: "center", padding: "10px 0", color: "var(--text-secondary)", fontSize: 12.5 }}>
                    {retired ? "เลิกใช้แล้ว" : m.condition === "maintenance" ? "อยู่ระหว่างซ่อมบำรุง — รับงานไม่ได้" : "พร้อมรับงาน · รอแผนผลิต"}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, padding: 10, borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setHistM(m.id)}>ประวัติ</button>
                {canEdit && <>
                  <button className="btn btn-outline btn-sm" onClick={() => setForm({ mode: "edit", rec: m })}>แก้ไข</button>
                  <button className="btn btn-outline btn-sm" onClick={() => setCondM(m)}>เปลี่ยนสภาพ</button>
                  {!retired && <button className="btn btn-outline btn-sm" onClick={() => setMaintM(m)}><I.Wrench size={12}/> บันทึกซ่อมบำรุง</button>}
                </>}
              </div>
            </div>
          );
        })}
      </div>

      {form && <MachineForm key={form.mode + (form.rec ? form.rec.id : "")} mode={form.mode} rec={form.rec} onClose={() => setForm(null)} onDone={(m) => { setForm(null); flash(m); }}/>}
      {condM && <MachineConditionModal m={MACHINES.find((x) => x.id === condM.id) || condM} onClose={() => setCondM(null)} onDone={(m) => { setCondM(null); flash(m); }}/>}
      {maintM && <MachineMaintModal m={MACHINES.find((x) => x.id === maintM.id) || maintM} onClose={() => setMaintM(null)} onDone={(m) => { setMaintM(null); flash(m); }}/>}
      {histRec && <MachineHistoryModal m={histRec} onClose={() => setHistM(null)}/>}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1100, background: "var(--text-primary)", color: "white", padding: "12px 18px", borderRadius: 10, boxShadow: "var(--shadow-lg)", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 10 }}>
          <I.Check size={16}/> {toast}
        </div>
      )}
    </>
  );
}

function MachineForm({ mode, rec, onClose, onDone }) {
  const editing = mode === "edit";
  const str = (v) => (v == null ? "" : String(v));
  const [f, setF] = useState(rec ? {
    id: rec.id, name: rec.name, tonnage: str(rec.tonnage), tieBarW: str(rec.tieBarW), tieBarL: str(rec.tieBarL), thkMin: str(rec.thkMin), thkMax: str(rec.thkMax),
    pmIntervalDays: str(rec.pmIntervalDays || 90), location: rec.location || "", note: rec.note || "", lastMaint: rec.lastMaint || "",
  } : { id: "", name: "", tonnage: "", tieBarW: "", tieBarL: "", thkMin: "", thkMax: "", pmIntervalDays: "90", location: "", note: "", lastMaint: Store.today() });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const num = (v) => (String(v).trim() === "" ? null : Number(v));
  const submit = async () => {
    setErr("");
    if (!f.id.trim() && !editing) return setErr("กรุณาระบุรหัสเครื่อง");
    if (!f.name.trim()) return setErr("กรุณาระบุชื่อ/ยี่ห้อรุ่น");
    if (!(num(f.tonnage) > 0)) return setErr("กรุณาระบุขนาดตัน (มากกว่า 0)");
    if ((num(f.tieBarW) == null) !== (num(f.tieBarL) == null)) return setErr("ระยะห่างเสาต้องกรอกทั้งกว้างและยาว (หรือเว้นว่างทั้งคู่)");
    if ((num(f.thkMin) == null) !== (num(f.thkMax) == null)) return setErr("ช่วงความหนาแม่พิมพ์ต้องกรอกทั้งต่ำสุดและสูงสุด (หรือเว้นว่างทั้งคู่)");
    if (num(f.thkMin) != null && num(f.thkMin) > num(f.thkMax)) return setErr("ความหนาต่ำสุดต้องไม่เกินสูงสุด");
    const body = { ...(editing ? rec : {}), id: editing ? rec.id : f.id.trim(), name: f.name.trim(), tonnage: num(f.tonnage),
      tieBarW: num(f.tieBarW), tieBarL: num(f.tieBarL), thkMin: num(f.thkMin), thkMax: num(f.thkMax),
      pmIntervalDays: num(f.pmIntervalDays) || 90, location: f.location.trim(), note: f.note.trim() };
    if (!editing) body.lastMaint = f.lastMaint || Store.today();
    setSaving(true);
    try {
      await Store.saveMachine(body, !editing);
      onDone(editing ? "แก้ไขเครื่อง " + body.id + " แล้ว" : "เพิ่มเครื่อง " + body.id + " แล้ว");
    } catch (e) { setErr(e && e.message ? e.message : String(e)); setSaving(false); }
  };
  const fld = (k, label, type = "text", ph) => <div><label className="field-label">{label}</label><input className="input" type={type} step="any" min={type === "number" ? "0" : undefined} placeholder={ph} value={f[k]} onChange={set(k)}/></div>;
  return (
    <ErpModal title={editing ? "แก้ไขเครื่อง " + rec.id : "เพิ่มเครื่องจักร"} width={640} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" disabled={saving} onClick={submit}>บันทึก</button></>}>
      <div className="grid-2" style={{ gap: 10 }}>
        <div><label className="field-label">รหัสเครื่อง *</label><input className="input" style={{ fontFamily: "var(--font-mono)" }} placeholder="เช่น INJ-07" disabled={editing} value={f.id} onChange={set("id")}/></div>
        {fld("name", "ชื่อ / ยี่ห้อรุ่น *", "text", "เช่น เครื่อง #7 — JSW J220")}
        {fld("tonnage", "ขนาด (ตัน) *", "number")}
        {fld("pmIntervalDays", "รอบบำรุงรักษา PM (วัน)", "number")}
        {fld("tieBarW", "ระยะห่างเสา กว้าง (มม.)", "number")}{fld("tieBarL", "ระยะห่างเสา ยาว (มม.)", "number")}
        {fld("thkMin", "ความหนาแม่พิมพ์ต่ำสุด (มม.)", "number")}{fld("thkMax", "ความหนาแม่พิมพ์สูงสุด (มม.)", "number")}
        {fld("location", "ตำแหน่งติดตั้ง", "text", "เช่น โรงงาน 1 แถว A")}
        {!editing ? fld("lastMaint", "บำรุงรักษาล่าสุด", "date") : <div/>}
        <div style={{ gridColumn: "1 / -1" }}><label className="field-label">หมายเหตุ</label><input className="input" value={f.note} onChange={set("note")}/></div>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 8 }}>ระยะห่างเสาและช่วงความหนาใช้เตือนเมื่อเลือกแม่พิมพ์ที่ไม่เข้ากับเครื่อง (เว้นว่างได้ = ไม่ตรวจ) · สภาพเครื่องเปลี่ยนที่ปุ่ม "เปลี่ยนสภาพ" พร้อมเหตุผล</div>
      {err && <div style={{ marginTop: 10, padding: "9px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

function MachineConditionModal({ m, onClose, onDone }) {
  const [cond, setCond] = useState(m.condition || "ready");
  const [reason, setReason] = useState(m.condition && m.condition !== "ready" ? (m.conditionReason || "") : "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const need = cond !== "ready";
  const go = async () => {
    setErr("");
    if (need && !reason.trim()) return setErr("กรุณากรอกเหตุผล");
    setBusy(true);
    try { await Store.setMachineCondition(m.id, cond, reason.trim()); onDone("เปลี่ยนสภาพเครื่อง " + m.id + " เป็น " + Store.MACHINE_COND[cond].th + " แล้ว"); }
    catch (e) { setErr(e && e.message ? e.message : String(e)); setBusy(false); }
  };
  return (
    <ErpModal title={"เปลี่ยนสภาพเครื่อง " + m.id} width={500} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ปิด</button><button className="btn btn-primary btn-sm" disabled={busy} onClick={go}>บันทึก</button></>}>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 10 }}>สภาพปัจจุบัน: <b>{Store.machineCond(m).th}</b>{m.conditionReason ? " — " + m.conditionReason : ""}</div>
      <label className="field-label">สภาพเครื่อง</label>
      <select className="select" value={cond} onChange={(e) => setCond(e.target.value)}>
        {Object.entries(Store.MACHINE_COND).map(([k, v]) => <option key={k} value={k}>{v.th}</option>)}
      </select>
      <label className="field-label" style={{ marginTop: 10 }}>เหตุผล {need && <span style={{ color: "var(--danger)" }}>*</span>}</label>
      <textarea className="input" rows={3} style={{ width: "100%", height: "auto", padding: 8 }} placeholder={need ? "เช่น เสียงดังผิดปกติที่ชุดฉีด / เปลี่ยนซีลกระบอกฉีด / ขายทิ้ง" : "ไม่บังคับ"} value={reason} onChange={(e) => setReason(e.target.value)}/>
      <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 6 }}>อยู่ระหว่างซ่อมบำรุง / เลิกใช้ ตั้งไม่ได้ถ้ายังมีใบสั่งผลิตที่เปิดอยู่ใช้เครื่องนี้ · บันทึกผู้ทำและเวลาอัตโนมัติ</div>
      {err && <div style={{ marginTop: 10, padding: "9px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

function MachineMaintModal({ m, onClose, onDone }) {
  const [f, setF] = useState({ kind: "repair", date: Store.today(), note: "", cost: "", downtimeHrs: "", finish: true });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const go = async () => {
    setErr("");
    if (!f.note.trim()) return setErr("กรุณากรอกรายละเอียดการซ่อมบำรุง");
    setBusy(true);
    try {
      await Store.logMachineMaintenance(m.id, { kind: f.kind, date: f.date, note: f.note.trim(), cost: Number(f.cost) || 0, downtimeHrs: Number(f.downtimeHrs) || 0, finish: f.finish });
      onDone("บันทึกซ่อมบำรุง " + m.id + " แล้ว");
    } catch (e) { setErr(e && e.message ? e.message : String(e)); setBusy(false); }
  };
  return (
    <ErpModal title={"บันทึกซ่อมบำรุง " + m.id} width={540} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ปิด</button><button className="btn btn-primary btn-sm" disabled={busy} onClick={go}>บันทึก</button></>}>
      <div className="grid-2" style={{ gap: 10 }}>
        <div><label className="field-label">ประเภท</label><select className="select" value={f.kind} onChange={set("kind")}><option value="repair">ซ่อม</option><option value="PM">PM ตามรอบ</option></select></div>
        <div><label className="field-label">วันที่ทำ</label><DateInput className="input" value={f.date} max={Store.today()} onChange={set("date")}/></div>
        <div style={{ gridColumn: "1 / -1" }}><label className="field-label">รายละเอียด *</label><textarea className="input" rows={3} style={{ width: "100%", height: "auto", padding: 8 }} value={f.note} onChange={set("note")}/></div>
        <div><label className="field-label">ค่าใช้จ่าย (บาท)</label><input className="input num" type="number" min="0" value={f.cost} onChange={set("cost")}/></div>
        <div><label className="field-label">เวลาที่เครื่องหยุด (ชม.)</label><input className="input num" type="number" min="0" step="any" value={f.downtimeHrs} onChange={set("downtimeHrs")}/></div>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 12.5 }}>
        <input type="checkbox" checked={f.finish} onChange={set("finish")}/> ซ่อมบำรุงเสร็จแล้ว — อัปเดตวันบำรุงล่าสุดและกลับเป็น "พร้อมใช้งาน"
      </label>
      {err && <div style={{ marginTop: 10, padding: "9px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

function MachineHistoryModal({ m, onClose }) {
  const ml = m.maintLog || [], cl = m.conditionLog || [];
  return (
    <ErpModal title={"ประวัติเครื่อง " + m.id} width={760} onClose={onClose} footer={<button className="btn btn-outline btn-sm" onClick={onClose}>ปิด</button>}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>ประวัติซ่อมบำรุง ({ml.length})</div>
      {!ml.length ? <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 14 }}>ยังไม่มีบันทึก</div> : (
        <table className="table" style={{ fontSize: 12, marginBottom: 16 }}>
          <thead><tr><th>วันที่</th><th>ประเภท</th><th>รายละเอียด</th><th className="num">ค่าใช้จ่าย</th><th className="num">หยุด (ชม.)</th><th>โดย</th></tr></thead>
          <tbody>{ml.map((x, i) => <tr key={i}><td>{x.date}</td><td>{x.kind === "PM" ? "PM" : "ซ่อม"}</td><td>{x.note}</td><td className="num">{_fmt(x.cost || 0)}</td><td className="num">{_fmt(x.downtimeHrs || 0, 1)}</td><td>{x.by}</td></tr>)}</tbody>
        </table>
      )}
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>ประวัติการเปลี่ยนสภาพ ({cl.length})</div>
      {!cl.length ? <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>ยังไม่มีบันทึก</div> : (
        <table className="table" style={{ fontSize: 12 }}>
          <thead><tr><th>เวลา</th><th>เปลี่ยน</th><th>เหตุผล</th><th>โดย</th></tr></thead>
          <tbody>{cl.map((x, i) => <tr key={i}><td>{String(x.at).slice(0, 16)}</td><td>{(Store.MACHINE_COND[x.from] || { th: x.from }).th} → <b>{(Store.MACHINE_COND[x.to] || { th: x.to }).th}</b></td><td>{x.reason}</td><td>{x.by}</td></tr>)}</tbody>
        </table>
      )}
    </ErpModal>
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
  return Store.reservedByOthers(materialId, cur || null);
}

// ปรับสัดส่วนมาสเตอร์แบตช์/สารเติมแต่ง/เศษรีไซเคิลของใบสั่งผลิตเดียว (ก่อนเริ่มผลิต) — คำนวณใหม่จากสูตรตั้งต้นเสมอ ไม่ทบกัน
function AdjustBomModal({ wo, onClose }) {
  const snap = wo.bomSnapshot;
  const base = snap.baseLines || [];
  const isShare = (l) => l.type === "resin" && l.basis === "shareOfResin";
  const canAdj = (l) => l.type !== "resin" || isShare(l);
  const adjustable = base.filter(canAdj);
  const isPct = (l) => isShare(l) || l.type === "regrind" || l.basis === "pctOfResin";
  const key = (l) => isPct(l) ? "pct" : "qty";
  const cur = (l) => { const x = (snap.lines || []).find((y) => y.item === l.item); return x && x[key(l)] != null ? x[key(l)] : l[key(l)]; };
  const [vals, setVals] = useState(() => Object.fromEntries(adjustable.map((l) => [l.item, String(cur(l))])));
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const edited = base.map((l) => (!canAdj(l) || vals[l.item] === undefined || !(parseFloat(vals[l.item]) > 0)) ? l : { ...l, [key(l)]: parseFloat(vals[l.item]) });
  const resolved = Store.bomResolve({ lines: edited, resinWeight: snap.baseResinWeight });
  const baseResolved = Store.bomResolve({ lines: base, resinWeight: snap.baseResinWeight });
  const shareLines = adjustable.filter(isShare);
  const shareSum = shareLines.reduce((t, l) => t + (parseFloat(vals[l.item]) || 0), 0);
  const shareBad = shareLines.length > 0 && Math.abs(shareSum - 100) > 1e-6;
  const wasteRate = Number(snap.wasteRate) || 0;
  const costNew = Store.bomCost({ lines: resolved, wasteRate }).perPiece, costBase = Store.bomCost({ lines: baseResolved, wasteRate }).perPiece;
  const diffs = adjustable.filter((l) => Math.abs((parseFloat(vals[l.item]) || 0) - Number(l[key(l)])) > 1e-9);
  const hadAdj = !!(snap.adjustments && snap.adjustments.length);
  const submit = async () => {
    setErr("");
    if (shareBad) return setErr("สัดส่วนเม็ดรวมต้องเท่ากับ 100 % พอดี (ตอนนี้ " + _fmt(shareSum, 2) + " %)");
    for (const l of adjustable) { const v = parseFloat(vals[l.item]); if (!(v > 0) || (isPct(l) && !(v <= 100))) return setErr("ค่าของ " + (l.name || l.item) + " ต้องมากกว่า 0" + (isPct(l) ? " และน้อยกว่า 100 %" : "")); }
    setBusy(true);
    try {
      await Store.adjustWoBom(wo.id, diffs.map((l) => ({ item: l.item, [key(l)]: parseFloat(vals[l.item]) })), reason.trim());
      notify(diffs.length ? "ปรับสัดส่วนของ " + wo.id + " แล้ว" : "คืนค่าตามสูตรตั้งต้นแล้ว", "success");
      onClose();
    } catch (e) { setErr(e && e.message ? e.message : String(e)); setBusy(false); }
  };
  return (
    <ErpModal title={"ปรับสัดส่วนสูตร · " + wo.id} onClose={onClose} width={640}
      footer={<>
        <button className="btn btn-outline btn-sm" onClick={onClose}>ปิด</button>
        <button className="btn btn-primary btn-sm" disabled={busy || shareBad || !reason.trim() || (!diffs.length && !hadAdj)} onClick={submit}>{diffs.length ? "บันทึกการปรับ" : "คืนค่าตามสูตร"}</button>
      </>}>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 10 }}>ปรับเฉพาะใบสั่งผลิตนี้ — ไม่กระทบสูตรหลักและใบอื่น ปรับได้ก่อนเริ่มผลิตเท่านั้น และปรับได้เฉพาะมาสเตอร์แบตช์ สารเติมแต่ง เศษรีไซเคิล และสัดส่วนเม็ดผสม (ผลรวมต้องเป็น 100 %)</div>
      <table className="table" style={{ fontSize: 12.5 }}>
        <thead><tr><th>วัตถุดิบ</th><th className="num">ตามสูตร</th><th className="num">ใบนี้</th><th className="num">กก./ชิ้น</th></tr></thead>
        <tbody>
          {base.map((l, i) => {
            const rl = resolved[i] || {};
            const adj = canAdj(l);
            return (
              <tr key={l.item}>
                <td><div style={{ fontWeight: 500 }}>{l.name}</div><div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{l.item} · {{ resin: "เม็ดพลาสติก", masterbatch: "มาสเตอร์แบตช์", additive: "สารเติมแต่ง", regrind: "เศษรีไซเคิล" }[l.type]}</div></td>
                <td className="num">{adj ? _fmt(l[key(l)], 4) + (isPct(l) ? " %" : " กก.") : _fmt(l.qty, 4) + " กก."}</td>
                <td className="num">{adj
                  ? <input type="number" step="any" min="0" className="input num" style={{ width: 90, height: 32, textAlign: "right" }} value={vals[l.item]} onChange={(e) => setVals((v) => ({ ...v, [l.item]: e.target.value }))}/>
                  : <span style={{ color: "var(--text-tertiary)" }}>ปรับไม่ได้</span>}</td>
                <td className="num">{_fmt(rl.qty || 0, 5)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shareLines.length > 0 && <div style={{ marginTop: 8, fontSize: 12.5, color: shareBad ? "var(--danger)" : "var(--success)" }}>สัดส่วนเม็ดรวม {_fmt(shareSum, 2)} % {shareBad ? "— ต้องเท่ากับ 100 %" : "✓"}</div>}
      <div style={{ marginTop: 10, padding: 10, background: "var(--bg-subtle)", borderRadius: 8, fontSize: 12.5 }}>
        ต้นทุนวัสดุ/ชิ้น: ตามสูตร <b>{costBase > 0 ? "฿" + _fmt(costBase, 4) : "—"}</b> → ใบนี้ <b>{costNew > 0 ? "฿" + _fmt(costNew, 4) : "—"}</b>
        {costBase > 0 && costNew > 0 && Math.abs(costNew - costBase) > 1e-9 && <span style={{ color: costNew > costBase ? "var(--danger)" : "var(--success)" }}> ({costNew > costBase ? "+" : "−"}{_fmt(Math.abs(costNew - costBase), 4)})</span>}
      </div>
      <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", fontWeight: 500, marginTop: 12 }}>เหตุผล <span style={{ color: "var(--danger)" }}>*</span></label>
      <textarea className="input" rows={2} style={{ width: "100%", marginTop: 6, height: "auto", padding: 8 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ลูกค้าขอสีเข้มขึ้น / มีเศษบดเหลือมาก"/>
      {err && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
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
  // ปุ่มสั่งซื้อใช้ยอดขาดรวมทุกใบสั่งผลิต (หักที่สั่งซื้อไว้แล้ว) — กันสั่งซ้ำ
  const sh = Store.woShortage(wo);
  const poRows = sh.rows.filter((r) => r.short > 0.0005).map((r) => ({ m: r.m, kg: r.short, available: 0 }));
  const shortActive = poRows.filter((r) => !(r.m && r.m.active === false)); // สั่งซื้อได้เฉพาะวัตถุดิบที่ยังใช้งานอยู่
  const alreadyReserved = ["running", "setup", "done"].includes(wo.status);
  const reserved = !!wo.reserved || alreadyReserved;
  const role = Store.user() ? Store.user().role : null;
  const [adjOpen, setAdjOpen] = useState(false);
  const canAdjust = (role === "admin" || role === "production") && ["queued", "setup"].includes(wo.status) && !(Number(wo.produced) > 0) && !!(wo.bomSnapshot && wo.bomSnapshot.baseLines);
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
          {canAdjust && <button className="btn btn-outline btn-sm" onClick={() => setAdjOpen(true)}><I.Edit size={13}/> ปรับสัดส่วนสูตรของใบนี้</button>}
          {inactiveReqs.length > 0 && <span className="badge badge-warning"><I.Alert size={11}/> BOM อ้างวัตถุดิบที่ปิดใช้งาน</span>}
          <span className={"badge badge-" + pill.color}><span className="b-dot"/>{pill.th}</span>
        </div>
      </div>
      {adjOpen && <AdjustBomModal wo={wo} onClose={() => setAdjOpen(false)}/>}
      {bom && bom.adjustments && bom.adjustments.length > 0 && (
        <div style={{ margin: "0 18px 4px", padding: "9px 12px", borderRadius: 8, background: "var(--accent-subtle)", fontSize: 12.5 }}>
          <b>ปรับสัดส่วนเฉพาะใบนี้</b> (ไม่กระทบสูตรหลัก): {bom.adjustments.map((a) => (a.name || a.item) + " " + _fmt(a.from, 4) + " → " + _fmt(a.to, 4) + " " + (a.unit === "%" ? "%" : "กก./ชิ้น")).join(" · ")}
          <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 2 }}>เหตุผล: {bom.adjustReason} · โดย {bom.adjustBy} · {bom.adjustAt}</div>
        </div>
      )}
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
                <button className="btn btn-outline btn-sm" disabled={shortActive.length === 0}
                  title={shortActive.length === 0 ? (poRows.length ? "วัตถุดิบที่ขาดปิดใช้งานอยู่ — เปิดใช้งานก่อนจึงจะสั่งซื้อได้" : "สั่งซื้อไว้แล้ว" + (sh.orders.length ? " (" + sh.orders.join(", ") + ")" : "") + " รอรับของ") : undefined}
                  onClick={() => createPOFromShortage(wo, poRows)}><I.Boxes size={13}/> สร้างใบสั่งซื้อวัตถุดิบที่ขาด</button>
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

      {["done", "cancelled"].includes(wo.status)
        ? <div className="card" style={{ marginBottom: 14, padding: "12px 18px", fontSize: 12.5, color: "var(--text-secondary)" }}>
            {wo.status === "done" ? "ใบสั่งผลิตปิดแล้ว — วัตถุดิบถูกตัดสต๊อกตามที่ผลิตจริงแล้ว ไม่ต้องจองวัตถุดิบเพิ่ม" : "ใบสั่งผลิตถูกยกเลิก — ไม่มีการจองวัตถุดิบ"}
          </div>
        : <MaterialReservation key={wo.id} wo={wo}/>}

      <ProductionRecorder wo={wo} onProduce={onProduce}/>

      <ExtraMaterialCard wo={wo}/>

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
// เปิดหน้าต่างให้เจ้าหน้าที่กำหนดจำนวนสั่งซื้อเอง (ค่าเริ่มต้น = ยอดที่ขาด) — สั่งเกินได้เพื่อเผื่อเหตุฉุกเฉิน ส่วนที่เหลือจากการผลิตอยู่ในสต๊อกตามปกติ
function createPOFromShortage(wo, shortItems) {
  const items = shortItems.filter((r) => r.m && r.m.active !== false);
  if (!items.length) { doCreatePOFromShortage(wo, shortItems); return; }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);
  const close = () => { root.unmount(); host.remove(); };
  root.render(<ShortagePOModal wo={wo} items={items} allItems={shortItems} onClose={close}/>);
}

function ShortagePOModal({ wo, items, allItems, onClose }) {
  const [q, setQ] = useState(() => Object.fromEntries(items.map((r) => [r.m.id, String(Math.ceil(r.kg - Math.max(0, r.available)))])));
  const submit = () => {
    const overrides = {};
    for (const r of items) {
      const v = Number(q[r.m.id]);
      if (!(v >= 0)) { notify("จำนวนสั่งซื้อของ " + r.m.code + " ไม่ถูกต้อง", "error"); return; }
      overrides[r.m.id] = v;
    }
    if (!Object.values(overrides).some((v) => v > 0)) { notify("ต้องระบุจำนวนสั่งซื้ออย่างน้อย 1 รายการ", "error"); return; }
    if (doCreatePOFromShortage(wo, allItems, overrides)) onClose();
  };
  return (
    <ErpModal title={"สั่งซื้อวัตถุดิบสำหรับ " + wo.id} width={640} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={submit}><I.Boxes size={13}/> สร้างใบสั่งซื้อ</button></>}>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 10 }}>ระบบเสนอจำนวนตามยอดที่ขาด — แก้จำนวนสั่งซื้อได้เอง เช่น ขาด 900 แต่สั่ง 1,200 เผื่อเหตุฉุกเฉิน ส่วนที่เหลือหลังผลิตคงอยู่ในสต๊อกวัตถุดิบ</div>
      <table className="table" style={{ fontSize: 12.5 }}>
        <thead><tr><th>วัตถุดิบ</th><th className="num">ขาด</th><th className="num">จำนวนที่สั่ง</th></tr></thead>
        <tbody>{items.map((r) => {
          const need = Math.ceil(r.kg - Math.max(0, r.available));
          const v = Number(q[r.m.id]);
          return (
            <tr key={r.m.id}>
              <td>{r.m.name}<div className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{r.m.code}</div></td>
              <td className="num">{_fmt(need)} {r.m.unit}</td>
              <td className="num">
                <input className="input input-sm num" type="number" min="0" step="any" value={q[r.m.id]} onChange={(e) => setQ((s) => ({ ...s, [r.m.id]: e.target.value }))} style={{ width: 110, textAlign: "right" }}/> {r.m.unit}
                {v > need && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>เผื่อเพิ่ม {_fmt(v - need)}</div>}
                {v < need && <div style={{ fontSize: 11, color: "var(--amber)" }}>น้อยกว่ายอดที่ขาด {_fmt(need - v)}</div>}
              </td>
            </tr>
          );
        })}</tbody>
      </table>
    </ErpModal>
  );
}

function doCreatePOFromShortage(wo, shortItems, overrides) {
  // วัตถุดิบที่ปิดใช้งาน (active === false) ไม่ถูกนำไปสร้างใบสั่งซื้อใหม่
  const skipped = shortItems.filter((r) => r.m && r.m.active === false).map((r) => r.m.code);
  return runAction(() => Store.tx("PO from shortage", () => {
    const bySup = {};
    shortItems.forEach((r) => {
      const m = r.m; if (!m) return;
      if (m.active === false) return;
      const need = overrides && overrides[m.id] != null ? overrides[m.id] : Math.ceil(r.kg - Math.max(0, r.available));
      if (need <= 0) return;
      // ราคาอ้างอิง = ราคาซื้อล่าสุด (ไม่มีก็ใช้ต้นทุนถัวเฉลี่ย) — ถ้าไม่เคยซื้อเลยต้องกรอกราคาที่หน้าจัดซื้อ
      const ps = window.materialPurchaseStats ? window.materialPurchaseStats(m) : null;
      const price = (ps && ps.last > 0 ? ps.last : 0) || (m.cost > 0 ? m.cost : 0);
      if (!(price > 0)) Store.fail(`วัตถุดิบ ${m.code} ยังไม่เคยซื้อ จึงไม่มีราคาอ้างอิง — กรุณาออก PO ที่หน้าจัดซื้อและกรอกราคา`);
      (bySup[m.supplier || "—"] = bySup[m.supplier || "—"] || []).push({ item: m.id, name: `${m.code} ${m.name}`, qty: need, unit: m.unit, price, amount: Math.round(need * price * 100) / 100 });
    });
    // จับคู่ผู้ขายแบบเข้มงวด: รหัส หรือชื่อ (ไทย/อังกฤษ) ตรงทั้งชื่อ — ไม่เดาจากคำแรก กันสั่งผิดเจ้า
    const norm = (v) => String(v || "").trim().toLowerCase();
    const findSup = (name) => { const k = norm(name); if (!k || k === "—") return null;
      return Store.state.suppliers.find((s) => s.status !== "inactive" && [s.code, s.name, s.nameEn].some((x) => norm(x) === k)) || null; };
    const unmatched = [];
    const made = Object.entries(bySup).map(([supName, lines]) => {
      const sup = findSup(supName);
      if (!sup) { unmatched.push(supName === "—" ? "(ไม่ระบุผู้ขาย)" : supName); return null; }
      const n = Store.nextDocNo("PO");
      const subtotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
      const vat = Math.round(subtotal * 7) / 100;
      const po = { id: n.docNo, seq: n.seq, counterKey: n.counterKey, date: Store.today(), supplier: sup ? sup.code : supName, supplierName: sup ? sup.name : supName,
        items: lines.length, subtotal, vat, whtRate: 0, total: Math.round((subtotal + vat) * 100) / 100, expectedDate: "—", status: "pending",
        createdBy: Store.userName(), lines, ref: wo.id,
        forWo: Store.state.workOrders.filter((w) => ["queued", "setup", "running"].includes(w.status) && Store.woShortage(w).rows.some((r) => r.need > 0.0005 && lines.some((pl) => pl.item === r.item))).map((w) => w.id) };
      Store.state.purchaseOrders.unshift(po);
      Store.log("CREATE", "ใบสั่งซื้อ", po.id, `สร้างจากวัตถุดิบไม่พอของ ${wo.id}`);
      return po.id;
    }).filter(Boolean);
    if (!made.length && unmatched.length) Store.fail(`ไม่พบผู้ขาย ${unmatched.join(", ")} ในทะเบียน Supplier (ต้องตรงรหัสหรือชื่อเต็ม) — แก้ผู้ขายหลักของวัตถุดิบให้ตรงทะเบียน หรือออก PO ที่หน้าจัดซื้อ`);
    if (!made.length) Store.fail(skipped.length ? `วัตถุดิบที่ขาดปิดใช้งานอยู่ (${skipped.join(", ")}) — ไม่สร้างใบสั่งซื้อ กรุณาเปิดใช้งานวัตถุดิบก่อน` : "ไม่มีรายการที่ต้องสั่งซื้อ");
    return { ids: made, unmatched };
  }), (r) => `สร้างใบสั่งซื้อ ${r.ids.join(", ")} (รออนุมัติ) — ดูได้ที่เมนูใบสั่งซื้อ` + (skipped.length ? ` · ข้าม ${skipped.join(", ")} (ปิดใช้งาน)` : "") + (r.unmatched.length ? ` · ยังไม่สร้างของผู้ขาย ${r.unmatched.join(", ")} (ไม่ตรงทะเบียน Supplier)` : ""));
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

// เบิกวัตถุดิบเพิ่ม / คืนวัตถุดิบ เข้าใบสั่งผลิต — ต้นทุนสะท้อนวัตถุดิบที่ใช้จริง (รวมเข้าต้นทุนสินค้าตอนบันทึกผลิตครั้งถัดไป)
function ExtraMaterialCard({ wo }) {
  const [open, setOpen] = useState(false);
  const role = Store.user() ? Store.user().role : null;
  const list = wo.extraIssues || [];
  const netExtra = list.reduce((t, e) => t + (e.kind === "RETURN" ? -e.qty : e.qty), 0);
  // ใบที่ปิดแล้วคืนวัตถุดิบได้ (ถ้ายังมียอดเบิกเพิ่มคงค้าง) แต่เบิกเพิ่มไม่ได้
  const can = (role === "admin" || role === "production") && (["queued", "setup", "running"].includes(wo.status) || (wo.status === "done" && netExtra > 0.0005));
  const pending = Number(wo.pendingExtraCost) || 0;
  if (!can && !list.length) return null;
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <div>
          <div className="card-title">เบิกวัตถุดิบเพิ่ม / คืนวัตถุดิบ</div>
          <div className="card-sub">ใช้วัตถุดิบเกินสูตร (เช่น ล้างเครื่อง เปลี่ยนสี ของเสีย) — ตัดสต๊อกทันที และรวมเข้าต้นทุนต่อชิ้นตอนบันทึกผลิตครั้งถัดไป
            {pending !== 0 && <> · <b>รอรวมต้นทุน {baht(pending, 2)}</b></>}</div>
        </div>
        <div className="card-actions">
          {can && <button className="btn btn-outline btn-sm" onClick={() => setOpen(true)}><I.Boxes size={13}/> เบิกเพิ่ม / คืน</button>}
        </div>
      </div>
      {list.length > 0 && (
        <div style={{ padding: "0 18px 14px" }}>
          <table className="table" style={{ fontSize: 12.5 }}>
            <thead><tr><th>เวลา</th><th>รายการ</th><th>วัตถุดิบ</th><th className="num">จำนวน</th><th className="num">มูลค่า</th><th>เหตุผล / โดย</th></tr></thead>
            <tbody>{list.map((e, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: "nowrap" }}>{e.at}</td>
                <td><span className={"badge " + (e.kind === "RETURN" ? "badge-success" : "badge-warning")}>{e.kind === "RETURN" ? "คืน" : "เบิกเพิ่ม"}</span></td>
                <td>{e.name}<div className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{e.code}</div></td>
                <td className="num">{e.kind === "RETURN" ? "−" : "+"}{_fmt(e.qty, 3)} {e.unit}</td>
                <td className="num">{e.kind === "RETURN" ? "−" : ""}{baht(e.value, 2)}</td>
                <td>{e.reason}<div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{e.by}</div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {open && <ExtraMaterialModal wo={wo} onClose={() => setOpen(false)}/>}
    </div>
  );
}

function ExtraMaterialModal({ wo, onClose }) {
  const mats = MATERIALS.filter((m) => m.active !== false);
  const closed = wo.status === "done";
  const [kind, setKind] = useState(closed ? "RETURN" : "ISSUE");
  const [item, setItem] = useState(mats[0] ? mats[0].id : "");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const m = mats.find((x) => x.id === item);
  const net = (wo.extraIssues || []).filter((e) => e.item === item).reduce((t, e) => t + (e.kind === "RETURN" ? -e.qty : e.qty), 0);
  const submit = async () => {
    setErr("");
    if (!m) return setErr("เลือกวัตถุดิบ");
    if (!(Number(qty) > 0)) return setErr("ระบุจำนวนมากกว่า 0");
    if (!reason.trim()) return setErr("ระบุเหตุผล");
    setBusy(true);
    try {
      await Store.woMaterial(wo.id, item, Number(qty), kind, reason.trim());
      notify(kind === "ISSUE" ? `เบิก ${m.code} เพิ่ม ${qty} ${m.unit} เข้า ${wo.id} แล้ว` : `คืน ${m.code} ${qty} ${m.unit} จาก ${wo.id} แล้ว`, "success");
      onClose();
    } catch (e) { setErr(e && e.message ? e.message : String(e)); setBusy(false); }
  };
  return (
    <ErpModal title={"เบิกเพิ่ม / คืนวัตถุดิบ · " + wo.id} width={520} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" disabled={busy} onClick={submit}>บันทึก</button></>}>
      <div style={{ display: "flex", gap: 14, marginBottom: 10, fontSize: 13 }}>
        {!closed && <label><input type="radio" checked={kind === "ISSUE"} onChange={() => setKind("ISSUE")}/> เบิกเพิ่ม (ตัดสต๊อก)</label>}
        <label><input type="radio" checked={kind === "RETURN"} onChange={() => setKind("RETURN")}/> คืนวัตถุดิบ (เข้าสต๊อก)</label>
      </div>
      <label className="field-label">วัตถุดิบ</label>
      <select className="select" value={item} onChange={(e) => setItem(e.target.value)} style={{ marginBottom: 8 }}>
        {mats.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name} (คงเหลือ {_fmt(x.stock)} {x.unit})</option>)}
      </select>
      <label className="field-label">จำนวน {m ? "(" + m.unit + ")" : ""}</label>
      <input className="input num" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} style={{ marginBottom: 4 }}/>
      {kind === "RETURN" && <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 8 }}>คืนได้สูงสุด {_fmt(Math.max(0, net), 3)} {m ? m.unit : ""} (ยอดที่เบิกเพิ่มไว้ในใบนี้)</div>}
      <label className="field-label" style={{ marginTop: 8 }}>เหตุผล *</label>
      <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ล้างเครื่องเปลี่ยนสี / ของเสียเกินคาด / คืนส่วนที่ไม่ได้ใช้"/>
      <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 8 }}>เบิก ณ ต้นทุนถัวเฉลี่ยปัจจุบัน · คืน ณ ต้นทุนเฉลี่ยของที่เบิกไป · ใบที่ปิดแล้วคืนได้อย่างเดียว (ต้นทุนสินค้าจะลดตามมูลค่าที่คืน)</div>
      {err && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

function ProductionRecorder({ wo, onProduce }) {
  const remaining = Math.max(0, wo.quantity - (wo.produced || 0));
  const [qty, setQty] = useState("");
  const [ng, setNg] = useState("");
  const bom = _bomOfWo(wo);
  const [busy, setBusy] = useState(false);
  const sh = Store.woShortage(wo);
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
            {(sh.anyShort || sh.anyWait) && (() => {
              const bad = sh.anyShort;
              const color = bad ? "var(--danger)" : "var(--amber)";
              const list = sh.rows.filter((r) => r.deficit > 0.0005);
              const cols = "1fr 78px 82px 78px 82px 78px";
              return (
                <div style={{ marginBottom: 12, border: "1px solid " + color, borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ padding: "9px 12px", background: bad ? "var(--danger-subtle, #fee2e2)" : "var(--amber-subtle)", color, fontSize: 12.5, fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}>
                    <I.Alert size={14}/> {bad
                      ? "วัตถุดิบไม่พอสำหรับใบสั่งผลิตที่เปิดอยู่ทั้งหมด — ต้องเพิ่มสต๊อก"
                      : "สั่งซื้อวัตถุดิบแล้ว รอรับของ (" + sh.orders.join(", ") + ")"}
                    {" · "}ผลิตได้ก่อน {_fmt(sh.maxPieces)} จาก {_fmt(sh.remaining)} ชิ้นด้วยสต๊อกที่มี
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, padding: "6px 12px", background: "var(--bg-subtle)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>
                    <div>วัตถุดิบ</div><div style={{ textAlign: "right" }}>ใบนี้ใช้</div><div style={{ textAlign: "right" }}>ทุกใบรวม</div><div style={{ textAlign: "right" }}>สต๊อก</div><div style={{ textAlign: "right" }}>สั่งไว้แล้ว</div><div style={{ textAlign: "right" }}>ขาด</div>
                  </div>
                  {list.map((r, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: cols, gap: 8, padding: "6px 12px", borderTop: "1px solid var(--border)", fontSize: 12.5 }}>
                      <div><b style={{ fontWeight: 500 }}>{r.name}</b> <span className="mono" style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{r.code}</span></div>
                      <div className="num" style={{ textAlign: "right" }}>{_fmt(r.need, 1)}</div>
                      <div className="num" style={{ textAlign: "right" }}>{_fmt(r.committed, 1)}</div>
                      <div className="num" style={{ textAlign: "right" }}>{_fmt(r.stock, 1)}</div>
                      <div className="num" style={{ textAlign: "right", color: r.incoming > 0 ? "var(--info, #2563eb)" : "var(--text-tertiary)" }}>{r.incoming > 0 ? _fmt(r.incoming, 1) : "—"}</div>
                      <div className="num" style={{ textAlign: "right", color: r.short > 0.0005 ? "var(--danger)" : "var(--text-tertiary)", fontWeight: 600 }}>{r.short > 0.0005 ? _fmt(r.short, 1) : "0"}</div>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderTop: "1px solid var(--border)", flexWrap: "wrap", alignItems: "center" }}>
                    {bad && <button type="button" className="btn btn-primary btn-sm" onClick={() => createPOFromShortage(wo, sh.rows.filter((r) => r.short > 0.0005).map((r) => ({ m: r.m, kg: r.short, available: 0 })))}><I.Boxes size={13}/> สร้างใบสั่งซื้อวัตถุดิบที่ขาด</button>}
                    {sh.maxPieces > 0 && <button type="button" className="btn btn-outline btn-sm" onClick={() => setQty(String(sh.maxPieces))}>ผลิตเท่าที่ทำได้ ({_fmt(sh.maxPieces)} ชิ้น)</button>}
                    <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>ตัวเลข "ขาด" คิดรวมทุกใบสั่งผลิตที่เปิดอยู่ ไม่มีลำดับก่อนหลัง</span>
                  </div>
                </div>
              );
            })()}
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
            {MACHINES.filter((m) => Store.machineUsable(m)).map((m) => <option key={m.id} value={m.id}>{m.id} · {m.tonnage} ตัน{m.condition === "due" ? " (ควรซ่อมบำรุง)" : ""}</option>)}
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
          <DateInput className="input" value={date} onChange={(e) => setDate(e.target.value)}/>
        </div>
        <div>
          <label className="field-label">กำหนดส่ง</label>
          <DateInput className="input" value={due} onChange={(e) => setDue(e.target.value)}/>
        </div>
      </div>

      {(() => {
        const mc = MACHINES.find((x) => x.id === machine), mo = MOLDS.find((x) => x.id === mold);
        const warns = Store.machineFit(mc, mo);
        if (mc && mc.condition === "due") warns.unshift("เครื่อง " + mc.id + " ควรซ่อมบำรุง" + (mc.conditionReason ? ": " + mc.conditionReason : ""));
        if (!warns.length) return null;
        return (
          <div style={{ marginTop: 14, padding: "9px 12px", borderRadius: 8, background: "var(--amber-subtle)", color: "var(--amber)", fontSize: 12.5 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}><I.Alert size={13} style={{ verticalAlign: "middle" }}/> คำเตือน (เปิดใบสั่งผลิตต่อได้)</div>
            {warns.map((w, i) => <div key={i}>• {w}</div>)}
          </div>
        );
      })()}
      <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-outline" onClick={onCancel}>ยกเลิก</button>
        <button type="submit" className="btn btn-primary" disabled={!valid}><I.Check size={14}/> เปิดใบสั่งผลิต</button>
      </div>
    </form>
  );
}

window.PageProduction = PageProduction;
