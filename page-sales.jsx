/* global React, I, DOC_LABEL, DOC_STATUS, DocBadge, PageHeader, Tabs, Drawer, baht, _fmt, COMPANY, WHT_RATES,
   Store, useStore, Workflow, notify, runAction, ErpModal, ReasonModal, exportCSV, printDoc, EmptyRow, VEHICLES */

/*
  เอกสารขาย — หน้าจอเดียวสำหรับทุกเอกสารในสายขาย (ใช้ Workflow engine)
  PageSales      : QT, SO, DO, BN, INV, RC, PAY
  PageCustomerPO : CPO (PO จากลูกค้า → เปิดใบสั่งขาย)
*/

const SALES_TYPES = ["QT", "SO", "DO", "INV", "BN", "RC", "PAY", "CN", "DN"];
const isNoteType = (t) => t === "CN" || t === "DN";      // ใบลดหนี้/เพิ่มหนี้ ออกจากปุ่มในใบกำกับภาษีเท่านั้น (ไม่สร้างเปล่า ๆ)
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
  let s = Workflow.statusInfo(doc);
  // ใบเสนอราคา/ใบสั่งขายที่ตั้งแผนแบ่งงวดแล้ว (อนุมัติแล้ว) → แสดงสถานะ "แบ่งชำระ n/N" แทน "อนุมัติแล้ว"
  if ((doc.type === "QT" || doc.type === "SO") && (doc.plan || []).length > 0 && Workflow.isLive(doc)) {
    const n = Workflow.instInvoices(doc.id).length, N = doc.plan.length;
    s = { th: n >= N ? "แบ่งชำระ · ออกครบทุกงวด" : "แบ่งชำระ " + n + "/" + N, color: n >= N ? "success" : "info" };
  }
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
  const [openId, setOpenId] = useState(() => {
    const id = window.takeFocus("doc"); const d = id && Workflow.get(id);
    return d && types.includes(d.type) ? id : null;
  });
  const [editor, setEditor] = useState(null); // { id } | { type } (new)
  const [convert, setConvert] = useState(null); // { sourceId, targetType, approveSources }
  const [rvFor, setRvFor] = useState(null);      // เลขที่ใบเสร็จที่กำลังบันทึกรับเงิน (หน้ารับเงินใหม่ แทน "สร้างรับชำระ" แบบเดิม)

  const tabs = types.length > 1 ? [{ id: "ALL", label: "ทั้งหมด", count: all.length },
    ...types.map((t) => ({ id: t, label: DOC_LABEL[t].th, count: all.filter((d) => d.type === t).length }))] : null;

  const baseRows = tab === "ALL" ? all : all.filter((d) => d.type === tab);
  const sf = STATUS_FILTERS.find((f) => f.id === statusF);
  // ค้นหา (เลขที่/ลูกค้า/เลขอ้างอิง/เอกสารต้นทาง/สินค้า/หมายเหตุ) · ช่วงวันที่ · เรียงตามหัวคอลัมน์ · แบ่งหน้า
  const view = useListView(baseRows, {
    text: (d) => [d.id, DOC_LABEL[d.type] ? DOC_LABEL[d.type].th : "", d.customerName, d.customer, d.refNo, (d.sourceIds || []).join(" "), d.note, (d.lines || []).map((l) => l.name + " " + (l.code || "")).join(" ")].join(" "),
    dateKey: (d) => d.date,
    filter: sf.test, filterKey: tab + "|" + statusF,
    defaultSort: { key: "date", dir: "desc" },
    sorts: {
      id: (d) => d.id, type: (d) => d.type, customer: (d) => d.customerName, date: (d) => d.date, due: (d) => (d.due && d.due !== "—" ? d.due : ""),
      total: (d) => d.total || 0, outstanding: (d) => { const p = d.type === "INV" ? Workflow.paymentInfo(d) : null; return p ? p.outstanding : 0; }, status: (d) => Workflow.statusInfo(d).th,
    },
  });
  const list = view.sorted;

  const canCreate = types.some((t) => t !== "PAY" && !isNoteType(t) && Workflow.canEditType(t));

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
          {canCreate && <button className="btn btn-primary btn-sm" onClick={() => setEditor({ type: types.includes(tab) && tab !== "PAY" && !isNoteType(tab) ? tab : types[0] })}><I.Plus size={14}/> สร้างเอกสารใหม่</button>}
        </>}/>

      {showStats && <SalesStats/>}

      <div className="card">
        {tabs && <div style={{ padding: "12px 16px 0" }}><Tabs items={tabs} value={tab} onChange={setTab}/></div>}
        <ListToolbar view={view} placeholder="เลขที่เอกสาร / ลูกค้า / เลขอ้างอิง / สินค้า…">
          {STATUS_FILTERS.map((f) => (
            <button key={f.id} className={"btn btn-sm " + (statusF === f.id ? "btn-primary" : "btn-outline")} onClick={() => setStatusF(f.id)}>{f.label}</button>
          ))}
        </ListToolbar>
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <SortTh view={view} k="id">เลขที่เอกสาร</SortTh><SortTh view={view} k="type">ประเภท</SortTh><SortTh view={view} k="customer">ลูกค้า</SortTh><SortTh view={view} k="date">วันที่</SortTh><SortTh view={view} k="due">ครบกำหนด</SortTh><th>อ้างอิงจาก</th>
                <SortTh view={view} k="total" className="num">ยอดรวม</SortTh><SortTh view={view} k="outstanding" className="num">ค้างรับ</SortTh><SortTh view={view} k="status">สถานะ</SortTh>
              </tr>
            </thead>
            <tbody>
              {view.pageRows.map((d) => {
                const pay = d.type === "INV" ? Workflow.paymentInfo(d) : null;
                return (
                  <tr key={d.id} style={{ cursor: "pointer", opacity: d.status === "cancelled" ? 0.55 : 1 }} onClick={() => setOpenId(d.id)}>
                    <td className="mono"><b style={{ textDecoration: d.status === "cancelled" ? "line-through" : "none" }}>{d.id}</b>
                      {Workflow.isInstInv(d) && <div><span className="badge badge-info" style={{ fontSize: 10.5 }}>งวดที่ {d.installment.no}/{d.installment.of}</span></div>}
                      {(d.type === "QT" || d.type === "SO") && (d.plan || []).length > 0 && <div><span className="badge badge-neutral" style={{ fontSize: 10.5 }}>แบ่งงวด {Workflow.instInvoices(d.id).length}/{d.plan.length}</span></div>}</td>
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
        <Pager view={view}/>
      </div>

      {openId && <DocDrawer id={openId} onClose={() => setOpenId(null)} onOpen={setOpenId}
        onEdit={(id) => setEditor({ id })} onConvert={(c) => (c.targetType === "PAY" ? setRvFor(c.sourceId) : setConvert(c))}/>}
      {rvFor && <RvFromRc rcId={rvFor} onClose={() => setRvFor(null)}/>}

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
  const [noteFor, setNoteFor] = useState(null);   // "CN" | "DN" — ออกใบลดหนี้/เพิ่มหนี้จากใบกำกับนี้
  useEffect(() => { setView("doc"); }, [id]);
  if (!doc) return null;
  const rel = Workflow.related(doc.id);
  const can = (a) => Workflow.can(a, doc);
  const live = Workflow.isLive(doc);

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
        onNote={(t) => setNoteFor(t)}
        onPrint={() => { setView("doc"); printDoc(doc.id); }}/>   {/* เอกสารขายที่ส่งให้ลูกค้า: ไม่ใส่ภาพลายเซ็นอิเล็กทรอนิกส์ — ให้ผู้มีอำนาจเซ็นจริงบนกระดาษ (ภาพลายเซ็นใช้เฉพาะเอกสารภายใน เช่น ใบสำคัญจ่าย) */}

      {doc.type === "RC" && window.RcCollectBadge && <RcCollectBadge doc={doc}/>}
      {(doc.type === "QT" || doc.type === "SO" || Workflow.isInstInv(doc)) && <BillingPlanCard doc={doc} onOpen={onOpen}/>}
      {doc.type === "INV" && live && <NoteAdjCard inv={doc} onOpen={onOpen}/>}
      {doc.type === "SO" && live && <TradeStockBanner doc={doc}/>}
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
      {noteFor && <NoteModal inv={doc} type={noteFor} onClose={() => setNoteFor(null)} onDone={(d) => { setNoteFor(null); onOpen(d.id); }}/>}
      {shipOpen && <ShipModal doc={doc} to={shipOpen} onClose={() => setShipOpen(null)}/>}
    </Drawer>
  );
}

// =================== แผนเรียกเก็บเงินแบบแบ่งงวด (1B) ===================
// แผนเก็บที่ใบเสนอราคา (ถ้าใบสั่งขายมาจาก QT ใบเดียว) — ใบสั่งขายแสดงแผนเดิมแบบอ่านอย่างเดียว · ออกใบกำกับของงวดได้จากทั้งสองใบ
function BillingPlanCard({ doc, onOpen }) {
  const [edit, setEdit] = useState(false);
  const root = Workflow.billingRoot(doc);
  if (!root) return null;
  const info = Workflow.planInfo(root);
  const isRoot = root.id === doc.id;
  const canEdit = isRoot && Workflow.canEditType(root.type) && root.status !== "cancelled";
  const canIssue = Workflow.canEditType("INV") && Workflow.isLive(root);
  if (!info.hasPlan && !(canEdit && (doc.type === "QT" || doc.type === "SO"))) return null;
  if (!info.hasPlan) {
    return (
      <div className="no-print" style={{ margin: "12px 18px 0", padding: "9px 12px", border: "1px dashed var(--border)", borderRadius: 10, display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, flexWrap: "wrap" }}>
        <span style={{ color: "var(--text-secondary)" }}>เรียกเก็บเงินแบบแบ่งงวดได้ (เช่น 50% / 50%) — ตั้งแผนแล้วออกใบกำกับภาษีทีละงวด</span>
        <button className="btn btn-outline btn-sm" style={{ marginLeft: "auto" }} onClick={() => setEdit(true)}>ตั้งแผนเรียกเก็บ</button>
        {edit && <BillingPlanModal root={root} onClose={() => setEdit(false)}/>}
      </div>
    );
  }
  const issue = (no) => { const d = runAction(() => Workflow.issueInstallment(root.id, no), (x) => `ออกใบกำกับงวดที่ ${no} (${x.id}) แล้ว — ฉบับร่าง รออนุมัติ`); if (d && onOpen) onOpen(d.id); };
  const done = info.remaining <= 0.004;
  const st = (r) => (r.inv ? Workflow.statusInfo(r.inv).th : "ยังไม่ออก");
  return (
    <div className="no-print" style={{ margin: "12px 18px 0", border: "1px solid " + (done ? "var(--success)" : "var(--amber)"), borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "9px 12px", background: done ? "var(--success-subtle)" : "var(--amber-subtle)", color: done ? "var(--success)" : "var(--amber)", fontSize: 12.5, fontWeight: 600, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <I.Alert size={14}/>
        <span>{done ? "เรียกเก็บครบ 100% แล้ว" : `เรียกเก็บแล้ว ${_fmt(info.billedPct, 2)}% (${info.rows.filter((r) => r.inv).length} จาก ${info.N} งวด) · เหลืออีก ${_fmt(info.remainingPct, 2)}% (${_fmt(info.remaining, 2)} บาท ก่อน VAT) — ยังเปิดบิลต่อได้`}</span>
        {!isRoot && <span style={{ fontWeight: 400 }}>· แผนอยู่ที่ <a style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => onOpen && onOpen(root.id)}>{root.id}</a></span>}
        {canEdit && <button className="btn btn-outline btn-sm" style={{ marginLeft: "auto" }} onClick={() => setEdit(true)}>แก้แผน</button>}
      </div>
      <table className="table" style={{ margin: 0, fontSize: 12.5 }}>
        <thead><tr><th>งวด</th><th>ชื่องวด</th><th className="num">%</th><th className="num">ก่อน VAT</th><th className="num">VAT</th><th className="num">รวม</th><th>ใบกำกับ / สถานะ</th><th></th></tr></thead>
        <tbody>
          {info.rows.map((r) => (
            <tr key={r.no} style={{ opacity: r.inv ? 1 : 0.95 }}>
              <td>{r.no}/{info.N}</td><td>{r.label}</td><td className="num">{_fmt(r.pct, 2)}</td>
              <td className="num">{_fmt(r.amount, 2)}</td><td className="num">{r.vat ? _fmt(r.vat, 2) : "—"}</td><td className="num"><b>{_fmt(r.total, 2)}</b></td>
              <td>{r.inv ? <><a className="mono" style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => onOpen && onOpen(r.inv.id)}>{r.inv.id}</a> <span className={"badge badge-" + Workflow.statusInfo(r.inv).color}>{st(r)}</span></> : <span style={{ color: "var(--text-tertiary)" }}>ยังไม่ออก</span>}</td>
              <td style={{ textAlign: "right" }}>{!r.inv && <button className="btn btn-primary btn-sm" disabled={!canIssue || r.amount <= 0.004} title={!canIssue ? (Workflow.isLive(root) ? "ไม่มีสิทธิ์" : "ต้องอนุมัติ " + root.id + " ก่อน") : ""} onClick={() => issue(r.no)}>ออกใบกำกับงวดนี้</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && <BillingPlanModal root={root} onClose={() => setEdit(false)}/>}
    </div>
  );
}

function BillingPlanModal({ root, onClose }) {
  const info = Workflow.planInfo(root);
  const [rows, setRows] = useState(info.hasPlan ? info.rows.map((r) => ({ label: r.label, pct: String(r.pct), locked: !!r.inv })) : [{ label: "งวดที่ 1", pct: "50" }, { label: "งวดที่ 2", pct: "50" }]);
  const [err, setErr] = useState("");
  const sum = Math.round(rows.reduce((s, r) => s + (Number(r.pct) || 0), 0) * 100) / 100;
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const preset = (arr) => setRows(arr.map((p, i) => ({ label: p.label || "งวดที่ " + (i + 1), pct: String(p.pct) })));
  const sub = Number(root.subtotal) || 0;
  const save = () => {
    setErr("");
    try { Workflow.setBillingPlan(root.id, rows.map((r) => ({ label: r.label, pct: r.pct }))); notify("บันทึกแผนเรียกเก็บของ " + root.id + " แล้ว", "success"); onClose(); }
    catch (e) { setErr(e && e.message ? e.message : String(e)); }
  };
  const clear = () => {
    if (!window.confirm("ล้างแผนเรียกเก็บของ " + root.id + "?")) return;
    try { Workflow.setBillingPlan(root.id, []); notify("ล้างแผนแล้ว", "success"); onClose(); } catch (e) { setErr(e && e.message ? e.message : String(e)); }
  };
  return (
    <ErpModal title={"แผนเรียกเก็บเงินแบบแบ่งงวด · " + root.id} width={640} onClose={onClose}
      footer={<>{info.hasPlan && <button className="btn btn-ghost btn-sm" style={{ marginRight: "auto", color: "var(--danger)" }} onClick={clear}>ล้างแผน</button>}
        <button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={save}>บันทึกแผน</button></>}>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>แต่ละงวดคือใบกำกับภาษีของงวดนั้น (ยอดงวด + VAT) · งวดสุดท้ายใช้ยอดคงเหลือ · มูลค่าก่อน VAT ของ {root.id}: <b>{_fmt(sub, 2)}</b> บาท</div>
      <div style={{ display: "flex", gap: 6, margin: "10px 0", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, alignSelf: "center" }}>แบบสำเร็จรูป:</span>
        <button className="btn btn-outline btn-sm" onClick={() => preset([{ pct: 50 }, { pct: 50 }])}>50 / 50</button>
        <button className="btn btn-outline btn-sm" onClick={() => preset([{ pct: 30 }, { pct: 40 }, { pct: 30 }])}>30 / 40 / 30</button>
        <button className="btn btn-outline btn-sm" onClick={() => preset([{ pct: 40 }, { pct: 30 }, { pct: 30 }])}>40 / 30 / 30</button>
      </div>
      <table className="table" style={{ fontSize: 12.5 }}>
        <thead><tr><th style={{ width: 48 }}>งวด</th><th>ชื่องวด</th><th style={{ width: 110 }} className="num">เปอร์เซ็นต์</th><th style={{ width: 140 }} className="num">ก่อน VAT (โดยประมาณ)</th><th style={{ width: 40 }}></th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td><input className="input" value={r.label} disabled={r.locked} onChange={(e) => set(i, "label", e.target.value)} placeholder="เช่น ตอนสั่งซื้อ / ตอนส่งมอบ"/></td>
              <td><input className="input num" type="number" min="0" step="0.01" value={r.pct} disabled={r.locked} onChange={(e) => set(i, "pct", e.target.value)}/></td>
              <td className="num">{_fmt(Math.round(sub * (Number(r.pct) || 0)) / 100, 2)}</td>
              <td>{!r.locked && rows.length > 2 && <button className="btn btn-ghost btn-sm" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="ลบงวด">✕</button>}{r.locked && <span title="ออกใบกำกับแล้ว แก้ไม่ได้" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>ล็อก</span>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr style={{ fontWeight: 700 }}><td colSpan={2} style={{ textAlign: "right" }}>รวม</td><td className="num" style={{ color: Math.abs(sum - 100) > 0.005 ? "var(--danger)" : "var(--success)" }}>{_fmt(sum, 2)}%</td><td colSpan={2}></td></tr></tfoot>
      </table>
      {rows.length < Workflow.MAX_INST && <button className="btn btn-outline btn-sm" onClick={() => setRows([...rows, { label: "งวดที่ " + (rows.length + 1), pct: "0" }])}>+ เพิ่มงวด</button>}
      {err && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

// =================== ใบลดหนี้ / ใบเพิ่มหนี้ ===================
// สรุปใบลดหนี้/เพิ่มหนี้ของใบกำกับนี้ + ยอดคงค้างหลังปรับ (และเตือนเมื่อลูกค้าจ่ายเกินจนต้องคืนเงิน)
function NoteAdjCard({ inv, onOpen }) {
  const notes = Store.state.docs.filter((d) => Workflow.isNote(d) && Workflow.isActive(d) && (d.sourceIds || []).includes(inv.id));
  if (!notes.length) return null;
  const p = Workflow.paymentInfo(inv), a = p.adj;
  return (
    <div className="no-print" style={{ margin: "12px 18px 0", padding: 12, border: "1px solid var(--border)", borderRadius: 10, fontSize: 12.5 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>ใบลดหนี้ / ใบเพิ่มหนี้ของใบกำกับนี้</div>
      {notes.map((n) => (
        <div key={n.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0" }}>
          <button className="btn btn-ghost btn-sm mono" onClick={() => onOpen(n.id)}>{n.id}</button>
          <span style={{ color: "var(--text-secondary)" }}>{DOC_LABEL[n.type].th} · {n.reason}</span><span className="spacer" style={{ flex: 1 }}/>
          <span className="num" style={{ color: n.type === "CN" ? "var(--danger)" : "var(--amber)" }}>{n.type === "CN" ? "−" : "+"}{_fmt(n.total, 2)}</span>
          <DocStatusBadge doc={n}/>
        </div>
      ))}
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 6, paddingTop: 6, color: "var(--text-secondary)" }}>
        ปรับยอดจากใบลดหนี้/เพิ่มหนี้ที่อนุมัติแล้ว: <b className="num">{a.total >= 0 ? "+" : "−"}{_fmt(Math.abs(a.total), 2)}</b> บาท · ยอดคงค้างหลังปรับ <b className="num">{_fmt(p.outstanding, 2)}</b> บาท
      </div>
      {p.overpaid > 0.004 && <div style={{ marginTop: 6, padding: "7px 10px", borderRadius: 8, background: "var(--amber-subtle)", color: "var(--amber)" }}>
        หลังลดหนี้ ลูกค้าจ่ายเกินมูลค่าใหม่ {_fmt(p.overpaid, 2)} บาท — ต้องคืนเงินลูกค้า: บันทึกที่ การเงิน → รับ/จ่าย/โอนอื่น ๆ (จ่ายอื่น ๆ หมวด "คืนเงินลูกค้า") ระบบไม่คืนให้อัตโนมัติ</div>}
    </div>
  );
}

function NoteModal({ inv, type, onClose, onDone }) {
  const nm = DOC_LABEL[type].th, isCN = type === "CN";
  const [mode, setMode] = useState("all");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(Store.today() < inv.date ? inv.date : Store.today());
  const [amount, setAmount] = useState("");
  const [lbl, setLbl] = useState("");
  const [err, setErr] = useState("");
  const prior = Store.state.docs.filter((d) => Workflow.isNote(d) && Workflow.isActive(d) && (d.sourceIds || []).includes(inv.id));
  const lbs = { fontSize: 12, color: "var(--text-secondary)", marginBottom: 4, display: "block", fontWeight: 500 };
  const go = () => {
    setErr("");
    try {
      const d = Workflow.issueNote(type, inv.id, { reason, date, mode, amount, label: lbl });
      notify("สร้าง" + nm + " " + d.id + " (ฉบับร่าง) แล้ว — ตรวจรายการแล้วส่งอนุมัติ", "success"); onDone(d);
    } catch (e) { setErr(e && e.message ? e.message : String(e)); }
  };
  return (
    <ErpModal title={"ออก" + nm + " · อ้างอิง " + inv.id} width={600} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" onClick={go}>สร้างฉบับร่าง</button></>}>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 10 }}>
        ใบกำกับ <b>{inv.id}</b> · {inv.customerName} · มูลค่าก่อนภาษี {_fmt(inv.subtotal, 2)} · รวม {_fmt(inv.total, 2)} บาท
        {prior.length > 0 && <div>ออกใบลดหนี้/เพิ่มหนี้ไปแล้ว: {prior.map((n) => n.id + " (" + (n.type === "CN" ? "−" : "+") + _fmt(n.subtotal, 2) + ")").join(", ")}</div>}
      </div>
      <div className="grid-2" style={{ gap: 12 }}>
        <div style={{ gridColumn: "1/-1" }}><label style={lbs}>เหตุผล *</label>
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">— เลือกเหตุผล —</option>{Workflow.NOTE_REASONS[type].map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
        <div><label style={lbs}>วันที่ออกเอกสาร</label><DateInput className="input" value={date} onChange={(e) => setDate(e.target.value)}/></div>
        <div><label style={lbs}>วิธีกำหนดรายการ</label>
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="all">ยกรายการของใบกำกับมาทั้งหมด (แก้จำนวน/ลบรายการในขั้นถัดไป)</option>
            <option value="amount">ระบุจำนวนเงินเอง (ไม่ผูกกับรายการสินค้า)</option>
          </select></div>
        {mode === "amount" && <>
          <div><label style={lbs}>รายละเอียด</label><input className="input" value={lbl} placeholder={isCN ? "เช่น ส่วนลดตามข้อตกลง" : "เช่น ค่าใช้จ่ายเพิ่มเติม"} onChange={(e) => setLbl(e.target.value)}/></div>
          <div><label style={lbs}>จำนวนเงินก่อน VAT (บาท) *</label><input className="input num" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}/></div>
        </>}
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-tertiary)" }}>
        VAT และหัก ณ ที่จ่ายใช้ตามใบกำกับต้นทาง · {isCN ? "ลดได้ไม่เกินมูลค่าใบกำกับ · " : ""}ไม่ตัดหรือคืนสต๊อกให้อัตโนมัติ (ถ้าเป็นการคืนสินค้า ให้ปรับสต๊อกเองที่หน้าคงคลัง)
      </div>
      {err && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

// สินค้าซื้อมาขายไปในใบสั่งขายที่สต๊อกไม่พอ: ขาดรวมทุกใบสั่งขายที่เปิดอยู่ − สต๊อก − ที่สั่งซื้อไว้แล้ว พร้อมปุ่มสั่งซื้อ
function TradeStockBanner({ doc }) {
  const [order, setOrder] = useState(null);
  const [toast, setToast] = useState(null);
  const [woOpen, setWoOpen] = useState(false);
  const [picked, setPicked] = useState({});
  const [bulk, setBulk] = useState(null);
  const canMake = Store.user() && ["admin", "production", "sales"].includes(Store.user().role);
  const canBuy = Store.user() && ["admin", "procurement"].includes(Store.user().role);
  const rows = [];
  const seen = new Set();
  Workflow.remainingLines(doc).forEach((l) => {
    if (l.remaining <= 0.0005 || seen.has(l.code)) return;
    const f = Store.state.finished.find((x) => x.code === l.code);
    if (!f) return;
    seen.add(l.code);
    const pos = Store.productPosition(f);
    if (pos.deficit > 0.0005) rows.push({ f, pos, need: l.remaining });
  });
  if (!rows.length) return null;
  const anyShort = rows.some((r) => r.pos.short > 0.0005);
  const hasMade = rows.some((r) => !Store.isBuyable(r.f));
  const hasBuy = rows.some((r) => Store.isBuyable(r.f));
  return (
    <div style={{ margin: "12px 18px 0", border: "1px solid " + (anyShort ? "var(--danger)" : "var(--amber)"), borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "9px 12px", background: anyShort ? "var(--danger-subtle, #fee2e2)" : "var(--amber-subtle)", color: anyShort ? "var(--danger)" : "var(--amber)", fontSize: 12.5, fontWeight: 600 }}>
        <I.Alert size={14} style={{ verticalAlign: "middle" }}/> {anyShort ? (hasMade && !hasBuy ? "สินค้าสต๊อกไม่พอสำหรับใบสั่งขายที่เปิดอยู่ — ต้องเปิดใบสั่งผลิต" : hasMade ? "สินค้าสต๊อกไม่พอสำหรับใบสั่งขายที่เปิดอยู่ — ต้องสั่งซื้อ / เปิดใบสั่งผลิต" : "สินค้าซื้อมาขายสต๊อกไม่พอสำหรับใบสั่งขายที่เปิดอยู่ — ต้องสั่งซื้อ") : (hasMade && !hasBuy ? "สินค้ากำลังผลิตตามใบสั่งผลิตที่เปิดไว้แล้ว" : "สินค้ารอรับของ/รอผลิตตามที่เปิดไว้แล้ว")}
      </div>
      {rows.map(({ f, pos, need }) => (
        <div key={f.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderTop: "1px solid var(--border)", fontSize: 12.5, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <b>{f.code}</b> {f.name}
            <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>ใบนี้ต้องส่ง {_fmt(need)} · ทุกใบสั่งขายรวม {_fmt(pos.demand)} · สต๊อก {_fmt(pos.stock)} · {Store.isBuyable(f) ? "สั่งไว้แล้ว" : "กำลังผลิต"} {_fmt(pos.incoming)} · <b style={{ color: pos.short > 0.0005 ? "var(--danger)" : "var(--amber)" }}>{pos.short > 0.0005 ? "ขาด " + _fmt(Math.ceil(pos.short)) : Store.isBuyable(f) ? "รอรับของ" : "รอผลิต"}</b></div>
          </div>
          {canBuy && Store.isBuyable(f) && pos.short > 0.0005 && <>
            <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}><input type="checkbox" checked={!!picked[f.id]} onChange={(e) => setPicked({ ...picked, [f.id]: e.target.checked })}/> เลือก</label>
            <button className="btn btn-outline btn-sm" onClick={() => setOrder({ ...f, onOrder: pos.incoming, demandOpen: pos.demand, suggestQty: Math.ceil(pos.short) })}>สั่งซื้อ</button>
          </>}
        </div>
      ))}
      {canBuy && (() => {
        const buyRows = rows.filter((r) => Store.isBuyable(r.f) && r.pos.short > 0.0005);
        if (!buyRows.length) return null;
        const sel = buyRows.filter((r) => picked[r.f.id]);
        const allOn = sel.length === buyRows.length;
        return (
          <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "center" }}>
            <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}><input type="checkbox" checked={allOn} onChange={(e) => setPicked(Object.fromEntries(buyRows.map((r) => [r.f.id, e.target.checked])))}/> เลือกทั้งหมด</label>
            <button className="btn btn-primary btn-sm" disabled={!sel.length} onClick={() => setBulk(sel)}>สั่งซื้อที่เลือก ({sel.length})</button>
          </div>
        );
      })()}
      {bulk && <BulkProductOrderModal items={bulk} onClose={() => setBulk(null)} onDone={(m) => { setBulk(null); setPicked({}); setToast(m); setTimeout(() => setToast(null), 4000); }}/>}
      {canMake && rows.some((r) => !Store.isBuyable(r.f) && r.pos.short > 0.0005) && (
        <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
          <button className="btn btn-primary btn-sm" onClick={() => setWoOpen(true)}><I.Factory size={13}/> เปิดใบสั่งผลิต</button>
        </div>
      )}
      {woOpen && <WOModal so={doc} onClose={() => setWoOpen(false)}/>}
      {order && <ProductOrderModal f={order} onClose={() => setOrder(null)} onDone={(m) => { setOrder(null); setToast(m); setTimeout(() => setToast(null), 2800); }}/>}
      {toast && <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", fontSize: 12.5, color: "var(--success)" }}><I.Check size={13}/> {toast}</div>}
    </div>
  );
}

function DocActionBar({ doc, can, onEdit, onSubmit, onApprove, onReject, onCancel, onDelete, onConvert, onWO, onShip, onRelated, onPrint, onNote }) {
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
      {doc.type === "INV" && live && ["CN", "DN"].map((t) => Workflow.canEditType(t) && <button key={"nt" + t} className="btn btn-outline btn-sm" onClick={() => onNote(t)}><I.FileText size={13}/> ออก{DOC_LABEL[t].th}</button>)}
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
  const noteInv = Workflow.isNote(doc) ? Workflow.get((doc.sourceIds || [])[0]) : null;   // ใบกำกับภาษีต้นทางของใบลดหนี้/เพิ่มหนี้
  // เอกสารขายที่ส่งลูกค้า (ใบเสนอราคา → ใบเสร็จ รวมใบลดหนี้/เพิ่มหนี้): พิมพ์ออกมา 2 ฉบับ — ต้นฉบับ + สำเนา (PO ลูกค้า/รับชำระพิมพ์ฉบับเดียว)
  const hasCopies = ["QT", "SO", "DO", "INV", "BN", "RC", "CN", "DN"].includes(doc.type);
  // ใบเสร็จที่ลูกค้าหัก ณ ที่จ่าย: สถานะหนังสือรับรอง (50 ทวิ) + ทางลัดบันทึก (ไม่แสดงตอนพิมพ์)
  const whtSt = doc.type === "RC" ? Workflow.whtCertStatus(doc) : null;
  const [whtOpen, setWhtOpen] = useState(false);
  const whtRole = Store.user() ? Store.user().role : null;
  return (
    <div style={{ padding: 18, background: "var(--bg)", overflowX: "auto" }}>
      {whtSt && (
        <div className="no-print" style={{ marginBottom: 10, padding: "9px 12px", borderRadius: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12.5,
          background: whtSt.state === "received" ? "var(--success-subtle)" : whtSt.overdue ? "var(--danger-subtle, #fee2e2)" : "var(--amber-subtle)",
          color: whtSt.state === "received" ? "var(--success)" : whtSt.overdue ? "var(--danger)" : "var(--amber)" }}>
          <span style={{ fontWeight: 600 }}>{whtSt.state === "received" ? "รับหนังสือรับรองหัก ณ ที่จ่ายแล้ว" : "รอหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) จากลูกค้า " + whtSt.days + " วัน" + (whtSt.overdue ? " · เกินกำหนด" : "")}</span>
          {whtSt.state === "received" && <span>เลขที่ {whtSt.cert.no} · {whtSt.cert.date} · {_fmt(whtSt.cert.amount, 2)} บาท</span>}
          {(whtRole === "admin" || whtRole === "accounting") && <button className="btn btn-outline btn-sm" style={{ marginLeft: "auto" }} onClick={() => setWhtOpen(true)}>{whtSt.state === "received" ? "แก้ไข" : "บันทึกหนังสือ"}</button>}
        </div>
      )}
      {whtOpen && <WhtCertModal rc={doc} onClose={() => setWhtOpen(false)}/>}
      <div className="print-area a4-form" data-copies={hasCopies ? "2" : undefined} style={{ background: "white", color: "#0B1220", borderRadius: 8, padding: "28px 32px", boxShadow: "0 2px 10px rgba(0,0,0,0.06)", fontFamily: "var(--font-thai)", fontSize: 12, position: "relative" }}>
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
            <div style={{ fontSize: 11, color: "#3B4457", background: DOC_TINT[doc.type] || "transparent", borderRadius: 4, padding: "1px 8px", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>{meta.short}</div>
            {hasCopies && <div className="copy-mark" style={{ display: "inline-block", marginTop: 4, padding: "1px 12px", border: "1.5px solid #0B1220", borderRadius: 4, fontSize: 12, fontWeight: 700, color: "#0B1220" }}>ต้นฉบับ</div>}
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

        {noteInv && (
          <div style={{ marginTop: 12, border: "1px solid #E6E8EC", borderRadius: 8, padding: "10px 14px", display: "grid", gridTemplateColumns: "190px 1fr", rowGap: 5, fontSize: 11.5 }}>
            <div style={muted}>อ้างอิงใบกำกับภาษีเลขที่:</div><div className="mono"><b>{noteInv.id}</b> · ลงวันที่ {doc.refInvDate || noteInv.date}</div>
            <div style={muted}>มูลค่าตามใบกำกับภาษีเดิม:</div><div className="num">{_fmt(noteInv.subtotal, 2)} บาท (ก่อนภาษี)</div>
            <div style={muted}>เหตุผลที่{doc.type === "CN" ? "ลด" : "เพิ่ม"}หนี้:</div><div><b>{doc.reason || "—"}</b></div>
          </div>
        )}
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
                <td style={{ padding: 10 }}><div className="mono" style={{ fontSize: 11, ...muted }}>{it.code}</div><div style={{ fontWeight: 500, whiteSpace: "pre-line" }}>{it.name}</div></td>
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
            <div style={{ width: 300, fontSize: 12 }}>
              {doc.discount > 0 && <>
                <TotalRow k="รวมเป็นเงิน" v={_fmt(doc.gross, 2)}/>
                <TotalRow k="ส่วนลดท้ายบิล" v={"(" + _fmt(doc.discount, 2) + ")"}/>
              </>}
              <TotalRow k="มูลค่าก่อนภาษี" v={_fmt(doc.subtotal, 2)} line={doc.discount > 0}/>
              <TotalRow k={doc.vatOn ? "ภาษีมูลค่าเพิ่ม 7%" : "ภาษีมูลค่าเพิ่ม (ไม่คิด)"} v={_fmt(doc.vat, 2)}/>
              {noteInv && <>
                <TotalRow k="มูลค่าตามใบกำกับเดิม" v={_fmt(noteInv.subtotal, 2)}/>
                <TotalRow k={"มูลค่าที่ถูกต้อง (" + (doc.type === "CN" ? "หลังลด" : "หลังเพิ่ม") + ")"} v={_fmt(doc.type === "CN" ? noteInv.subtotal - doc.subtotal : noteInv.subtotal + doc.subtotal, 2)}/>
                <TotalRow k={"ผลต่างที่" + (doc.type === "CN" ? "ลด" : "เพิ่ม")} v={_fmt(doc.subtotal, 2)}/>
              </>}
              <TotalRow strong k={noteInv ? (doc.type === "CN" ? "ภาษี + ยอดลดหนี้รวม" : "ภาษี + ยอดเพิ่มหนี้รวม") : "จำนวนเงินรวมทั้งสิ้น"} v={_fmt(doc.total, 2)}/>
              {doc.whtRate > 0 && <>
                <TotalRow k={`หัก ณ ที่จ่าย ${doc.whtRate}%`} v={"(" + _fmt(doc.wht, 2) + ")"} double/>
                <TotalRow strong k="ยอดชำระสุทธิ" v={_fmt(doc.net, 2)}/>
              </>}
            </div>
          </div>
        )}

        {/* ช่องลายเซ็น 2 ฝั่ง: ดันลงล่างสุดของกระดาษ A4 (marginTop: auto ใน flex column ของ .a4-form) */}
        <div className="print-keep sig-block" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, marginTop: "auto", paddingTop: 36, fontSize: 11, textAlign: "center", ...muted }}>
          <div><div style={{ borderTop: "1px solid #5B6478", paddingTop: 6 }}>{doc.type === "DO" ? "ผู้รับสินค้า" : doc.type === "PAY" || doc.type === "RC" ? "ผู้รับเงิน" : "ผู้รับเอกสาร"}</div>
            <div style={{ marginTop: 6 }}>{doc.type === "DO" && doc.ship && doc.ship.receivedBy ? doc.ship.receivedBy : "วันที่ ____ / ____ / ____"}</div></div>
          <div style={{ position: "relative" }}>
            <div style={{ borderTop: "1px solid #5B6478", paddingTop: 6 }}>ผู้มีอำนาจลงนาม</div>
            <div style={{ marginTop: 6 }}>{doc.approvedBy ? `${doc.approvedBy} · ${String(doc.approvedAt).slice(0, 16)}` : "วันที่ ____ / ____ / ____"}</div></div>
        </div>
      </div>
    </div>
  );
}
function PaperRow({ k, v }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 8px" }}><span style={{ color: "#5B6478" }}>{k}</span><span className="num">{v}</span></div>;
}

// แถวสรุปยอดท้ายเอกสารขาย: เส้นบางคั่นทุกบรรทัด · ยอดสำคัญตัวหนา · ยอดสุทธิล่างสุดมีเส้นคู่ (พิมพ์ขาวดำได้ ไม่ใช้พื้นสีเข้ม)
function TotalRow({ k, v, strong, line, double }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: strong ? "8px 8px" : "5px 8px",
      borderTop: double ? "3px double #0B1220" : line ? "1px solid #D5D9E0" : "none", fontSize: strong ? 14 : 12, fontWeight: strong ? 700 : 400, color: "#0B1220" }}>
      <span style={{ color: strong ? "#0B1220" : "#3A4254", fontWeight: strong ? 700 : 400 }}>{k}</span>
      <span className="num">{v} บาท</span>
    </div>
  );
}

// =================== บันทึกรับเงินจากใบเสร็จ → เปิดหน้ารับเงินใหม่ของการเงิน (เลือกบัญชี · เข้าสมุดเงินจริง) ===================
function RvFromRc({ rcId, onClose }) {
  const [accounts, setAccounts] = useState(null);
  const rc = Workflow.get(rcId);
  useEffect(() => {
    let live = true;
    Store.finApi("GET", "/accounts").then((a) => { if (live) setAccounts(a); })
      .catch(() => { notify("การบันทึกรับเงินเป็นหน้าที่ของฝ่ายบัญชีและผู้ดูแลระบบ", "error"); onClose(); });
    return () => { live = false; };
  }, []);
  if (!accounts || !rc) return null;
  return <FinReceiptModal accounts={accounts} prefill={rcPrefill(rc)} onClose={onClose} onDone={() => { try { window.dispatchEvent(new Event("fin-changed")); } catch (e) { /* ignore */ } onClose(); }}/>;
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
        <div><label style={lbl}>วันที่เอกสารใหม่</label><DateInput className="input" value={date} onChange={(e) => setDate(e.target.value)}/></div>
        {Workflow.canApproveType(targetType) && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22, cursor: "pointer" }}>
            <input type="checkbox" checked={approveTarget} onChange={(e) => setApproveTarget(e.target.checked)}/> อนุมัติ{DOC_LABEL[targetType].th}ทันที
          </label>
        )}
      </div>

      {!isPay && others.length > 0 && (
        <div style={{ marginBottom: 12, padding: 10, background: "var(--bg-subtle)", borderRadius: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: "flex", gap: 10, alignItems: "center" }}>
            <span>{targetType === "BN" ? "รวมใบกำกับภาษีอื่นของลูกค้ารายนี้ที่ยังไม่ได้วางบิล (ใบวางบิลรวมสิ้นเดือน)" : "รวมเอกสารอื่นของลูกค้ารายนี้ที่ยังค้างอยู่"}</span>
            <a style={{ color: "var(--accent)", cursor: "pointer", fontWeight: 500 }} onClick={() => setSelected(selected.length === others.length + 1 ? [sourceId] : [sourceId, ...others.map((d) => d.id)])}>{selected.length === others.length + 1 ? "ยกเลิกเลือกทั้งหมด" : "เลือกทั้งหมด (" + others.length + ")"}</a>
          </div>
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
      <div style={{ marginBottom: 12 }}><label style={{ fontSize: 12, color: "var(--text-secondary)" }}>กำหนดเสร็จ</label><DateInput className="input" value={due} onChange={(e) => setDue(e.target.value)} style={{ marginTop: 4 }}/></div>
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
  const products = [...Store.state.finished.map((f) => ({ code: f.code, name: Store.productLabel(f), unit: f.unit || "PCS", price: f.price })),
    ...Store.state.materials.filter((m) => m.active !== false).map((m) => ({ code: m.code, name: m.name, unit: m.unit, price: 0 }))];

  const [f, setF] = useState(init);
  const [editReason, setEditReason] = useState("");
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const setLine = (i, patch) => setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const isPay = f.type === "PAY";
  const c = Workflow.calc(f);
  const createTypes = types.filter((t) => t !== "PAY" && !isNoteType(t) && Workflow.canEditType(t));
  const isNote = isNoteType(f.type);
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
        <div><label style={lbl}>วันที่</label><DateInput className="input" value={f.date} onChange={(e) => set({ date: e.target.value })}/></div>
        <div><label style={lbl}>กำหนดชำระ / ครบกำหนด <span style={{ color: "var(--text-tertiary)" }}>(ว่าง = คำนวณจากเครดิตลูกค้า)</span></label>
          <DateInput className="input" value={f.due && f.due !== "—" ? f.due : ""} onChange={(e) => set({ due: e.target.value })}/></div>
        {!isPay && <div><label style={lbl}>เลขที่ PO ลูกค้า / อ้างอิง</label><input className="input" value={f.refNo || ""} onChange={(e) => set({ refNo: e.target.value })}/></div>}
        {f.type === "RC" && <div><label style={lbl}>ผู้เก็บเงิน (พนักงานที่พกใบเสร็จไปเก็บ)</label><input className="input" value={f.collector || ""} placeholder="เช่น ชื่อพนักงานขาย/ส่งของ" onChange={(e) => set({ collector: e.target.value })}/></div>}
        {isNote && <div style={{ gridColumn: "1/-1" }}><label style={lbl}>เหตุผลในการออก{DOC_LABEL[f.type].th} * <span style={{ color: "var(--text-tertiary)" }}>(จะพิมพ์ลงเอกสาร)</span></label>
          <select className="input" value={f.reason || ""} onChange={(e) => set({ reason: e.target.value })}>
            <option value="">— เลือกเหตุผล —</option>{Workflow.NOTE_REASONS[f.type].map((r) => <option key={r} value={r}>{r}</option>)}
            {f.reason && !Workflow.NOTE_REASONS[f.type].includes(f.reason) && <option value={f.reason}>{f.reason}</option>}
          </select></div>}
        {!isPay && <div><label style={lbl}>หัก ณ ที่จ่าย</label>
          <select className="input" value={f.whtRate || 0} disabled={isNote} onChange={(e) => set({ whtRate: Number(e.target.value) })}>
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
            <input type="checkbox" checked={!!f.vatOn} disabled={isNote} title={isNote ? "คิด VAT ตามใบกำกับต้นทาง" : ""} onChange={(e) => set({ vatOn: e.target.checked })}/> คิด VAT 7%
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
                  <td><textarea className="input input-sm" aria-label="ชื่อรายการ" value={l.name} disabled={locked} rows={Math.min(8, Math.max(1, String(l.name || "").split("\n").length))}
                    onChange={(e) => setLine(i, { name: e.target.value })} placeholder={"ชื่อสินค้า / รายละเอียด\n(กด Enter เพื่อขึ้นบรรทัดใหม่ เช่น วัสดุ / Cavity)"}
                    style={{ height: "auto", minHeight: 34, resize: "vertical", lineHeight: 1.5, paddingTop: 6, paddingBottom: 6, fontFamily: "inherit" }}/></td>
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
