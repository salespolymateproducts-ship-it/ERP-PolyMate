/* Sample data — PolyMate Products Co., Ltd. (โรงงานพลาสติก) */

// helpers
const _fmt = (n, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const baht = (n, d = 0) => "฿" + _fmt(n, d);

// Withholding tax (ภาษีหัก ณ ที่จ่าย) reference + helper
const WHT_RATES = {
  0: "ไม่หัก (ขายสินค้า)",
  1: "ค่าขนส่ง 1%",
  2: "ค่าโฆษณา 2%",
  3: "รับจ้างทำของ/บริการ 3%",
  5: "ค่าเช่า 5%",
};
// returns withholding amount on a pre-VAT base
const whtAmount = (base, rate) => Math.round((base * (rate || 0) / 100) * 100) / 100;

const COMPANY = {
  name: "PolyMate Products Co., Ltd.",
  nameTh: "บริษัท โพลีเมท โปรดักส์ จำกัด",
  taxId: "0105563024871",
  address: "789/12 หมู่ 4 ถ.พุทธมณฑลสาย 5 ต.ไร่ขิง อ.สามพราน จ.นครปฐม 73210",
  phone: "02-431-9988",
  email: "sales@polymate.co.th",
};

const CUSTOMERS = [
  { id: "CUS-001", code: "AUTOPLAS", name: "บริษัท ออโต้พลาส เอเชีย จำกัด", nameEn: "AutoPlas Asia Co., Ltd.", taxId: "0105549112233", contact: "คุณวิภาดา สุขใจ", phone: "02-987-1100", email: "purchasing@autoplas.com", credit: 30, address: "55/9 นิคมอุตสาหกรรมอมตะนคร ชลบุรี", status: "active", segment: "Automotive" },
  { id: "CUS-002", code: "SIAMHOUSE", name: "บริษัท สยามเฮ้าส์โฮลด์ จำกัด (มหาชน)", nameEn: "SiamHousehold PCL.", taxId: "0107536000123", contact: "คุณธีรพงศ์ มากมี", phone: "02-555-8800", email: "tee.m@siamhouse.co.th", credit: 45, address: "199 ถ.รัชดาภิเษก กรุงเทพ 10310", status: "active", segment: "Consumer Goods" },
  { id: "CUS-003", code: "KMEDICAL", name: "K-Medical Devices Co., Ltd.", nameEn: "K-Medical Devices Co., Ltd.", taxId: "0105561008812", contact: "Mr. Hiroshi Tanaka", phone: "02-664-2211", email: "h.tanaka@kmedical.co.jp", credit: 60, address: "Bangkok Free Zone, Samut Prakan", status: "active", segment: "Medical" },
  { id: "CUS-004", code: "GREENPACK", name: "บริษัท กรีนแพ็ค โซลูชั่น จำกัด", nameEn: "GreenPack Solutions Co., Ltd.", taxId: "0105562998877", contact: "คุณณัฐริกา ใจดี", phone: "081-234-5678", email: "natthri@greenpack.co.th", credit: 30, address: "12/4 ถ.บางนา-ตราด กม.16 สมุทรปราการ", status: "active", segment: "Packaging" },
  { id: "CUS-005", code: "TECHGRIP", name: "TechGrip Industries Pte Ltd", nameEn: "TechGrip Industries Pte Ltd", taxId: "—", contact: "Ms. Sarah Lim", phone: "+65 6789 2233", email: "sarah@techgrip.sg", credit: 90, address: "Tuas Industrial Park, Singapore", status: "active", segment: "Electronics" },
  { id: "CUS-006", code: "NPELECT", name: "บริษัท เอ็น.พี. อีเล็คทริค พาร์ทส์ จำกัด", nameEn: "N.P. Electric Parts Co., Ltd.", taxId: "0105557776655", contact: "คุณสมชาย ตั้งใจ", phone: "038-441-220", email: "somchai@npelect.com", credit: 30, address: "234 นิคมอุตสาหกรรมแหลมฉบัง ชลบุรี", status: "active", segment: "Electronics" },
  { id: "CUS-007", code: "PRIMAFOOD", name: "บริษัท พรีม่าฟู้ด แพ็คเกจจิ้ง จำกัด", nameEn: "Prima Food Packaging Co., Ltd.", taxId: "0105560443322", contact: "คุณอรอนงค์ เลิศกุล", phone: "02-712-8800", email: "ornanong@primafood.co.th", credit: 30, address: "88/3 ถ.บางนา กรุงเทพ", status: "watch", segment: "Food & Beverage" },
];

const MATERIALS = [
  { id: "RM-PP-001", code: "PP-H1300", name: "PP Homopolymer (HMC H1300)", type: "เม็ดพลาสติก", unit: "KG", stock: 4820, min: 1500, max: 8000, cost: 48.5, location: "A-01-02", supplier: "HMC Polymers" },
  { id: "RM-PP-002", code: "PP-RJ581", name: "PP Random Copolymer RJ581", type: "เม็ดพลาสติก", unit: "KG", stock: 1240, min: 1000, max: 5000, cost: 52.0, location: "A-01-04", supplier: "IRPC" },
  { id: "RM-ABS-001", code: "ABS-757", name: "ABS Toyolac 757", type: "เม็ดพลาสติก", unit: "KG", stock: 980, min: 800, max: 4000, cost: 76.0, location: "A-02-01", supplier: "Toray (TH)" },
  { id: "RM-PE-001", code: "HDPE-9550F", name: "HDPE 9550F (สีธรรมชาติ)", type: "เม็ดพลาสติก", unit: "KG", stock: 2400, min: 2000, max: 6000, cost: 42.0, location: "A-03-02", supplier: "SCG Chemicals" },
  { id: "RM-PC-001", code: "PC-1414", name: "Polycarbonate 1414", type: "เม็ดพลาสติก", unit: "KG", stock: 320, min: 500, max: 2000, cost: 138.0, location: "A-04-01", supplier: "Covestro" },
  { id: "CL-RD-001", code: "MB-RED-485", name: "Masterbatch แดง Pantone 485 (เม็ด)", type: "สี-เม็ด", unit: "KG", stock: 64, min: 30, max: 200, cost: 168.0, location: "C-01", supplier: "Plus Color" },
  { id: "CL-BL-001", code: "MB-BLUE-2925", name: "Masterbatch น้ำเงิน 2925 (เม็ด)", type: "สี-เม็ด", unit: "KG", stock: 48, min: 30, max: 200, cost: 172.0, location: "C-02", supplier: "Plus Color" },
  { id: "CL-WT-001", code: "PW-WHITE-TI", name: "ผงสีขาว TiO2 (ผง)", type: "สี-ผง", unit: "KG", stock: 22, min: 15, max: 80, cost: 240.0, location: "C-05", supplier: "Cosmoplast" },
  { id: "CL-BK-001", code: "MB-BLACK-K1", name: "Masterbatch ดำ K1 Carbon (เม็ด)", type: "สี-เม็ด", unit: "KG", stock: 110, min: 40, max: 200, cost: 95.0, location: "C-03", supplier: "Cabot" },
  { id: "ST-S55-001", code: "S55C-PLATE", name: "เหล็ก S55C แผ่น 300×400", type: "เหล็ก", unit: "PCS", stock: 14, min: 6, max: 30, cost: 4800, location: "S-01", supplier: "Daido Steel" },
  { id: "PK-001", code: "BOX-CT-30L", name: "กล่องลูกฟูก 30L", type: "บรรจุภัณฑ์", unit: "PCS", stock: 1240, min: 400, max: 3000, cost: 14.5, location: "P-01", supplier: "SCG Packaging" },
];

// ประเภทงานของสินค้าสำเร็จรูป
const JOB_TYPES = {
  oem: { label: "OEM (ผลิตตามแบบลูกค้า)", short: "OEM", tone: "info" },
  own: { label: "สินค้าสำเร็จรูปผลิตเอง", short: "ผลิตเอง", tone: "violet" },
  trade: { label: "ซื้อมาขายไป", short: "ซื้อมาขาย", tone: "warning" },
};

const FINISHED = [
  { id: "FG-001", code: "AP-DASH-22A", name: "Dashboard Trim 22A", customer: "AUTOPLAS", jobType: "oem", color: "ดำ (Black)", weight: 86, unit: "PCS", stock: 3420, cost: 22.4, price: 38.0 },
  { id: "FG-002", code: "SH-BCAP-500", name: "ฝา Bottle Cap 500ml", customer: "SIAMHOUSE", jobType: "oem", color: "แดง Pantone 485", weight: 4.2, unit: "PCS", stock: 18800, cost: 1.2, price: 2.6 },
  { id: "FG-003", code: "KM-SYR-10ML", name: "Syringe Body 10ml", customer: "KMEDICAL", jobType: "oem", color: "ใส (Clear PC)", weight: 6.0, unit: "PCS", stock: 6200, cost: 4.8, price: 9.4 },
  { id: "FG-004", code: "GP-LID-RND", name: "ฝาภาชนะกลม Eco (PE)", customer: "GREENPACK", jobType: "own", color: "เขียวธรรมชาติ", weight: 11.5, unit: "PCS", stock: 0, cost: 1.6, price: 3.2 },
  { id: "FG-005", code: "TG-GRIP-08", name: "Handle Grip 08", customer: "TECHGRIP", jobType: "oem", color: "น้ำเงิน 2925", weight: 24.0, unit: "PCS", stock: 12400, cost: 7.2, price: 14.5 },
  { id: "FG-006", code: "PM-HOOK-3M", name: "ตะขอติดผนัง 3M (แพ็ค 4)", customer: "—", jobType: "own", color: "ขาว", weight: 38.0, unit: "PCS", stock: 2600, cost: 6.5, price: 19.0 },
  { id: "FG-007", code: "TR-GLOVE-NBR", name: "ถุงมือไนไตรล์ (กล่อง 100)", customer: "PRIMAFOOD", jobType: "trade", min: 100, leadDays: 7, color: "ฟ้า", weight: 520.0, unit: "BOX", stock: 480, cost: 95.0, price: 145.0 },
];

const MOLDS = [
  { id: "MLD-001", code: "M-AP-DASH-22A", name: "แม่พิมพ์ Dashboard Trim 22A", customer: "AUTOPLAS", cavities: 2, size: "650×420×380 mm", weight: 980, machineMin: 250, machineMax: 350, shots: 184320, life: 500000, lastMaint: "2026-02-12", status: "available", location: "M-A-12" },
  { id: "MLD-002", code: "M-SH-CAP-500", name: "แม่พิมพ์ฝา Bottle Cap 500ml", customer: "SIAMHOUSE", cavities: 16, size: "480×380×320 mm", weight: 520, machineMin: 150, machineMax: 220, shots: 642100, life: 1000000, lastMaint: "2026-04-02", status: "in-use", location: "เครื่อง #4" },
  { id: "MLD-003", code: "M-KM-SYR-10", name: "แม่พิมพ์ Syringe Body 10ml", customer: "KMEDICAL", cavities: 8, size: "520×400×340 mm", weight: 680, machineMin: 180, machineMax: 250, shots: 92450, life: 1200000, lastMaint: "2026-01-22", status: "maintenance", location: "ห้องซ่อม" },
  { id: "MLD-004", code: "M-GP-LID-RND", name: "แม่พิมพ์ฝาภาชนะกลม Eco", customer: "GREENPACK", cavities: 4, size: "440×360×300 mm", weight: 410, machineMin: 120, machineMax: 200, shots: 38120, life: 800000, lastMaint: "2026-03-18", status: "available", location: "M-B-04" },
  { id: "MLD-005", code: "M-TG-GRIP-08", name: "แม่พิมพ์ Handle Grip 08", customer: "TECHGRIP", cavities: 4, size: "500×400×350 mm", weight: 580, machineMin: 180, machineMax: 280, shots: 246000, life: 700000, lastMaint: "2026-04-28", status: "in-use", location: "เครื่อง #2" },
  { id: "MLD-006", code: "M-NP-CASE", name: "แม่พิมพ์ Connector Case (NP)", customer: "NPELECT", cavities: 8, size: "460×360×300 mm", weight: 480, machineMin: 150, machineMax: 220, shots: 410200, life: 900000, lastMaint: "2025-11-14", status: "alert", location: "M-A-07" },
];

// Sales documents
const DOCS = [];  // ข้อมูลจริงมาจาก Store

// ลำดับ key = ลำดับขั้นตอนเอกสาร (ใช้แสดงแท็บ)
const DOC_LABEL = {
  CPO: { th: "PO ลูกค้า", short: "Customer PO", color: "neutral" },
  QT: { th: "ใบเสนอราคา", short: "Quotation", color: "info" },
  SO: { th: "ใบสั่งขาย", short: "Sales Order", color: "info" },
  DO: { th: "ใบส่งสินค้า", short: "Delivery Note", color: "neutral" },
  INV: { th: "ใบกำกับภาษี", short: "Tax Invoice", color: "violet" },
  BN: { th: "ใบวางบิล", short: "Billing Note", color: "warning" },
  RC: { th: "ใบเสร็จรับเงิน", short: "Receipt", color: "success" },
  PAY: { th: "รับชำระเงิน", short: "Payment", color: "success" },
};

// สถานะกลาง (ป้ายเฉพาะประเภทเอกสารดู Workflow.statusLabel)
const DOC_STATUS = {
  draft: { th: "ฉบับร่าง", color: "neutral" },
  pending: { th: "รออนุมัติ", color: "warning" },
  approved: { th: "อนุมัติแล้ว", color: "success" },
  partial: { th: "ดำเนินการบางส่วน", color: "info" },
  completed: { th: "เสร็จสมบูรณ์", color: "success" },
  cancelled: { th: "ยกเลิก", color: "danger" },
};

// Production orders
// เครื่องฉีด — ตัวเลขขนาด (ระยะห่างเสา / ช่วงความหนาแม่พิมพ์) เป็นข้อมูลตัวอย่าง ให้แก้ตามสเปกเครื่องจริงที่หน้า สถานะเครื่องจักร
// condition = สภาพเครื่อง (ready / due / maintenance / retired) ส่วน status (idle / running) ระบบผลิตเป็นผู้ตั้ง
const MACHINES = [
  { id: "INJ-01", name: "เครื่อง #1 — JSW J280", tonnage: 280, tieBarW: 680, tieBarL: 680, thkMin: 200, thkMax: 600, pmIntervalDays: 90, lastMaint: "2026-10-05", location: "โรงงาน 1", note: "ข้อมูลตัวอย่าง — แก้ตามสเปกเครื่องจริง", condition: "ready", status: "idle" },
  { id: "INJ-02", name: "เครื่อง #2 — Haitian MA2500", tonnage: 250, tieBarW: 580, tieBarL: 580, thkMin: 180, thkMax: 550, pmIntervalDays: 90, lastMaint: "2026-08-20", location: "โรงงาน 1", note: "ข้อมูลตัวอย่าง — แก้ตามสเปกเครื่องจริง", condition: "ready", status: "idle" },
  { id: "INJ-03", name: "เครื่อง #3 — Toshiba EC180", tonnage: 180, tieBarW: 510, tieBarL: 510, thkMin: 150, thkMax: 500, pmIntervalDays: 90, lastMaint: "2026-07-15", location: "โรงงาน 1", note: "ข้อมูลตัวอย่าง — แก้ตามสเปกเครื่องจริง", condition: "ready", status: "idle" },
  { id: "INJ-04", name: "เครื่อง #4 — JSW J180", tonnage: 180, tieBarW: 510, tieBarL: 510, thkMin: 150, thkMax: 500, pmIntervalDays: 90, lastMaint: "2026-10-20", location: "โรงงาน 1", note: "ข้อมูลตัวอย่าง — แก้ตามสเปกเครื่องจริง", condition: "ready", status: "idle" },
  { id: "INJ-05", name: "เครื่อง #5 — Sumitomo SE350", tonnage: 350, tieBarW: 730, tieBarL: 730, thkMin: 250, thkMax: 700, pmIntervalDays: 90, lastMaint: "2026-09-10", location: "โรงงาน 1", note: "ข้อมูลตัวอย่าง — แก้ตามสเปกเครื่องจริง", condition: "ready", status: "idle" },
  { id: "INJ-06", name: "เครื่อง #6 — Haitian VE160", tonnage: 160, tieBarW: 450, tieBarL: 450, thkMin: 130, thkMax: 420, pmIntervalDays: 90, lastMaint: "2026-11-10", location: "โรงงาน 1", note: "ข้อมูลตัวอย่าง — แก้ตามสเปกเครื่องจริง", condition: "maintenance", conditionReason: "ตัวอย่าง: ซ่อม Hot Runner", status: "idle" },
];

// ขนาดแม่พิมพ์แบบตัวเลข (กว้าง × ยาว × หนา มม.) แปลงจากข้อความขนาดเดิม — ใช้เตือนเมื่อเลือกคู่เครื่องกับแม่พิมพ์ที่ไม่เข้ากัน
MOLDS.forEach((m) => {
  const x = /(\d+)\s*[×x*]\s*(\d+)\s*[×x*]\s*(\d+)/.exec(m.size || "");
  if (x && m.moldW == null) { m.moldW = +x[1]; m.moldL = +x[2]; m.moldT = +x[3]; }
});

const WORK_ORDERS = [];  // ข้อมูลจริงมาจาก Store

const DELIVERY_STATUS = {
  scheduled:   { th: "รอส่ง",        color: "neutral", tone: "var(--text-secondary)" },
  "in-transit":{ th: "กำลังจัดส่ง",   color: "info",    tone: "var(--accent)" },
  partial:     { th: "ส่งบางส่วน",   color: "warning", tone: "var(--amber)" },
  delivered:   { th: "ส่งแล้ว",      color: "success", tone: "var(--success)" },
  late:        { th: "เลยกำหนด",     color: "danger",  tone: "var(--danger)" },
};

const WO_STATUS = {
  queued: { th: "รอผลิต", color: "neutral" },
  setup: { th: "ตั้งเครื่อง", color: "warning" },
  running: { th: "กำลังผลิต", color: "info" },
  done: { th: "เสร็จแล้ว", color: "success" },
  hold: { th: "พักงาน", color: "danger" },
  cancelled: { th: "ยกเลิก", color: "danger" },
};

// Expenses
const EXPENSES = [];  // ข้อมูลจริงมาจาก Store

// หมวดค่าใช้จ่ายสำหรับโรงงานฉีดพลาสติก แบ่งกลุ่มไว้แสดงใน dropdown
// ระวัง: ชื่อหมวดเดิม (วัตถุดิบ / สีผสม / สินค้าซื้อมาขาย / ค่าบริการ/จ้างทำของ / ค่าแม่พิมพ์) ถูกใช้ในที่อื่นด้วย (รับของตาม PO, รายงาน P&L) — อย่าเปลี่ยนชื่อ
// การจัดหมวดเพื่อยื่นภาษีจริง/ผังบัญชี ให้ผู้ทำบัญชียืนยัน
const EXPENSE_CATEGORY_GROUPS = [
  { group: "ต้นทุนผลิต", items: ["วัตถุดิบ", "สีผสม", "ค่าแพ็คสินค้า", "สินค้าซื้อมาขาย", "จ้างผลิต/ผลิตภายนอก", "ค่าแม่พิมพ์", "ซ่อมบำรุงแม่พิมพ์", "ค่าซ่อมเครื่องจักร", "วัสดุสิ้นเปลือง/ของใช้โรงงาน"] },
  { group: "ค่าแรงและสาธารณูปโภค", items: ["ค่าแรง", "ค่าล่วงเวลา/แรงงานชั่วคราว", "ประกันสังคม/สวัสดิการ", "ค่าไฟ", "ค่าน้ำ/น้ำหล่อเย็น"] },
  { group: "ขนส่งและนำเข้า", items: ["ค่าขนส่ง", "ค่านำเข้า/ศุลกากร"] },
  { group: "สำนักงานและทั่วไป", items: ["ค่าเช่า", "ค่าบริการ/จ้างทำของ", "ค่าที่ปรึกษา/ค่าบัญชี/ค่าตรวจสอบ", "ค่าเช่าเซิร์ฟเวอร์/ซอฟต์แวร์ต่างประเทศ", "ค่าสื่อสาร/อินเทอร์เน็ต", "ค่าประกันภัย", "ค่าธรรมเนียมธนาคาร/ดอกเบี้ย", "ค่าตรวจสอบมาตรฐาน/ใบรับรอง", "ค่าใช้จ่ายทั่วไป"] },
];
const EXPENSE_CATEGORIES = EXPENSE_CATEGORY_GROUPS.flatMap((g) => g.items);

const EMPLOYEES = [
  { id: "EMP-001", name: "สมชาย ใจดี", role: "หัวหน้าฝ่ายผลิต", dept: "Production", phone: "081-234-5678", joined: "2018-03-12", salary: 38000 },
  { id: "EMP-002", name: "วิภาดา สุขใจ", role: "ฝ่ายขาย", dept: "Sales", phone: "082-555-1234", joined: "2020-06-01", salary: 28000 },
  { id: "EMP-003", name: "ธีรพงศ์ มากมี", role: "ช่างเทคนิคอาวุโส", dept: "Maintenance", phone: "086-771-2233", joined: "2015-09-08", salary: 32000 },
  { id: "EMP-004", name: "อรอนงค์ เลิศกุล", role: "บัญชี", dept: "Accounting", phone: "083-998-1122", joined: "2019-04-15", salary: 30000 },
  { id: "EMP-005", name: "ณัฐริกา ใจดี", role: "QC Officer", dept: "Quality", phone: "089-456-7788", joined: "2021-02-01", salary: 24000 },
  { id: "EMP-006", name: "สมศักดิ์ แข็งแรง", role: "Operator", dept: "Production", phone: "087-321-4455", joined: "2022-08-10", salary: 18000 },
  { id: "EMP-007", name: "ปิยะ สุวรรณ", role: "Warehouse Staff", dept: "Warehouse", phone: "081-987-6543", joined: "2020-11-23", salary: 17500 },
];

// Sales trend (last 12 months in M-baht)
const SALES_TREND = [];  // ข้อมูลจริงมาจาก Store

const TOP_CUSTOMERS = [];  // ข้อมูลจริงมาจาก Store

// Notifications
const NOTIFICATIONS = [];  // ข้อมูลจริงมาจาก Store

// ----- Roles & Permissions -----
// Pages a role can access. "*" = all
const ROLES = {
  admin: {
    label: "Admin / เจ้าของ",
    shortLabel: "Admin",
    color: "#7C3AED",
    description: "ดูและจัดการทุกอย่าง",
    user: { name: "สมชาย ใจดี", initial: "สม", title: "เจ้าของ / ผู้ดูแลระบบ" },
    pages: "*",
    canEdit: "*",
    approve: "*", editApproved: true,
  },
  sales: {
    label: "ฝ่ายขาย",
    shortLabel: "Sales",
    color: "#2D6CDF",
    description: "ส่งใบ PO + กำหนดวันส่ง + ติดตามขนส่ง",
    user: { name: "วิภาดา สุขใจ", initial: "วิ", title: "ฝ่ายขาย" },
    pages: ["dashboard", "sales", "customer-po", "customers", "shipping"],
    canEdit: ["sales", "customer-po", "customers", "shipping"],
    approve: ["CPO", "QT", "SO", "DO"],
  },
  production: {
    label: "ฝ่ายผลิต",
    shortLabel: "Production",
    color: "#0F9F8F",
    description: "ใบสั่งผลิต · แม่พิมพ์ · QC · คงคลัง",
    user: { name: "ธีรพงศ์ มากมี", initial: "ธี", title: "หัวหน้าฝ่ายผลิต" },
    pages: ["dashboard", "production", "molds", "qc", "inventory"],
    canEdit: ["production", "molds", "qc"],
    approve: [],
  },
  procurement: {
    label: "ฝ่ายจัดซื้อ",
    shortLabel: "Procurement",
    color: "#D97706",
    description: "PO · Supplier · รับเข้าวัตถุดิบ",
    user: { name: "ปิยะ สุวรรณ", initial: "ปิ", title: "ฝ่ายจัดซื้อ" },
    pages: ["dashboard", "procurement", "inventory"],
    canEdit: ["procurement", "inventory"],
    approve: [],
  },
  accounting: {
    label: "ฝ่ายบัญชี",
    shortLabel: "Accounting",
    color: "#0EA5C7",
    description: "บิลต่างๆ · ภาษี · คงคลัง · ขนส่ง · ข้อมูลซื้อขาย",
    user: { name: "อรอนงค์ เลิศกุล", initial: "อร", title: "บัญชี" },
    pages: ["dashboard", "sales", "customer-po", "customers", "inventory", "shipping", "accounting", "finance", "fin-approvals", "fin-rc-wait", "fin-receipts", "fin-payments", "fin-wht", "fin-other", "fin-ledger"],
    canEdit: ["sales", "accounting"],
    approve: ["BN", "INV", "RC", "PAY"],
  },
};

Object.assign(window, {
  COMPANY, CUSTOMERS, MATERIALS, FINISHED, JOB_TYPES, MOLDS, DOCS, DOC_LABEL, DOC_STATUS,
  MACHINES, WORK_ORDERS, WO_STATUS, DELIVERY_STATUS,
  EXPENSES, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_GROUPS, EMPLOYEES,
  SALES_TREND, TOP_CUSTOMERS, NOTIFICATIONS,
  ROLES,
  baht, _fmt,
  WHT_RATES, whtAmount,
});
