/* global React, I, MOLDS, ROLES, PageHeader, Drawer, _fmt, Store, useStore, runAction, ErpModal, moldNextPM */

function PageMolds() {
  const [tab, setTab] = useState("GRID");
  const [open, setOpen] = useState(null);
  const [flt, setFlt] = useState("ALL");
  const [addOpen, setAddOpen] = useState(false);
  const [maint, setMaint] = useState(null);
  useStore();
  const role = Store.user() ? ROLES[Store.user().role] : null;
  const canEdit = role && (role.canEdit === "*" || (role.canEdit || []).includes("molds"));
  const list = MOLDS.filter((m) => flt === "ALL" || (flt === "DUE" ? (m.status === "maintenance" || m.status === "alert" || (m.life && m.shots / m.life >= 0.9) || moldNextPM(m) <= Store.today()) : m.status === flt));
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

      {tab === "GRID" && (
      <div className="grid-3">
        {list.map((m) => {
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
      </div>
      )}
      {tab === "CAL" && <window.MaintenanceCalendar/>}

      <Drawer open={!!liveOpen} onClose={() => setOpen(null)} title={liveOpen && liveOpen.name} width={680}
        footer={liveOpen && canEdit && <>
          <select className="input" style={{ width: 170 }} aria-label="สถานะแม่พิมพ์" value={liveOpen.status} onChange={(e) => runAction(() => Store.update("molds", liveOpen.id, { status: e.target.value }, "id", "สถานะ → " + MOLD_STATUS_TH[e.target.value]), "อัปเดตสถานะแล้ว")}>
            {Object.entries(MOLD_STATUS_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button className="btn btn-primary btn-sm" onClick={() => setMaint(liveOpen)}><I.Wrench size={13}/> บันทึกซ่อมบำรุง</button></>}>
        {liveOpen && <MoldDetail m={liveOpen}/>}
        {liveOpen && (liveOpen.maintLog || []).length > 0 && <div style={{ padding: "0 20px 20px" }}><div className="card"><div className="card-head"><div className="card-title">ประวัติซ่อมบำรุง</div></div>
          <table className="table" style={{ fontSize: 12.5 }}><thead><tr><th>วันที่</th><th>รายละเอียด</th><th className="num">Shot ขณะซ่อม</th><th className="num">ค่าใช้จ่าย</th><th>โดย</th></tr></thead>
          <tbody>{liveOpen.maintLog.map((x, i) => <tr key={i}><td>{x.date}</td><td>{x.note}</td><td className="num">{_fmt(x.shotsAt || 0)}</td><td className="num">{_fmt(x.cost || 0)}</td><td>{x.by}</td></tr>)}</tbody></table></div></div>}
      </Drawer>
      {addOpen && <MoldForm onClose={() => setAddOpen(false)}/>}
      {maint && <MoldMaintModal m={maint} onClose={() => setMaint(null)}/>}
    </>
  );
}

const MOLD_STATUS_TH = { available: "พร้อมใช้", "in-use": "ใช้งานอยู่", maintenance: "ซ่อมบำรุง", alert: "ต้องตรวจสอบ" };
// เพิ่มแม่พิมพ์
function MoldForm({ onClose }) {
  const [f, setF] = useState({ code: "", name: "", customer: "", cavities: 1, size: "", weight: 0, machineMin: 0, machineMax: 0, life: 500000, location: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "number" ? Number(e.target.value) : e.target.value });
  function save() {
    const ok = runAction(() => {
      if (!f.code.trim() || !f.name.trim()) Store.fail("กรุณาระบุรหัสและชื่อแม่พิมพ์");
      if (MOLDS.some((m) => m.code === f.code.trim())) Store.fail("รหัสแม่พิมพ์ซ้ำ");
      if (!(f.cavities > 0)) Store.fail("จำนวน cavity ต้องมากกว่า 0");
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
        {fld("cavities", "จำนวน Cavity", "number")}{fld("size", "ขนาด")}{fld("weight", "น้ำหนัก (kg)", "number")}
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
  function save() {
    let done = false;
    runAction(() => Store.tx("moldMaint", () => {
      if (!note.trim()) Store.fail("กรุณาระบุรายละเอียดงานซ่อม");
      const mold = Store.find("molds", m.id);
      mold.maintLog = mold.maintLog || [];
      mold.maintLog.unshift({ date: Store.today(), note: note.trim(), cost: Number(cost) || 0, by: Store.userName(), shotsAt: mold.shots });
      mold.lastMaint = Store.today();
      mold.status = "available";
      if (resetShots) mold.shots = 0;
      if (Number(cost) > 0) {
        const n = Store.nextDocNo("EXP");
        Store.state.expenses.unshift({ id: n.docNo, date: Store.today(), category: "ค่าแม่พิมพ์", vendor: "ซ่อมบำรุงแม่พิมพ์", desc: `ซ่อม ${mold.code}: ${note.trim()}`, amount: Number(cost), vat: 0, whtRate: 0, status: "approved", ref: mold.id });
      }
      Store.log("MAINT", "แม่พิมพ์", mold.code, note.trim() + (Number(cost) > 0 ? ` · ค่าใช้จ่าย ${cost}` : ""));
      done = true;
    }), "บันทึกการซ่อมบำรุงแล้ว");
    if (done) onClose();
  }
  return (
    <ErpModal title={"บันทึกซ่อมบำรุง " + m.code} width={480} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={save}>บันทึก</button></>}>
      <label className="field-label">รายละเอียดงาน *</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)}/>
      <label className="field-label" style={{ marginTop: 10 }}>ค่าใช้จ่าย (บาท) — บันทึกเข้าค่าใช้จ่ายอัตโนมัติ</label><input className="input num" type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)}/>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginTop: 10 }}><input type="checkbox" checked={resetShots} onChange={(e) => setResetShots(e.target.checked)}/> ยกเครื่อง / เปลี่ยนชิ้นส่วนหลัก (รีเซ็ตจำนวน shot)</label>
    </ErpModal>
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

      <div className="card">
        <div className="card-head"><div className="card-title">ประวัติบำรุงรักษา</div></div>
        <div style={{ padding: "4px 18px 12px" }}>
          {[
            { date: m.lastMaint, type: "ทำความสะอาด + เปลี่ยน O-Ring", by: "ช่างธีรพงศ์", cost: 8500 },
            { date: "2026-01-12", type: "ปรับ Cooling Channel", by: "Cosmoplast Mold", cost: 24000 },
            { date: "2025-09-28", type: "ทำความสะอาดทั่วไป", by: "ช่างธีรพงศ์", cost: 3200 },
            { date: "2025-05-04", type: "เปลี่ยน Insert Cavity #2", by: "Cosmoplast Mold", cost: 18500 },
          ].map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ width: 4, alignSelf: "stretch", background: "var(--accent-subtle)", borderRadius: 99 }}/>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{r.type}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{r.date} · โดย {r.by}</div>
              </div>
              <div className="num" style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>฿{_fmt(r.cost)}</div>
            </div>
          ))}
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
