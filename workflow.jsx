/* global Store, DOC_LABEL, DOC_STATUS, ROLES, FINISHED */

/*
  PolyMate ERP — Document Workflow Engine
  ------------------------------------------------------------
  สายเอกสาร:  PO ลูกค้า / ใบเสนอราคา → ใบสั่งขาย → ใบส่งสินค้า → ใบกำกับภาษี → (ใบวางบิลรวมหลายใบกำกับ ตอนสิ้นเดือน) → ใบเสร็จรับเงิน → รับชำระเงิน
              (ใบส่งสินค้า → ใบกำกับภาษี ได้โดยตรง เมื่อไม่ต้องวางบิล)
  หลักการ
  • เอกสารปลายทางอ้างอิงต้นทางระดับ "รายการ" (line.src = { doc, line }) → ออกบางส่วนได้ และกันออกเกินจำนวน
  • ทุก action ทำใน Store.tx → สำเร็จทั้งหมดหรือไม่เปลี่ยนเลย + บันทึก history ในเอกสาร + Audit Log
  • สถานะ: draft → pending → approved → partial → completed  /  cancelled (ต้องระบุเหตุผล)
  • UI เรียกเฉพาะฟังก์ชันใน Workflow — เมื่อมี Backend ให้ย้าย logic นี้ไปฝั่ง server โดย interface เดิม
*/
const Workflow = (function () {
  const S = Store;
  const PREFIX = { CPO: "CPO", QT: "QT", SO: "SO", DO: "DO", BN: "BL", INV: "IV", RC: "RE", PAY: "RV" };
  const NEXT = { CPO: ["SO"], QT: ["SO"], SO: ["DO"], DO: ["INV"], INV: ["BN", "RC"], BN: ["RC"], RC: ["PAY"], PAY: [] };
  const TYPES = Object.keys(DOC_LABEL);
  const VAT_RATE = 7;
  const DUE_BY_CREDIT = ["BN", "INV"]; // กำหนดชำระ = วันที่ + เครดิตลูกค้า
  const NO_VAT_DEFAULT = ["DO", "CPO"];

  const STATUS_LABEL = {
    CPO: { partial: "เปิด SO บางส่วน", completed: "เปิด SO ครบแล้ว" },
    QT: { partial: "เปิด SO บางส่วน", completed: "เปิด SO ครบแล้ว" },
    SO: { partial: "ส่งของบางส่วน", completed: "ส่งของครบแล้ว" },
    DO: { partial: "ออกใบกำกับบางส่วน", completed: "ออกใบกำกับภาษีแล้ว" },
    INV: { partial: "วางบิล/ออกใบเสร็จบางส่วน", completed: "วางบิล/ออกใบเสร็จแล้ว" },
    BN: { partial: "ออกใบเสร็จบางส่วน", completed: "ออกใบเสร็จแล้ว" },
    RC: { partial: "รับชำระบางส่วน", completed: "รับชำระครบแล้ว" },
    PAY: { completed: "รับเงินแล้ว" },
  };

  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const r3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
  const EPS = 0.0005;
  const fail = S.fail;
  const docs = () => S.state.docs;
  const get = (id) => docs().find((d) => d.id === id) || null;
  const mustGet = (id) => get(id) || fail("ไม่พบเอกสาร " + id);
  const isActive = (d) => d && d.status !== "cancelled";
  const isLive = (d) => d && ["approved", "partial", "completed"].includes(d.status);
  const label = (t) => (DOC_LABEL[t] ? DOC_LABEL[t].th : t);

  // ---------------- การคำนวณยอด ----------------
  function lineAmount(l) { return r2((Number(l.qty) || 0) * (Number(l.price) || 0) * (1 - (Number(l.disc) || 0) / 100)); }
  function calc(d) {
    if (d.type === "PAY") {
      const a = r2(d.amount || 0);
      return { gross: a, discount: 0, subtotal: a, vat: 0, total: a, wht: 0, net: a };
    }
    const gross = r2((d.lines || []).reduce((s, l) => s + lineAmount(l), 0));
    const discount = r2(Math.min(Math.max(Number(d.billDisc) || 0, 0), gross));
    const subtotal = r2(gross - discount);
    const vat = d.vatOn ? r2(subtotal * VAT_RATE / 100) : 0;
    const total = r2(subtotal + vat);
    const wht = r2(subtotal * (Number(d.whtRate) || 0) / 100);
    return { gross, discount, subtotal, vat, total, wht, net: r2(total - wht) };
  }

  // ---------------- ความสัมพันธ์เอกสาร ----------------
  function children(id, { includeCancelled = false } = {}) {
    return docs().filter((d) => (d.sourceIds || []).includes(id) && (includeCancelled || isActive(d)));
  }
  function parents(doc) { return (doc.sourceIds || []).map(get).filter(Boolean); }
  // ต้นทาง + ปลายทางทั้งสาย (สำหรับปุ่ม "ดูเอกสารที่เกี่ยวข้อง")
  function related(id) {
    const seen = new Set([id]);
    const up = [], down = [];
    (function walkUp(d) { parents(d).forEach((p) => { if (!seen.has(p.id)) { seen.add(p.id); up.push(p); walkUp(p); } }); })(mustGet(id));
    (function walkDown(did) { children(did, { includeCancelled: true }).forEach((c) => { if (!seen.has(c.id)) { seen.add(c.id); down.push(c); walkDown(c.id); } }); })(id);
    const byOrder = (a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || a.id.localeCompare(b.id);
    return { upstream: up.sort(byOrder), downstream: down.sort(byOrder) };
  }

  // จำนวนที่ถูกใช้ไปแล้วของรายการต้นทาง (นับเอกสารปลายทางที่ยังไม่ยกเลิก ทุกประเภทในสายถัดไป)
  function usedQty(srcId, lineIdx, excludeId) {
    let used = 0;
    docs().forEach((d) => {
      if (!isActive(d) || d.id === excludeId || !(d.sourceIds || []).includes(srcId)) return;
      (d.lines || []).forEach((l) => { if (l.src && l.src.doc === srcId && l.src.line === lineIdx) used += Number(l.qty) || 0; });
    });
    return r3(used);
  }
  function remainingLines(src, excludeId) {
    return (src.lines || []).map((l, idx) => {
      const used = usedQty(src.id, idx, excludeId);
      return { ...l, idx, used, remaining: r3((Number(l.qty) || 0) - used) };
    });
  }
  // ใบเสร็จ → รับชำระ: คิดเป็นยอดเงิน
  function paymentsOf(rcId, excludeId) { return children(rcId).filter((p) => p.type === "PAY" && p.id !== excludeId); }
  function rcAmounts(rc, excludeId) {
    const pays = paymentsOf(rc.id, excludeId);
    const reserved = r2(pays.reduce((s, p) => s + (p.amount || 0), 0));
    const paid = r2(pays.filter((p) => p.status === "completed").reduce((s, p) => s + (p.amount || 0), 0));
    return { net: rc.net, reserved, paid, remaining: r2(rc.net - reserved), outstanding: r2(rc.net - paid) };
  }
  function remainingValue(src) {
    if (src.type === "RC") return rcAmounts(src).remaining;
    const rl = remainingLines(src);
    const gross = r2(rl.reduce((s, l) => s + lineAmount({ ...l, qty: Math.max(0, l.remaining) }), 0));
    return gross;
  }
  // สถานะการรับเงินของใบกำกับภาษี (ผ่านใบเสร็จ → รับชำระ)
  function paymentInfo(inv) {
    if (!inv || inv.type !== "INV") return null;
    let paid = 0, receipted = 0;
    const addRc = (rc, part) => {
      const share = rc.gross > 0 ? part / rc.gross : 0;
      receipted += rc.net * share;
      if (isLive(rc)) paid += rcAmounts(rc).paid * share;
    };
    // ใบเสร็จที่ออกจากใบกำกับโดยตรง
    children(inv.id).filter((c) => c.type === "RC").forEach((rc) => {
      addRc(rc, (rc.lines || []).filter((l) => l.src && l.src.doc === inv.id).reduce((s, l) => s + lineAmount(l), 0));
    });
    // ใบเสร็จที่ออกจากใบวางบิล (รวมหลายใบกำกับ): นับเฉพาะรายการที่มาจากใบกำกับใบนี้
    children(inv.id).filter((c) => c.type === "BN").forEach((bn) => {
      children(bn.id).filter((c) => c.type === "RC").forEach((rc) => {
        const part = (rc.lines || []).filter((l) => l.src && l.src.doc === bn.id && (bn.lines || [])[l.src.line] && (bn.lines[l.src.line].src || {}).doc === inv.id)
          .reduce((s, l) => s + lineAmount(l), 0);
        addRc(rc, part);
      });
    });
    paid = r2(paid);
    const outstanding = isLive(inv) ? Math.max(0, r2(inv.net - paid)) : 0;
    const today = S.today();
    return { paid, receipted: r2(receipted), outstanding, overdue: outstanding > 0 && inv.due && inv.due !== "—" && inv.due < today };
  }

  // ---------------- สถานะ ----------------
  function statusInfo(doc) {
    const base = DOC_STATUS[doc.status] || { th: doc.status, color: "neutral" };
    const custom = STATUS_LABEL[doc.type] && STATUS_LABEL[doc.type][doc.status];
    return custom ? { ...base, th: custom } : base;
  }
  function refreshStatus(doc) {
    if (!isLive(doc)) return;
    let next = "approved";
    if (doc.type === "PAY") next = "completed";
    else if (doc.type === "RC") {
      const a = rcAmounts(doc);
      next = a.paid >= doc.net - 0.005 && doc.net > 0 ? "completed" : (a.paid > 0 ? "partial" : "approved");
    } else if ((NEXT[doc.type] || []).length) {
      // นับเฉพาะปลายทางที่อนุมัติแล้ว ในการเปลี่ยนสถานะต้นทาง
      const live = docs().filter((d) => isLive(d) && (d.sourceIds || []).includes(doc.id));
      const done = (doc.lines || []).map((l, idx) => {
        let q = 0;
        live.forEach((d) => (d.lines || []).forEach((x) => { if (x.src && x.src.doc === doc.id && x.src.line === idx) q += Number(x.qty) || 0; }));
        return { need: Number(l.qty) || 0, q: r3(q) };
      });
      const any = done.some((x) => x.q > 0);
      const all = done.length > 0 && done.every((x) => x.q >= x.need - EPS);
      next = all ? "completed" : any ? "partial" : "approved";
    }
    if (next !== doc.status) {
      pushHistory(doc, "auto", doc.status, next, "อัปเดตอัตโนมัติจากเอกสารปลายทาง");
      doc.status = next;
    }
  }
  function refreshParents(doc) { parents(doc).forEach((p) => refreshStatus(p)); }

  function pushHistory(doc, action, from, to, reason) {
    doc.history = doc.history || [];
    doc.history.push({ at: S.now(), by: S.userName(), action, from, to, reason: reason || "" });
  }

  // ---------------- สิทธิ์ ----------------
  function role() { const u = S.user(); return u ? ROLES[u.role] : null; }
  const PAGE_OF = (type) => (type === "CPO" ? "customer-po" : "sales");
  function canEditType(type) {
    const r = role(); if (!r) return false;
    return r.canEdit === "*" || (r.canEdit || []).includes(PAGE_OF(type));
  }
  function canApproveType(type) {
    const r = role(); if (!r) return false;
    return r.approve === "*" || (r.approve || []).includes(type);
  }
  const ok = { ok: true };
  const no = (reason) => ({ ok: false, reason });
  function can(action, doc) {
    if (!doc) return no("ไม่พบเอกสาร");
    const kids = children(doc.id);
    switch (action) {
      case "edit":
        if (!canEditType(doc.type)) return no("ไม่มีสิทธิ์แก้ไขเอกสารประเภทนี้");
        if (doc.status === "draft" || doc.status === "pending") return ok;
        if (doc.status === "cancelled") return no("เอกสารถูกยกเลิกแล้ว");
        if (!(role() && role().editApproved)) return no("เอกสารอนุมัติแล้ว — แก้ไขได้เฉพาะผู้มีสิทธิ์ (Admin)");
        if (kids.length) return no("มีเอกสารปลายทางอ้างอิงอยู่ — ต้องยกเลิกปลายทางก่อน");
        if (doc.type === "DO" || doc.type === "PAY") return no("เอกสารนี้ผ่านรายการสต๊อก/การเงินแล้ว — ใช้การยกเลิกแทน");
        return ok;
      case "submit":
        if (doc.status !== "draft") return no("ส่งอนุมัติได้เฉพาะฉบับร่าง");
        return canEditType(doc.type) ? ok : no("ไม่มีสิทธิ์");
      case "approve":
        if (!(doc.status === "draft" || doc.status === "pending")) return no("อนุมัติได้เฉพาะเอกสารฉบับร่าง/รออนุมัติ");
        return canApproveType(doc.type) ? ok : no("ไม่มีสิทธิ์อนุมัติ " + label(doc.type));
      case "reject":
        if (doc.status !== "pending") return no("ตีกลับได้เฉพาะเอกสารรออนุมัติ");
        return canApproveType(doc.type) ? ok : no("ไม่มีสิทธิ์อนุมัติ");
      case "cancel":
        if (doc.status === "cancelled") return no("ยกเลิกไปแล้ว");
        if (!canEditType(doc.type) && !canApproveType(doc.type)) return no("ไม่มีสิทธิ์ยกเลิก");
        if (kids.length) return no(`มีเอกสารปลายทาง ${kids.map((k) => k.id).join(", ")} — ต้องยกเลิกปลายทางก่อน`);
        return ok;
      case "delete":
        if (doc.status !== "draft") return no("ลบได้เฉพาะฉบับร่าง — เอกสารอื่นใช้การยกเลิก");
        if (!canEditType(doc.type)) return no("ไม่มีสิทธิ์");
        if (children(doc.id, { includeCancelled: true }).length) return no("มีเอกสารอ้างอิงอยู่");
        if (!S.canDelete(doc)) return no("ไม่ใช่เลขที่ล่าสุดของชุด การลบจะทำให้เลขเอกสารขาดช่วง — ใช้การยกเลิกแทน");
        return ok;
      case "convert":
        if (!(NEXT[doc.type] || []).length) return no("เป็นเอกสารขั้นสุดท้าย");
        if (doc.status === "cancelled") return no("เอกสารถูกยกเลิก — สร้างเอกสารต่อไม่ได้");
        if (!(doc.status === "approved" || doc.status === "partial")) {
          if (doc.status === "completed") return no("ดำเนินการครบแล้ว");
          return no("ต้องอนุมัติเอกสารก่อน");
        }
        if (doc.type === "RC" ? rcAmounts(doc).remaining <= 0.005 : !remainingLines(doc).some((l) => l.remaining > EPS))
          return no(doc.type === "RC" ? "รับชำระครบแล้ว" : "ไม่มีรายการคงเหลือให้ออกเอกสารต่อ");
        if (doc.type === "DO") { const lk = installmentLock(doc); if (lk) return no(lk); }     // แผนแบ่งงวด → ไม่ออกใบกำกับจากใบส่งสินค้า
        return canEditType(NEXT[doc.type][0]) ? ok : no("ไม่มีสิทธิ์สร้างเอกสารถัดไป");
      default: return no("unknown action");
    }
  }
  // ประเภทถัดไปที่สร้างได้: ใบส่งสินค้าที่เริ่มวางบิลแล้วต้องออกใบกำกับผ่านใบวางบิลต่อ (และกลับกัน) เพื่อกันออกซ้ำสองเส้นทาง
  function nextTypes(doc) {
    const n = NEXT[doc.type] || [];
    if (n.length < 2) return n;
    const used = new Set(children(doc.id).map((c) => c.type));
    const lock = n.filter((t) => used.has(t));
    return lock.length ? lock : n;
  }

  // ---------------- แผนเรียกเก็บเงินแบบแบ่งงวด (1B) ----------------
  /*
    การรับชำระแบบแบ่งงวด: แต่ละงวดคือใบกำกับภาษีปกติของงวดนั้น (ยอดงวด + VAT) ใบงวดสุดท้ายแสดงเฉพาะส่วนที่เหลือ
    • แผน = root.plan = [{ label, pct }] เก็บที่ใบเสนอราคา (QT) — ถ้าใบสั่งขายไม่ได้มาจาก QT ใบเดียว ก็เก็บที่ใบสั่งขายนั้น
    • ใบกำกับของงวด: type INV, sourceIds [root], lines 1 รายการ (ไม่มี src จึงไม่กินจำนวนสินค้าต้นทาง), doc.installment = { root, no, of, label, pct }
    • สถานะของแต่ละงวดคำนวณจากใบกำกับที่ยังไม่ยกเลิก (ยกเลิกใบ → งวดกลับเป็น "ยังไม่ออก") ไม่เก็บซ้ำ
    • กติกา: ยอดทุกงวดรวมกันห้ามเกินยอดต้นทาง · ถ้าตั้งแผนแล้ว ห้ามออกใบกำกับจากใบส่งสินค้า (และกลับกัน) กันเรียกเก็บซ้ำสองทาง
  */
  const MAX_INST = 12;
  const isInstInv = (d) => !!(d && d.type === "INV" && d.installment && d.installment.root);
  function instInvoices(rootId, includeCancelled) {
    return docs().filter((d) => isInstInv(d) && d.installment.root === rootId && (includeCancelled || isActive(d)));
  }
  function billingRoot(doc) {
    if (!doc) return null;
    if (isInstInv(doc)) return get(doc.installment.root);
    if (doc.type === "DO") { const so = parents(doc).find((p) => p.type === "SO"); return so ? billingRoot(so) : null; }
    if (doc.type === "SO") { const qts = parents(doc).filter((p) => p.type === "QT"); return qts.length === 1 ? qts[0] : doc; }
    if (doc.type === "QT") return doc;
    return null;
  }
  // มีใบกำกับภาษีที่ออกทางใบส่งสินค้า (ไม่ใช่งวด) ในสายนี้แล้วหรือไม่
  function orderHasNormalInvoice(root) {
    return related(root.id).downstream.some((d) => d.type === "INV" && isActive(d) && !isInstInv(d));
  }
  function installmentLock(doc) {
    const roots = parents(doc).filter((p) => p.type === "SO").map(billingRoot).filter(Boolean);
    const hit = roots.find((r) => (r.plan || []).length > 0);
    return hit ? `${hit.id} เรียกเก็บเงินแบบแบ่งงวด — ออกใบกำกับภาษีตามงวดจาก ${hit.id} (ไม่ออกจากใบส่งสินค้า)` : null;
  }
  function planInfo(root) {
    const plan = root.plan || [];
    const sub = Number(root.subtotal) || 0;
    const invs = instInvoices(root.id);
    const byNo = {}; invs.forEach((d) => { byNo[d.installment.no] = d; });
    const issued = r2(invs.reduce((s, d) => s + (d.subtotal || 0), 0));
    const remaining = r2(sub - issued);
    const planned = plan.map((p) => r2(sub * (Number(p.pct) || 0) / 100));
    const N = plan.length;
    const rows = plan.map((p, i) => {
      const no = i + 1, inv = byNo[no] || null;
      let amount;
      if (inv) amount = inv.subtotal;
      else {
        amount = no === N ? r2(sub - plan.reduce((s, _, j) => (j === i ? s : s + (byNo[j + 1] ? byNo[j + 1].subtotal : planned[j])), 0)) : planned[i];
        amount = Math.max(0, Math.min(amount, remaining));      // ไม่ให้เกินยอดที่เหลือ (เศษสตางค์)
      }
      const vat = root.vatOn ? r2(amount * VAT_RATE / 100) : 0;
      return { no, label: p.label, pct: Number(p.pct) || 0, amount, vat, total: r2(amount + vat), inv };
    });
    return { rows, N, issued, remaining, billedPct: sub > 0 ? r2(issued / sub * 100) : 0, remainingPct: sub > 0 ? r2(remaining / sub * 100) : 0, subtotal: sub, vatOn: !!root.vatOn, hasPlan: N > 0 };
  }
  function setBillingPlan(rootId, rowsIn) {
    return S.tx("billingPlan", () => {
      const root = mustGet(rootId);
      if (root.type !== "QT" && root.type !== "SO") fail("ตั้งแผนเรียกเก็บได้เฉพาะใบเสนอราคา / ใบสั่งขาย");
      const br = billingRoot(root);
      if (br && br.id !== root.id) fail(`แผนเรียกเก็บของใบนี้อยู่ที่ ${br.id}`);
      if (!canEditType(root.type)) fail("ไม่มีสิทธิ์ตั้งแผนเรียกเก็บ");
      if (root.status === "cancelled") fail("เอกสารถูกยกเลิกแล้ว");
      if (orderHasNormalInvoice(root)) fail("มีใบกำกับภาษีที่ออกจากใบส่งสินค้าแล้ว — ตั้งแผนแบ่งงวดไม่ได้");
      const rows = (rowsIn || []).map((r) => ({ label: String(r.label || "").trim(), pct: r2(Number(r.pct) || 0) }));
      const invs = instInvoices(root.id);
      if (!rows.length) {
        if (invs.length) fail(`มีใบกำกับงวดที่ยังไม่ยกเลิก (${invs.map((d) => d.id).join(", ")}) — ยกเลิกก่อนจึงจะล้างแผนได้`);
        root.plan = []; pushHistory(root, "plan", null, null, "ล้างแผนเรียกเก็บ"); S.log("PLAN", label(root.type), root.id, "ล้างแผนเรียกเก็บ");
        return root;
      }
      if (rows.length < 2) fail("แผนแบ่งงวดต้องมีอย่างน้อย 2 งวด");
      if (rows.length > MAX_INST) fail(`แบ่งได้ไม่เกิน ${MAX_INST} งวด`);
      rows.forEach((r, i) => { if (!r.label) fail(`งวดที่ ${i + 1}: กรุณาระบุชื่องวด`); if (!(r.pct > 0)) fail(`งวดที่ ${i + 1}: เปอร์เซ็นต์ต้องมากกว่า 0`); });
      const sum = r2(rows.reduce((s, r) => s + r.pct, 0));
      if (Math.abs(sum - 100) > 0.005) fail(`เปอร์เซ็นต์ทุกงวดรวมกันต้องเท่ากับ 100 (ตอนนี้ ${sum})`);
      invs.forEach((d) => {                       // งวดที่ออกใบกำกับแล้วเปลี่ยนไม่ได้
        const r = rows[d.installment.no - 1];
        if (!r || r.pct !== d.installment.pct || r.label !== d.installment.label) fail(`งวดที่ ${d.installment.no} ออกใบกำกับแล้ว (${d.id}) — แก้ชื่อ/เปอร์เซ็นต์ไม่ได้ (ยกเลิกใบกำกับก่อน)`);
      });
      root.plan = rows;
      pushHistory(root, "plan", null, null, rows.map((r) => `${r.label} ${r.pct}%`).join(" · "));
      S.log("PLAN", label(root.type), root.id, "ตั้งแผนเรียกเก็บ " + rows.map((r) => `${r.label} ${r.pct}%`).join(" / "));
      return root;
    });
  }
  function issueInstallment(rootId, no, opts) {
    return S.tx("issueInstallment", () => {
      opts = opts || {};
      const root = mustGet(rootId);
      if (!canEditType("INV")) fail("ไม่มีสิทธิ์สร้างใบกำกับภาษี");
      if (!isLive(root)) fail(`ต้องอนุมัติ ${root.id} ก่อนจึงออกใบกำกับงวดได้`);
      if (orderHasNormalInvoice(root)) fail("มีใบกำกับภาษีที่ออกจากใบส่งสินค้าแล้ว — ออกตามงวดไม่ได้");
      const info = planInfo(root);
      const row = info.rows[no - 1];
      if (!row) fail(`ไม่พบงวดที่ ${no}`);
      if (row.inv) fail(`งวดที่ ${no} ออกใบกำกับแล้ว (${row.inv.id})`);
      if (row.amount <= 0.004) fail("ยอดงวดนี้เป็นศูนย์ (เรียกเก็บครบแล้ว)");
      const doc = saveDraft({
        type: "INV", customer: root.customer, date: opts.date || S.today(), sourceIds: [root.id], refNo: root.refNo || "", note: opts.note || "",
        vatOn: !!root.vatOn, whtRate: root.whtRate || 0, billDisc: 0,
        lines: [{ code: "-", name: `งวดที่ ${no}/${info.N} — ${row.label} (${row.pct}% ของ ${root.id})`, qty: 1, unit: "งวด", price: row.amount, disc: 0 }],
        installment: { root: root.id, no, of: info.N, label: row.label, pct: row.pct },
        _fromNote: `งวดที่ ${no}/${info.N} จากแผนเรียกเก็บของ ${root.id}`,
      });
      S.log("INSTALLMENT", label("INV"), doc.id, `ออกใบกำกับงวดที่ ${no}/${info.N} (${row.pct}%) จาก ${root.id} ยอด ${row.amount.toLocaleString()} + VAT`);
      return doc;
    });
  }

  // ---------------- Validation ----------------
  function customerOf(code) { return S.state.customers.find((c) => c.code === code) || null; }
  function addDays(dateStr, days) {
    const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + (Number(days) || 0));
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function validate(doc, selfId) {
    if (!TYPES.includes(doc.type)) fail("ประเภทเอกสารไม่ถูกต้อง");
    if (!customerOf(doc.customer)) fail("กรุณาเลือกลูกค้าที่มีอยู่ในระบบ");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.date || "")) fail("วันที่ไม่ถูกต้อง");
    if (doc.type === "PAY") {
      if (!(doc.amount > 0)) fail("ยอดรับชำระต้องมากกว่า 0");
      const rc = mustGet((doc.sourceIds || [])[0] || "");
      if (rc.type !== "RC") fail("การรับชำระต้องอ้างอิงใบเสร็จรับเงิน");
      const a = rcAmounts(rc, selfId);
      if (doc.amount > a.remaining + 0.005) fail(`ยอดรับชำระเกินยอดคงค้างของ ${rc.id} (คงค้าง ${a.remaining.toLocaleString()} บาท)`);
      return;
    }
    const lines = doc.lines || [];
    if (!lines.length) fail("ต้องมีรายการสินค้าอย่างน้อย 1 รายการ");
    lines.forEach((l, i) => {
      const n = `รายการที่ ${i + 1}`;
      if (!String(l.name || "").trim()) fail(`${n}: กรุณาระบุชื่อสินค้า`);
      if (!(Number(l.qty) > 0)) fail(`${n}: จำนวนต้องมากกว่า 0`);
      if (Number(l.price) < 0) fail(`${n}: ราคาต้องไม่ติดลบ`);
      if (Number(l.disc) < 0 || Number(l.disc) > 100) fail(`${n}: ส่วนลดต้องอยู่ระหว่าง 0–100%`);
    });
    const c = calc(doc);
    if (Number(doc.billDisc) > c.gross + 0.005) fail("ส่วนลดท้ายบิลมากกว่ายอดรวม");
    // ใบกำกับของงวด: 1 รายการ · งวดละใบ · ยอดทุกงวดรวมกันไม่เกินยอดต้นทาง
    if (doc.installment) {
      const root = get(doc.installment.root);
      if (!root) fail(`ไม่พบเอกสารต้นทางของแผนเรียกเก็บ ${doc.installment.root}`);
      if (root.status === "cancelled") fail(`เอกสารต้นทาง ${root.id} ถูกยกเลิกแล้ว`);
      if (lines.length !== 1) fail("ใบกำกับของงวดมีได้ 1 รายการ");
      const others = instInvoices(root.id).filter((d) => d.id !== selfId);
      const dup = others.find((d) => d.installment.no === doc.installment.no);
      if (dup) fail(`งวดที่ ${doc.installment.no} มีใบกำกับแล้ว (${dup.id})`);
      const room = r2((Number(root.subtotal) || 0) - others.reduce((s, d) => s + (d.subtotal || 0), 0));
      if (c.subtotal > room + 0.01) fail(`ยอดงวดนี้ (${c.subtotal.toLocaleString()}) เกินยอดที่เรียกเก็บได้ของ ${root.id} (เหลือ ${room.toLocaleString()} ก่อน VAT)`);
    }
    // รายการที่อ้างอิงต้นทาง → ตรวจไม่ให้เกินคงเหลือ
    const bySrc = {};
    lines.forEach((l, i) => {
      if (!l.src) return;
      const src = mustGet(l.src.doc);
      if (src.status === "cancelled") fail(`เอกสารต้นทาง ${src.id} ถูกยกเลิกแล้ว`);
      if (src.customer !== doc.customer) fail(`ลูกค้าไม่ตรงกับเอกสารต้นทาง ${src.id}`);
      if (!(NEXT[src.type] || []).includes(doc.type)) fail(`สร้าง${label(doc.type)}จาก${label(src.type)}ไม่ได้`);
      const key = src.id + "#" + l.src.line;
      bySrc[key] = r3((bySrc[key] || 0) + Number(l.qty));
      const sl = src.lines[l.src.line];
      if (!sl) fail(`รายการที่ ${i + 1}: ไม่พบรายการต้นทาง`);
      const remain = r3(Number(sl.qty) - usedQty(src.id, l.src.line, selfId));
      if (bySrc[key] > remain + EPS) fail(`รายการ "${sl.name}" เกินจำนวนคงเหลือของ ${src.id} (คงเหลือ ${remain})`);
    });
  }

  // ---------------- Actions ----------------
  function snapshotCustomer(code) {
    const c = customerOf(code);
    return c ? { name: c.name, nameEn: c.nameEn, address: c.address, taxId: c.taxId, contact: c.contact, phone: c.phone, credit: c.credit } : null;
  }
  function normalizeLines(lines) {
    return (lines || []).map((l) => {
      const o = { code: String(l.code || "").trim() || "-", name: String(l.name || "").trim(), qty: r3(Number(l.qty) || 0),
        unit: l.unit || "ชิ้น", price: r2(Number(l.price) || 0), disc: r2(Number(l.disc) || 0) };
      if (l.src) o.src = { doc: l.src.doc, line: l.src.line };
      return o;
    });
  }
  function applyTotals(doc) {
    Object.assign(doc, calc(doc));
    doc.items = doc.type === "PAY" ? 1 : (doc.lines || []).length;
  }

  // บันทึกฉบับร่าง (สร้างใหม่ หรือแก้ไข)
  function saveDraft(form) {
    return S.tx("saveDraft", () => {
      const isNew = !form.id;
      const cust = customerOf(form.customer);
      let doc;
      if (isNew) {
        if (!canEditType(form.type)) fail("ไม่มีสิทธิ์สร้างเอกสารประเภทนี้");
        doc = { type: form.type, sourceIds: form.sourceIds || [], history: [], status: "draft" };
      } else {
        doc = mustGet(form.id);
        const c = can("edit", doc); if (!c.ok) fail(c.reason);
      }
      const prevStatus = doc.status;
      const fields = {
        customer: form.customer, customerName: cust ? (cust.nameEn || cust.name) : form.customer,
        date: form.date, due: form.due || (DUE_BY_CREDIT.includes(form.type) && cust ? addDays(form.date, cust.credit) : "—"),
        refNo: form.refNo || "", note: form.note || "",
        vatOn: form.vatOn != null ? !!form.vatOn : !NO_VAT_DEFAULT.includes(form.type),
        whtRate: Number(form.whtRate) || 0, billDisc: r2(form.billDisc || 0),
      };
      if (isNew && form.installment) fields.installment = { root: form.installment.root, no: form.installment.no, of: form.installment.of, label: form.installment.label, pct: form.installment.pct };   // ใบกำกับของงวด (1B)
      if (doc.type === "RC") fields.collector = String(form.collector || "").trim();   // ผู้เก็บเงิน (พนักงานที่พกใบเสร็จไปเก็บเงิน)
      if (doc.type === "PAY") Object.assign(fields, { amount: r2(form.amount), method: form.method || "โอนเงิน", bankRef: form.bankRef || "", vatOn: false, whtRate: 0, lines: [] });
      else fields.lines = normalizeLines(form.lines);
      const candidate = { ...doc, ...fields };
      validate(candidate, isNew ? null : doc.id);
      Object.assign(doc, fields);
      if (doc.type !== "PAY" || isNew) doc.customerSnap = snapshotCustomer(doc.customer);
      applyTotals(doc);
      doc.updatedAt = S.now(); doc.updatedBy = S.userName();
      if (isNew) {
        const n = S.nextDocNo(PREFIX[doc.type], doc.date);
        Object.assign(doc, { id: n.docNo, seq: n.seq, counterKey: n.counterKey, createdAt: S.now(), createdBy: S.userName() });
        pushHistory(doc, "create", null, "draft", form._fromNote || "");
        docs().unshift(doc);
        S.log("CREATE", label(doc.type), doc.id, `สร้างฉบับร่าง ${doc.customerName} ยอด ${doc.total.toLocaleString()}` + (doc.sourceIds.length ? ` · จาก ${doc.sourceIds.join(", ")}` : ""));
      } else {
        if (prevStatus === "pending") { doc.status = "draft"; pushHistory(doc, "edit", "pending", "draft", "แก้ไขระหว่างรออนุมัติ → กลับเป็นฉบับร่าง"); }
        else pushHistory(doc, "edit", prevStatus, prevStatus, form.editReason || "");
        S.log("UPDATE", label(doc.type), doc.id, `แก้ไขเอกสาร (สถานะ ${prevStatus})` + (form.editReason ? ` · เหตุผล: ${form.editReason}` : ""));
        if (isLive(doc)) refreshParents(doc);
      }
      return doc;
    });
  }

  function submit(id) {
    return S.tx("submit", () => {
      const doc = mustGet(id);
      const c = can("submit", doc); if (!c.ok) fail(c.reason);
      validate(doc, doc.id);
      pushHistory(doc, "submit", doc.status, "pending");
      doc.status = "pending";
      S.log("SUBMIT", label(doc.type), doc.id, "ส่งอนุมัติ");
      return doc;
    });
  }

  function approve(id) {
    return S.tx("approve", () => {
      const doc = mustGet(id);
      const c = can("approve", doc); if (!c.ok) fail(c.reason);
      validate(doc, doc.id);
      parents(doc).forEach((p) => { if (!isLive(p)) fail(`เอกสารต้นทาง ${p.id} ยังไม่อนุมัติหรือถูกยกเลิก`); });
      if (doc.type === "DO") postStock(doc, -1);
      const from = doc.status;
      doc.status = "approved";
      doc.approvedBy = S.userName(); doc.approvedAt = S.now();
      if (doc.type === "DO") doc.ship = doc.ship || { status: "waiting" };
      pushHistory(doc, "approve", from, "approved");
      refreshStatus(doc);
      refreshParents(doc);
      S.log("APPROVE", label(doc.type), doc.id, `อนุมัติ ยอด ${doc.total.toLocaleString()}`);
      return doc;
    });
  }

  function reject(id, reason) {
    return S.tx("reject", () => {
      const doc = mustGet(id);
      const c = can("reject", doc); if (!c.ok) fail(c.reason);
      if (!String(reason || "").trim()) fail("กรุณาระบุเหตุผลที่ตีกลับ");
      pushHistory(doc, "reject", "pending", "draft", reason);
      doc.status = "draft";
      S.log("REJECT", label(doc.type), doc.id, "ตีกลับ: " + reason);
      return doc;
    });
  }

  function cancel(id, reason) {
    return S.tx("cancel", () => {
      const doc = mustGet(id);
      const c = can("cancel", doc); if (!c.ok) fail(c.reason);
      if (!String(reason || "").trim()) fail("กรุณาระบุเหตุผลการยกเลิก");
      if (doc.type === "DO" && doc.stockPosted) postStock(doc, +1);
      const from = doc.status;
      doc.status = "cancelled";
      doc.cancel = { reason: String(reason).trim(), by: S.userName(), at: S.now(), fromStatus: from };
      pushHistory(doc, "cancel", from, "cancelled", reason);
      refreshParents(doc);
      S.log("CANCEL", label(doc.type), doc.id, "ยกเลิก: " + reason);
      return doc;
    });
  }

  function remove(id) {
    return S.tx("delete", () => {
      const doc = mustGet(id);
      const c = can("delete", doc); if (!c.ok) fail(c.reason);
      S.remove("docs", id);
      return true;
    });
  }

  // ตัด/คืนสต๊อกจากใบส่งสินค้า
  function postStock(doc, sign) {
    let n = 0;
    (doc.lines || []).forEach((l) => {
      const it0 = S.findStockItem(l.code);
      if (!it0) return;
      // บันทึกต้นทุน ณ วันส่งไว้กับรายการ → ต้นทุนขายของใบกำกับภาษีไม่เปลี่ยนย้อนหลังเมื่อต้นทุนสินค้าขยับตามราคาซื้อ
      if (sign < 0) l.unitCost = Number(it0.rec.cost) || 0;
      S.adjustStock(l.code, sign * Number(l.qty), doc.id, (sign < 0 ? "ส่งสินค้าให้ " : "คืนสต๊อก (ยกเลิกใบส่งสินค้า) ") + doc.customerName);
      n++;
    });
    doc.stockPosted = sign < 0;
    return n;
  }

  /*
    สร้างเอกสารถัดไป
    opts = { sourceIds:[...], targetType, picks:[{doc, line, qty}] (ไม่ระบุ = คงเหลือทั้งหมด),
             date, approveSources:bool (สำหรับปุ่ม "อนุมัติและสร้าง..."), amount (สำหรับรับชำระ), method, bankRef, note }
  */
  function convert(opts) {
    return S.tx("convert", () => {
      const sources = (opts.sourceIds || []).map(mustGet);
      if (!sources.length) fail("ไม่ได้เลือกเอกสารต้นทาง");
      const type0 = sources[0].type, cust = sources[0].customer;
      if (sources.some((s) => s.type !== type0)) fail("เอกสารต้นทางต้องเป็นประเภทเดียวกัน");
      if (sources.some((s) => s.customer !== cust)) fail("เอกสารต้นทางต้องเป็นลูกค้ารายเดียวกัน");
      const target = opts.targetType || nextTypes(sources[0])[0];

      if (opts.approveSources) sources.forEach((s) => { if (s.status === "draft" || s.status === "pending") approve(s.id); });
      sources.forEach((s) => {
        const c = can("convert", s); if (!c.ok) fail(`${s.id}: ${c.reason}`);
        if (!nextTypes(s).includes(target)) fail(`${s.id}: สร้าง${label(target)}ไม่ได้ (ใช้เส้นทาง ${nextTypes(s).map(label).join(" / ")})`);
      });
      if (sources.some((s) => s.whtRate !== sources[0].whtRate || !!s.vatOn !== !!sources[0].vatOn) && target !== "DO")
        fail("เอกสารต้นทางมีเงื่อนไขภาษี (VAT / หัก ณ ที่จ่าย) ต่างกัน — รวมเป็นใบเดียวไม่ได้");

      const src0 = sources[0];
      const date = opts.date || S.today();
      const form = {
        type: target, customer: cust, date, sourceIds: sources.map((s) => s.id),
        refNo: [...new Set(sources.map((s) => s.refNo).filter(Boolean))].join(", "),
        note: opts.note || src0.note || "",
        vatOn: target === "DO" ? false : (src0.type === "DO" ? true : !!src0.vatOn),
        whtRate: src0.whtRate || 0,
        _fromNote: "สร้างจาก " + sources.map((s) => s.id).join(", "),
      };
      if (target === "PAY") {
        const rc = src0;
        const a = rcAmounts(rc);
        Object.assign(form, { amount: opts.amount != null ? Number(opts.amount) : a.remaining, method: opts.method, bankRef: opts.bankRef });
      } else {
        const lines = [];
        let billDisc = 0;
        sources.forEach((s) => {
          const rl = remainingLines(s);
          const pick = (idx) => {
            if (!opts.picks) return rl[idx].remaining;
            const p = opts.picks.find((x) => x.doc === s.id && x.line === idx);
            return p ? Number(p.qty) || 0 : 0;
          };
          let pickedGross = 0;
          rl.forEach((l) => {
            const q = r3(pick(l.idx));
            if (q <= 0) return;
            if (q > l.remaining + EPS) fail(`${s.id} "${l.name}": จำนวน ${q} เกินคงเหลือ ${l.remaining}`);
            lines.push({ code: l.code, name: l.name, qty: q, unit: l.unit, price: l.price, disc: l.disc || 0, src: { doc: s.id, line: l.idx } });
            pickedGross += lineAmount({ ...l, qty: q });
          });
          if (s.billDisc && s.gross) billDisc += s.billDisc * (pickedGross / s.gross); // เฉลี่ยส่วนลดท้ายบิลตามสัดส่วน
        });
        if (!lines.length) fail("ไม่ได้เลือกรายการ หรือไม่มีจำนวนคงเหลือ");
        form.lines = lines;
        form.billDisc = r2(billDisc);
        // ตรวจยอดเงิน: ปลายทางต้องไม่เกินมูลค่าคงเหลือของต้นทาง
        const value = calc({ ...form, type: target }).gross;
        const cap = r2(sources.reduce((sum, s) => sum + remainingValue(s), 0));
        if (value > cap + 0.01) fail(`ยอดเอกสารใหม่ (${value.toLocaleString()}) เกินมูลค่าคงเหลือของต้นทาง (${cap.toLocaleString()})`);
      }
      const doc = saveDraft(form);
      S.log("CONVERT", label(target), doc.id, `สร้าง${label(target)}จาก ${form.sourceIds.join(", ")}`);
      if (opts.approveTarget && can("approve", doc).ok) approve(doc.id);
      return doc;
    });
  }

  // ---------------- การจัดส่ง (ใบส่งสินค้า) ----------------
  const SHIP_FLOW = { waiting: ["in-transit"], "in-transit": ["delivered", "waiting"], delivered: [] };
  function setShipStatus(id, status, info) {
    return S.tx("ship", () => {
      const doc = mustGet(id);
      if (doc.type !== "DO") fail("ไม่ใช่ใบส่งสินค้า");
      if (!isLive(doc)) fail("ต้องอนุมัติใบส่งสินค้าก่อน และต้องไม่ถูกยกเลิก");
      const cur = (doc.ship && doc.ship.status) || "waiting";
      if (!(SHIP_FLOW[cur] || []).includes(status)) fail(`เปลี่ยนสถานะจัดส่งจาก ${cur} เป็น ${status} ไม่ได้`);
      if (status === "in-transit" && !(info && info.vehicle)) fail("กรุณาเลือกรถ/ผู้ขนส่ง");
      if (status === "delivered" && !(info && String(info.receivedBy || "").trim())) fail("กรุณาระบุชื่อผู้รับสินค้า");
      doc.ship = { ...(doc.ship || {}), ...(info || {}), status };
      if (status === "in-transit") doc.ship.shippedAt = S.now();
      if (status === "delivered") doc.ship.deliveredAt = S.now();
      pushHistory(doc, "ship", cur, status, info && (info.note || info.receivedBy || info.vehicle));
      S.log("SHIP", label("DO"), doc.id, `สถานะจัดส่ง: ${cur} → ${status}`);
      return doc;
    });
  }

  // ---------------- ใบสั่งขาย → ใบสั่งผลิต ----------------
  function woUsed(soId, line, excludeId) {
    return r3(S.state.workOrders.filter((w) => w.status !== "cancelled" && w.id !== excludeId && w.src && w.src.doc === soId && w.src.line === line)
      .reduce((s, w) => s + (w.quantity || 0), 0));
  }
  function createWorkOrders(soId, picks) {
    return S.tx("createWO", () => {
      const so = mustGet(soId);
      if (so.type !== "SO") fail("เปิดใบสั่งผลิตได้จากใบสั่งขายเท่านั้น");
      if (!isLive(so)) fail("ใบสั่งขายต้องอนุมัติแล้ว และไม่ถูกยกเลิก");
      const r = role();
      if (!(r && (r.canEdit === "*" || (r.canEdit || []).includes("production") || (r.canEdit || []).includes("sales")))) fail("ไม่มีสิทธิ์เปิดใบสั่งผลิต");
      const made = [];
      (picks || []).forEach((p) => {
        const l = so.lines[p.line];
        if (!l) fail("ไม่พบรายการในใบสั่งขาย");
        const qty = Math.round(Number(p.qty) || 0);
        if (qty <= 0) return;
        const fg = S.state.finished.find((f) => f.code === l.code);
        if (!fg) fail(`"${l.name}" ไม่มีรหัสสินค้าสำเร็จรูปในระบบ (${l.code}) — เพิ่มสินค้าในคลังก่อน`);
        if (fg.jobType === "trade") fail(`"${l.name}" เป็นสินค้าซื้อมาขายไป ไม่ต้องผลิต`);
        // ผลิตเกินจำนวนในใบสั่งขายได้ (เช่น ผลิตเก็บเข้าสต๊อกเพิ่ม) — ส่วนที่เกินเข้าสต๊อกสินค้าสำเร็จรูปตามปกติ
        const left = r3(l.qty - woUsed(so.id, p.line));
        const extra = qty > left + EPS ? ` · ผลิตเกินใบสั่งขาย ${r3(qty - Math.max(0, left))} (เก็บเข้าสต๊อก)` : "";
        const bom = S.bomDefaultFor(fg.code);
        const mold = bom ? S.state.molds.find((m) => m.id === bom.mold) : null;
        const n = S.nextDocNo("WO", S.today());
        const wo = {
          id: n.docNo, seq: n.seq, counterKey: n.counterKey, date: S.today(), due: p.due || so.due || "—",
          product: fg.name, productCode: fg.code, customer: so.customer, customerName: so.customerName,
          quantity: qty, produced: 0, ng: 0, machine: p.machine || "—", mold: p.mold || (mold ? mold.id : "—"),
          cavities: mold ? mold.cavities : 1, cycleTime: Number(p.cycleTime) || 20, status: "queued", priority: p.priority || "normal",
          deliverySchedule: [], src: { doc: so.id, line: p.line }, soId: so.id, createdAt: S.now(), createdBy: S.userName(),
        };
        S.state.workOrders.unshift(wo);
        made.push(wo);
        S.log("CREATE", "ใบสั่งผลิต", wo.id, `เปิดจาก ${so.id} · ${fg.code} × ${qty}${extra}`);
      });
      if (!made.length) fail("ไม่ได้ระบุจำนวนที่จะผลิต");
      pushHistory(so, "wo", so.status, so.status, "เปิดใบสั่งผลิต " + made.map((w) => w.id).join(", "));
      return made;
    });
  }

  // ---------------- หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) ที่ลูกค้าออกให้เรา ----------------
  // ผูกกับใบเสร็จที่มีหัก ณ ที่จ่าย: doc.whtCert = { no, date, amount, note, by, at } · cert = null → ลบ (ยังไม่ได้รับ)
  const WHT_CERT_DAYS = 30; // ใบเสร็จที่ยังไม่ได้รับหนังสือเกินกี่วันถือว่าเกินกำหนด
  function whtCertStatus(rc) {
    if (!rc || rc.type !== "RC" || !isLive(rc) || !(rc.wht > 0)) return null;
    if (rc.whtCert) return { state: "received", cert: rc.whtCert };
    // ใบเสร็จที่ผูก/ตัดผ่านใบรับเงิน (RV) แล้ว: ติดตามหนังสือ 50 ทวิ ที่ใบรับเงินแทน (ที่เดียว) — ซ่อนการติดตามแบบเก่า
    if ((S.state.rcLinked || []).includes(rc.id)) return null;
    const inv = typeof window.rcInvoiceIds === "function" ? window.rcInvoiceIds(rc) : [];
    if (inv.some((i) => (S.state.whtInvoices || []).includes(i))) return null;
    const days = Math.floor((new Date(S.today() + "T00:00:00") - new Date(rc.date + "T00:00:00")) / 86400000);
    return { state: "pending", days, overdue: days > WHT_CERT_DAYS };
  }
  function setWhtCert(rcId, cert) {
    return S.tx("whtCert", () => {
      const rc = mustGet(rcId);
      const u = S.user();
      if (!(u && (u.role === "admin" || u.role === "accounting"))) fail("เฉพาะผู้ดูแลระบบและฝ่ายบัญชีบันทึกหนังสือรับรองหัก ณ ที่จ่ายได้");
      if (rc.type !== "RC") fail("บันทึกหนังสือรับรองได้เฉพาะใบเสร็จรับเงิน");
      if (!isLive(rc)) fail("ใบเสร็จต้องอนุมัติแล้วและไม่ถูกยกเลิก");
      if (!(rc.wht > 0)) fail("ใบเสร็จนี้ไม่มีหัก ณ ที่จ่าย");
      if (cert == null) {
        if (!rc.whtCert) return rc;
        const old = rc.whtCert; delete rc.whtCert;
        pushHistory(rc, "wht", "received", "pending", "ลบหนังสือรับรองหัก ณ ที่จ่าย " + old.no);
        S.log("WHT_CERT", "ใบเสร็จ", rc.id, "ลบหนังสือรับรอง " + old.no);
        return rc;
      }
      const no = String(cert.no || "").trim();
      const amount = r2(Number(cert.amount));
      if (!no) fail("กรุณาระบุเลขที่หนังสือรับรอง");
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(cert.date || "")) fail("วันที่หนังสือรับรองไม่ถูกต้อง");
      if (!(amount > 0)) fail("ยอดภาษีที่ถูกหักต้องมากกว่า 0");
      if (amount > r2(rc.subtotal) + 0.005) fail("ยอดภาษีที่ถูกหักมากกว่ามูลค่าก่อนภาษีของใบเสร็จ");
      const dup = docs().find((d) => d.type === "RC" && d.id !== rc.id && d.customer === rc.customer && d.whtCert && String(d.whtCert.no).trim().toLowerCase() === no.toLowerCase());
      if (dup) fail("เลขที่หนังสือ " + no + " ถูกบันทึกกับ " + dup.id + " ของลูกค้ารายนี้แล้ว");
      const had = !!rc.whtCert;
      rc.whtCert = { no, date: cert.date, amount, note: String(cert.note || "").trim(), by: S.userName(), at: S.now() };
      pushHistory(rc, "wht", had ? "received" : "pending", "received", (had ? "แก้ไข" : "บันทึก") + "หนังสือรับรองหัก ณ ที่จ่าย " + no + " ยอด " + amount.toLocaleString() + (Math.abs(amount - rc.wht) > 0.005 ? " (ต่างจากที่คำนวณ " + rc.wht.toLocaleString() + ")" : ""));
      S.log("WHT_CERT", "ใบเสร็จ", rc.id, (had ? "แก้ไข" : "บันทึก") + "หนังสือรับรอง " + no + " ยอด " + amount);
      return rc;
    });
  }

  // ---------------- ค่าเริ่มต้นฟอร์ม ----------------
  function blank(type) {
    return { type, customer: "", date: S.today(), due: "", refNo: "", note: "", vatOn: !NO_VAT_DEFAULT.includes(type), whtRate: 0, billDisc: 0,
      lines: [{ code: "", name: "", qty: 1, unit: "ชิ้น", price: 0, disc: 0 }], sourceIds: [] };
  }
  // เอกสารที่ยังเปิดอยู่ของลูกค้าเดียวกัน (ใช้รวมหลายใบเป็นเอกสารเดียว เช่น วางบิลรวม)
  function openSources(type, customer, target) {
    return docs().filter((d) => d.type === type && d.customer === customer && can("convert", d).ok && nextTypes(d).includes(target));
  }

  return {
    PREFIX, NEXT, TYPES, VAT_RATE, STATUS_LABEL,
    calc, lineAmount, get, children, parents, related, remainingLines, remainingValue, rcAmounts, paymentInfo, woUsed, setWhtCert, whtCertStatus, WHT_CERT_DAYS,
    statusInfo, can, canApproveType, canEditType, nextTypes, openSources, blank, addDays,
    saveDraft, submit, approve, reject, cancel, remove, convert, setShipStatus, createWorkOrders,
    isLive, isActive, label,
    billingRoot, planInfo, setBillingPlan, issueInstallment, instInvoices, isInstInv, installmentLock, MAX_INST,
  };
})();

window.Workflow = Workflow;
