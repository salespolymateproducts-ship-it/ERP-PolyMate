# PolyMate ERP — Data Migration Plan (localStorage → PostgreSQL)

วันที่: 2026-11-12 · สถานะ: **ร่างเพื่อขออนุมัติ**
หลักการ: **ข้อมูลเดิมต้องไม่สูญหาย, ทดลองย้ายซ้ำได้ (dry-run), ตรวจสอบได้ทุกยอด, ย้อนกลับได้ทุกขั้น**

---

## 1. แหล่งข้อมูลต้นทาง

| แหล่ง | รายละเอียด |
|---|---|
| localStorage key `polymate_erp_v3` | JSON ก้อนเดียว: `docs, customers, suppliers, workOrders, purchaseOrders, expenses, employees, materials, finished, qc, molds, machines, stockMovements, auditLogs, users, settings, counters` |
| ค่าคงที่ในโค้ด | `BOMS`, `VEHICLES`, `ROLES`, `DOC_LABEL`, `WHT_RATES`, `EXPENSE_CATEGORIES`, `DEFECT_TYPES` (ไม่อยู่ใน localStorage) |
| key รุ่นเก่า | `polymate_erp_v2`, `erp.expenses.v1`, `erp.employees.v1`, `erp.pl.v1` ถูกลบอัตโนมัติตั้งแต่ v3 → ไม่ต้องย้าย |

**ข้อควรระวังสำคัญ:** localStorage แยกตาม **เครื่อง + เบราว์เซอร์ + โปรไฟล์ + ที่อยู่ (origin)** ถ้าเคยเปิดระบบหลายเครื่อง หรือเปิดด้วย `localhost:8765` และ `127.0.0.1:8765` ข้อมูลจะเป็นคนละชุด

## 2. ขั้นตอน

### ขั้น 0 — สำรวจ (ก่อนเริ่ม B3)
1. ทำรายชื่อทุกเครื่อง/เบราว์เซอร์ที่เคยใช้ระบบ
2. เปิดระบบแต่ละที่ → เอกสารขาย → ข้อมูล → **ส่งออกไฟล์สำรอง (.json)** (ฟังก์ชัน `Store.exportData` มีอยู่แล้ว ส่งออกทั้ง state)
3. ตั้งชื่อไฟล์ `<เครื่อง>-<เบราว์เซอร์>-<วันที่>.json` เก็บไว้ในโฟลเดอร์ `migration/source/` (อยู่นอก git เพราะมีรหัสผ่านแบบ hash และข้อมูลลูกค้า)
4. บันทึก SHA-256 ของทุกไฟล์ลง `migration/source/MANIFEST.txt`
5. ถ้ามีมากกว่า 1 ไฟล์ที่มีเอกสารจริง → ต้องให้ผู้ใช้เลือก **ชุดหลัก** และระบุว่าจะรวมชุดอื่นหรือไม่ (เลขเอกสารอาจชนกัน ดูข้อ 6)

### ขั้น 1 — Backup ก่อนเปลี่ยนแปลง
- Git tag `pre-backend` บน commit ปัจจุบัน (ระบบเดิมเปิดใช้ได้ทุกเมื่อ)
- คัดลอกไฟล์ .json ต้นฉบับ 2 ที่ (เครื่องหลัก + ฮาร์ดดิสก์ภายนอก/USB ที่เก็บในตู้เซฟ) แบบอ่านอย่างเดียว — บริษัทไม่มี NAS
- ฐานข้อมูลปลายทาง: `pg_dump` อัตโนมัติก่อนทุก commit import

### ขั้น 2 — Dry-run
```
docker compose run --rm api node dist/scripts/migrate-legacy.js \
  --file migration/source/office-chrome-2026-11-20.json --mode dry-run --cutover-date 2026-11-30
```
- ทำทั้งหมดใน transaction เดียวแล้ว **ROLLBACK** เสมอในโหมด dry-run
- สร้างรายงาน `migration/reports/<runId>.md` + `.json` (ข้อ 5) และบันทึกใน `migration_runs`
- รันซ้ำได้ไม่จำกัดจนรายงานผ่านทั้งหมด
- **การส่งไฟล์ขึ้น Cloud:** อัปโหลดผ่าน `POST /admin/legacy-import` (HTTPS, สิทธิ์ `system.migrate`) หรือ `scp` ผ่าน VPN ผู้ดูแล · ไฟล์ต้นฉบับบน server ถูกลบอัตโนมัติหลัง import เสร็จ (ต้นฉบับเก็บที่บริษัทตามขั้น 1 และ 5) · ไม่ส่งไฟล์ทางอีเมล/แชท

### ขั้น 3 — ทดลองใช้งานบน Staging (Cloud)
- Import แบบ commit ลง DB staging → ผู้ใช้ตัวแทนแต่ละฝ่ายเปิดเอกสารเดิม 10 ใบแบบสุ่ม เทียบกับระบบเดิมบนหน้าจอ/ใบพิมพ์

### ขั้น 4 — Cutover (วันจริง)
| เวลา | งาน |
|---|---|
| T−1 วัน | แจ้งผู้ใช้หยุดบันทึกในระบบเดิมตั้งแต่เวลาที่กำหนด |
| T0 | ส่งออกไฟล์ล่าสุดจากเครื่องหลัก + SHA-256 · ตั้งระบบเดิมเป็นอ่านอย่างเดียว (flag `READ_ONLY` ใน B3) |
| T0+15 นาที | Dry-run ด้วยไฟล์ล่าสุด → ต้องผ่าน 100% |
| T0+30 นาที | Commit import → รายงานตรวจสอบ → ผู้รับผิดชอบ (บัญชี + Admin) ลงนามรับรองรายงาน |
| T0+60 นาที | เปิดระบบใหม่ ผู้ใช้ login ครั้งแรก (rehash รหัสผ่าน) |
| T+7 วัน | ระบบเดิมยังเปิดอ่านได้ (อ่านอย่างเดียว) เพื่อเทียบข้อมูล |

### ขั้น 5 — หลังย้าย
- เก็บไฟล์ .json ต้นฉบับอย่างน้อย 10 ปี (คู่กับข้อกำหนดเก็บเอกสารบัญชี 5 ปีขึ้นไป)
- รายงานตรวจสอบเก็บใน `migration_runs.report` และแนบใน DEVLOG

## 3. Mapping ข้อมูล

### 3.1 ข้อมูลหลัก

| ต้นทาง | ปลายทาง | การแปลง |
|---|---|---|
| `settings.company` (ถ้าไม่มี ใช้ `COMPANY` ในโค้ด) | `companies` | ตรวจ `taxId` 13 หลัก |
| `customers[]` | `customers` | `id`→`legacy_id`, `code`→`code` (unique), `credit`→`credit_days`, `status` คงเดิม |
| `suppliers[]` | `suppliers` | `credit`→`credit_days`, `rating` |
| `materials[]` | `products` (`kind` จาก `type`: เม็ดพลาสติก→RM, สี-*→COLOR, เหล็ก→STEEL, บรรจุภัณฑ์→PACK) | `cost`→`standard_cost`, `min/max`, `location`, `supplier` (ชื่อ) → จับคู่ `suppliers.name` แบบตรงตัว ไม่พบ = null + แจ้งในรายงาน |
| `finished[]` | `products` (`kind` = FG หรือ TRADE ตาม `jobType`) | `customer` (code) → `customer_id`, `price`→`sale_price` |
| `BOMS` (โค้ด) | `boms` revision 1 + `bom_lines` | `item` (id วัตถุดิบ) → `products` ผ่าน `legacy_id` |
| `molds[]` (+ `maintLog[]`) | `molds` + `mold_maintenance` | `shots`, `life`→`life_shots` |
| `machines[]` | `machines` | id คงเดิม (INJ-01…) |
| `VEHICLES` (โค้ด) | `vehicles` | |
| `employees[]` | `employees` | `role`→`position`, `dept`→`departments` (สร้างตามชื่อที่พบ) |
| `users[]` | `users` + `user_roles` | `hash`→`password_hash`, `salt`→`legacy_salt`, `password_algo='sha256-legacy'`, `mustChange`, `status`; `role` → role ใหม่ตามตาราง 3.4 |
| `counters{}` | `number_sequences` | `last_value = max(counter, max(seq) ของเอกสารใน series)` — กันเลขชน |

### 3.2 เอกสาร (`docs[]`) — ทำ 2 รอบ

**รอบ 1: หัวเอกสาร + รายการ**

| ต้นทาง | ปลายทาง |
|---|---|
| `id` (เช่น `IV2026110003`) | `doc_no` และ `legacy_id` (เอกสารเดิมทุกใบ **คงเลขเดิม** รวมฉบับร่าง) |
| `type` | `doc_type` (CPO, QT, SO, DO, BN, INV, RC, PAY ตรงกัน) |
| `status` draft/pending/approved/partial/completed/cancelled | ค่าเดียวกัน |
| `customer` (code) | `customer_id` · `customerSnap` → `partner_snapshot` (ไม่มี = สร้างจากลูกค้าปัจจุบัน + flag ในรายงาน) |
| `date`, `due` (`"—"` → null), `refNo`, `note` | `doc_date`, `due_date`, `ref_no`, `note` |
| `vatOn` | `vat_mode` = exclusive / none |
| `whtRate`, `billDisc` | `wht_rate`, `bill_discount` |
| `gross, discount, subtotal, vat, total, wht, net` | **คำนวณใหม่** ด้วยกฎเดิม แล้วเทียบกับค่าเดิม (ต่างเกิน 0.01 = error) |
| `lines[]` | `document_lines` (`line_no` = index+1), `code` → จับคู่ `products.code` (ไม่พบ = `product_id` null ซึ่งเดิมก็ไม่ตัดสต๊อก) |
| `amount`, `method`, `bankRef` (PAY) | `payments` |
| `createdAt/By`, `updatedAt/By`, `approvedAt/By` | ชื่อผู้ใช้ → `users` ตาม `full_name`; ไม่พบ → ผู้ใช้ระบบ `legacy-import` + เก็บชื่อเดิมใน `ext.legacyActor` |
| `cancel {reason, by, at, fromStatus}` | `cancel_reason`, `cancelled_by`, `cancelled_at` |
| `history[]` | `document_status_history` |
| `ship {status, vehicle, receivedBy, shippedAt, deliveredAt}` | `shipments` |
| `stockPosted` | `stock_posted_at` = `approvedAt` (เพื่อการแสดงผล; ไม่สร้างรายการสต๊อกซ้ำ ดู 3.3) |

**รอบ 2: ความสัมพันธ์**
- `sourceIds[]` → `document_links (parent, child)`
- `lines[i].src {doc, line}` → `source_line_id` = id ของบรรทัดที่ `line_no = line+1` ในเอกสาร `doc` (ไม่พบ = error)
- INV/RC/PAY → สร้าง `ar_items` จากใบกำกับที่ยังไม่ยกเลิก และ `payment_allocations` จาก PAY → RC → INV (กระจายตามรายการใน RC ที่อ้าง INV ใด ถ้า RC หนึ่งใบอ้างหลาย INV ใช้สัดส่วนแบบเดิมครั้งเดียว แล้วบันทึกเป็นยอดจริง)

### 3.3 สต๊อกและต้นทุน
- **ยอดยกมา** ณ วัน cutover: สินค้าทุกตัวที่ `stock > 0` → `stock_transactions` ประเภท `OPEN` + `cost_layers` 1 layer ที่ `unit_cost = cost` (ต้นทุนมาตรฐานเดิม) + `stock_balances`
- `stockMovements[]` เดิม → `legacy_stock_movements` (เก็บไว้ดู ไม่กระทบยอด) เพราะยอดคงเหลือปัจจุบันรวมผลทุกรายการไว้แล้ว ถ้าลงซ้ำจะนับซ้ำ
- `costing_policies` เริ่มต้น = ค่าที่ผู้ใช้เลือกใน B5 (ก่อน B5 ยังไม่คิดต้นทุนแบบใหม่)
- `fiscal_periods`: งวดก่อน cutover ตั้งเป็น `closed` (ไม่ให้ลงย้อนหลังเข้าช่วงที่ไม่มีข้อมูล lot)

### 3.4 การผลิต จัดซื้อ บัญชี และอื่นๆ

| ต้นทาง | ปลายทาง | หมายเหตุ |
|---|---|---|
| `purchaseOrders[]` | `documents` type PO | `status` received → PO `completed` + สร้าง GR สังเคราะห์ (`ext.migrated=true`, **ไม่ post สต๊อก**) เพื่อให้สายเอกสารครบ |
| `expenses[]` id `EXP-<PO>` | `documents` type APINV อ้าง GR สังเคราะห์ | + `ap_items` (paid → `open_amount=0` + PMT สังเคราะห์) |
| `expenses[]` อื่น | `documents` type EXP + `ap_items` | `cancelled` → status cancelled + เหตุผลเดิม |
| `workOrders[]` (+ `logs[]`) | `work_orders` + `work_order_logs` | `src {doc,line}` → `so_line_id`; `reserved` → `stock_reservations` (ถ้ายังไม่ปิด) |
| `qc[]` | `qc_inspections` + `qc_defects` | |
| `auditLogs[]` | `audit_logs` `source='legacy'` | `at` (เวลาท้องถิ่น) → `timestamptz +07:00`, `user` → `actor_name`; บันทึก `MIGRATE` 1 รายการสรุปท้าย |

**Role เดิม → Role ใหม่:** admin→admin · sales→sales (+ sales_manager ถ้าผู้ใช้ต้องการให้คนเดิมอนุมัติต่อ) · production→production · procurement→procurement · accounting→accounting · สิทธิ์อนุมัติเดิม (`approve` ในโค้ด) แปลงเป็น `approval_policies` ชุดเริ่มต้นที่ให้ผลเหมือนเดิม ยกเว้นกฎ Maker-Checker ใหม่

## 4. กฎความถูกต้องระหว่าง import (ผิด = หยุด ไม่ commit)
1. รหัสซ้ำ (`customers.code`, `products.code`, `doc_no` ต่อประเภท) — รายงานทุกคู่
2. เอกสารอ้างลูกค้า/เอกสารต้นทาง/บรรทัดต้นทางที่ไม่มีอยู่
3. ยอดเงินคำนวณใหม่ต่างจากเดิม > 0.01
4. จำนวนที่ออกต่อแล้วเกินจำนวนต้นทาง (ข้อมูลเดิมเสีย)
5. สต๊อกติดลบ
6. ไฟล์ไม่ใช่ `polymate_erp_v3` หรือ JSON เสีย
คำเตือน (ไม่หยุด แต่ต้องรับทราบในรายงาน): ไม่มี `customerSnap`, ผู้ใช้ในประวัติหาไม่พบ, วัตถุดิบจับคู่ผู้ขายไม่ได้

## 5. รายงานตรวจสอบหลัง Migration (เกณฑ์ผ่าน)

| # | ตรวจ | เกณฑ์ผ่าน |
|---|---|---|
| V-1 | จำนวนรายการต่อ collection เดิม เทียบตารางใหม่ (customers, suppliers, products, docs ต่อประเภท/สถานะ, WO, QC, users, auditLogs …) | ตรงทุกตัว |
| V-2 | ยอด `total`, `net` รวมต่อประเภทเอกสาร | ตรง (± 0.01 ต่อใบ) |
| V-3 | คงเหลือต่อบรรทัดต้นทาง (`remainingLines` เดิม รันกับ JSON) เทียบ SQL | ตรงทุกบรรทัด |
| V-4 | สถานะที่คำนวณใหม่ (`refreshStatus`) เทียบสถานะเดิม | ตรงทุกใบ |
| V-5 | ลูกหนี้คงค้างต่อลูกค้า (`paymentInfo` เดิม) เทียบ `ar_items.open_amount` | ตรง ± 0.01 |
| V-6 | สต๊อกคงเหลือต่อสินค้า และมูลค่า (qty × cost เดิม) | ตรง |
| V-7 | `number_sequences` ≥ เลขสูงสุดที่มีอยู่ทุก series | ผ่าน |
| V-8 | FK ไม่มีค่ากำพร้า, ไม่มี `doc_no` ซ้ำ | 0 รายการ |
| V-9 | Audit log จำนวนเท่าเดิม + 1 (`MIGRATE`) | ผ่าน |
| V-10 | ผู้ใช้ทุกคน login ด้วยรหัสเดิมได้ (ทดสอบด้วยบัญชีทดสอบที่รู้รหัส) และถูก rehash | ผ่าน |
| V-11 | สุ่ม 10 เอกสารต่อประเภท พิมพ์ PDF จากระบบใหม่เทียบระบบเดิม | ผู้ใช้รับรอง |

สคริปต์ `verify-migration` ใช้ **ฟังก์ชันคำนวณเดิมจาก `workflow.jsx`** (โหลดไฟล์จริงด้วย Node) รันกับ JSON ต้นฉบับ แล้วเทียบกับผลจาก SQL → ไม่ต้องเชื่อโค้ดใหม่ฝ่ายเดียว

## 6. กรณีข้อมูลหลายเครื่อง
| สถานการณ์ | วิธีจัดการ |
|---|---|
| มีเครื่องเดียวที่มีเอกสาร | ใช้ไฟล์นั้น เครื่องอื่นเก็บไว้เป็นหลักฐาน |
| หลายเครื่องมีเอกสาร เลขไม่ชนกัน | รวมได้ (ข้อมูลหลักใช้ชุดหลัก) + ตรวจ V-1..V-8 ต่อไฟล์ |
| เลขเอกสารชนกัน (เลขเดียวกัน เนื้อหาต่างกัน) | **ไม่รวมอัตโนมัติ** — รายงานคู่ที่ชน ให้ผู้ใช้ตัดสินทีละใบ (ใบที่ไม่เลือกนำเข้าเป็นเลขใหม่ + หมายเหตุอ้างเลขเดิม) |

## 7. แผน Rollback

| จุดที่เกิดปัญหา | วิธีย้อนกลับ | เวลา |
|---|---|---|
| ระหว่าง dry-run | ไม่มีผล (rollback อัตโนมัติ) | — |
| Commit import ไม่ผ่านการตรวจ | `pg_restore` จาก dump ก่อน import หรือ drop/create DB แล้ว import ใหม่ | 10 นาที |
| หลังเปิดใช้ ภายใน 7 วัน พบปัญหาร้ายแรง | ตั้ง `DATA_MODE=local` → ระบบเดิมกลับมาใช้ด้วยไฟล์ล่าสุด (นำเข้าผ่าน `Store.importData`) + ส่งออกรายการที่บันทึกในระบบใหม่ระหว่างนั้นเป็น CSV เพื่อคีย์คืน | 1 ชม. |
| หลัง 7 วัน | ไม่ย้อนไประบบเดิม แก้ไขไปข้างหน้า (fix forward) + backup รายวัน | — |

## 8. ความเสี่ยง

| ความเสี่ยง | การป้องกัน |
|---|---|
| ผู้ใช้บันทึกในระบบเดิมหลังส่งออกไฟล์สุดท้าย | โหมดอ่านอย่างเดียว + ประกาศเวลาหยุด + ตรวจ `max(updatedAt)` ในไฟล์ |
| ไฟล์ backup มีรหัสผ่าน hash และข้อมูลลูกค้า | เก็บนอก git, จำกัดสิทธิ์โฟลเดอร์, ลบสำเนาชั่วคราวหลัง cutover |
| ต้นทุนยกมาใช้ต้นทุนมาตรฐาน ไม่ใช่ต้นทุนจริง | แจ้งฝ่ายบัญชีให้ทบทวน `cost` ของทุกสินค้าก่อน cutover (หน้าคลังแก้ได้อยู่แล้ว) หรือปรับด้วยเอกสาร ADJ มูลค่าหลัง cutover |
| เวลาในข้อมูลเดิมไม่มี timezone | ถือเป็น Asia/Bangkok ทั้งหมด |
