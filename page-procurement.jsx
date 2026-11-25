/* global React, I, SUPPLIERS, PURCHASE_ORDERS, PO_STATUS, MATERIALS, WHT_RATES, ROLES, COMPANY, Store, useStore, PageHeader, Tabs, Drawer, baht, _fmt, whtAmount, runAction, notify, exportCSV, printDoc, ReasonModal */

function PageProcurement() {
  const [tab, setTab] = useState("PO");
  const [openPO, setOpenPO] = useState(null);
  const [openSup, setOpenSup] = useState(null);
  const [supForm, setSupForm] = useState(null); // { mode: "add" | "edit", rec }
  const [showInactiveSup, setShowInactiveSup] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState(null);
  useStore();
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  const totalSpend = PURCHASE_ORDERS.reduce((s, p) => s + p.total, 0);
  const pending = PURCHASE_ORDERS.filter((p) => p.status === "pending").length;
  const received = PURCHASE_ORDERS.filter((p) => p.status === "received").length;
  // ใบสั่งซื้อ: ค้นหา (เลขที่ PO / Supplier / รายการสินค้า / ผู้ออก) · สถานะ · ช่วงวันที่ · เรียง · แบ่งหน้า
  const [poStatus, setPoStatus] = useState("ALL");
  const poView = useListView(PURCHASE_ORDERS, {
    text: (p) => [p.id, p.supplierName, p.supplier, p.createdBy, p.note, (p.lines || []).map((l) => l.name + " " + (l.code || "")).join(" ")].join(" "),
    dateKey: (p) => p.date,
    filter: (p) => poStatus === "ALL" || p.status === poStatus, filterKey: poStatus,
    defaultSort: { key: "date", dir: "desc" },
    sorts: { id: (p) => p.id, date: (p) => p.date, supplier: (p) => p.supplierName, expected: (p) => p.expectedDate, wht: (p) => (p.whtRate ? whtAmount(p.subtotal, p.whtRate) : 0), total: (p) => p.total || 0, status: (p) => (PO_STATUS[p.status] || {}).th || p.status },
  });

  const role = Store.user() ? ROLES[Store.user().role] : null;
  const canApprovePO = !!role && (role.approve === "*" || (role.canEdit || []).includes("procurement"));
  // จัดการทะเบียน Supplier (เพิ่ม/แก้ไข/ปิดใช้งาน): Admin และฝ่ายจัดซื้อเท่านั้น (ตรงกับ backend)
  const canManageSup = !!role && (role.canEdit === "*" || (role.canEdit || []).includes("procurement"));
  const inactiveSupCount = SUPPLIERS.filter((s) => s.status === "inactive").length;
  const visibleSuppliers = SUPPLIERS.filter((s) => showInactiveSup || s.status !== "inactive");
  // Supplier: ค้นหา (รหัส/ชื่อ/เลขผู้เสียภาษี/ผู้ติดต่อ/โทร/หมวด) · หมวด · เรียง · แบ่งหน้า
  const [supCat, setSupCat] = useState("ALL");
  const supSpend = (s) => PURCHASE_ORDERS.filter((p) => p.status === "received" && (p.supplier === s.code || p.supplierName === s.name)).reduce((t, p) => t + p.total, 0);
  const supView = useListView(visibleSuppliers, {
    text: (s) => [s.code, s.name, s.nameEn, s.taxId, s.contact, s.phone, s.email, s.category, s.address].join(" "),
    filter: (s) => supCat === "ALL" || s.category === supCat, filterKey: supCat + "|" + showInactiveSup,
    defaultSort: { key: "code", dir: "asc" },
    sorts: { code: (s) => s.code, name: (s) => s.name, category: (s) => s.category, contact: (s) => s.contact, credit: (s) => s.credit || 0, spend: (s) => supSpend(s), rating: (s) => s.rating || 0 },
  });
  const liveSup = openSup ? SUPPLIERS.find((s) => s.id === openSup.id) || openSup : null;
  // ไม่มีการลบ Supplier: ใช้ปิดใช้งาน/เปิดใช้งานเท่านั้น (PO เดิมยังแสดงข้อมูลเดิมครบ)
  const toggleSupActive = (s) => {
    const activate = s.status === "inactive";
    if (!activate && !window.confirm(`ปิดใช้งาน ${s.code} · ${s.name} ?\n(PO เดิมยังแสดงข้อมูลตามปกติ แต่จะไม่แสดงให้เลือกใน PO ใหม่ — เปิดใช้งานกลับได้ภายหลัง)`)) return;
    runAction(() => Store.update("suppliers", s.id, { status: activate ? "active" : "inactive" }, "id", activate ? "เปิดใช้งาน" : "ปิดใช้งาน"),
      activate ? `เปิดใช้งาน ${s.code} แล้ว` : `ปิดใช้งาน ${s.code} แล้ว`);
  };
  const [cancelPO, setCancelPO] = useState(null);
  const livePO = openPO ? PURCHASE_ORDERS.find((p) => p.id === openPO.id) || openPO : null;
  const approvePO = (po) => runAction(() => Store.update("purchaseOrders", po.id, { status: "approved", approvedBy: Store.userName(), approvedAt: Store.now() }, "id", "อนุมัติใบสั่งซื้อ"), `อนุมัติ ${po.id} แล้ว`);
  const mailPO = (po) => {
    const sup = SUPPLIERS.find((s) => s.code === po.supplier || s.name === po.supplierName);
    if (!sup || !sup.email) { notify("ไม่พบอีเมลของ Supplier ในทะเบียน", "error"); return; }
    const body = [`เรียน ${sup.contact || sup.name}`, "", `ขอสั่งซื้อตามใบสั่งซื้อเลขที่ ${po.id} วันที่ ${po.date}`,
      ...(po.lines || []).map((l, i) => `${i + 1}. ${l.name} จำนวน ${l.qty} ${l.unit} ราคา ${l.price}`),
      "", `รวมทั้งสิ้น ${po.total} บาท`, `กำหนดรับของ ${po.expectedDate}`, "", COMPANY.nameTh].join("\n");
    window.location.href = `mailto:${sup.email}?subject=${encodeURIComponent("ใบสั่งซื้อ " + po.id + " - " + COMPANY.name)}&body=${encodeURIComponent(body)}`;
    Store.tx("mailPO", () => Store.log("SEND", "ใบสั่งซื้อ", po.id, "เปิดอีเมลส่งให้ " + sup.email));
  };
  const [receiving, setReceiving] = useState(false);
  const handleReceive = async (po) => {
    if (!po || receiving) return;
    setReceiving(true);
    try {
      const r = await Store.receivePO(po.id);
      setOpenPO(null);
      showToast(r.received.length
        ? `รับเข้า ${po.id} → เพิ่มสต๊อก ${r.received.length} รายการเรียบร้อย`
        : `ตรวจรับงาน ${po.id} แล้ว → ตั้งเจ้าหนี้ ${r.expenseId || ""}`);
    } catch (e) {
      notify(e && e.message ? e.message : String(e), "error");
    } finally {
      setReceiving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="ฝ่ายจัดซื้อ"
        subtitle="ใบสั่งซื้อ (PO) · ทะเบียน Supplier · รับเข้าวัตถุดิบ"
        actions={
          <>
            <button className="btn btn-outline btn-sm" disabled={!PURCHASE_ORDERS.length} onClick={() => exportCSV(`ใบสั่งซื้อ-${Store.today()}.csv`, ["เลขที่", "วันที่", "Supplier", "รายการ", "ก่อน VAT", "VAT", "รวม", "กำหนดรับ", "สถานะ", "ผู้ออก"], poView.sorted.map((p) => [p.id, p.date, p.supplierName, p.items, p.subtotal, p.vat, p.total, p.expectedDate, (PO_STATUS[p.status] || {}).th, p.createdBy]))}><I.Download size={14}/> ส่งออก CSV</button>
            <button className="btn btn-primary btn-sm" onClick={() => { setTab("PO"); setAddOpen(true); }}><I.Plus size={14}/> เปิด PO ใหม่</button>
          </>
        }
      />

      <div className="grid-4" style={{ marginBottom: 14 }}>
        <Stat icon="FileText" tone="accent" label="PO ทั้งหมด" value={_fmt(PURCHASE_ORDERS.length)} unit="ใบ" foot="ทั้งหมด"/>
        <Stat icon="Clock" tone="amber" label="รออนุมัติ" value={_fmt(pending)} unit="ใบ" foot="ต้องดำเนินการ"/>
        <Stat icon="Check" tone="success" label="รับเข้าแล้ว" value={_fmt(received)} unit="ใบ" foot="ทั้งหมด"/>
        <Stat icon="Wallet" tone="violet" label="ยอดจัดซื้อ" value={baht(totalSpend)} foot={`${SUPPLIERS.length} suppliers`}/>
      </div>

      <Tabs
        items={[
          { id: "PO", label: "ใบสั่งซื้อ (PO)", count: PURCHASE_ORDERS.length },
          { id: "SUP", label: "Supplier", count: SUPPLIERS.length },
          { id: "RECEIVE", label: "รับเข้าวัตถุดิบ" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "PO" && (
        <div className="card">
          <ListToolbar view={poView} placeholder="เลขที่ PO / Supplier / สินค้า / ผู้ออก…">
            <select className="select" style={{ width: 160 }} value={poStatus} onChange={(e) => setPoStatus(e.target.value)}>
              <option value="ALL">ทุกสถานะ</option>{Object.keys(PO_STATUS).map((k) => <option key={k} value={k}>{PO_STATUS[k].th}</option>)}
            </select>
          </ListToolbar>
          <div style={{ overflow: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <SortTh view={poView} k="id">เลขที่ PO</SortTh>
                  <SortTh view={poView} k="date">วันที่</SortTh>
                  <SortTh view={poView} k="supplier">Supplier</SortTh>
                  <th>รายการ</th>
                  <SortTh view={poView} k="expected">กำหนดรับ</SortTh>
                  <SortTh view={poView} k="wht" className="num">หัก ณ ที่จ่าย</SortTh>
                  <SortTh view={poView} k="total" className="num">มูลค่า</SortTh>
                  <SortTh view={poView} k="status">สถานะ</SortTh>
                </tr>
              </thead>
              <tbody>
                {poView.pageRows.map((p) => {
                  const meta = PO_STATUS[p.status];
                  return (
                    <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => setOpenPO(p)}>
                      <td className="mono"><b>{p.id}</b></td>
                      <td className="num" style={{ fontSize: 12.5 }}>{p.date}</td>
                      <td>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{p.supplierName}</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{p.supplier}</div>
                      </td>
                      <td style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                        {p.lines.length === 1 ? p.lines[0].name : `${p.lines.length} รายการ`}
                      </td>
                      <td className="num" style={{ fontSize: 12.5 }}>{p.expectedDate}</td>
                      <td className="num" style={{ color: p.whtRate ? "var(--amber)" : "var(--text-tertiary)" }}>{p.whtRate ? `(${_fmt(whtAmount(p.subtotal, p.whtRate))})` : "—"}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{baht(p.total)}</td>
                      <td><span className={"badge badge-" + meta.color}><span className="b-dot"/>{meta.th}</span></td>
                    </tr>
                  );
                })}
                {!poView.total && <tr><td colSpan={8} style={{ textAlign: "center", padding: 32, color: "var(--text-tertiary)" }}>{PURCHASE_ORDERS.length ? "ไม่พบใบสั่งซื้อตามเงื่อนไข" : "ยังไม่มีใบสั่งซื้อ"}</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager view={poView}/>
        </div>
      )}

      {tab === "SUP" && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
            <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={showInactiveSup} onChange={(e) => setShowInactiveSup(e.target.checked)}/> แสดงรายการที่ปิดใช้งาน ({inactiveSupCount})
            </label>
            <span className="spacer" style={{ flex: 1 }}/>
            {canManageSup && <button className="btn btn-primary btn-sm" onClick={() => setSupForm({ mode: "add" })}><I.Plus size={14}/> เพิ่ม Supplier</button>}
          </div>
          {!visibleSuppliers.length && (
            <div style={{ padding: 28, textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>
              ยังไม่มี Supplier ในทะเบียน{canManageSup ? " — กด \"เพิ่ม Supplier\" เพื่อเริ่มต้น" : " (ให้ Admin หรือฝ่ายจัดซื้อเพิ่ม)"}
            </div>
          )}
          <ListToolbar view={supView} placeholder="รหัส / ชื่อผู้ขาย / เลขผู้เสียภาษี / ผู้ติดต่อ…">
            <select className="select" style={{ width: 160 }} value={supCat} onChange={(e) => setSupCat(e.target.value)}>
              <option value="ALL">ทุกหมวด</option>{[...new Set(SUPPLIERS.map((s) => s.category).filter(Boolean))].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </ListToolbar>
          <table className="table">
            <thead>
              <tr>
                <SortTh view={supView} k="code">รหัส</SortTh>
                <SortTh view={supView} k="name">ผู้ขาย</SortTh>
                <SortTh view={supView} k="category">หมวด</SortTh>
                <SortTh view={supView} k="contact">ผู้ติดต่อ</SortTh>
                <SortTh view={supView} k="credit">เครดิต</SortTh>
                <SortTh view={supView} k="spend" className="num">ยอดสั่งซื้อ YTD</SortTh>
                <SortTh view={supView} k="rating">คะแนน</SortTh>
              </tr>
            </thead>
            <tbody>
              {supView.total === 0 && visibleSuppliers.length > 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, color: "var(--text-tertiary)" }}>ไม่พบผู้ขายตามเงื่อนไข</td></tr>}
              {supView.pageRows.map((s) => (
                <tr key={s.id} style={{ cursor: "pointer", opacity: s.status === "inactive" ? 0.6 : 1 }} onClick={() => setOpenSup(s)}>
                  <td className="mono"><b>{s.code}</b>{s.status === "inactive" && <> <span className="badge badge-neutral">ปิดใช้งาน</span></>}</td>
                  <td>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{s.taxId}</div>
                  </td>
                  <td><span className="badge badge-neutral">{s.category}</span></td>
                  <td>
                    <div style={{ fontSize: 12.5 }}>{s.contact}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{s.phone}</div>
                  </td>
                  <td>{s.credit} วัน</td>
                  <td className="num" style={{ fontWeight: 500 }}>{baht(PURCHASE_ORDERS.filter((p) => p.status === "received" && (p.supplier === s.code || p.supplierName === s.name)).reduce((t, p) => t + p.total, 0))}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="num" style={{ fontWeight: 600 }}>{s.rating || "—"}</span>
                      {!!s.rating && <span style={{ color: "#F59E0B", fontSize: 14 }}>★</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager view={supView}/>
        </div>
      )}

      {tab === "RECEIVE" && <ReceiveView onReceive={handleReceive}/>}

      <Drawer open={!!livePO} onClose={() => setOpenPO(null)} title={livePO ? `ใบสั่งซื้อ · ${livePO.id}` : ""} width={720}
        footer={livePO &&
          <>
            <button className="btn btn-outline btn-sm" onClick={() => printDoc(livePO.id)}><I.Printer size={13}/> พิมพ์ PO</button>
            <button className="btn btn-outline btn-sm" onClick={() => mailPO(livePO)}><I.Mail size={13}/> อีเมลถึง Supplier</button>
            {!["received", "cancelled"].includes(livePO.status) && <button className="btn btn-outline btn-sm" style={{ color: "var(--danger)" }} onClick={() => setCancelPO(livePO.id)}>ยกเลิก PO</button>}
            <span className="spacer"/>
            {livePO.status === "cancelled" ? <span className="badge badge-danger">ยกเลิกแล้ว</span>
              : livePO.status === "received"
              ? <span className="badge badge-success" style={{ padding: "6px 12px" }}><I.Check size={13}/> รับเข้าแล้ว</span>
              : livePO.status !== "approved" ? <button className="btn btn-primary btn-sm" disabled={!canApprovePO} title={canApprovePO ? "" : "ไม่มีสิทธิ์อนุมัติ"} onClick={() => approvePO(livePO)}><I.Check size={13}/> อนุมัติใบสั่งซื้อ</button>
              : <button className="btn btn-primary btn-sm" onClick={() => handleReceive(livePO)}><I.Upload size={13}/> {isServicePO(livePO) ? "ยืนยันตรวจรับงาน (ตั้งเจ้าหนี้)" : "ยืนยันรับเข้า + ตัดสต๊อก"}</button>}
          </>
        }
      >
        {livePO && <div className="print-area" style={{ background: "var(--bg-elevated)" }}><POPreview po={livePO}/></div>}
      </Drawer>

      {cancelPO && <ReasonModal title={"ยกเลิกใบสั่งซื้อ " + cancelPO} label="เหตุผลการยกเลิก" danger confirmLabel="ยกเลิก PO" onClose={() => setCancelPO(null)}
        onConfirm={(r) => { if (runAction(() => Store.update("purchaseOrders", cancelPO, { status: "cancelled", cancel: { reason: r, by: Store.userName(), at: Store.now() } }, "id", "ยกเลิก: " + r), "ยกเลิกใบสั่งซื้อแล้ว")) setCancelPO(null); }}/>}

      <Drawer open={!!liveSup} onClose={() => setOpenSup(null)} title={liveSup?.name} width={620}
        footer={liveSup && canManageSup &&
          <>
            <button className="btn btn-outline btn-sm" onClick={() => { const s = liveSup; setOpenSup(null); setSupForm({ mode: "edit", rec: s }); }}>แก้ไข</button>
            <button className="btn btn-outline btn-sm" onClick={() => toggleSupActive(liveSup)}>{liveSup.status === "inactive" ? "เปิดใช้งาน" : "ปิดใช้งาน"}</button>
          </>
        }
      >
        {liveSup && <SupplierDetail s={liveSup}/>}
      </Drawer>

      <Drawer open={!!supForm} onClose={() => setSupForm(null)} title={supForm && supForm.mode === "edit" ? "แก้ไข Supplier " + supForm.rec.code : "เพิ่ม Supplier"} width={620}>
        {supForm && <SupplierForm key={supForm.mode + (supForm.rec ? supForm.rec.id : "")} mode={supForm.mode} rec={supForm.rec}
          onCancel={() => setSupForm(null)}
          onDone={(msg) => { setSupForm(null); setTab("SUP"); showToast(msg); }}/>}
      </Drawer>

      <Drawer open={addOpen} onClose={() => setAddOpen(false)} title="เปิดใบสั่งซื้อใหม่ (PO)" width={760}>
        {addOpen && <AddPOForm
          onCancel={() => setAddOpen(false)}
          onSubmit={(rec) => { Store.add("purchaseOrders", rec, `${rec.supplierName} ${rec.total}`); setAddOpen(false); showToast(`สร้างใบสั่งซื้อ ${rec.id} เรียบร้อย`); }}
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

function AddPOForm({ onSubmit, onCancel }) {
  const today = "2026-06-06";
  const [supplier, setSupplier] = useState("");
  const [date, setDate] = useState(today);
  const [expectedDate, setExpectedDate] = useState("");
  const [whtRate, setWhtRate] = useState(0);
  const [status, setStatus] = useState("pending");
  const [lines, setLines] = useState([{ itemType: "material", item: "", name: "", qty: "", unit: "KG", price: "" }]);

  const setLine = (i, k, v) => setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l));
  const addLine = () => setLines((ls) => [...ls, { itemType: "material", item: "", name: "", qty: "", unit: "KG", price: "" }]);
  const delLine = (i) => setLines((ls) => ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls);
  // val: "m:<id>" วัตถุดิบ · "p:<id>" สินค้าซื้อมาขาย (สินค้าที่ซื้อได้) · "custom" · ""
  const pickItem = (i, val) => setLines((ls) => ls.map((l, idx) => {
    if (idx !== i) return l;
    if (val === "custom") return { ...l, itemType: "material", item: "custom", name: "", unit: "งาน" };
    if (!val) return { ...l, itemType: "material", item: "", name: "" };
    const isP = val.startsWith("p:"), id = val.slice(2);
    const m = isP ? FINISHED.find((x) => x.id === id) : MATERIALS.find((x) => x.id === id);
    if (!m) return l;
    // ราคาตั้งต้น = ราคาซื้อล่าสุด (ไม่เคยซื้อ = เว้นว่างให้กรอกเอง) — ต้นทุนคำนวณจากราคาที่กรอกใน PO
    const ps = isP ? (window.productPurchaseStats ? window.productPurchaseStats(m) : null) : (window.materialPurchaseStats ? window.materialPurchaseStats(m) : null);
    return { ...l, itemType: isP ? "product" : "material", item: id, name: isP ? m.code + " " + m.name : m.name, unit: m.unit || "PCS", price: ps && ps.last > 0 ? String(ps.last) : "" };
  }));

  const computed = lines.map((l) => ({ ...l, amount: (parseFloat(l.qty) || 0) * (parseFloat(l.price) || 0) }));
  const subtotal = computed.reduce((s, l) => s + l.amount, 0);
  const vat = Math.round(subtotal * 0.07 * 100) / 100;
  const total = subtotal + vat;
  const wht = whtAmount(subtotal, whtRate);
  const net = total - wht;

  const sup = SUPPLIERS.find((s) => s.code === supplier);
  const valid = supplier && computed.some((l) => l.name.trim() && l.amount > 0);

  const nextPoId = () => Store.nextDocNo("PO").docNo;

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    const cleanLines = computed.filter((l) => l.name.trim() && l.amount > 0)
      .map((l) => ({ itemType: l.item === "custom" ? "service" : l.itemType === "product" ? "product" : "material", item: l.item && l.item !== "custom" ? l.item : undefined, name: l.name.trim(), qty: parseFloat(l.qty) || 0, unit: l.unit, price: parseFloat(l.price) || 0, amount: l.amount }));
    if (cleanLines.some((l) => l.itemType !== "service" && !l.item)) { notify("กรุณาเลือกวัตถุดิบ/สินค้าจากทะเบียน หรือเลือก \"อื่นๆ / บริการ\" สำหรับงานบริการ", "error"); return; }
    onSubmit({
      id: nextPoId(), date,
      supplier, supplierName: sup ? sup.name.replace(/ (Co\.|Public|PCL|Pte).*$/i, "").trim() : supplier,
      items: cleanLines.length, subtotal, vat, whtRate: parseInt(whtRate, 10) || 0, total,
      expectedDate: expectedDate || "—", status, createdBy: Store.userName(), lines: cleanLines,
    });
  };

  return (
    <form onSubmit={submit} style={{ padding: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label className="field-label">ผู้ขาย / Supplier *</label>
          <select className="select" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">— เลือก Supplier —</option>
            {SUPPLIERS.filter((s) => s.status !== "inactive").map((s) => <option key={s.id} value={s.code}>{s.name} · {s.category}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">วันที่ออก PO</label>
          <DateInput className="input" value={date} onChange={(e) => setDate(e.target.value)}/>
        </div>
        <div>
          <label className="field-label">กำหนดรับสินค้า</label>
          <DateInput className="input" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)}/>
        </div>
      </div>

      <label className="field-label">รายการสั่งซื้อ * <span style={{ fontWeight: 400, color: "var(--text-tertiary)" }}>· เลือกวัตถุดิบจากคลัง → รับเข้าแล้วตัดสต๊อกให้อัตโนมัติ</span></label>
      <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 78px 70px 90px 92px 30px", gap: 8, padding: "8px 10px", background: "var(--bg-subtle)", fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>
          <div>วัตถุดิบ / สินค้า</div><div style={{ textAlign: "right" }}>จำนวน</div><div>หน่วย</div><div style={{ textAlign: "right" }}>หน่วยละ</div><div style={{ textAlign: "right" }}>รวม</div><div></div>
        </div>
        {computed.map((l, i) => (
          <div key={i} style={{ padding: "8px 10px", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 78px 70px 90px 92px 30px", gap: 8, alignItems: "center" }}>
              <select className="select" style={{ height: 34, padding: "0 6px" }} value={l.item === "custom" ? "custom" : l.item ? (l.itemType === "product" ? "p:" : "m:") + l.item : ""} onChange={(e) => pickItem(i, e.target.value)}>
                <option value="">— เลือกวัตถุดิบ / สินค้า —</option>
                <optgroup label="วัตถุดิบ">
                  {MATERIALS.filter((m) => m.active !== false).map((m) => <option key={"m" + m.id} value={"m:" + m.id}>{m.code} · {m.name}</option>)}
                </optgroup>
                <optgroup label="สินค้าซื้อมาขาย (สั่งซื้อได้)">
                  {FINISHED.filter((f) => Store.isBuyable(f) && f.active !== false).map((f) => <option key={"p" + f.id} value={"p:" + f.id}>{f.code} · {Store.productLabel(f)}</option>)}
                </optgroup>
                <option value="custom">อื่นๆ / บริการ (ไม่เข้าคลัง · ลงค่าใช้จ่ายเมื่อตรวจรับงาน)</option>
              </select>
              <input type="number" min="0" step="0.01" className="input num" style={{ height: 34, textAlign: "right" }} placeholder="0" value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)}/>
              <select className="select" style={{ height: 34, padding: "0 6px" }} value={l.unit} onChange={(e) => setLine(i, "unit", e.target.value)}>
                {["KG", "PCS", "งาน", "SET", "ROLL", "L", "BOX", "PACK"].map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <input type="number" min="0" step="0.01" className="input num" style={{ height: 34, textAlign: "right" }} placeholder="0.00" value={l.price} onChange={(e) => setLine(i, "price", e.target.value)}/>
              <div className="num" style={{ textAlign: "right", fontSize: 12.5, fontWeight: 500 }}>{_fmt(l.amount, 2)}</div>
              <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => delLine(i)} title="ลบ"><I.X size={13}/></button>
            </div>
            {l.item && l.item !== "custom" && window.materialPurchaseStats && window.productPurchaseStats && (() => {
              const isP = l.itemType === "product";
              const m = isP ? FINISHED.find((x) => x.id === l.item) : MATERIALS.find((x) => x.id === l.item);
              const ps = m ? (isP ? window.productPurchaseStats(m) : window.materialPurchaseStats(m)) : null;
              if (!ps || ps.last == null) return <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>ยังไม่มีประวัติซื้อ · ต้นทุนถัวเฉลี่ย ฿{_fmt(m.cost, 2)}</div>;
              const cur = parseFloat(l.price) || 0;
              const diff = cur && ps.last ? ((cur - ps.last) / ps.last) * 100 : 0;
              return <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>ซื้อล่าสุด ฿{_fmt(ps.last, 2)} · ต่ำสุด–สูงสุด ฿{_fmt(ps.min, 2)}–{_fmt(ps.max, 2)} · ต้นทุนถัวเฉลี่ย ฿{_fmt(m.cost, 2)}{cur > 0 && Math.abs(diff) >= 0.5 ? <b style={{ color: diff > 0 ? "var(--danger)" : "var(--success)", marginLeft: 6 }}>({diff > 0 ? "+" : ""}{diff.toFixed(1)}% จากล่าสุด)</b> : null}</div>;
            })()}
            {l.item === "custom" && (
              <input className="input" style={{ height: 32, marginTop: 6 }} placeholder="ระบุชื่อรายการ / บริการ (เช่น ค่าซ่อมแม่พิมพ์)" value={l.name} onChange={(e) => setLine(i, "name", e.target.value)}/>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-outline btn-sm" onClick={addLine} style={{ marginBottom: 16 }}><I.Plus size={13}/> เพิ่มรายการ</button>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label className="field-label">หัก ณ ที่จ่าย (ถ้ามี)</label>
            <select className="select" value={whtRate} onChange={(e) => setWhtRate(e.target.value)}>
              {Object.entries(WHT_RATES).map(([r, lbl]) => <option key={r} value={r}>{lbl}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">สถานะเอกสาร</label>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="draft">ร่าง</option>
              <option value="pending">รออนุมัติ</option>
            </select>
          </div>
        </div>
        <div style={{ background: "var(--bg-subtle)", borderRadius: 10, padding: 14 }}>
          <POTotalRow k="รวมเป็นเงิน" v={_fmt(subtotal, 2)}/>
          <POTotalRow k="ภาษีมูลค่าเพิ่ม 7%" v={_fmt(vat, 2)}/>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", marginTop: 4, borderTop: "1px solid var(--border)", fontWeight: 600 }}>
            <span>รวมทั้งสิ้น</span><span className="num">{baht(total, 2)}</span>
          </div>
          {whtRate > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: "var(--amber)" }}>
                <span>หัก ณ ที่จ่าย {whtRate}%</span><span className="num">({_fmt(wht, 2)})</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", fontWeight: 600, color: "var(--success)" }}>
                <span>ยอดจ่ายสุทธิ</span><span className="num">{baht(net, 2)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-outline" onClick={onCancel}>ยกเลิก</button>
        <button type="submit" className="btn btn-primary" disabled={!valid}><I.Check size={14}/> บันทึกใบ PO</button>
      </div>
    </form>
  );
}

function POTotalRow({ k, v }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5 }}>
      <span style={{ color: "var(--text-secondary)" }}>{k}</span><span className="num">{v}</span>
    </div>
  );
}

function ReceiveView({ onReceive }) {
  const pending = PURCHASE_ORDERS.filter((p) => p.status === "approved");
  const rv = useListView(pending, {
    text: (p) => [p.id, p.supplierName, (p.lines || []).map((l) => l.name).join(" ")].join(" "), dateKey: (p) => p.expectedDate, dateLabel: "วันที่นัด",
    sorts: { id: (p) => p.id, sup: (p) => p.supplierName, item: (p) => (p.lines[0] ? p.lines[0].name : ""), exp: (p) => p.expectedDate, total: (p) => p.total || 0 },
    defaultSort: { key: "exp", dir: "asc" },
  });
  return (
    <div className="card">
      <div className="card-head"><div className="card-title">รอรับเข้า ({pending.length} ใบ) <span style={{ fontWeight: 400, fontSize: 12, color: "var(--text-tertiary)" }}>เฉพาะใบสั่งซื้อที่อนุมัติแล้ว</span></div></div>
      <ListToolbar view={rv} placeholder="ค้นหา PO / Supplier / รายการ…"/>
      <table className="table">
        <thead><tr><SortTh view={rv} k="id">PO</SortTh><SortTh view={rv} k="sup">Supplier</SortTh><SortTh view={rv} k="item">รายการ</SortTh><SortTh view={rv} k="exp">วันที่นัด</SortTh><SortTh view={rv} k="total" className="num">มูลค่า</SortTh><th></th></tr></thead>
        <tbody>
          {rv.pageRows.map((p) => (
            <tr key={p.id}>
              <td className="mono"><b>{p.id}</b></td>
              <td>{p.supplierName}</td>
              <td style={{ fontSize: 12.5 }}>{p.lines[0].name}{p.lines.length > 1 ? ` +${p.lines.length-1}` : ""}</td>
              <td className="num">{p.expectedDate}</td>
              <td className="num" style={{ fontWeight: 500 }}>{baht(p.total)}</td>
              <td style={{ textAlign: "right" }}>
                <button className="btn btn-outline btn-sm" onClick={() => onReceive(p)}><I.Upload size={13}/> {isServicePO(p) ? "ตรวจรับงาน" : "รับเข้า + ตัดสต๊อก"}</button>
              </td>
            </tr>
          ))}
          {!pending.length && <tr><td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--text-tertiary)" }}>ไม่มีรายการรอรับเข้า</td></tr>}
        </tbody>
      </table>
      <Pager view={rv}/>
    </div>
  );
}

// PO ที่มีแต่รายการบริการ = ไม่มีของเข้าสต๊อก (รับงาน → ตั้งเจ้าหนี้อย่างเดียว)
const isServicePO = (po) => !!po && (po.lines || []).length > 0 && po.lines.every((l) => l.itemType === "service");

function POPreview({ po }) {
  return (
    <div style={{ padding: 20 }}>
      <div style={{ background: "var(--bg-elevated)", padding: 24, border: "1px solid var(--border)", borderRadius: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, borderBottom: "2px solid var(--text-primary)", paddingBottom: 14 }}>
          <img src="assets/polymate-logo.png" alt="PolyMate" style={{ width: 46, height: 46, objectFit: "contain" }}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{window.COMPANY.nameTh}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{window.COMPANY.name}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>ใบสั่งซื้อ</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Purchase Order</div>
            <div className="mono" style={{ marginTop: 6, fontWeight: 600 }}>{po.id}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>ผู้ขาย / Supplier</div>
            <div style={{ fontWeight: 600 }}>{po.supplierName}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 4 }}>รหัส {po.supplier}</div>
          </div>
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", rowGap: 5, fontSize: 12 }}>
              <span style={{ color: "var(--text-secondary)" }}>วันที่ออก PO:</span><span>{po.date}</span>
              <span style={{ color: "var(--text-secondary)" }}>นัดรับสินค้า:</span><span>{po.expectedDate}</span>
              <span style={{ color: "var(--text-secondary)" }}>ผู้ออกเอกสาร:</span><span>{po.createdBy}</span>
            </div>
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16, fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--bg-subtle)" }}>
              <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600 }}>รายการ</th>
              <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>จำนวน</th>
              <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>หน่วยละ</th>
              <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>รวม</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: 10 }}>{l.name}</td>
                <td className="num" style={{ padding: 10, textAlign: "right" }}>{_fmt(l.qty)} {l.unit}</td>
                <td className="num" style={{ padding: 10, textAlign: "right" }}>{_fmt(l.price, 2)}</td>
                <td className="num" style={{ padding: 10, textAlign: "right", fontWeight: 500 }}>{_fmt(l.amount, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", marginTop: 14 }}>
          <div className="spacer"/>
          <div style={{ width: 260 }}>
            <RowKV k="รวมเป็นเงิน" v={_fmt(po.subtotal, 2)}/>
            <RowKV k="ภาษีมูลค่าเพิ่ม 7%" v={_fmt(po.vat, 2)}/>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 8px", marginTop: 6, background: "var(--text-primary)", color: "var(--bg-elevated)", borderRadius: 6 }}>
              <span style={{ fontWeight: 500 }}>{po.whtRate > 0 ? "รวมเงิน (รวม VAT)" : "รวมทั้งสิ้น"}</span>
              <span className="num" style={{ fontWeight: 600 }}>{baht(po.total, 2)}</span>
            </div>
            {po.whtRate > 0 && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 8px", fontSize: 12, color: "var(--amber)" }}>
                  <span>หัก ณ ที่จ่าย {po.whtRate}%</span>
                  <span className="num">({_fmt(whtAmount(po.subtotal, po.whtRate), 2)})</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 8px", marginTop: 2, background: "var(--success-subtle)", border: "1px solid var(--success)", color: "var(--success)", borderRadius: 6 }}>
                  <span style={{ fontWeight: 600 }}>ยอดจ่ายสุทธิ</span>
                  <span className="num" style={{ fontWeight: 700 }}>{baht(po.total - whtAmount(po.subtotal, po.whtRate), 2)}</span>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 6, lineHeight: 1.5 }}>
                  * ออกหนังสือรับรองหักภาษี ณ ที่จ่าย (ภงด.53) ให้ Supplier
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RowKV({ k, v }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 8px", fontSize: 12 }}>
      <span style={{ color: "var(--text-secondary)" }}>{k}</span>
      <span className="num">{v}</span>
    </div>
  );
}

function SupplierDetail({ s }) {
  const supPOs = PURCHASE_ORDERS.filter((p) => p.supplier === s.code);
  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, background: "var(--bg-subtle)", borderRadius: 12, marginBottom: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: 12, background: "var(--accent-subtle)", color: "var(--accent)", display: "grid", placeItems: "center", fontWeight: 700, fontFamily: "var(--font-sans)" }}>
          {s.code.slice(0, 2)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{s.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.category} · {s.taxId}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          {s.status === "inactive" && <div><span className="badge badge-neutral">ปิดใช้งาน</span></div>}
          {!!s.rating && <><div style={{ fontSize: 18, fontWeight: 700, color: "#F59E0B" }}>★ {s.rating}</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Supplier rating</div></>}
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <KV k="ผู้ติดต่อ" v={s.contact}/>
        <KV k="โทร" v={s.phone}/>
        <KV k="อีเมล" v={s.email}/>
        <KV k="เครดิตเทอม" v={s.credit + " วัน"}/>
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 4 }}>ที่อยู่</div>
        <div style={{ fontSize: 13 }}>{s.address}</div>
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        {(() => { const ps = PURCHASE_ORDERS.filter((p) => p.status !== "cancelled" && (p.supplier === s.code || p.supplierName === s.name)); const sum = ps.reduce((t, p) => t + p.total, 0); return (<>
          <Mini k="ใบสั่งซื้อทั้งหมด" v={ps.length}/>
          <Mini k="ยอดจัดซื้อ" v={baht(sum)}/>
          <Mini k="เฉลี่ย/PO" v={baht(ps.length ? sum / ps.length : 0)}/>
        </>); })()}
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">ประวัติ PO</div></div>
        <table className="table">
          <thead><tr><th>เลขที่</th><th>วันที่</th><th className="num">มูลค่า</th><th>สถานะ</th></tr></thead>
          <tbody>
            {supPOs.map((p) => (
              <tr key={p.id}>
                <td className="mono"><b>{p.id}</b></td>
                <td className="num" style={{ fontSize: 12 }}>{p.date}</td>
                <td className="num" style={{ fontWeight: 500 }}>{baht(p.total)}</td>
                <td><span className={"badge badge-" + PO_STATUS[p.status].color}>{PO_STATUS[p.status].th}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* รหัส/เลขภาษีเทียบแบบไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่าง (ตรงกับกติกาฝั่ง backend) */
const supKey = (v) => String(v == null ? "" : v).replace(/\s+/g, "").toUpperCase();
const SUP_CATEGORIES = ["เม็ดพลาสติก", "สีผสม", "แม่พิมพ์ / ซ่อม", "บรรจุภัณฑ์", "บริการเครื่องจักร", "เหล็ก", "อื่น ๆ"];

function SupplierForm({ mode, rec, onCancel, onDone }) {
  const editing = mode === "edit";
  // PO ที่อ้างอิงรหัสนี้แล้ว → ล็อกรหัส (backend ล็อกด้วยเช่นกัน)
  const poRefs = editing ? PURCHASE_ORDERS.filter((p) => supKey(p.supplier) === supKey(rec.code)).length : 0;
  const locked = editing && poRefs > 0;
  const [form, setForm] = useState(editing ? {
    code: rec.code || "", name: rec.name || "", taxId: rec.taxId === "—" ? "" : (rec.taxId || ""), contact: rec.contact || "", phone: rec.phone || "",
    email: rec.email || "", category: rec.category || SUP_CATEGORIES[0], credit: String(rec.credit == null ? 30 : rec.credit), address: rec.address || "", payeeType: rec.payeeType === "individual" ? "individual" : "juristic", foreign: !!rec.foreign, country: rec.country || "",
  } : { code: "", name: "", taxId: "", contact: "", phone: "", email: "", category: SUP_CATEGORIES[0], credit: "30", address: "", payeeType: "juristic", foreign: false, country: "" });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const code = form.code.trim().toUpperCase();
  const credit = form.credit === "" ? 0 : Number(form.credit);
  const codeChanged = editing && supKey(code) !== supKey(rec.code);
  const codeConflictFor = (selfId) => {
    const o = Store.state.suppliers.find((x) => x.id !== selfId && supKey(x.code) === supKey(code));
    return o ? `รหัสนี้ซ้ำกับ Supplier ${o.code} · ${o.name}` : null;
  };
  const conflict = (!editing || codeChanged) && code ? codeConflictFor(editing ? rec.id : null) : null;
  const taxKey = supKey(form.taxId);
  const taxDup = taxKey.length > 0 ? Store.state.suppliers.find((x) => (!editing || x.id !== rec.id) && supKey(x.taxId) === taxKey) : null;
  const errors = [];
  if (!code) errors.push("กรุณาระบุรหัส Supplier");
  else if (!/^[A-Z0-9][A-Z0-9._\-\/]*$/.test(code)) errors.push("รหัสใช้ได้เฉพาะ A-Z 0-9 . _ - / และห้ามมีช่องว่าง");
  if (conflict) errors.push(conflict);
  if (!form.name.trim()) errors.push("กรุณาระบุชื่อ Supplier");
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.push("รูปแบบอีเมลไม่ถูกต้อง");
  if (!(Number.isInteger(credit) && credit >= 0)) errors.push("เครดิตต้องเป็นจำนวนวันเต็มที่ไม่ติดลบ");
  if (form.foreign && !form.country.trim()) errors.push("ผู้ขายต่างประเทศ: กรุณาระบุประเทศ");
  const cats = SUP_CATEGORIES.includes(form.category) ? SUP_CATEGORIES : [form.category, ...SUP_CATEGORIES];
  const showErr = errors.length > 0 && (form.code || form.name || form.email);

  function submit(e) {
    e.preventDefault();
    if (saving || errors.length) return;
    setSaving(true);
    const ok = runAction(() => Store.tx(editing ? "editSupplier" : "createSupplier", () => {
      const clean = {
        name: form.name.trim(), taxId: form.taxId.trim() || "—", contact: form.contact.trim(), phone: form.phone.trim(),
        email: form.email.trim(), category: form.category, credit, address: form.address.trim(), payeeType: form.payeeType,
        foreign: !!form.foreign, country: form.foreign ? form.country.trim() : "",
      };
      if (!editing) {
        const c = codeConflictFor(null); // ตรวจซ้ำอีกครั้งในธุรกรรม (ข้อมูลล่าสุด)
        if (c) Store.fail(c);
        const n = Store.state.suppliers.length + 1;
        const s = { id: "SUP-" + String(n).padStart(3, "0") + "-" + Date.now().toString().slice(-4), code, ...clean, rating: 0, status: "active" };
        Store.add("suppliers", s, `${code} · ${clean.name}`);
        return s;
      }
      const s = Store.find("suppliers", rec.id);
      if (!s) Store.fail("ไม่พบ Supplier");
      const patch = { ...clean };
      if (supKey(code) !== supKey(s.code)) {
        const used = PURCHASE_ORDERS.filter((p) => supKey(p.supplier) === supKey(s.code)).length;
        if (used > 0) Store.fail("รหัสนี้ถูกอ้างอิงในใบสั่งซื้อแล้ว ไม่สามารถเปลี่ยนได้");
        const c = codeConflictFor(s.id);
        if (c) Store.fail(c);
        patch.code = code;
      }
      const diff = Object.keys(patch).filter((k) => JSON.stringify(s[k]) !== JSON.stringify(patch[k]))
        .map((k) => `${k}: ${s[k] == null ? "—" : s[k]}→${patch[k]}`);
      return Store.update("suppliers", s.id, patch, "id", diff.length ? "แก้ไข: " + diff.join(", ") : "ไม่มีการเปลี่ยนแปลง");
    }), editing ? `แก้ไข ${code} แล้ว` : `เพิ่ม Supplier ${code} แล้ว`);
    if (ok) onDone(editing ? `แก้ไข Supplier ${code} เรียบร้อย` : `เพิ่ม Supplier ${code} เรียบร้อย`);
    else setSaving(false);
  }

  return (
    <form onSubmit={submit} style={{ padding: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="field-label">รหัส Supplier *</label>
          <input className="input" style={{ fontFamily: "var(--font-mono)" }} placeholder="เช่น HMC" value={form.code} disabled={locked}
            onChange={(e) => set("code", e.target.value)}/>
          {locked && <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>ถูกอ้างอิงใน PO แล้ว ({poRefs} ใบ) — เปลี่ยนรหัสไม่ได้ (แก้ชื่อและข้อมูลติดต่อได้)</div>}
        </div>
        <div>
          <label className="field-label">หมวดหมู่</label>
          <select className="select" value={form.category} onChange={(e) => set("category", e.target.value)}>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={form.foreign} onChange={(e) => set("foreign", e.target.checked)}/> ผู้ขายต่างประเทศ (ไม่ได้จดทะเบียน VAT ในไทย — เช่น เช่าเซิร์ฟเวอร์/ซอฟต์แวร์ต่างประเทศ)
          </label>
          {form.foreign && <input className="input" style={{ width: 180 }} placeholder="ประเทศ เช่น สหรัฐอเมริกา" value={form.country} onChange={(e) => set("country", e.target.value)}/>}
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label className="field-label">ชื่อ Supplier *</label>
          <input className="input" placeholder="เช่น บริษัท เอชเอ็มซี โพลิเมอร์ส จำกัด" value={form.name} onChange={(e) => set("name", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">เลขผู้เสียภาษี</label>
          <input className="input" style={{ fontFamily: "var(--font-mono)" }} placeholder="13 หลัก" value={form.taxId} onChange={(e) => set("taxId", e.target.value)}/>
          {taxDup && <div style={{ fontSize: 11.5, color: "#B45309", marginTop: 4 }}>⚠ เลขผู้เสียภาษีนี้ตรงกับ {taxDup.code} · {taxDup.name} (บันทึกได้ — อาจเป็นคนละสาขา)</div>}
        </div>
        <div>
          <label className="field-label">ประเภทผู้รับเงิน (ใช้ออกหนังสือหัก ณ ที่จ่าย)</label>
          <select className="select" value={form.payeeType} onChange={(e) => set("payeeType", e.target.value)}>
            <option value="juristic">นิติบุคคล (ภ.ง.ด.53)</option>
            <option value="individual">บุคคลธรรมดา (ภ.ง.ด.3)</option>
          </select>
        </div>
        <div>
          <label className="field-label">เครดิต (วัน)</label>
          <input type="number" min="0" step="1" className="input num" value={form.credit} onChange={(e) => set("credit", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">ผู้ติดต่อ</label>
          <input className="input" value={form.contact} onChange={(e) => set("contact", e.target.value)}/>
        </div>
        <div>
          <label className="field-label">เบอร์โทรศัพท์</label>
          <input className="input" value={form.phone} onChange={(e) => set("phone", e.target.value)}/>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label className="field-label">อีเมล</label>
          <input className="input" placeholder="name@company.com" value={form.email} onChange={(e) => set("email", e.target.value)}/>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label className="field-label">ที่อยู่</label>
          <textarea className="input" rows={2} value={form.address} onChange={(e) => set("address", e.target.value)}/>
        </div>
      </div>
      {showErr && (
        <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: "var(--danger-subtle, #fdecea)", color: "var(--danger)", fontSize: 12.5 }}>
          {errors.map((m, i) => <div key={i}>• {m}</div>)}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-outline" onClick={onCancel}>ยกเลิก</button>
        <button type="submit" className="btn btn-primary" disabled={saving || errors.length > 0}><I.Check size={14}/> {editing ? "บันทึกการแก้ไข" : "บันทึก Supplier"}</button>
      </div>
    </form>
  );
}

function KV({ k, v }) {
  return <div><div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{k}</div><div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{v}</div></div>;
}
function Mini({ k, v }) {
  return <div style={{ background: "var(--bg-subtle)", borderRadius: 10, padding: 12 }}>
    <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{k}</div>
    <div className="num" style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{v}</div>
  </div>;
}
function Stat({ icon, tone, label, value, unit, foot }) {
  const Ico = I[icon] || I.Wallet;
  const c = ({ accent: { c:"var(--accent)", b:"var(--accent-subtle)" }, amber: { c:"var(--amber)", b:"var(--amber-subtle)" }, success: { c:"var(--success)", b:"var(--success-subtle)" }, violet: { c:"var(--violet)", b:"var(--violet-subtle)" } })[tone];
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="kpi-label"><span className="kpi-ico" style={{ background: c.b, color: c.c }}><Ico size={14}/></span>{label}</div>
      <div className="kpi-value">{value}{unit && <span className="kpi-unit"> {unit}</span>}</div>
      <div className="kpi-foot" style={{ marginTop: 6 }}>{foot}</div>
    </div>
  );
}

window.PageProcurement = PageProcurement;
