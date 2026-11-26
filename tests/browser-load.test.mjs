// หน้าเว็บแปลง JSX ในเบราว์เซอร์ด้วย Babel และทุกไฟล์ใช้ global scope ร่วมกัน: object rest ({ a, ...rest }) สร้างตัวแปรช่วย
// ชื่อ _excluded ถ้ามีมากกว่า 1 ไฟล์ ไฟล์หลังจะโหลดไม่ขึ้นทั้งไฟล์ (หน้าเว็บขาว) — อนุญาตเฉพาะ icons.jsx ที่ใช้อยู่เดิม
// รัน: node tests/browser-load.test.mjs
import fs from "node:fs";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const objectRest = /(?:const|let|var)\s*\{[^{}]*\.\.\.\w+\s*\}\s*=|\(\s*\{[^{}()]*\.\.\.\w+\s*\}\s*\)\s*(?:=>|\{)/;
const files = fs.readdirSync(root).filter((f) => f.endsWith(".jsx") && objectRest.test(fs.readFileSync(new URL(f, root), "utf8")));
assert.deepEqual(files, ["icons.jsx"]);

console.log("ALL OK");
