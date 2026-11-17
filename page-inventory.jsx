/* global React, I, MATERIALS, FINISHED, JOB_TYPES, CUSTOMERS, STOCK_MOVEMENTS, ROLES, Drawer, Store, useStore, PageHeader, Tabs, baht, _fmt, exportCSV, notify, runAction, ErpModal */

function PageInventory() {
  const [tab, setTab] = useState("MAT");
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [adjOpen, setAdjOpen] = useState(false);
  const [matForm, setMatForm] = useState(null); // null | { mode: "add" } | { mode: "edit", rec }
  useStore();
  const role = Store.user() ? ROLES[Store.user().role] : null;
  const canEdit = role && (role.canEdit === "*" || (role.canEdit || []).includes("inventory") || (role.canEdit || []).includes("production"));
  // จัดการทะเบียนวัตถุดิบ (เพิ่ม/แก้ไข/ปิดใช้งาน): เฉพาะผู้ที่มีสิทธิ์คลังสินค้า (ไม่รวมฝ่ายผลิต)
  const canManageMat = role && (role.canEdit === "*" || (role.canEdit || []).includes("inventory"));

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  const matLow = MATERIALS.filter((m) => m.active !== false && m.stock < m.min).length;
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
            {canManageMat && <button className="btn btn-outline btn-sm" onClick={() => { setTab("MAT"); setMatForm({ mode: "add" }); }}><I.Plus size={14}/> เพิ่มวัตถุดิบ</button>}
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

      {tab === "MAT" && <MaterialTable canManage={canManageMat} onAdd={() => setMatForm({ mode: "add" })} onEdit={(rec) => setMatForm({ mode: "edit", rec })}/>}
      {tab === "FG" && <FinishedTable onAdd={() => setAddOpen(true)}/>}
      {tab === "BOM" && <window.BOMViewer/>}
      {tab === "MOVE" && <Movement/>}

      {adjOpen && <StockAdjustModal onClose={() => setAdjOpen(false)}/>}
      <Drawer open={!!matForm} onClose={() => setMatForm(null)} title={matForm && matForm.mode === "edit" ? "แก้ไขวัตถุดิบ " + matForm.rec.code : "เพิ่มวัตถุดิบ"} width={620}>
        {matForm && <MaterialForm key={matForm.mode + (matForm.rec ? matForm.rec.id : "")} mode={matForm.mode} rec={matForm.rec}
          onCancel={() => setMatForm(null)} onDone={(msg) => { setMatForm(null); showToast(msg); }}/>}
      </Drawer>
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
  const items = [...Store.state.materials.filter((m) => m.active !== false).map((m) => ({ code: m.code, name: m.name, unit: m.unit, stock: m.stock })),
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

function MaterialTable({ canManage, onAdd, onEdit }) {
  const [showInactive, setShowInactive] = useState(true);
  const inactiveCount = MATERIALS.filter((m) => m.active === false).length;
  const rows = showInactive ? MATERIALS : MATERIALS.filter((m) => m.active !== false);
  // ไม่มีการลบวัตถุดิบ: ใช้ปิดใช้งาน/เปิดใช้งานเท่านั้น (ประวัติใน PO / Stock Movement / BOM คงเดิม)
  function toggleActive(m) {
    const activate = m.active === false;
    if (!activate && !window.confirm(`ปิดใช้งาน ${m.code} · ${m.name} ?\n(ยังคงอยู่ในประวัติเดิมทั้งหมด แต่จะไม่แสดงให้เลือกใน PO ใหม่และการปรับยอดสต๊อก — เปิดใช้งานกลับได้ภายหลัง)`)) return;
    runAction(() => Store.update("materials", m.id, { active: activate }, "id", activate ? "เปิดใช้งาน" : "ปิดใช้งาน"), activate ? `เปิดใช้งาน ${m.code} แล้ว` : `ปิดใช้งาน ${m.code} แล้ว`);
  }
  return (
    <div className="card">
      {(inactiveCount > 0 || canManage) && (
        <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-secondary)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)}/> แสดงรายการที่ปิดใช้งาน ({inactiveCount})
          </label>
        </div>
      )}
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
              <th>สถานะ</th>
              {canManage && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={canManage ? 11 : 10} style={{ textAlign: "center", padding: 28, color: "var(--text-secondary)" }}>
                ยังไม่มีวัตถุดิบ{canManage && <> · <a onClick={onAdd} style={{ color: "var(--accent)", cursor: "pointer" }}>เพิ่มวัตถุดิบรายการแรก</a></>}
              </td></tr>
            )}
            {rows.map((m) => {
              const inactive = m.active === false;
              const low = !inactive && m.stock < m.min;
              const danger = !inactive && m.stock < m.min * 0.8;
              return (
                <tr key={m.id} style={inactive ? { opacity: 0.55 } : undefined}>
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
                  <td className="num">{m.cost > 0 ? baht(m.cost, 2) : <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>ยังไม่มีต้นทุน</span>}</td>
                  <td className="num" style={{ fontWeight: 500 }}>{baht(m.stock * m.cost)}</td>
                  <td style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{m.supplier}</td>
                  <td>{inactive ? <span className="badge badge-neutral">ปิดใช้งาน</span> : <span className="badge badge-success">ใช้งาน</span>}</td>
                  {canManage && (
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn btn-outline btn-sm" onClick={() => onEdit(m)}>แก้ไข</button>{" "}
                      <button className="btn btn-outline btn-sm" onClick={() => toggleActive(m)}>{inactive ? "เปิดใช้งาน" : "ปิดใช้งาน"}</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- ทะเบียนวัตถุดิบ: ตัวช่วยตรวจรหัสซ้ำ / การอ้างอิง ----------
const MAT_TYPES = ["เม็ดพลาสติก", "Masterbatch", "Additive", "สี-เม็ด", "สี-ผง", "เหล็ก", "บรรจุภัณฑ์", "อื่น ๆ"];
const MAT_UNITS = ["KG", "G", "L", "PCS", "BAG", "ROLL", "SET", "BOX"];
const matKey = (s) => String(s == null ? "" : s).replace(/\s+/g, "").toUpperCase(); // ไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่าง

// ประวัติราคาซื้อของวัตถุดิบ — อ่านจากบรรทัดของ PO ที่รับของแล้ว (ราคาก่อน VAT)
function materialPurchaseStats(m) {
  const rows = [];
  Store.state.purchaseOrders.filter((p) => p.status === "received").forEach((p) => {
    (p.lines || []).forEach((l) => {
      if (l.item === m.id && l.price > 0) rows.push({ po: p.id, date: String(p.receivedAt || p.date || "").slice(0, 10), supplier: p.supplierName, qty: l.qty, unit: l.unit, price: l.price });
    });
  });
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.po < b.po ? 1 : -1));
  if (!rows.length) return { rows, last: null, avg: null, min: null, max: null };
  const totQty = rows.reduce((s, r) => s + r.qty, 0);
  const avg = totQty > 0 ? rows.reduce((s, r) => s + r.qty * r.price, 0) / totQty : null;
  return { rows, last: rows[0].price, avg, min: Math.min(...rows.map((r) => r.price)), max: Math.max(...rows.map((r) => r.price)) };
}
window.materialPurchaseStats = materialPurchaseStats;

// วัตถุดิบนี้ถูกอ้างอิงที่ใดบ้าง (PO / BOM / Stock Movement)
function materialRefs(m) {
  const po = Store.state.purchaseOrders.filter((p) => (p.lines || []).some((l) => l.item === m.id)).length;
  const bom = Object.values(window.BOMS || {}).filter((b) => (b.lines || []).some((l) => l.item === m.id)).length;
  const mv = Store.state.stockMovements.filter((x) => matKey(x.item) === matKey(m.code)).length;
  return { po, bom, mv, total: po + bom + mv };
}
// รหัสชนกับวัตถุดิบอื่น หรือสินค้าสำเร็จรูป (ตรวจทั้ง code และ id)
function matCodeConflict(code, selfId) {
  const k = matKey(code);
  if (!k) return null;
  const m = Store.state.materials.find((x) => x.id !== selfId && (matKey(x.code) === k || matKey(x.id) === k));
  if (m) return `รหัสนี้ซ้ำกับวัตถุดิบ ${m.code} · ${m.name}`;
  const f = Store.state.finished.find((x) => matKey(x.code) === k || matKey(x.id) === k);
  if (f) return `รหัสนี้ซ้ำกับสินค้าสำเร็จรูป ${f.code} · ${f.name}`;
  return null;
}

// admin ปรับต้นทุนวัตถุดิบฉุกเฉิน (ต้องมีเหตุผล บันทึกลงประวัติ + audit)
function AdjustCostModal({ rec, onClose, onDone }) {
  const [c, setC] = useState(String(rec.cost == null ? "" : rec.cost));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const v = parseFloat(c);
  const ok = v >= 0 && reason.trim() && !busy;
  const go = async () => {
    setBusy(true);
    try { await Store.adjustMaterialCost(rec.id, v, reason.trim()); onDone("ปรับต้นทุน " + rec.code + " แล้ว"); }
    catch (e) { notify(e && e.message ? e.message : String(e), "error"); setBusy(false); }
  };
  return (
    <ErpModal title={"ปรับต้นทุน " + rec.code} onClose={onClose} width={460}
      footer={<><button type="button" className="btn btn-outline btn-sm" onClick={onClose}>ปิด</button><button type="button" className="btn btn-primary btn-sm" disabled={!ok} onClick={go}>บันทึก</button></>}>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 10 }}>ใช้เฉพาะกรณีข้อมูลผิดปกติ ต้นทุนปกติคำนวณจากการรับ PO อัตโนมัติ</div>
      <label className="field-label">ต้นทุนใหม่ / หน่วย (บาท) *</label>
      <input type="number" step="0.0001" min="0" className="input num" value={c} onChange={(e) => setC(e.target.value)}/>
      <label className="field-label" style={{ marginTop: 10 }}>เหตุผล *</label>
      <textarea className="input" rows={3} style={{ width: "100%", height: "auto", padding: 8 }} value={reason} onChange={(e) => setReason(e.target.value)}/>
    </ErpModal>
  );
}

function MaterialForm({ mode, rec, onCancel, onDone }) {
  const editing = mode === "edit";
  const refs = editing ? materialRefs(rec) : null;
  const locked = editing && refs.total > 0; // มีการอ้างอิงแล้ว → ห้ามเปลี่ยนรหัส/หน่วยนับ
  const [form, setForm] = useState(editing ? {
    code: rec.code, name: rec.name, type: rec.type || "เม็ดพลาสติก", unit: rec.unit || "KG",
    min: String(rec.min == null ? "" : rec.min), max: String(rec.max == null ? "" : rec.max),
    openingCost: "", supplier: rec.supplier || "", location: rec.location || "", opening: "",
  } : { code: "", name: "", type: "เม็ดพลาสติก", unit: "KG", min: "", max: "", openingCost: "", supplier: "", location: "", opening: "" });
  const [saving, setSaving] = useState(false);
  const [adj, setAdj] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const code = form.code.trim().toUpperCase();
  const min = parseFloat(form.min), max = parseFloat(form.max), openingCost = parseFloat(form.openingCost);
  const opening = form.opening === "" ? 0 : parseFloat(form.opening);
  const codeChanged = editing && code !== rec.code;
  const conflict = (!editing || codeChanged) ? matCodeConflict(code, editing ? rec.id : null) : null;
  const errors = [];
  if (!code) errors.push("กรุณาระบุรหัสวัตถุดิบ");
  else if (!/^[A-Z0-9][A-Z0-9._\-\/]*$/.test(code)) errors.push("รหัสใช้ได้เฉพาะ A-Z 0-9 . _ - / และห้ามมีช่องว่าง");
  if (conflict) errors.push(conflict);
  if (!form.name.trim()) errors.push("กรุณาระบุชื่อวัตถุดิบ");
  if (!(min >= 0)) errors.push("Min ต้องเป็นตัวเลขไม่ติดลบ");
  if (!(max > 0)) errors.push("Max ต้องมากกว่า 0");
  if (min >= 0 && max > 0 && min > max) errors.push("Min ต้องไม่มากกว่า Max");
  if (!editing && opening > 0 && !(openingCost > 0)) errors.push("มียอดยกมา ต้องระบุต้นทุนยกมา/หน่วย (มากกว่า 0)");
  if (!editing && !(opening >= 0)) errors.push("ยอดยกมาต้องไม่ติดลบ");
  const units = MAT_UNITS.includes(form.unit) ? MAT_UNITS : [form.unit, ...MAT_UNITS];
  const types = MAT_TYPES.includes(form.type) ? MAT_TYPES : [form.type, ...MAT_TYPES];
  const showErr = errors.length > 0 && (form.code || form.name || form.min || form.max || form.openingCost);

  function submit(e) {
    e.preventDefault();
    if (saving || errors.length) return;
    setSaving(true);
    const ok = runAction(() => Store.tx(editing ? "editMaterial" : "createMaterial", () => {
      const clean = {
        name: form.name.trim(), type: form.type, unit: form.unit, min, max,
        supplier: form.supplier.trim(), location: form.location.trim(),
      };
      if (!editing) {
        // ตรวจซ้ำอีกครั้งในธุรกรรม (ข้อมูลล่าสุด) + ต้องไม่มีประวัติเคลื่อนไหวค้างของรหัสนี้
        const c = matCodeConflict(code, null);
        if (c) Store.fail(c);
        if (Store.state.stockMovements.some((x) => matKey(x.item) === matKey(code))) Store.fail("พบประวัติเคลื่อนไหวสต๊อกของรหัสนี้อยู่แล้ว ไม่สามารถใช้รหัสซ้ำได้");
        const startCost = opening > 0 ? openingCost : 0; // ต้นทุนเกิดจากการรับ PO — ตั้งต้นเฉพาะกรณีมียอดยกมา
        const m = { id: code, code, ...clean, cost: startCost, stock: 0, active: true, costHistory: startCost > 0 ? [{ date: Store.today(), cost: startCost, by: Store.userName(), note: "ต้นทุนยกมา" }] : [] };
        Store.add("materials", m, `${code}${opening > 0 ? " · ยอดยกมา " + opening + " " + clean.unit : ""}`);
        if (opening > 0) {
          // ยอดยกมาผ่าน Stock Movement เท่านั้น (ref OPEN-รหัส) แล้วตรวจว่ายอดคงเหลือ = ผลรวม movement
          Store.adjustStock(code, opening, "OPEN-" + code, "ยอดยกมา");
          const bal = Store.state.stockMovements.filter((x) => matKey(x.item) === matKey(code)).reduce((s, x) => s + (x.type === "IN" ? x.qty : -x.qty), 0);
          if (Math.abs(bal - m.stock) > 0.0005) Store.fail("ยอดยกมาไม่สอดคล้องกับ Stock Movement — ยกเลิกการบันทึก");
        }
        return m;
      }
      const m = Store.find("materials", rec.id);
      if (!m) Store.fail("ไม่พบวัตถุดิบ");
      const now = materialRefs(m);
      const patch = { ...clean };
      if (code !== m.code) {
        if (now.total > 0) Store.fail("รหัสนี้ถูกอ้างอิงในเอกสารอื่นแล้ว ไม่สามารถเปลี่ยนได้");
        const c = matCodeConflict(code, m.id);
        if (c) Store.fail(c);
        patch.code = code;
      }
      if (clean.unit !== m.unit && now.total > 0) Store.fail("วัตถุดิบนี้ถูกอ้างอิงแล้ว ไม่สามารถเปลี่ยนหน่วยนับได้");
      const diff = Object.keys(patch).filter((k) => k !== "costHistory" && JSON.stringify(m[k]) !== JSON.stringify(patch[k]))
        .map((k) => `${k}: ${m[k] == null ? "—" : m[k]}→${patch[k]}`);
      return Store.update("materials", m.id, patch, "id", diff.length ? "แก้ไข: " + diff.join(", ") : "ไม่มีการเปลี่ยนแปลง");
    }), editing ? `แก้ไข ${code} แล้ว` : `เพิ่มวัตถุดิบ ${code} แล้ว`);
    if (ok) onDone(editing ? `แก้ไขวัตถุดิบ ${code} เรียบร้อย` : `เพิ่มวัตถุดิบ ${code} เรียบร้อย`);
    else setSaving(false);
  }

  return (
    <form onSubmit={submit} style={{ padding: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="field-label">รหัสวัตถุดิบ *</label>
          <input className="input" style={{ fontFamily: "var(--font-mono)" }} placeholder="เช่น PP-H1300" value={form.code} disabled={locked}
            onChange={(e) => set("code", e.target.value)}/>
          {locked && <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>ถูกอ้างอิงแล้ว (PO {refs.po} · BOM {refs.bom} · Movement {refs.mv}) — เปลี่ยนรหัสและหน่วยนับไม่ได้</div>}
        </div>
        <div>
          <label className="field-label">ประเภท *</label>
          <select className="select" value={form.type} onChange={(e) => set("type", e.target.value)}>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label className="field-label">ชื่อวัตถุดิบ *</label>
          <input className="input" placeholder="เช่น PP Homopolymer (HMC H1300)" value={form.name} onChange={(e) => set("name", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">หน่วยนับ *</label>
          <select className="select" value={form.unit} disabled={locked} onChange={(e) => set("unit", e.target.value)}>
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        {editing && (
          <div>
            <label className="field-label">ต้นทุนถัวเฉลี่ย / หน่วย (บาท)</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="input num" style={{ flex: 1, display: "flex", alignItems: "center", background: "var(--bg-subtle)" }}>{rec.cost > 0 ? _fmt(rec.cost, 2) : "ยังไม่มีต้นทุน"}</div>
              {Store.user() && Store.user().role === "admin" && <button type="button" className="btn btn-outline btn-sm" onClick={() => setAdj(true)}>ปรับต้นทุน</button>}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>คำนวณจากราคาที่กรอกใน PO ทุกครั้งที่รับของ (admin ปรับฉุกเฉินได้พร้อมเหตุผล)</div>
          </div>
        )}
        {editing && (() => {
          const ps = materialPurchaseStats(rec);
          return (
            <div style={{ gridColumn: "1 / -1", background: "var(--bg-subtle)", borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 8 }}>ประวัติราคาซื้อ (จาก PO ที่รับของแล้ว)</div>
              {!ps.rows.length ? <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>ยังไม่มีประวัติการซื้อ</div> : (
                <>
                  <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, marginBottom: 8 }}>
                    <span>ล่าสุด <b className="num">{_fmt(ps.last, 2)}</b></span>
                    <span>เฉลี่ยถ่วงน้ำหนัก <b className="num">{_fmt(ps.avg, 2)}</b></span>
                    <span>ต่ำสุด <b className="num">{_fmt(ps.min, 2)}</b></span>
                    <span>สูงสุด <b className="num">{_fmt(ps.max, 2)}</b></span>
                    <span>ต้นทุนถัวเฉลี่ยปัจจุบัน <b className="num">{_fmt(rec.cost, 2)}</b></span>
                  </div>
                  <table className="table" style={{ fontSize: 12 }}>
                    <thead><tr><th>วันที่</th><th>PO</th><th>Supplier</th><th className="num">จำนวน</th><th className="num">ราคา/หน่วย</th></tr></thead>
                    <tbody>{ps.rows.slice(0, 8).map((r, i) => <tr key={i}><td>{r.date}</td><td>{r.po}</td><td>{r.supplier}</td><td className="num">{_fmt(r.qty, 2)} {r.unit}</td><td className="num">{_fmt(r.price, 2)}</td></tr>)}</tbody>
                  </table>
                </>
              )}
            </div>
          );
        })()}
        {editing && (() => {
          // ประวัติการเปลี่ยนต้นทุนทุกครั้ง (ยกมา / ถัวเฉลี่ยจาก PO / admin ปรับด้วยมือ) — กัน admin ลืมว่าเคยปรับ
          const hist = [...(rec.costHistory || [])].reverse();
          const manual = hist.filter((h) => h.ref === "MANUAL").length;
          return (
            <div style={{ gridColumn: "1 / -1", background: "var(--bg-subtle)", borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 8 }}>
                ประวัติต้นทุน
                {manual > 0 && <span style={{ marginLeft: 8, fontWeight: 500, fontSize: 11.5, color: "var(--warning, #b45309)" }}>⚠ มีการปรับด้วยมือ {manual} ครั้ง</span>}
              </div>
              {!hist.length ? <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>ยังไม่มีการเปลี่ยนแปลงต้นทุน</div> : (
                <table className="table" style={{ fontSize: 12 }}>
                  <thead><tr><th>วันที่</th><th className="num">เดิม → ใหม่</th><th>โดย</th><th>ที่มา / เหตุผล</th></tr></thead>
                  <tbody>{hist.slice(0, 20).map((h, i) => (
                    <tr key={i} style={h.ref === "MANUAL" ? { background: "rgba(245, 158, 11, .12)" } : undefined}>
                      <td>{h.date}</td>
                      <td className="num">{h.prev == null ? "—" : _fmt(h.prev, 2)} → <b>{_fmt(h.cost, 2)}</b></td>
                      <td>{h.by}</td>
                      <td>{h.ref === "MANUAL" ? <b>{h.note}</b> : h.note}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          );
        })()}
        <div>
          <label className="field-label">Min (จุดสั่งซื้อ) *</label>
          <input type="number" step="any" min="0" className="input num" placeholder="0" value={form.min} onChange={(e) => set("min", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">Max *</label>
          <input type="number" step="any" min="0" className="input num" placeholder="0" value={form.max} onChange={(e) => set("max", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">ผู้ขาย</label>
          <input className="input" list="mat-suppliers" placeholder="เลือกจากรายการหรือพิมพ์เอง" value={form.supplier} onChange={(e) => set("supplier", e.target.value)}/>
          <datalist id="mat-suppliers">{SUPPLIERS.map((s) => <option key={s.id} value={s.name}/>)}</datalist>
        </div>
        <div>
          <label className="field-label">ตำแหน่งเก็บ</label>
          <input className="input" placeholder="เช่น A-01-02" value={form.location} onChange={(e) => set("location", e.target.value)}/>
        </div>
        {!editing ? (
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="field-label">ยอดยกมา ({form.unit})</label>
            <input type="number" step="any" min="0" className="input num" placeholder="0" value={form.opening} onChange={(e) => set("opening", e.target.value)}/>
            {opening > 0 && (
              <div style={{ marginTop: 8 }}>
                <label className="field-label">ต้นทุนยกมา / หน่วย (บาท) *</label>
                <input type="number" step="0.01" min="0" className="input num" placeholder="0.00" value={form.openingCost} onChange={(e) => set("openingCost", e.target.value)}/>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>ใช้เป็นต้นทุนตั้งต้นของยอดยกมาเท่านั้น หลังจากนี้ต้นทุนจะคำนวณจากราคาใน PO ที่รับของ</div>
              </div>
            )}
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>บันทึกเป็น Stock Movement "ยอดยกมา" หนึ่งรายการ — หลังสร้างแล้วเปลี่ยนยอดได้ผ่าน "รับเข้า / ปรับยอด" เท่านั้น</div>
          </div>
        ) : (
          <div style={{ gridColumn: "1 / -1", fontSize: 12.5, color: "var(--text-secondary)" }}>
            ยอดคงเหลือปัจจุบัน <b className="num">{_fmt(rec.stock)}</b> {rec.unit} — เปลี่ยนได้ผ่าน "รับเข้า / ปรับยอด" เท่านั้น
          </div>
        )}
      </div>
      {showErr && (
        <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: "var(--danger-subtle, #fdecea)", color: "var(--danger)", fontSize: 12.5 }}>
          {errors.map((m, i) => <div key={i}>• {m}</div>)}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-outline" onClick={onCancel}>ยกเลิก</button>
        <button type="submit" className="btn btn-primary" disabled={saving || errors.length > 0}><I.Check size={14}/> {editing ? "บันทึกการแก้ไข" : "บันทึกวัตถุดิบ"}</button>
      </div>
      {adj && <AdjustCostModal rec={rec} onClose={() => setAdj(false)} onDone={(msg) => { setAdj(false); onDone(msg); }}/>}
    </form>
  );
}

function TypeBadge({ type }) {
  const map = {
    "เม็ดพลาสติก": "info",
    "Masterbatch": "violet",
    "Additive": "warning",
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
