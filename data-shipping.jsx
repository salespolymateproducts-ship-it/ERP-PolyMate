/* Shipping / Delivery data */

const VEHICLES = [
  { id: "V-001", plate: "70-1234 นครปฐม", type: "รถ 6 ล้อ", driver: "คุณวิชัย ขันแก้ว", phone: "081-345-6789" },
  { id: "V-002", plate: "82-5678 นครปฐม", type: "รถ 4 ล้อ", driver: "คุณสมพร ใจกล้า", phone: "082-678-9012" },
  { id: "V-003", plate: "55-9012 กรุงเทพ", type: "รถกระบะ", driver: "คุณบุญมา ดีงาม", phone: "087-234-5678" },
  { id: "V-EXT", plate: "TPX Logistics", type: "ขนส่งภายนอก", driver: "—", phone: "02-555-3344" },
];

// SHIPMENT = order to ship N units, may have multiple DELIVERY trips
const SHIPMENTS = [];  // ข้อมูลจริงมาจาก Store

// Compute status per shipment
function getShipmentStatus(s, today = "2026-05-26") {
  const t = new Date(today);
  const due = new Date(s.dueDate);
  if (s.shippedQty >= s.orderQty) {
    const lastDate = s.deliveries.length ? new Date(s.deliveries[s.deliveries.length - 1].date) : t;
    return lastDate > due ? "completed-late" : "completed";
  }
  // in progress
  const hasInTransit = s.deliveries.some((d) => d.status === "in-transit");
  if (t > due) return "delayed";
  if (hasInTransit) return "in-transit";
  if (s.shippedQty > 0) return "partial";
  return "pending";
}

const SHIPMENT_STATUS = {
  pending:        { th: "รอจัดส่ง",        color: "neutral", tone: "var(--text-secondary)" },
  scheduled:      { th: "นัดหมายแล้ว",    color: "info",    tone: "var(--accent)" },
  partial:        { th: "ส่งบางส่วน",     color: "warning", tone: "var(--amber)" },
  "in-transit":   { th: "กำลังจัดส่ง",     color: "info",    tone: "var(--accent)" },
  delivered:      { th: "ส่งสำเร็จ",       color: "success", tone: "var(--success)" },
  completed:      { th: "เสร็จสิ้น (ตรงเวลา)", color: "success", tone: "var(--success)" },
  "completed-late": { th: "เสร็จสิ้น (ล่าช้า)", color: "violet",  tone: "var(--violet)" },
  delayed:        { th: "ล่าช้า",          color: "danger",  tone: "var(--danger)" },
};

Object.assign(window, { VEHICLES, SHIPMENTS, SHIPMENT_STATUS, getShipmentStatus });
