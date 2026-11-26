// ทดสอบกลุ่มราคาของ Workflow แบบ headless (stub Store) — รัน: node tests/pricegroups.test.mjs
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const src = fs.readFileSync(new URL("../workflow.jsx", import.meta.url), "utf8");
const counters = {};
let role = "admin";
const Store = {
  state: { docs: [], customers: [{ code: "C1", name: "ลูกค้าทดสอบ", credit: 30 }], rvSettled: {},
    finished: [{ code: "A", name: "ใบพัด A", unit: "ใบ", packSize: 20, price: 12 }, { code: "B", name: "ใบพัด B", unit: "ใบ", packSize: 10, price: 15 }, { code: "X", name: "นอกกลุ่ม", unit: "ใบ", price: 50 }],
    priceGroups: [{ id: "PG1", name: "ใบพัด", active: true, tiers: [5, 10], items: [{ code: "A", prices: [10, 8] }, { code: "B", prices: [11, 9] }] }] },
  tx: (n, f) => f(), fail: (m) => { throw new Error(m); },
  user: () => ({ role }), userName: () => "tester-" + role, now: () => "2026-11-26 10:00", today: () => "2026-11-26",
  nextDocNo: (p) => { counters[p] = (counters[p] || 0) + 1; return { docNo: p + "-" + String(counters[p]).padStart(3, "0"), seq: counters[p], counterKey: p }; },
  log() {}, remove() {}, canDelete: () => true, findStockItem: () => null, adjustStock() {},
};
const DOC_LABEL = Object.fromEntries(["CPO", "QT", "SO", "DO", "BN", "INV", "RC", "PAY", "CN", "DN"].map((t) => [t, { th: t, short: t }]));
const ALL = { canEdit: "*", approve: "*", editApproved: true };
const ROLES = { admin: ALL, sales: ALL, accounting: ALL };
const win = {}; const ctx = vm.createContext({ window: win, Store, DOC_LABEL, DOC_STATUS: {}, ROLES, FINISHED: [], console });
vm.runInContext(src, ctx);
const W = vm.runInContext("Workflow", ctx);
const throws = (fn, re) => { try { fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error("wrong error: " + e.message); return; } throw new Error("expected throw " + re); };
const line = (code, qty, extra) => ({ code, name: code, qty, unit: "ใบ", price: 0, disc: 0, ...extra });
const make = (type, lines) => W.saveDraft({ type, customer: "C1", date: "2026-11-26", lines });
const prices = (d) => d.lines.map((l) => l.price).join(",");
const resave = (d, lines) => W.saveDraft({ ...d, lines });

// ต่ำกว่าขั้นแรก → ราคาปกติ · คละสินค้านับลังรวม · ถึงขั้นไหนได้ราคาขั้นนั้นทุกรายการ
assert.equal(prices(make("QT", [line("A", 40), line("B", 20)])), "12,15");       // 2 + 2 = 4 ลัง
assert.equal(prices(make("QT", [line("A", 60), line("B", 20)])), "10,11");       // 3 + 2 = 5 ลัง
const big = make("QT", [line("A", 180), line("B", 10), line("X", 3, { price: 50 })]);   // 9 + 1 = 10 ลัง
assert.equal(prices(big), "8,9,50");
assert.equal(big.lines[2].priceMode, undefined);                                  // นอกกลุ่มทำงานแบบเดิม

// แก้จำนวนในฉบับร่าง → คำนวณใหม่
assert.equal(prices(resave(big, [{ ...big.lines[0], qty: 80 }, big.lines[1], big.lines[2]])), "10,11,50");

// ฝ่ายขายแก้ราคาทับได้ บันทึกผู้แก้ · ระบบไม่คำนวณทับ · รายการแก้เองยังนับเข้ายอดรวมกลุ่ม
role = "sales";
const q = make("QT", [line("A", 100), line("B", 50)]);
const over = resave(q, [{ ...q.lines[0], price: 7, priceMode: "manual" }, q.lines[1]]);
assert.equal(prices(over), "7,9");
assert.equal(over.lines[0].priceBy, "tester-sales");
assert.equal(over.lines[0].autoPrice, 8);
assert.equal(prices(resave(over, [{ ...over.lines[0], priceMode: "auto" }, over.lines[1]])), "8,9");

// บัญชีแก้ราคาทับไม่ได้ แต่แก้ส่วนอื่นของเอกสารที่มีราคาทับอยู่ได้
const o2 = resave(q, [{ ...q.lines[0], price: 6, priceMode: "manual" }, q.lines[1]]);
role = "accounting";
throws(() => resave(o2, [{ ...o2.lines[0], price: 1 }, o2.lines[1]]), /เฉพาะผู้ดูแลระบบและฝ่ายขาย/);
assert.equal(resave(o2, o2.lines).lines[0].priceBy, "tester-sales");
assert.equal(prices(make("QT", [line("A", 200, { price: 1 })])), "8");           // ส่งราคาเองโดยไม่ระบุโหมด → คิดอัตโนมัติ
role = "admin";

// อนุมัติแล้วราคาไม่เปลี่ยน แม้แก้ตารางราคา · สั่งครบตามที่เสนอ ใช้ราคาที่เสนอ
const ap = make("QT", [line("A", 200)]);
W.approve(ap.id);
Store.state.priceGroups[0].items[0].prices = [99, 99];
const so = W.convert({ sourceIds: [ap.id], targetType: "SO" });
assert.equal(prices(so), "8");
assert.equal(so.lines[0].repriced, undefined);
assert.equal(prices(W.get(ap.id)), "8");
Store.state.priceGroups[0].items[0].prices = [10, 8];

// สั่งน้อยกว่าที่เสนอ → คิดราคาใหม่ตามจำนวนที่สั่งจริง (ทั้งแบ่งออก และแก้จำนวนในใบสั่งขายฉบับร่าง)
const quote = () => { const q = make("QT", [line("A", 160), line("B", 20)]); W.approve(q.id); return q; };   // 8 + 2 = 10 ลัง → 8, 9
const order = (q, a, b) => W.convert({ sourceIds: [q.id], targetType: "SO", picks: [{ doc: q.id, line: 0, qty: a }, { doc: q.id, line: 1, qty: b }] });
const q1 = quote();
assert.equal(prices(q1), "8,9");
const part = order(q1, 40, 0);                                                    // 2 ลัง ต่ำกว่าขั้นแรก → ราคาปกติ
assert.equal(prices(part), "12");
assert.equal(part.lines[0].repriced, true);
assert.equal(prices(order(q1, 120, 0)), "10");                                   // 6 ลังที่เหลือ → ขั้น 5+
assert.equal(prices(order(quote(), 100, 20)), "10,11");                          // คละ 5 + 2 = 7 ลัง
const full = order(quote(), 160, 20);
assert.equal(prices(full), "8,9");
const less = resave(full, [{ ...full.lines[0], qty: 40 }, full.lines[1]]);        // แก้เหลือ 2 + 2 = 4 ลัง
assert.equal(prices(less), "12,15");
const restored = resave(less, [{ ...less.lines[0], qty: 160 }, less.lines[1]]);  // กลับมาครบ → ราคาที่เสนอ
assert.equal(prices(restored), "8,9");
assert.equal(restored.lines[0].repriced, undefined);

// ใบเสนอราคาที่ตั้งแผนแบ่งงวดไว้ คงราคาเดิม
const planned = quote();
planned.plan = [{ label: "งวดที่ 1", pct: 100 }];
assert.equal(prices(order(planned, 40, 0)), "8");

// ฝ่ายบัญชีแบ่งออกใบสั่งขายได้ ได้ราคาคิดใหม่เหมือนกัน
const qa = quote();
role = "accounting";
assert.equal(prices(order(qa, 40, 0)), "12");
role = "admin";

// เอกสารเก่าที่กรอกราคาเองก่อนมีกลุ่มราคา ไม่ถูกคำนวณทับ
Store.state.docs.push({ id: "QT-OLD", type: "QT", status: "draft", customer: "C1", date: "2026-11-01", history: [], sourceIds: [], lines: [line("A", 200, { price: 13 })] });
assert.equal(prices(W.saveDraft({ id: "QT-OLD", type: "QT", customer: "C1", date: "2026-11-01", lines: [line("A", 200, { price: 13 })] })), "13");

// ปิดกลุ่ม → ฉบับร่างที่บันทึกใหม่กลับเป็นราคาปกติ
Store.state.priceGroups[0].items[0].prices = [10, 8];
const d = make("SO", [line("A", 200)]);
Store.state.priceGroups[0].active = false;
assert.equal(prices(resave(d, d.lines)), "12");

console.log("ALL OK");
