/* global React, I, Store, DateInput */

/*
  ชุดเครื่องมือรายการกลาง (ใช้ซ้ำทุกหน้า): ค้นหา · กรองช่วงวันที่ · เรียงตามหัวคอลัมน์ · แบ่งหน้า
  ใช้คู่กัน:  const v = useListView(rows, opts)  +  <ListToolbar view={v}/>  +  <SortTh view={v} k="date">วันที่</SortTh>  +  <Pager view={v}/>
  opts: {
    text:        (row) => string            // ข้อความที่ค้นหาได้ (เลขที่เอกสาร ชื่อลูกค้า/ผู้ขาย เลขอ้างอิง รายการสินค้า ฯลฯ)
    sorts:       { key: (row) => value }    // คอลัมน์ที่เรียงได้
    defaultSort: { key, dir: "asc"|"desc" }
    dateKey:     (row) => "YYYY-MM-DD"      // ใช้กรองช่วงวันที่
    filter:      (row) => boolean           // ตัวกรองเฉพาะหน้า (เช่น สถานะ) — ส่ง filterKey ให้เปลี่ยนเมื่อเงื่อนไขเปลี่ยน เพื่อรีเซ็ตกลับหน้า 1
    filterKey:   string
    pageSize:    number (ค่าเริ่มต้น 50)
    dateLabel:   ชื่อวันที่ที่ใช้กรอง เช่น "กำหนดส่ง" (ค่าเริ่มต้น "วันที่")
  }
  หมายเหตุ: Store ส่งอาร์เรย์เดิมที่ถูกแก้ในที่ → คำนวณใหม่ทุกครั้งที่วาดหน้า (ไม่ memo) และจับเวลา ถ้าช้าเกิน 80 ms จะเตือนในคอนโซล
  (สัญญาณว่าถึงเวลาย้ายการค้น/แบ่งหน้าไปที่เซิร์ฟเวอร์)
*/

const LK_PAGE_SIZES = [25, 50, 100];

function lkIso(d) { const p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }

/** ช่วงวันที่สำเร็จรูป */
function lkPreset(name) {
  const t = new Date(Store.today() + "T00:00:00");
  const y = t.getFullYear(), m = t.getMonth();
  if (name === "month") return { from: lkIso(new Date(y, m, 1)), to: lkIso(new Date(y, m + 1, 0)) };
  if (name === "lastMonth") return { from: lkIso(new Date(y, m - 1, 1)), to: lkIso(new Date(y, m, 0)) };
  if (name === "year") return { from: lkIso(new Date(y, 0, 1)), to: lkIso(new Date(y, 11, 31)) };
  return { from: "", to: "" };
}

function lkCompare(a, b) {
  const an = a == null || a === "", bn = b == null || b === "";
  if (an || bn) return an && bn ? 0 : an ? 1 : -1;              // ค่าว่างไปท้ายเสมอ
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "th", { numeric: true });
}

function useListView(rows, opts) {
  const o = opts || {};
  const [q, setQ] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [sort, setSort] = React.useState(o.defaultSort || null);
  const [pageSize, setPageSize] = React.useState(o.pageSize || 50);
  const [page, setPage] = React.useState(1);

  // กลับหน้า 1 เมื่อเงื่อนไขเปลี่ยน
  const resetKey = [q, from, to, sort && sort.key, sort && sort.dir, pageSize, o.filterKey || ""].join("|");
  const lastKey = React.useRef(resetKey);
  React.useEffect(() => { if (lastKey.current !== resetKey) { lastKey.current = resetKey; setPage(1); } }, [resetKey]);

  const t0 = performance.now();
  let list = rows;
  if (o.filter) list = list.filter(o.filter);
  const needle = q.trim().toLowerCase();
  if (needle && o.text) {
    // ค้นทั้งวลีก่อน (เช่น "Customer 7" ไม่ปนกับ "Customer 17") ถ้าไม่พบจึงค้นแบบทุกคำอยู่ในแถวเดียวกัน (เช่น "Item 12 ใบกำกับ")
    const texts = list.map((r) => [String(o.text(r) || "").toLowerCase(), r]);
    const phrase = texts.filter((x) => x[0].includes(needle));
    if (phrase.length) list = phrase.map((x) => x[1]);
    else { const words = needle.split(/\s+/); list = texts.filter((x) => words.every((w) => x[0].includes(w))).map((x) => x[1]); }
  }
  if ((from || to) && o.dateKey) {
    list = list.filter((r) => { const d = String(o.dateKey(r) || "").slice(0, 10); return d && (!from || d >= from) && (!to || d <= to); });
  }
  // คำนวณค่าที่ใช้เรียงครั้งเดียวต่อแถว (บางคอลัมน์คำนวณหนัก เช่น ยอดค้างรับ) แล้วค่อยเรียง
  let sorted = list;
  if (sort && o.sorts && o.sorts[sort.key]) {
    const keyFn = o.sorts[sort.key], dir = sort.dir === "desc" ? -1 : 1;
    sorted = list.map((r) => [keyFn(r), r]).sort((a, b) => lkCompare(a[0], b[0]) * dir).map((x) => x[1]);
  }
  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pages);
  const pageRows = sorted.slice((cur - 1) * pageSize, cur * pageSize);
  const ms = performance.now() - t0;
  if (ms > 80 && !window.__lkWarned) { window.__lkWarned = true; console.warn("[list-kit] การค้น/เรียง " + rows.length + " แถวใช้ " + Math.round(ms) + " ms — พิจารณาย้ายไปทำที่เซิร์ฟเวอร์"); }

  const toggleSort = (key) => setSort((s) => (s && s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === (o.defaultSort && o.defaultSort.key) ? (o.defaultSort.dir === "asc" ? "desc" : "asc") : "asc" }));
  const reset = () => { setQ(""); setFrom(""); setTo(""); setSort(o.defaultSort || null); };
  const active = !!(needle || from || to);
  return { q, setQ, from, setFrom, to, setTo, sort, setSort, toggleSort, page: cur, setPage, pageSize, setPageSize, pages, total, all: rows.length, sorted, pageRows, reset, active, hasDate: !!o.dateKey, dateLabel: o.dateLabel || "วันที่" };
}

/** แถบค้นหา + ช่วงวันที่ — children = ตัวกรองเฉพาะหน้า (ปุ่มสถานะ ฯลฯ) */
function ListToolbar({ view: v, placeholder, children }) {
  const presetBtn = (name, label) => {
    const p = lkPreset(name), on = v.from === p.from && v.to === p.to;
    return <button key={name} className={"btn btn-sm " + (on ? "btn-primary" : "btn-outline")} onClick={() => { v.setFrom(p.from); v.setTo(p.to); }}>{label}</button>;
  };
  return (
    <div style={{ display: "flex", gap: 8, padding: "12px 16px", alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 340 }}>
        <I.Search size={14} style={{ position: "absolute", left: 10, top: 9, color: "var(--text-tertiary)" }}/>
        <input className="input" aria-label="ค้นหา" placeholder={placeholder || "ค้นหา…"} style={{ paddingLeft: 32 }} value={v.q} onChange={(e) => v.setQ(e.target.value)}/>
      </div>
      {v.hasDate && <>
        <div style={{ width: 140 }}><DateInput className="input" value={v.from} placeholder={v.dateLabel + " ตั้งแต่"} onChange={(e) => v.setFrom(e.target.value)}/></div>
        <div style={{ width: 140 }}><DateInput className="input" value={v.to} placeholder={v.dateLabel + " ถึง"} onChange={(e) => v.setTo(e.target.value)}/></div>
        {presetBtn("month", "เดือนนี้")}{presetBtn("lastMonth", "เดือนที่แล้ว")}{presetBtn("year", "ปีนี้")}
      </>}
      {children}
      {v.active && <button className="btn btn-ghost btn-sm" onClick={v.reset}>ล้างตัวกรอง</button>}
      <span className="badge badge-neutral">{v.total === v.all ? v.total + " รายการ" : v.total + " จาก " + v.all + " รายการ"}</span>
    </div>
  );
}

/** หัวคอลัมน์ที่กดเรียงได้ */
function SortTh({ view: v, k, children, className, style }) {
  const on = v.sort && v.sort.key === k;
  return (
    <th className={className} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", ...(style || {}) }} onClick={() => v.toggleSort(k)} title="กดเพื่อเรียงลำดับ" aria-sort={on ? (v.sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      {children}<span style={{ marginLeft: 4, fontSize: 10, opacity: on ? 1 : 0.3 }}>{on ? (v.sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
    </th>
  );
}

/** ตัวแบ่งหน้า */
function Pager({ view: v }) {
  if (!v.total) return null;
  const a = (v.page - 1) * v.pageSize + 1, b = Math.min(v.total, v.page * v.pageSize);
  const btn = (label, to, dis) => <button className="btn btn-outline btn-sm" disabled={dis} onClick={() => v.setPage(to)}>{label}</button>;
  return (
    <div style={{ display: "flex", gap: 8, padding: "10px 16px", alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--border)", fontSize: 12.5 }}>
      <span style={{ color: "var(--text-secondary)" }}>แสดง {a}–{b} จาก {v.total} รายการ</span>
      <span style={{ flex: 1 }}/>
      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>ต่อหน้า
        <select className="select" style={{ width: 80 }} value={v.pageSize} onChange={(e) => v.setPageSize(Number(e.target.value))}>{(LK_PAGE_SIZES.includes(v.pageSize) ? LK_PAGE_SIZES : [v.pageSize, ...LK_PAGE_SIZES].sort((a, b) => a - b)).map((n) => <option key={n} value={n}>{n}</option>)}</select>
      </label>
      {btn("«", 1, v.page <= 1)}{btn("‹", v.page - 1, v.page <= 1)}
      <span>หน้า {v.page} / {v.pages}</span>
      {btn("›", v.page + 1, v.page >= v.pages)}{btn("»", v.pages, v.page >= v.pages)}
    </div>
  );
}

Object.assign(window, { useListView, ListToolbar, SortTh, Pager, lkPreset });
