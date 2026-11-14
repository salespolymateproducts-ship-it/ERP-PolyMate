/* global React, I, MATERIALS, FINISHED, JOB_TYPES, CUSTOMERS, STOCK_MOVEMENTS, ROLES, Drawer, Store, useStore, PageHeader, Tabs, baht, _fmt, exportCSV, notify, runAction, ErpModal */

function PageInventory() {
  const [tab, setTab] = useState("MAT");
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [adjOpen, setAdjOpen] = useState(false);
  useStore();
  const role = Store.user() ? ROLES[Store.user().role] : null;
  const canEdit = role && (role.canEdit === "*" || (role.canEdit || []).includes("inventory") || (role.canEdit || []).includes("production"));

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  const matLow = MATERIALS.filter((m) => m.stock < m.min).length;
  const totalValue = MATERIALS.reduce((s, m) => s + m.stock * m.cost, 0)
    + FINISHED.reduce((s, f) => s + f.stock * f.cost, 0);

  return (
    <>
      <PageHeader
        title="คลังสินค้า / สต๊อก"
        subtitle="เม็ดพลาสติก · สี · เหล็ก · บรรจุภัณฑ์ · สินค้าสำเร็จรูป"
        actions={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => printReport("รายงานสินค้าคงคลัง")}><I.Printer size={14}/> พิมพ์ / PDF</button>
            <button className="btn btn-outline btn-sm" onClick={() => exportCSV(`สต๊อก-${Store.today()}.csv`, ["ประเภท", "รหัส", "ชื่อ", "คงเหลือ", "หน่วย", "ขั้นต่ำ", "ต้นทุน/หน่วย", "มูลค่า"], [...MATERIALS.map((m) => ["วัตถุดิบ", m.code, m.name, m.stock, m.unit, m.min, m.cost, m.stock * m.cost]), ...FINISHED.map((f) => ["สินค้าสำเร็จรูป", f.code, f.name, f.stock, f.unit || "PCS", "", f.cost, f.stock * f.cost])])}><I.Download size={14}/> ส่งออก CSV</button>
            {canEdit && <button className="btn btn-outline btn-sm" onClick={() => setAdjOpen(true)}><I.Upload size={14}/> รับเข้า / ปรับยอด</button>}
            <button className="btn btn-primary btn-sm" onClick={() => { setTab("FG"); setAddOpen(true); }}><I.Plus size={14}/> เพิ่มสินค้า</button>
          </>
        }
      />

      <div className="grid-4" style={{ marginBottom: 14 }}>
        <SmallStat label="มูลค่าสต๊อกรวม" value={baht(totalValue)} tone="accent" icon="Boxes"/>
        <SmallStat label="วัตถุดิบที่มี" value={_fmt(MATERIALS.length)} unit="รายการ" tone="violet" icon="Package"/>
        <SmallStat label="สินค้าสำเร็จรูป" value={_fmt(FINISHED.length)} unit="SKU" tone="success" icon="Boxes"/>
        <SmallStat label="ใกล้หมด" value={_fmt(matLow + FINISHED.filter((f) => f.stock <= 0).length)} unit="รายการ" tone="amber" icon="Alert" alert/>
      </div>

      <Tabs
        items={[
          { id: "MAT", label: "เม็ดพลาสติก / สี / เหล็ก", count: MATERIALS.length },
          { id: "FG", label: "สินค้าสำเร็จรูป", count: FINISHED.length },
          { id: "BOM", label: "BOM (สูตรการผลิต)" },
          { id: "MOVE", label: "Stock Movement" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "MAT" && <MaterialTable/>}
      {tab === "FG" && <FinishedTable onAdd={() => setAddOpen(true)}/>}
      {tab === "BOM" && <window.BOMViewer/>}
      {tab === "MOVE" && <Movement/>}

      {adjOpen && <StockAdjustModal onClose={() => setAdjOpen(false)}/>}
      <Drawer open={addOpen} onClose={() => setAddOpen(false)} title="เพิ่มสินค้าสำเร็จรูป" width={620}>
        {addOpen && <AddProductForm
          onCancel={() => setAddOpen(false)}
          onSubmit={(rec) => { if (FINISHED.some((f) => f.code === rec.code)) { notify("รหัสสินค้านี้มีอยู่แล้ว", "error"); return; } Store.add("finished", rec, rec.code); setAddOpen(false); showToast(`เพิ่มสินค้า ${rec.code} เรียบร้อย`); }}
        />}
      </Drawer>

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 100,
          background: "var(--text-primary)", color: "white", padding: "12px 18px",
          borderRadius: 10, boxShadow: "var(--shadow-lg)", fontSize: 13, fontWeight: 500,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <I.Check size={16}/> {toast}
        </div>
      )}
    </>
  );
}

function SmallStat({ label, value, unit, tone, icon, alert }) {
  const Ico = I[icon] || I.Boxes;
  const c = ({
    accent: { c: "var(--accent)", b: "var(--accent-subtle)" },
    violet: { c: "var(--violet)", b: "var(--violet-subtle)" },
    success: { c: "var(--success)", b: "var(--success-subtle)" },
    amber: { c: "var(--amber)", b: "var(--amber-subtle)" },
  })[tone];
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: c.b, color: c.c, display: "grid", placeItems: "center", position: "relative" }}>
          <Ico size={15}/>
          {alert && <span style={{ position: "absolute", top: -3, right: -3, width: 8, height: 8, borderRadius: 99, background: "var(--danger)", border: "2px solid var(--bg-elevated)" }}/>}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</div>
          <div className="num" style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", marginTop: 2 }}>
            {value}{unit && <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 400, marginLeft: 4 }}>{unit}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// รับเข้า / เบิกออก / ปรับยอดสต๊อกด้วยมือ (ต้องระบุเหตุผล — บันทึก Stock Movement + Audit Log)
function StockAdjustModal({ onClose }) {
  const items = [...Store.state.materials.map((m) => ({ code: m.code, name: m.name, unit: m.unit, stock: m.stock })),
    ...Store.state.finished.map((f) => ({ code: f.code, name: f.name, unit: f.unit || "PCS", stock: f.stock }))];
  const [code, setCode] = useState(items[0] ? items[0].code : "");
  const [mode, setMode] = useState("IN");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const it = items.find((x) => x.code === code);
  const delta = mode === "SET" ? (Number(qty) || 0) - (it ? it.stock : 0) : mode === "OUT" ? -(Number(qty) || 0) : (Number(qty) || 0);
  function save() {
    let done = false;
    runAction(() => Store.tx("stockAdjust", () => {
      if (!it) Store.fail("กรุณาเลือกรายการ");
      if (qty === "" || Number(qty) < 0 || (mode !== "SET" && !(Number(qty) > 0))) Store.fail("กรุณาระบุจำนวนที่ถูกต้อง");
      if (!reason.trim()) Store.fail("กรุณาระบุเหตุผล / เลขที่เอกสารอ้างอิง");
      if (delta === 0) Store.fail("ยอดไม่เปลี่ยนแปลง");
      Store.adjustStock(code, delta, "ADJ", ({ IN: "รับเข้า: ", OUT: "เบิกออก: ", SET: "ปรับยอดตามตรวจนับ: " })[mode] + reason.trim());
      Store.log("STOCK", "สต๊อก", code, `${mode} ${delta > 0 ? "+" : ""}${delta} ${it.unit} · ${reason.trim()}`);
      done = true;
    }), "บันทึกการเคลื่อนไหวสต๊อกแล้ว");
    if (done) onClose();
  }
  return (
    <ErpModal title="รับเข้า / เบิกออก / ปรับยอดสต๊อก" width={520} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={save}>บันทึก</button></>}>
      <label className="field-label">รายการ</label>
      <select className="input" value={code} onChange={(e) => setCode(e.target.value)}>{items.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name} (คงเหลือ {_fmt(x.stock)} {x.unit})</option>)}</select>
      <div className="grid-2" style={{ gap: 10, marginTop: 10 }}>
        <div><label className="field-label">ประเภท</label><select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="IN">รับเข้า (+)</option><option value="OUT">เบิกออก (−)</option><option value="SET">ปรับยอดตามตรวจนับ (=)</option></select></div>
        <div><label className="field-label">{mode === "SET" ? "ยอดที่นับได้จริง" : "จำนวน"} ({it ? it.unit : ""})</label><input className="input num" type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)}/></div>
      </div>
      <label className="field-label" style={{ marginTop: 10 }}>เหตุผล / เอกสารอ้างอิง *</label><input className="input" value={reason} onChange={(e) => setReason(e.target.value)}/>
      {it && qty !== "" && <div style={{ fontSize: 12.5, marginTop: 10, color: it.stock + delta < 0 ? "var(--danger)" : "var(--text-secondary)" }}>คงเหลือหลังบันทึก: <b>{_fmt(it.stock + delta)}</b> {it.unit}</div>}
      <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 8 }}>การรับของจากผู้ขายให้ใช้ "รับเข้า" ในเมนูใบสั่งซื้อ · การส่งของให้ลูกค้าตัดสต๊อกอัตโนมัติเมื่ออนุมัติใบส่งสินค้า</div>
    </ErpModal>
  );
}
// แก้ไขต้นทุน/ราคาขายมาตรฐาน (ใช้คำนวณต้นทุนขายในงบกำไรขาดทุน)
function PriceEditModal({ f, onClose }) {
  const [cost, setCost] = useState(f.cost);
  const [price, setPrice] = useState(f.price);
  function save() {
    const ok = runAction(() => {
      if (!(Number(cost) >= 0) || !(Number(price) >= 0)) Store.fail("ราคาต้องไม่ติดลบ");
      return Store.update("finished", f.id, { cost: Number(cost), price: Number(price) }, "id", `ต้นทุน ${f.cost}→${cost} · ราคา ${f.price}→${price}`);
    }, "บันทึกราคาแล้ว");
    if (ok) onClose();
  }
  return (
    <ErpModal title={"ต้นทุน / ราคาขาย " + f.code} width={420} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={save}>บันทึก</button></>}>
      <label className="field-label">ต้นทุนมาตรฐาน / หน่วย</label><input className="input num" type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)}/>
      <label className="field-label" style={{ marginTop: 10 }}>ราคาขาย / หน่วย (ค่าเริ่มต้นในเอกสารขาย)</label><input className="input num" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)}/>
    </ErpModal>
  );
}

function MaterialTable() {
  return (
    <div className="card">
      <div style={{ overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>รหัส</th>
              <th>รายการ</th>
              <th>ประเภท</th>
              <th>ตำแหน่ง</th>
              <th className="num">คงเหลือ</th>
              <th>ระดับสต๊อก</th>
              <th className="num">ราคาทุน</th>
              <th className="num">มูลค่ารวม</th>
              <th>ผู้ขาย</th>
            </tr>
          </thead>
          <tbody>
            {MATERIALS.map((m) => {
              const ratio = (m.stock - m.min) / (m.max - m.min);
              const low = m.stock < m.min;
              const danger = m.stock < m.min * 0.8;
              return (
                <tr key={m.id}>
                  <td className="mono"><b>{m.code}</b></td>
                  <td>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</div>
                  </td>
                  <td><TypeBadge type={m.type}/></td>
                  <td className="mono" style={{ fontSize: 12 }}>{m.location}</td>
                  <td className="num"><b>{_fmt(m.stock)}</b> <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{m.unit}</span></td>
                  <td style={{ minWidth: 160 }}>
                    <StockBar min={m.min} max={m.max} stock={m.stock}/>
                    {low && <div style={{ fontSize: 11, color: danger ? "var(--danger)" : "var(--amber)", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                      <I.Alert size={11}/>ต่ำกว่า Min · ควรสั่งซื้อ
                    </div>}
                  </td>
                  <td className="num">{baht(m.cost, 2)}</td>
                  <td className="num" style={{ fontWeight: 500 }}>{baht(m.stock * m.cost)}</td>
                  <td style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{m.supplier}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TypeBadge({ type }) {
  const map = {
    "เม็ดพลาสติก": "info",
    "สี-เม็ด": "violet",
    "สี-ผง": "warning",
    "เหล็ก": "neutral",
    "บรรจุภัณฑ์": "success",
  };
  return <span className={"badge badge-" + (map[type] || "neutral")}>{type}</span>;
}

function StockBar({ min, max, stock }) {
  const pct = Math.min(100, Math.max(0, (stock / max) * 100));
  const minPct = (min / max) * 100;
  const color = stock < min ? "var(--danger)" : stock < min * 1.3 ? "var(--amber)" : "var(--success)";
  return (
    <div style={{ position: "relative", height: 8, background: "var(--bg-subtle)", borderRadius: 99, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: pct + "%", background: color, borderRadius: 99 }} />
      <div style={{ position: "absolute", left: minPct + "%", top: -1, height: 10, width: 1.5, background: "var(--text-primary)", opacity: 0.6 }} title={`Min: ${min}`}/>
    </div>
  );
}

function JobBadge({ type }) {
  const j = (JOB_TYPES && JOB_TYPES[type]) || null;
  if (!j) return <span style={{ color: "var(--text-tertiary)" }}>—</span>;
  return <span className={"badge badge-" + j.tone}>{j.short}</span>;
}

function FinishedTable({ onAdd }) {
  const [pe, setPe] = useState(null);
  const custName = (code) => {
    const c = CUSTOMERS.find((x) => x.code === code);
    return c ? c.name : (code && code !== "—" ? code : null);
  };
  return (
    <div className="card">
      {pe && <PriceEditModal f={pe} onClose={() => setPe(null)}/>}
      <div style={{ overflow: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th>รหัส</th>
            <th>สินค้า</th>
            <th>ประเภทงาน</th>
            <th>ลูกค้า</th>
            <th className="num">น้ำหนัก</th>
            <th className="num">คงเหลือ</th>
            <th className="num">ราคาทุน</th>
            <th className="num">ราคาขาย</th>
            <th className="num">Margin</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {FINISHED.map((f) => {
            const margin = f.price ? ((f.price - f.cost) / f.price) * 100 : 0;
            const cn = custName(f.customer);
            return (
              <tr key={f.id}>
                <td className="mono"><b>{f.code}</b></td>
                <td>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{f.name}</div>
                  {f.color && <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>สี: {f.color}</div>}
                </td>
                <td><JobBadge type={f.jobType}/></td>
                <td>{cn ? <span className="badge badge-neutral">{cn}</span> : <span style={{ color: "var(--text-tertiary)" }}>—</span>}</td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  {f.weight != null ? <><b>{_fmt(f.weight, f.weight % 1 ? 1 : 0)}</b> <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>g</span></> : <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                </td>
                <td className="num">
                  <b>{_fmt(f.stock)}</b> <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{f.unit}</span>
                  {f.stock === 0 && <span className="badge badge-danger" style={{ marginLeft: 6 }}>หมด</span>}
                </td>
                <td className="num">{baht(f.cost, 2)}</td>
                <td className="num">{baht(f.price, 2)}</td>
                <td className="num" style={{ color: margin > 40 ? "var(--success)" : "var(--text-primary)", fontWeight: 500 }}>{_fmt(margin, 1)}%</td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => setPe(f)}><I.Edit size={13}/> ราคา</button></td>
              </tr>
            );
          })}
          {!FINISHED.length && (
            <tr><td colSpan={10} style={{ textAlign: "center", padding: 40, color: "var(--text-tertiary)" }}>
              ยังไม่มีสินค้า · <a onClick={onAdd} style={{ color: "var(--accent)", cursor: "pointer" }}>เพิ่มสินค้ารายการแรก</a>
            </td></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function Movement() {
  useStore();
  const moves = STOCK_MOVEMENTS;
  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr><th>เวลา</th><th>ประเภท</th><th>รายการ</th><th className="num">จำนวน</th><th>อ้างอิง</th><th>หมายเหตุ</th></tr>
        </thead>
        <tbody>
          {moves.map((m, i) => {
            const c = { IN: "success", OUT: "warning", MOVE: "info", ADJ: "neutral" }[m.type];
            const sign = m.type === "OUT" || (m.type === "ADJ" && m.qty < 0) ? "−" : m.type === "IN" ? "+" : "";
            return (
              <tr key={i}>
                <td className="mono" style={{ fontSize: 12 }}>{m.date}</td>
                <td><span className={"badge badge-" + c}>{m.type}</span></td>
                <td><b className="mono" style={{ fontSize: 12.5 }}>{m.item}</b></td>
                <td className="num" style={{ fontWeight: 500, color: m.type === "OUT" ? "var(--amber)" : m.type === "IN" ? "var(--success)" : "var(--text-primary)" }}>
                  {sign}{_fmt(Math.abs(m.qty), Math.abs(m.qty) % 1 ? 2 : 0)} {m.unit}
                </td>
                <td className="mono" style={{ fontSize: 12 }}>{m.ref}</td>
                <td style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{m.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AddProductForm({ onSubmit, onCancel }) {
  const [form, setForm] = useState({
    jobType: "oem", code: "", name: "", customer: "", color: "",
    weight: "", unit: "PCS", cost: "", price: "", stock: "",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const cost = parseFloat(form.cost) || 0;
  const price = parseFloat(form.price) || 0;
  const margin = price ? ((price - cost) / price) * 100 : 0;
  const valid = form.code.trim() && form.name.trim() && price > 0;

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    const seq = (FINISHED.length + 1).toString().padStart(3, "0");
    onSubmit({
      id: "FG-" + Date.now().toString().slice(-6),
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      customer: form.customer || "—",
      jobType: form.jobType,
      color: form.color.trim(),
      weight: form.weight === "" ? null : parseFloat(form.weight),
      unit: form.unit,
      stock: parseInt(form.stock, 10) || 0,
      cost, price,
    });
  };

  return (
    <form onSubmit={submit} style={{ padding: 20 }}>
      {/* ประเภทงาน */}
      <label className="field-label">ประเภทงาน *</label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 16 }}>
        {Object.entries(JOB_TYPES).map(([k, j]) => {
          const on = form.jobType === k;
          return (
            <button type="button" key={k} onClick={() => set("jobType", k)}
              style={{
                textAlign: "left", padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                border: on ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                background: on ? "var(--accent-subtle)" : "var(--bg-elevated)",
              }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: on ? "var(--accent)" : "var(--text-primary)" }}>{j.short}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.4 }}>{j.label}</div>
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="field-label">รหัสสินค้า (SKU) *</label>
          <input required className="input" style={{ fontFamily: "var(--font-mono)" }} placeholder="เช่น AP-DASH-22A" value={form.code} onChange={(e) => set("code", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">หน่วยนับ</label>
          <select className="select" value={form.unit} onChange={(e) => set("unit", e.target.value)}>
            {["PCS", "SET", "BOX", "KG", "PACK", "ROLL"].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label className="field-label">ชื่อสินค้า *</label>
          <input required className="input" placeholder="เช่น Dashboard Trim 22A" value={form.name} onChange={(e) => set("name", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">ชื่อลูกค้า</label>
          <select className="select" value={form.customer} onChange={(e) => set("customer", e.target.value)}>
            <option value="">— ไม่ระบุ / สต็อกร้าน —</option>
            {CUSTOMERS.map((c) => <option key={c.id} value={c.code}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">สี</label>
          <input className="input" placeholder="เช่น ดำ (Black), แดง Pantone 485" value={form.color} onChange={(e) => set("color", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">น้ำหนักต่อชิ้น (กรัม)</label>
          <input type="number" step="0.1" min="0" className="input" placeholder="0" value={form.weight} onChange={(e) => set("weight", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">สต็อกตั้งต้น</label>
          <input type="number" min="0" className="input" placeholder="0" value={form.stock} onChange={(e) => set("stock", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">ราคาทุน / หน่วย (บาท)</label>
          <input type="number" step="0.01" min="0" className="input" placeholder="0.00" value={form.cost} onChange={(e) => set("cost", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">ราคาขาย / หน่วย (บาท) *</label>
          <input required type="number" step="0.01" min="0" className="input" placeholder="0.00" value={form.price} onChange={(e) => set("price", e.target.value)}/>
        </div>
      </div>

      {price > 0 && (
        <div style={{ marginTop: 14, padding: 12, background: "var(--bg-subtle)", borderRadius: 10, display: "flex", alignItems: "center", gap: 16, fontSize: 12.5 }}>
          <span style={{ color: "var(--text-secondary)" }}>กำไรต่อหน่วย</span>
          <b className="num">{baht(price - cost, 2)}</b>
          <span style={{ color: "var(--text-secondary)" }}>Margin</span>
          <b className="num" style={{ color: margin > 40 ? "var(--success)" : margin > 0 ? "var(--text-primary)" : "var(--danger)" }}>{_fmt(margin, 1)}%</b>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-outline" onClick={onCancel}>ยกเลิก</button>
        <button type="submit" className="btn btn-primary" disabled={!valid}><I.Check size={14}/> บันทึกสินค้า</button>
      </div>
    </form>
  );
}

window.PageInventory = PageInventory;
