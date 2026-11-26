// ทดสอบการขายเป็นลังของ Workflow แบบ headless (stub Store) — รัน: node tests/cartons.test.mjs
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const src = fs.readFileSync(new URL("../workflow.jsx", import.meta.url), "utf8");
const counters = {};
const stockMoves = [];
const Store = {
  state: { docs: [], customers: [{ code: "C1", name: "ลูกค้าทดสอบ", credit: 30 }], rvSettled: {},
    finished: [{ code: "BLADE", name: "ใบพัด", unit: "ใบ", packSize: 20 }, { code: "LOOSE", name: "ขายปลีก", unit: "ใบ" }, { code: "OFF", name: "ปิดแล้ว", unit: "ใบ", active: false }] },
  tx: (n, f) => f(), fail: (m) => { throw new Error(m); },
  user: () => ({ role: "admin" }), userName: () => "tester", now: () => "2026-11-26 10:00", today: () => "2026-11-26",
  nextDocNo: (p) => { counters[p] = (counters[p] || 0) + 1; return { docNo: p + "-" + String(counters[p]).padStart(3, "0"), seq: counters[p], counterKey: p }; },
  log() {}, remove() {}, canDelete: () => true, findStockItem: (code) => ({ rec: { code, cost: 1 } }), adjustStock: (code, delta) => stockMoves.push([code, delta]),
};
const DOC_LABEL = Object.fromEntries(["CPO", "QT", "SO", "DO", "BN", "INV", "RC", "PAY", "CN", "DN"].map((t) => [t, { th: t, short: t }]));
const ROLES = { admin: { canEdit: "*", approve: "*", editApproved: true } };
const win = {}; const ctx = vm.createContext({ window: win, Store, DOC_LABEL, DOC_STATUS: {}, ROLES, FINISHED: [], console });
vm.runInContext(src, ctx);
const W = vm.runInContext("Workflow", ctx);
const throws = (fn, re) => { try { fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error("wrong error: " + e.message); return; } throw new Error("expected throw " + re); };
const line = (code, qty, extra) => ({ code, name: code, qty, unit: "ใบ", price: 10, disc: 0, ...extra });
const make = (type, lines) => W.saveDraft({ type, customer: "C1", date: "2026-11-26", lines });

assert.equal(W.packCount(100, 20), 5);
assert.equal(W.packCount(30, 20), null);
assert.equal(W.packCount(30, undefined), null);

// ต้องเต็มลัง · จำนวนต่อลังถูกบันทึกติดรายการ · สินค้าที่ไม่ตั้งลังขายเป็นชิ้นตามเดิม
throws(() => make("QT", [line("BLADE", 30)]), /ลังเต็ม/);
const so = make("SO", [line("BLADE", 100), line("LOOSE", 7)]);
assert.equal(so.lines[0].packSize, 20);
assert.equal(so.lines[1].packSize, undefined);
assert.equal(so.subtotal, 1070);                                // 107 ชิ้น × 10 ก่อน VAT
throws(() => make("QT", [line("OFF", 1)]), /ปิดใช้งาน/);
W.approve(so.id);

// แก้จำนวนต่อลังในทะเบียนภายหลัง เอกสารเดิมไม่เปลี่ยน
Store.state.finished[0].packSize = 24;
throws(() => W.convert({ sourceIds: [so.id], targetType: "DO", picks: [{ doc: so.id, line: 0, qty: 24 }] }), /ลังเต็ม/);
const dn = W.convert({ sourceIds: [so.id], targetType: "DO", picks: [{ doc: so.id, line: 0, qty: 40 }] });
assert.equal(dn.lines[0].packSize, 20);
W.approve(dn.id);
assert.deepEqual(stockMoves.at(-1), ["BLADE", -40]);             // ตัดสต๊อกเป็นชิ้น

// เอกสารเก่าที่ไม่มีข้อมูลลัง แก้ต่อได้ ไม่ถูกบังคับย้อนหลัง
Store.state.docs.push({ id: "QT-OLD", type: "QT", status: "draft", customer: "C1", date: "2026-11-01", history: [], sourceIds: [], lines: [line("BLADE", 7)] });
const old = W.saveDraft({ id: "QT-OLD", type: "QT", customer: "C1", date: "2026-11-01", lines: [line("BLADE", 9)] });
assert.equal(old.lines[0].packSize, undefined);

// ใบลดหนี้ระบุเป็นชิ้นได้
const inv = make("INV", [line("BLADE", 48)]);
W.approve(inv.id);
const cn = W.issueNote("CN", inv.id, { reason: "คืนสินค้า/สินค้าเคลม", mode: "all" });
assert.equal(cn.lines[0].packSize, 24);
W.saveDraft({ ...cn, lines: [{ ...cn.lines[0], qty: 3 }] });

console.log("ALL OK");
