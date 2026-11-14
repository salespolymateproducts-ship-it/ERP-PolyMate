# PolyMate ERP — API Specification (REST, v1)

วันที่: 2026-11-12 · สถานะ: **ร่างเพื่อขออนุมัติ** · Base URL: `https://<host>/api/v1`
รายละเอียด field ทั้งหมดจะสร้างเป็น OpenAPI 3.1 อัตโนมัติจาก zod schema ใน B2 (`GET /api/v1/openapi.json`) เอกสารนี้กำหนดสัญญาและพฤติกรรมหลัก

---

## 1. ข้อตกลง

| เรื่อง | กติกา |
|---|---|
| รูปแบบ | JSON UTF-8, ชื่อ field แบบ camelCase, วันที่ `YYYY-MM-DD`, เวลา ISO 8601 (+07:00), เงินเป็น string ทศนิยม `"1234.50"` (กันปัดเศษใน JS) |
| Auth | Cookie `pm_sid` (HttpOnly) — ไม่มี token ใน JS |
| CSRF | ทุก POST/PATCH/PUT/DELETE ต้องมี header `X-CSRF-Token` (ค่าได้จาก `/auth/me`) |
| กันส่งซ้ำ | คำสั่ง POST ส่ง `Idempotency-Key: <uuid>` ส่งซ้ำด้วย key เดิมได้ผลเดิม ไม่ทำซ้ำ |
| Optimistic lock | PATCH ส่ง `version` ใน body ถ้าไม่ตรง → `409 VERSION_CONFLICT` |
| แบ่งหน้า | `?limit=50&cursor=<opaque>` → `{ data: [...], nextCursor }` (สูงสุด 500) |
| ค้นหา/กรอง | `?q=`, `?status=a,b`, `?from=&to=`, `?sort=-docDate` |
| สิทธิ์ | ทุก endpoint ระบุ permission ด้านล่าง ตรวจที่ server เสมอ |
| Rate limit | ทั่วไป 300 req/นาที/ผู้ใช้ · login 5/นาที/IP |

### 1.1 รูปแบบ Error
```json
{ "error": { "code": "QTY_EXCEEDS_REMAINING",
             "message": "รายการ \"Dashboard Trim 22A\" เกินจำนวนคงเหลือของ SO2026110003 (คงเหลือ 400)",
             "details": { "sourceDocNo": "SO2026110003", "line": 1, "remaining": "400.000" },
             "requestId": "01JC…" } }
```
| HTTP | ใช้เมื่อ | ตัวอย่าง code |
|---|---|---|
| 400 | รูปแบบข้อมูลผิด | `VALIDATION_ERROR` |
| 401 | ไม่ได้ login / session หมดอายุ | `UNAUTHENTICATED`, `PASSWORD_CHANGE_REQUIRED` |
| 403 | ไม่มีสิทธิ์ / CSRF ผิด / Maker-Checker | `FORBIDDEN`, `CSRF_INVALID`, `SELF_APPROVAL_NOT_ALLOWED` |
| 404 | ไม่พบ | `NOT_FOUND` |
| 409 | ชนกัน | `VERSION_CONFLICT`, `ALREADY_CANCELLED`, `HAS_ACTIVE_CHILDREN`, `IDEMPOTENCY_MISMATCH` |
| 422 | ผิดกฎธุรกิจ | `QTY_EXCEEDS_REMAINING`, `INSUFFICIENT_STOCK`, `PERIOD_CLOSED`, `SOURCE_NOT_APPROVED`, `AMOUNT_EXCEEDS_OUTSTANDING` |
| 429 | เกิน rate limit | `RATE_LIMITED` |
| 500 | ข้อผิดพลาดภายใน (ไม่เปิดเผยรายละเอียด) | `INTERNAL` |

---

## 2. Auth & Session

| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| POST | `/auth/login` | public | `{username, password}` → ตั้ง cookie, คืน `{user, mustChangePassword}` |
| POST | `/auth/logout` | login | เพิกถอน session ปัจจุบัน |
| GET | `/auth/me` | login | `{user, roles, permissions[], department, csrfToken}` |
| POST | `/auth/change-password` | login | `{currentPassword, newPassword}` → เพิกถอน session อื่นทั้งหมด |
| GET | `/auth/sessions` | login | session ของตนเอง |
| DELETE | `/auth/sessions/:id` | login | ออกจากระบบอุปกรณ์อื่น |

## 3. ผู้ใช้ สิทธิ์ การอนุมัติ (Admin)

| Method | Path | สิทธิ์ |
|---|---|---|
| GET/POST | `/users` | `user.manage` |
| GET/PATCH | `/users/:id` | `user.manage` |
| POST | `/users/:id/reset-password` → คืนรหัสชั่วคราวครั้งเดียว | `user.manage` |
| POST | `/users/:id/suspend` · `/users/:id/activate` | `user.manage` |
| GET/DELETE | `/users/:id/sessions` | `user.manage` |
| GET/POST/PATCH | `/roles`, `/roles/:id` (รวม permission) | `role.manage` |
| GET | `/permissions` | `role.manage` |
| GET/POST/PATCH | `/departments` | `role.manage` |
| GET/POST/PATCH | `/approval-policies`, `/approval-policies/:id` (รวม steps) | `approval.policy.manage` |

## 4. ข้อมูลหลัก

รูปแบบเดียวกันทุก resource: `GET /x` (ค้นหา/แบ่งหน้า), `POST /x`, `GET /x/:id`, `PATCH /x/:id` (มี `version`), `POST /x/:id/deactivate`

| Resource | อ่าน | เขียน |
|---|---|---|
| `/customers` (+ `GET /customers/:id/statement`, `/customers/:id/documents`) | `customer.read` | `customer.write` |
| `/suppliers` | `supplier.read` | `supplier.write` |
| `/products` (+ `kind=RM,FG…`) | `product.read` | `product.write` · แก้ `standardCost` ต้องมี `product.cost.write` |
| `/warehouses` | login | `warehouse.manage` |
| `/boms` (+ `POST /boms/:id/revise`) | `bom.read` | `bom.write` |
| `/machines`, `/molds` (+ `POST /molds/:id/maintenance`) | `production.read` | `mold.write` |
| `/vehicles` | login | `shipping.write` |
| `/employees` (salary ซ่อนถ้าไม่มี `hr.salary.read`) | `hr.read` | `hr.write` |
| `GET/PUT /settings/company` | login | `settings.company.write` |
| `/wht-income-types` | login | `settings.tax.write` |

## 5. เอกสาร (Document engine — ใช้กับทุกประเภท)

`:type` ∈ CPO, QT, SO, DO, BN, INV, RC, PAY, CN, DN, SR, PR, PO, GR, APINV, PRT, PV, PMT, EXP, ADJ, CCM
สิทธิ์อยู่ในรูป `doc.<TYPE>.<action>` เช่น `doc.INV.approve`

| Method | Path | สิทธิ์ | พฤติกรรม (เทียบฟังก์ชันเดิม) |
|---|---|---|---|
| GET | `/documents?type=&status=&partnerId=&q=&from=&to=` | `doc.<T>.read` | รายการ (หัวเอกสาร + ยอด) |
| GET | `/documents/:id` | `doc.<T>.read` | หัว + รายการ + คงเหลือต่อบรรทัด + ลิงก์ + ประวัติ + คำขออนุมัติ + ไฟล์แนบ |
| POST | `/documents` | `doc.<T>.create` | สร้างฉบับร่าง (= `Workflow.saveDraft` แบบใหม่) |
| PATCH | `/documents/:id` | `doc.<T>.create` | แก้ฉบับร่าง/รออนุมัติ (กลับเป็นร่าง) ส่ง `version` |
| DELETE | `/documents/:id` | `doc.<T>.delete` | ลบฉบับร่างที่ไม่มีการอ้างอิง (= `Workflow.remove`) |
| POST | `/documents/:id/submit` | `doc.<T>.create` | ส่งอนุมัติ → สร้าง `approval_request` ตามนโยบาย, แจ้งเตือนผู้อนุมัติ |
| POST | `/documents/:id/approve` `{comment?}` | `doc.<T>.approve` + Maker-Checker + วงเงิน | อนุมัติขั้นปัจจุบัน; ขั้นสุดท้าย → ออกเลข, post สต๊อก/ลูกหนี้ (= `Workflow.approve`) |
| POST | `/documents/:id/reject` `{reason}` | `doc.<T>.approve` | ไม่อนุมัติ → ร่าง (= `Workflow.reject`) |
| POST | `/documents/:id/return` `{reason}` | `doc.<T>.approve` | ส่งกลับให้แก้ไข (ไม่นับเป็นปฏิเสธ) |
| POST | `/documents/:id/cancel` `{reason}` | `doc.<T>.cancel` | ยกเลิก หรือสร้างคำขออนุมัติการยกเลิก (`status=cancel_pending`) |
| POST | `/documents/:id/revise` `{reason, ...changes, version}` | `doc.<T>.edit_approved` | แก้เอกสารที่อนุมัติแล้ว (ไม่มีลูก) → revision +1 |
| GET | `/documents/:id/related` | `doc.<T>.read` | ต้นทาง/ปลายทางทั้งสาย (= `Workflow.related`) |
| GET | `/documents/:id/remaining` | `doc.<T>.read` | คงเหลือต่อรายการ/มูลค่า (= `remainingLines`, `remainingValue`) |
| GET | `/documents/open-sources?type=&partnerId=&target=` | `doc.<T>.read` | ใบที่รวมออกเอกสารถัดไปได้ (= `openSources`) |
| POST | `/documents/convert` | `doc.<TARGET>.create` (+ approve ถ้าขอ) | สร้างเอกสารถัดไป (= `Workflow.convert`) |
| POST | `/documents/:id/shipment` `{status, vehicleId?, receivedBy?, note?}` | `shipping.write` | (= `Workflow.setShipStatus`) |
| GET | `/documents/:id/print` | `doc.<T>.read` | ข้อมูลสำหรับแม่แบบพิมพ์ A4 + บันทึก audit `PRINT` |

### 5.1 ตัวอย่าง `POST /documents/convert`
```json
// request  (Idempotency-Key: 6f1c…)
{ "sourceIds": ["0193…a1", "0193…b7"], "targetType": "BN", "docDate": "2026-11-12",
  "picks": [ { "sourceLineId": "0193…l1", "qty": "300" } ],    // ไม่ส่ง = คงเหลือทั้งหมด
  "approveSources": false, "approveTarget": false, "note": "" }
// 201
{ "document": { "id": "0193…c9", "docType": "BN", "docNo": null, "draftNo": "DRAFT-BN-000041",
                "status": "draft", "total": "16050.00", "version": 1, "lines": [ … ] },
  "affected": [ { "id": "0193…a1", "status": "approved", "version": 4 } ] }
```
ขั้นตอนใน transaction: lock เอกสารต้นทาง → ตรวจสิทธิ์ / ประเภทถัดไป / ลูกค้าเดียวกัน / VAT-WHT ตรงกัน → คำนวณคงเหลือใหม่ → ตรวจยอดไม่เกิน → สร้างเอกสาร + ลิงก์ → (อนุมัติถ้าขอ) → audit `CONVERT`

`affected` คือเอกสารอื่นที่สถานะเปลี่ยน ให้ frontend อัปเดต cache โดยไม่ต้องโหลดใหม่ (ทุกคำสั่งคืน `affected` แบบนี้)

### 5.2 การอนุมัติ (กล่องงาน)
| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/approvals/inbox` | คำขอที่ผู้ใช้อนุมัติได้ในขั้นปัจจุบัน (ไม่รวมเอกสารที่ตนเป็นผู้จัดทำ) |
| GET | `/approvals/:id` | รายละเอียด + ขั้นตอน + ผู้ที่อนุมัติแล้ว |
| POST | `/approvals/:id/withdraw` | ผู้ขอถอนคำขอ |

## 6. จัดซื้อ (ใช้ engine เดียวกับข้อ 5)

สายเอกสาร: `PR → PO → GR (รับหลายครั้ง) → APINV → PV → PMT` · `GR → PRT`
| Method | Path | คำอธิบาย |
|---|---|---|
| POST | `/documents/convert` `{sourceIds:[PO], targetType:"GR", picks, warehouseId}` | รับของบางส่วน/หลายครั้ง |
| POST | `/documents/convert` `{sourceIds:[GR1, GR2], targetType:"APINV", supplierInvoiceNo, supplierInvoiceDate}` | รวมหลายใบรับเป็นใบแจ้งหนี้เดียว (Many-to-One); กันเลขใบแจ้งหนี้ผู้ขายซ้ำ |
| POST | `/work-orders/:id/purchase-shortage` | สร้าง PR/PO จากวัตถุดิบไม่พอ (= `createPOFromShortage` เดิม) |
| GET | `/purchasing/po-status?supplierId=` | ยอดสั่ง / รับแล้ว / ค้างรับ ต่อรายการ |

## 7. สต๊อกและต้นทุน

| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| GET | `/inventory/balances?warehouseId=&kind=&belowMin=true` | `inventory.read` | คงเหลือ, จอง, ใช้ได้, มูลค่า |
| GET | `/inventory/stock-card?productId=&warehouseId=&from=&to=` | `inventory.read` | Stock Card: ยกมา, รายการ, คงเหลือ (จำนวน+มูลค่า) |
| GET | `/inventory/valuation?asOf=&warehouseId=` | `inventory.cost.read` | มูลค่าคงเหลือ ณ วันที่ |
| GET | `/inventory/cogs?from=&to=&groupBy=product|customer|month` | `inventory.cost.read` | รายงานต้นทุนขาย |
| GET | `/inventory/cost-layers?productId=` | `inventory.cost.read` | Layer FIFO ที่เหลือ |
| POST | `/documents` type `ADJ` | `inventory.adjust` | ปรับปรุงสต๊อก (แทน `Store.adjustStock` เดิม) ต้องระบุเหตุผล |
| GET/POST | `/costing/policies` | `costing.policy.manage` | ดู/ขอเปลี่ยนวิธี (สร้างเอกสาร CCM รออนุมัติ) |
| POST | `/costing/recalculate` `{productId, warehouseId, fromDate, reason}` | `costing.recalc` | สร้าง preview ผลต่าง |
| POST | `/costing/recalculate/:runId/commit` | `costing.recalc.approve` (Maker-Checker) | บันทึกผล (REVAL) |
| GET/POST | `/fiscal-periods`, `/fiscal-periods/:period/close`, `/reopen` | `period.close` | ปิด/เปิดงวด (เปิดใหม่ต้องมีเหตุผล) |

## 8. การผลิต / QC

| Method | Path | เทียบของเดิม |
|---|---|---|
| GET/POST/PATCH | `/work-orders` | `Store.add/update("workOrders")` |
| POST | `/work-orders/from-sales-order` `{soId, picks:[{soLineId, qty, machineId, moldId, due}]}` | `Workflow.createWorkOrders` |
| POST | `/work-orders/:id/produce` `{produced, ng}` | `Store.produceWO` (ตัด BOM + รับ FG + shot) |
| POST | `/work-orders/:id/reserve` · `/unreserve` | จองวัตถุดิบ |
| POST | `/work-orders/:id/hold` · `/resume` · `/close` · `/cancel {reason}` | |
| GET/POST | `/qc-inspections` | `Store.add("qc")` |

## 9. ลูกหนี้ / เจ้าหนี้

| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/ar/open-items?customerId=` · `/ap/open-items?supplierId=` | รายการค้างชำระ |
| GET | `/ar/aging?asOf=` · `/ap/aging?asOf=` | อายุหนี้ 0–30/31–60/61–90/>90 |
| GET | `/customers/:id/statement?from=&to=` | Statement ลูกค้า |
| (คำสั่งรับ/จ่ายเงินใช้ `/documents` type PAY/PMT พร้อม `allocations: [{arItemId, amount}]`) | | |

## 10. ภาษีหัก ณ ที่จ่าย 50 ทวิ

| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| GET | `/wht-certificates?direction=received|issued&taxYear=&month=&partnerId=&status=` | `wht.read` | ค้นหาตามปีภาษี/คู่ค้า/สถานะ |
| POST | `/wht-certificates` | `wht.write` | บันทึกหนังสือ (ส่วนใหญ่สร้างอัตโนมัติจาก PAY/PMT ที่มี WHT) |
| GET/PATCH | `/wht-certificates/:id` | `wht.read` / `wht.write` | |
| POST | `/wht-certificates/:id/status` `{status, note}` | `wht.write` (`verified`/`closed` ต้อง `wht.verify` และไม่ใช่ผู้บันทึก) | เปลี่ยนสถานะตามลำดับที่อนุญาต |
| GET | `/wht-certificates/:id/print` | `wht.read` | ข้อมูลพิมพ์หนังสือรับรอง (issued) |
| GET | `/reports/wht?direction=&year=&month=` | `wht.read` | ยอดรายเดือน/รายปี แยกประเภทเงินได้, ภ.ง.ด.3/53 |

## 11. รายงาน / แดชบอร์ด

| Path | แทนของเดิมใน |
|---|---|
| `GET /dashboard/summary` | `analytics.jsx` (KPI, ลูกหนี้, งานค้าง) |
| `GET /reports/sales?from=&to=&groupBy=` | หน้ารายงาน |
| `GET /reports/vat-sales?period=` · `/reports/vat-purchase?period=` | ภ.พ.30 |
| `GET /reports/pnd53?period=` · `/reports/pnd3?period=` | ภ.ง.ด. |
| `GET /reports/profit-loss?from=&to=` | P&L (ใช้ COGS จริงหลัง B5) |
| `GET /reports/production?from=&to=` · `/reports/ng?from=&to=` | |
| ทุกรายงานรองรับ `?format=csv` | ปุ่ม CSV เดิม |

## 12. Audit, ไฟล์แนบ, แจ้งเตือน

| Method | Path | สิทธิ์ |
|---|---|---|
| GET | `/audit-logs?from=&to=&actorId=&action=&entityType=&q=` (+ `format=csv`) | `audit.read` |
| GET | `/documents/:id/audit` | `doc.<T>.read` |
| POST | `/attachments` (multipart: `file`, `entityType`, `entityId`) ≤ 10 MB, PDF/JPG/PNG/WEBP, ตรวจ magic bytes | สิทธิ์เขียนของ entity นั้น |
| GET | `/attachments/:id` (ส่งไฟล์ผ่าน API, ไม่เปิด URL ตรง) | สิทธิ์อ่านของ entity นั้น |
| DELETE | `/attachments/:id` (soft delete + audit) | สิทธิ์เขียนของ entity นั้น |
| GET | `/notifications` · `POST /notifications/:id/read` | login |

## 13. Sync สำหรับ Frontend (Store Adapter)

| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/bootstrap` | ข้อมูลที่ผู้ใช้มีสิทธิ์อ่าน: master data, เอกสารเปิดอยู่ + 90 วันล่าสุด, WO, การตั้งค่า, `cursor` |
| GET | `/changes?since=<cursor>` | entity ที่เปลี่ยนหลัง cursor (เรียกทุก 15 วินาที) → `{ upserts: {docs:[…], customers:[…]}, cursor }` |

## 14. ระบบ / ผู้ดูแล

| Method | Path | สิทธิ์ |
|---|---|---|
| GET | `/healthz` · `/readyz` | public (ไม่เปิดเผยรายละเอียด) |
| GET/POST | `/admin/backups` (รายการ / สั่ง backup ทันที) | `system.backup` |
| POST | `/admin/legacy-import` (multipart ไฟล์ .json จากระบบเดิม, `mode=dry-run|commit`) | `system.migrate` |
| GET | `/admin/legacy-import/:runId` (รายงานตรวจสอบ) | `system.migrate` |
| GET | `/openapi.json` | login |

---

## 15. ตารางเทียบฟังก์ชันเดิม → API

| ของเดิม | API |
|---|---|
| `Store.login / logout / changeOwnPassword / restoreSession` | `/auth/login`, `/auth/logout`, `/auth/change-password`, `/auth/me` |
| `Store.createUser / setPassword / update("users") / remove("users")` | `/users…` (ลบผู้ใช้ → `suspend` เพราะถูกอ้างอิงใน audit) |
| `Store.add/update("customers"|"finished"|"molds"|"employees")` | `/customers`, `/products`, `/molds`, `/employees` |
| `Workflow.saveDraft / submit / approve / reject / cancel / remove` | `/documents`, `/documents/:id/{submit,approve,reject,cancel}`, `DELETE /documents/:id` |
| `Workflow.convert` | `POST /documents/convert` |
| `Workflow.setShipStatus` | `POST /documents/:id/shipment` |
| `Workflow.createWorkOrders` | `POST /work-orders/from-sales-order` |
| `Store.add("purchaseOrders")`, `update(status approved/cancelled)` | `/documents` type PO + approve/cancel |
| `Store.receivePO` | `POST /documents/convert` PO → GR |
| `Store.produceWO` | `POST /work-orders/:id/produce` |
| `Store.adjustStock` (หน้าคลัง) | `POST /documents` type ADJ |
| `Store.add("expenses")`, จ่าย, ยกเลิก | `/documents` type EXP / PV / PMT |
| `Store.add("qc")` | `/qc-inspections` |
| บันทึกซ่อมแม่พิมพ์ | `POST /molds/:id/maintenance` |
| `Store.saveCompany` | `PUT /settings/company` |
| `Store.exportData / importData` | `/admin/backups`, `/admin/legacy-import` (import ข้อมูลระบบเดิมครั้งเดียว) |
| `Store.resetAll` | **ไม่มีบน server** (ล้างข้อมูลจริงไม่ได้) |
| `Workflow.calc / remainingLines / can / related` | คงอยู่ฝั่ง frontend เพื่อแสดงผล + ตรวจซ้ำที่ server |
