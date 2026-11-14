# PolyMate ERP — Development Roadmap (Phase B1–B7)

วันที่: 2026-11-12 · สถานะ: **ร่างเพื่อขออนุมัติ**
กติกา: ทำทีละ Phase · ก่อนเริ่มแต่ละ Phase ส่งแผนย่อย (ไฟล์ที่แก้/สร้าง, ผลกระทบ, ความเสี่ยง, test case) และ **รออนุมัติ** · จบ Phase ส่งรายงาน + อัปเดต `docs/DEVLOG.md`, `Database-Schema.md`, `API-Specification.md`

---

## 0. วิธีทำงานร่วมกัน

| เรื่อง | กติกา |
|---|---|
| Git | branch ต่อ Phase (`phase/b2-backend-core` …) · tag ก่อนเริ่มทุก Phase (`pre-b2`, `pre-b3` …) · `main` ต้องเปิดระบบได้เสมอ · merge เมื่อผ่านเกณฑ์และผู้ใช้อนุมัติ |
| Rollback โค้ด | `git checkout pre-bN` · ระบบเดิมที่ root ไม่ถูกแก้จนถึง B3 จึงใช้งานต่อได้ตลอด |
| Rollback DB | ทุก migration มี `down` + dump อัตโนมัติก่อน migrate |
| ความรุนแรงบั๊ก | Critical (ข้อมูลเสีย/ความปลอดภัย) · High (ใช้งานหลักไม่ได้/ยอดผิด) · Medium · Low — Critical/High ต้องแก้ก่อนปิด Phase |
| Test | Unit (Vitest) · Integration กับ PostgreSQL จริงใน Docker · Concurrency (ยิงพร้อมกัน) · E2E (Playwright) เริ่ม B3 · CI รันทุก commit (GitHub Actions ถ้ามี remote, ไม่งั้นรันในเครื่องด้วย `npm test`) |
| สิ่งที่ต้องเตรียม | ติดตั้ง Node.js 22 LTS ในเครื่องพัฒนา (หรือพัฒนาใน Docker ทั้งหมด) · ตัดสินใจ D-1…D-10 · ปิดประเด็น C-1…C-10 ([Cloud-Infrastructure §10](Cloud-Infrastructure.md)) · เปิดบัญชี Cloud ในนามบริษัทก่อน B3 (ต้องมี Staging) |
| สภาพแวดล้อม | Dev = Docker ในเครื่องพัฒนา (B2) · Staging = Cloud VM (ตั้งแต่ B3) · Production = Cloud VM (B7) — ใช้ `docker-compose.yml` ชุดเดียวกัน |

---

## B1 — System Architecture & Database Design ✅ (ส่งมอบแล้ว รออนุมัติ)
ผลงาน: Backend-Architecture.md · Database-Schema.md · API-Specification.md · Data-Migration-Plan.md · Development-Roadmap.md
ไม่มีการแก้ Source Code

---

## B2 — Backend Core

**เป้าหมาย:** server รันได้ด้วย Docker Compose, มี DB + migration, login/session จริง, ผู้ใช้/role/permission, audit log, กรอบ transaction/error/logging · **ยังไม่เชื่อม UI** (ระบบเดิมยังใช้ localStorage)

| สร้างใหม่ | แก้ไข |
|---|---|
| `server/` (package.json, tsconfig, src/app.ts, config, http/middleware: auth, csrf, rbac, idempotency, error, request-id) · `server/src/db/migrations/0001_identity.ts` (departments, users, roles, permissions, sessions, password_history), `0002_audit.ts` (audit_logs + trigger), `0003_system.ts` (app_settings, idempotency_keys, attachments, migration_runs) · `services/auth` (รวม 2FA TOTP ถ้าอนุมัติ C-6), `users`, `audit` · `deploy/docker-compose.yml`, `Caddyfile`, `.env.example`, `provision.sh` (ร่าง, ทดสอบจริงใน B3) · storage interface ไฟล์แนบ (local/S3) · `server/test/**` · `docs/DEVLOG.md` | `.gitignore` (เพิ่ม `node_modules/`, `deploy/.env`, `migration/`) · (ถ้าอนุมัติ) `store.jsx:358` แก้ regex F-01 |

**ผลกระทบต่อระบบเดิม:** ไม่มี (ไม่แตะไฟล์ UI)
**ความเสี่ยง:** ตั้งค่า Docker บน Windows / HTTPS ภายใน → ใช้ Caddy `tls internal` สำหรับทดสอบในเครื่อง (Cloud ใช้ Let's Encrypt ตั้งแต่ B3)

| Test case | เกณฑ์ผ่าน |
|---|---|
| Login ถูก/ผิด, บัญชีระงับ, ล็อกหลังผิด 10 ครั้ง, rate limit | ตอบ 200/401/403/429 ถูกต้อง, `LOGIN_FAIL` ถูกบันทึก |
| บังคับเปลี่ยนรหัสครั้งแรก, ห้ามใช้รหัสซ้ำ 5 ครั้ง | API อื่นตอบ `PASSWORD_CHANGE_REQUIRED` จนกว่าจะเปลี่ยน |
| Rehash รหัส SHA-256 เดิม → Argon2id | login ด้วยรหัสเดิมได้ และ `password_algo` เปลี่ยน |
| CSRF: POST ไม่มี/ผิด token, Origin แปลกปลอม | 403 |
| RBAC: ทุก route ที่ต้องมีสิทธิ์ ถูกเรียกโดยผู้ไม่มีสิทธิ์ | 403 ทุกเส้น (test สร้างอัตโนมัติจากตาราง route) |
| ระงับผู้ใช้ระหว่างใช้งาน | request ถัดไปของผู้ใช้นั้น 401 |
| Audit log: UPDATE/DELETE ด้วยผู้ใช้แอป | DB ปฏิเสธ |
| Transaction: error กลางคำสั่ง | ไม่มีแถวใดถูกเขียน รวม audit |
| Idempotency: ส่งคำสั่งเดิมซ้ำ 2 ครั้ง | ผลเดียว, สร้างข้อมูลครั้งเดียว |
| Backup/restore script ขั้นต้น | dump → เข้ารหัส → restore ลง DB ใหม่ → จำนวนแถวตรง |
| 2FA (ถ้าอนุมัติ C-6): Admin/ผู้อนุมัติ login โดยไม่มีรหัส 6 หลัก / รหัสผิด / รหัสสำรอง | ถูกปฏิเสธ / ถูกปฏิเสธ + log / ใช้ได้ครั้งเดียว |
| API 2 instance ใช้ DB เดียวกัน (จำลองการขยายขั้น 4) | session ใช้ข้ามเครื่องได้, งานเบื้องหลังไม่รันซ้อน |
| SQL injection ในทุก query param (ชุด payload มาตรฐาน) | ไม่มีผล (ใช้ parameterized query ทั้งหมด) |

---

## B3 — Existing Workflow Migration

**เป้าหมาย:** เอกสารขายเดิม QT→SO→DO→BN→INV→RC→PAY และทุกโมดูลที่มีอยู่ทำงานบน Backend โดยหน้าตา UI เหมือนเดิม · ย้ายข้อมูลจริง · Vite build

| สร้างใหม่ | แก้ไข |
|---|---|
| migrations: master data (companies, customers, suppliers, products, warehouses, boms, machines, molds, vehicles, employees), documents (doc_types, number_sequences, documents, document_lines, document_links, status_history, revisions), payments/ar_items/allocations (เท่าที่สายขายเดิมใช้), work_orders, qc, shipments, stock_balances/stock_transactions (แบบปริมาณ ยังไม่คิดต้นทุนใหม่) · `server/src/domain/` (port จาก `workflow.jsx`) · `services/documents`, `inventory`, `production` · `/bootstrap`, `/changes` · `scripts/migrate-legacy.ts`, `verify-migration.ts` · `api-client.js` (frontend) · `main.jsx`, `vite.config.js`, `package.json` (root) · `e2e/` | `store.jsx` (ไส้ในเป็น API + cache, คง interface) · `workflow.jsx` (ฟังก์ชันเขียนเรียก API, ฟังก์ชันคำนวณคงไว้) · `ui-kit.jsx` (`runAction` รองรับ Promise, ปุ่ม loading) · `page-*.jsx` เฉพาะบรรทัดที่เรียก `runAction`/`Store.state.*.unshift` (molds, production) · `page-login.jsx` (เรียก `/auth`) · `page-more.jsx` (จัดการผู้ใช้ผ่าน API) · `index.html` (โหลด bundle จาก Vite, ตัด Babel/CDN) |

**ผลกระทบ:** ทุกหน้าที่เขียนข้อมูล (ดู Backend-Architecture §1.2) — เปลี่ยนเฉพาะการเรียก ไม่เปลี่ยน JSX/CSS · Babel ในเบราว์เซอร์ถูกตัดออก โหลดเร็วขึ้น · มี flag `DATA_MODE=local|api` สลับกลับได้
**ความเสี่ยง:** (1) พฤติกรรม engine ใหม่ต่างจากเดิม → test เทียบผล 2 engine ด้วยข้อมูลชุดเดียวกัน (2) ตัวแปร global ระหว่างไฟล์เมื่อเปลี่ยนเป็น ES module → ตรวจทุกไฟล์ว่าอ่าน/ส่งออกผ่าน `window` ครบ ก่อนเปิด Vite (3) การกดซ้ำเมื่อเป็น async → disable ปุ่ม + Idempotency-Key

| Test case | เกณฑ์ผ่าน |
|---|---|
| ชุด Engine เดิม 29 กรณี (QT→SO→DO บางส่วน 2 ใบ→BN รวม→INV→RC→รับชำระ 2 งวด) รันผ่าน API | 29/29 |
| ชุดข้ามโมดูลเดิม 21 กรณี (PO→รับของ→SO→WO→ผลิต ตัด BOM→QC→DO→INV→รับชำระ) | 21/21 · สต๊อก/ลูกหนี้ตรงกับระบบเดิม |
| กันซ้ำ/เกินคงเหลือ/จ่ายเกิน/ยกเลิกเมื่อมีปลายทาง/สต๊อกไม่พอ | ถูกปฏิเสธด้วยข้อความเดียวกับเดิม |
| **หลายคนพร้อมกัน:** 2 ผู้ใช้ออก DO จาก SO เดียวกันพร้อมกัน รวมเกินคงเหลือ (ยิง 20 รอบ) | สำเร็จได้ไม่เกินคงเหลือ, ไม่มีรอบใดเกิน |
| 2 ผู้ใช้รับชำระใบเสร็จเดียวกันพร้อมกัน | ยอดรวมไม่เกินยอดค้าง |
| 2 ผู้ใช้แก้ฉบับร่างเดียวกัน | คนที่สองได้ 409 + ข้อความให้โหลดใหม่ |
| ผู้ใช้ A อนุมัติ → ผู้ใช้ B เห็นสถานะใหม่ | ภายใน 15 วินาทีโดยไม่ refresh |
| Migration dry-run ด้วยไฟล์จริง + ไฟล์ทดสอบที่มีทุกกรณี | V-1…V-10 ผ่าน (Data-Migration-Plan §5) |
| ติดตั้ง Staging บน Cloud ด้วย `provision.sh` จากเครื่องเปล่า | ใช้งานผ่าน HTTPS ได้ภายใน 1 ชม., backup รายวันไป Object storage ทำงาน |
| ใช้งานผ่านเน็ตมือถือ 4G (จำลองสำรองเมื่อเน็ตโรงงานล่ม) | ทุกหน้าโหลดได้ ใช้งานได้ปกติ |
| E2E: เปิดทุกหน้า 17 หน้า + ทุก drawer/modal | ไม่มี console error, ภาพหน้าจอเทียบก่อน/หลังต่างเฉพาะ spinner |
| พิมพ์ A4 ทุกเอกสาร (21 ไฟล์เดิม) | ขนาด/จำนวนหน้าเหมือนรายงาน A4 |
| สลับ `DATA_MODE=local` | ระบบเดิมทำงานได้ |

---

## B4 — Document Control & Approval

**เป้าหมาย:** Delete/Cancel ตามข้อกำหนด, Maker-Checker, อนุมัติหลายขั้นตามวงเงิน/แผนก, ส่งกลับแก้ไข, Revision, แจ้งเตือน, เลขเอกสารตาม D-6

| สร้างใหม่ | แก้ไข |
|---|---|
| migrations: approval_policies/steps/requests/actions, notifications, fiscal_periods (ย้ายมาจาก B5 เพราะกฎยกเลิกย้อนหลังต้องใช้), คอลัมน์ `cancel_pending`/`draft_no` · `services/approval` · หน้าจอ Admin: นโยบายอนุมัติ, role/permission (ใช้ component เดิมใน ui-kit) · หน้า "รออนุมัติ" (inbox) | `workflow.jsx` (`can()` อ่านสิทธิ์จาก server, ปุ่ม ส่งกลับ/ขอยกเลิก) · `page-sales.jsx` (แสดงขั้นอนุมัติ, ผู้จัดทำ/ผู้อนุมัติ, revision) · `shell.jsx` (แจ้งเตือนงานรออนุมัติจาก server) · `page-more.jsx` |

**ผลกระทบ:** ผู้ที่เคยอนุมัติเอกสารตัวเองได้ (เช่น Admin) จะทำไม่ได้แล้ว → ต้องกำหนดผู้อนุมัติสำรองก่อนเปิดใช้
**ความเสี่ยง:** บริษัทมีคนน้อย อนุมัติติดขัด → `allow_self_approval` ต่อนโยบาย (ปิดเป็นค่าเริ่มต้น บันทึก audit ทุกครั้ง)

| Test case | เกณฑ์ผ่าน |
|---|---|
| ผู้จัดทำอนุมัติเอกสารตนเอง (ทุกประเภท, ทุก role รวม admin) | 403 `SELF_APPROVAL_NOT_ALLOWED` |
| PO 30,000 / 80,000 บาท | 1 ขั้น / 2 ขั้นตามนโยบาย, ขั้น 2 ทำก่อนขั้น 1 ไม่ได้, คนเดียวอนุมัติ 2 ขั้นไม่ได้ |
| ผู้อนุมัติต่างแผนก (scope same_department) | 403 |
| แก้นโยบายระหว่างมีคำขอค้าง | คำขอเดิมใช้ขั้นตอนเดิม (snapshot) |
| ส่งกลับแก้ไข → แก้ → ส่งใหม่ | เริ่มขั้น 1 ใหม่, ประวัติครบ |
| ลบร่างที่ไม่มีอ้างอิง / ที่มีอ้างอิง / ที่อนุมัติแล้ว | สำเร็จ / 409 / 422 |
| ยกเลิกเอกสารอนุมัติแล้วที่มีนโยบาย cancel | `cancel_pending` → อนุมัติ → `cancelled` + รายการกลับ |
| ยกเลิกซ้ำ (รวมยิงพร้อมกัน 2 คำขอ) | สำเร็จ 1 ครั้ง |
| ยกเลิกทีละชั้นตามสาย QT…PAY (ตาราง impact) | สถานะต้นทาง/สต๊อก/ลูกหนี้กลับถูกต้องทุกขั้น |
| เลขเอกสาร: ลบร่าง 3 ใบ, ยกเลิก 2 ใบ | ไม่มีเลขซ้ำ, ใบกำกับไม่มีช่องว่าง (ตาม D-6) |
| แก้เอกสารอนุมัติแล้ว (Admin) | revision +1, snapshot เดิมดูได้, ต้องมีเหตุผล |

**ตาราง impact การยกเลิก (ต้องผ่านครบ):**

| ยกเลิก | เงื่อนไข | ผล |
|---|---|---|
| QT / CPO | ไม่มี SO ที่ใช้งาน | — |
| SO | ไม่มี DO / WO ที่ใช้งาน | QT/CPO กลับเป็นคงเหลือ |
| DO | ไม่มี BN/INV/SR ที่ใช้งาน | คืนสต๊อก (+ต้นทุนเดิมใน B5), SO สถานะถอย, การจัดส่งปิด |
| BN | ไม่มี INV ที่ใช้งาน | DO สถานะถอย |
| INV | ไม่มี RC/CN/DN ที่ใช้งาน และงวดภาษียังไม่ยื่น | ลูกหนี้ยกเลิก, รายงานภาษีขายแสดงเป็นใบยกเลิก (เลขยังอยู่) |
| RC | ไม่มี PAY ที่ใช้งาน | INV สถานะถอย |
| PAY | — | ลูกหนี้กลับมาค้าง, 50 ทวิที่ผูกไว้ → แจ้งเตือนให้ตรวจ |

---

## B5 — Purchasing & Inventory

**เป้าหมาย:** สายจัดซื้อ PR→PO→GR→APINV→PV→PMT ใน engine เดียวกัน, อนุมัติ PO ตามวงเงิน, รับบางส่วน/หลายครั้ง, เจ้าหนี้, FIFO + Moving Average, Stock Card / Valuation / COGS, ปรับปรุงสต๊อก, งวดบัญชี

| สร้างใหม่ | แก้ไข |
|---|---|
| migrations: ap_items, costing_policies, cost_layers, cost_layer_consumptions, cost_recalc_runs, stock_reservations · `services/costing` (FIFO, MA, recalculation) · รายงาน Stock Card / Valuation / COGS | `page-procurement.jsx` (สายเอกสารจัดซื้อ ใช้ component เอกสารเดียวกับฝ่ายขาย) · `page-inventory.jsx` (Stock card, มูลค่า, เอกสาร ADJ) · `page-accounting.jsx` (เจ้าหนี้, P&L ใช้ COGS จริง) · `page-production.jsx` (ตัด BOM ตามต้นทุนจริง, สร้าง PR/PO จากของขาด) · แก้ F-04, F-10, F-11, F-14 |

**ผลกระทบ:** ต้นทุนขายและกำไรขั้นต้นในรายงานจะเปลี่ยนจากต้นทุนมาตรฐานเป็นต้นทุนจริง (ตั้งแต่วัน cutover) · หน้าใบสั่งซื้อเพิ่มขั้นรับของ/ใบแจ้งหนี้
**ความเสี่ยง:** ต้นทุนผิดเมื่อมีรายการย้อนหลัง → period lock + recalculation ที่ต้องอนุมัติ; ประสิทธิภาพเมื่อ layer มาก → index บางส่วน `where qty_remaining > 0`

| Test case | เกณฑ์ผ่าน |
|---|---|
| ข้อมูลอ้างอิง Database-Schema §8.2 ทั้ง FIFO และ MA | ตรงทุกแถว (จำนวน, มูลค่า, layer, COGS 2,040.00 / 2,033.33) |
| สุ่มรายการ 10,000 รายการ (property test) | `SUM(stock_transactions)` = `stock_balances` ทุกสินค้า, ไม่มี layer ติดลบ |
| ยกเลิก DO / GR / SR / PRT | คืนค่าทุก layer/avg ตรงก่อนทำรายการ |
| รายการย้อนหลังในงวดเปิด | recalculation preview ถูกต้อง, ต้องอนุมัติก่อน commit, COGS เอกสารเดิมไม่ถูกแก้ (มี REVAL แทน) |
| รายการย้อนหลังในงวดปิด | 422 `PERIOD_CLOSED` |
| เปลี่ยนวิธีต้นทุนกลางงวด / ต้นงวด | ปฏิเสธ / สำเร็จผ่าน CCM ที่อนุมัติ, มูลค่ารวมไม่เปลี่ยน |
| PO 1 ใบ รับ 3 ครั้ง, รับเกินสั่ง | ค้างรับถูกต้อง / ปฏิเสธ (หรือยอมตาม % tolerance ที่ตั้งค่า) |
| GR 2 ใบ → APINV 1 ใบ, เลขใบแจ้งหนี้ผู้ขายซ้ำ | สำเร็จ / ปฏิเสธ |
| PO 2 คนรับของพร้อมกันเกินคงเหลือ | ไม่เกิน |
| จ่าย PMT หัก WHT 3% | เจ้าหนี้ลดเต็มจำนวน, สร้าง 50 ทวิ (issued, pending) |

---

## B6 — Accounting Expansion

**เป้าหมาย:** CN, DN, SR, PRT ครบวงจร (อ้างอิงต้นฉบับ, บางส่วน, VAT, เหตุผล, พิมพ์ A4) และระบบติดตาม 50 ทวิ ทั้งสองทิศทาง

| สร้างใหม่ | แก้ไข |
|---|---|
| doc_types CN/DN/SR/PRT + กฎใน domain · migrations: wht_certificates, wht_certificate_lines, wht_income_types · หน้า 50 ทวิ (รายการ, ค้นหาตามปีภาษี/คู่ค้า, แนบไฟล์, เปลี่ยนสถานะ, รายงานรายเดือน/ปี) · แม่แบบพิมพ์ CN/DN/SR/PRT/หนังสือรับรอง | `page-sales.jsx` (ปุ่มสร้าง CN/DN/SR จาก INV/DO) · `page-procurement.jsx` (PRT จาก GR) · `page-accounting.jsx` (ภ.พ.30 รวม CN/DN, ภ.ง.ด.3/53 จาก 50 ทวิ) · `ui-kit.jsx` (แม่แบบพิมพ์) |

**ผลกระทบ:** รายงานภาษีขาย/ซื้อรวมใบลดหนี้/เพิ่มหนี้, ลูกหนี้คิดรวม CN/DN
**ความเสี่ยง:** รูปแบบใบลดหนี้/เพิ่มหนี้ต้องมีข้อมูลตามประมวลรัษฎากร ม.86/9, 86/10 (เลขใบกำกับเดิม, มูลค่าเดิม, มูลค่าที่ถูกต้อง, ผลต่าง, เหตุผล) → ให้ฝ่ายบัญชีตรวจแม่แบบก่อนปิด Phase

| Test case | เกณฑ์ผ่าน |
|---|---|
| CN บางรายการ/บางจำนวน จาก INV | VAT = 7% ของผลต่าง, แสดงมูลค่าเดิม/ถูกต้อง/ผลต่าง, ลูกหนี้ลด |
| CN รวมเกินมูลค่า INV (หลายใบ, ยิงพร้อมกัน) | ปฏิเสธส่วนที่เกิน |
| DN จาก INV → RC → PAY | ลูกหนี้เพิ่มและรับชำระได้ |
| SR จาก DO (บางจำนวน) → CN | สต๊อกเข้าที่ต้นทุนเดิม (FIFO/MA ตาม §8.2), คืนเกินจำนวนส่งไม่ได้ |
| PRT จาก GR | สต๊อกออก, เจ้าหนี้ลด, ตามกฎต้นทุน §8.1 |
| ยกเลิก CN/DN/SR/PRT | ทุกยอดกลับสภาพเดิม |
| 50 ทวิ received: รับชำระมี WHT → `awaiting` → แนบไฟล์ `received` → `verified` (คนละคน) → `closed` | ลำดับบังคับ, ข้ามขั้นไม่ได้ |
| 50 ทวิ issued: จ่ายมี WHT → `pending` → พิมพ์หนังสือ → `received` → `verified` → `closed` | ยอดภาษีตรงกับ PMT |
| รายงาน WHT รายเดือน/ปี แยก received/issued, ภ.ง.ด.3/53 | ยอดรวมตรงกับเอกสาร |
| แนบไฟล์ปลอมนามสกุล (exe เปลี่ยนชื่อเป็น pdf), ไฟล์ > 10 MB | ปฏิเสธ |

---

## B7 — Production Readiness

**เป้าหมาย:** พร้อมใช้งานจริงตามเกณฑ์ส่งมอบ

| งาน | รายละเอียด | เกณฑ์ผ่าน |
|---|---|---|
| Security audit | OWASP ASVS L2 checklist, `npm audit`, ทดสอบ authz ทุก route, header/CSP, session fixation, brute force, upload, IDOR (เปลี่ยน id ใน URL) | ไม่มี Critical/High ค้าง |
| Performance | k6: 30 ผู้ใช้พร้อมกัน, ข้อมูล 3 ปีจำลอง (50,000 เอกสาร, 500,000 stock txn) | p95 < 500 ms อ่าน, < 1 s คำสั่ง, ไม่มี deadlock ค้าง |
| Backup & Restore | backup อัตโนมัติ + สำเนานอกเครื่อง + **ซ้อมกู้คืนจริงบนเครื่องใหม่** | RPO ≤ 24 ชม., RTO ≤ 2 ชม. ทำได้จริง มีบันทึกการซ้อม |
| Responsive UI | เมนู Drawer สำหรับจอ < 900px, ตารางเลื่อนแนวนอนในกรอบ (ปัญหาเดิมจากรายงาน A4 ข้อ 6.1) | ใช้งานหลักได้ที่ 375px / 768px โดยไม่เปลี่ยนหน้าตาบน Desktop |
| Build & Deploy | Vite production build, Docker images, Production VM บน Cloud, firewall/VPN ผู้ดูแล, HTTPS จริง, uptime monitor + แจ้งเตือน, คู่มือ deploy/อัปเดต/กู้คืน/ขยายเครื่อง | deploy ใหม่จากศูนย์ตามคู่มือได้ใน 1 ชม. |
| Portability | ซ้อมย้าย: restore backup ลง VM ผู้ให้บริการอื่น + ชุดตรวจ | ผ่าน มีบันทึกผล |
| Downtime procedure | คู่มือ 1 หน้า + อบรม: เปิด Mobile Hotspot (2 คนที่กำหนด), ใช้ใบบันทึกชั่วคราวเมื่อเข้าระบบไม่ได้ | ซ้อม 1 ครั้งก่อน go-live |
| Managed DB (ถ้าอนุมัติ C-3) | ซ้อม PITR กู้ไปจุดเวลาที่กำหนด + restore backup ภายนอกลง PostgreSQL ทั่วไป | ผ่านทั้งสองแบบ |
| ปิดค้างเก่า | ช่องลายเซ็นใบ PO, ข้อความแนะนำในใบสั่งผลิตตอนพิมพ์ (รายงาน A4 ข้อ 6.4–6.5) | — |
| UAT | สคริปต์ทดสอบต่อฝ่าย (ขาย, จัดซื้อ, ผลิต, คลัง, บัญชี, Admin) ใช้ข้อมูลจริง 1–2 สัปดาห์คู่ขนาน | ผู้แทนแต่ละฝ่ายลงนามรับ |
| Cutover | ตาม Data-Migration-Plan §2 ขั้น 4 | รายงาน V-1…V-11 ผ่าน |

---

## สรุปลำดับและขนาดงาน (ประมาณการ)

| Phase | ขึ้นกับ | ขนาด | หมายเหตุ |
|---|---|---|---|
| B1 | — | เสร็จ | รออนุมัติ |
| B2 | B1 + D-1…D-10 (+ C-1…C-10) + ติดตั้ง Node.js | M | ไม่กระทบระบบเดิม |
| B3 | B2 | **L** (ใหญ่สุด) | จุดเปลี่ยนจาก localStorage เป็น server |
| B4 | B3 | M | |
| B5 | B3 (B4 แนะนำให้เสร็จก่อน เพื่อใช้ Maker-Checker กับ PO) | L | |
| B6 | B5 | M | |
| B7 | B6 | M | + UAT 1–2 สัปดาห์ตามเวลาของผู้ใช้ |

```
B1 ─► B2 ─► B3 ─► B4 ─► B5 ─► B6 ─► B7 ─► Go-live
                 ▲ ข้อมูลจริงย้ายครั้งแรก (staging)          ▲ cutover จริง
```

## เกณฑ์ส่งมอบสุดท้าย (จากข้อกำหนด §11) → Phase ที่ตอบ

| เกณฑ์ | Phase |
|---|---|
| หลายคนใช้พร้อมกัน, ข้อมูลอยู่ใน PostgreSQL, Login/Permission จาก Backend | B2, B3 |
| ข้อมูลเดิม migrate ถูกต้อง, เอกสารขายเดิมทำงานครบ | B3, B7 |
| ลบ Draft / ยกเลิกตามสิทธิ์, Maker-Checker | B4 |
| PO Supplier workflow ครบ, FIFO / Moving Average ถูกต้อง | B5 |
| CN / DN / Return, 50 ทวิ | B6 |
| Audit log ตรวจย้อนหลังได้ | B2 (+ทุก Phase) |
| Backup/Restore ผ่าน, ไม่มี Critical/High | B7 |
