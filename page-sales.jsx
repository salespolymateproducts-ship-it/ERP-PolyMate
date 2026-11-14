/* global React, I, DOC_LABEL, DOC_STATUS, DocBadge, PageHeader, Tabs, Drawer, baht, _fmt, COMPANY, WHT_RATES,
   Store, useStore, Workflow, notify, runAction, ErpModal, ReasonModal, exportCSV, printDoc, EmptyRow, VEHICLES */

/*
  เอกสารขาย — หน้าจอเดียวสำหรับทุกเอกสารในสายขาย (ใช้ Workflow engine)
  PageSales      : QT, SO, DO, BN, INV, RC, PAY
  PageCustomerPO : CPO (PO จากลูกค้า → เปิดใบสั่งขาย)
*/

const SALES_TYPES = ["QT", "SO", "DO", "BN", "INV", "RC", "PAY"];
const PAY_METHODS = ["โอนเงิน", "เงินสด", "เช็ค", "บัตรเครดิต"];
const STATUS_FILTERS = [
  { id: "all", label: "ทั้งหมด", test: () => true },
  { id: "draft", label: "ฉบับร่าง", test: (d) => d.status === "draft" },
  { id: "pending", label: "รออนุมัติ", test: (d) => d.status === "pending" },
  { id: "open", label: "อนุมัติ / ดำเนินการ", test: (d) => d.status === "approved" || d.status === "partial" },
  { id: "completed", label: "เสร็จสมบูรณ์", test: (d) => d.status === "completed" },
  { id: "cancelled", label: "ยกเลิก", test: (d) => d.status === "cancelled" },
];

function DocStatusBadge({ doc }) {
  const s = Workflow.statusInfo(doc);
  return <span className={"badge badge-" + s.color}><span className="b-dot"/>{s.th}</span>;
}

function PageSales() {
  return <DocWorkspace types={SALES_TYPES} title="เอกสารขาย"
    subtitle="ใบเสนอราคา → ใบสั่งขาย → ใบส่งสินค้า → ใบวางบิล → ใบกำกับภาษี → ใบเสร็จรับเงิน → รับชำระเงิน" showStats/>;
}
function PageCustomerPO() {
  return <DocWorkspace types={["CPO"]} title="ใบ PO ลูกค้า"
    subtitle="บันทึกใบสั่งซื้อจากลูกค้า → อนุมัติ → เปิดใบสั่งขายโดยไม่ต้องกรอกซ้ำ"/>;
}

// =================== WORKSPACE (รายการ + drawer) ===================
function DocWorkspace({ types, title, subtitle, showStats }) {
  useStore();
  const all = Store.state.docs.filter((d) => types.includes(d.type));
  const [tab, setTab] = useState(types.length > 1 ? "ALL" : types[0]);
  const [statusF, setStatusF] = useState("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState(() => {
    const id = window.takeFocus("doc"); const d = id && Workflow.get(id);
    return d && types.includes(d.type) ? id : null;
  });
  const [editor, setEditor] = useState(null); // { id } | { type } (new)
  const [convert, setConvert] = useState(null); // { sourceId, targetType, approveSources }

  const tabs = types.length > 1 ? [{ id: "ALL", label: "ทั้งหมด", count: all.length },
    ...types.map((t) => ({ id: t, label: DOC_LABEL[t].th, count: all.filter((d) => d.type === t).length }))] : null;

  let list = tab === "ALL" ? all : all.filter((d) => d.type === tab);
  const sf = STATUS_FILTERS.find((f) => f.id === statusF);
  list = list.filter(sf.test);
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter((d) => [d.id, d.customerName, d.customer, d.refNo, (d.sourceIds || []).join(" ")].join(" ").toLowerCase().includes(q));
  }

  const canCreate = types.some((t) => t !== "PAY" && Workflow.canEditType(t));

  function exportList() {
    exportCSV(`เอกสาร-${tab}-${Store.today()}.csv`,
      ["เลขที่", "ประเภท", "ลูกค้า", "วันที่", "ครบกำหนด", "อ้างอิง", "ก่อน VAT", "VAT", "รวม", "หัก ณ ที่จ่าย", "สุทธิ", "สถานะ"],
      list.map((d) => [d.id, DOC_LABEL[d.type].th, d.customerName, d.date, d.due, (d.sourceIds || []).join(" "), d.subtotal, d.vat, d.total, d.wht, d.net, Workflow.statusInfo(d).th]));
  }

  return (
    <>
      <PageHeader title={title} subtitle={subtitle}
        actions={<>
          <DataMenu/>
          <button className="btn btn-outline btn-sm" onClick={exportList} disabled={!list.length}><I.Download size={14}/> ส่งออก CSV</button>
          {canCreate && <button className="btn btn-primary btn-sm" onClick={() => setEditor({ type: types.includes(tab) && tab !== "PAY" ? tab : types[0] })}><I.Plus size={14}/> สร้างเอกสารใหม่</button>}
        </>}/>

      {showStats && <SalesStats/>}

      <div className="card">
        {tabs && <div style={{ padding: "12px 16px 0" }}><Tabs items={tabs} value={tab} onChange={setTab}/></div>}
        <div style={{ display: "flex", gap: 8, padding: "12px 16px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 320 }}>
            <I.Search size={14} style={{ position: "absolute", left: 10, top: 9, color: "var(--text-tertiary)" }}/>
            <input className="input" aria-label="ค้นหา" placeholder="เลขที่เอกสาร / ลูกค้า / เลขอ้างอิง…" style={{ paddingLeft: 32 }} value={search} onChange={(e) => setSearch(e.target.value)}/>
          </div>
          {STATUS_FILTERS.map((f) => (
            <button key={f.id} className={"btn btn-sm " + (statusF === f.id ? "btn-primary" : "btn-outline")} onClick={() => setStatusF(f.id)}>{f.label}</button>
          ))}
          <span className="badge badge-neutral">{list.length} รายการ</span>
        </div>
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>เลขที่เอกสาร</th><th>ประเภท</th><th>ลูกค้า</th><th>วันที่</th><th>ครบกำหนด</th><th>อ้างอิงจาก</th>
                <th className="num">ยอดรวม</th><th className="num">ค้างรับ</th><th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => {
                const pay = d.type === "INV" ? Workflow.paymentInfo(d) : null;
                return (
                  <tr key={d.id} style={{ cursor: "pointer", opacity: d.status === "cancelled" ? 0.55 : 1 }} onClick={() => setOpenId(d.id)}>
                    <td className="mono"><b style={{ textDecoration: d.status === "cancelled" ? "line-through" : "none" }}>{d.id}</b></td>
                    <td><DocBadge type={d.type}/></td>
                    <td><div style={{ fontSize: 13, fontWeight: 500 }}>{d.customerName}</div><div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{d.refNo ? "PO: " + d.refNo : d.customer}</div></td>
                    <td className="num" style={{ fontSize: 12.5 }}>{d.date}</td>
                    <td className="num" style={{ fontSize: 12.5, color: pay && pay.overdue ? "var(--danger)" : undefined }}>{d.due}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{(d.sourceIds || []).join(", ") || "—"}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{_fmt(d.total, 2)}</td>
                    <td className="num" style={{ color: pay && pay.outstanding > 0 ? "var(--amber)" : "var(--text-tertiary)" }}>{pay ? _fmt(pay.outstanding, 2) : "—"}</td>
                    <td><DocStatusBadge doc={d}/></td>
                  </tr>
                );
              })}
              {!list.length && <EmptyRow cols={9} text={all.length ? "ไม่พบเอกสารตามเงื่อนไข" : "ยังไม่มีเอกสาร — กด “สร้างเอกสารใหม่” เพื่อเริ่ม"}/>}
            </tbody>
          </table>
        </div>
      </div>

      {openId && <DocDrawer id={openId} onClose={() => setOpenId(null)} onOpen={setOpenId}
        onEdit={(id) => setEditor({ id })} onConvert={(c) => setConvert(c)}/>}

      <Drawer open={!!editor} onClose={() => setEditor(null)} width={920}
        title={editor ? (editor.id ? `แก้ไข · ${editor.id}` : "สร้างเอกสารใหม่") : ""}>
        {editor && <DocEditor key={editor.id || editor.type} editor={editor} types={types}
          onSaved={(doc) => { setEditor(null); setOpenId(doc.id); }} onCancel={() => setEditor(null)}/>}
      </Drawer>

      {convert && <ConvertModal {...convert} onClose={() => setConvert(null)}
        onDone={(doc) => { setConvert(null); setOpenId(doc.id); }}/>}
    </>
  );
}

function SalesStats() {
  const docs = Store.state.docs;
  const ym = Store.today().slice(0, 7);
  const invLive = docs.filter((d) => d.type === "INV" && Workflow.isLive(d));
  const monthSales = invLive.filter((d) => d.date.slice(0, 7) === ym).reduce((s, d) => s + d.subtotal, 0);
  let ar = 0, overdue = 0, overdueN = 0;
  invLive.forEach((d) => { const p = Workflow.paymentInfo(d); ar += p.outstanding; if (p.overdue) { overdue += p.outstanding; overdueN++; } });
  const pending = docs.filter((d) => d.status === "pending").length;
  return (
    <div className="grid-4" style={{ marginBottom: 14 }}>
      <SalesStat label="ยอดขายเดือนนี้ (ใบกำกับภาษี ก่อน VAT)" value={baht(monthSales)} tone="accent" icon="Wallet"/>
      <SalesStat label="ลูกหนี้คงค้าง" value={baht(ar)} tone="amber" icon="Clock"/>
      <SalesStat label={`เกินกำหนดชำระ (${overdueN} ใบ)`} value={baht(overdue)} tone="danger" icon="Alert"/>
      <SalesStat label="เอกสารรออนุมัติ" value={_fmt(pending)} tone="violet" icon="FileText"/>
    </div>
  );
}
function SalesStat({ label, value, tone, icon }) {
  const Ico = I[icon] || I.Wallet;
  const c = { accent: "var(--accent)", amber: "var(--amber)", danger: "var(--danger)", violet: "var(--violet)", success: "var(--success)" }[tone];
  const b = { accent: "var(--accent-subtle)", amber: "var(--amber-subtle)", danger: "var(--danger-subtle)", violet: "var(--violet-subtle)", success: "var(--success-subtle)" }[tone];
  return (
    <div className="card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: b, color: c, display: "grid", placeItems: "center" }}><Ico size={15}/></div>
      <div><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</div><div className="num" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{value}</div></div>
    </div>
  );
}

// ---- สำรอง / นำเข้า / ล้างข้อมูล ----
function DataMenu() {
  const [open, setOpen] = useState(false);
  const fileRef = useRef(null);
  const isAdmin = Store.user() && Store.user().role === "admin";
  return (
    <div style={{ position: "relative" }}>
      <button className="btn btn-outline btn-sm" onClick={() => setOpen((v) => !v)}><I.Database size={14}/> ข้อมูล <I.ChevronDown size={12}/></button>
      {open && (<>
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50 }}/>
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 51, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "var(--shadow-popover)", width: 250, padding: 6 }}>
          <DataMenuItem icon="Download" label="ส่งออกไฟล์สำรอง (.json)" onClick={() => { Store.exportData(); setOpen(false); }}/>
          {isAdmin && <DataMenuItem icon="Upload" label="นำเข้าไฟล์สำรอง" onClick={() => fileRef.current && fileRef.current.click()}/>}
          {isAdmin && <><div style={{ height: 1, background: "var(--border)", margin: "6px 0" }}/>
            <DataMenuItem icon="X" label="ออกจากระบบและรีเฟรช" danger onClick={() => { if (window.confirm("ออกจากระบบและรีเฟรชหน้า? (ข้อมูลอยู่ที่เซิร์ฟเวอร์ ไม่ถูกลบ)")) Store.resetAll(); }}/></>}
        </div>
      </>)}
      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files[0];
          if (f) Store.importData(f).then(() => { notify("นำเข้าข้อมูลสำเร็จ"); setOpen(false); }).catch((err) => notify("ไฟล์ไม่ถูกต้อง: " + err.message, "error"));
          e.target.value = "";
        }}/>
    </div>
  );
}
function DataMenuItem({ icon, label, onClick, danger }) {
  const Ico = I[icon] || I.FileText;
  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => e.key === "Enter" && onClick()} className="menu-item"
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontSize: 13, color: danger ? "var(--danger)" : "var(--text-primary)" }}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-subtle)"} onMouseLeave={(e) => e.currentTarget.style.background = ""}>
      <Ico size={15} style={{ opacity: 0.8 }}/><span>{label}</span>
    </div>
  );
}

// =================== DRAWER: ดูเอกสาร + ปุ่มสถานะ ===================
function DocDrawer({ id, onClose, onOpen, onEdit, onConvert }) {
  useStore();
  const doc = Workflow.get(id);
  const [view, setView] = useState("doc");
  const [reason, setReason] = useState(null); // "cancel" | "reject"
  const [woOpen, setWoOpen] = useState(false);
  const [shipOpen, setShipOpen] = useState(null);
  useEffect(() => { setView("doc"); }, [id]);
  if (!doc) return null;
  const rel = Workflow.related(doc.id);
  const can = (a) => Workflow.can(a, doc);

  return (
    <Drawer open onClose={onClose} width={900} title={<span>{DOC_LABEL[doc.type].th} · <span className="mono">{doc.id}</span> <DocStatusBadge doc={doc}/></span>}>
      <DocActionBar doc={doc} can={can}
        onEdit={() => onEdit(doc.id)}
        onSubmit={() => runAction(() => Workflow.submit(doc.id), `ส่ง ${doc.id} เพื่ออนุมัติแล้ว`)}
        onApprove={() => runAction(() => Workflow.approve(doc.id), `อนุมัติ ${doc.id} แล้ว`)}
        onReject={() => setReason("reject")}
        onCancel={() => setReason("cancel")}
        onDelete={() => { if (window.confirm(`ลบฉบับร่าง ${doc.id}?`)) { if (runAction(() => Workflow.remove(doc.id), `ลบ ${doc.id} แล้ว`)) onClose(); } }}
        onConvert={(t, approveSources) => onConvert({ sourceId: doc.id, targetType: t, approveSources })}
        onWO={() => setWoOpen(true)}
        onShip={(s) => setShipOpen(s)}
        onRelated={() => setView("related")}
        onPrint={() => { setView("doc"); printDoc(doc.id); }}/>

      <div style={{ padding: "12px 18px 0" }}>
        <DocFlowStrip doc={doc} rel={rel} onOpen={onOpen}/>
        <div style={{ marginTop: 10 }}>
          <Tabs value={view} onChange={setView} items={[
            { id: "doc", label: "เอกสาร" },
            { id: "related", label: "เอกสารที่เกี่ยวข้อง", count: rel.upstream.length + rel.downstream.length },
            { id: "history", label: "ประวัติ", count: (doc.history || []).length },
          ]}/>
        </div>
      </div>

      {view === "doc" && <DocPaper doc={doc}/>}
      {view === "related" && <DocRelated doc={doc} rel={rel} onOpen={onOpen}/>}
      {view === "history" && <DocHistory doc={doc}/>}

      {reason && <ReasonModal
        title={reason === "cancel" ? `ยกเลิกเอกสาร ${doc.id}` : `ตีกลับเอกสาร ${doc.id}`}
        label={reason === "cancel" ? "เหตุผลการยกเลิก" : "เหตุผลที่ตีกลับ"}
        hint={reason === "cancel" ? "เลขที่เอกสารจะถูกเก็บไว้พร้อมประวัติ และสถานะจะเป็น “ยกเลิก”" + (doc.type === "DO" && doc.stockPosted ? " · ระบบจะคืนสต๊อกสินค้าให้อัตโนมัติ" : "") : "เอกสารจะกลับเป็นฉบับร่างให้ผู้จัดทำแก้ไข"}
        danger={reason === "cancel"} confirmLabel={reason === "cancel" ? "ยกเลิกเอกสาร" : "ตีกลับ"}
        onClose={() => setReason(null)}
        onConfirm={(r) => { const ok = runAction(() => (reason === "cancel" ? Workflow.cancel(doc.id, r) : Workflow.reject(doc.id, r)), reason === "cancel" ? `ยกเลิก ${doc.id} แล้ว` : `ตีกลับ ${doc.id} แล้ว`); if (ok) setReason(null); }}/>}
      {woOpen && <WOModal so={doc} onClose={() => setWoOpen(false)}/>}
      {shipOpen && <ShipModal doc={doc} to={shipOpen} onClose={() => setShipOpen(null)}/>}
    </Drawer>
  );
}

function DocActionBar({ doc, can, onEdit, onSubmit, onApprove, onReject, onCancel, onDelete, onConvert, onWO, onShip, onRelated, onPrint }) {
  const live = Workflow.isLive(doc);
  const nexts = Workflow.nextTypes(doc);
  const conv = can("convert");
  const preApprove = (doc.status === "draft" || doc.status === "pending") && can("approve").ok;
  const btn = (key, res, label, onClick, cls = "btn-outline", icon) => {
    const Ico = icon ? I[icon] : null;
    return <button key={key} className={"btn btn-sm " + cls} disabled={!res.ok} title={res.ok ? "" : res.reason} onClick={onClick}>{Ico && <Ico size={13}/>} {label}</button>;
  };
  const isFinal = doc.status === "cancelled";
  const ship = doc.ship && doc.ship.status;
  return (
    <div className="erp-actionbar no-print">
      {!isFinal && (doc.status === "draft" || doc.status === "pending" || can("edit").ok) && btn("edit", can("edit"), "แก้ไข", onEdit, "btn-outline", "Edit")}
      {doc.status === "draft" && btn("submit", can("submit"), "ส่งอนุมัติ", onSubmit, "btn-outline", "Mail")}
      {(doc.status === "draft" || doc.status === "pending") && btn("approve", can("approve"), "อนุมัติเอกสาร", onApprove, "btn-primary", "Check")}
      {doc.status === "pending" && btn("reject", can("reject"), "ตีกลับ", onReject)}
      {nexts.map((t) => (live
        ? btn("cv" + t, conv, (doc.type === "RC" ? "บันทึก" : "สร้าง") + DOC_LABEL[t].th, () => onConvert(t, false), "btn-primary", "ChevronRight")
        : preApprove ? btn("acv" + t, { ok: true }, `อนุมัติและสร้าง${DOC_LABEL[t].th}`, () => onConvert(t, true), "btn-primary", "ChevronRight") : null))}
      {doc.type === "SO" && live && <button className="btn btn-outline btn-sm" onClick={onWO}><I.Factory size={13}/> เปิดใบสั่งผลิต</button>}
      {doc.type === "DO" && live && ship === "waiting" && <button className="btn btn-outline btn-sm" onClick={() => onShip("in-transit")}><I.Truck size={13}/> ออกจัดส่ง</button>}
      {doc.type === "DO" && live && ship === "in-transit" && <button className="btn btn-outline btn-sm" onClick={() => onShip("delivered")}><I.Check size={13}/> ยืนยันส่งถึงลูกค้า</button>}
      <button className="btn btn-ghost btn-sm" onClick={onRelated}><I.GitBranch size={13}/> ดูเอกสารที่เกี่ยวข้อง</button>
      <span className="spacer"/>
      <button className="btn btn-outline btn-sm" onClick={onPrint}><I.Printer size={13}/> พิมพ์ / PDF</button>
      {!isFinal && btn("cancel", can("cancel"), "ยกเลิกเอกสาร", onCancel, "btn-outline", "X")}
      {doc.status === "draft" && btn("del", can("delete"), "ลบ", onDelete, "btn-ghost", "Trash")}
      {live && !conv.ok && nexts.length > 0 && doc.status !== "completed" &&
        <div style={{ width: "100%", fontSize: 11.5, color: "var(--text-tertiary)" }}>สร้างเอกสารถัดไปไม่ได้: {conv.reason}</div>}
    </div>
  );
}

// แถบสายเอกสาร (ต้นทาง → ใบนี้ → ปลายทาง) คลิกเพื่อเปิด
function DocFlowStrip({ doc, rel, onOpen }) {
  const chip = (d, cur) => (
    <span key={d.id} className={"erp-chip" + (cur ? " current" : "") + (d.status === "cancelled" ? " cancelled" : "")}
      onClick={() => !cur && onOpen(d.id)} title={Workflow.statusInfo(d).th}>
      <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{DOC_LABEL[d.type].th}</span><span className="mono">{d.id}</span>
    </span>
  );
  if (!rel.upstream.length && !rel.downstream.length) return <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>ยังไม่มีเอกสารเชื่อมโยง</div>;
  return (
    <div className="erp-flow">
      {rel.upstream.map((d) => chip(d))}
      {rel.upstream.length > 0 && <I.ChevronRight size={13}/>}
      {chip(doc, true)}
      {rel.downstream.length > 0 && <I.ChevronRight size={13}/>}
      {rel.downstream.map((d) => chip(d))}
    </div>
  );
}

function DocRelated({ doc, rel, onOpen }) {
  const rows = [...rel.upstream.map((d) => ({ d, dir: "ต้นทาง" })), ...rel.downstream.map((d) => ({ d, dir: "ปลายทาง" }))];
  const remain = Workflow.isActive(doc) && doc.type !== "PAY" && doc.type !== "RC" ? Workflow.remainingLines(doc) : null;
  return (
    <div style={{ padding: 18 }}>
      <table className="table" style={{ fontSize: 12.5 }}>
        <thead><tr><th>ทิศทาง</th><th>ประเภท</th><th>เลขที่</th><th>วันที่</th><th className="num">ยอดรวม</th><th>สถานะ</th></tr></thead>
        <tbody>
          {rows.map(({ d, dir }) => (
            <tr key={d.id} style={{ cursor: "pointer" }} onClick={() => onOpen(d.id)}>
              <td>{dir}</td><td><DocBadge type={d.type}/></td><td className="mono"><b>{d.id}</b></td><td>{d.date}</td>
              <td className="num">{_fmt(d.total, 2)}</td><td><DocStatusBadge doc={d}/></td>
            </tr>
          ))}
          {!rows.length && <EmptyRow cols={6} text="ไม่มีเอกสารที่เกี่ยวข้อง"/>}
        </tbody>
      </table>
      {remain && (Workflow.NEXT[doc.type] || []).length > 0 && (
        <>
          <div style={{ fontWeight: 600, fontSize: 13, margin: "18px 0 8px" }}>ยอดคงเหลือที่ยังออกเอกสารถัดไปได้</div>
          <table className="table" style={{ fontSize: 12.5 }}>
            <thead><tr><th>รายการ</th><th className="num">จำนวนในเอกสาร</th><th className="num">ออกเอกสารต่อแล้ว</th><th className="num">คงเหลือ</th></tr></thead>
            <tbody>{remain.map((l) => (
              <tr key={l.idx}><td>{l.name}</td><td className="num">{_fmt(l.qty)} {l.unit}</td><td className="num">{_fmt(l.used)}</td>
                <td className="num" style={{ fontWeight: 600, color: l.remaining > 0 ? "var(--amber)" : "var(--success)" }}>{_fmt(l.remaining)}</td></tr>
            ))}</tbody>
          </table>
        </>
      )}
      {doc.type === "RC" && <RcPayBox rc={doc}/>}
    </div>
  );
}
function RcPayBox({ rc }) {
  const a = Workflow.rcAmounts(rc);
  return <div style={{ marginTop: 16, display: "flex", gap: 24, fontSize: 13 }}>
    <span>ยอดสุทธิ <b className="num">{_fmt(a.net, 2)}</b></span><span>รับชำระแล้ว <b className="num" style={{ color: "var(--success)" }}>{_fmt(a.paid, 2)}</b></span>
    <span>คงค้าง <b className="num" style={{ color: "var(--amber)" }}>{_fmt(a.outstanding, 2)}</b></span></div>;
}

const ACTION_TH = { create: "สร้าง", edit: "แก้ไข", submit: "ส่งอนุมัติ", approve: "อนุมัติ", reject: "ตีกลับ", cancel: "ยกเลิก", auto: "ระบบอัปเดต", ship: "จัดส่ง", wo: "เปิดใบสั่งผลิต" };
function DocHistory({ doc }) {
  const h = [...(doc.history || [])].reverse();
  const st = (s) => (s ? (DOC_STATUS[s] ? DOC_STATUS[s].th : s) : "—");
  return (
    <div style={{ padding: 18 }}>
      {doc.cancel && (
        <div style={{ padding: 12, border: "1px solid var(--danger)", background: "var(--danger-subtle)", borderRadius: 10, marginBottom: 14, fontSize: 13 }}>
          <b style={{ color: "var(--danger)" }}>ยกเลิกเอกสาร</b> โดย {doc.cancel.by} เมื่อ {doc.cancel.at}<br/>เหตุผล: {doc.cancel.reason}
        </div>
      )}
      <table className="table" style={{ fontSize: 12.5 }}>
        <thead><tr><th>วันเวลา</th><th>ผู้ดำเนินการ</th><th>การดำเนินการ</th><th>สถานะ</th><th>หมายเหตุ / เหตุผล</th></tr></thead>
        <tbody>{h.map((x, i) => (
          <tr key={i}><td className="num">{x.at}</td><td>{x.by}</td><td>{ACTION_TH[x.action] || x.action}</td>
            <td style={{ fontSize: 12 }}>{x.from === x.to ? st(x.to) : `${st(x.from)} → ${st(x.to)}`}</td><td>{x.reason}</td></tr>
        ))}</tbody>
      </table>
      <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 8 }}>สร้างโดย {doc.createdBy} · {doc.createdAt}{doc.approvedBy ? ` · อนุมัติโดย ${doc.approvedBy} · ${doc.approvedAt}` : ""}</div>
    </div>
  );
}

// =================== เอกสารสำหรับพิมพ์ ===================
function DocPaper({ doc }) {
  const meta = DOC_LABEL[doc.type];
  const c = doc.customerSnap || {};
  const muted = { color: "#5B6478" };
  const th = { padding: "8px 10px", fontWeight: 600, fontSize: 11 };
  const pay = doc.type === "INV" ? Workflow.paymentInfo(doc) : null;
  return (
    <div style={{ padding: 18, background: "var(--bg)" }}>
      <div className="print-area" style={{ background: "white", color: "#0B1220", borderRadius: 8, padding: "28px 32px", boxShadow: "0 2px 10px rgba(0,0,0,0.06)", fontFamily: "var(--font-thai)", fontSize: 12, position: "relative" }}>
        {doc.status === "cancelled" && <div style={{ position: "absolute", top: 110, left: "50%", transform: "translateX(-50%) rotate(-14deg)", border: "4px solid #DC2626", color: "#DC2626", fontSize: 44, fontWeight: 800, padding: "4px 28px", borderRadius: 10, opacity: 0.32, pointerEvents: "none" }}>ยกเลิก</div>}
        {(doc.status === "draft" || doc.status === "pending") && <div style={{ position: "absolute", top: 110, left: "50%", transform: "translateX(-50%) rotate(-14deg)", border: "4px solid #94A3B8", color: "#94A3B8", fontSize: 40, fontWeight: 800, padding: "4px 28px", borderRadius: 10, opacity: 0.35, pointerEvents: "none" }}>ฉบับร่าง</div>}
        <div style={{ display: "flex", gap: 16, borderBottom: "2px solid #0B1220", paddingBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img src="assets/polymate-logo.png" alt="PolyMate" style={{ width: 50, height: 50, objectFit: "contain" }}/>
              <div><div style={{ fontWeight: 700, fontSize: 15 }}>{COMPANY.nameTh}</div><div style={{ fontSize: 11, ...muted }}>{COMPANY.name}</div></div>
            </div>
            <div style={{ fontSize: 11, ...muted, marginTop: 8, lineHeight: 1.6 }}>
              {COMPANY.address}<br/>โทร {COMPANY.phone} · อีเมล {COMPANY.email}<br/>
              เลขประจำตัวผู้เสียภาษี: <b style={{ color: "#0B1220" }}>{COMPANY.taxId}</b> · สำนักงานใหญ่
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{meta.th}</div>
            <div style={{ fontSize: 11, ...muted }}>{meta.short}{doc.type === "INV" ? " · ต้นฉบับ" : ""}</div>
            <div style={{ marginTop: 10, fontSize: 11, ...muted }}>เลขที่ / No.</div><div className="mono" style={{ fontWeight: 600 }}>{doc.id}</div>
            <div style={{ marginTop: 6, fontSize: 11, ...muted }}>วันที่ / Date</div><div className="num">{doc.date}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 14 }}>
          <div>
            <div style={{ fontSize: 11, ...muted, marginBottom: 4 }}>ลูกค้า / Customer</div>
            <div style={{ fontWeight: 600 }}>{c.name || doc.customerName}</div>
            <div style={{ fontSize: 11, ...muted, marginTop: 4, lineHeight: 1.6 }}>
              {c.address || "—"}<br/>{c.contact ? `ผู้ติดต่อ: ${c.contact} · โทร ${c.phone}` : ""}<br/>เลขประจำตัวผู้เสียภาษี: {c.taxId || "—"}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", rowGap: 6, fontSize: 11, alignContent: "start" }}>
            {doc.due && doc.due !== "—" && <><div style={muted}>กำหนดชำระ:</div><div>{doc.due}</div></>}
            {c.credit != null && doc.type !== "PAY" && <><div style={muted}>เครดิตเทอม:</div><div>{c.credit} วัน</div></>}
            {doc.refNo && <><div style={muted}>เลขที่ PO ลูกค้า:</div><div>{doc.refNo}</div></>}
            {(doc.sourceIds || []).length > 0 && <><div style={muted}>อ้างอิงเอกสาร:</div><div className="mono">{doc.sourceIds.join(", ")}</div></>}
            {doc.type === "DO" && doc.ship && doc.ship.vehicle && <><div style={muted}>ขนส่งโดย:</div><div>{doc.ship.vehicle}</div></>}
          </div>
        </div>

        {doc.type === "PAY" ? (
          <div style={{ marginTop: 18, border: "1px solid #E6E8EC", borderRadius: 8, padding: 16, display: "grid", gridTemplateColumns: "160px 1fr", rowGap: 8 }}>
            <div style={muted}>รับชำระตามใบเสร็จ</div><div className="mono">{(doc.sourceIds || []).join(", ")}</div>
            <div style={muted}>วิธีชำระ</div><div>{doc.method}</div>
            <div style={muted}>เลขที่อ้างอิง / ธนาคาร</div><div>{doc.bankRef || "—"}</div>
            <div style={muted}>จำนวนเงิน</div><div className="num" style={{ fontSize: 18, fontWeight: 700 }}>{baht(doc.amount, 2)}</div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16, fontSize: 12 }}>
            <thead><tr style={{ background: "#F1F3F7" }}>
              <th style={{ ...th, textAlign: "left" }}>#</th><th style={{ ...th, textAlign: "left" }}>รหัส / รายการ</th>
              <th style={{ ...th, textAlign: "right" }}>จำนวน</th><th style={{ ...th, textAlign: "right" }}>หน่วยละ</th>
              <th style={{ ...th, textAlign: "right" }}>ส่วนลด</th><th style={{ ...th, textAlign: "right" }}>จำนวนเงิน</th>
            </tr></thead>
            <tbody>{(doc.lines || []).map((it, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #E6E8EC" }}>
                <td style={{ padding: 10, ...muted }}>{i + 1}</td>
                <td style={{ padding: 10 }}><div className="mono" style={{ fontSize: 11, ...muted }}>{it.code}</div><div style={{ fontWeight: 500 }}>{it.name}</div></td>
                <td className="num" style={{ padding: 10, textAlign: "right" }}>{_fmt(it.qty)} <span style={{ fontSize: 11, ...muted }}>{it.unit}</span></td>
                <td className="num" style={{ padding: 10, textAlign: "right" }}>{_fmt(it.price, 2)}</td>
                <td className="num" style={{ padding: 10, textAlign: "right" }}>{it.disc ? it.disc + "%" : "—"}</td>
                <td className="num" style={{ padding: 10, textAlign: "right", fontWeight: 500 }}>{_fmt(Workflow.lineAmount(it), 2)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}

        {doc.type !== "PAY" && (
          <div className="print-keep" style={{ display: "flex", marginTop: 18, gap: 24 }}>
            <div style={{ flex: 1, fontSize: 11, ...muted, borderTop: "1px dashed #D5D9E0", paddingTop: 10 }}>
              <div style={{ color: "#0B1220", fontWeight: 600, marginBottom: 4 }}>หมายเหตุ</div>{doc.note || "—"}
              {pay && pay.paid > 0 && <div style={{ marginTop: 10, color: "#15803D" }}>รับชำระแล้ว {_fmt(pay.paid, 2)} บาท · คงค้าง {_fmt(pay.outstanding, 2)} บาท</div>}
            </div>
            <div style={{ width: 280, fontSize: 12 }}>
              <PaperRow k="รวมเป็นเงิน" v={_fmt(doc.gross, 2)}/>
              {doc.discount > 0 && <PaperRow k="ส่วนลดท้ายบิล" v={"(" + _fmt(doc.discount, 2) + ")"}/>}
              <PaperRow k="มูลค่าก่อนภาษี" v={_fmt(doc.subtotal, 2)}/>
              <PaperRow k={doc.vatOn ? "ภาษีมูลค่าเพิ่ม 7%" : "ภาษีมูลค่าเพิ่ม (ไม่คิด)"} v={_fmt(doc.vat, 2)}/>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 8px", marginTop: 6, background: "#0B1220", color: "white", borderRadius: 6 }}>
                <span>จำนวนเงินรวมทั้งสิ้น</span><span className="num" style={{ fontWeight: 600 }}>{baht(doc.total, 2)}</span>
              </div>
              {doc.whtRate > 0 && <>
                <PaperRow k={`หัก ณ ที่จ่าย ${doc.whtRate}%`} v={"(" + _fmt(doc.wht, 2) + ")"}/>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px", background: "#F0FDF4", border: "1px solid #16A34A", color: "#15803D", borderRadius: 6 }}>
                  <span style={{ fontWeight: 600 }}>ยอดชำระสุทธิ</span><span className="num" style={{ fontWeight: 700 }}>{baht(doc.net, 2)}</span>
                </div>
              </>}
            </div>
          </div>
        )}

        <div className="print-keep" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, marginTop: 36, fontSize: 11, textAlign: "center", ...muted }}>
          <div><div style={{ borderTop: "1px solid #5B6478", paddingTop: 6 }}>{doc.type === "DO" ? "ผู้รับสินค้า" : doc.type === "PAY" || doc.type === "RC" ? "ผู้รับเงิน" : "ผู้รับเอกสาร"}</div>
            <div style={{ marginTop: 6 }}>{doc.type === "DO" && doc.ship && doc.ship.receivedBy ? doc.ship.receivedBy : "วันที่ ____ / ____ / ____"}</div></div>
          <div><div style={{ borderTop: "1px solid #5B6478", paddingTop: 6 }}>ผู้มีอำนาจลงนาม</div>
            <div style={{ marginTop: 6 }}>{doc.approvedBy ? `${doc.approvedBy} · ${String(doc.approvedAt).slice(0, 10)}` : "วันที่ ____ / ____ / ____"}</div></div>
        </div>
      </div>
    </div>
  );
}
function PaperRow({ k, v }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 8px" }}><span style={{ color: "#5B6478" }}>{k}</span><span className="num">{v}</span></div>;
}

// =================== สร้างเอกสารถัดไป (เลือกรายการ / จำนวนบางส่วน) ===================
function ConvertModal({ sourceId, targetType, approveSources, onClose, onDone }) {
  useStore();
  const src = Workflow.get(sourceId);
  const [selected, setSelected] = useState([sourceId]);
  const [date, setDate] = useState(Store.today());
  const [qty, setQty] = useState({}); // key "doc#line" → qty
  const [approveTarget, setApproveTarget] = useState(false);
  const [amount, setAmount] = useState(null);
  const [method, setMethod] = useState(PAY_METHODS[0]);
  const [bankRef, setBankRef] = useState("");
  if (!src) return null;
  const isPay = targetType === "PAY";
  const others = Workflow.openSources(src.type, src.customer, targetType).filter((d) => d.id !== sourceId);
  const srcDocs = selected.map(Workflow.get).filter(Boolean);
  const rows = isPay ? [] : srcDocs.flatMap((d) => Workflow.remainingLines(d).filter((l) => l.remaining > 0).map((l) => ({ ...l, doc: d.id })));
  const getQ = (r) => { const v = qty[r.doc + "#" + r.idx]; return v == null ? r.remaining : v; };
  const bad = rows.some((r) => Number(getQ(r)) < 0 || Number(getQ(r)) > r.remaining + 0.0005);
  const gross = rows.reduce((s, r) => s + Workflow.lineAmount({ ...r, qty: Number(getQ(r)) || 0 }), 0);
  const rcA = isPay ? Workflow.rcAmounts(src) : null;
  const amt = amount == null ? (rcA ? rcA.remaining : 0) : amount;

  function submit() {
    const opts = { sourceIds: selected, targetType, date, approveSources, approveTarget };
    if (isPay) Object.assign(opts, { amount: Number(amt), method, bankRef });
    else opts.picks = rows.map((r) => ({ doc: r.doc, line: r.idx, qty: Number(getQ(r)) || 0 }));
    const doc = runAction(() => Workflow.convert(opts), (d) => `สร้าง${DOC_LABEL[targetType].th} ${d.id} แล้ว` + (approveSources ? ` · อนุมัติ ${selected.join(", ")}` : ""));
    if (doc) onDone(doc);
  }

  const lbl = { fontSize: 12, color: "var(--text-secondary)", fontWeight: 500, display: "block", marginBottom: 5 };
  return (
    <ErpModal width={820} onClose={onClose}
      title={`${approveSources ? "อนุมัติและ" : ""}สร้าง${DOC_LABEL[targetType].th} จาก ${DOC_LABEL[src.type].th} ${src.id}`}
      footer={<>
        <button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button>
        <button className="btn btn-primary btn-sm" disabled={bad || (isPay ? !(amt > 0) : gross <= 0 && !rows.some((r) => Number(getQ(r)) > 0))} onClick={submit}>
          <I.Check size={14}/> {approveSources ? `อนุมัติ ${src.id} และสร้าง${DOC_LABEL[targetType].th}` : `สร้าง${DOC_LABEL[targetType].th}`}
        </button>
      </>}>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 12 }}>
        ระบบคัดลอกข้อมูลลูกค้า รายการ ราคา ส่วนลด และภาษีจากเอกสารต้นทางให้อัตโนมัติ · ลูกค้า: <b style={{ color: "var(--text-primary)" }}>{src.customerName}</b>
      </div>
      <div className="grid-2" style={{ gap: 12, marginBottom: 12 }}>
        <div><label style={lbl}>วันที่เอกสารใหม่</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)}/></div>
        {Workflow.canApproveType(targetType) && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22, cursor: "pointer" }}>
            <input type="checkbox" checked={approveTarget} onChange={(e) => setApproveTarget(e.target.checked)}/> อนุมัติ{DOC_LABEL[targetType].th}ทันที
          </label>
        )}
      </div>

      {!isPay && others.length > 0 && (
        <div style={{ marginBottom: 12, padding: 10, background: "var(--bg-subtle)", borderRadius: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>รวมเอกสารอื่นของลูกค้ารายนี้ที่ยังค้างอยู่ (เช่น วางบิลรวมหลายใบส่งของ)</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {others.map((d) => (
              <label key={d.id} style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={selected.includes(d.id)} onChange={(e) => setSelected((s) => e.target.checked ? [...s, d.id] : s.filter((x) => x !== d.id))}/>
                <span className="mono">{d.id}</span> <span style={{ color: "var(--text-tertiary)" }}>{d.date} · {_fmt(d.total, 2)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {isPay ? (
        <div className="grid-2" style={{ gap: 12 }}>
          <div><label style={lbl}>ยอดรับชำระ (คงค้าง {_fmt(rcA.remaining, 2)})</label>
            <input className="input num" type="number" min="0" step="0.01" value={amt} onChange={(e) => setAmount(e.target.value === "" ? 0 : Number(e.target.value))}/>
            {amt > rcA.remaining + 0.005 && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>เกินยอดคงค้าง</div>}</div>
          <div><label style={lbl}>วิธีชำระ</label><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
          <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>เลขที่อ้างอิง / ธนาคาร / เลขเช็ค</label><input className="input" value={bankRef} onChange={(e) => setBankRef(e.target.value)}/></div>
        </div>
      ) : (
        <table className="table" style={{ fontSize: 12.5 }}>
          <thead><tr><th>จากเอกสาร</th><th>รายการ</th><th className="num">ราคา/หน่วย</th><th className="num">คงเหลือ</th><th className="num" style={{ width: 120 }}>จำนวนที่ออก</th><th className="num">จำนวนเงิน</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const q = getQ(r); const over = Number(q) > r.remaining + 0.0005 || Number(q) < 0;
              return (
                <tr key={r.doc + r.idx}>
                  <td className="mono" style={{ fontSize: 11.5 }}>{r.doc}</td>
                  <td><div>{r.name}</div><div className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{r.code}</div></td>
                  <td className="num">{_fmt(r.price, 2)}{r.disc ? ` (-${r.disc}%)` : ""}</td>
                  <td className="num">{_fmt(r.remaining)} {r.unit}</td>
                  <td><input className="input input-sm num" type="number" min="0" max={r.remaining} step="any" aria-label={"จำนวน " + r.name}
                    style={{ textAlign: "right", borderColor: over ? "var(--danger)" : undefined }} value={q}
                    onChange={(e) => setQty((s) => ({ ...s, [r.doc + "#" + r.idx]: e.target.value === "" ? 0 : Number(e.target.value) }))}/></td>
                  <td className="num">{_fmt(Workflow.lineAmount({ ...r, qty: Number(q) || 0 }), 2)}</td>
                </tr>
              );
            })}
            {!rows.length && <EmptyRow cols={6} text="ไม่มีรายการคงเหลือ"/>}
          </tbody>
        </table>
      )}
      {!isPay && <div style={{ textAlign: "right", marginTop: 10, fontSize: 13 }}>มูลค่าสินค้าที่เลือก (ก่อนส่วนลดท้ายบิล/VAT): <b className="num">{_fmt(gross, 2)}</b></div>}
      {bad && <div style={{ color: "var(--danger)", fontSize: 12.5, marginTop: 6 }}>มีรายการที่จำนวนเกินคงเหลือ</div>}
    </ErpModal>
  );
}

// =================== ใบสั่งขาย → ใบสั่งผลิต ===================
function WOModal({ so, onClose }) {
  const rows = so.lines.map((l, i) => {
    const fg = Store.state.finished.find((f) => f.code === l.code);
    return { ...l, i, fg, left: l.qty - Workflow.woUsed(so.id, i) };
  });
  const [q, setQ] = useState(() => Object.fromEntries(rows.map((r) => [r.i, r.fg && r.fg.jobType !== "trade" ? Math.max(0, r.left) : 0])));
  const [due, setDue] = useState(so.due && so.due !== "—" ? so.due : "");
  function submit() {
    const picks = rows.filter((r) => Number(q[r.i]) > 0).map((r) => ({ line: r.i, qty: Number(q[r.i]), due }));
    const res = runAction(() => Workflow.createWorkOrders(so.id, picks), (w) => `เปิดใบสั่งผลิต ${w.map((x) => x.id).join(", ")} แล้ว — ดูได้ที่เมนูใบสั่งผลิต`);
    if (res) onClose();
  }
  return (
    <ErpModal title={`เปิดใบสั่งผลิตจาก ${so.id}`} width={720} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={submit}><I.Factory size={14}/> เปิดใบสั่งผลิต</button></>}>
      <div style={{ marginBottom: 12 }}><label style={{ fontSize: 12, color: "var(--text-secondary)" }}>กำหนดเสร็จ</label><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ marginTop: 4 }}/></div>
      <table className="table" style={{ fontSize: 12.5 }}>
        <thead><tr><th>รายการ</th><th className="num">ในใบสั่งขาย</th><th className="num">เปิดผลิตแล้ว</th><th className="num">สต๊อก FG</th><th className="num" style={{ width: 120 }}>ผลิตเพิ่ม</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.i}>
            <td>{r.name}<div className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{r.code}{!r.fg ? " · ไม่มีในทะเบียนสินค้า" : r.fg.jobType === "trade" ? " · ซื้อมาขายไป" : ""}</div></td>
            <td className="num">{_fmt(r.qty)}</td><td className="num">{_fmt(r.qty - r.left)}</td><td className="num">{r.fg ? _fmt(r.fg.stock) : "—"}</td>
            <td><input className="input input-sm num" type="number" min="0" disabled={!r.fg || r.fg.jobType === "trade"} value={q[r.i]} onChange={(e) => setQ((s) => ({ ...s, [r.i]: e.target.value }))} style={{ textAlign: "right" }}/></td>
          </tr>
        ))}</tbody>
      </table>
    </ErpModal>
  );
}

// =================== การจัดส่ง (ใช้ร่วมกับหน้า การจัดส่ง) ===================
function ShipModal({ doc, to, onClose }) {
  const [vehicle, setVehicle] = useState((doc.ship && doc.ship.vehicle) || "");
  const [receivedBy, setReceivedBy] = useState("");
  const [note, setNote] = useState("");
  const vehicles = window.VEHICLES || [];
  function submit() {
    const info = to === "in-transit" ? { vehicle, note } : { receivedBy, note };
    if (runAction(() => Workflow.setShipStatus(doc.id, to, info), to === "in-transit" ? `${doc.id} ออกจัดส่งแล้ว` : `${doc.id} ส่งถึงลูกค้าแล้ว`)) onClose();
  }
  return (
    <ErpModal title={(to === "in-transit" ? "ออกจัดส่ง " : "ยืนยันส่งถึงลูกค้า ") + doc.id} width={460} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ปิด</button><button className="btn btn-primary btn-sm" onClick={submit}><I.Check size={14}/> บันทึก</button></>}>
      {to === "in-transit" ? (
        <><label style={{ fontSize: 12, color: "var(--text-secondary)" }}>รถ / ผู้ขนส่ง *</label>
          <select className="input" value={vehicle} onChange={(e) => setVehicle(e.target.value)} style={{ marginTop: 4, marginBottom: 10 }}>
            <option value="">— เลือก —</option>
            {vehicles.map((v) => <option key={v.id} value={`${v.plate} (${v.type}) · ${v.driver}`}>{v.plate} — {v.type} · {v.driver}</option>)}
          </select></>
      ) : (
        <><label style={{ fontSize: 12, color: "var(--text-secondary)" }}>ชื่อผู้รับสินค้า *</label>
          <input className="input" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} style={{ marginTop: 4, marginBottom: 10 }}/></>
      )}
      <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>หมายเหตุ</label>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 4 }}/>
    </ErpModal>
  );
}

// =================== สร้าง / แก้ไขฉบับร่าง ===================
function DocEditor({ editor, types, onSaved, onCancel }) {
  const existing = editor.id ? Workflow.get(editor.id) : null;
  const init = existing ? JSON.parse(JSON.stringify(existing)) : Workflow.blank(editor.type);
  const isNew = !existing;
  const editingApproved = existing && !["draft", "pending"].includes(existing.status);
  const customers = Store.state.customers;
  const products = [...Store.state.finished.map((f) => ({ code: f.code, name: f.name, unit: f.unit || "PCS", price: f.price })),
    ...Store.state.materials.map((m) => ({ code: m.code, name: m.name, unit: m.unit, price: 0 }))];

  const [f, setF] = useState(init);
  const [editReason, setEditReason] = useState("");
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const setLine = (i, patch) => setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const isPay = f.type === "PAY";
  const c = Workflow.calc(f);
  const createTypes = types.filter((t) => t !== "PAY" && Workflow.canEditType(t));
  const preview = isNew ? Store.peekDocNo(Workflow.PREFIX[f.type], f.date).docNo : f.id;

  function onCode(i, code) {
    const p = products.find((x) => x.code.toLowerCase() === code.trim().toLowerCase());
    const l = f.lines[i];
    setLine(i, p ? { code: p.code, name: l.name || p.name, unit: p.unit, price: Number(l.price) ? l.price : p.price } : { code });
  }
  function save(andSubmit) {
    if (editingApproved && !editReason.trim()) { notify("กรุณาระบุเหตุผลการแก้ไขเอกสารที่อนุมัติแล้ว", "error"); return; }
    const doc = runAction(() => {
      const d = Workflow.saveDraft({ ...f, editReason });
      if (andSubmit) Workflow.submit(d.id);
      return d;
    }, (d) => `${isNew ? "บันทึกฉบับร่าง" : "บันทึกการแก้ไข"} ${d.id}${andSubmit ? " และส่งอนุมัติแล้ว" : ""}`);
    if (doc) onSaved(doc);
  }

  const lbl = { fontSize: 12, color: "var(--text-secondary)", marginBottom: 5, display: "block", fontWeight: 500 };
  return (
    <div style={{ padding: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, background: "var(--bg-subtle)", borderRadius: 12, marginBottom: 18 }}>
        <div style={{ width: 42, height: 42, borderRadius: 10, background: "var(--accent-subtle)", color: "var(--accent)", display: "grid", placeItems: "center" }}><I.FileText size={20}/></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>เลขที่เอกสาร {isNew && "(ออกอัตโนมัติเมื่อบันทึก)"}</div>
          <div className="mono" style={{ fontSize: 16, fontWeight: 700 }}>{preview}</div>
        </div>
        {(f.sourceIds || []).length > 0 && <span className="badge badge-info">อ้างอิง {f.sourceIds.join(", ")}</span>}
        {existing && <DocStatusBadge doc={existing}/>}
      </div>
      {editingApproved && <div style={{ padding: 10, borderRadius: 10, border: "1px solid var(--amber)", background: "var(--amber-subtle)", fontSize: 12.5, marginBottom: 14 }}>
        กำลังแก้ไขเอกสารที่อนุมัติแล้ว — ระบบจะบันทึกเหตุผลและผู้แก้ไขไว้ในประวัติ
        <input className="input" placeholder="เหตุผลการแก้ไข *" value={editReason} onChange={(e) => setEditReason(e.target.value)} style={{ marginTop: 8 }}/>
      </div>}

      <div className="grid-2" style={{ gap: 14, marginBottom: 16 }}>
        <div><label style={lbl}>ประเภทเอกสาร</label>
          <select className="input" value={f.type} disabled={!isNew} onChange={(e) => set({ type: e.target.value, vatOn: !["DO", "CPO"].includes(e.target.value) })}>
            {(isNew ? createTypes : [f.type]).map((t) => <option key={t} value={t}>{DOC_LABEL[t].th}</option>)}
          </select></div>
        <div><label style={lbl}>ลูกค้า *</label>
          <select className="input" value={f.customer} disabled={(f.sourceIds || []).length > 0} onChange={(e) => set({ customer: e.target.value })}>
            <option value="">— เลือกลูกค้า —</option>
            {customers.map((cu) => <option key={cu.code} value={cu.code}>{cu.name}</option>)}
          </select></div>
        <div><label style={lbl}>วันที่</label><input className="input" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })}/></div>
        <div><label style={lbl}>กำหนดชำระ / ครบกำหนด <span style={{ color: "var(--text-tertiary)" }}>(ว่าง = คำนวณจากเครดิตลูกค้า)</span></label>
          <input className="input" type="date" value={f.due && f.due !== "—" ? f.due : ""} onChange={(e) => set({ due: e.target.value })}/></div>
        {!isPay && <div><label style={lbl}>เลขที่ PO ลูกค้า / อ้างอิง</label><input className="input" value={f.refNo || ""} onChange={(e) => set({ refNo: e.target.value })}/></div>}
        {!isPay && <div><label style={lbl}>หัก ณ ที่จ่าย</label>
          <select className="input" value={f.whtRate || 0} onChange={(e) => set({ whtRate: Number(e.target.value) })}>
            {Object.keys(WHT_RATES).map((r) => <option key={r} value={r}>{WHT_RATES[r]}</option>)}
          </select></div>}
      </div>

      {isPay ? (
        <div className="grid-2" style={{ gap: 14 }}>
          <div><label style={lbl}>ยอดรับชำระ</label><input className="input num" type="number" value={f.amount} onChange={(e) => set({ amount: Number(e.target.value) })}/></div>
          <div><label style={lbl}>วิธีชำระ</label><select className="input" value={f.method} onChange={(e) => set({ method: e.target.value })}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
          <div style={{ gridColumn: "1/-1" }}><label style={lbl}>เลขที่อ้างอิง</label><input className="input" value={f.bankRef || ""} onChange={(e) => set({ bankRef: e.target.value })}/></div>
        </div>
      ) : (<>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>รายการสินค้า / บริการ</div><span className="spacer"/>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
            <input type="checkbox" checked={!!f.vatOn} onChange={(e) => set({ vatOn: e.target.checked })}/> คิด VAT 7%
          </label>
        </div>
        <datalist id="erp-products">{products.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</datalist>
        <div className="card" style={{ padding: 0, marginBottom: 14, overflow: "auto" }}>
          <table className="table" style={{ fontSize: 12.5 }}>
            <thead><tr><th style={{ width: 130 }}>รหัส</th><th>รายการ</th><th className="num" style={{ width: 90 }}>จำนวน</th><th style={{ width: 70 }}>หน่วย</th>
              <th className="num" style={{ width: 100 }}>ราคา/หน่วย</th><th className="num" style={{ width: 70 }}>ลด %</th><th className="num" style={{ width: 110 }}>จำนวนเงิน</th><th style={{ width: 36 }}></th></tr></thead>
            <tbody>{f.lines.map((l, i) => {
              const locked = !!l.src;
              return (
                <tr key={i}>
                  <td><input className="input input-sm" list="erp-products" aria-label="รหัสสินค้า" value={l.code === "-" ? "" : l.code} disabled={locked} onChange={(e) => onCode(i, e.target.value)} placeholder="—"/>
                    {locked && <div className="mono" style={{ fontSize: 10.5, color: "var(--accent)" }}>จาก {l.src.doc}</div>}</td>
                  <td><input className="input input-sm" aria-label="ชื่อรายการ" value={l.name} disabled={locked} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="ชื่อสินค้า / รายละเอียด"/></td>
                  <td><input className="input input-sm num" type="number" min="0" aria-label="จำนวน" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} style={{ textAlign: "right" }}/></td>
                  <td><input className="input input-sm" aria-label="หน่วย" value={l.unit} disabled={locked} onChange={(e) => setLine(i, { unit: e.target.value })}/></td>
                  <td><input className="input input-sm num" type="number" min="0" aria-label="ราคา" value={l.price} disabled={locked} onChange={(e) => setLine(i, { price: e.target.value })} style={{ textAlign: "right" }}/></td>
                  <td><input className="input input-sm num" type="number" min="0" max="100" aria-label="ส่วนลด" value={l.disc || 0} disabled={locked} onChange={(e) => setLine(i, { disc: e.target.value })} style={{ textAlign: "right" }}/></td>
                  <td className="num">{_fmt(Workflow.lineAmount(l), 2)}</td>
                  <td><button className="icon-btn" aria-label="ลบรายการ" onClick={() => setF((x) => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }))} disabled={f.lines.length === 1}><I.Trash size={13}/></button></td>
                </tr>
              );
            })}</tbody>
          </table>
          <div style={{ padding: 10, borderTop: "1px solid var(--border)" }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setF((x) => ({ ...x, lines: [...x.lines, { code: "", name: "", qty: 1, unit: "ชิ้น", price: 0, disc: 0 }] }))}><I.Plus size={13}/> เพิ่มรายการ</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          <div style={{ flex: 1 }}><label style={lbl}>หมายเหตุ</label><textarea className="input" rows={3} style={{ height: "auto", padding: 8, width: "100%" }} value={f.note || ""} onChange={(e) => set({ note: e.target.value })}/></div>
          <div style={{ width: 300, fontSize: 12.5 }}>
            <EditorRow k="รวมเป็นเงิน" v={_fmt(c.gross, 2)}/>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 10px" }}><span style={{ color: "var(--text-secondary)" }}>ส่วนลดท้ายบิล (บาท)</span>
              <input className="input input-sm num" type="number" min="0" aria-label="ส่วนลดท้ายบิล" value={f.billDisc || 0} onChange={(e) => set({ billDisc: e.target.value })} style={{ width: 110, textAlign: "right" }}/></div>
            <EditorRow k="มูลค่าก่อนภาษี" v={_fmt(c.subtotal, 2)}/>
            <EditorRow k={"VAT 7%" + (f.vatOn ? "" : " (ไม่คิด)")} v={_fmt(c.vat, 2)}/>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 10px", marginTop: 4, background: "var(--text-primary)", color: "var(--bg-elevated)", borderRadius: 8 }}><span>รวมทั้งสิ้น</span><b className="num">{baht(c.total, 2)}</b></div>
            {f.whtRate > 0 && <EditorRow k={`หัก ณ ที่จ่าย ${f.whtRate}% → สุทธิ`} v={_fmt(c.net, 2)}/>}
          </div>
        </div>
      </>)}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 22, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <button className="btn btn-outline btn-sm" onClick={onCancel}>ปิด</button>
        {editingApproved
          ? <button className="btn btn-primary btn-sm" onClick={() => save(false)}><I.Check size={14}/> บันทึกการแก้ไข</button>
          : <>
            <button className="btn btn-outline btn-sm" onClick={() => save(false)}><I.Check size={14}/> บันทึกฉบับร่าง</button>
            <button className="btn btn-primary btn-sm" onClick={() => save(true)}><I.Mail size={14}/> บันทึกและส่งอนุมัติ</button>
          </>}
      </div>
    </div>
  );
}
function EditorRow({ k, v }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px" }}><span style={{ color: "var(--text-secondary)" }}>{k}</span><span className="num">{v}</span></div>;
}

Object.assign(window, { PageSales, PageCustomerPO, DocWorkspace, DocStatusBadge, ShipModal, DocDrawer });
