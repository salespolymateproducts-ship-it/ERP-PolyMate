/* global React, I, CUSTOMERS, MATERIALS, FINISHED, MOLDS, ROLES, Store, useStore, Analytics, PageHeader, Tabs, Drawer, baht, _fmt, exportCSV, notify, runAction, ErpModal, DocBadge, DocStatusBadge, EmptyRow */

function PageCustomers() {
  const [open, setOpen] = useState(() => { const code = window.takeFocus("customer"); return code ? CUSTOMERS.find((c) => c.code === code) || null : null; });
  const [seg, setSeg] = useState("ALL");
  const [edit, setEdit] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState("");
  useStore();
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  const q = search.trim().toLowerCase();
  const stats = Object.fromEntries(CUSTOMERS.map((c) => [c.code, Analytics.customerStats(c.code)]));
  const segments = ["ALL", ...Array.from(new Set(CUSTOMERS.map((c) => c.segment).filter(Boolean)))];
  const rows = CUSTOMERS.filter((c) => (seg === "ALL" || c.segment === seg) && (!q || (c.name + c.nameEn + c.code + c.taxId + c.contact).toLowerCase().includes(q)));
  const totalSales = Object.values(stats).reduce((s, x) => s + x.total, 0);
  const totalAR = Object.values(stats).reduce((s, x) => s + x.outstanding, 0);

  return (
    <>
      <PageHeader
        title="ลูกค้า"
        subtitle={`${CUSTOMERS.length} ราย · ยอดขายรวม ${baht(totalSales)} · ลูกหนี้คงค้าง ${baht(totalAR)} (จากใบกำกับภาษีที่อนุมัติ)`}
        actions={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => exportCSV(`ลูกค้า-${Store.today()}.csv`, ["รหัส", "ชื่อ", "เลขผู้เสียภาษี", "ผู้ติดต่อ", "โทร", "อีเมล", "เครดิต (วัน)", "กลุ่ม", "ยอดขายรวม", "ลูกหนี้คงค้าง"], rows.map((c) => [c.code, c.name, c.taxId, c.contact, c.phone, c.email, c.credit, c.segment, stats[c.code].total, stats[c.code].outstanding]))}><I.Download size={14}/> ส่งออก CSV</button>
            <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}><I.Plus size={14}/> เพิ่มลูกค้า</button>
          </>
        }
      />
      <div className="card">
        <div style={{ padding: "12px 16px", display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
            <I.Search size={14} style={{ position: "absolute", left: 10, top: 9, color: "var(--text-tertiary)" }}/>
            <input className="input" placeholder="ค้นหาบริษัท หรือเลขผู้เสียภาษี…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 32 }}/>
          </div>
          <span className="spacer"/>
          <select className="input" style={{ width: 200 }} aria-label="กลุ่มธุรกิจ" value={seg} onChange={(e) => setSeg(e.target.value)}>{segments.map((s) => <option key={s} value={s}>{s === "ALL" ? "ทุกกลุ่มธุรกิจ" : s}</option>)}</select>
        </div>
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>รหัส</th>
                <th>บริษัท</th>
                <th>เลขผู้เสียภาษี</th>
                <th>ผู้ติดต่อ</th>
                <th>เครดิตเทอม</th>
                <th>Segment</th>
                <th className="num">ใบกำกับปีนี้</th>
                <th className="num">ยอดขายรวม</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} onClick={() => setOpen(c)} style={{ cursor: "pointer" }}>
                  <td className="mono"><b>{c.code}</b></td>
                  <td>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{c.address.split(",")[0]}</div>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{c.taxId}</td>
                  <td>
                    <div style={{ fontSize: 12.5 }}>{c.contact}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{c.phone}</div>
                  </td>
                  <td>{c.credit} วัน</td>
                  <td><span className="badge badge-neutral">{c.segment}</span></td>
                  <td className="num">{stats[c.code].ytd}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{baht(stats[c.code].total)}</td>
                  <td>
                    {c.status === "active"
                      ? <span className="badge badge-success"><span className="b-dot"/>Active</span>
                      : <span className="badge badge-warning"><span className="b-dot"/>เฝ้าระวัง</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.name} width={620}>
        {open && <CustomerDetail c={CUSTOMERS.find((x) => x.code === open.code) || open} onEdit={(c) => setEdit({ ...c })}/>}
      </Drawer>

      <Drawer open={addOpen} onClose={() => setAddOpen(false)} title="เพิ่มลูกค้าใหม่" width={600}>
        {addOpen && <AddCustomerForm
          onCancel={() => setAddOpen(false)}
          onSubmit={(rec) => { if (CUSTOMERS.some((c) => c.code === rec.code)) { notify("รหัสลูกค้านี้มีอยู่แล้ว", "error"); return; } Store.add("customers", rec, rec.name); setAddOpen(false); showToast(`เพิ่มลูกค้า ${rec.name} เรียบร้อย`); }}
        />}
      </Drawer>

      {edit && <ErpModal title={"แก้ไขลูกค้า " + edit.code} width={520} onClose={() => setEdit(null)}
        footer={<><button className="btn btn-outline btn-sm" onClick={() => setEdit(null)}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={() => { const patch = Object.assign({}, edit); delete patch.id; if (runAction(() => Store.update("customers", edit.id, patch), "บันทึกข้อมูลลูกค้าแล้ว")) setEdit(null); }}>บันทึก</button></>}>
        {[["name", "ชื่อบริษัท"], ["nameEn", "ชื่อภาษาอังกฤษ"], ["taxId", "เลขผู้เสียภาษี"], ["contact", "ผู้ติดต่อ"], ["phone", "โทร"], ["email", "อีเมล"], ["address", "ที่อยู่"]].map(([k, l]) => (
          <div key={k} style={{ marginBottom: 8 }}><label className="field-label">{l}</label><input className="input" value={edit[k] || ""} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}/></div>))}
        <div className="grid-2" style={{ gap: 8 }}>
          <div><label className="field-label">เครดิต (วัน)</label><input className="input" type="number" min="0" value={edit.credit} onChange={(e) => setEdit({ ...edit, credit: Number(e.target.value) })}/></div>
          <div><label className="field-label">สถานะ</label><select className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="active">ปกติ</option><option value="watch">เฝ้าระวัง</option><option value="inactive">ระงับ</option></select></div>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 8 }}>เอกสารที่ออกไปแล้วเก็บข้อมูลลูกค้า ณ วันที่ออกไว้ ไม่เปลี่ยนตาม</div>
      </ErpModal>}

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

function AddCustomerForm({ onSubmit, onCancel }) {
  const SEGMENTS = ["Automotive", "Consumer Goods", "Medical", "Packaging", "Electronics", "Food & Beverage", "อื่นๆ"];
  const [form, setForm] = useState({
    code: "", name: "", nameEn: "", taxId: "", contact: "", phone: "", email: "",
    credit: 30, address: "", segment: "Automotive", status: "active",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.name.trim() && form.code.trim();

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    const n = CUSTOMERS.length + 1;
    onSubmit({
      id: "CUS-" + String(n).padStart(3, "0") + "-" + Date.now().toString().slice(-4),
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      nameEn: form.nameEn.trim() || form.name.trim(),
      taxId: form.taxId.trim() || "—",
      contact: form.contact.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      credit: parseInt(form.credit, 10) || 0,
      address: form.address.trim(),
      segment: form.segment,
      status: form.status,
    });
  };

  return (
    <form onSubmit={submit} style={{ padding: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="field-label">รหัสลูกค้า (อักษรย่อ) *</label>
          <input required className="input" style={{ fontFamily: "var(--font-mono)" }} placeholder="เช่น AUTOPLAS" value={form.code} onChange={(e) => set("code", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">Segment / กลุ่มธุรกิจ</label>
          <select className="select" value={form.segment} onChange={(e) => set("segment", e.target.value)}>
            {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label className="field-label">ชื่อบริษัท (ไทย) *</label>
          <input required className="input" placeholder="เช่น บริษัท ออโต้พลาส เอเชีย จำกัด" value={form.name} onChange={(e) => set("name", e.target.value)}/>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label className="field-label">ชื่อบริษัท (อังกฤษ)</label>
          <input className="input" placeholder="e.g. AutoPlas Asia Co., Ltd." value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">เลขผู้เสียภาษี</label>
          <input className="input" style={{ fontFamily: "var(--font-mono)" }} placeholder="13 หลัก" value={form.taxId} onChange={(e) => set("taxId", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">เครดิตเทอร์ม</label>
          <select className="select" value={form.credit} onChange={(e) => set("credit", e.target.value)}>
            {[0, 15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d === 0 ? "เงินสด / ไม่มีเครดิต" : d + " วัน"}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">ผู้ติดต่อ</label>
          <input className="input" placeholder="เช่น คุณวิภาดา สุขใจ" value={form.contact} onChange={(e) => set("contact", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">โทรศัพท์</label>
          <input className="input" placeholder="02-xxx-xxxx" value={form.phone} onChange={(e) => set("phone", e.target.value)}/>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label className="field-label">อีเมล</label>
          <input type="email" className="input" placeholder="purchasing@company.com" value={form.email} onChange={(e) => set("email", e.target.value)}/>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label className="field-label">ที่อยู่</label>
          <textarea className="input" rows={2} style={{ resize: "vertical", lineHeight: 1.5 }} placeholder="ที่อยู่สำหรับออกเอกสาร / จัดส่ง" value={form.address} onChange={(e) => set("address", e.target.value)}/>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-outline" onClick={onCancel}>ยกเลิก</button>
        <button type="submit" className="btn btn-primary" disabled={!valid}><I.Check size={14}/> บันทึกลูกค้า</button>
      </div>
    </form>
  );
}

function CustomerDetail({ c, onEdit }) {
  useStore();
  const st = Analytics.customerStats(c.code);
  const docs = Store.state.docs.filter((d) => d.customer === c.code).slice(0, 12);
  const role = Store.user() ? ROLES[Store.user().role] : null;
  const canEdit = role && (role.canEdit === "*" || (role.canEdit || []).includes("customers"));
  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, background: "var(--bg-subtle)", borderRadius: 12, marginBottom: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: 12, background: "var(--accent-subtle)", color: "var(--accent)", display: "grid", placeItems: "center", fontWeight: 700, fontFamily: "var(--font-sans)" }}>
          {c.code.slice(0, 2)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{c.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{c.nameEn}</div>
        </div>
        {canEdit && <button className="btn btn-outline btn-sm" onClick={() => onEdit(c)}><I.Edit size={13}/> แก้ไข</button>}
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <Detail k="เลขประจำตัวผู้เสียภาษี" v={c.taxId}/>
        <Detail k="เครดิตเทอม" v={c.credit + " วัน"}/>
        <Detail k="ผู้ติดต่อ" v={c.contact}/>
        <Detail k="โทรศัพท์" v={c.phone}/>
        <Detail k="อีเมล" v={c.email}/>
        <Detail k="Segment" v={c.segment}/>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 4 }}>ที่อยู่</div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>{c.address}</div>
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <CustStat label="ใบกำกับภาษีปีนี้" value={st.ytd} unit="ใบ"/>
        <CustStat label="ยอดขายรวม (ก่อน VAT)" value={baht(st.total)}/>
        <CustStat label="ลูกหนี้คงค้าง" value={baht(st.outstanding)}/>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">เอกสารล่าสุดของลูกค้า ({st.docs} ฉบับ)</div>
        </div>
        <table className="table">
          <thead><tr><th>เลขที่</th><th>ประเภท</th><th>วันที่</th><th className="num">มูลค่า</th><th>สถานะ</th></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}><td className="mono">{d.id}</td><td><DocBadge type={d.type}/></td><td className="num">{d.date}</td>
                <td className="num" style={{ fontWeight: 500 }}>{baht(d.total, 2)}</td><td><DocStatusBadge doc={d}/></td></tr>
            ))}
            {!docs.length && <EmptyRow cols={5} text="ยังไม่มีเอกสาร"/>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function Detail({ k, v }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{v}</div>
    </div>
  );
}
function CustStat({ label, value, unit }) {
  return (
    <div style={{ padding: 12, background: "var(--bg-subtle)", borderRadius: 10 }}>
      <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{label}</div>
      <div className="num" style={{ fontSize: 18, fontWeight: 600, marginTop: 2, letterSpacing: "-0.01em" }}>
        {value}{unit && <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 400, marginLeft: 4 }}>{unit}</span>}
      </div>
    </div>
  );
}

window.PageCustomers = PageCustomers;
