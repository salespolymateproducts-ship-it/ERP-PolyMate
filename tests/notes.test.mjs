// ทดสอบกฎใบลดหนี้ (CN) / ใบเพิ่มหนี้ (DN) ของ Workflow แบบ headless (stub Store) — รัน: node tests/notes.test.mjs
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const src = fs.readFileSync(new URL("../workflow.jsx", import.meta.url), "utf8");
const counters = {};
const Store = {
  state: { docs: [], customers: [{ code: "C1", name: "ลูกค้าทดสอบ", nameEn: "Test", credit: 30, address: "x", taxId: "1" }, { code: "C2", name: "ลูกค้า 2", credit: 30 }], finished: [], rvSettled: {} },
  tx: (n, f) => f(), fail: (m) => { throw new Error(m); },
  user: () => ({ role: "admin" }), userName: () => "tester", now: () => "2026-11-21 10:00", today: () => "2026-11-21",
  nextDocNo: (p) => { counters[p] = (counters[p] || 0) + 1; return { docNo: p + "-" + String(counters[p]).padStart(3, "0"), seq: counters[p], counterKey: p }; },
  log() {}, remove() {}, canDelete: () => true, findStockItem: () => null, adjustStock() {},
};
const DOC_LABEL = Object.fromEntries(["CPO", "QT", "SO", "DO", "BN", "INV", "RC", "PAY", "CN", "DN"].map((t) => [t, { th: t, short: t }]));
const ROLES = { admin: { canEdit: "*", approve: "*", editApproved: true } };
const win = {}; const ctx = vm.createContext({ window: win, Store, DOC_LABEL, DOC_STATUS: {}, ROLES, FINISHED: [], console });
vm.runInContext(src, ctx);
const W = vm.runInContext("Workflow", ctx);
const throws = (fn, re) => { try { fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error("wrong error: " + e.message); return; } throw new Error("expected throw " + re); };

// ใบกำกับ 1,000 + VAT 70 = 1,070 (ลูกค้าหัก ณ ที่จ่าย 3% = 30 → สุทธิ 1,040)
const mkInv = (whtRate = 0) => { const d = W.saveDraft({ type: "INV", customer: "C1", date: "2026-11-21", vatOn: true, whtRate, lines: [{ code: "A", name: "สินค้า", qty: 10, unit: "ชิ้น", price: 100, disc: 0 }] }); W.approve(d.id); return d; };
const inv = mkInv();
assert.equal(inv.total, 1070);

// ต้องมีเหตุผล · ฉบับร่างไม่กระทบยอด
throws(() => W.issueNote("CN", inv.id, { mode: "amount", amount: 100 }), /เหตุผล/);
const cn1 = W.issueNote("CN", inv.id, { reason: "ลดราคา/ส่วนลด", mode: "amount", amount: 200, label: "ส่วนลด" });
assert.equal(cn1.type, "CN"); assert.equal(cn1.subtotal, 200); assert.equal(cn1.vat, 14); assert.equal(cn1.total, 214); assert.equal(cn1.status, "draft");
assert.equal(JSON.stringify(cn1.sourceIds), JSON.stringify([inv.id]));
assert.equal(W.paymentInfo(inv).outstanding, 1070);                                     // ยังไม่อนุมัติ → ยังไม่ปรับ
// อนุมัติ → ลดยอดคงค้าง
W.approve(cn1.id);
let p = W.paymentInfo(W.get(inv.id));
assert.equal(p.outstanding, 856); assert.equal(p.overpaid, 0); assert.equal(p.adjusted, -214);
// ใบกำกับที่มีใบลดหนี้แล้ว ยกเลิก/แก้ไขไม่ได้ (ต้องยกเลิกใบลดหนี้ก่อน)
assert.equal(W.can("cancel", W.get(inv.id)).ok, false);
assert.equal(W.can("edit", W.get(inv.id)).ok, false);

// ลดเกินมูลค่าใบกำกับไม่ได้ (เหลือ 800 ก่อน VAT)
const over = W.issueNote("CN", inv.id, { reason: "ลดราคา/ส่วนลด", mode: "amount", amount: 801 });   // ฉบับร่างบันทึกได้ แต่ส่งอนุมัติไม่ได้
throws(() => W.submit(over.id), /เกินมูลค่า/);
W.cancel(over.id, "ทดสอบ");
const cn2 = W.issueNote("CN", inv.id, { reason: "คืนสินค้า/สินค้าเคลม", mode: "all" });       // ยกทุกรายการ = 1,000 → เกิน (เหลือ 800)
assert.equal(cn2.subtotal, 1000);
throws(() => W.submit(cn2.id), /เกินมูลค่า/);
W.saveDraft({ id: cn2.id, type: "CN", customer: "C1", date: "2026-11-21", reason: "คืนสินค้า/สินค้าเคลม", lines: [{ code: "A", name: "สินค้า", qty: 8, unit: "ชิ้น", price: 100, disc: 0 }] });
W.approve(cn2.id);                                                                       // 800 พอดี
p = W.paymentInfo(W.get(inv.id));
assert.equal(p.outstanding, 0); assert.equal(p.adjusted, -214 - 856);

// ใบเพิ่มหนี้ปรับยอดขึ้น และเปิดวงเงินลดหนี้เพิ่ม
const dn = W.issueNote("DN", inv.id, { reason: "ค่าใช้จ่ายเพิ่มเติม", mode: "amount", amount: 50, label: "ค่าขนส่งเพิ่ม" });
W.approve(dn.id);
p = W.paymentInfo(W.get(inv.id));
assert.equal(p.outstanding, 53.5);                                                       // 0 + 50 + VAT 3.5
const nadj = W.noteAdj(W.get(inv.id));
assert.equal(nadj.cn.n, 2); assert.equal(nadj.dn.n, 1); assert.equal(nadj.subtotal, -950);

// จ่ายผ่านใบรับเงิน (RV) แล้วลดหนี้ → จ่ายเกิน ต้องแจ้งให้คืนเงิน
const invB = mkInv();
Store.state.rvSettled[invB.id] = 1070;                                                  // รับครบแล้ว
const cnB = W.issueNote("CN", invB.id, { reason: "ลดราคา/ส่วนลด", mode: "amount", amount: 100 });
W.approve(cnB.id);
p = W.paymentInfo(W.get(invB.id));
assert.equal(p.outstanding, 0); assert.equal(p.overpaid, 107);
// ยกเลิกใบลดหนี้ → กลับเป็นเดิม
W.cancel(cnB.id, "ทดสอบ");
p = W.paymentInfo(W.get(invB.id));
assert.equal(p.overpaid, 0);

// กฎอื่น: ต้องอ้างอิงใบกำกับที่อนุมัติแล้ว · วันที่ห้ามก่อนใบกำกับ · VAT/หัก ณ ที่จ่ายตามต้นทาง · ไม่กินจำนวนคงเหลือของใบกำกับ
const draftInv = W.saveDraft({ type: "INV", customer: "C1", date: "2026-11-21", vatOn: true, lines: [{ code: "A", name: "x", qty: 1, unit: "ชิ้น", price: 100, disc: 0 }] });
throws(() => W.issueNote("CN", draftInv.id, { reason: "ลดราคา/ส่วนลด", mode: "amount", amount: 10 }), /อนุมัติ/);
throws(() => W.issueNote("CN", inv.id, { reason: "ลดราคา/ส่วนลด", mode: "amount", amount: 10, date: "2026-11-01" }), /ก่อนวันที่/);
const invW = mkInv(3);
const cnW = W.issueNote("CN", invW.id, { reason: "ลดราคา/ส่วนลด", mode: "amount", amount: 100 });
assert.equal(cnW.whtRate, 3); assert.equal(cnW.vatOn, true);
assert.equal(W.saveDraft({ id: cnW.id, type: "CN", customer: "C1", date: "2026-11-21", reason: "ลดราคา/ส่วนลด", vatOn: false, whtRate: 0, lines: cnW.lines }).vatOn, true);   // แก้ VAT ไม่ได้
W.approve(cnW.id);
assert.equal(W.paymentInfo(W.get(invW.id)).outstanding, invW.net - cnW.net);
assert.equal(W.remainingLines(W.get(invW.id))[0].remaining, 10);                          // ใบกำกับยังออกใบวางบิล/ใบเสร็จครบจำนวนเดิมได้
assert.equal(W.can("convert", W.get(invW.id)).ok, true);
// ลูกค้าไม่ตรง → ไม่ได้
throws(() => W.saveDraft({ id: cnW.id, type: "CN", customer: "C2", date: "2026-11-21", reason: "ลดราคา/ส่วนลด", lines: cnW.lines }), /ลูกค้า/);
// สร้างเปล่า ๆ ไม่มีต้นทางไม่ได้
throws(() => W.saveDraft({ type: "CN", customer: "C1", date: "2026-11-21", reason: "ลดราคา/ส่วนลด", lines: [{ code: "A", name: "x", qty: 1, unit: "ชิ้น", price: 1, disc: 0 }] }), /ใบกำกับ/);

console.log("ALL OK");
