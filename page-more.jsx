/* global React, PageHeader, KPICard, MonthSelect, ListToolbar, SortTh, Pager, useListView, WhtIssueModal, I, MOLDS, Drawer, ROLES, DOC_LABEL, Store, useStore, Analytics, exportCSV, notify, runAction, ErpModal, EmptyRow, baht, _fmt */

function Step({ done, text }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 20, height: 20, borderRadius: 99, background: done ? "var(--success)" : "var(--bg-subtle)", color: done ? "white" : "var(--text-tertiary)", display: "grid", placeItems: "center", border: done ? "none" : "1px solid var(--border)" }}>
        {done && <I.Check size={12}/>}
      </div>
      <span style={{ fontSize: 13, color: done ? "var(--text-primary)" : "var(--text-secondary)" }}>{text}</span>
    </div>
  );
}

// Helper KV
function PageHeader_KV({ k, v }) {
  return <div><div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{k}</div><div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{v}</div></div>;
}
window.PageHeader_KV = PageHeader_KV;

function KPICard({ icon, tone, label, value, unit, foot }) {
  const Ico = I[icon];
  const c = ({ accent: { c:"var(--accent)", b:"var(--accent-subtle)" }, amber: { c:"var(--amber)", b:"var(--amber-subtle)" }, success: { c:"var(--success)", b:"var(--success-subtle)" }, violet: { c:"var(--violet)", b:"var(--violet-subtle)" } })[tone];
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="kpi-label"><span className="kpi-ico" style={{ background: c.b, color: c.c }}><Ico size={14}/></span>{label}</div>
      <div className="kpi-value">{typeof value === "number" ? _fmt(value) : value}{unit && <span className="kpi-unit"> {unit}</span>}</div>
      <div className="kpi-foot" style={{ marginTop: 6 }}>{foot}</div>
    </div>
  );
}

// ===== Audit Log =====

// ===== BOM (สูตรการผลิต): สินค้าหนึ่งรหัสมีได้หลายสูตร (เม็ดคนละเบอร์ / สีต่างกัน) =====
const BOM_TYPE_TH = { resin: "เม็ดพลาสติก", masterbatch: "มาสเตอร์แบตช์ / สี", additive: "สารเติมแต่ง", regrind: "เศษรีไซเคิล" };
const BOM_STATUS = { draft: { th: "ร่าง", cls: "badge-neutral" }, active: { th: "ใช้งาน", cls: "badge-success" }, inactive: { th: "เลิกใช้", cls: "badge-danger" } };

function bomLineText(l) {
  if (l.basis === "shareOfResin") return `${_fmt(l.pct, 2)} % ของเม็ดผสม`;
  if (l.pct != null && (l.basis === "pctOfResin" || l.type === "regrind")) return `${_fmt(l.pct, 2)} % ของเม็ด`;
  return `${_fmt((Number(l.qty) || 0) * 1000, 3)} กรัม/ชิ้น`;  // หน่วยต่อชิ้นแสดงเป็นกรัม (เก็บและตัดสต๊อกเป็น กก.)
}

function BOMViewer() {
  useStore();
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState(null); // { mode: "new" | "edit" | "copy", rec }
  const [toast, setToast] = useState(null);
  const [compare, setCompare] = useState(null); // รหัสสินค้าที่กำลังเปรียบเทียบสูตร
  const role = Store.user() ? Store.user().role : null;
  const canEdit = role === "admin" || role === "production";
  const boms = Store.state.boms;
  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const list = boms.filter((b) => (showInactive || b.status !== "inactive")
    && (!q || (b.productCode + " " + b.name + " " + (b.color || "")).toLowerCase().includes(q.toLowerCase())));
  const byProduct = {};
  list.forEach((b) => { (byProduct[b.productCode] = byProduct[b.productCode] || []).push(b); });
  const withoutBom = Store.state.finished.filter((f) => f.jobType !== "trade" && !boms.some((b) => b.productCode === f.code && b.status === "active"));

  const act = async (fn, okMsg) => {
    try { await fn(); flash(okMsg); } catch (e) { notify(e && e.message ? e.message : String(e), "error"); }
  };
  const setStatus = (b, status) => act(() => Store.saveBom({ ...b, status }, false), status === "active" ? `ใช้งานสูตร "${b.name}" แล้ว` : `เปลี่ยนสถานะสูตร "${b.name}" แล้ว`);
  const setDefault = (b) => act(() => Store.saveBom({ ...b, isDefault: true }, false), `ตั้ง "${b.name}" เป็นสูตรหลักแล้ว`);

  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder="ค้นหารหัสสินค้า / ชื่อสูตร / สี" value={q} onChange={(e) => setQ(e.target.value)}/>
        <label style={{ fontSize: 12.5, color: "var(--text-secondary)", display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)}/> แสดงสูตรที่เลิกใช้
        </label>
        <div className="spacer" style={{ flex: 1 }}/>
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setForm({ mode: "new" })}><I.Plus size={14}/> สร้างสูตร BOM</button>}
      </div>
      {!canEdit && <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 10 }}>ดูได้อย่างเดียว — แก้ BOM ได้เฉพาะผู้ดูแลระบบและฝ่ายผลิต</div>}

      {withoutBom.length > 0 && (
        <div style={{ marginBottom: 14, padding: "9px 12px", borderRadius: 8, background: "var(--amber-subtle)", color: "var(--amber)", fontSize: 12.5 }}>
          <I.Alert size={13} style={{ verticalAlign: "middle" }}/> สินค้าที่ยังไม่มีสูตร BOM ที่ใช้งาน: {withoutBom.map((f) => f.code).join(", ")}
        </div>
      )}

      {!list.length && <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--text-tertiary)" }}>ยังไม่มีสูตร BOM{q ? " ที่ตรงกับคำค้น" : ""}</div>}
      {Object.entries(byProduct).map(([code, items]) => {
        const fg = Store.state.finished.find((f) => f.code === code);
        return (
          <div key={code} style={{ marginBottom: 18 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 8 }}>
              <span className="mono" style={{ color: "var(--text-secondary)", fontSize: 12 }}>{code}</span> {fg ? fg.name : ""}
              <span style={{ fontWeight: 400, fontSize: 12, color: "var(--text-tertiary)", marginLeft: 8 }}>{items.length} สูตร</span>
              {items.length >= 2 && <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 10 }} onClick={() => setCompare(code)}>เปรียบเทียบสูตร</button>}
            </div>
            <div className="grid-2">
              {items.map((b) => <BomCard key={b.id} b={b} canEdit={canEdit}
                onEdit={() => setForm({ mode: "edit", rec: b })}
                onCopy={() => setForm({ mode: "copy", rec: b })}
                onActivate={() => setStatus(b, "active")}
                onDeactivate={() => { if (window.confirm(`เลิกใช้สูตร "${b.name}" ?\n(ใบสั่งผลิตเดิมยังใช้ snapshot ของสูตรนี้ต่อได้ตามปกติ)`)) setStatus(b, "inactive"); }}
                onDefault={() => setDefault(b)}/>)}
            </div>
          </div>
        );
      })}

      <Drawer open={!!form} onClose={() => setForm(null)} width={760}
        title={form ? (form.mode === "edit" ? "แก้ไขสูตร " + form.rec.name : form.mode === "copy" ? "คัดลอกสูตร " + form.rec.name : "สร้างสูตร BOM") : ""}>
        {form && <BomForm key={form.mode + (form.rec ? form.rec.id : "")} mode={form.mode} rec={form.rec}
          onCancel={() => setForm(null)} onDone={(m) => { setForm(null); flash(m); }}/>}
      </Drawer>

      <Drawer open={!!compare} onClose={() => setCompare(null)} width={900} title={compare ? "เปรียบเทียบสูตร · " + compare : ""}>
        {compare && <BomCompare productCode={compare}/>}
      </Drawer>

      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 100, background: "var(--text-primary)", color: "white", padding: "12px 18px", borderRadius: 10, boxShadow: "var(--shadow-lg)", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 10 }}>
          <I.Check size={16}/> {toast}
        </div>
      )}
    </>
  );
}

// เปรียบเทียบสูตรของสินค้าเดียวกัน 2–3 สูตร: ปริมาณ กก./ชิ้น ต้นทุน และส่วนต่างจากสูตรแรกที่เลือก
function BomCompare({ productCode }) {
  useStore();
  const all = Store.state.boms.filter((b) => b.productCode === productCode && b.status !== "inactive");
  const [sel, setSel] = useState(() => all.slice(0, 3).map((b) => b.id));
  const chosen = sel.map((id) => all.find((b) => b.id === id)).filter(Boolean);
  const toggle = (id) => setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : s.length >= 3 ? s : [...s, id]);
  const snaps = chosen.map((b) => Store.bomSnapshot(b));
  const items = [];
  snaps.forEach((sn) => sn.lines.forEach((l) => { if (!items.some((x) => x.item === l.item)) items.push({ item: l.item, name: l.name, type: l.type }); }));
  const costs = snaps.map((sn) => Store.bomCost(sn).perPiece);
  const fmtDiff = (v, base, d) => (base == null || Math.abs(v - base) < 1e-9) ? null : <span style={{ color: v > base ? "var(--danger)" : "var(--success)", fontSize: 10.5 }}> {v > base ? "+" : "−"}{_fmt(Math.abs(v - base), d)}</span>;
  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12, fontSize: 12.5 }}>
        {all.map((b) => (
          <label key={b.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={sel.includes(b.id)} disabled={!sel.includes(b.id) && sel.length >= 3} onChange={() => toggle(b.id)}/> {b.name}{b.isDefault ? " (หลัก)" : ""}{b.status === "draft" ? " · ร่าง" : ""}
          </label>
        ))}
        <span style={{ color: "var(--text-tertiary)" }}>เลือกได้สูงสุด 3 สูตร · ส่วนต่างเทียบกับสูตรแรก</span>
      </div>
      {chosen.length < 2 ? <div style={{ color: "var(--text-tertiary)", padding: 20, textAlign: "center" }}>เลือกอย่างน้อย 2 สูตร</div> : (
        <table className="table" style={{ fontSize: 12.5 }}>
          <thead><tr><th>วัตถุดิบ</th>{chosen.map((b) => <th key={b.id} className="num">{b.name}<div style={{ fontWeight: 400, fontSize: 10.5, color: "var(--text-tertiary)" }}>rev {b.revision || 1}{b.color ? " · " + b.color : ""}</div></th>)}</tr></thead>
          <tbody>
            {items.map((it) => {
              const qs = snaps.map((sn) => { const l = sn.lines.find((x) => x.item === it.item); return l ? l : null; });
              return (
                <tr key={it.item}>
                  <td><div style={{ fontWeight: 500 }}>{it.name}</div><div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{it.item} · {BOM_TYPE_TH[it.type] || it.type}</div></td>
                  {qs.map((l, i) => (
                    <td key={i} className="num">{l ? <>{_fmt(l.qty * 1000, 3)} <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>กรัม</span>{l.pct != null ? <div style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>{_fmt(l.pct, 2)} % ของเม็ด{l.basis === "shareOfResin" ? "ผสม" : ""}</div> : null}{i > 0 && fmtDiff(l.qty, qs[0] ? qs[0].qty : 0, 5)}</> : <span style={{ color: "var(--text-tertiary)" }}>—</span>}</td>
                  ))}
                </tr>
              );
            })}
            <tr style={{ background: "var(--bg-subtle)" }}><td>เผื่อเสีย</td>{chosen.map((b, i) => <td key={i} className="num">{b.wasteRate || 0} %{i > 0 && fmtDiff(Number(b.wasteRate) || 0, Number(chosen[0].wasteRate) || 0, 1)}</td>)}</tr>
            <tr style={{ background: "var(--text-primary)", color: "white" }}><td style={{ fontWeight: 600 }}>ต้นทุนวัสดุ/ชิ้น</td>{costs.map((c, i) => <td key={i} className="num" style={{ fontWeight: 700 }}>{c > 0 ? "฿" + _fmt(c, 4) : "—"}{i > 0 && c > 0 && costs[0] > 0 && Math.abs(c - costs[0]) > 1e-9 && <span style={{ fontSize: 10.5, fontWeight: 400 }}> ({c > costs[0] ? "+" : "−"}{_fmt(Math.abs(c - costs[0]), 4)})</span>}</td>)}</tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function BomCard({ b, canEdit, onEdit, onCopy, onActivate, onDeactivate, onDefault }) {
  const [showHist, setShowHist] = useState(false);
  const snap = Store.bomSnapshot(b);
  const cost = Store.bomCost(snap);
  const st = BOM_STATUS[b.status] || BOM_STATUS.draft;
  const openWo = Store.state.workOrders.filter((w) => w.bomId === b.id && ["queued", "setup", "running"].includes(w.status)).length;
  return (
    <div className="card" style={{ padding: 0, opacity: b.status === "inactive" ? 0.7 : 1 }}>
      <div style={{ padding: 14, borderBottom: "1px solid var(--border)", background: "var(--bg-subtle)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{b.name}</span>
          {b.isDefault && b.status === "active" && <span className="badge badge-info">สูตรหลัก</span>}
          <span className={"badge " + st.cls}>{st.th}</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>rev {b.revision || 1}</span>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {b.color && <span>สี: {b.color}</span>}
          {b.mold && <span>· แม่พิมพ์ {b.mold}</span>}
          {b.packaging && <span>· {b.packaging}</span>}
          {openWo > 0 && <span>· ใบสั่งผลิตที่เปิดอยู่ {openWo}</span>}
        </div>
      </div>
      <table className="table" style={{ fontSize: 12 }}>
        <thead><tr><th>วัตถุดิบ</th><th>ชนิด</th><th className="num">กำหนด</th><th className="num">กรัม/ชิ้น</th><th className="num">ต้นทุน/ชิ้น</th></tr></thead>
        <tbody>
          {(b.lines || []).map((l, i) => {
            const rl = snap.lines[i] || {};
            const m = Store.state.materials.find((x) => x.id === l.item);
            const c = m ? Number(m.cost) || 0 : 0;
            return (
              <tr key={i}>
                <td><div className="mono" style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{m ? m.code : l.item}</div><div style={{ fontSize: 12 }}>{l.name}</div></td>
                <td style={{ fontSize: 11.5 }}>{BOM_TYPE_TH[l.type] || l.type}</td>
                <td className="num" style={{ fontSize: 11.5 }}>{bomLineText(l)}</td>
                <td className="num" style={{ fontSize: 11.5 }}>{_fmt((rl.qty || 0) * 1000, 3)}</td>
                <td className="num" style={{ fontWeight: 600 }}>{c > 0 ? _fmt((rl.qty || 0) * c, 4) : <span style={{ color: "var(--text-tertiary)", fontWeight: 400, fontSize: 11 }}>ไม่มีต้นทุน</span>}</td>
              </tr>
            );
          })}
          <tr style={{ background: "var(--bg-subtle)" }}>
            <td colSpan={4} style={{ textAlign: "right", fontSize: 11, color: "var(--text-secondary)" }}>เผื่อเสีย {b.wasteRate || 0}%</td>
            <td/>
          </tr>
          <tr style={{ background: "var(--text-primary)", color: "white" }}>
            <td colSpan={4} style={{ textAlign: "right", fontWeight: 600 }}>ต้นทุนวัสดุ/ชิ้น{cost.missing.length ? " (ไม่ครบ)" : ""}</td>
            <td className="num" style={{ fontWeight: 700 }}>{cost.perPiece > 0 ? "฿" + _fmt(cost.perPiece, 4) : "—"}</td>
          </tr>
        </tbody>
      </table>
      {cost.missing.length > 0 && <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--amber)" }}>ยังไม่มีต้นทุน: {cost.missing.join(", ")}</div>}
      {(b.history || []).length > 0 && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "8px 12px" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowHist(!showHist)}>{showHist ? "ซ่อน" : "ดู"}ประวัติการแก้ไข ({b.history.length})</button>
          {showHist && b.history.map((h, i) => (
            <div key={i} style={{ marginTop: 8, padding: 8, background: "var(--bg-subtle)", borderRadius: 8, fontSize: 11.5 }}>
              <div><b>rev {h.revision}</b> (ก่อนแก้เป็น rev {Number(h.revision) + 1}) · {h.at} · โดย {h.by}</div>
              <div style={{ color: "var(--text-secondary)" }}>เหตุผล: {h.reason || "—"}</div>
              <div style={{ marginTop: 4 }}>{(h.lines || []).map((l) => (l.name || l.item) + " " + bomLineText(l)).join(" · ")} · เผื่อเสีย {h.wasteRate || 0}%{h.color ? " · สี " + h.color : ""}</div>
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <div style={{ display: "flex", gap: 6, padding: 10, borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
          <button className="btn btn-outline btn-sm" onClick={onEdit}>แก้ไข</button>
          <button className="btn btn-outline btn-sm" onClick={onCopy}>คัดลอก</button>
          {b.status === "active" && !b.isDefault && <button className="btn btn-outline btn-sm" onClick={onDefault}>ตั้งเป็นสูตรหลัก</button>}
          {b.status !== "active" && <button className="btn btn-outline btn-sm" onClick={onActivate}>ใช้งานสูตรนี้</button>}
          {b.status === "active" && <button className="btn btn-outline btn-sm" style={{ color: "var(--danger)" }} onClick={onDeactivate}>เลิกใช้</button>}
        </div>
      )}
    </div>
  );
}

function BomForm({ mode, rec, onCancel, onDone }) {
  const editing = mode === "edit";
  const toLine = (l) => ({ item: l.item, type: l.type, basis: l.type === "regrind" ? "pctOfResin" : (l.basis || "perPiece"), value: String(l.basis === "pctOfResin" || l.basis === "shareOfResin" || l.type === "regrind" ? l.pct : Math.round(l.qty * 1e6) / 1e3) });
  const isMix0 = !!(rec && (rec.lines || []).some((l) => l.type === "resin" && l.basis === "shareOfResin"));
  const [f, setF] = useState(rec ? {
    resinMix: isMix0, resinWeight: isMix0 ? String(Math.round((rec.resinWeight || 0) * 1e6) / 1e3 || "") : "",
    partWeight: rec.partWeight ? String(rec.partWeight) : "", runnerWeight: rec.partWeight ? String(rec.runnerWeight || 0) : "", cavities: rec.cavities ? String(rec.cavities) : "", piecesPerUnit: rec.piecesPerUnit ? String(rec.piecesPerUnit) : "1", regrindItem: rec.regrindItem || "",
    productCode: rec.productCode, name: mode === "copy" ? rec.name + " (สำเนา)" : rec.name, color: rec.color || "", mold: rec.mold || "",
    status: mode === "copy" ? "draft" : rec.status, wasteRate: String(rec.wasteRate || 0), packaging: rec.packaging || "",
    lines: (rec.lines || []).map(toLine),
  } : { resinMix: false, resinWeight: "", partWeight: "", runnerWeight: "", cavities: "", piecesPerUnit: "1", regrindItem: "", productCode: "", name: "", color: "", mold: "", status: "draft", wasteRate: "0", packaging: "", lines: [{ item: "", type: "resin", basis: "perPiece", value: "" }] });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setLine = (i, patch) => setF((x) => ({ ...x, lines: x.lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) }));
  const mats = Store.state.materials.filter((m) => m.active !== false);
  // เลือกสินค้า → เติมน้ำหนักชิ้นงานจากทะเบียนสินค้า · เลือกแม่พิมพ์ → เติมจำนวนคาวิตี้ (เติมเฉพาะช่องที่ยังว่าง/ยังเป็นค่าที่ระบบเติมไว้ แก้ทับได้)
  const pickProduct = (code) => setF((x) => {
    const p = Store.state.finished.find((q) => q.code === code);
    const prev = Store.state.finished.find((q) => q.code === x.productCode);
    const ppu0 = parseInt(x.piecesPerUnit, 10) || 1;
    const per = (q) => String(Math.round(q.weight / ppu0 * 1000) / 1000);
    const auto = x.partWeight === "" || (prev && prev.weight != null && x.partWeight === per(prev));
    return { ...x, productCode: code, partWeight: auto ? (p && p.weight > 0 ? per(p) : "") : x.partWeight, runnerWeight: auto && p && p.weight > 0 && x.runnerWeight === "" ? "0" : x.runnerWeight };
  });
  const pickMold = (id) => setF((x) => {
    const m = Store.state.molds.find((q) => q.id === id);
    const prev = Store.state.molds.find((q) => q.id === x.mold);
    const auto = x.cavities === "" || (prev && x.cavities === String(prev.cavities));
    return { ...x, mold: id, cavities: auto ? (m && m.cavities ? String(m.cavities) : "") : x.cavities };
  });

  // เปลี่ยนจำนวนชิ้นต่อชุด → ถ้าน้ำหนักชิ้นงานยังเป็นค่าที่ระบบเติมจากสินค้า (น้ำหนักสินค้า ÷ ชิ้นต่อชุด) คำนวณใหม่ให้
  const setPpu = (v) => setF((x) => {
    const p = Store.state.finished.find((q) => q.code === x.productCode);
    const old = parseInt(x.piecesPerUnit, 10) || 1, nw = parseInt(v, 10) || 1;
    const per = (n) => String(Math.round(p.weight / n * 1000) / 1000);
    const auto = p && p.weight > 0 && x.partWeight === per(old);
    return { ...x, piecesPerUnit: v, partWeight: auto ? per(nw) : x.partWeight };
  });
  // น้ำหนักชิ้นงาน/รันเนอร์ (กรัม) → เม็ดต่อชิ้น (กก.) = (ชิ้นงาน + รันเนอร์ ÷ คาวิตี้) ÷ 1000 — server คำนวณซ้ำด้วยสูตรเดียวกัน
  const partG = parseFloat(f.partWeight) || 0, runnerG = parseFloat(f.runnerWeight) || 0;
  const moldCav = (Store.state.molds.find((m) => m.id === f.mold) || {}).cavities || 0;
  const cavN = parseInt(f.cavities, 10) || moldCav || 0;
  const useW = partG > 0;
  const ppu = Math.max(1, parseInt(f.piecesPerUnit, 10) || 1);
  const wOk = useW && cavN >= 1 && cavN % ppu === 0;
  const runnerPc = wOk ? runnerG / cavN : 0;
  // เม็ดต่อ 1 หน่วยสินค้า (ชิ้น หรือ ชุด) = (ชิ้นงาน + รันเนอร์ ÷ คาวิตี้) × ชิ้นต่อชุด
  const rwKg = wOk ? Math.round((partG + runnerPc) * ppu / 1000 * 1e6) / 1e6 : 0;
  // ปริมาณต่อชิ้นกรอกเป็นกรัมทุกชนิด (เม็ด/มาสเตอร์แบตช์/สารเติมแต่ง) — เก็บและตัดสต๊อกเป็น กก.
  const valueKg = (l) => { const v = parseFloat(l.value) || 0; return l.basis === "perPiece" ? v / 1000 : v; };
  // ตัวอย่างการคำนวณสด (ตามกติกาเดียวกับ server)
  const draft = { lines: f.lines.filter((l) => l.item).map((l) => ({ item: l.item, name: (Store.state.materials.find((m) => m.id === l.item) || {}).name || l.item, type: l.type, basis: l.basis,
    qty: l.basis === "perPiece" ? (useW && l.type === "resin" ? rwKg : valueKg(l)) : undefined, pct: l.basis !== "perPiece" ? parseFloat(l.value) || 0 : undefined })), wasteRate: parseFloat(f.wasteRate) || 0,
    resinWeight: f.resinMix ? (useW ? rwKg : (parseFloat(f.resinWeight) || 0) / 1000) : undefined };
  const shareSum = f.lines.filter((l) => l.type === "resin").reduce((t, l) => t + (parseFloat(l.value) || 0), 0);
  // เปิด/ปิดโหมดเม็ดผสม: เปลี่ยนวิธีกำหนดของทุกบรรทัดเม็ดพร้อมกัน
  const setMix = (on) => setF((x) => ({ ...x, resinMix: on, lines: x.lines.map((l) => l.type === "resin" ? { ...l, basis: on ? "shareOfResin" : "perPiece", value: "" } : l) }));
  const resolved = Store.bomResolve(draft);
  const cost = Store.bomCost({ lines: resolved, wasteRate: draft.wasteRate });

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!f.productCode) return setErr("กรุณาเลือกสินค้า");
    if (!f.name.trim()) return setErr("กรุณาตั้งชื่อสูตร");
    if (!f.lines.length) return setErr("ต้องมีรายการวัตถุดิบอย่างน้อย 1 รายการ");
    for (let i = 0; i < f.lines.length; i++) {
      const l = f.lines[i];
      if (!l.item) return setErr("รายการที่ " + (i + 1) + " ยังไม่ได้เลือกวัตถุดิบ");
      const v = parseFloat(l.value);
      if (!(v > 0) && !(useW && l.type === "resin")) return setErr("รายการที่ " + (i + 1) + " ต้องกรอกปริมาณมากกว่า 0");
      if (l.basis === "pctOfResin" && !(v < 100)) return setErr("รายการที่ " + (i + 1) + " สัดส่วนต้องน้อยกว่า 100%");
      if (l.basis === "shareOfResin" && !(v <= 100)) return setErr("รายการที่ " + (i + 1) + " สัดส่วนเม็ดต้องไม่เกิน 100%");
    }
    if (!useW && runnerG > 0) return setErr("กรอกรันเนอร์แล้ว ต้องกรอกน้ำหนักชิ้นงาน (กรัม/ชิ้น) ด้วย");
    if (useW && cavN >= 1 && cavN % ppu !== 0) return setErr("จำนวนคาวิตี้ (" + cavN + ") ต้องหารด้วยจำนวนชิ้นต่อชุด (" + ppu + ") ลงตัว");
    if (useW && !wOk) return setErr("ต้องระบุจำนวนคาวิตี้ หรือเลือกแม่พิมพ์ที่มีคาวิตี้");
    if (useW && runnerG < 0) return setErr("น้ำหนักรันเนอร์ต้องไม่ติดลบ");
    if (f.resinMix && !useW) {
      if (!(parseFloat(f.resinWeight) > 0)) return setErr("กรุณากรอกน้ำหนักเม็ดรวมต่อชิ้น (กรัม/ชิ้น)");
      if (Math.abs(shareSum - 100) > 1e-6) return setErr("สัดส่วนเม็ดรวมต้องเท่ากับ 100 % พอดี (ตอนนี้ " + _fmt(shareSum, 2) + " %)");
    }
    if (f.resinMix && Math.abs(shareSum - 100) > 1e-6) return setErr("สัดส่วนเม็ดรวมต้องเท่ากับ 100 % พอดี (ตอนนี้ " + _fmt(shareSum, 2) + " %)");
    const lines = f.lines.map((l) => {
      const m = Store.state.materials.find((x) => x.id === l.item);
      const v = l.basis === "perPiece" ? (useW && l.type === "resin" ? rwKg : valueKg(l)) : parseFloat(l.value);
      return { item: l.item, name: m ? m.name : l.item, type: l.type, basis: l.basis, ...(l.basis === "perPiece" ? { qty: v } : { pct: v }), unit: "KG/PCS" };
    });
    const body = { ...(editing ? rec : {}), productCode: f.productCode, name: f.name.trim(), color: f.color.trim(), mold: f.mold, status: f.status,
      wasteRate: parseFloat(f.wasteRate) || 0, packaging: f.packaging.trim(), lines };
    if (f.resinMix) body.resinWeight = useW ? rwKg : parseFloat(f.resinWeight) / 1000; else delete body.resinWeight;
    if (useW) Object.assign(body, { partWeight: partG, runnerWeight: runnerG, cavities: cavN, piecesPerUnit: ppu, regrindItem: f.regrindItem || undefined });
    else { delete body.partWeight; delete body.runnerWeight; delete body.cavities; delete body.piecesPerUnit; delete body.regrindItem; }
    if (editing) body.changeReason = changeReason.trim();
    if (!editing) {
      let n = Store.state.boms.filter((b) => b.productCode === f.productCode).length + 1;
      while (Store.state.boms.some((b) => b.id === "BOM-" + f.productCode + "-" + n)) n++;
      body.id = "BOM-" + f.productCode + "-" + n;
      delete body._version;
    }
    setSaving(true);
    try {
      await Store.saveBom(body, !editing);
      onDone(editing ? `แก้ไขสูตร "${body.name}" แล้ว` : `สร้างสูตร "${body.name}" แล้ว`);
    } catch (e2) {
      setErr(e2 && e2.message ? e2.message : String(e2));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ padding: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label className="field-label">สินค้า *</label>
          <select className="select" value={f.productCode} disabled={editing} onChange={(e) => pickProduct(e.target.value)}>
            <option value="">— เลือกสินค้าสำเร็จรูป —</option>
            {Store.state.finished.map((p) => <option key={p.id} value={p.code}>{p.code} · {p.name}</option>)}
          </select>
          {editing && <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>เปลี่ยนสินค้าของสูตรไม่ได้ — คัดลอกไปสร้างสูตรใหม่แทน</div>}
        </div>
        <div>
          <label className="field-label">ชื่อสูตร *</label>
          <input className="input" placeholder="เช่น สูตร ABS ดำ" value={f.name} onChange={(e) => set("name", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">สี</label>
          <input className="input" placeholder="เช่น ดำ / น้ำเงิน 2925" value={f.color} onChange={(e) => set("color", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">สถานะ</label>
          <select className="select" value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option value="draft">ร่าง</option>
            <option value="active">ใช้งาน</option>
            <option value="inactive">เลิกใช้</option>
          </select>
        </div>
        <div>
          <label className="field-label">แม่พิมพ์ตั้งต้น (ไม่บังคับ)</label>
          <select className="select" value={f.mold} onChange={(e) => pickMold(e.target.value)}>
            <option value="">—</option>
            {Store.state.molds.map((m) => <option key={m.id} value={m.id}>{m.id} · {m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">เผื่อเสีย (%)</label>
          <input type="number" step="0.1" min="0" max="50" className="input num" value={f.wasteRate} onChange={(e) => set("wasteRate", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">บรรจุภัณฑ์</label>
          <input className="input" placeholder="เช่น กล่อง 60 ชิ้น" value={f.packaging} onChange={(e) => set("packaging", e.target.value)}/>
        </div>
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid var(--border)", borderRadius: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>น้ำหนักชิ้นงานและรันเนอร์ (กรัม)</div>
        <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginBottom: 8 }}>กรอกแล้วระบบคำนวณเม็ดต่อชิ้นให้เอง = (ชิ้นงาน + รันเนอร์ ÷ คาวิตี้) · รันเนอร์เป็นน้ำหนักต่อ 1 ช็อต (ใส่ 0 ถ้าเป็นรันเนอร์ร้อน) · ไม่กรอก = กรอกปริมาณเม็ดเองแบบเดิม</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
          <div><label className="field-label">น้ำหนักชิ้นงาน (กรัม/ชิ้น)</label>
            <input type="number" step="any" min="0" className="input num" value={f.partWeight} placeholder="เช่น 3" onChange={(e) => set("partWeight", e.target.value)}/></div>
          <div><label className="field-label">จำนวนคาวิตี้{moldCav ? " (แม่พิมพ์: " + moldCav + ")" : ""}</label>
            <input type="number" step="1" min="1" className="input num" value={f.cavities} placeholder={moldCav ? String(moldCav) : "เช่น 6"} onChange={(e) => set("cavities", e.target.value)}/></div>
          <div><label className="field-label">จำนวนชิ้นต่อ 1 ชุด/หน่วยสินค้า</label>
            <input type="number" step="1" min="1" className="input num" value={f.piecesPerUnit} onChange={(e) => setPpu(e.target.value)}/>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 3 }}>ขายเป็นชิ้น = 1 · ขายเป็นชุด (เช่น ซ้าย+ขวา) = 2</div></div>
          <div><label className="field-label">น้ำหนักรันเนอร์ (กรัม/ช็อต)</label>
            <input type="number" step="any" min="0" className="input num" value={f.runnerWeight} placeholder="0 = ไม่มี / รันเนอร์ร้อน" onChange={(e) => set("runnerWeight", e.target.value)}/></div>
        </div>
        {!useW && runnerG > 0 && <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--danger)" }}>กรอกรันเนอร์แล้ว ต้องกรอกน้ำหนักชิ้นงานด้วย ระบบถึงจะคำนวณเม็ดให้</div>}
        {useW && runnerG > 0 && (
          <div style={{ marginTop: 8 }}>
            <label className="field-label">รันเนอร์ที่บดแล้วเก็บเข้าสต๊อกเป็น (ถ้ายังบดไม่ทัน ยอดจะรอใช้ในงานถัดไป)</label>
            <select className="select" value={f.regrindItem} onChange={(e) => set("regrindItem", e.target.value)}>
              <option value="">{f.lines.some((l) => l.type === "regrind" && l.item) ? "— ใช้เศษรีไซเคิลในสูตรนี้ —" : "— อัตโนมัติ: เม็ดรีไซเคิลเกรดเดียวกับเม็ดหลัก (ไม่มีจะสร้างให้) —"}</option>
              {mats.filter((m) => m.recycledFrom || m.type === "เศษรีไซเคิล").map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}{m.recycledFrom ? " (รีไซเคิลของ " + m.recycledFrom + ")" : ""}</option>)}
            </select>
          </div>
        )}
        {useW && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: wOk ? "var(--text-primary)" : "var(--danger)" }}>
            {wOk
              ? <>น้ำหนักต่อช็อต <b>{_fmt(partG * cavN + runnerG, 2)}</b> กรัม{ppu > 1 && <> · 1 ช็อตได้ <b>{_fmt(cavN / ppu, 0)}</b> ชุด (ชุดละ {ppu} ชิ้น)</>} · รันเนอร์เฉลี่ย <b>{_fmt(runnerPc, 3)}</b> กรัม/ชิ้น · เม็ดที่ใช้จริง <b>{_fmt(rwKg * 1000, 3)}</b> กรัม/{ppu > 1 ? "ชุด" : "ชิ้น"} (= <b>{_fmt(rwKg * 1000, 2)}</b> กก. ต่อ 1,000 {ppu > 1 ? "ชุด" : "ชิ้น"})</>
              : "ต้องระบุจำนวนคาวิตี้ หรือเลือกแม่พิมพ์ที่มีคาวิตี้"}
          </div>
        )}
      </div>

      <label className="field-label" style={{ marginTop: 16 }}>รายการวัตถุดิบ *</label>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 8, fontSize: 12.5 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={f.resinMix} onChange={(e) => setMix(e.target.checked)}/> ผสมเม็ดหลายเกรด (กำหนดเป็น % ของเม็ดรวม เช่น PP1100 80% + PP4510 20%)
        </label>
        {f.resinMix && <label style={{ display: "flex", gap: 6, alignItems: "center" }}>น้ำหนักเม็ดรวม/ชิ้น (ไม่รวมมาสเตอร์แบตช์)
          {useW ? <span className="num" style={{ width: 100, textAlign: "right", fontWeight: 600 }}>{_fmt(rwKg * 1000, 3)}</span>
            : <input type="number" step="any" min="0" className="input num" style={{ width: 100, height: 32, textAlign: "right" }} value={f.resinWeight} onChange={(e) => set("resinWeight", e.target.value)}/>} {useW ? "กรัม (คำนวณจากด้านบน)" : "กรัม"}</label>}
        {f.resinMix && <span style={{ color: Math.abs(shareSum - 100) > 1e-6 ? "var(--danger)" : "var(--success)" }}>สัดส่วนเม็ดรวม {_fmt(shareSum, 2)} % {Math.abs(shareSum - 100) > 1e-6 ? "(ต้องเป็น 100)" : "✓"}</span>}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginBottom: 6 }}>กรอกน้ำหนักชิ้นงานด้านบนแล้ว แถวเม็ดเลือกแค่วัตถุดิบ ปริมาณคำนวณให้เอง · มาสเตอร์แบตช์/สารเติมแต่งกรอกเป็น กรัม/ชิ้น หรือ % ของน้ำหนักเม็ด · สูตรเก่าที่ไม่กรอกน้ำหนักชิ้นงานยังกรอกปริมาณเม็ดเองได้ · สั่งซื้อและสต๊อกเป็น กก. · เศษรีไซเคิลกรอกเป็น % ของเม็ด (แทนเม็ดใหม่) — ถ้าจะใช้ ให้สร้างวัตถุดิบ "เศษบด" ในคลังก่อน</div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 90px 90px 28px", gap: 8, padding: "8px 10px", background: "var(--bg-subtle)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>
          <div>วัตถุดิบ</div><div>ชนิด</div><div>กำหนดเป็น</div><div style={{ textAlign: "right" }}>ค่า</div><div style={{ textAlign: "right" }}>กรัม/ชิ้น</div><div/>
        </div>
        {f.lines.map((l, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 90px 90px 28px", gap: 8, padding: "8px 10px", borderTop: "1px solid var(--border)", alignItems: "center" }}>
            <select className="select" style={{ height: 34, padding: "0 6px" }} value={l.item} onChange={(e) => setLine(i, { item: e.target.value })}>
              <option value="">— เลือกวัตถุดิบ —</option>
              {mats.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
            </select>
            <select className="select" style={{ height: 34, padding: "0 6px" }} value={l.type}
              onChange={(e) => { const t = e.target.value; setLine(i, { type: t, basis: t === "regrind" ? "pctOfResin" : t === "resin" ? (f.resinMix ? "shareOfResin" : "perPiece") : (l.basis === "shareOfResin" ? "pctOfResin" : l.basis) }); }}>
              {Object.entries(BOM_TYPE_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {l.type === "masterbatch" || l.type === "additive"
              ? <select className="select" style={{ height: 34, padding: "0 6px" }} value={l.basis} onChange={(e) => setLine(i, { basis: e.target.value })}>
                  <option value="perPiece">กรัม/ชิ้น</option><option value="pctOfResin">% ของเม็ด</option>
                </select>
              : <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{l.type === "regrind" ? "% ของเม็ด" : l.type === "resin" ? (f.resinMix ? "% ของเม็ดรวม" : (useW ? "คำนวณอัตโนมัติ" : "กรัม/ชิ้น")) : "กรัม/ชิ้น"}</div>}
            {useW && l.type === "resin" && !f.resinMix
              ? <div style={{ textAlign: "right", fontSize: 11.5, color: "var(--text-tertiary)" }}>อัตโนมัติ</div>
              : <input type="number" step="any" min="0" className="input num" style={{ height: 34, textAlign: "right" }} value={l.value} onChange={(e) => setLine(i, { value: e.target.value })}/>}
            <div className="num" style={{ textAlign: "right", fontSize: 12 }}>{_fmt(((resolved[draft.lines.findIndex((d) => d.item === l.item && d.type === l.type)] || {}).qty || 0) * 1000, 3)}</div>
            <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => set("lines", f.lines.length > 1 ? f.lines.filter((_, idx) => idx !== i) : f.lines)} title="ลบ"><I.X size={13}/></button>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => set("lines", [...f.lines, { item: "", type: "masterbatch", basis: "pctOfResin", value: "" }])}><I.Plus size={13}/> เพิ่มรายการ</button>

      <div style={{ marginTop: 14, background: "var(--bg-subtle)", borderRadius: 10, padding: 12, fontSize: 12.5 }}>
        ต้นทุนวัสดุโดยประมาณ (รวมเผื่อเสีย): <b>{cost.perPiece > 0 ? "฿" + _fmt(cost.perPiece, 4) + " / ชิ้น" : "ยังไม่มีต้นทุน"}</b>
        {cost.missing.length > 0 && <span style={{ color: "var(--amber)" }}> · ยังไม่มีต้นทุน: {cost.missing.join(", ")} (จะมีเมื่อรับ PO)</span>}
      </div>

      {editing && (
        <div style={{ marginTop: 14 }}>
          <label className="field-label">เหตุผลการแก้ไข{rec.status === "active" ? " *" : ""}</label>
          <input className="input" placeholder={rec.status === "active" ? "จำเป็นเมื่อแก้สูตรที่ใช้งานอยู่ เช่น เปลี่ยนเกรดเม็ด / ปรับเผื่อเสีย" : "ไม่บังคับ (สูตรยังไม่ใช้งาน)"} value={changeReason} onChange={(e) => setChangeReason(e.target.value)}/>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>ระบบเก็บสูตรเดิมไว้ในประวัติการแก้ไข · ใบสั่งผลิตที่เปิดไปแล้วใช้สูตรเดิมต่อ ไม่เปลี่ยนตาม</div>
        </div>
      )}
      {err && <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-outline" onClick={onCancel}>ยกเลิก</button>
        <button type="submit" className="btn btn-primary" disabled={saving}><I.Check size={14}/> {editing ? "บันทึกการแก้ไข" : "บันทึกสูตร"}</button>
      </div>
    </form>
  );
}

// ================= Log การใช้งาน (Audit Log จริงจาก Store) =================
const AUDIT_ACTION_TONE = { LOGIN: "info", LOGOUT: "neutral", LOGIN_FAIL: "danger", CREATE: "success", UPDATE: "warning", DELETE: "danger",
  APPROVE: "success", SUBMIT: "info", REJECT: "warning", CANCEL: "danger", CONVERT: "violet", RECEIVE: "success", PRODUCE: "info",
  SHIP: "info", STOCK: "warning", EXPORT: "neutral", IMPORT: "warning", PRINT: "neutral" };
function PageAuditLog() {
  useStore();
  const logs = Store.state.auditLogs;
  const [action, setAction] = useState("ALL");
  const [user, setUser] = useState("ALL");
  const actions = ["ALL", ...Array.from(new Set(logs.map((l) => l.action))).sort()];
  const users = ["ALL", ...Array.from(new Set(logs.map((l) => l.user)))];
  // ค้นหา (เลขที่เอกสาร/รายละเอียด/ผู้ใช้) · การกระทำ · ผู้ใช้ · ช่วงวันที่ · เรียง · แบ่งหน้า (หน้าละ 100)
  const view = useListView(logs, {
    text: (l) => [l.entity, l.entityId, l.detail, l.user, l.action].join(" "),
    dateKey: (l) => l.at, dateLabel: "วันที่",
    filter: (l) => (action === "ALL" || l.action === action) && (user === "ALL" || l.user === user), filterKey: action + "|" + user, pageSize: 100,
    defaultSort: { key: "at", dir: "desc" },
    sorts: { at: (l) => String(l.at || ""), user: (l) => l.user, action: (l) => l.action, entity: (l) => l.entity, entityId: (l) => l.entityId },
  });
  const filtered = view.sorted;
  return (
    <>
      <window.PageHeader title="Log การใช้งานระบบ" subtitle="บันทึกอัตโนมัติทุกการเข้าใช้งาน การสร้าง แก้ไข อนุมัติ ยกเลิก และการเปลี่ยนแปลงสต๊อก"
        actions={<><button className="btn btn-outline btn-sm" onClick={() => printReport("Log การใช้งานระบบ")}><I.Printer size={14}/> พิมพ์ / PDF</button><button className="btn btn-outline btn-sm" disabled={!filtered.length}
          onClick={() => exportCSV(`audit-log-${Store.today()}.csv`, ["วันเวลา", "ผู้ใช้", "Role", "การกระทำ", "ประเภท", "อ้างอิง", "รายละเอียด"],
            filtered.map((l) => [l.at, l.user, l.role, l.action, l.entity, l.entityId, l.detail]))}><I.Download size={14}/> ส่งออก CSV</button></>}/>
      <div className="card">
        <ListToolbar view={view} placeholder="ค้นหาเลขที่เอกสาร / รายละเอียด / ผู้ใช้…">
          <select className="input" style={{ width: 160 }} aria-label="การกระทำ" value={action} onChange={(e) => setAction(e.target.value)}>
            {actions.map((a) => <option key={a} value={a}>{a === "ALL" ? "ทุกการกระทำ" : a}</option>)}</select>
          <select className="input" style={{ width: 160 }} aria-label="ผู้ใช้" value={user} onChange={(e) => setUser(e.target.value)}>
            {users.map((a) => <option key={a} value={a}>{a === "ALL" ? "ผู้ใช้ทั้งหมด" : a}</option>)}</select>
        </ListToolbar>
        <div style={{ overflow: "auto" }}>
          <table className="table" style={{ fontSize: 12.5 }}>
            <thead><tr><SortTh view={view} k="at">วันเวลา</SortTh><SortTh view={view} k="user">ผู้ใช้</SortTh><SortTh view={view} k="action">การกระทำ</SortTh><SortTh view={view} k="entity">ประเภท</SortTh><SortTh view={view} k="entityId">อ้างอิง</SortTh><th>รายละเอียด</th></tr></thead>
            <tbody>
              {view.pageRows.map((l) => (
                <tr key={l.id}><td className="num" style={{ whiteSpace: "nowrap" }}>{l.at}</td><td>{l.user}<div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{l.role}</div></td>
                  <td><span className={"badge badge-" + (AUDIT_ACTION_TONE[l.action] || "neutral")}>{l.action}</span></td><td>{l.entity}</td>
                  <td className="mono">{l.entityId}</td><td>{l.detail}</td></tr>
              ))}
              {!view.total && <EmptyRow cols={6} text={logs.length ? "ไม่พบบันทึกตามเงื่อนไข" : "ยังไม่มีบันทึก"}/>}
            </tbody>
          </table>
        </div>
        <Pager view={view}/>
      </div>
    </>
  );
}

// ================= ปฏิทินซ่อมบำรุงแม่พิมพ์ (คำนวณจากข้อมูลแม่พิมพ์) =================
const MOLD_PM_DAYS = 90; // รอบบำรุงรักษาตามเวลา
function moldNextPM(m) {
  if (!m.lastMaint) return Store.today();
  const d = new Date(m.lastMaint + "T00:00:00"); d.setDate(d.getDate() + MOLD_PM_DAYS);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function MaintenanceCalendar() {
  useStore();
  const [offset, setOffset] = useState(0);
  const base = new Date(Store.today() + "T00:00:00");
  const first = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const p = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const today = Store.today();
  const events = [];
  Store.state.molds.forEach((m) => {
    const due = moldNextPM(m);
    events.push({ date: due < today ? today : due, mold: m, overdue: due < today, kind: "PM", text: `PM ${m.code}` });
    (m.maintLog || []).forEach((x) => events.push({ date: x.date, mold: m, done: true, text: `ซ่อม ${m.code}: ${x.note}` }));
  });
  (Store.state.machines || []).filter((m) => m.condition !== "retired").forEach((m) => {
    const pm = Store.machinePM(m);
    if (pm.next) events.push({ date: pm.next < today ? today : pm.next, overdue: pm.overdue, kind: "PM", text: `PM เครื่อง ${m.id}` });
    (m.maintLog || []).forEach((x) => events.push({ date: x.date, done: true, text: `${x.kind === "PM" ? "PM" : "ซ่อม"} เครื่อง ${m.id}: ${x.note}` }));
  });
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) { const date = new Date(start); date.setDate(start.getDate() + w * 7 + d); const k = iso(date); days.push({ date, k, ev: events.filter((e) => e.date === k) }); }
    weeks.push(days);
  }
  const TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return (
    <div className="card">
      <div className="card-head">
        <div><div className="card-title">ปฏิทินซ่อมบำรุง (แม่พิมพ์ + เครื่องจักร) · {TH[first.getMonth()]} {first.getFullYear()}</div>
          <div className="card-sub">กำหนด PM ทุก {MOLD_PM_DAYS} วันนับจากซ่อมครั้งล่าสุด · สีแดง = เลยกำหนด · สีเขียว = ซ่อมแล้ว</div></div>
        <div className="card-actions">
          <button className="btn btn-ghost btn-sm" aria-label="เดือนก่อน" onClick={() => setOffset((o) => o - 1)}><I.ChevronLeft size={13}/></button>
          <button className="btn btn-ghost btn-sm" onClick={() => setOffset(0)}>เดือนนี้</button>
          <button className="btn btn-ghost btn-sm" aria-label="เดือนถัดไป" onClick={() => setOffset((o) => o + 1)}><I.ChevronRight size={13}/></button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, background: "var(--border)", padding: 1 }}>
        {["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"].map((d) => <div key={d} style={{ background: "var(--bg-subtle)", padding: 6, fontSize: 11.5, textAlign: "center", fontWeight: 600 }}>{d}</div>)}
        {weeks.flat().map((d) => (
          <div key={d.k} style={{ background: "var(--bg-elevated)", minHeight: 74, padding: 6, opacity: d.date.getMonth() === first.getMonth() ? 1 : 0.45 }}>
            <div className="num" style={{ fontSize: 11.5, fontWeight: d.k === today ? 700 : 400, color: d.k === today ? "var(--accent)" : "var(--text-secondary)" }}>{d.date.getDate()}</div>
            {d.ev.map((e, i) => (
              <div key={i} title={e.text} style={{ fontSize: 10.5, marginTop: 3, padding: "2px 4px", borderRadius: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                background: e.done ? "var(--success-subtle)" : e.overdue ? "var(--danger-subtle)" : "var(--amber-subtle)",
                color: e.done ? "var(--success)" : e.overdue ? "var(--danger)" : "var(--amber)" }}>{e.text}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ================= รายงานภาษี ภพ.30 / ภงด.53 (จากเอกสารจริง) =================
function TaxReport({ month }) {
  useStore();
  const goWhtPage = () => window.dispatchEvent(new CustomEvent("erp-goto", { detail: { page: "fin-wht" } }));
  const ym = month || Store.today().slice(0, 7);
  const m = Analytics.month(ym);
  const sales = m.invoices.filter((d) => d.vatOn).map((d) => ({ date: d.date, doc: d.id, customer: (d.customerSnap && d.customerSnap.name) || d.customerName, taxId: (d.customerSnap && d.customerSnap.taxId) || "—", subtotal: d.subtotal, vat: d.vat }));
  const supplier = (name) => Store.state.suppliers.find((s) => name && (s.name.includes(name) || name.includes(s.code))) || null;
  const purchases = m.expenses.filter((e) => e.vat > 0).map((e) => ({ date: e.date, doc: e.id, vendor: e.vendor, taxId: (supplier(e.vendor) || {}).taxId || "—", subtotal: e.amount, vat: e.vat }));
  const salesVat = sales.reduce((s, x) => s + x.vat, 0), purchaseVat = purchases.reduce((s, x) => s + x.vat, 0), net = salesVat - purchaseVat;
  const tbl = (head, rows, empty) => (
    <table className="table" style={{ fontSize: 12.5 }}><thead><tr>{head.map((h, i) => <th key={i} className={i >= head.length - 2 ? "num" : ""}>{h}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j >= r.length - 2 ? "num" : j === 1 ? "mono" : ""}>{c}</td>)}</tr>) : <EmptyRow cols={head.length} text={empty}/>}</tbody></table>
  );
  return (
    <>
      <div className="grid-3" style={{ marginBottom: 14 }}>
        <KPICard icon="TrendUp" tone="accent" label="ภาษีขาย" value={baht(salesVat, 2)} foot={`${sales.length} ใบกำกับภาษี`}/>
        <KPICard icon="TrendDown" tone="violet" label="ภาษีซื้อ" value={baht(purchaseVat, 2)} foot={`${purchases.length} รายการค่าใช้จ่าย`}/>
        <KPICard icon="Wallet" tone={net >= 0 ? "amber" : "success"} label={net >= 0 ? "ภาษีต้องชำระ" : "ภาษีชำระเกิน (ขอคืน/ยกไป)"} value={baht(Math.abs(net), 2)} foot={"ภพ.30 เดือน " + ym}/>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><div className="card-title">รายงานภาษีขาย</div>
          <div className="card-actions"><button className="btn btn-outline btn-sm" disabled={!sales.length} onClick={() => exportCSV(`ภาษีขาย-${ym}.csv`, ["วันที่", "เลขที่", "ลูกค้า", "เลขผู้เสียภาษี", "มูลค่า", "VAT"], sales.map((x) => [x.date, x.doc, x.customer, x.taxId, x.subtotal, x.vat]))}><I.Download size={13}/> CSV</button></div></div>
        {tbl(["วันที่", "เลขที่", "ลูกค้า", "เลขผู้เสียภาษี", "มูลค่า", "VAT"], sales.map((x) => [x.date, x.doc, x.customer, x.taxId, _fmt(x.subtotal, 2), _fmt(x.vat, 2)]), "ไม่มีใบกำกับภาษีในเดือนนี้")}
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><div className="card-title">รายงานภาษีซื้อ</div>
          <div className="card-actions"><button className="btn btn-outline btn-sm" disabled={!purchases.length} onClick={() => exportCSV(`ภาษีซื้อ-${ym}.csv`, ["วันที่", "เลขที่", "ผู้ขาย", "เลขผู้เสียภาษี", "มูลค่า", "VAT"], purchases.map((x) => [x.date, x.doc, x.vendor, x.taxId, x.subtotal, x.vat]))}><I.Download size={13}/> CSV</button></div></div>
        {tbl(["วันที่", "เลขที่", "ผู้ขาย", "เลขผู้เสียภาษี", "มูลค่า", "VAT"], purchases.map((x) => [x.date, x.doc, x.vendor, x.taxId, _fmt(x.subtotal, 2), _fmt(x.vat, 2)]), "ไม่มีภาษีซื้อในเดือนนี้")}
      </div>
      <div className="card" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.3/53) และหนังสือรับรอง 50 ทวิ ย้ายไปอยู่ที่เมนู การเงิน → ภาษีหัก ณ ที่จ่าย (ค่าใช้จ่าย)</span>
        <button className="btn btn-outline btn-sm" onClick={goWhtPage}>เปิดหน้าภาษีหัก ณ ที่จ่าย</button>
      </div>
    </>
  );
}

// ================= ภาษีหัก ณ ที่จ่าย (ฝั่งค่าใช้จ่าย) — หน้าในเมนูการเงิน ต่อจาก จ่ายเงิน (ใบสำคัญจ่าย) =================
function PageFinWht() {
  useStore();
  const [whtExp, setWhtExp] = useState(null);
  const role = Store.user() ? Store.user().role : null;
  const canWht = role === "admin" || role === "accounting";
  const all = Store.state.expenses.filter((e) => e.status !== "cancelled" && e.whtRate > 0);
  const months = React.useMemo(() => {
    const s = new Set(all.map((e) => String(e.date || "").slice(0, 7)));
    s.add(Store.today().slice(0, 7));
    return [...s].filter(Boolean).sort().reverse();
  }, [all.length]);
  const [month, setMonth] = useState(() => months.find((m) => all.some((e) => String(e.date || "").slice(0, 7) === m)) || months[0]);
  const [st, setSt] = useState("ALL");
  const rowsAll = all.filter((e) => String(e.date || "").slice(0, 7) === month).map((e) => ({ ...e, tax: e.amount * e.whtRate / 100 }));
  const stOf = (e) => (e.whtCert ? "issued" : e.status === "paid" ? "todo" : "unpaid");
  const view = useListView(rowsAll, {
    text: (e) => [e.id, e.vendor, e.category, e.payVoucher, e.payWtNo, e.whtCert && e.whtCert.no].join(" "),
    dateKey: (e) => e.date, dateLabel: "วันที่",
    filter: (e) => st === "ALL" || stOf(e) === st, filterKey: st,
    defaultSort: { key: "date", dir: "desc" },
    sorts: { date: (e) => e.date, id: (e) => e.id, vendor: (e) => e.vendor, category: (e) => e.category, base: (e) => e.amount, tax: (e) => e.tax, paid: (e) => e.paidDate || "", cert: (e) => (e.whtCert && e.whtCert.no) || e.payWtNo || "" },
  });
  const totalTax = rowsAll.reduce((s, e) => s + e.tax, 0);
  const n = (k) => rowsAll.filter((e) => stOf(e) === k).length;
  const goPay = (id) => window.dispatchEvent(new CustomEvent("erp-goto", { detail: { page: "fin-payments", focus: { pvExpense: id } } }));
  const csv = () => exportCSV(`ภงด53-${month}.csv`, ["วันที่", "เลขที่", "ผู้รับเงิน", "ประเภทเงินได้", "ฐานภาษี", "อัตรา %", "ภาษีที่หัก", "ใบสำคัญจ่าย", "วันที่จ่าย", "เลขที่หนังสือรับรอง"],
    view.sorted.map((e) => [e.date, e.id, e.vendor, e.category, e.amount, e.whtRate, e.tax, e.payVoucher || "", e.paidDate || "", (e.whtCert && e.whtCert.no) || e.payWtNo || ""]));
  return (
    <>
      <PageHeader title="ภาษีหัก ณ ที่จ่าย (ค่าใช้จ่าย)" subtitle="ภาษีที่เราหักผู้รับเงิน · ออกหนังสือรับรอง 50 ทวิ จากรายการที่จ่ายผ่านใบสำคัญจ่าย"
        actions={<><MonthSelect months={months} value={month} onChange={setMonth}/><button className="btn btn-outline btn-sm" disabled={!view.total} onClick={csv}><I.Download size={14}/> CSV</button></>}/>
      <div className="grid-4" style={{ marginBottom: 14 }}>
        <KPICard icon="Wallet" tone="amber" label={"ภาษีที่หัก " + month} value={baht(totalTax, 2)} foot={rowsAll.length + " รายการ"}/>
        <KPICard icon="Clock" tone="violet" label="ยังไม่จ่ายเงิน" value={n("unpaid") + " รายการ"} foot="ต้องทำใบสำคัญจ่ายก่อน"/>
        <KPICard icon="Check" tone="amber" label="จ่ายแล้ว รอออกหนังสือ" value={n("todo") + " รายการ"} foot="กดออก 50 ทวิ"/>
        <KPICard icon="Check" tone="success" label="ออกหนังสือแล้ว" value={n("issued") + " รายการ"} foot=""/>
      </div>
      <div className="card" style={{ overflowX: "auto" }}>
        <ListToolbar view={view} placeholder="เลขที่ / ผู้รับเงิน / ใบสำคัญจ่าย / เลข 50 ทวิ…">
          <select className="select" style={{ width: 190 }} value={st} onChange={(e) => setSt(e.target.value)} aria-label="สถานะ">
            <option value="ALL">ทุกสถานะ</option><option value="unpaid">ยังไม่จ่ายเงิน</option><option value="todo">จ่ายแล้ว รอออกหนังสือ</option><option value="issued">ออกหนังสือแล้ว</option>
          </select>
        </ListToolbar>
        <table className="table" style={{ fontSize: 12.5 }}>
          <thead><tr><SortTh view={view} k="date">วันที่</SortTh><SortTh view={view} k="id">เลขที่</SortTh><SortTh view={view} k="vendor">ผู้รับเงิน</SortTh><SortTh view={view} k="category">ประเภท</SortTh>
            <SortTh view={view} k="base" className="num">ฐานภาษี</SortTh><SortTh view={view} k="tax" className="num">ภาษีที่หัก</SortTh><SortTh view={view} k="paid">จ่ายเมื่อ</SortTh><SortTh view={view} k="cert">หนังสือรับรอง (50 ทวิ)</SortTh></tr></thead>
          <tbody>
            {view.pageRows.map((e) => {
              const cert = e.whtCert, s = stOf(e);
              return (
                <tr key={e.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{e.date}</td><td className="mono"><b>{e.id}</b></td><td>{e.vendor}</td><td>{e.category}</td>
                  <td className="num">{_fmt(e.amount, 2)}</td><td className="num">{_fmt(e.tax, 2)} ({e.whtRate}%)</td>
                  <td style={{ whiteSpace: "nowrap" }}>{e.paidDate ? <>{e.paidDate}{e.payVoucher ? <div className="mono" style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>{e.payVoucher}</div> : <div style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>ข้อมูลเดิม ไม่มี PV</div>}</> : <span style={{ color: "var(--text-tertiary)" }}>ยังไม่จ่าย</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {s === "issued" ? <button className="btn btn-outline btn-sm" onClick={() => setWhtExp(e)}><I.Printer size={13}/> {cert.no}</button>
                      : s === "todo" ? <><button className="btn btn-primary btn-sm" onClick={() => setWhtExp(e)}>ออก 50 ทวิ</button>{e.payWtNo ? <span className="mono" style={{ fontSize: 10.5, marginLeft: 6, color: "var(--text-tertiary)" }}>{e.payWtNo}</span> : null}</>
                      : <>{canWht && <button className="btn btn-outline btn-sm" onClick={() => goPay(e.id)}>ทำใบสำคัญจ่าย</button>}</>}
                  </td>
                </tr>
              );
            })}
            {!view.total && <EmptyRow cols={8} text={rowsAll.length ? "ไม่พบรายการตามเงื่อนไข" : "ไม่มีรายการหัก ณ ที่จ่ายในเดือนนี้"}/>}
          </tbody>
        </table>
        <Pager view={view}/>
        <div style={{ padding: "8px 16px 12px", fontSize: 11.5, color: "var(--text-tertiary)" }}>เดือนที่แสดงอิงตามวันที่ของรายการค่าใช้จ่าย · ออกหนังสือรับรอง (50 ทวิ) ได้เมื่อจ่ายเงินผ่านใบสำคัญจ่ายแล้ว — วันที่จ่ายและเลขที่ใช้ตามใบสำคัญจ่าย · เดือนที่ต้องยื่น ภ.ง.ด. ให้ยึดตามที่ผู้ทำบัญชีหรือที่ปรึกษาภาษีกำหนด</div>
        {whtExp && <WhtIssueModal exp0={whtExp} onClose={() => setWhtExp(null)}/>}
      </div>
    </>
  );
}
window.PageFinWht = PageFinWht;

// ================= จัดการผู้ใช้ (บัญชีจริงใน Store) =================
const DEPT_LABEL = { admin: "ผู้บริหาร / IT", sales: "ฝ่ายขาย", production: "ฝ่ายผลิต", procurement: "ฝ่ายจัดซื้อ", accounting: "ฝ่ายบัญชี" };
function genTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const a = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(a).map((b) => chars[b % chars.length]).join("") + "!";
}
function PageUsers({ role }) {
  useStore();
  const me = Store.user();
  const users = Store.state.users;
  const [q, setQ] = useState("");
  const [form, setForm] = useState(null); // {mode:'new'|'edit', ...}
  const [tempPw, setTempPw] = useState(null);
  if (!me || me.role !== "admin") {
    return (<><window.PageHeader title="จัดการผู้ใช้" subtitle="เฉพาะผู้ดูแลระบบ"/><div className="card" style={{ padding: 48, textAlign: "center" }}>ไม่มีสิทธิ์เข้าถึง</div></>);
  }
  const list = users.filter((u) => !q || [u.username, u.fullName, u.email].join(" ").toLowerCase().includes(q.toLowerCase()));
  const admins = users.filter((u) => u.role === "admin" && u.status === "active");

  async function save() {
    try {
      if (form.mode === "new") {
        const pw = genTempPassword();
        await Store.createUser(form, pw, true);
        setTempPw({ username: form.username, pw });
      } else {
        const u = Store.find("users", form.id);
        if (u.role === "admin" && form.role !== "admin" && admins.length <= 1) throw new Store.ERPError("ต้องมีผู้ดูแลระบบอย่างน้อย 1 บัญชี");
        Store.update("users", form.id, { fullName: form.fullName, role: form.role, email: form.email, dept: form.dept }, "id", `แก้ไขบัญชี ${u.username}`);
        notify("บันทึกข้อมูลผู้ใช้แล้ว");
      }
      setForm(null);
    } catch (e) { notify(e.message, "error"); }
  }
  async function resetPw(u) {
    if (!window.confirm(`รีเซ็ตรหัสผ่านของ ${u.username}?`)) return;
    const pw = genTempPassword();
    try { await Store.setPassword(u.id, pw); Store.update("users", u.id, { mustChange: true }, "id", "รีเซ็ตรหัสผ่าน (บังคับเปลี่ยนเมื่อเข้าครั้งถัดไป)"); setTempPw({ username: u.username, pw }); }
    catch (e) { notify(e.message, "error"); }
  }
  function toggle(u) {
    if (u.id === me.id) { notify("ระงับบัญชีของตัวเองไม่ได้", "error"); return; }
    if (u.status === "active" && u.role === "admin" && admins.length <= 1) { notify("ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 บัญชี", "error"); return; }
    runAction(() => Store.update("users", u.id, { status: u.status === "active" ? "suspended" : "active" }, "id", u.status === "active" ? "ระงับบัญชี" : "เปิดใช้งานบัญชี"), "อัปเดตสถานะบัญชีแล้ว");
  }
  function del(u) {
    if (u.id === me.id) { notify("ลบบัญชีของตัวเองไม่ได้", "error"); return; }
    if (u.role === "admin" && admins.length <= 1) { notify("ต้องมีผู้ดูแลระบบอย่างน้อย 1 บัญชี", "error"); return; }
    if (u.lastLogin) { notify("บัญชีนี้เคยใช้งานแล้ว (มีประวัติใน Log) — ใช้การระงับแทนการลบ", "error"); return; }
    if (window.confirm(`ลบบัญชี ${u.username}?`)) runAction(() => Store.remove("users", u.id), "ลบบัญชีแล้ว");
  }
  const lbl = { fontSize: 12, color: "var(--text-secondary)", display: "block", margin: "8px 0 4px" };
  return (
    <>
      <window.PageHeader title="จัดการผู้ใช้" subtitle="สร้างบัญชี กำหนด Role/สิทธิ์ ระงับ และรีเซ็ตรหัสผ่าน"
        actions={<button className="btn btn-primary btn-sm" onClick={() => setForm({ mode: "new", username: "", fullName: "", role: "sales", email: "", dept: "" })}><I.Plus size={14}/> เพิ่มผู้ใช้</button>}/>
      <div className="card">
        <div style={{ padding: 14 }}><input className="input" style={{ maxWidth: 300 }} placeholder="ค้นหาชื่อ / username / อีเมล" value={q} onChange={(e) => setQ(e.target.value)}/></div>
        <table className="table">
          <thead><tr><th>ผู้ใช้</th><th>Role / สิทธิ์</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th style={{ width: 300 }}></th></tr></thead>
          <tbody>{list.map((u) => (
            <tr key={u.id}>
              <td><b>{u.fullName}</b>{u.id === me.id && <span className="badge badge-info" style={{ marginLeft: 6 }}>คุณ</span>}<div className="mono" style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{u.username} {u.email && "· " + u.email}</div></td>
              <td>{(ROLES[u.role] || {}).label || u.role}<div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>อนุมัติได้: {ROLES[u.role] && ROLES[u.role].approve === "*" ? "ทุกเอกสาร" : ((ROLES[u.role] || {}).approve || []).map((t) => DOC_LABEL[t].th).join(", ") || "—"}</div></td>
              <td><span className={"badge badge-" + (u.status === "active" ? "success" : "danger")}>{u.status === "active" ? "ใช้งาน" : "ระงับ"}</span>{u.mustChange && <div style={{ fontSize: 11, color: "var(--amber)" }}>รอเปลี่ยนรหัสผ่าน</div>}</td>
              <td className="num" style={{ fontSize: 12 }}>{u.lastLogin || "—"}</td>
              <td style={{ textAlign: "right" }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setForm({ mode: "edit", ...u })}><I.Edit size={13}/> แก้ไข</button>
                <button className="btn btn-ghost btn-sm" onClick={() => resetPw(u)}>รีเซ็ตรหัส</button>
                <button className="btn btn-ghost btn-sm" onClick={() => toggle(u)}>{u.status === "active" ? "ระงับ" : "เปิดใช้"}</button>
                <button className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} aria-label="ลบ" onClick={() => del(u)}><I.Trash size={13}/></button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {form && (
        <ErpModal title={form.mode === "new" ? "เพิ่มผู้ใช้" : "แก้ไข " + form.username} width={460} onClose={() => setForm(null)}
          footer={<><button className="btn btn-outline btn-sm" onClick={() => setForm(null)}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={save} disabled={!form.fullName || !form.username}>บันทึก</button></>}>
          <label style={lbl}>ชื่อผู้ใช้ (username)</label><input className="input" disabled={form.mode !== "new"} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.trim() })}/>
          <label style={lbl}>ชื่อ-นามสกุล</label><input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })}/>
          <label style={lbl}>Role</label><select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select>
          <label style={lbl}>อีเมล</label><input className="input" type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })}/>
          {form.mode === "new" && <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 10 }}>ระบบจะสร้างรหัสผ่านชั่วคราวให้ และบังคับเปลี่ยนเมื่อเข้าใช้ครั้งแรก</div>}
        </ErpModal>
      )}
      {tempPw && (
        <ErpModal title="รหัสผ่านชั่วคราว" width={420} onClose={() => setTempPw(null)} footer={<button className="btn btn-primary btn-sm" onClick={() => setTempPw(null)}>เรียบร้อย</button>}>
          <div style={{ fontSize: 13 }}>แจ้งรหัสผ่านนี้ให้ <b>{tempPw.username}</b> (แสดงครั้งเดียว ระบบไม่เก็บรหัสจริง):</div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 700, padding: 14, background: "var(--bg-subtle)", borderRadius: 10, marginTop: 10, textAlign: "center", userSelect: "all" }}>{tempPw.pw}</div>
        </ErpModal>
      )}
    </>
  );
}

Object.assign(window, { PageAuditLog, MaintenanceCalendar, TaxReport, BOMViewer, PageUsers, KPICard, Step, moldNextPM });
