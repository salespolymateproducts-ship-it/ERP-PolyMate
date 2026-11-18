/* global React, I, Store */
/* PolyMate ERP — UI helpers ที่ใช้ร่วมกันทุกหน้า: Toast, Modal, ช่องกรอกเหตุผล, ส่งออก CSV, พิมพ์ */

// ---------- Toast (แจ้งผล) ----------
const _toastSubs = new Set();
let _toasts = [];
function notify(msg, kind = "success", link) {
  const t = { id: Math.random().toString(36).slice(2), msg, kind, link };
  _toasts = [..._toasts, t];
  _toastSubs.forEach((f) => f(_toasts));
  setTimeout(() => { _toasts = _toasts.filter((x) => x.id !== t.id); _toastSubs.forEach((f) => f(_toasts)); }, kind === "error" ? 6000 : 3800);
}
function ToastHost() {
  const [list, setList] = React.useState(_toasts);
  React.useEffect(() => { _toastSubs.add(setList); return () => _toastSubs.delete(setList); }, []);
  const color = { success: "var(--success)", error: "var(--danger)", info: "var(--accent)", warn: "var(--amber)" };
  return (
    <div className="no-print" style={{ position: "fixed", right: 18, bottom: 18, zIndex: 2000, display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}>
      {list.map((t) => (
        <div key={t.id} role="status" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderLeft: `4px solid ${color[t.kind] || color.info}`,
          borderRadius: 10, boxShadow: "var(--shadow-lg)", padding: "10px 14px", fontSize: 13, display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ flex: 1, whiteSpace: "pre-line" }}>{t.msg}</span>
          {t.link && <button className="btn btn-outline btn-sm" onClick={t.link.onClick}>{t.link.label}</button>}
        </div>
      ))}
    </div>
  );
}
// เรียก action ของระบบ: แสดงข้อผิดพลาดจาก validation ให้ผู้ใช้เห็น ไม่เงียบ
function runAction(fn, successMsg) {
  try {
    const r = fn();
    if (successMsg) notify(typeof successMsg === "function" ? successMsg(r) : successMsg, "success");
    return r;
  } catch (e) {
    notify(e && e.message ? e.message : String(e), "error");
    if (!(e instanceof Store.ERPError)) console.error(e);
    return undefined;
  }
}

// ---------- Modal ----------
function ErpModal({ title, onClose, children, footer, width = 540 }) {
  React.useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="no-print" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 1000, padding: 16 }}>
      <div className="card" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: width, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="ปิด"><I.X size={16}/></button>
        </div>
        <div style={{ padding: 18, overflow: "auto", flex: 1 }}>{children}</div>
        {footer && <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>{footer}</div>}
      </div>
    </div>
  );
}

// กล่องขอเหตุผล (ยกเลิก / ตีกลับ / แก้ไขเอกสารอนุมัติแล้ว)
function ReasonModal({ title, label, confirmLabel = "ยืนยัน", danger, onConfirm, onClose, hint }) {
  const [v, setV] = React.useState("");
  return (
    <ErpModal title={title} onClose={onClose} width={460}
      footer={<>
        <button className="btn btn-outline btn-sm" onClick={onClose}>ปิด</button>
        <button className={"btn btn-sm " + (danger ? "btn-danger" : "btn-primary")} disabled={!v.trim()} onClick={() => onConfirm(v.trim())}>{confirmLabel}</button>
      </>}>
      {hint && <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 10 }}>{hint}</div>}
      <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>{label || "เหตุผล"} <span style={{ color: "var(--danger)" }}>*</span></label>
      <textarea className="input" autoFocus rows={3} style={{ width: "100%", marginTop: 6, height: "auto", padding: 8 }} value={v} onChange={(e) => setV(e.target.value)}/>
      <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 6 }}>บันทึกผู้ดำเนินการ ({Store.userName()}) และวันเวลาอัตโนมัติ</div>
    </ErpModal>
  );
}

// ---------- ส่งออก CSV (Excel อ่านภาษาไทยได้ด้วย BOM) ----------
function exportCSV(filename, header, rows) {
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  Store.tx("exportCSV", () => Store.log("EXPORT", "รายงาน", filename, `ส่งออก ${rows.length} แถว`));
}

// ---------- พิมพ์ / บันทึก PDF ขนาด A4 ----------
// คัดลอกเอกสาร (.print-area ล่าสุด หรือพื้นที่เนื้อหาหน้า .content สำหรับรายงาน) ไปไว้ใน #print-root
// ซึ่งอยู่นอก Drawer/Modal ที่มี scroll — จึงพิมพ์หลายหน้าได้ครบ ไม่ถูกตัดที่ความสูงหน้าจอ
// opts: { source: ".content" | element, orientation: "portrait" | "landscape", title }
function printDoc(docId, opts) {
  opts = opts || {};
  setTimeout(() => {
    let src = opts.source && typeof opts.source !== "string" ? opts.source : null;
    if (!src && opts.source) src = document.querySelector(opts.source);
    if (!src) { const areas = Array.from(document.querySelectorAll(".print-area")).filter((a) => !a.closest("#print-root")); src = areas[areas.length - 1]; }
    const isReport = !src || !src.classList.contains("print-area");
    if (!src) src = document.querySelector(".content");
    if (!src) { window.print(); return; }
    const orientation = opts.orientation || (isReport ? "landscape" : "portrait");

    let root = document.getElementById("print-root");
    if (!root) { root = document.createElement("div"); root.id = "print-root"; document.body.appendChild(root); }
    root.innerHTML = "";
    root.className = "print-" + orientation + (isReport ? " print-report" : " print-document");

    const sheet = src.cloneNode(true);
    sheet.classList.remove("print-area");
    sheet.classList.add("print-sheet");
    // ค่าที่ผู้ใช้เลือก (select / input) → แปลงเป็นข้อความ เพื่อให้ปรากฏบนกระดาษ
    const oSel = src.querySelectorAll("select"), cSel = sheet.querySelectorAll("select");
    cSel.forEach((s, i) => { const o = oSel[i]; const sp = document.createElement("span"); sp.className = "print-value";
      sp.textContent = o && o.selectedIndex >= 0 ? o.options[o.selectedIndex].text : ""; s.replaceWith(sp); });
    const oIn = src.querySelectorAll("input, textarea"), cIn = sheet.querySelectorAll("input, textarea");
    cIn.forEach((s, i) => { const o = oIn[i];
      if (!o || o.type === "checkbox" || o.type === "radio" || o.type === "search") { s.remove(); return; }
      // ช่องว่างในเอกสาร (เช่น จำนวนผลิตในใบสั่งผลิต) → เส้นให้กรอกด้วยมือ · ในรายงาน → ตัดออก
      if (!o.value) { if (isReport) s.remove(); else { const bl = document.createElement("span"); bl.className = "print-blank"; s.replaceWith(bl); } return; }
      const sp = document.createElement("span"); sp.className = "print-value"; sp.textContent = o.value; s.replaceWith(sp); });
    sheet.querySelectorAll("button, .no-print, .erp-search").forEach((b) => b.remove());

    if (isReport) {
      const head = document.createElement("div");
      head.className = "print-report-head";
      const company = (window.COMPANY && window.COMPANY.nameTh) || "";
      const title = opts.title || (document.querySelector(".content h1, .content .page-title") || {}).textContent || "รายงาน";
      head.innerHTML = '<div><b></b><div class="prh-sub"></div></div><div class="prh-meta"></div>';
      head.querySelector("b").textContent = title;
      head.querySelector(".prh-sub").textContent = company;
      head.querySelector(".prh-meta").textContent = "พิมพ์เมื่อ " + fmtDateTime(new Date()) +" · โดย " + (Store.userName ? Store.userName() : "");
      root.appendChild(head);
    }
    root.appendChild(sheet);
    // เอกสารที่ต้องมีสำเนา (data-copies="2"): พิมพ์ต้นฉบับ แล้วตามด้วยสำเนาในหน้าใหม่ ป้ายมุมขวาบนเปลี่ยนเป็น "สำเนา"
    if (!isReport && sheet.dataset.copies === "2") {
      const copy = sheet.cloneNode(true);
      copy.querySelectorAll(".copy-mark").forEach((m) => { m.textContent = sheet.dataset.copyLabel2 || "สำเนา"; });
      copy.style.breakBefore = "page"; copy.style.pageBreakBefore = "always";
      root.appendChild(copy);
    }

    // ขนาดกระดาษ A4 + หัว/ท้ายกระดาษ (เลขที่เอกสาร · เลขหน้า) — กำหนดใหม่ทุกครั้งตามแนวกระดาษ
    let st = document.getElementById("print-page-style");
    if (!st) { st = document.createElement("style"); st.id = "print-page-style"; document.head.appendChild(st); }
    const q = (s) => '"' + String(s || "").replace(/["\\\n]/g, " ") + '"';
    const label = docId || opts.title || "";
    // opts.pageMargin: ขอบกระดาษเฉพาะเอกสาร (เช่น แบบฟอร์มทางการที่ต้องใช้พื้นที่เต็มหน้า) · opts.bare: ไม่พิมพ์หัว/ท้ายกระดาษ
    const font = ' font-size: 8pt; color: #8B93A4; font-family: "IBM Plex Sans Thai", "Noto Sans Thai", Tahoma, sans-serif;';
    st.textContent = "@page { size: A4 " + orientation + "; margin: " + (opts.pageMargin || "12mm 12mm 14mm 12mm") + ";"
      + (opts.bare ? "" : " @top-right { content: " + q(label) + ";" + font + " }"
      + " @bottom-left { content: " + q((window.COMPANY && window.COMPANY.nameTh) || "PolyMate ERP") + ";" + font + " }"
      + " @bottom-right { content: \"หน้า \" counter(page) \" / \" counter(pages);" + font + " }") + " }";

    document.body.classList.add("printing");
    const done = () => { document.body.classList.remove("printing"); root.innerHTML = ""; window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    if (docId) Store.tx("print", () => Store.log("PRINT", "เอกสาร", docId, "พิมพ์ / PDF (A4 " + orientation + ")"));
    const imgs = Array.from(root.querySelectorAll("img")).filter((im) => !im.complete);
    Promise.all(imgs.map((im) => new Promise((r) => { im.onload = im.onerror = r; }))).then(() => window.print());
  }, 80);
}
// พิมพ์รายงานทั้งหน้า (เนื้อหาในพื้นที่ .content) เป็น A4 แนวนอน
function printReport(title, orientation) { printDoc(null, { source: ".content", title, orientation: orientation || "landscape" }); }

// หัวกระดาษสำหรับเอกสารที่หน้าจอไม่มีหัวบริษัท (ใบสั่งผลิต, ใบตรวจ QC) — แสดงเฉพาะตอนพิมพ์
function PrintHead({ title, en, no, date }) {
  const C = window.COMPANY || {};
  return (
    <div className="print-only" style={{ display: "flex", gap: 12, alignItems: "center", borderBottom: "2px solid #0B1220", paddingBottom: 10, marginBottom: 12 }}>
      <img src="assets/polymate-logo.png" alt="PolyMate" style={{ width: 42, height: 42, objectFit: "contain" }}/>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{C.nameTh}</div>
        <div style={{ fontSize: 10, color: "#4B5468" }}>{C.address}{C.taxId ? " · เลขประจำตัวผู้เสียภาษี " + C.taxId : ""}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 10, color: "#4B5468" }}>{en}</div>
        <div className="mono" style={{ fontWeight: 600, marginTop: 4 }}>{no}</div>
        {date && <div style={{ fontSize: 10, color: "#4B5468" }}>{date}</div>}
      </div>
    </div>
  );
}

function EmptyRow({ cols, text }) {
  return <tr><td colSpan={cols} style={{ textAlign: "center", padding: 40, color: "var(--text-tertiary)" }}>{text}</td></tr>;
}

// ---------- ตัวเลขบนเมนู (คำนวณจากข้อมูลจริง) ----------
function _maintDue(m) { return m.status === "maintenance" || m.status === "alert" || (m.life && m.shots / m.life >= 0.9); }
function navCount(id) {
  const s = Store.state;
  const n = (v, alert) => (v ? { v, alert: !!alert } : null);
  const salesTypes = ["QT", "SO", "DO", "INV", "BN", "RC", "PAY"];
  switch (id) {
    case "sales": return n(s.docs.filter((d) => salesTypes.includes(d.type) && d.status === "pending").length, true);
    case "customer-po": return n(s.docs.filter((d) => d.type === "CPO" && ["pending", "approved", "partial"].includes(d.status)).length);
    case "customers": return n(s.customers.length);
    case "production": return n(s.workOrders.filter((w) => !["done", "cancelled"].includes(w.status)).length);
    case "molds": return n(s.molds.filter(_maintDue).length, true);
    case "inventory": return n(s.materials.filter((m) => m.active !== false && m.stock < m.min).length, true);
    case "procurement": return n(s.purchaseOrders.filter((p) => !["received", "cancelled"].includes(p.status)).length);
    case "shipping": return n(s.docs.filter((d) => d.type === "DO" && Workflow.isLive(d) && (!d.ship || d.ship.status !== "delivered")).length);
    case "qc": return n(s.workOrders.filter((w) => w.produced > 0 && !s.qc.some((q) => q.wo === w.id)).length, true);
    default: return null;
  }
}

// ---------- การแจ้งเตือน (สิ่งที่ต้องดำเนินการ จากข้อมูลจริง) ----------
function buildNotifications(role) {
  const s = Store.state, today = Store.today();
  const can = (p) => role && (role.pages === "*" || role.pages.includes(p));
  const out = [];
  s.docs.filter((d) => d.status === "pending" && Workflow.canApproveType(d.type)).forEach((d) =>
    out.push({ id: "ap" + d.id, kind: "info", icon: "FileText", title: `รออนุมัติ: ${DOC_LABEL[d.type].th} ${d.id} · ${d.customerName}`, time: d.updatedAt, page: d.type === "CPO" ? "customer-po" : "sales", focus: { doc: d.id } }));
  // ใบสั่งผลิตที่เปิดอยู่แต่วัตถุดิบไม่พอ → แจ้งทั้งฝ่ายผลิตและฝ่ายจัดซื้อ (ยอดรวมทุกใบสั่งผลิตที่เปิดอยู่ − สต๊อก − ที่สั่งซื้อไว้แล้ว)
  const woPage = can("production") ? "production" : "procurement";
  s.workOrders.filter((w) => ["queued", "setup", "running"].includes(w.status)).forEach((w) => {
    const sh = Store.woShortage(w);
    if (!sh.hasBom) return;
    if (sh.anyShort) {
      const items = sh.rows.filter((r) => r.short > 0.0005).map((r) => `${r.code} ขาดรวม ${_fmt(Math.ceil(r.short), 0)} ${r.unit}`).join(", ");
      out.push({ id: "ws" + w.id, kind: "alert", icon: "Boxes",
        title: `ใบสั่งผลิต ${w.id} ขาดวัตถุดิบ: ${items} (รวมทุกใบสั่งผลิตที่เปิดอยู่) — ผลิตได้ก่อน ${_fmt(sh.maxPieces)} จาก ${_fmt(sh.remaining)} ชิ้น · ยังไม่ได้สั่งซื้อ` + (sh.orders.length ? ` (มีใบสั่งซื้อ ${sh.orders.join(", ")} แต่ยังไม่พอ)` : ""),
        time: "ต้องเพิ่มสต๊อก", page: woPage, focus: { wo: w.id } });
    } else if (sh.anyWait) {
      out.push({ id: "ww" + w.id, kind: "warning", icon: "Truck",
        title: `ใบสั่งผลิต ${w.id} รอรับวัตถุดิบตามใบสั่งซื้อ ${sh.orders.join(", ")} — ผลิตได้ก่อน ${_fmt(sh.maxPieces)} จาก ${_fmt(sh.remaining)} ชิ้น`,
        time: "รอรับของ", page: woPage, focus: { wo: w.id } });
    } else if (["queued", "setup"].includes(w.status) && s.purchaseOrders.some((p) => p.status === "received" && (p.ref === w.id || (p.forWo || []).includes(w.id)))) {
      out.push({ id: "wr" + w.id, kind: "info", icon: "Factory", title: `ใบสั่งผลิต ${w.id} พร้อมผลิตแล้ว — วัตถุดิบครบหลังรับของตามใบสั่งซื้อ`, time: "พร้อมผลิต", page: woPage, focus: { wo: w.id } });
    }
  });
  s.docs.filter((d) => d.type === "INV" && Workflow.isLive(d)).forEach((d) => {
    const p = Workflow.paymentInfo(d);
    if (p.overdue) out.push({ id: "od" + d.id, kind: "alert", icon: "Wallet", title: `เกินกำหนดชำระ: ${d.id} ${d.customerName} ค้าง ${_fmt(p.outstanding, 2)} บาท`, time: "ครบกำหนด " + d.due, page: "sales", focus: { doc: d.id } });
  });
  s.materials.filter((m) => m.active !== false && m.stock < m.min).forEach((m) =>
    out.push({ id: "ls" + m.id, kind: "warning", icon: "Boxes", title: `วัตถุดิบต่ำกว่าจุดสั่งซื้อ: ${m.code} เหลือ ${_fmt(m.stock)} ${m.unit} (ขั้นต่ำ ${_fmt(m.min)})`, time: "สต๊อก", page: "inventory" }));
  // ใบเสร็จที่ลูกค้าหัก ณ ที่จ่าย แต่ยังไม่ได้รับหนังสือรับรอง (50 ทวิ) เกินกำหนด
  if (Store.user() && ["admin", "accounting"].includes(Store.user().role)) s.docs.forEach((d) => {
    const w = Workflow.whtCertStatus(d);
    if (w && w.state === "pending" && w.overdue) out.push({ id: "wc" + d.id, kind: "warning", icon: "Wallet", title: `รอหนังสือรับรองหัก ณ ที่จ่ายจาก ${d.customerName}: ใบเสร็จ ${d.id} ภาษี ${_fmt(d.wht, 2)} บาท รอมา ${w.days} วัน`, time: "บัญชี", page: "accounting" });
  });
  // สินค้าซื้อมาขายไป: ต่ำกว่าจุดสั่งซื้อ และใบสั่งขายที่รอสินค้าเข้า
  s.finished.filter((f) => Store.isBuyable(f) && f.active !== false).forEach((f) => {
    const incoming = Store.productOnOrder(f.id);
    if (f.min > 0 && f.stock < f.min) {
      out.push({ id: "lf" + f.id, kind: "warning", icon: "Boxes", title: `สินค้าซื้อมาขายต่ำกว่าจุดสั่งซื้อ: ${f.code} เหลือ ${_fmt(f.stock)} ${f.unit || ""} (ขั้นต่ำ ${_fmt(f.min)})` + (incoming > 0 ? ` · สั่งซื้อแล้ว ${_fmt(incoming)}` : " · ยังไม่ได้สั่งซื้อ"), time: "สต๊อก", page: "inventory" });
    }
    const pos = Store.productPosition(f);
    if (pos.short > 0.0005) {
      out.push({ id: "so" + f.id, kind: "alert", icon: "Truck", title: `ใบสั่งขายรอสินค้า ${f.code}: ขาดรวม ${_fmt(Math.ceil(pos.short))} ${f.unit || ""} (ต้องส่ง ${_fmt(pos.demand)} มี ${_fmt(pos.stock)}) — ${pos.docs.join(", ")} · ยังไม่ได้สั่งซื้อ`, time: "ต้องสั่งซื้อ", page: "sales" });
    } else if (pos.deficit > 0.0005) {
      out.push({ id: "sw" + f.id, kind: "warning", icon: "Truck", title: `ใบสั่งขายรอสินค้า ${f.code} ตามใบสั่งซื้อที่สั่งไว้ (${_fmt(pos.incoming)} ${f.unit || ""}) — ${pos.docs.join(", ")}`, time: "รอรับของ", page: "sales" });
    }
  });
  // สินค้าผลิตเอง (เช่น OEM): ใบสั่งขายที่รอสินค้า แต่สต๊อกไม่พอ/ยังไม่มีใบสั่งผลิตรองรับ
  s.finished.filter((f) => !Store.isBuyable(f) && f.active !== false).forEach((f) => {
    const pos = Store.productPosition(f);
    if (pos.short > 0.0005) {
      out.push({ id: "so" + f.id, kind: "alert", icon: "Factory", title: `ใบสั่งขายรอสินค้า ${f.code}: ขาดรวม ${_fmt(Math.ceil(pos.short))} ${f.unit || ""} (ต้องส่ง ${_fmt(pos.demand)} มี ${_fmt(pos.stock)}) — ${pos.docs.join(", ")} · ยังไม่มีใบสั่งผลิตรองรับ`, time: "ต้องเปิดใบสั่งผลิต", page: "sales", focus: { doc: pos.docs.find((x) => String(x).startsWith("SO")) || pos.docs[0] } });
    } else if (pos.deficit > 0.0005) {
      out.push({ id: "sw" + f.id, kind: "warning", icon: "Factory", title: `ใบสั่งขายรอสินค้า ${f.code} ตามใบสั่งผลิตที่เปิดไว้ (${_fmt(pos.incoming)} ${f.unit || ""}) — ${pos.docs.join(", ")}`, time: "รอผลิต", page: "sales", focus: { doc: pos.docs.find((x) => String(x).startsWith("SO")) || pos.docs[0] } });
    }
  });
  (s.machines || []).filter((m) => m.condition !== "retired").forEach((m) => {
    const pm = Store.machinePM(m);
    if (m.condition === "maintenance") {
      out.push({ id: "mm" + m.id, kind: "warning", icon: "Wrench", title: `เครื่อง ${m.id} อยู่ระหว่างซ่อมบำรุง${m.conditionReason ? ": " + m.conditionReason : ""} — รับงานไม่ได้`, time: "เครื่องจักร", page: "production" });
    } else if (m.condition === "due") {
      out.push({ id: "mc" + m.id, kind: "alert", icon: "Wrench", title: `เครื่อง ${m.id} ควรซ่อมบำรุง${m.conditionReason ? ": " + m.conditionReason : ""}`, time: "เครื่องจักร", page: "production" });
    } else if (pm.overdue) {
      out.push({ id: "mp" + m.id, kind: "alert", icon: "Wrench", title: `เครื่อง ${m.id} เลยรอบ PM ${-pm.daysLeft} วัน (ครบกำหนด ${pm.next})`, time: "เครื่องจักร", page: "production" });
    } else if (pm.soon) {
      out.push({ id: "mp" + m.id, kind: "warning", icon: "Wrench", title: `เครื่อง ${m.id} ใกล้ครบรอบ PM อีก ${pm.daysLeft} วัน (${pm.next})`, time: "เครื่องจักร", page: "production" });
    }
  });
  s.molds.filter(_maintDue).forEach((m) =>
    out.push({ id: "md" + m.id, kind: "alert", icon: "Wrench", title: `แม่พิมพ์ ${m.code} ต้องซ่อมบำรุง (${_fmt(m.shots)}/${_fmt(m.life)} shots)`, time: "แม่พิมพ์", page: "molds" }));
  s.workOrders.filter((w) => !["done", "cancelled"].includes(w.status) && w.due && w.due !== "—" && w.due < today).forEach((w) =>
    out.push({ id: "wo" + w.id, kind: "warning", icon: "Factory", title: `ใบสั่งผลิตเลยกำหนด: ${w.id} ${w.product} (${_fmt(w.produced)}/${_fmt(w.quantity)})`, time: "กำหนด " + w.due, page: "production" }));
  s.purchaseOrders.filter((p) => !["received", "cancelled"].includes(p.status) && p.expectedDate && p.expectedDate !== "—" && p.expectedDate < today).forEach((p) =>
    out.push({ id: "po" + p.id, kind: "warning", icon: "Truck", title: `ใบสั่งซื้อยังไม่ได้รับของ: ${p.id} ${p.supplierName}`, time: "กำหนดรับ " + p.expectedDate, page: "procurement" }));
  return out.filter((x) => can(x.page));
}

// ---------- ค้นหาทั้งระบบ ----------
function GlobalSearch({ onNav, role }) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const can = (p) => role && (role.pages === "*" || role.pages.includes(p));
  const s = Store.state;
  const term = q.trim().toLowerCase();
  const has = (...xs) => xs.join(" ").toLowerCase().includes(term);
  const res = [];
  if (term.length >= 2) {
    s.docs.filter((d) => has(d.id, d.customerName, d.customer, d.refNo)).slice(0, 8).forEach((d) =>
      res.push({ k: d.id, icon: "FileText", t: d.id, sub: `${DOC_LABEL[d.type].th} · ${d.customerName} · ${Workflow.statusInfo(d).th}`, page: d.type === "CPO" ? "customer-po" : "sales", focus: { doc: d.id } }));
    s.customers.filter((c) => has(c.code, c.name, c.nameEn, c.taxId)).slice(0, 4).forEach((c) =>
      res.push({ k: c.id, icon: "Users", t: c.name, sub: "ลูกค้า · " + c.code, page: "customers", focus: { customer: c.code } }));
    s.finished.filter((f) => has(f.code, f.name)).slice(0, 4).forEach((f) =>
      res.push({ k: f.id, icon: "Boxes", t: f.code + " · " + f.name, sub: `สินค้าสำเร็จรูป · คงเหลือ ${_fmt(f.stock)}`, page: "inventory" }));
    s.materials.filter((m) => has(m.code, m.name)).slice(0, 4).forEach((m) =>
      res.push({ k: m.id, icon: "Boxes", t: m.code + " · " + m.name, sub: `วัตถุดิบ · คงเหลือ ${_fmt(m.stock)} ${m.unit}`, page: "inventory" }));
    s.workOrders.filter((w) => has(w.id, w.product, w.customerName, w.soId)).slice(0, 4).forEach((w) =>
      res.push({ k: w.id, icon: "Factory", t: w.id + " · " + w.product, sub: "ใบสั่งผลิต · " + w.status, page: "production", focus: { wo: w.id } }));
    s.purchaseOrders.filter((p) => has(p.id, p.supplierName)).slice(0, 4).forEach((p) =>
      res.push({ k: p.id, icon: "Truck", t: p.id + " · " + p.supplierName, sub: "ใบสั่งซื้อ · " + p.status, page: "procurement" }));
  }
  const list = res.filter((r) => can(r.page));
  const go = (r) => { setOpen(false); setQ(""); onNav && onNav(r.page, r.focus); };
  return (
    <div className="topbar-search erp-search">
      <I.Search size={15} className="ts-ico"/>
      <input placeholder="ค้นหาเอกสาร, ลูกค้า, สินค้า, ใบสั่งผลิต…" aria-label="ค้นหาทั้งระบบ" value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.keyCode === 13) && list[0]) { e.preventDefault(); go(list[0]); } if (e.key === "Escape") setOpen(false); }}/>
      {open && term.length >= 2 && (
        <div className="erp-search-results">
          {list.map((r) => { const Ico = I[r.icon] || I.FileText; return (
            <div key={r.k} className="erp-search-item" onMouseDown={() => go(r)}>
              <Ico size={15} style={{ color: "var(--text-tertiary)" }}/>
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>{r.t}</div><div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{r.sub}</div></div>
            </div>); })}
          {!list.length && <div style={{ padding: 14, fontSize: 13, color: "var(--text-tertiary)" }}>ไม่พบ “{q}”</div>}
        </div>
      )}
    </div>
  );
}
// อ่านแล้วล้างเป้าหมายที่ต้องเปิด (จากการค้นหา/แจ้งเตือน)
function takeFocus(key) {
  const f = window.ERP_FOCUS;
  if (f && f[key]) { window.ERP_FOCUS = null; return f[key]; }
  return null;
}

function ChangePasswordModal({ onClose }) {
  const [a, setA] = React.useState(""); const [b, setB] = React.useState(""); const [c, setC] = React.useState("");
  const [err, setErr] = React.useState(""); const [busy, setBusy] = React.useState(false);
  async function save() {
    setErr("");
    if (b !== c) { setErr("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน"); return; }
    setBusy(true);
    try { await Store.changeOwnPassword(a, b); notify("เปลี่ยนรหัสผ่านแล้ว"); onClose(); } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  const lbl = { fontSize: 12, color: "var(--text-secondary)", display: "block", margin: "8px 0 4px" };
  return (
    <ErpModal title="เปลี่ยนรหัสผ่าน" width={420} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ปิด</button><button className="btn btn-primary btn-sm" disabled={busy || b.length < 8} onClick={save}>บันทึก</button></>}>
      <label style={lbl} htmlFor="cp-a">รหัสผ่านปัจจุบัน</label><input id="cp-a" className="input" type="password" autoComplete="current-password" value={a} onChange={(e) => setA(e.target.value)}/>
      <label style={lbl} htmlFor="cp-b">รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</label><input id="cp-b" className="input" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)}/>
      <label style={lbl} htmlFor="cp-c">ยืนยันรหัสผ่านใหม่</label><input id="cp-c" className="input" type="password" autoComplete="new-password" value={c} onChange={(e) => setC(e.target.value)}/>
      {err && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{err}</div>}
    </ErpModal>
  );
}

Object.assign(window, { notify, ToastHost, runAction, ErpModal, ReasonModal, exportCSV, printDoc, printReport, PrintHead, EmptyRow,
  navCount, buildNotifications, GlobalSearch, ChangePasswordModal, takeFocus });

// ป้องกันหน้าใดหน้าหนึ่งพังแล้วทั้งแอปหายไป — แสดงข้อผิดพลาดเฉพาะหน้านั้น
class PageErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { try { Store.tx("pageError", () => Store.log("ERROR", "ระบบ", "UI", String(err && err.message).slice(0, 200))); } catch (e) { /* ignore */ } }
  render() {
    if (this.state.err) return (
      <div className="card" style={{ padding: 32 }}>
        <div style={{ fontWeight: 600, color: "var(--danger)", marginBottom: 8 }}>หน้านี้เกิดข้อผิดพลาด</div>
        <div className="mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>{String(this.state.err.message || this.state.err)}</div>
        <button className="btn btn-outline btn-sm" style={{ marginTop: 14 }} onClick={() => this.setState({ err: null })}>ลองอีกครั้ง</button>
      </div>
    );
    return this.props.children;
  }
}
window.PageErrorBoundary = PageErrorBoundary;

// ---------- รูปแบบวันที่ทั้งระบบ: วัน/เดือน/ปี (dd/mm/yyyy, ค.ศ.) ----------
// ข้อมูลภายในและใน API ยังเก็บเป็น yyyy-mm-dd (เรียงลำดับ/เทียบวันที่ได้) — เปลี่ยนเฉพาะที่แสดงและที่กรอก
function fmtDate(v) {
  if (v instanceof Date) { const p = (n) => String(n).padStart(2, "0"); return p(v.getDate()) + "/" + p(v.getMonth() + 1) + "/" + v.getFullYear(); }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v == null ? "" : v));
  return m ? m[3] + "/" + m[2] + "/" + m[1] : (v == null || v === "—" ? "" : String(v));
}
function fmtDateTime(d) {
  const p = (n) => String(n).padStart(2, "0");
  return fmtDate(d) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}
// แปลง yyyy-mm-dd ที่ปรากฏเป็นข้อความบนหน้าจอ (ตาราง ป้าย ประวัติ ใบเอกสาร ที่พิมพ์) ให้เป็น dd/mm/yyyy อัตโนมัติ
(function installDateDisplay() {
  const RX = /(?<![\d-])((?:19|20)\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?![\d-])/g;
  const SKIP = "script,style,textarea,input,pre,code,select,option,[data-raw-date]";
  const fix = (n) => {
    if (n.nodeType === 3) {
      const t = n.nodeValue;
      if (t && t.length >= 10 && RX.test(t)) { RX.lastIndex = 0; if (!(n.parentElement && n.parentElement.closest(SKIP))) n.nodeValue = t.replace(RX, "$3/$2/$1"); }
      RX.lastIndex = 0;
    } else if (n.nodeType === 1 && !n.matches(SKIP)) {
      const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      let c; while ((c = w.nextNode())) fix(c);
    }
  };
  const start = () => {
    fix(document.body);
    new MutationObserver((muts) => muts.forEach((m) => {
      if (m.type === "characterData") fix(m.target);
      else m.addedNodes.forEach(fix);
    })).observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();

// ช่องกรอกวันที่ dd/mm/yyyy (แทน <input type="date"> ที่รูปแบบขึ้นกับเบราว์เซอร์) — ใช้ props เดิม: value / onChange(e.target.value) เป็น yyyy-mm-dd
// (ไม่ใช้ ...rest ใน destructuring: Babel จะสร้างตัวแปร _excluded ระดับไฟล์ซึ่งชนกับไฟล์อื่นในสโคปรวมของหน้านี้)
function DateInput(props) {
  const { value, onChange, min, max, className, style, placeholder, disabled, id } = props;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : "";
  const [txt, setTxt] = React.useState(fmtDate(iso));
  const native = React.useRef(null);
  React.useEffect(() => { setTxt(fmtDate(iso)); }, [iso]);
  const emit = (v) => onChange && onChange({ target: { value: v } });
  const parse = (t) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t); if (!m) return null;
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    if (d.getFullYear() !== +m[3] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[1]) return null;
    const v = m[3] + "-" + m[2] + "-" + m[1];
    return (min && v < min) || (max && v > max) ? null : v;
  };
  const type = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
    let t = digits; if (digits.length > 4) t = digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4); else if (digits.length > 2) t = digits.slice(0, 2) + "/" + digits.slice(2);
    setTxt(t);
    if (t.length === 10) { const v = parse(t); if (v) emit(v); }
  };
  const blur = () => {
    if (txt === "") { if (iso) emit(""); return; }
    const v = parse(txt); if (v) { if (v !== iso) emit(v); } else setTxt(fmtDate(iso));
  };
  return (
    <span data-raw-date style={{ position: "relative", display: "block" }}>
      <input id={id} className={className} style={{ ...style, paddingRight: 34, width: "100%" }} type="text" inputMode="numeric" autoComplete="off"
        placeholder={placeholder || "วว/ดด/ปปปป"} value={txt} disabled={disabled} onChange={type} onBlur={blur}/>
      <button type="button" tabIndex={-1} disabled={disabled} aria-label="เลือกวันที่จากปฏิทิน" onClick={() => { const n = native.current; if (n && n.showPicker) n.showPicker(); }}
        style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: 0, background: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: 2, display: "flex" }}><I.Calendar size={15}/></button>
      <input ref={native} type="date" tabIndex={-1} aria-hidden="true" value={iso} min={min} max={max} onChange={(e) => { if (e.target.value) emit(e.target.value); }}
        style={{ position: "absolute", right: 6, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}/>
    </span>
  );
}
Object.assign(window, { fmtDate, fmtDateTime, DateInput });
