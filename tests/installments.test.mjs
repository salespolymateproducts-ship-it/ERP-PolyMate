// ทดสอบกฎแผนเรียกเก็บแบบแบ่งงวด (1B) ของ Workflow แบบ headless (stub Store) — รัน: node tests/installments.test.mjs
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const src = fs.readFileSync(new URL("../workflow.jsx", import.meta.url), "utf8");
const counters = {};
const Store = {
  state: { docs: [], customers: [{ code: "C1", name: "ลูกค้าทดสอบ", nameEn: "Test", credit: 30, address: "x", taxId: "1" }], finished: [] },
  tx: (n, f) => f(), fail: (m) => { throw new Error(m); },
  user: () => ({ role: "admin" }), userName: () => "tester", now: () => "2026-11-21 10:00", today: () => "2026-11-21",
  nextDocNo: (p, d) => { counters[p] = (counters[p] || 0) + 1; return { docNo: p + "-" + String(counters[p]).padStart(3, "0"), seq: counters[p], counterKey: p }; },
  log() {}, remove() {}, canDelete: () => true, findStockItem: () => null, adjustStock() {},
};
const DOC_LABEL = Object.fromEntries(["CPO", "QT", "SO", "DO", "BN", "INV", "RC", "PAY"].map((t) => [t, { th: t, short: t }]));
const ROLES = { admin: { canEdit: "*", approve: "*", editApproved: true } };
const win = {}; const ctx = vm.createContext({ window: win, Store, DOC_LABEL, DOC_STATUS: {}, ROLES, FINISHED: [], console });
vm.runInContext(src, ctx);
const W = vm.runInContext("Workflow", ctx);

const throws = (fn, re) => { try { fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error("wrong error: " + e.message); return; } throw new Error("expected throw " + re); };
const mkQT = () => {
  const q = W.saveDraft({ type: "QT", customer: "C1", date: "2026-11-21", vatOn: true, lines: [{ code: "A", name: "สินค้า", qty: 10, unit: "ชิ้น", price: 100, disc: 0 }] });
  W.approve(q.id); return q;
};

// 1) ตั้งแผน 50/50 และออกงวด 1
const qt = mkQT();
assert.equal(qt.subtotal, 1000);
throws(() => W.setBillingPlan(qt.id, [{ label: "a", pct: 60 }, { label: "b", pct: 30 }]), /100/);
throws(() => W.setBillingPlan(qt.id, [{ label: "a", pct: 100 }]), /2 งวด/);
W.setBillingPlan(qt.id, [{ label: "ตอนสั่งซื้อ", pct: 50 }, { label: "ตอนส่งมอบ", pct: 50 }]);
let info = W.planInfo(W.get(qt.id));
assert.equal(info.rows[0].amount, 500); assert.equal(info.rows[0].vat, 35); assert.equal(info.rows[0].total, 535);
const i1 = W.issueInstallment(qt.id, 1);
assert.equal(i1.type, "INV"); assert.equal(i1.subtotal, 500); assert.equal(i1.vat, 35); assert.equal(i1.installment.no, 1);
assert.equal(JSON.stringify(i1.sourceIds), JSON.stringify([qt.id]));
throws(() => W.issueInstallment(qt.id, 1), /ออกใบกำกับแล้ว/);                       // งวดเดิมซ้ำไม่ได้
W.approve(i1.id);
info = W.planInfo(W.get(qt.id));
assert.equal(info.billedPct, 50); assert.equal(info.remaining, 500);
// แก้งวดที่ออกแล้วไม่ได้
throws(() => W.setBillingPlan(qt.id, [{ label: "ตอนสั่งซื้อ", pct: 40 }, { label: "ตอนส่งมอบ", pct: 60 }]), /ออกใบกำกับแล้ว/);
// แก้งวดที่ยังไม่ออกได้ (แบ่งงวดหลังเป็น 2 งวด)
W.setBillingPlan(qt.id, [{ label: "ตอนสั่งซื้อ", pct: 50 }, { label: "กลางทาง", pct: 20 }, { label: "ส่งมอบ", pct: 30 }]);
info = W.planInfo(W.get(qt.id));
assert.equal(info.rows[1].amount, 200); assert.equal(info.rows[2].amount, 300);
const i2 = W.issueInstallment(qt.id, 2);
const i3 = W.issueInstallment(qt.id, 3);
assert.equal(i3.subtotal, 300);
info = W.planInfo(W.get(qt.id));
assert.equal(info.remaining, 0);
// เกินยอดไม่ได้ (แก้ยอดงวดให้เกินผ่านการแก้ฉบับร่าง)
throws(() => W.saveDraft({ id: i3.id, type: "INV", customer: "C1", date: "2026-11-21", vatOn: true, lines: [{ code: "-", name: "x", qty: 1, unit: "งวด", price: 999, disc: 0 }] }), /เกินยอดที่เรียกเก็บได้/);
// ยกเลิกใบกำกับงวด → งวดกลับเป็นยังไม่ออก
W.cancel(i3.id, "ทดสอบ");
info = W.planInfo(W.get(qt.id));
assert.equal(info.rows[2].inv, null); assert.equal(info.remaining, 300);
throws(() => W.setBillingPlan(qt.id, []), /ยกเลิกก่อน/);                              // ยังมีงวดที่ใช้อยู่ ล้างแผนไม่ได้

// 2) ใบสั่งขายจาก QT: แผนอยู่ที่ QT · ออกงวดจาก root เดิมได้ · DO ออกใบกำกับไม่ได้
const so = W.convert({ sourceIds: [qt.id], targetType: "SO", approveTarget: true });
assert.equal(W.billingRoot(W.get(so.id)).id, qt.id);
throws(() => W.setBillingPlan(so.id, [{ label: "a", pct: 50 }, { label: "b", pct: 50 }]), /แผนเรียกเก็บของใบนี้อยู่ที่/);
const dd = W.convert({ sourceIds: [so.id], targetType: "DO", approveTarget: true });
assert.equal(W.can("convert", W.get(dd.id)).ok, false);
assert.match(W.can("convert", W.get(dd.id)).reason, /แบ่งงวด/);
throws(() => W.convert({ sourceIds: [dd.id], targetType: "INV" }), /แบ่งงวด/);

// 3) ย้อนกัน: ออกใบกำกับทางใบส่งสินค้าก่อน → ตั้งแผน/ออกงวดไม่ได้
const so2 = W.saveDraft({ type: "SO", customer: "C1", date: "2026-11-21", vatOn: true, lines: [{ code: "A", name: "สินค้า", qty: 5, unit: "ชิ้น", price: 100, disc: 0 }] });
W.approve(so2.id);
const do2 = W.convert({ sourceIds: [so2.id], targetType: "DO", approveTarget: true });
const inv2 = W.convert({ sourceIds: [do2.id], targetType: "INV" });
throws(() => W.setBillingPlan(so2.id, [{ label: "a", pct: 50 }, { label: "b", pct: 50 }]), /ใบส่งสินค้า/);
// 4) SO ที่ไม่มี QT เก็บแผนที่ตัวเอง
const so3 = W.saveDraft({ type: "SO", customer: "C1", date: "2026-11-21", vatOn: false, lines: [{ code: "A", name: "สินค้า", qty: 3, unit: "ชิ้น", price: 333.33, disc: 0 }] });
W.approve(so3.id);
W.setBillingPlan(so3.id, [{ label: "1", pct: 33.33 }, { label: "2", pct: 33.33 }, { label: "3", pct: 33.34 }]);
const p3 = W.planInfo(W.get(so3.id));
const sumAmt = Math.round(p3.rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
assert.equal(sumAmt, W.get(so3.id).subtotal);                                       // ผลรวมงวด = ยอดต้นทางพอดี (งวดสุดท้ายรับเศษ)
// ไม่ได้อนุมัติ root → ออกงวดไม่ได้
const q4 = W.saveDraft({ type: "QT", customer: "C1", date: "2026-11-21", vatOn: true, lines: [{ code: "A", name: "x", qty: 1, unit: "ชิ้น", price: 100, disc: 0 }] });
W.setBillingPlan(q4.id, [{ label: "1", pct: 50 }, { label: "2", pct: 50 }]);
throws(() => W.issueInstallment(q4.id, 1), /ต้องอนุมัติ/);
console.log("ALL OK");
