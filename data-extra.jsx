/* Procurement / Suppliers / PO data */

const SUPPLIERS = [
  { id: "SUP-001", code: "HMC", name: "HMC Polymers Co., Ltd.", taxId: "0107546000111", contact: "คุณกัญญา สุขสวัสดิ์", phone: "02-636-6000", email: "sales@hmcpolymers.com", category: "เม็ดพลาสติก", credit: 30, address: "999/9 มาบตาพุด ระยอง", rating: 4.6, status: "active" },
  { id: "SUP-002", code: "IRPC", name: "IRPC Public Co., Ltd.", taxId: "0107536001000", contact: "คุณวิชัย พรพิศุทธ์", phone: "02-649-7000", email: "purchase@irpc.co.th", category: "เม็ดพลาสติก", credit: 30, address: "299/1 ถ.พระราม 6 กรุงเทพ", rating: 4.4, status: "active" },
  { id: "SUP-003", code: "TORAY-TH", name: "Toray (Thailand) Co., Ltd.", taxId: "0105532001234", contact: "Mr. Yamada Kenji", phone: "038-685-200", email: "k.yamada@toray.co.th", category: "เม็ดพลาสติก", credit: 45, address: "Amata City Industrial Estate, Rayong", rating: 4.8, status: "active" },
  { id: "SUP-004", code: "PLUSCOLOR", name: "บริษัท พลัสคัลเลอร์ จำกัด", taxId: "0105550002211", contact: "คุณวรรณา จันทร์เพ็ญ", phone: "02-748-1100", email: "info@pluscolor.co.th", category: "สีผสม", credit: 30, address: "44/12 ถ.กิ่งแก้ว สมุทรปราการ", rating: 4.5, status: "active" },
  { id: "SUP-005", code: "COSMOMOLD", name: "Cosmoplast Mold Co., Ltd.", taxId: "0105538009922", contact: "คุณสุริยา เทพประดิษฐ์", phone: "02-925-3344", email: "sales@cosmoplast-mold.com", category: "แม่พิมพ์ / ซ่อม", credit: 60, address: "88 ถ.รามอินทรา กรุงเทพ", rating: 4.7, status: "active" },
  { id: "SUP-006", code: "SCGP", name: "SCG Packaging PCL.", taxId: "0107558000123", contact: "คุณนาตยา ขจรเดช", phone: "02-586-2222", email: "scgp@scg.com", category: "บรรจุภัณฑ์", credit: 30, address: "1 SCG Bangsue, กรุงเทพ", rating: 4.6, status: "active" },
  { id: "SUP-007", code: "JSWSVC", name: "JSW Service Thailand", taxId: "0105549002345", contact: "Mr. Tanaka Shinji", phone: "02-664-8800", email: "service@jsw.co.th", category: "บริการเครื่องจักร", credit: 45, address: "Bangna-Trad Rd. กรุงเทพ", rating: 4.4, status: "active" },
  { id: "SUP-008", code: "DAIDO", name: "Daido Steel (Thailand)", taxId: "0105546088123", contact: "คุณบุญรอด เพชรชัย", phone: "038-454-100", email: "sales@daido-steel.co.th", category: "เหล็ก", credit: 30, address: "นิคมแหลมฉบัง ชลบุรี", rating: 4.5, status: "active" },
];

const PURCHASE_ORDERS = [];  // ข้อมูลจริงมาจาก Store

const PO_STATUS = {
  draft:     { th: "ร่าง",         color: "neutral" },
  pending:   { th: "รออนุมัติ",     color: "warning" },
  approved:  { th: "อนุมัติแล้ว",   color: "info" },
  received:  { th: "รับเข้าแล้ว",   color: "success" },
  cancelled: { th: "ยกเลิก",        color: "danger" },
};

// Customer POs (uploaded by sales)
const CUSTOMER_POS = [];  // ข้อมูลจริงมาจาก Store

const CPO_STATUS = {
  pending:   { th: "รอเชื่อมโยง",  color: "warning" },
  linked:    { th: "เชื่อมแล้ว",    color: "info" },
  completed: { th: "เสร็จสิ้น",     color: "success" },
};

// QC inspections
const QC_INSPECTIONS = [];  // ข้อมูลจริงมาจาก Store

const QC_RESULT = {
  pass:   { th: "ผ่าน",        color: "success" },
  rework: { th: "ต้องแก้ไข",   color: "warning" },
  fail:   { th: "ไม่ผ่าน",      color: "danger" },
};

const DEFECT_TYPES = [
  { name: "Flash", desc: "เนื้อพลาสติกเกินที่ขอบงาน" },
  { name: "Short Shot", desc: "งานไม่เต็มแม่พิมพ์" },
  { name: "Sink Mark", desc: "รอยยุบบนผิวงาน" },
  { name: "Warpage", desc: "งานบิดเบี้ยว" },
  { name: "Burn Mark", desc: "รอยไหม้สีดำ" },
  { name: "Color Streak", desc: "สีไม่สม่ำเสมอ" },
  { name: "Weld Line", desc: "เส้นรอยต่อชัดเจน" },
  { name: "Splay Mark", desc: "ลายเงิน/น้ำตาลบนผิว" },
];

// BOM - Bill of Materials for each FG product
const BOMS = {
  "FG-001": { product: "Dashboard Trim 22A", productCode: "AP-DASH-22A", mold: "MLD-001", lines: [
    { item: "RM-ABS-001", name: "ABS Toyolac 757", qty: 0.038, unit: "KG/PCS", cost: 76 },
    { item: "CL-BK-001", name: "Masterbatch ดำ K1 Carbon", qty: 0.0011, unit: "KG/PCS", cost: 95 },
  ], wasteRate: 1.5, packaging: "BOX-CT-30L (60 ชิ้น/กล่อง)" },
  "FG-002": { product: "Bottle Cap 500ml", productCode: "SH-BCAP-500", mold: "MLD-002", lines: [
    { item: "RM-PP-001", name: "PP H1300", qty: 0.0028, unit: "KG/PCS", cost: 48.5 },
    { item: "CL-RD-001", name: "Masterbatch แดง 485", qty: 0.00008, unit: "KG/PCS", cost: 168 },
  ], wasteRate: 0.5, packaging: "ถุง PE 1000 ชิ้น" },
  "FG-003": { product: "Syringe Body 10ml", productCode: "KM-SYR-10ML", mold: "MLD-003", lines: [
    { item: "RM-PC-001", name: "Polycarbonate 1414", qty: 0.0036, unit: "KG/PCS", cost: 138 },
  ], wasteRate: 0.3, packaging: "Cleanroom Bag (Medical)" },
  "FG-005": { product: "Handle Grip 08", productCode: "TG-GRIP-08", mold: "MLD-005", lines: [
    { item: "RM-PP-002", name: "PP RJ581", qty: 0.018, unit: "KG/PCS", cost: 52 },
    { item: "CL-BL-001", name: "Masterbatch น้ำเงิน 2925", qty: 0.00054, unit: "KG/PCS", cost: 172 },
  ], wasteRate: 1.2, packaging: "BOX-CT-30L (200 ชิ้น/กล่อง)" },
};

// Audit logs
const AUDIT_LOGS = [];  // ข้อมูลจริงมาจาก Store

// Mold maintenance schedule
const MOLD_MAINTENANCE_SCHEDULE = [];  // ข้อมูลจริงมาจาก Store

// Stock movements ledger (รับเข้า / เบิก / โอน / ปรับปรุง) — live, mutated by the store
const STOCK_MOVEMENTS = [];  // ข้อมูลจริงมาจาก Store

Object.assign(window, {
  SUPPLIERS, PURCHASE_ORDERS, PO_STATUS,
  CUSTOMER_POS, CPO_STATUS,
  QC_INSPECTIONS, QC_RESULT, DEFECT_TYPES,
  BOMS, STOCK_MOVEMENTS,
  AUDIT_LOGS,
  MOLD_MAINTENANCE_SCHEDULE,
});
