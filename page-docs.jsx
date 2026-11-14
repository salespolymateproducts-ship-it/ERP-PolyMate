/* global React, I, PageHeader, Tabs */

function PageDocs() {
  const [tab, setTab] = useState("ER");

  return (
    <>
      <PageHeader
        title="เอกสารระบบ / Technical Documentation"
        subtitle="แบบสถาปัตยกรรมเป้าหมาย (PostgreSQL + REST API) สำหรับย้ายระบบขึ้น Backend"
        actions={<button className="btn btn-outline btn-sm" onClick={() => printDoc()}><I.Printer size={14}/> พิมพ์ / PDF</button>}
      />
      <div className="card" style={{ padding: 14, marginBottom: 14, borderLeft: "4px solid var(--amber)", fontSize: 13 }}>
        <b>สถานะปัจจุบัน:</b> ข้อมูลเก็บที่ Backend (Spring Boot + PostgreSQL) ผ่าน /api/v1 — Schema/API ในหน้านี้คือ<b>แบบเป้าหมายเต็ม (B1)</b> ปัจจุบันใช้งานจริงบางส่วน: ดู docs/Backend-Spring-API.md
        ตรรกะเอกสาร/สถานะ/สิทธิ์อยู่ใน <span className="mono">workflow.jsx</span> และ <span className="mono">store.jsx</span> ซึ่งออกแบบให้ย้ายไปฝั่ง Server ได้ · สำรองข้อมูลด้วยเมนู “ข้อมูล → ส่งออกไฟล์สำรอง” ในหน้าเอกสารขายเป็นประจำ
      </div>

      <Tabs
        items={[
          { id: "ER", label: "ER Diagram" },
          { id: "SCHEMA", label: "Database Schema" },
          { id: "API", label: "API Endpoints" },
          { id: "FOLDER", label: "Folder Structure" },
          { id: "FLOW", label: "Workflow" },
          { id: "BP", label: "Best Practices" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "ER" && <ERDiagram/>}
      {tab === "SCHEMA" && <SchemaView/>}
      {tab === "API" && <APIView/>}
      {tab === "FOLDER" && <FolderView/>}
      {tab === "FLOW" && <WorkflowView/>}
      {tab === "BP" && <BestPractices/>}
    </>
  );
}

// --- ER DIAGRAM ---
const ENTITIES = [
  { id: "users", title: "users", x: 30, y: 30, color: "#7C3AED", fields: ["id PK", "username", "password_hash", "full_name", "role", "department", "active", "created_at"] },
  { id: "audit_logs", title: "audit_logs", x: 30, y: 290, color: "#7C3AED", fields: ["id PK", "user_id FK", "action", "entity", "entity_id", "ip", "created_at"] },
  { id: "customers", title: "customers", x: 290, y: 30, color: "#2D6CDF", fields: ["id PK", "code", "name_th", "name_en", "tax_id", "address", "credit_days", "contact", "phone", "email", "segment", "status"] },
  { id: "quotations", title: "quotations", x: 290, y: 320, color: "#2D6CDF", fields: ["id PK", "doc_no", "customer_id FK", "date", "valid_until", "subtotal", "vat", "total", "status", "created_by FK"] },
  { id: "invoices", title: "invoices", x: 290, y: 590, color: "#2D6CDF", fields: ["id PK", "doc_no", "customer_id FK", "quotation_id FK", "date", "due_date", "subtotal", "vat", "total", "paid_amount", "status"] },
  { id: "doc_items", title: "doc_items", x: 580, y: 320, color: "#0EA5C7", fields: ["id PK", "doc_type", "doc_id", "product_id FK", "name", "qty", "unit", "unit_price", "amount"] },
  { id: "payments", title: "payments", x: 580, y: 590, color: "#16A34A", fields: ["id PK", "invoice_id FK", "date", "method", "amount", "ref", "attachment_url"] },
  { id: "products", title: "products", x: 870, y: 30, color: "#16A34A", fields: ["id PK", "code", "name", "type", "customer_id FK", "unit", "cost", "price", "stock_qty", "mold_id FK"] },
  { id: "molds", title: "molds", x: 870, y: 320, color: "#D97706", fields: ["id PK", "code", "name", "customer_id FK", "cavities", "size", "weight", "machine_min", "machine_max", "shot_count", "shot_life", "status", "image_url"] },
  { id: "mold_maint", title: "mold_maintenance", x: 870, y: 600, color: "#D97706", fields: ["id PK", "mold_id FK", "date", "type", "performed_by", "cost", "notes"] },
  { id: "work_orders", title: "work_orders", x: 1170, y: 30, color: "#DC2626", fields: ["id PK", "doc_no", "product_id FK", "customer_id FK", "mold_id FK", "machine_id FK", "quantity", "produced", "ng", "cavities", "cycle_time", "status", "due_date"] },
  { id: "machines", title: "machines", x: 1170, y: 320, color: "#DC2626", fields: ["id PK", "code", "name", "tonnage", "status", "current_wo_id"] },
  { id: "production_logs", title: "production_logs", x: 1170, y: 580, color: "#DC2626", fields: ["id PK", "work_order_id FK", "operator_id FK", "timestamp", "produced", "ng", "downtime_min"] },
  { id: "materials", title: "materials", x: 30, y: 600, color: "#0F9F8F", fields: ["id PK", "code", "name", "type", "unit", "cost", "supplier", "location", "stock_qty", "min_qty", "max_qty"] },
  { id: "stock_movements", title: "stock_movements", x: 320, y: 870, color: "#0F9F8F", fields: ["id PK", "item_type", "item_id", "movement", "qty", "ref_type", "ref_id", "user_id FK", "timestamp", "note"] },
  { id: "expenses", title: "expenses", x: 620, y: 870, color: "#94A3B8", fields: ["id PK", "doc_no", "date", "category", "vendor", "description", "amount", "vat", "attachment_url", "status", "approved_by FK"] },
  { id: "employees", title: "employees", x: 920, y: 870, color: "#94A3B8", fields: ["id PK", "code", "name", "role", "department", "phone", "joined_date", "salary", "user_id FK"] },
];

const RELATIONS = [
  ["users", "audit_logs"], ["users", "quotations"], ["users", "expenses"], ["users", "stock_movements"],
  ["customers", "quotations"], ["customers", "invoices"], ["customers", "products"], ["customers", "molds"], ["customers", "work_orders"],
  ["quotations", "doc_items"], ["invoices", "doc_items"], ["invoices", "payments"],
  ["products", "doc_items"], ["products", "work_orders"],
  ["molds", "products"], ["molds", "mold_maint"], ["molds", "work_orders"],
  ["machines", "work_orders"], ["work_orders", "production_logs"],
  ["materials", "stock_movements"], ["employees", "users"], ["employees", "production_logs"],
];

function ERDiagram() {
  const W = 1480, H = 1080;
  const findE = (id) => ENTITIES.find((e) => e.id === id);
  const cardW = 220;
  const cardH = (fields) => 28 + fields.length * 18 + 8;

  // Build connector paths
  const paths = RELATIONS.map(([a, b], i) => {
    const A = findE(a), B = findE(b);
    if (!A || !B) return null;
    const ax = A.x + cardW / 2, ay = A.y + cardH(A.fields) / 2;
    const bx = B.x + cardW / 2, by = B.y + cardH(B.fields) / 2;
    // orthogonal route
    const midX = (ax + bx) / 2;
    return (
      <g key={i}>
        <path d={`M ${ax} ${ay} L ${midX} ${ay} L ${midX} ${by} L ${bx} ${by}`}
          fill="none" stroke="var(--border-strong)" strokeWidth="1.2" strokeDasharray="3,3" opacity="0.7"/>
      </g>
    );
  });

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">PolyMate ERP · ER Diagram</div>
          <div className="card-sub">17 entities · ออกแบบสำหรับโรงงานพลาสติกที่มีงานหลายประเภท (Injection / Mold / Trading / OEM)</div>
        </div>
        <div className="card-actions">
          <button className="btn btn-ghost btn-sm"><I.Download size={13}/> ดาวน์โหลด SVG</button>
        </div>
      </div>
      <div style={{ padding: 16, overflow: "auto", background: "var(--bg-subtle)" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block", maxWidth: "100%", height: "auto" }}>
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--border)" strokeWidth="0.5" opacity="0.6"/>
            </pattern>
          </defs>
          <rect width={W} height={H} fill="url(#grid)"/>
          {paths}
          {ENTITIES.map((e) => (
            <g key={e.id} transform={`translate(${e.x}, ${e.y})`}>
              <rect width={cardW} height={cardH(e.fields)} rx="8" fill="var(--bg-elevated)" stroke="var(--border-strong)" strokeWidth="1"/>
              <rect width={cardW} height="28" rx="8" fill={e.color}/>
              <rect y="20" width={cardW} height="8" fill={e.color}/>
              <text x="12" y="19" fill="white" fontSize="13" fontWeight="600" fontFamily="var(--font-mono)">{e.title}</text>
              {e.fields.map((f, i) => {
                const isPK = f.includes("PK");
                const isFK = f.includes("FK");
                return (
                  <g key={i}>
                    <text x="12" y={46 + i * 18} fontSize="11" fontFamily="var(--font-mono)" fill="var(--text-primary)">
                      <tspan fill={isPK ? "#D97706" : isFK ? "#2D6CDF" : "var(--text-primary)"} fontWeight={isPK || isFK ? "600" : "400"}>{f.replace(" PK", "").replace(" FK", "")}</tspan>
                      {isPK && <tspan fill="#D97706" fontSize="9" dx="4">PK</tspan>}
                      {isFK && <tspan fill="#2D6CDF" fontSize="9" dx="4">FK</tspan>}
                    </text>
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

// --- SCHEMA ---
function SchemaView() {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">PostgreSQL Schema · DDL</div>
          <div className="card-sub">17 ตาราง · รองรับ multi-warehouse, audit trail, soft-delete</div>
        </div>
        <div className="card-actions">
          <button className="btn btn-ghost btn-sm"><I.Copy size={13}/> คัดลอก</button>
          <button className="btn btn-ghost btn-sm"><I.Download size={13}/> ดาวน์โหลด .sql</button>
        </div>
      </div>
      <pre style={{
        margin: 0, padding: 18, background: "#0B1220", color: "#E6EAF2",
        fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.65,
        overflow: "auto", maxHeight: 640, borderRadius: "0 0 10px 10px"
      }}>{`-- ========================================================
-- PolyMate ERP · PostgreSQL Schema (excerpt)
-- ========================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===== Users & Auth =====
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username        VARCHAR(64) UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  full_name       VARCHAR(160) NOT NULL,
  email           VARCHAR(160),
  role            VARCHAR(32)  NOT NULL CHECK (role IN
                  ('admin','accounting','sales','production','warehouse','hr')),
  department      VARCHAR(64),
  active          BOOLEAN DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  action      VARCHAR(32) NOT NULL,
  entity      VARCHAR(64) NOT NULL,
  entity_id   TEXT,
  payload     JSONB,
  ip          INET,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ===== Customers =====
CREATE TABLE customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(20) UNIQUE NOT NULL,
  name_th       VARCHAR(200) NOT NULL,
  name_en       VARCHAR(200),
  tax_id        VARCHAR(20),
  branch_code   VARCHAR(8) DEFAULT '00000',
  address       TEXT,
  contact_name  VARCHAR(120),
  phone         VARCHAR(32),
  email         VARCHAR(160),
  credit_days   INTEGER DEFAULT 30,
  segment       VARCHAR(40),
  status        VARCHAR(16) DEFAULT 'active',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

-- ===== Products & Molds =====
CREATE TABLE molds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(40) UNIQUE NOT NULL,
  name            VARCHAR(160) NOT NULL,
  customer_id     UUID REFERENCES customers(id),
  cavities        INTEGER NOT NULL,
  size            VARCHAR(64),       -- "650×420×380 mm"
  weight_kg       NUMERIC(10,2),
  machine_min_t   INTEGER,
  machine_max_t   INTEGER,
  shot_count      BIGINT  DEFAULT 0,
  shot_life       BIGINT  DEFAULT 500000,
  last_maint_date DATE,
  status          VARCHAR(16) DEFAULT 'available',
  location        VARCHAR(40),
  image_url       TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(40) UNIQUE NOT NULL,
  name          VARCHAR(200) NOT NULL,
  type          VARCHAR(16)  NOT NULL CHECK (type IN ('FG','RM','MB','STEEL','PACK')),
  customer_id   UUID REFERENCES customers(id),
  mold_id       UUID REFERENCES molds(id),
  unit          VARCHAR(8)   NOT NULL DEFAULT 'PCS',  -- KG / PCS
  cost          NUMERIC(12,4),
  price         NUMERIC(12,4),
  stock_qty     NUMERIC(14,4) DEFAULT 0,
  min_qty       NUMERIC(14,4) DEFAULT 0,
  max_qty       NUMERIC(14,4),
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ===== Sales Docs =====
CREATE TABLE quotations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no        VARCHAR(32) UNIQUE NOT NULL,
  customer_id   UUID REFERENCES customers(id),
  doc_date      DATE NOT NULL,
  valid_until   DATE,
  subtotal      NUMERIC(14,2) DEFAULT 0,
  vat           NUMERIC(14,2) DEFAULT 0,
  total         NUMERIC(14,2) DEFAULT 0,
  status        VARCHAR(16)  DEFAULT 'draft',
  note          TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no          VARCHAR(32) UNIQUE NOT NULL,
  customer_id     UUID REFERENCES customers(id),
  quotation_id    UUID REFERENCES quotations(id),
  doc_date        DATE NOT NULL,
  due_date        DATE,
  subtotal        NUMERIC(14,2),
  vat             NUMERIC(14,2),
  total           NUMERIC(14,2),
  paid_amount     NUMERIC(14,2) DEFAULT 0,
  status          VARCHAR(16) DEFAULT 'unpaid',
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- doc_items is polymorphic: doc_type ∈ ('QT','INV','DO','BN')
CREATE TABLE doc_items (
  id            BIGSERIAL PRIMARY KEY,
  doc_type      VARCHAR(8)  NOT NULL,
  doc_id        UUID NOT NULL,
  product_id    UUID REFERENCES products(id),
  description   VARCHAR(240),
  qty           NUMERIC(14,4),
  unit          VARCHAR(8),
  unit_price    NUMERIC(14,4),
  amount        NUMERIC(14,2),
  sort_order    INTEGER DEFAULT 0
);
CREATE INDEX ix_doc_items_doc ON doc_items(doc_type, doc_id);

CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID REFERENCES invoices(id),
  paid_date       DATE NOT NULL,
  method          VARCHAR(16) NOT NULL,  -- cash, transfer, cheque
  amount          NUMERIC(14,2) NOT NULL,
  reference       VARCHAR(120),
  attachment_url  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ===== Production =====
CREATE TABLE machines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(16) UNIQUE NOT NULL,
  name            VARCHAR(120) NOT NULL,
  tonnage         INTEGER NOT NULL,
  status          VARCHAR(16) DEFAULT 'idle',
  current_wo_id   UUID
);

CREATE TABLE work_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no          VARCHAR(32) UNIQUE NOT NULL,
  product_id      UUID REFERENCES products(id),
  customer_id     UUID REFERENCES customers(id),
  mold_id         UUID REFERENCES molds(id),
  machine_id      UUID REFERENCES machines(id),
  quantity        INTEGER NOT NULL,
  produced        INTEGER DEFAULT 0,
  ng              INTEGER DEFAULT 0,
  cavities        INTEGER NOT NULL,
  cycle_time_s    NUMERIC(8,2) NOT NULL,
  priority        VARCHAR(8)  DEFAULT 'normal',
  status          VARCHAR(16) DEFAULT 'queued',
  start_date      DATE,
  due_date        DATE,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE production_logs (
  id            BIGSERIAL PRIMARY KEY,
  work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE,
  operator_id   UUID REFERENCES users(id),
  produced      INTEGER,
  ng            INTEGER,
  downtime_min  INTEGER,
  reason        VARCHAR(120),
  logged_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ===== Inventory =====
CREATE TABLE stock_movements (
  id            BIGSERIAL PRIMARY KEY,
  product_id    UUID REFERENCES products(id),
  movement      VARCHAR(8)  NOT NULL,    -- IN, OUT, MOVE, ADJ
  qty           NUMERIC(14,4) NOT NULL,
  unit_cost     NUMERIC(12,4),
  ref_type      VARCHAR(16),             -- WO, DO, PO, ADJ
  ref_id        UUID,
  from_location VARCHAR(40),
  to_location   VARCHAR(40),
  user_id       UUID REFERENCES users(id),
  note          TEXT,
  occurred_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ===== Accounting =====
CREATE TABLE expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no          VARCHAR(32) UNIQUE NOT NULL,
  doc_date        DATE NOT NULL,
  category        VARCHAR(40) NOT NULL,
  vendor          VARCHAR(160),
  description     TEXT,
  amount          NUMERIC(14,2) NOT NULL,
  vat             NUMERIC(14,2) DEFAULT 0,
  attachment_url  TEXT,
  status          VARCHAR(16) DEFAULT 'pending',
  approved_by     UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ===== HR =====
CREATE TABLE employees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(16) UNIQUE NOT NULL,
  user_id       UUID REFERENCES users(id),
  name          VARCHAR(160) NOT NULL,
  role          VARCHAR(80),
  department    VARCHAR(40),
  phone         VARCHAR(32),
  joined_date   DATE,
  salary        NUMERIC(12,2),
  active        BOOLEAN DEFAULT TRUE
);

-- ===== Indexes =====
CREATE INDEX ix_invoices_status ON invoices(status, due_date);
CREATE INDEX ix_wo_status       ON work_orders(status, due_date);
CREATE INDEX ix_stock_product   ON stock_movements(product_id, occurred_at DESC);
CREATE INDEX ix_audit_user      ON audit_logs(user_id, created_at DESC);
`}</pre>
    </div>
  );
}

// --- API ---
const API_ROUTES = [
  { group: "Auth", routes: [
    ["POST", "/api/auth/login", "เข้าสู่ระบบด้วย username/password — คืน JWT"],
    ["POST", "/api/auth/refresh", "ต่ออายุ token"],
    ["POST", "/api/auth/logout", "ออกจากระบบ"],
    ["GET", "/api/auth/me", "ข้อมูลผู้ใช้ปัจจุบัน"],
  ]},
  { group: "Sales · เอกสารขาย", routes: [
    ["GET", "/api/quotations", "รายการใบเสนอราคา (filter, paginate, search)"],
    ["POST", "/api/quotations", "สร้างใบเสนอราคาใหม่"],
    ["GET", "/api/quotations/:id", "ดูใบเสนอราคา"],
    ["PATCH", "/api/quotations/:id", "แก้ไข"],
    ["POST", "/api/quotations/:id/convert", "แปลงเป็นใบกำกับภาษี"],
    ["GET", "/api/quotations/:id/pdf", "ดาวน์โหลด PDF"],
    ["POST", "/api/quotations/:id/send", "ส่ง LINE / Email"],
    ["GET", "/api/invoices", "ใบกำกับภาษีทั้งหมด"],
    ["POST", "/api/invoices/:id/payments", "บันทึกชำระเงิน + แนบหลักฐาน"],
    ["GET", "/api/billing-notes", "ใบวางบิล"],
    ["GET", "/api/receipts", "ใบเสร็จ"],
  ]},
  { group: "Customers · ลูกค้า", routes: [
    ["GET", "/api/customers", "ลูกค้าทั้งหมด (search by name, taxId)"],
    ["POST", "/api/customers", "เพิ่มลูกค้า"],
    ["GET", "/api/customers/:id", "ข้อมูลลูกค้า"],
    ["GET", "/api/customers/:id/purchases", "ประวัติการซื้อ"],
    ["PATCH", "/api/customers/:id", "อัปเดต"],
  ]},
  { group: "Production · ผลิต", routes: [
    ["GET", "/api/work-orders", "ใบสั่งผลิต (filter by status, machine)"],
    ["POST", "/api/work-orders", "เปิดใบสั่งผลิต (auto คำนวณเวลา/ต้นทุน)"],
    ["GET", "/api/work-orders/:id", "ดูใบสั่งผลิต + ต้นทุน"],
    ["POST", "/api/work-orders/:id/logs", "บันทึกการผลิต (qty, NG)"],
    ["POST", "/api/work-orders/:id/close", "ปิดงาน — ตัดสต๊อกอัตโนมัติ"],
    ["GET", "/api/machines", "สถานะเครื่องจักร (real-time)"],
    ["GET", "/api/machines/:id/oee", "OEE ของเครื่อง"],
  ]},
  { group: "Inventory · คลังสินค้า", routes: [
    ["GET", "/api/inventory", "สต๊อกทั้งหมด"],
    ["POST", "/api/inventory/receive", "รับเข้า"],
    ["POST", "/api/inventory/issue", "เบิกออก"],
    ["POST", "/api/inventory/transfer", "โอนคลัง"],
    ["POST", "/api/inventory/adjust", "ปรับปรุงยอด"],
    ["GET", "/api/inventory/movements", "Stock Movement ย้อนหลัง"],
    ["GET", "/api/inventory/alerts", "รายการใกล้หมด"],
  ]},
  { group: "Molds · แม่พิมพ์", routes: [
    ["GET", "/api/molds", "แม่พิมพ์ทั้งหมด"],
    ["POST", "/api/molds", "เพิ่ม + อัปโหลดรูป"],
    ["GET", "/api/molds/:id", "ข้อมูล + ประวัติ Shot/Maintenance"],
    ["POST", "/api/molds/:id/maintenance", "บันทึก Maintenance"],
    ["GET", "/api/molds/alerts", "แม่พิมพ์ใกล้ครบรอบ Maintenance"],
  ]},
  { group: "Accounting", routes: [
    ["GET", "/api/expenses", "ค่าใช้จ่ายทั้งหมด"],
    ["POST", "/api/expenses", "บันทึกค่าใช้จ่าย (รองรับแนบไฟล์)"],
    ["GET", "/api/expenses/summary", "สรุปต้นทุนรายเดือนแยกหมวด"],
    ["GET", "/api/payables", "เจ้าหนี้ค้างจ่าย"],
    ["GET", "/api/reports/pl", "งบกำไรขาดทุน"],
  ]},
  { group: "Reports · Dashboard", routes: [
    ["GET", "/api/dashboard/kpi", "KPI ภาพรวม Real-time"],
    ["GET", "/api/reports/sales", "ยอดขายรายวัน/เดือน/ปี"],
    ["GET", "/api/reports/production", "ประสิทธิภาพการผลิต"],
    ["GET", "/api/reports/top-customers", "ลูกค้าซื้อสูงสุด"],
    ["GET", "/api/reports/export/excel", "ส่งออก Excel"],
  ]},
  { group: "HR & Settings", routes: [
    ["GET", "/api/employees", "พนักงาน"],
    ["GET", "/api/users", "ผู้ใช้ระบบ (Admin)"],
    ["GET", "/api/audit-logs", "Log การใช้งาน"],
    ["GET", "/api/settings", "ตั้งค่าบริษัท"],
  ]},
];

function APIView() {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">REST API · v1</div>
          <div className="card-sub">JWT auth · JSON · RESTful · OpenAPI 3.1 spec available at /api/docs</div>
        </div>
        <div className="card-actions">
          <span className="badge badge-info">Base URL: <span className="mono">/api</span></span>
        </div>
      </div>
      <div style={{ padding: 18 }}>
        {API_ROUTES.map((g, i) => (
          <div key={i} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>{g.group}</div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              {g.routes.map((r, j) => {
                const method = r[0];
                const colors = { GET: "info", POST: "success", PATCH: "warning", DELETE: "danger", PUT: "violet" };
                return (
                  <div key={j} style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderBottom: j === g.routes.length - 1 ? "none" : "1px solid var(--border)", gap: 12 }}>
                    <span className={"badge badge-" + colors[method]} style={{ width: 56, justifyContent: "center", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{method}</span>
                    <span className="mono" style={{ fontSize: 12.5, color: "var(--text-primary)", minWidth: 260 }}>{r[1]}</span>
                    <span style={{ fontSize: 12.5, color: "var(--text-secondary)", flex: 1 }}>{r[2]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- FOLDER ---
function FolderView() {
  const tree = `polymate-erp/
├── apps/
│   ├── web/                          ← Next.js 14 (App Router)
│   │   ├── app/
│   │   │   ├── (auth)/login/
│   │   │   ├── (dashboard)/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── sales/
│   │   │   │   │   ├── quotations/
│   │   │   │   │   ├── invoices/
│   │   │   │   │   ├── billing-notes/
│   │   │   │   │   └── receipts/
│   │   │   │   ├── customers/
│   │   │   │   ├── production/
│   │   │   │   │   ├── work-orders/
│   │   │   │   │   └── machines/
│   │   │   │   ├── inventory/
│   │   │   │   ├── molds/
│   │   │   │   ├── accounting/
│   │   │   │   ├── hr/
│   │   │   │   ├── reports/
│   │   │   │   └── settings/
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   ├── ui/                   ← buttons, table, drawer, ...
│   │   │   ├── charts/
│   │   │   ├── forms/
│   │   │   └── shared/
│   │   ├── lib/
│   │   │   ├── api-client.ts
│   │   │   ├── auth.ts
│   │   │   └── i18n/                 ← th, en
│   │   ├── public/
│   │   ├── styles/
│   │   ├── tailwind.config.ts
│   │   └── next.config.js
│   │
│   └── api/                          ← NestJS / Express (Node)
│       ├── src/
│       │   ├── auth/                 ← JWT, guards, roles
│       │   ├── customers/
│       │   ├── sales/
│       │   │   ├── quotations/
│       │   │   ├── invoices/
│       │   │   ├── billing-notes/
│       │   │   └── receipts/
│       │   ├── production/
│       │   │   ├── work-orders/
│       │   │   ├── machines/
│       │   │   └── cost-engine/      ← auto-cost calc
│       │   ├── inventory/
│       │   │   ├── products/
│       │   │   ├── movements/
│       │   │   └── alerts/
│       │   ├── molds/
│       │   ├── accounting/
│       │   │   ├── expenses/
│       │   │   └── payables/
│       │   ├── hr/
│       │   ├── reports/
│       │   ├── files/                ← attachments (S3 / MinIO)
│       │   ├── notifications/        ← LINE, Email
│       │   ├── common/
│       │   │   ├── pdf/              ← Puppeteer for invoice PDF
│       │   │   ├── excel/            ← exceljs
│       │   │   └── audit/
│       │   └── main.ts
│       ├── prisma/
│       │   ├── schema.prisma
│       │   └── migrations/
│       └── test/
│
├── packages/
│   ├── shared-types/                 ← zod schemas / DTOs
│   ├── ui-kit/                       ← reusable components
│   └── config/                       ← eslint, tsconfig
│
├── deploy/
│   ├── docker-compose.yml
│   ├── nginx.conf
│   └── k8s/
├── docs/
│   ├── ER-diagram.svg
│   ├── api.openapi.yaml
│   └── workflow.md
├── .env.example
├── pnpm-workspace.yaml
└── README.md`;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Monorepo Folder Structure</div>
          <div className="card-sub">pnpm workspace · Next.js (frontend) + NestJS (backend) + Prisma (PostgreSQL)</div>
        </div>
      </div>
      <pre style={{
        margin: 0, padding: 18, background: "#0B1220", color: "#E6EAF2",
        fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.55,
        overflow: "auto", maxHeight: 640, borderRadius: "0 0 10px 10px",
        whiteSpace: "pre"
      }}>{tree}</pre>
    </div>
  );
}

// --- WORKFLOW ---
function WorkflowView() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <FlowCard
        title="Flow 1 · กระบวนการขาย (Quote-to-Cash)"
        steps={[
          { label: "ใบเสนอราคา", role: "ฝ่ายขาย", icon: "FileText", color: "#2D6CDF" },
          { label: "ลูกค้าอนุมัติ", role: "ลูกค้า", icon: "Check", color: "#16A34A" },
          { label: "เปิด WO ผลิต", role: "ฝ่ายผลิต", icon: "Factory", color: "#7C3AED" },
          { label: "บิลส่งสินค้า", role: "คลัง", icon: "Truck", color: "#0EA5C7" },
          { label: "ใบกำกับภาษี", role: "บัญชี", icon: "Receipt", color: "#D97706" },
          { label: "ใบวางบิล", role: "บัญชี", icon: "Wallet", color: "#D97706" },
          { label: "รับชำระ + ใบเสร็จ", role: "บัญชี", icon: "Check", color: "#16A34A" },
        ]}
      />
      <FlowCard
        title="Flow 2 · กระบวนการผลิต (Plan-to-Produce)"
        steps={[
          { label: "เปิดใบสั่งผลิต", role: "Planner", icon: "Plus", color: "#2D6CDF" },
          { label: "ตรวจสต๊อกวัตถุดิบ", role: "คลัง", icon: "Boxes", color: "#0EA5C7" },
          { label: "เลือกเครื่อง + แม่พิมพ์", role: "Planner", icon: "Factory", color: "#7C3AED" },
          { label: "Setup เครื่อง", role: "ช่าง", icon: "Wrench", color: "#D97706" },
          { label: "ผลิต + บันทึก qty/NG", role: "Operator", icon: "Factory", color: "#2D6CDF" },
          { label: "QC ตรวจสอบ", role: "QC", icon: "Check", color: "#16A34A" },
          { label: "ปิดงาน · ตัดสต๊อก auto", role: "ระบบ", icon: "Boxes", color: "#16A34A" },
        ]}
      />
      <FlowCard
        title="Flow 3 · กระบวนการจัดซื้อ (Procure-to-Pay)"
        steps={[
          { label: "Min stock alert", role: "ระบบ", icon: "Alert", color: "#D97706" },
          { label: "ใบสั่งซื้อ (PO)", role: "จัดซื้อ", icon: "FileText", color: "#2D6CDF" },
          { label: "รับเข้าสต๊อก", role: "คลัง", icon: "Upload", color: "#0EA5C7" },
          { label: "บันทึกค่าใช้จ่าย", role: "บัญชี", icon: "Wallet", color: "#7C3AED" },
          { label: "ชำระเจ้าหนี้", role: "บัญชี", icon: "Check", color: "#16A34A" },
        ]}
      />
      <FlowCard
        title="Flow 4 · บำรุงรักษาแม่พิมพ์ (Mold Maintenance)"
        steps={[
          { label: "Shot count threshold", role: "ระบบ", icon: "Alert", color: "#D97706" },
          { label: "แจ้งหัวหน้าผลิต", role: "ระบบ", icon: "Bell", color: "#2D6CDF" },
          { label: "Schedule Maintenance", role: "ช่าง", icon: "Calendar", color: "#7C3AED" },
          { label: "บำรุงรักษา + Log", role: "ช่าง", icon: "Wrench", color: "#0EA5C7" },
          { label: "Reset Shot counter", role: "ระบบ", icon: "Check", color: "#16A34A" },
        ]}
      />
    </div>
  );
}

function FlowCard({ title, steps }) {
  return (
    <div className="card">
      <div className="card-head"><div className="card-title">{title}</div></div>
      <div style={{ padding: 22, overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 0, minWidth: "fit-content" }}>
          {steps.map((s, i) => {
            const Ico = I[s.icon] || I.Check;
            return (
              <React.Fragment key={i}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 110 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: s.color + "1F", color: s.color,
                    display: "grid", placeItems: "center",
                    border: "1px solid " + s.color + "33",
                  }}>
                    <Ico size={20}/>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 500, marginTop: 8, textAlign: "center" }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>{s.role}</div>
                </div>
                {i < steps.length - 1 && (
                  <div style={{ flex: 1, height: 44, display: "flex", alignItems: "center", justifyContent: "center", minWidth: 32 }}>
                    <svg width="32" height="14" viewBox="0 0 32 14"><path d="M0 7 L26 7 M20 2 L26 7 L20 12" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// --- Best Practices ---
function BestPractices() {
  const tips = [
    { title: "1. ออกแบบรหัสสินค้าให้สื่อความหมาย", body: "เช่น AP-DASH-22A = ลูกค้า AutoPlas + Dashboard + รุ่น 22A · ทำให้ค้นหาและสื่อสารง่ายในโรงงาน", icon: "Package" },
    { title: "2. ใช้ Master Mold (BOM) ผูกกับสินค้า", body: "ทุกสินค้าผูกกับแม่พิมพ์ + วัตถุดิบ + เปอร์เซ็นต์สี → เปิด WO ระบบคำนวณเวลา/ต้นทุนได้ทันที", icon: "Mold" },
    { title: "3. ตัดสต๊อกอัตโนมัติเมื่อปิด WO", body: "ใช้ Transaction-based stock movement · ไม่อนุญาตให้แก้ stock โดยตรง · ทุกการเคลื่อนไหวมีต้นทาง", icon: "Boxes" },
    { title: "4. NG % แยกตามแม่พิมพ์ + เครื่อง", body: "เก็บ NG ลึกถึงระดับ shot · จะวิเคราะห์ได้ว่าเป็นปัญหาที่แม่พิมพ์หรือเครื่อง · พยากรณ์ Maintenance ได้แม่นขึ้น", icon: "Alert" },
    { title: "5. Shot Counter ผูกกับ PLC", body: "เชื่อม PLC ของเครื่องฉีดผ่าน OPC-UA → ระบบรู้จำนวน shot จริง · แม่นยำกว่าให้ Operator กรอกเอง", icon: "Factory" },
    { title: "6. Audit Trail ทุก Transaction", body: "ทุกการแก้ไขเอกสาร/สต๊อก/ราคา ต้อง log ลง audit_logs พร้อม user_id + IP · สำคัญสำหรับ ISO 9001", icon: "Database" },
    { title: "7. Role-based Access Control (RBAC)", body: "Admin / บัญชี / ขาย / ผลิต / คลัง / HR · ใช้ JWT + middleware ตรวจสิทธิ์ระดับ API + UI", icon: "Users" },
    { title: "8. รองรับ Multi-currency", body: "ลูกค้าต่างประเทศ (Singapore, Japan) ต้องออก Invoice เป็น USD/SGD ได้ · เก็บอัตราแลกเปลี่ยน ณ วันออกเอกสาร", icon: "Wallet" },
    { title: "9. Backup + High Availability", body: "PostgreSQL streaming replication · daily snapshot ไป object storage · WAL archiving · ทดสอบ restore ทุก 3 เดือน", icon: "Database" },
    { title: "10. Mobile-first สำหรับ Operator", body: "หน้าจอบันทึกการผลิต / NG ต้องเปิดบนแท็บเล็ตได้ · ปุ่มใหญ่ · ใช้ได้แม้สวมถุงมือ", icon: "Factory" },
  ];

  return (
    <div className="grid-2">
      {tips.map((t, i) => {
        const Ico = I[t.icon] || I.Sparkles;
        return (
          <div key={i} className="card" style={{ padding: 18, display: "flex", gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--accent-subtle)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Ico size={18}/>
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.55 }}>{t.body}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Settings ---
function PageSettings() {
  useStore();
  const isAdmin = Store.user() && Store.user().role === "admin";
  const [co, setCo] = useState(() => ({ ...window.COMPANY }));
  const users = Store.state.users;
  const pageLabels = {
    dashboard: "แดชบอร์ด",
    sales: "เอกสารขาย",
    customers: "ลูกค้า",
    production: "ใบสั่งผลิต",
    molds: "แม่พิมพ์",
    inventory: "คงคลัง",
    shipping: "ขนส่ง",
    accounting: "บัญชี",
    hr: "พนักงาน",
    reports: "รายงาน",
    docs: "เอกสารระบบ",
    settings: "ตั้งค่า",
    "customer-po": "PO ลูกค้า",
    qc: "ตรวจคุณภาพ",
    procurement: "จัดซื้อ",
    audit: "Log การใช้งาน",
    users: "จัดการผู้ใช้",
  };
  const allPages = ["dashboard","sales","customer-po","customers","production","molds","qc","inventory","procurement","shipping","accounting","hr","reports","docs","audit","users","settings"];
  const roles = window.ROLES;

  return (
    <>
      <PageHeader title="ตั้งค่าระบบ" subtitle="ข้อมูลบริษัท · สิทธิ์การใช้งาน · ผู้ใช้"/>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div>
            <div className="card-title">สิทธิ์การเข้าถึงแต่ละ Module (Permission Matrix)</div>
            <div className="card-sub">✅ = เข้าดูได้และแก้ไขได้ · 👁️ = ดูได้อย่างเดียว · — = ไม่มีสิทธิ์</div>
          </div>
        </div>
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>Module</th>
                {Object.entries(roles).map(([key, r]) => (
                  <th key={key} style={{ textAlign: "center", minWidth: 120 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <span style={{ width: 18, height: 18, borderRadius: 99, background: `linear-gradient(135deg, ${r.color}, ${r.color}cc)`, display: "inline-block" }}/>
                      <span style={{ textTransform: "none", letterSpacing: 0, fontSize: 12, fontWeight: 600 }}>{r.label}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allPages.map((p) => (
                <tr key={p}>
                  <td style={{ fontWeight: 500 }}>{pageLabels[p]}</td>
                  {Object.entries(roles).map(([key, r]) => {
                    const view = r.pages === "*" || r.pages.includes(p);
                    const edit = r.canEdit === "*" || (Array.isArray(r.canEdit) && r.canEdit.includes(p));
                    return (
                      <td key={key} style={{ textAlign: "center" }}>
                        {edit ? <span style={{ color: "var(--success)", fontWeight: 600 }}>✓ จัดการ</span> :
                         view ? <span style={{ color: "var(--accent)", fontSize: 12 }}>👁 ดู</span> :
                         <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><div className="card-title">ข้อมูลบริษัท</div></div>
          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[["nameTh", "ชื่อบริษัท"], ["name", "Name (EN)"], ["taxId", "เลขผู้เสียภาษี (13 หลัก)"], ["address", "ที่อยู่"], ["phone", "โทรศัพท์"], ["email", "อีเมล"]].map(([k, l]) => (
              <div key={k}><label className="field-label">{l}</label><input className="input" disabled={!isAdmin} value={co[k] || ""} onChange={(e) => setCo({ ...co, [k]: e.target.value })}/></div>
            ))}
            {isAdmin && <div style={{ display: "flex", justifyContent: "flex-end" }}><button className="btn btn-primary btn-sm" onClick={() => runAction(() => Store.saveCompany(co), "บันทึกข้อมูลบริษัทแล้ว — ใช้กับเอกสารที่พิมพ์ต่อจากนี้")}>บันทึกข้อมูลบริษัท</button></div>}
            <div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>ข้อมูลนี้แสดงบนหัวเอกสารขายทุกใบ</div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title">รายละเอียดสิทธิ์</div></div>
          <div style={{ padding: "4px 0" }}>
            {Object.entries(roles).map(([key, r]) => (
              <div key={key} style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 99, background: `linear-gradient(135deg, ${r.color}, ${r.color}cc)`, color: "white", display: "grid", placeItems: "center", fontWeight: 600, fontSize: 12, flexShrink: 0 }}>
                  {r.user.initial}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.label}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>ผู้ใช้: {users.filter((u) => u.role === key).map((u) => u.fullName + (u.status !== "active" ? " (ระงับ)" : "")).join(", ") || "—"}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>อนุมัติเอกสาร: {r.approve === "*" ? "ทุกประเภท" : (r.approve || []).map((t) => window.DOC_LABEL[t].th).join(", ") || "—"}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{r.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

window.PageDocs = PageDocs;
window.PageSettings = PageSettings;
