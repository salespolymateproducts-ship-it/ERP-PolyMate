# PolyMate ERP — Backend Architecture (Phase B1)

วันที่: 2026-11-12 · สถานะ: **ร่างเพื่อขออนุมัติ** (ยังไม่มีการแก้ไข Source Code)
เอกสารชุดนี้: Backend-Architecture · [Cloud-Infrastructure](Cloud-Infrastructure.md) · [Database-Schema](Database-Schema.md) · [API-Specification](API-Specification.md) · [Data-Migration-Plan](Data-Migration-Plan.md) · [Development-Roadmap](Development-Roadmap.md) · [Decision-Review](Decision-Review-D1-D10.md)

---

## 1. ผล Audit ระบบปัจจุบัน (commit `8ee2679`)

### 1.1 โครงสร้าง

| ชั้น | ไฟล์ | บรรทัด | หน้าที่ |
|---|---|---|---|
| Entry | `index.html` | 129 | โหลด React 18.3.1 / Babel Standalone จาก unpkg, แปลง JSX ในเบราว์เซอร์, Boot guard |
| ข้อมูลตั้งต้น | `data.jsx`, `data-extra.jsx`, `data-shipping.jsx` | 345 | ข้อมูลหลัก (ลูกค้า 7, Supplier 8, วัตถุดิบ 11, สินค้า 7, แม่พิมพ์ 6, เครื่องจักร 6, BOM 4, พนักงาน 7, รถ 4), `ROLES`, ค่าคงที่สถานะ |
| Data layer | `store.jsx` | 418 | state เดียวใน localStorage `polymate_erp_v3`, `tx()` แบบ snapshot/rollback, audit log, เลขเอกสาร, สต๊อก, รับของ PO, บันทึกผลิต, ผู้ใช้/รหัสผ่าน, backup JSON |
| Business logic | `workflow.jsx` | 568 | Engine เอกสารขาย: คำนวณยอด, ความสัมพันธ์ระดับรายการ, สิทธิ์ `can()`, saveDraft/submit/approve/reject/cancel/remove/convert, จัดส่ง, เปิด WO จาก SO |
| สรุปตัวเลข | `analytics.jsx` | 66 | KPI, อายุลูกหนี้, ยอดขายรายเดือน |
| UI | `shell.jsx`, `ui-kit.jsx`, `page-*.jsx` (14 ไฟล์), `styles.css` | ~6,800 | 17 หน้า เรียกข้อมูลผ่าน `Store` / `Workflow` |

**ข้อดีที่ต้องรักษาไว้:** UI เรียก business logic ผ่าน interface กลางชุดเดียว (`Workflow.*`, `Store.*`) จึงเปลี่ยนชั้นล่างเป็น API ได้โดยไม่ต้องรื้อหน้าจอ

### 1.2 ตำแหน่งที่หน้าจอเขียนข้อมูล (ต้องเปลี่ยนเป็นเรียก API)

| ไฟล์ | การเขียนข้อมูล |
|---|---|
| `page-sales.jsx` | `Workflow.*` ทั้งหมด, `Store.exportData/importData/resetAll` |
| `page-customers.jsx` | `Store.add/update("customers")` |
| `page-procurement.jsx` | `Store.add/update("purchaseOrders")`, `Store.receivePO` |
| `page-production.jsx` | `Store.add/update("workOrders")`, `Store.produceWO`, `createPOFromShortage` (**push ตรงเข้า `Store.state.purchaseOrders`**) |
| `page-inventory.jsx` | `Store.adjustStock`, `Store.update("finished")`, `Store.add("finished")` |
| `page-molds.jsx` | `Store.add/update("molds")`, บันทึกซ่อม (**push ตรงเข้า `Store.state.expenses`**) |
| `page-qc.jsx` | `Store.add("qc")` |
| `page-accounting.jsx` | `Store.add/update("expenses")`, `Store.add/remove("employees")` |
| `page-more.jsx` | `Store.createUser/setPassword/update/remove("users")` |
| `page-docs.jsx` | `Store.saveCompany` |
| `page-login.jsx` | `Store.login/setPassword` |

`runAction()` ใน `ui-kit.jsx` เป็นแบบ synchronous (`if (runAction(...)) close()`) ใช้ราว 60 จุด เมื่อเปลี่ยนเป็น API ต้องรองรับ Promise ด้วย (ดูหัวข้อ 5)

### 1.3 ปัญหาที่พบระหว่าง Audit

| # | ระดับ | ปัญหา | ตำแหน่ง | จะแก้ใน |
|---|---|---|---|---|
| F-01 | **High** | Regex เลขผู้เสียภาษีผิด `/^d{13}$/` (ขาด `\`) ทำให้ **บันทึกข้อมูลบริษัทไม่ได้เลย** | `store.jsx:358` | B2 (ฝั่ง server) + แก้ฝั่งเดิมได้ทันทีถ้าอนุมัติ |
| F-02 | **High** | ตรวจสิทธิ์ฝั่งเบราว์เซอร์เท่านั้น เช่น `Store.update("users", …)` ไม่ตรวจว่าเป็น Admin ใครเปิด Console ก็เปลี่ยน role ตัวเองได้ | `store.jsx:158` | B2 |
| F-03 | **High** | รหัสผ่าน SHA-256 รอบเดียว + salt 8 ไบต์ ไม่ทนการเดารหัส | `store.jsx:286` | B2 (Argon2id + ย้ายแบบ rehash เมื่อ login) |
| F-04 | Medium | รับของ PO รับได้ครั้งเดียวทั้งใบ และจับคู่วัตถุดิบด้วยการเดาจากชื่อ (`_matchMaterial`) เสี่ยงเข้าสต๊อกผิดรายการ | `store.jsx:204,214` | B5 |
| F-05 | Medium | ลบฉบับร่างเลขล่าสุดแล้ว **ลดตัวนับเลขเอกสาร** ทำให้เลขถูกใช้ซ้ำ | `store.jsx:173` | B4 (ตามการตัดสินใจ D-6) |
| F-06 | Medium | การกระจายยอดรับชำระไปยังใบกำกับใช้สัดส่วนโดยประมาณ (`share = part / rc.gross`) | `workflow.jsx:106` | B3 (ตาราง `payment_allocations`) |
| F-07 | Medium | ต้นทุนขายใช้ต้นทุนมาตรฐานในทะเบียนสินค้า แก้ต้นทุนแล้วกระทบรายงานย้อนหลังทั้งหมด | `analytics.jsx`, `page-accounting.jsx` | B5 |
| F-08 | Medium | Audit log อยู่ใน blob เดียวกับข้อมูล แก้/ลบได้ และตัดเหลือ 5,000 รายการ | `store.jsx:119` | B2 |
| F-09 | Medium | เวลาเป็นเวลาเครื่องผู้ใช้ ไม่มี timezone, เลขเอกสารอิงวันที่จากเครื่อง | `store.jsx:74` | B2 (เวลาจาก server, `timestamptz`) |
| F-10 | Low | ฟอร์มสร้าง PO ตั้งวันที่เริ่มต้นตายตัว `"2026-06-06"` และจองเลข PO นอก transaction | `page-procurement.jsx:204,230` | B5 |
| F-11 | Low | BOM เป็นค่าคงที่ในโค้ด (`BOMS`) แก้ไขจากหน้าจอไม่ได้ | `data-extra.jsx:54` | B5 |
| F-12 | Low | รถขนส่ง (`VEHICLES`) เป็นค่าคงที่ | `data-shipping.jsx:3` | B3 |
| F-13 | Low | `usePersistentState` ใน page-accounting เหลือเป็นโค้ดที่ไม่ได้ใช้ | `page-accounting.jsx:9` | B3 |
| F-14 | Info | ค่าใช้จ่าย (`expenses`) ปนกันทั้งเจ้าหนี้จาก PO และค่าใช้จ่ายทั่วไป | `store.jsx:232` | B5 |

> ไม่พบ Critical bug ที่ทำให้ข้อมูลเสียหาย ข้อ F-01 แก้ได้ 1 ตัวอักษร: เสนอให้แก้ทันทีแยกเป็น commit เดียว (รอคำอนุมัติ เพราะคำสั่งห้ามแก้โค้ดใน B1)

### 1.4 สภาพเครื่องพัฒนา
- **ไม่มี Node.js และ PostgreSQL** ในเครื่องนี้ · มี Docker 29.5 และ Git 2.54
- ข้อมูลใน localStorage: ตามรายงาน A4 ล้างข้อมูลทดสอบแล้ว (เอกสาร 0 รายการ) แต่ **ต้องตรวจทุกเครื่องที่เคยเปิดใช้** ว่ามีข้อมูลจริงหรือไม่ (ดู Data-Migration-Plan)

---

## 2. สถาปัตยกรรมเป้าหมาย

```
 ผู้ใช้ (Chrome/Edge) จากทุกที่                     Cloud VM — Linux + Docker Compose (D-1)
 ┌──────────────────────┐   HTTPS 443     ┌────────────────────────────────────────────────────┐
 │ React SPA (Vite)     │ ──────────────► │ Caddy (reverse proxy, TLS อัตโนมัติ, gzip,         │
 │  • UI เดิม 17 หน้า    │                 │        security headers, static files ของ SPA)     │
 │  • Store = client     │ ◄── JSON ────── │        │ /api/*                                    │
 │    cache + API client │   cookie session│        ▼                                           │
 │  • domain/ (คำนวณ     │                 │ API: Node.js 22 LTS + Express 5 + TypeScript       │
 │    ยอดสำหรับแสดงผล)   │                 │   routes → validation (zod) → services (domain)    │
 └──────────────────────┘                 │   → repositories (Kysely) → PostgreSQL              │
                                          │   pino logs · request-id · error handler           │
                                          │        │                                           │
                                          │        ▼                                           │
                                          │ PostgreSQL 16 (volume)   │ attachments (volume)    │
                                          │        ▲                                           │
                                          │ backup job: pg_dump รายวัน (เข้ารหัส)               │
                                          └───────────────┬────────────────────────────────────┘
                                                          ▼
                                     Object storage (S3-compatible) ของผู้ให้บริการอีกราย (+ ฮาร์ดดิสก์ภายนอกรายเดือน 💡)
 หมายเหตุ: 💡 ข้อเสนอ C-3 ให้ PostgreSQL เป็น Managed service แยกจาก VM (โค้ดเหมือนกันทั้งสองแบบ)
```
รายละเอียดขนาดเครื่อง ค่าใช้จ่าย การขยาย และกรณีเน็ตโรงงานล่ม: [Cloud-Infrastructure.md](Cloud-Infrastructure.md)

### 2.1 หลักการ
1. **Server เป็นแหล่งความจริงเดียว** — ยอดเงิน, คงเหลือ, สิทธิ์, สถานะ คำนวณและตรวจที่ server ทุกครั้ง ฝั่งเบราว์เซอร์คำนวณซ้ำได้เพื่อแสดงผลเท่านั้น
2. **Command API** — การเปลี่ยนแปลงทางธุรกิจเป็นคำสั่งที่มีความหมาย (`/documents/:id/approve`, `/documents/convert`) ไม่ใช่ PATCH ฟิลด์อิสระ เพื่อให้ตรวจสิทธิ์และ invariant ได้ครบ
3. **1 คำสั่ง = 1 Database transaction** — รวมเอกสาร, สต๊อก, ต้นทุน, ลูกหนี้, audit log อยู่ใน transaction เดียว ล้มเหลว = ไม่มีอะไรเปลี่ยน (เทียบเท่า `Store.tx()` เดิม)
4. **ไม่ลบข้อมูลที่มีผลทางบัญชี** — ยกเลิกด้วยรายการกลับ (reversal) ไม่ UPDATE/DELETE ประวัติ
5. **ไม่ผูกผู้ให้บริการ Cloud** — ใช้เฉพาะ VM Linux, PostgreSQL มาตรฐาน, S3 API; ย้ายผู้ให้บริการได้ด้วย backup + restore และซ้อมย้ายปีละครั้ง
6. **ขยายตามแนวนอนได้ตั้งแต่ต้น** — session อยู่ใน DB, ไฟล์แนบผ่าน storage interface, งานเบื้องหลังใช้ lock ใน DB จึงเพิ่มเครื่อง API ได้โดยไม่แก้โค้ด
7. **Logic เดิมย้ายแบบ port ไม่ใช่เขียนใหม่** — `workflow.jsx` แปลงเป็น TypeScript ในฝั่ง server โดยคงชื่อฟังก์ชันและกฎเดิม แล้วใช้ test ชุดเดิม (29 + 21 กรณีจาก Phase 6) เป็นเกณฑ์ว่าพฤติกรรมไม่เปลี่ยน

### 2.2 โครงสร้าง Repository (เสนอ)

ไฟล์เดิมที่ root **ไม่ย้าย** จนถึง B3 เพื่อให้ระบบเดิมยังเปิดใช้ได้ตลอดการพัฒนา

```
ERP/
├─ index.html, *.jsx, styles.css, assets/   ← ระบบเดิม (คงไว้; B3 เพิ่ม main.jsx ให้ Vite build ได้)
├─ server/                                   ← ใหม่ (B2)
│  ├─ src/
│  │  ├─ app.ts, server.ts, config.ts       (Express, env, security middleware)
│  │  ├─ http/            routes/*.ts, middleware/ (auth, csrf, rbac, idempotency, error)
│  │  ├─ services/        auth, users, documents, approval, inventory, costing, ar-ap, wht, production, audit
│  │  ├─ domain/          กฎธุรกิจแบบ pure function (port จาก workflow.jsx) — ใช้ร่วมกับ frontend
│  │  ├─ db/              kysely.ts, migrations/NNNN_*.ts, seeds/
│  │  └─ jobs/            backup, cost-recalc
│  ├─ scripts/            migrate-legacy.ts, verify-migration.ts, restore-test.sh
│  └─ test/               unit/, integration/ (PostgreSQL จริงใน Docker), concurrency/
├─ e2e/                    Playwright (B3+)
├─ deploy/                 docker-compose.yml, Caddyfile, .env.example, backup/
├─ docs/                   เอกสารชุดนี้ + DEVLOG.md
└─ vite.config.js, package.json (B3)
```

### 2.3 Technology Stack

| ส่วน | เลือก | เหตุผล |
|---|---|---|
| Runtime | Node.js 22 LTS | ตามข้อกำหนด, LTS ถึง 2027 |
| ภาษา backend | TypeScript | ระบบบัญชีมีโครงสร้างข้อมูลเยอะ type ช่วยกันบั๊กข้ามโมดูล (ฝั่ง UI เดิมคงเป็น JSX) |
| Web framework | Express 5 | ตามข้อกำหนด, เรียบง่าย, middleware ครบ |
| Validation | zod | schema เดียวใช้ตรวจ request และสร้างเอกสาร API |
| DB access | Kysely + `pg` | เขียน SQL ได้ชัด, รองรับ `SELECT … FOR UPDATE`, transaction ซ้อน, type-safe (ดู D-3) |
| Migration | Kysely Migrator (ไฟล์ TS เรียงเลข, up/down) | อยู่ใน repo, รันอัตโนมัติตอน deploy |
| Password | Argon2id (`argon2`) | มาตรฐาน OWASP |
| Logging | pino (JSON) + pino-http | เร็ว, มี request-id |
| Test | Vitest + Supertest + Testcontainers (PostgreSQL) + Playwright | ทดสอบกับ PostgreSQL จริง ไม่ mock DB |
| Frontend build | Vite 6 + React 18 (คงเวอร์ชันเดิม) | ตามข้อกำหนด, ตัด Babel ในเบราว์เซอร์ |
| Reverse proxy | Caddy 2 | HTTPS อัตโนมัติ (Let's Encrypt หรือ internal CA) |
| Deploy | Docker Compose บน Cloud VM (Ubuntu 24.04 LTS) | ไม่ผูกผู้ให้บริการ, เครื่องพัฒนามี Docker แล้ว, สภาพแวดล้อมเดียวกันทั้ง dev/staging/production |
| 2FA | TOTP (แอป Authenticator) | ระบบเปิดสู่อินเทอร์เน็ต — บังคับ Admin/ผู้อนุมัติ (รอตัดสิน C-6) |

---

## 3. Authentication & Session

**ข้อเสนอ: Server-side session ใน PostgreSQL + Cookie** (ดูทางเลือก D-2)

- Cookie `pm_sid`: `HttpOnly; Secure; SameSite=Strict; Path=/` อายุ idle 30 นาที (ตั้งค่าได้) สูงสุด 12 ชั่วโมง
- เก็บเฉพาะ SHA-256 ของ session token ใน DB → token รั่วจาก DB ใช้ไม่ได้
- **CSRF**: ทุก request ที่ไม่ใช่ GET ต้องส่ง header `X-CSRF-Token` ที่ตรงกับค่าใน session (ได้จาก `GET /auth/me`) + ตรวจ `Origin`
- Login: rate limit 5 ครั้ง/นาที/IP และล็อกบัญชีชั่วคราว 15 นาทีหลังผิด 10 ครั้งติด, บันทึก `LOGIN_FAIL`
- บังคับเปลี่ยนรหัสครั้งแรก/หลังรีเซ็ต (คงพฤติกรรมเดิม), รหัสผ่านอย่างน้อย 10 ตัว, ห้ามซ้ำ 5 รหัสล่าสุด
- Admin เห็นและเพิกถอน session ที่ใช้งานอยู่ได้, ระงับบัญชี = เพิกถอนทุก session ทันที
- รหัสผ่านเดิม (SHA-256): login สำเร็จครั้งแรกบนระบบใหม่ → ตรวจด้วยวิธีเดิมแล้ว rehash เป็น Argon2id ทันที

## 4. Authorization

### 4.1 โมเดล
```
users ─< user_roles >─ roles ─< role_permissions >─ permissions
  │                       (scope: ทั้งบริษัท / แผนกของตน)
  └─ department_id
approval_policies (ต่อประเภทเอกสาร [+แผนก]) ─< approval_policy_steps (ช่วงวงเงิน → ผู้อนุมัติ role/user, ลำดับขั้น)
```
- Permission เป็นรหัสคงที่ในโค้ด เช่น `doc.QT.create`, `doc.QT.approve`, `doc.INV.cancel`, `inventory.adjust`, `costing.policy.manage`, `user.manage`, `audit.read`, `wht.manage`
- Role, การผูก permission, แผนก, ขั้นอนุมัติ และวงเงิน **ตั้งค่าจากหน้าจอ Admin ได้โดยไม่ต้องแก้โค้ด**
- Role เริ่มต้น map จาก `ROLES` เดิม: admin, sales, sales_manager, production, procurement, procurement_manager, accounting, accounting_manager, approver (ผู้มีอำนาจ)
- ทุก route ประกาศ permission ที่ต้องใช้ (`requirePermission('doc.SO.approve')`) และ service ตรวจกฎธุรกิจซ้ำ (เช่น Maker-Checker)
- Frontend ได้รายการ permission ของตนจาก `/auth/me` เพื่อซ่อน/แสดงปุ่ม (เฉพาะความสะดวก ไม่ใช่การป้องกัน)

### 4.2 Maker-Checker
- ห้ามผู้ใช้อนุมัติเอกสารที่ตนเป็น `created_by` หรือ `submitted_by` และห้ามอนุมัติ 2 ขั้นในคำขอเดียวกัน (ตรวจใน `ApprovalService` + test บังคับ)
- Admin **ไม่ได้รับข้อยกเว้นโดยอัตโนมัติ** มีค่าตั้ง `allow_self_approval` ต่อนโยบาย (ค่าเริ่มต้นปิด) สำหรับช่วงที่บริษัทมีคนน้อย และทุกครั้งที่ใช้จะบันทึก audit แยก

## 5. การเชื่อม Frontend เดิมกับ API (หัวใจของ "ไม่รื้อ UI")

**ข้อเสนอ: Store Adapter + Client cache** (ดู D-4)

1. `Store.state.*` และ `useStore()` คงเดิม ทุกหน้าจออ่านข้อมูลแบบเดิม แต่ข้อมูลมาจาก `GET /bootstrap` (ข้อมูลหลัก + เอกสารที่ยังเปิดอยู่ + 90 วันล่าสุด) และ `GET /changes?since=` (ดึงทุก 15 วินาที และหลังทุกคำสั่ง) ผู้ใช้หลายคนจึงเห็นข้อมูลล่าสุดตรงกัน
2. ฟังก์ชันเขียนข้อมูล (`Workflow.approve`, `Store.receivePO`, …) เปลี่ยนไส้ในเป็นเรียก API แล้วนำ entity ที่ server ส่งกลับมาใส่ cache คงชื่อฟังก์ชันและพารามิเตอร์เดิม
3. `runAction()` รองรับทั้งค่าปกติและ Promise: แสดง spinner, toast ผลลัพธ์, ปิด modal เมื่อสำเร็จ จุดที่ใช้รูป `if (runAction(...))` ราว 60 จุดปรับเป็น `runAction(...).then(ok => ok && close())` ทีละไฟล์ (เปลี่ยนเฉพาะบรรทัดเรียก ไม่แตะ JSX หน้าตา)
4. ฟังก์ชันอ่าน/คำนวณ (`Workflow.calc`, `remainingLines`, `can`) ยังทำงานบน cache เพื่อแสดงผลทันที ส่วนการตัดสินจริงอยู่ที่ server
5. **Feature flag `DATA_MODE=local|api`** ใน B3: สลับกลับโหมด localStorage ได้ทันทีถ้ามีปัญหา
6. ข้อมูลรายงานขนาดใหญ่ (Stock card, Audit log, รายงานภาษี) ไม่โหลดเข้า cache แต่เรียก endpoint เฉพาะแบบแบ่งหน้า

## 6. Transaction และการใช้งานพร้อมกัน

| กลไก | ใช้กับ |
|---|---|
| Transaction ระดับ READ COMMITTED + **row lock** `SELECT … FOR UPDATE` ตามลำดับคงที่ (เอกสารต้นทาง → stock_balances เรียงตาม product_id → number_sequences) | convert, approve, cancel, รับของ, ตัดสต๊อก, รับชำระ |
| **Optimistic lock** คอลัมน์ `version` ส่งมากับ PATCH, ไม่ตรง → 409 `VERSION_CONFLICT` | แก้ไขฉบับร่าง, ข้อมูลหลัก |
| **Idempotency-Key** header (UUID ต่อการกดปุ่ม) เก็บผล 24 ชม. | ทุก POST คำสั่ง กันกดซ้ำ/เน็ตหลุดแล้วส่งซ้ำ |
| Constraint ใน DB: `UNIQUE(doc_type, doc_no)`, `CHECK (qty_remaining >= 0)`, FK | ด่านสุดท้ายถ้าโค้ดพลาด |
| Retry อัตโนมัติ 3 ครั้งเมื่อเจอ deadlock (`40P01`) / serialization (`40001`) | ทุก command |

ตัวอย่าง: ผู้ใช้ 2 คนออก DO จาก SO เดียวกันพร้อมกัน → คนที่สองรอ lock ของ SO, เมื่อได้ lock จะคำนวณคงเหลือใหม่ แล้วถูกปฏิเสธถ้าเกิน (test บังคับใน B3)

## 7. เลขที่เอกสาร
- ตาราง `number_sequences(series_key, last_value)` เพิ่มค่าด้วย `UPDATE … RETURNING` ใน transaction เดียวกับการสร้างเอกสาร **ไม่ลดค่าลงอีก** แม้ลบหรือยกเลิก
- รูปแบบเดิม `PREFIX + YYYY + MM + NNNN` (เช่น `IV2026110001`) คงไว้
- เวลาที่ออกเลขขึ้นกับ D-6

## 8. Audit Trail
- ตาราง `audit_logs` แบบ append-only: trigger ใน DB ปฏิเสธ UPDATE/DELETE, ผู้ใช้ DB ของแอปมีสิทธิ์แค่ INSERT/SELECT
- เก็บ: เวลา (server), ผู้ใช้, role, IP, user-agent, request-id, action, entity, เลขเอกสาร, เหตุผล, ค่าก่อน/หลัง (JSON diff)
- เขียนใน transaction เดียวกับการเปลี่ยนแปลง (ถ้ารายการล้มเหลว log ก็ไม่เกิด ยกเว้น `LOGIN_FAIL` และ `PERMISSION_DENIED` ที่เขียนแยก)
- ไม่จำกัด 5,000 รายการเหมือนเดิม (แบ่ง partition รายปีเมื่อเกิน 5 ล้านแถว)

## 9. Error Handling
- `DomainError(code, message, details)` → HTTP 422, `NotFound` → 404, `Forbidden` → 403, `Conflict/Version` → 409, validation → 400, อื่นๆ → 500 (ไม่ส่ง stack ให้ผู้ใช้)
- รูปแบบเดียว: `{ "error": { "code", "message" (ภาษาไทย), "details", "requestId" } }`
- ข้อความภาษาไทยเดิมจาก `fail()` ใน workflow.jsx ใช้ต่อ ผู้ใช้จึงเห็นข้อความเหมือนเดิม

## 10. Logging, Monitoring
- pino JSON → stdout → Docker log rotation (10 MB × 5 ไฟล์), ไม่ log รหัสผ่าน/token/cookie
- `GET /healthz` (process), `GET /readyz` (DB + พื้นที่ดิสก์) สำหรับ uptime monitor
- แจ้งเตือน (B7): backup ล้มเหลว, ดิสก์เหลือ < 15%, error 5xx เกินเกณฑ์, login fail ผิดปกติ ผ่าน LINE Notify ทางเลือก/อีเมล

## 11. Backup & Restore
| รายการ | วิธี | ความถี่ / การเก็บ |
|---|---|---|
| ฐานข้อมูล | `pg_dump -Fc` + ตรวจ checksum | ทุกวัน 02:00 · เก็บ 14 วัน + รายสัปดาห์ 8 + รายเดือน 12 |
| ก่อนเปลี่ยน schema | dump อัตโนมัติก่อนรัน migration ทุกครั้ง | เก็บ 30 วัน |
| ไฟล์แนบ | rsync/rclone ไปที่เก็บนอกเครื่อง | ทุกวัน |
| สำเนานอกผู้ให้บริการ (✅ ข้อกำหนด) | เข้ารหัสแล้วส่งไป Object storage ของ **ผู้ให้บริการอีกราย** (บริษัทไม่มี NAS) | ทุกวัน |
| 💡 สำเนาออฟไลน์ (D-8 ปรับ) | ฮาร์ดดิสก์ภายนอกเก็บที่สำนักงาน | รายเดือน |
| 💡 Managed PostgreSQL (C-3) | backup ในตัว + PITR 7 วัน | ต่อเนื่อง |
| Snapshot ทั้งเครื่อง | บริการของผู้ให้บริการ Cloud | รายวัน 7 วัน |
| ทดสอบกู้คืน | restore ลง Staging + ตรวจจำนวนแถว/ยอดลูกหนี้/ยอดสต๊อก | อัตโนมัติรายสัปดาห์, มีรายงาน · ซ้อมกู้เต็มรูปทุก 6 เดือน |
| (ทางเลือก) PITR | WAL archiving | ถ้าต้องการ RPO < 24 ชม. |

เป้าหมาย: **RPO ≤ 24 ชม. (≤ 5 นาทีถ้าเปิด PITR), RTO ≤ 2 ชม.**

## 12. Deployment & Environment
- **Cloud (D-1):** ผู้ใช้ ≤ 10 / พร้อมกัน ≤ 5 (✅ C-1) → 💡 App VM 1 vCPU / 2 GB + Managed PostgreSQL แพ็กเกจเล็กสุด (C-3) + Staging + Object storage อีกผู้ให้บริการ — ขนาด ค่าใช้จ่าย เปรียบเทียบ และการขยายอยู่ใน [Cloud-Infrastructure §2–4, §7](Cloud-Infrastructure.md)
- เครือข่าย: เปิดเฉพาะ 80/443, SSH ผ่าน VPN ผู้ดูแลเท่านั้น, PostgreSQL รับการเชื่อมต่อเฉพาะจาก App VM ผ่าน private network/TLS
- `DATABASE_URL` ชี้ได้ทั้ง PostgreSQL ใน Docker (dev/staging) และ Managed (production) โดยไม่แก้โค้ด; migration และ backup job ใช้การเชื่อมต่อแบบ TLS
- `docker compose up -d` : `caddy`, `api`, `db`, `backup`
- Environment variables (`deploy/.env`, ไม่เข้า git): `DATABASE_URL`, `SESSION_SECRET`, `APP_ORIGIN`, `TZ=Asia/Bangkok`, `BACKUP_DIR`, `BACKUP_REMOTE`, `ATTACHMENT_DIR`, `MAX_UPLOAD_MB=10`, `LOG_LEVEL`
- ผู้ใช้ DB แยก: `erp_owner` (migration) และ `erp_app` (runtime, ไม่มีสิทธิ์ DDL, ไม่มีสิทธิ์ UPDATE/DELETE `audit_logs`)
- Security headers: HSTS, CSP (ไม่มี `unsafe-eval` หลังเลิก Babel), X-Content-Type-Options, frame-ancestors none

---

## 13. การตัดสินใจที่ต้องการอนุมัติ

| # | เรื่อง | ทางเลือก | ข้อเสนอ | เหตุผล / ข้อเสีย |
|---|---|---|---|---|
| **D-1** | ที่ตั้ง Server | (ก) เครื่องในโรงงาน (on-premise) · (ข) Cloud | **เจ้าของระบบเลือก Cloud แล้ว (2026-11-12)** — รายละเอียด C-1…C-10 ใน Cloud-Infrastructure §10 รอตัดสิน | เข้าถึงได้ทุกที่ ขยายง่าย · ความเสี่ยงหลัก: เน็ตโรงงานล่ม → มาตรการใน Cloud-Infrastructure §9 |
| **D-2** | Authentication | (ก) Session ใน DB + HttpOnly cookie + CSRF · (ข) JWT access + refresh token | **(ก)** | เพิกถอน/ระงับบัญชีได้ทันที, token ไม่อยู่ใน JS จึงไม่ถูกขโมยผ่าน XSS · ข้อเสีย: ต้องทำ CSRF และ query DB ทุก request (เล็กน้อยสำหรับ < 100 ผู้ใช้) |
| **D-3** | ชั้นเข้าถึง DB | (ก) Kysely (query builder) · (ข) Prisma (ORM) · (ค) SQL ล้วนด้วย `pg` | **(ก)** | ควบคุม lock/transaction/SQL ได้ตรง สำคัญมากกับสต๊อกและต้นทุน · Prisma เขียนง่ายกว่าแต่จัดการ `FOR UPDATE` และ query ซับซ้อนยาก |
| **D-4** | เชื่อม UI เดิม | (ก) Store Adapter + client cache (คงหน้าจอเดิม) · (ข) เขียนหน้าจอใหม่ด้วย React Query | **(ก)** | ตรงข้อกำหนด "ห้ามเปลี่ยน UI", เสี่ยงน้อย · ข้อเสีย: cache ทั้งชุดเหมาะกับข้อมูลระดับหมื่นรายการ ถ้าโตมากต้องแบ่งหน้าเพิ่ม (ทำทีละหน้าได้ภายหลัง) |
| **D-5** | โครงสร้างตารางเอกสาร | (ก) ตารางกลาง `documents` + `document_lines` + `document_links` ทุกประเภท · (ข) แยกตารางต่อประเภท | **(ก)** | ตรงกับ engine เดิม, CN/DN/Return/PO ใช้ engine เดียว, ค้นหา/อนุมัติ/ยกเลิกรวมศูนย์ · ข้อเสีย: ฟิลด์เฉพาะประเภทไปอยู่ตารางเสริม/JSONB |
| **D-6** | เวลาออกเลขที่เอกสาร | (ก) ออกเลขจริงเมื่อ **อนุมัติ** ร่างใช้เลขชั่วคราว `DRAFT-…` · (ข) ออกเลขตอนสร้างร่าง (แบบเดิม) ลบร่างแล้วเลขหาย | **(ก)** | ใบกำกับภาษี/ใบเสร็จต้องเรียงเลขไม่ขาดช่วง (ข้อกำหนดกรมสรรพากร) ลบร่างได้โดยไม่เกิดช่องว่าง · ข้อเสีย: ฉบับร่างยังไม่มีเลขจริงให้อ้างกับลูกค้า (QT ที่ต้องส่งก่อนอนุมัติ ตั้งให้ออกเลขตอนสร้างเป็นรายประเภทได้) |
| **D-7** | ระดับวิธีคิดต้นทุน | (ก) ระดับบริษัท (ทุกคลังใช้วิธีเดียว) · (ข) เลือกได้ต่อคลัง | **(ก) เริ่มที่ระดับบริษัท** schema รองรับ (ข) | มาตรฐานบัญชี (TAS 2) ให้ใช้วิธีเดียวกับสินค้าลักษณะเดียวกัน, เปลี่ยนได้เฉพาะต้นงวดผ่านเอกสารเปลี่ยนวิธีที่อนุมัติแล้ว |
| **D-8** | สำเนา backup นอกเครื่อง | (ก) NAS ในบริษัท · (ข) Cloud storage (เข้ารหัสก่อนส่ง) · (ค) ทั้งสอง | **(ค)** — อนุมัติแล้ว แต่ยืนยันภายหลังว่าไม่มี NAS → 💡 ปรับเป็น Object storage ผู้ให้บริการอีกราย + ฮาร์ดดิสก์ภายนอกรายเดือน (Decision-Review ค-4) | ป้องกันทั้งผู้ให้บริการหลักมีปัญหาและ ransomware |
| **D-9** | บัญชีแยกประเภท (GL) | (ก) ทำ sub-ledger (ลูกหนี้ เจ้าหนี้ สต๊อก ภาษี) ตาม B2–B6 และออกแบบตาราง `journal_*` ไว้ ยังไม่สร้าง · (ข) ทำ GL double-entry เต็มรูปใน B6 | **(ก)** | ตรงขอบเขตที่สั่ง; GL เต็มรูปเพิ่มงาน 3–4 สัปดาห์ เสนอเป็น Phase B8 หลัง UAT ถ้าต้องการปิดงบในระบบ |
| **D-10** | ภาษาโปรแกรม backend | (ก) TypeScript · (ข) JavaScript | **(ก)** | ลดบั๊กข้ามโมดูลเมื่อระบบใหญ่ขึ้น · ต้อง build ก่อนรัน (อยู่ใน Docker แล้ว) |

## 14. ความเสี่ยงหลักระดับสถาปัตยกรรม

| ความเสี่ยง | ผลกระทบ | การป้องกัน |
|---|---|---|
| Logic ฝั่ง server ทำงานต่างจาก workflow.jsx เดิม | เอกสารคำนวณผิด | Port โดยคงชื่อ/กฎ, ใช้ test เดิม 50 กรณี + test เทียบผลระหว่าง engine เดิมกับใหม่ด้วยข้อมูลชุดเดียวกัน |
| UI เปลี่ยนจาก sync เป็น async | ปุ่มกดซ้ำ, modal ปิดก่อนได้ผล | `runAction` รองรับ Promise, ปุ่ม disable ระหว่างรอ, Idempotency-Key |
| ข้อมูล localStorage กระจายหลายเครื่อง | ข้อมูลหาย/ชนกัน | สำรวจทุกเครื่องก่อน cutover, dry-run, รายงานตรวจสอบ (Data-Migration-Plan) |
| Server ล่ม = ทั้งบริษัทหยุด | ปฏิบัติงานไม่ได้ | Snapshot + backup ต่างผู้ให้บริการ + ทดสอบกู้คืนรายสัปดาห์, RTO 2 ชม., คู่มือกู้คืน |
| อินเทอร์เน็ตโรงงานล่ม (แทบไม่เกิด ✅) | คนในโรงงานเข้าระบบไม่ได้ | 💡 Mobile Hotspot 2 คนที่กำหนด + Downtime procedure, ทบทวนซื้อ Router 4G ถ้าล่มเกินเกณฑ์ (Cloud-Infrastructure §9) |
| ไม่มีพนักงาน IT (✅) | แจ้งเตือนไม่มีคนรับ, backup ล้มเหลวโดยไม่รู้ตัว | 💡 Managed PostgreSQL, ทดสอบ restore อัตโนมัติ + อีเมลผล, ⏳ C-11 กำหนดผู้รับผิดชอบ |
| ระบบเปิดสู่อินเทอร์เน็ต | ถูกเดารหัส/โจมตี | 2FA ผู้มีสิทธิ์สูง, rate limit, firewall, อัปเดตอัตโนมัติ, uptime/security alert |
| ผูกติดผู้ให้บริการ Cloud | ย้ายไม่ได้เมื่อราคาขึ้น/บริการแย่ | ใช้แต่ส่วนมาตรฐาน + ซ้อมย้ายปีละครั้ง (Cloud-Infrastructure §3) |
| ต้นทุน FIFO/MA คำนวณผิดเมื่อมีรายการย้อนหลัง | งบการเงินผิด | Period lock, recalculation ที่ควบคุมได้ + test ชุดตัวเลขอ้างอิง (Database-Schema §8) |
