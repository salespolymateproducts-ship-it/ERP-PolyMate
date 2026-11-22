/* global React, I, MOLDS, ROLES, PageHeader, Drawer, _fmt, Store, useStore, runAction, ErpModal, moldNextPM */

function PageMolds() {
  const [tab, setTab] = useState("GRID");
  const [open, setOpen] = useState(null);
  const [flt, setFlt] = useState("ALL");
  const [addOpen, setAddOpen] = useState(false);
  const [maint, setMaint] = useState(null);
  const [repairOpen, setRepairOpen] = useState(null);
  const [start, setStart] = useState(null);
  useStore();
  const role = Store.user() ? ROLES[Store.user().role] : null;
  const canEdit = role && (role.canEdit === "*" || (role.canEdit || []).includes("molds"));
  const moldMatch = (m) => flt === "ALL" || (flt === "DUE" ? (m.status === "maintenance" || m.status === "alert" || (m.life && m.shots / m.life >= 0.9) || moldNextPM(m) <= Store.today()) : m.status === flt);
  // ค้นหา (รหัส/ชื่อ/ลูกค้า/ขนาด) · สถานะ (เมนูด้านบน) · เรียง · แบ่งหน้า (การ์ดหน้าละ 24)
  const view = useListView(MOLDS, {
    text: (m) => [m.code, m.name, m.customer, m.size, m.material].join(" "),
    filter: moldMatch, filterKey: flt, pageSize: 24,
    defaultSort: { key: "code", dir: "asc" },
    sorts: { code: (m) => m.code, name: (m) => m.name, life: (m) => (m.life ? m.shots / m.life : 0), maint: (m) => m.lastMaint || "", shots: (m) => m.shots || 0 },
  });
  const list = view.sorted;
  const liveOpen = open ? MOLDS.find((m) => m.id === open.id) || open : null;
  return (
    <>
      <PageHeader
        title="แม่พิมพ์ (Mold Library)"
        subtitle="คลังแม่พิมพ์ · ประวัติการใช้งาน · จำนวน Shot · แจ้งเตือน Maintenance"
        actions={
          <>
            <select className="input" style={{ width: 190 }} aria-label="กรองสถานะ" value={flt} onChange={(e) => setFlt(e.target.value)}>
              <option value="ALL">ทุกสถานะ</option><option value="DUE">ถึงกำหนดซ่อมบำรุง</option>
              {Object.entries(MOLD_STATUS_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}><I.Plus size={14}/> เพิ่มแม่พิมพ์</button>}
          </>
        }
      />

      <window.Tabs
        items={[
          { id: "GRID", label: "คลังแม่พิมพ์", count: MOLDS.length },
          { id: "CAL", label: "ปฏิทินบำรุงรักษา" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "GRID" && (<>
      <div className="card" style={{ marginBottom: 12 }}>
        <ListToolbar view={view} placeholder="รหัส / ชื่อแม่พิมพ์ / ลูกค้า…">
          <select className="select" style={{ width: 210 }} aria-label="เรียงตาม" value={view.sort ? view.sort.key + ":" + view.sort.dir : "code:asc"} onChange={(e) => { const [key, dir] = e.target.value.split(":"); view.setSort({ key, dir }); }}>
            <option value="code:asc">เรียง: รหัส</option><option value="name:asc">เรียง: ชื่อ</option><option value="life:desc">เรียง: ใช้ไปมากสุด (% อายุ)</option><option value="shots:desc">เรียง: Shot มากสุด</option><option value="maint:asc">เรียง: บำรุงรักษาเก่าสุด</option>
          </select>
        </ListToolbar>
      </div>
      <div className="grid-3">
        {view.pageRows.map((m) => {
          const lifePct = (m.shots / m.life) * 100;
          const tone = m.status === "in-use" ? "var(--success)" :
                       m.status === "available" ? "var(--text-secondary)" :
                       m.status === "maintenance" ? "var(--amber)" : "var(--danger)";
          const label = ({ "in-use": "กำลังใช้", "available": "พร้อมใช้", "maintenance": "บำรุงรักษา", "alert": "แจ้งเตือน" })[m.status];
          return (
            <div key={m.id} className="card" style={{ overflow: "hidden", cursor: "pointer" }} onClick={() => setOpen(m)}>
              {/* Mold "photo" — schematic SVG since no real images */}
              <div style={{ background: "linear-gradient(135deg,#1A2236,#0B1220)", height: 160, position: "relative", display: "grid", placeItems: "center" }}>
                <MoldSchematic cavities={m.cavities}/>
                <div style={{ position: "absolute", left: 12, top: 12 }}>
                  <span className="badge" style={{ background: "rgba(255,255,255,0.12)", color: "#fff", backdropFilter: "blur(4px)" }}>
                    <span className="b-dot" style={{ background: tone }}/> {label}
                  </span>
                </div>
                <div style={{ position: "absolute", right: 12, top: 12, fontSize: 10.5, fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.5)" }}>
                  {m.size}
                </div>
                <div style={{ position: "absolute", left: 12, bottom: 10, fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
                  {m.cavities} cavities · {m.weight}kg
                </div>
              </div>
              <div style={{ padding: 14 }}>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-secondary)" }}>{m.code}</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{m.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 4 }}>
                  ลูกค้า: <b style={{ color: "var(--text-primary)" }}>{m.customer}</b> · {m.machineMin}–{m.machineMax}T
                </div>

                <div style={{ marginTop: 12 }}>
                  <div className="num" style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 4 }}>
                    <span>อายุการใช้งาน (Shots)</span>
                    <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>{_fmt(m.shots)} / {_fmt(m.life)}</span>
                  </div>
                  <div style={{ height: 6, background: "var(--bg-subtle)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: lifePct + "%", height: "100%", background: lifePct > 70 ? "var(--amber)" : "var(--accent)" }}/>
                  </div>
                </div>

                <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
                  <I.Wrench size={12}/> บำรุงรักษาล่าสุด: {m.lastMaint}
                </div>
              </div>
            </div>
          );
        })}
        {!view.total && <div className="card" style={{ gridColumn: "1 / -1", padding: 32, textAlign: "center", color: "var(--text-tertiary)" }}>{MOLDS.length ? "ไม่พบแม่พิมพ์ตามเงื่อนไข" : "ยังไม่มีแม่พิมพ์"}</div>}
      </div>
      {view.total > 0 && <div className="card" style={{ marginTop: 12 }}><Pager view={view}/></div>}
      </>)}
      {tab === "CAL" && <window.MaintenanceCalendar/>}

      <Drawer open={!!liveOpen} onClose={() => setOpen(null)} title={liveOpen && liveOpen.name} width={680}
        footer={liveOpen && canEdit && <>
          <select className="input" style={{ width: 170 }} aria-label="สถานะแม่พิมพ์" value={liveOpen.status} onChange={(e) => runAction(() => Store.update("molds", liveOpen.id, { status: e.target.value }, "id", "สถานะ → " + MOLD_STATUS_TH[e.target.value]), "อัปเดตสถานะแล้ว")}>
            {Object.entries(MOLD_STATUS_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          {liveOpen.repair
            ? <>{liveOpen.repair.status === "waiting" && <button className="btn btn-outline btn-sm" onClick={() => setStart(liveOpen)}>เริ่มซ่อม</button>}
                <button className="btn btn-primary btn-sm" onClick={() => setMaint(liveOpen)}><I.Check size={13}/> ซ่อมเสร็จ / ปิดใบแจ้งซ่อม</button></>
            : <><button className="btn btn-outline btn-sm" onClick={() => setMaint(liveOpen)}><I.Wrench size={13}/> บันทึกซ่อมที่ทำเสร็จแล้ว</button>
                <button className="btn btn-primary btn-sm" onClick={() => setRepairOpen(liveOpen)}><I.Wrench size={13}/> แจ้งซ่อม</button></>}</>}>
        {liveOpen && liveOpen.repair && <RepairTicket r={liveOpen.repair}/>}
        {liveOpen && <MoldDetail m={liveOpen}/>}
        {liveOpen && (liveOpen.maintLog || []).length > 0 && <div style={{ padding: "0 20px 20px" }}><div className="card"><div className="card-head"><div className="card-title">ประวัติซ่อมบำรุง ({liveOpen.maintLog.length})</div></div>
          <div style={{ padding: "0 18px 8px" }}>{liveOpen.maintLog.map((x, i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
              <div style={{ width: 4, alignSelf: "stretch", background: "var(--accent-subtle)", borderRadius: 99 }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{x.symptom ? x.symptom + " — " + x.note : x.note}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 2 }}>{x.date}{x.type ? " · " + x.type : ""}{x.downDays != null ? " · หยุดใช้ " + _fmt(x.downDays) + " วัน" : ""} · Shot {_fmt(x.shotsAt || 0)}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>ผู้สั่งซ่อม {x.orderedBy || "—"} · ผู้ซ่อม {x.repairedBy || "—"} · บันทึกโดย {x.by}</div>
              </div>
              <div className="num" style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>฿{_fmt(x.cost || 0)}</div>
            </div>))}</div></div></div>}
      </Drawer>
      {addOpen && <MoldForm onClose={() => setAddOpen(false)}/>}
      {maint && <MoldMaintModal m={maint} onClose={() => setMaint(null)}/>}
      {repairOpen && <MoldRepairOpenModal m={repairOpen} onClose={() => setRepairOpen(null)}/>}
      {start && <MoldRepairStartModal m={start} onClose={() => setStart(null)}/>}
    </>
  );
}

const MOLD_STATUS_TH = { available: "พร้อมใช้", "in-use": "ใช้งานอยู่", maintenance: "ซ่อมบำรุง", alert: "ต้องตรวจสอบ" };
// เพิ่มแม่พิมพ์
function MoldForm({ onClose }) {
  const [f, setF] = useState({ code: "", name: "", customer: "", cavities: 1, size: "", moldW: 0, moldL: 0, moldT: 0, weight: 0, machineMin: 0, machineMax: 0, life: 500000, location: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "number" ? Number(e.target.value) : e.target.value });
  function save() {
    const ok = runAction(() => {
      if (!f.code.trim() || !f.name.trim()) Store.fail("กรุณาระบุรหัสและชื่อแม่พิมพ์");
      if (MOLDS.some((m) => m.code === f.code.trim())) Store.fail("รหัสแม่พิมพ์ซ้ำ");
      if (!(f.cavities > 0)) Store.fail("จำนวน cavity ต้องมากกว่า 0");
      // ขนาดตัวเลขใช้เตือนเมื่อเลือกคู่เครื่องกับแม่พิมพ์ไม่เข้ากัน; ไม่กรอกขนาดข้อความ = สร้างจากตัวเลข
      if (!f.size.trim() && f.moldW > 0 && f.moldL > 0 && f.moldT > 0) f.size = `${f.moldW}×${f.moldL}×${f.moldT} mm`;
      const n = MOLDS.reduce((mx, m) => Math.max(mx, parseInt(String(m.id).replace(/\D/g, ""), 10) || 0), 0) + 1;
      const rec = { ...f, code: f.code.trim(), id: "MLD-" + String(n).padStart(3, "0"), shots: 0, lastMaint: Store.today(), status: "available", maintLog: [] };
      Store.add("molds", rec, rec.code);
      return rec;
    }, (r) => `เพิ่มแม่พิมพ์ ${r.code} แล้ว`);
    if (ok) onClose();
  }
  const fld = (k, l, t = "text") => <div key={k}><label className="field-label">{l}</label><input className="input" type={t} value={f[k]} onChange={set(k)}/></div>;
  return (
    <ErpModal title="เพิ่มแม่พิมพ์" width={600} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={save}>บันทึก</button></>}>
      <div className="grid-2" style={{ gap: 10 }}>
        {fld("code", "รหัสแม่พิมพ์ *")}{fld("name", "ชื่อ *")}
        <div><label className="field-label">ลูกค้า</label><select className="input" value={f.customer} onChange={set("customer")}><option value="">— ของบริษัท —</option>{Store.state.customers.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</select></div>
        {fld("cavities", "จำนวน Cavity", "number")}{fld("weight", "น้ำหนัก (kg)", "number")}
        {fld("moldW", "ความกว้างแม่พิมพ์ (มม.)", "number")}{fld("moldL", "ความยาวแม่พิมพ์ (มม.)", "number")}
        {fld("moldT", "ความหนาแม่พิมพ์ (มม.)", "number")}{fld("size", "ขนาด (ข้อความ ไม่บังคับ)")}
        {fld("machineMin", "เครื่องขั้นต่ำ (ตัน)", "number")}{fld("machineMax", "เครื่องสูงสุด (ตัน)", "number")}
        {fld("life", "อายุการใช้งาน (shots)", "number")}{fld("location", "ที่เก็บ")}
      </div>
    </ErpModal>
  );
}
// บันทึกซ่อมบำรุง → อัปเดตวันซ่อมล่าสุด, สถานะ, ประวัติ และตั้งค่าใช้จ่ายอัตโนมัติ
function MoldMaintModal({ m, onClose }) {
  const [note, setNote] = useState("");
  const [cost, setCost] = useState(0);
  const [resetShots, setResetShots] = useState(false);
  const tk = m.repair || null;
  const [type, setType] = useState(tk ? tk.type : "ซ่อมเสีย");
  const [orderedBy, setOrderedBy] = useState(tk ? tk.orderedBy : Store.userName());
  const [repairedBy, setRepairedBy] = useState(tk ? (tk.repairedBy || "") : "");
  function save() {
    let done = false;
    runAction(() => Store.tx("moldMaint", () => {
      if (!note.trim()) Store.fail("กรุณาระบุรายละเอียดงานซ่อม");
      if (!orderedBy.trim() || !repairedBy.trim()) Store.fail("กรุณาระบุชื่อผู้สั่งซ่อมและผู้ซ่อม");
      const mold = Store.find("molds", m.id);
      mold.maintLog = mold.maintLog || [];
      const t = mold.repair || null;
      const downDays = t ? Math.max(0, Math.round((new Date(Store.today()) - new Date(String(t.openedAt).slice(0, 10))) / 86400000)) : null;
      mold.maintLog.unshift({ date: Store.today(), type, symptom: t ? t.symptom : "", note: note.trim(), orderedBy: orderedBy.trim(), repairedBy: repairedBy.trim(), downDays, cost: Number(cost) || 0, by: Store.userName(), shotsAt: mold.shots });
      mold.lastMaint = Store.today();
      mold.status = "available";
      delete mold.repair;
      if (resetShots) mold.shots = 0;
      if (Number(cost) > 0) {
        const n = Store.nextDocNo("EXP");
        Store.state.expenses.unshift({ id: n.docNo, date: Store.today(), category: "ค่าแม่พิมพ์", vendor: "ซ่อมบำรุงแม่พิมพ์", desc: `ซ่อม ${mold.code}: ${note.trim()}`, amount: Number(cost), vat: 0, whtRate: 0, status: "approved", ref: mold.id, source: "mold" });
      }
      Store.log("MAINT", "แม่พิมพ์", mold.code, note.trim() + (Number(cost) > 0 ? ` · ค่าใช้จ่าย ${cost}` : ""));
      done = true;
    }), "บันทึกการซ่อมบำรุงแล้ว");
    if (done) onClose();
  }
  return (
    <ErpModal title={(tk ? "ปิดใบแจ้งซ่อม " : "บันทึกซ่อมบำรุง ") + m.code} width={480} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={save}>บันทึก</button></>}>
      {tk && <div style={{ marginBottom: 10, fontSize: 12.5, color: "var(--text-secondary)" }}>อาการที่แจ้ง: <b>{tk.symptom}</b></div>}
      <div className="grid-2" style={{ gap: 10, marginBottom: 10 }}>
        <div><label className="field-label">ผู้สั่งซ่อม *</label><input className="input" maxLength={100} value={orderedBy} onChange={(e) => setOrderedBy(e.target.value)}/></div>
        <div><label className="field-label">ผู้ซ่อม *</label><input className="input" maxLength={100} placeholder="พิมพ์ชื่อ" value={repairedBy} onChange={(e) => setRepairedBy(e.target.value)}/></div>
      </div>
      <label className="field-label">ประเภทงาน</label>
      <select className="input" style={{ marginBottom: 10 }} value={type} onChange={(e) => setType(e.target.value)}>{MOLD_REPAIR_TYPES.map((x) => <option key={x}>{x}</option>)}</select>
      <label className="field-label">รายละเอียดงาน *</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)}/>
      <label className="field-label" style={{ marginTop: 10 }}>ค่าใช้จ่าย (บาท) — บันทึกเข้าค่าใช้จ่ายอัตโนมัติ</label><input className="input num" type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)}/>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginTop: 10 }}><input type="checkbox" checked={resetShots} onChange={(e) => setResetShots(e.target.checked)}/> ยกเครื่อง / เปลี่ยนชิ้นส่วนหลัก (รีเซ็ตจำนวน shot)</label>
    </ErpModal>
  );
}

const MOLD_REPAIR_TYPES = ["ซ่อมเสีย", "PM ตามรอบ", "ปรับปรุง"];

// ใบแจ้งซ่อม: เปิดแล้วแม่พิมพ์สถานะ "ซ่อมบำรุง" และเลือกใช้ในใบสั่งผลิตใหม่ไม่ได้ จนกว่าจะปิดใบ (ซ่อมเสร็จ)
function MoldRepairOpenModal({ m, onClose }) {
  const [symptom, setSymptom] = useState("");
  const [type, setType] = useState("ซ่อมเสีย");
  const [orderedBy, setOrderedBy] = useState(Store.userName());
  function save() {
    let done = false;
    runAction(() => Store.tx("moldRepairOpen", () => {
      if (!symptom.trim()) Store.fail("กรุณาระบุอาการ / งานที่ต้องซ่อม");
      if (!orderedBy.trim()) Store.fail("กรุณาระบุชื่อผู้สั่งซ่อม");
      const mold = Store.find("molds", m.id);
      if (mold.repair) Store.fail("แม่พิมพ์นี้มีใบแจ้งซ่อมเปิดอยู่แล้ว");
      mold.repair = { openedAt: Store.today(), symptom: symptom.trim(), type, orderedBy: orderedBy.trim(), reportedBy: Store.userName(), status: "waiting" };
      mold.status = "maintenance";
      Store.log("MAINT", "แม่พิมพ์", mold.code, "แจ้งซ่อม: " + symptom.trim() + " · ผู้สั่ง " + orderedBy.trim());
      done = true;
    }), "เปิดใบแจ้งซ่อมแล้ว");
    if (done) onClose();
  }
  return (
    <ErpModal title={"แจ้งซ่อมแม่พิมพ์ " + m.code} width={480} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={save}>เปิดใบแจ้งซ่อม</button></>}>
      <div className="grid-2" style={{ gap: 10, marginBottom: 10 }}>
        <div><label className="field-label">ผู้สั่งซ่อม *</label><input className="input" maxLength={100} value={orderedBy} onChange={(e) => setOrderedBy(e.target.value)}/></div>
        <div><label className="field-label">ประเภทงาน</label><select className="input" value={type} onChange={(e) => setType(e.target.value)}>{MOLD_REPAIR_TYPES.map((x) => <option key={x}>{x}</option>)}</select></div>
      </div>
      <label className="field-label">อาการ / งานที่ต้องซ่อม *</label><input className="input" placeholder="เช่น ชิ้นงานมีครีบ, ชิ้นงานติดแม่พิมพ์, น้ำรั่ว" value={symptom} onChange={(e) => setSymptom(e.target.value)}/>
      <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--text-tertiary)" }}>เมื่อเปิดใบ แม่พิมพ์จะถูกตั้งเป็น "ซ่อมบำรุง" และเลือกในใบสั่งผลิตใหม่ไม่ได้จนกว่าจะปิดใบแจ้งซ่อม</div>
    </ErpModal>
  );
}

function MoldRepairStartModal({ m, onClose }) {
  const [by, setBy] = useState("");
  function save() {
    let done = false;
    runAction(() => Store.tx("moldRepairStart", () => {
      if (!by.trim()) Store.fail("กรุณาระบุชื่อผู้ซ่อม");
      const mold = Store.find("molds", m.id);
      if (!mold.repair) Store.fail("ไม่มีใบแจ้งซ่อมที่เปิดอยู่");
      mold.repair.status = "repairing"; mold.repair.repairedBy = by.trim(); mold.repair.startedAt = Store.today();
      Store.log("MAINT", "แม่พิมพ์", mold.code, "เริ่มซ่อม · ผู้ซ่อม " + by.trim());
      done = true;
    }), "เริ่มซ่อมแล้ว");
    if (done) onClose();
  }
  return (
    <ErpModal title={"เริ่มซ่อม " + m.code} width={420} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={save}>เริ่มซ่อม</button></>}>
      <label className="field-label">ผู้ซ่อม *</label><input className="input" maxLength={100} placeholder="พิมพ์ชื่อ" value={by} onChange={(e) => setBy(e.target.value)}/>
    </ErpModal>
  );
}

function RepairTicket({ r }) {
  return (
    <div style={{ margin: "0 20px 16px", padding: "12px 14px", borderRadius: 10, background: "var(--amber-subtle)", color: "var(--text-primary)", fontSize: 13 }}>
      <div style={{ fontWeight: 600, color: "var(--amber)", marginBottom: 6 }}>ใบแจ้งซ่อมที่เปิดอยู่ · {r.status === "repairing" ? "กำลังซ่อม" : "รอซ่อม"} · {r.type}</div>
      <div>อาการ: <b>{r.symptom}</b></div>
      <div style={{ color: "var(--text-secondary)", marginTop: 4 }}>แจ้งเมื่อ {r.openedAt} · ผู้สั่งซ่อม {r.orderedBy}{r.repairedBy ? " · ผู้ซ่อม " + r.repairedBy : " · ยังไม่มีผู้ซ่อม"}</div>
    </div>
  );
}

function MoldSchematic({ cavities }) {
  // crude top-view: a steel plate with N cavities
  const cols = cavities <= 4 ? 2 : cavities <= 8 ? 4 : 4;
  const rows = Math.ceil(cavities / cols);
  return (
    <svg viewBox="0 0 200 110" width="80%" height="80%">
      <defs>
        <linearGradient id="steel" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#475569"/>
          <stop offset="100%" stopColor="#1E293B"/>
        </linearGradient>
        <radialGradient id="cav" cx="0.5" cy="0.4" r="0.6">
          <stop offset="0%" stopColor="#94A3B8"/>
          <stop offset="100%" stopColor="#0B1220"/>
        </radialGradient>
      </defs>
      <rect x="6" y="10" width="188" height="90" rx="6" fill="url(#steel)" stroke="#64748B" strokeWidth="0.5"/>
      {[10, 56, 102, 148, 184].map((x, i) => <circle key={i} cx={x} cy={i % 2 ? 100 : 14} r="2" fill="#0B1220"/>)}
      <circle cx="18" cy="14" r="2" fill="#0B1220"/>
      <circle cx="182" cy="14" r="2" fill="#0B1220"/>
      <circle cx="18" cy="100" r="2" fill="#0B1220"/>
      <circle cx="182" cy="100" r="2" fill="#0B1220"/>
      {[...Array(cavities)].map((_, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const w = 160 / cols, h = 60 / rows;
        const cx = 22 + col * w + w / 2;
        const cy = 30 + row * h + h / 2;
        return <ellipse key={i} cx={cx} cy={cy} rx={Math.min(w, h) * 0.32} ry={Math.min(w, h) * 0.32} fill="url(#cav)"/>;
      })}
      <line x1="100" y1="14" x2="100" y2="100" stroke="#38BDF8" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.4"/>
    </svg>
  );
}

function MoldDetail({ m }) {
  const lifePct = (m.shots / m.life) * 100;
  return (
    <div style={{ padding: 20 }}>
      <div style={{ background: "linear-gradient(135deg,#1A2236,#0B1220)", borderRadius: 12, height: 240, display: "grid", placeItems: "center", marginBottom: 16, position: "relative" }}>
        <MoldSchematic cavities={m.cavities}/>
        <div style={{ position: "absolute", left: 14, top: 14, fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Top view · ระบายความร้อนแบบ Conformal Cooling</div>
        <div style={{ position: "absolute", right: 14, bottom: 14, fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: "var(--font-mono)" }}>{m.code}</div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <KV k="ลูกค้า" v={m.customer}/>
        <KV k="สถานะ" v={m.status}/>
        <KV k="จำนวน Cavities" v={m.cavities + " ช่อง"}/>
        <KV k="ขนาดแม่พิมพ์" v={m.size}/>
        <KV k="น้ำหนัก" v={m.weight + " kg"}/>
        <KV k="เครื่องที่เหมาะสม" v={m.machineMin + "–" + m.machineMax + " ตัน"}/>
        <KV k="ตำแหน่งเก็บ" v={m.location}/>
        <KV k="บำรุงรักษาล่าสุด" v={m.lastMaint}/>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><div className="card-title">อายุการใช้งาน</div></div>
        <div style={{ padding: "12px 18px 18px" }}>
          <div className="num" style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
            <span style={{ color: "var(--text-secondary)" }}>{_fmt(m.shots)} shots</span>
            <span style={{ color: "var(--text-secondary)" }}>เป้าหมาย {_fmt(m.life)} shots</span>
          </div>
          <div style={{ height: 12, background: "var(--bg-subtle)", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ width: lifePct + "%", height: "100%", background: "linear-gradient(90deg,#2D6CDF,#7C3AED)" }}/>
          </div>
          <div className="num" style={{ marginTop: 6, fontSize: 12, color: "var(--text-secondary)" }}>{_fmt(lifePct, 1)}% ของอายุการใช้งาน · คาดบำรุงรักษาครั้งถัดไปที่ {_fmt(Math.round(m.shots / 10000) * 10000 + 50000)} shots</div>
        </div>
      </div>
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{v}</div>
    </div>
  );
}

window.PageMolds = PageMolds;
