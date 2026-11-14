# PolyMate ERP — Spring Boot Backend (สิ่งที่สร้างแล้ว)

Stack: Java 17 · Spring Boot 4.1 · PostgreSQL (JdbcTemplate, ไม่ใช้ ORM) · Base URL `/api/v1` · Auth: `Authorization: Bearer <token>` จาก `POST /auth/login`

โค้ด: `erp/src/main/java/com/backend/erp/` · Schema: `erp/src/main/resources/schema.sql` (สร้างอัตโนมัติ idempotent ตอนเริ่มระบบ)

## ต่อ Database บน EC2
1. บน EC2: ติดตั้ง PostgreSQL 16, สร้าง DB/ผู้ใช้
   `CREATE USER erp_app WITH PASSWORD '…'; CREATE DATABASE erp OWNER erp_app;`
2. ให้ Backend อยู่เครื่องเดียวกับ DB (แนะนำ `DB_URL=jdbc:postgresql://localhost:5432/erp`) หรือเปิด Security Group port 5432 เฉพาะ IP ของ Backend เท่านั้น (ห้ามเปิด 0.0.0.0/0) และตั้ง `listen_addresses` / `pg_hba.conf` (`scram-sha-256`)
3. ตั้ง `DB_URL`, `DB_USERNAME`, `DB_PASSWORD` (ดู `erp/.env.example`) แล้วรัน `npm run backend` หรือ `docker compose up -d --build`
4. ครั้งแรกระบบสร้าง user `admin` — รหัสผ่านจาก `ADMIN_INITIAL_PASSWORD` หรือสุ่มและพิมพ์ใน log (ต้องเปลี่ยนเมื่อ login ครั้งแรก)

## Endpoints
| กลุ่ม | Endpoint |
|---|---|
| ระบบ | `GET /healthz` |
| Auth | `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `POST /auth/change-password` |
| ผู้ใช้ (admin) | `GET/POST /users` · `GET/PATCH /users/{id}` · `POST /users/{id}/reset-password` · `/suspend` · `/activate` |
| ข้อมูล (CRUD) | `GET/POST /{c}` · `GET/PUT/PATCH/DELETE /{c}/{id}` โดย `{c}` = `docs, customers, suppliers, purchaseOrders, expenses, employees, materials, finished, workOrders, qc, molds, machines, boms, stockMovements` (`?q=&limit=&offset=`) |
| เลขเอกสาร | `GET /counters/{prefix}/peek?date=` · `POST /counters/{prefix}/next?date=` (atomic) |
| Workflow | `POST /actions/purchase-orders/{id}/receive` · `POST /actions/work-orders/{id}/produce {produced, ng}` · `POST /actions/stock/adjust {code, delta, ref, note, allowNegative}` |
| Audit | `GET /audit-logs?q=&action=&entity=&user=&from=&to=` · `POST /audit-logs` (PRINT/EXPORT/VIEW) |
| ตั้งค่า | `GET/PUT /settings/company` |
| Sync/Backup | `GET /bootstrap` · `GET /admin/export` · `POST /admin/import` (นำเข้าไฟล์ backup จาก localStorage เดิม รวมรหัสผ่านเดิม — rehash เป็น BCrypt ตอน login ครั้งแรก) |

กติกา: error เป็น `{ "error": { "code", "message" } }` (400/401/403/404/409/422/429) · แต่ละ record มี `_version` — ส่งกลับมาตอน `PUT/PATCH` ถ้าไม่ตรงได้ `409 VERSION_CONFLICT` · เขียนได้ตาม role (`Collections.java`) · audit log เป็น append-only (trigger ใน DB) · ล็อกบัญชี 15 นาทีหลังผิด 10 ครั้ง, 5 login/นาที/IP

## ทดสอบ
`cd erp && ./gradlew test` — integration test 6 ชุดกับ PostgreSQL จริง (embedded, ไม่ต้องใช้ Docker): login/เปลี่ยนรหัส, CRUD + optimistic lock, role, เลขเอกสาร, รับของ PO / บันทึกผลิต / ปรับสต๊อก (rollback), import/export

## ยังไม่ได้ทำ (เฟสถัดไป)
- UI สลับมาใช้ API แล้ว (store.jsx: โหลด /bootstrap → แก้ไขใน memory → sync POST/PUT/DELETE อัตโนมัติ, poll 20 วินาที) แต่ logic เอกสาร/ต้นทุนยังคำนวณฝั่ง client, เลขเอกสารอาจชนกันเมื่อหลายคนออกเลขพร้อมกัน (ระบบแจ้งเตือนและโหลดข้อมูลใหม่)
- Workflow engine ฝั่ง server (convert/approve/cancel เอกสารขาย-ซื้อ ตามสเปก B1), FIFO/Moving Average, 50 ทวิ, approval policy, fiscal period, attachments — ยังคำนวณใน `workflow.jsx` ฝั่ง client
- HTTPS / reverse proxy (nginx หรือ Caddy) หน้า API, backup ฐานข้อมูลอัตโนมัติ
