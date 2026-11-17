/* global React, COMPANY, DOCS, CUSTOMERS, SUPPLIERS, WORK_ORDERS, PURCHASE_ORDERS, EXPENSES, EMPLOYEES,
   MATERIALS, FINISHED, QC_INSPECTIONS, MOLDS, MACHINES, STOCK_MOVEMENTS, AUDIT_LOGS, BOMS */

/*
  PolyMate ERP — ชั้นข้อมูลกลาง (Data layer)
  ------------------------------------------------------------
  • ทุกโมดูลอ่าน/เขียนผ่าน Store เท่านั้น (ข้อมูลชุดเดียว)
  • Store.tx(label, fn)  = Transaction: ถ้า fn throw → คืนค่าข้อมูลทั้งหมดกลับสภาพก่อนเริ่ม (all-or-nothing)
  • ทุกการเปลี่ยนแปลงบันทึก Audit Log (ใคร / ทำอะไร / เมื่อไร / รายละเอียด)
  • ข้อมูลจริงอยู่ที่ Backend (Spring Boot + PostgreSQL) ผ่าน /api/v1
    - หลัง login โหลดข้อมูลทั้งหมด (GET /bootstrap) เข้า state ในหน่วยความจำ → หน้าจอ/Workflow อ่าน-เขียน state แบบเดิม (synchronous)
    - เมื่อ transaction สำเร็จ ระบบเทียบกับข้อมูลที่ sync ล่าสุดแล้วส่ง POST/PUT/DELETE ไป Backend อัตโนมัติ (write-behind)
    - ถ้า Backend ปฏิเสธ (สิทธิ์/ชนกัน/ออฟไลน์) จะแจ้งเตือนและโหลดข้อมูลจากเซิร์ฟเวอร์ทับ
    - ดึงข้อมูลใหม่ทุก 20 วินาทีเพื่อเห็นการเปลี่ยนแปลงของผู้ใช้อื่น
*/
const Store = (function () {
  const LS_KEY = "polymate_erp_v3"; // รุ่น localStorage เดิม (ลบทิ้งเมื่อเริ่มระบบ)
  const OLD_KEYS = ["polymate_erp_v2", "erp.expenses.v1", "erp.employees.v1", "erp.pl.v1"];
  const API = "/api/v1";
  const POLL_MS = 20000;

  const state = {
    docs: DOCS,
    customers: CUSTOMERS,
    suppliers: SUPPLIERS,
    workOrders: WORK_ORDERS,
    purchaseOrders: PURCHASE_ORDERS,
    expenses: EXPENSES,
    employees: EMPLOYEES,
    materials: MATERIALS,
    finished: FINISHED,
    qc: QC_INSPECTIONS,
    molds: MOLDS,
    machines: MACHINES,
    stockMovements: STOCK_MOVEMENTS,
    auditLogs: AUDIT_LOGS,
    users: [],
    settings: { company: null },
    counters: {}, // { "IV202611": 3, ... }
  };
  const ARRAY_KEYS = ["docs", "customers", "suppliers", "workOrders", "purchaseOrders", "expenses", "employees",
    "materials", "finished", "qc", "molds", "machines", "stockMovements", "auditLogs", "users"];

  let version = 0;
  let txDepth = 0;
  let dirty = false;
  const listeners = new Set();
  let currentUser = null; // { id, username, name, role }

  function notify() {
    if (txDepth > 0) { dirty = true; return; }
    version++; listeners.forEach((l) => l());
    scheduleFlush();
  }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function fill(arr, items) { arr.length = 0; (items || []).forEach((x) => arr.push(x)); }

  // ข้อมูลเริ่มต้น (ตัวอย่าง) ใช้ seed ให้ฐานข้อมูลว่างครั้งแรกโดย admin เท่านั้น
  const defaults = JSON.parse(JSON.stringify(state));
  // ล้างข้อมูลรุ่น localStorage เดิม (ข้อมูลจริงอยู่ที่เซิร์ฟเวอร์แล้ว)
  try { localStorage.removeItem(LS_KEY); OLD_KEYS.forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }

  // ---------- API client ----------
  let token = null;
  try { token = sessionStorage.getItem("erp_token"); } catch (e) { /* ignore */ }
  function setToken(t) {
    token = t;
    try { if (t) sessionStorage.setItem("erp_token", t); else sessionStorage.removeItem("erp_token"); } catch (e) { /* ignore */ }
  }
  async function api(method, path, body, opts) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    if (opts && opts.clientAudit) headers["X-Client-Audit"] = "1";
    let res;
    try { res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { throw new ERPError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบเครือข่าย"); }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { /* ไม่ใช่ JSON */ } }
    if (!res.ok) {
      const er = data && data.error;
      const err = new ERPError((er && er.message) || ("เกิดข้อผิดพลาด (" + res.status + ")"));
      err.status = res.status; err.code = er && er.code;
      if (res.status === 401 && err.code !== "PASSWORD_CHANGE_REQUIRED" && path !== "/auth/login" && token) sessionExpired();
      throw err;
    }
    return data;
  }
  function sessionExpired() {
    if (!token) return;
    clearSession();
    window.dispatchEvent(new Event("erp-session-expired"));
  }
  function toast(msg, type) { if (typeof window.notify === "function") window.notify(msg, type || "error"); else console.warn(msg); }

  // ---------- Sync engine (write-behind) ----------
  const SYNC_KEYS = ARRAY_KEYS.filter((k) => k !== "users" && k !== "auditLogs");
  const synced = {};          // coll -> Map(id -> signature) ของข้อมูลที่ตรงกับเซิร์ฟเวอร์ล่าสุด
  let syncedCounters = {};
  let syncEnabled = false, flushing = false, again = false, flushTimer = null, pollTimer = null, lastRaw = "";
  let auditQueue = [], txAudit = [];
  const sig = (r) => JSON.stringify(r, (k, v) => (k === "_version" ? undefined : v));
  const keyOf = (r) => String(r.id != null ? r.id : r.code);
  function ensureId(r) { if (r.id == null && r.code == null) r.id = "R-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function baseline() {
    SYNC_KEYS.forEach((k) => { const m = new Map(); state[k].forEach((r) => { ensureId(r); m.set(keyOf(r), sig(r)); }); synced[k] = m; });
    syncedCounters = JSON.parse(JSON.stringify(state.counters || {}));
  }
  function scheduleFlush() {
    if (!syncEnabled) return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 60);
  }
  async function flush() {
    if (!syncEnabled) return;
    if (flushing) { again = true; return; }
    flushing = true;
    try {
      do {
        again = false;
        const cdiff = Object.keys(state.counters).filter((k) => state.counters[k] !== syncedCounters[k]);
        if (cdiff.length) {
          const body = {}; cdiff.forEach((k) => { body[k] = state.counters[k]; });
          await api("PUT", "/counters", body);
          cdiff.forEach((k) => { syncedCounters[k] = body[k]; });
        }
        for (const k of SYNC_KEYS) {
          const cur = new Map();
          state[k].forEach((r) => { ensureId(r); cur.set(keyOf(r), r); });
          const base = synced[k];
          for (const [id, r] of cur) {
            const s = sig(r);
            if (!base.has(id)) { const res = await api("POST", "/" + k, r, { clientAudit: true }); r._version = res._version; base.set(id, s); }
            else if (base.get(id) !== s) { const res = await api("PUT", "/" + k + "/" + encodeURIComponent(id), r, { clientAudit: true }); r._version = res._version; base.set(id, s); }
          }
          for (const id of Array.from(base.keys())) {
            if (!cur.has(id)) { await api("DELETE", "/" + k + "/" + encodeURIComponent(id), undefined, { clientAudit: true }); base.delete(id); }
          }
        }
        while (auditQueue.length) {
          const a = auditQueue[0];
          try { await api("POST", "/audit-logs", a); } catch (e) { if (!e.status || e.status >= 500) throw e; }
          auditQueue.shift();
        }
      } while (again);
    } catch (e) {
      flushing = false;
      if (token) {
        toast("บันทึกไปยังเซิร์ฟเวอร์ไม่สำเร็จ: " + e.message + " — โหลดข้อมูลล่าสุดจากเซิร์ฟเวอร์แทน");
        auditQueue = [];
        try { await refresh(true); } catch (e2) { /* ignore */ }
      }
      return;
    }
    flushing = false;
  }
  function hasPending() { return flushing || !!flushTimer || auditQueue.length > 0 || txDepth > 0; }

  let meRec = null; // ข้อมูลผู้ใช้ปัจจุบันจากเซิร์ฟเวอร์
  function applyBootstrap(d) {
    SYNC_KEYS.forEach((k) => fill(state[k], d[k]));
    fill(state.auditLogs, d.auditLogs);
    fill(state.users, d.users || (meRec ? [meRec] : []));
    state.counters = d.counters || {};
    if (d.settings && d.settings.company) { state.settings.company = d.settings.company; Object.assign(COMPANY, d.settings.company); }
    baseline();
    version++; listeners.forEach((l) => l());
  }
  async function bootstrap() {
    const d = await api("GET", "/bootstrap");
    const empty = SYNC_KEYS.every((k) => !(d[k] || []).length) && !Object.keys(d.counters || {}).length;
    if (empty && currentUser && currentUser.role === "admin") {
      // ฐานข้อมูลใหม่ → ผู้ดูแลระบบ seed ข้อมูลตัวอย่างเริ่มต้นขึ้นเซิร์ฟเวอร์ครั้งเดียว
      const seeded = { ...d };
      SYNC_KEYS.forEach((k) => { seeded[k] = JSON.parse(JSON.stringify(defaults[k])); });
      applyBootstrap(seeded);
      SYNC_KEYS.forEach((k) => { synced[k] = new Map(); });
      syncEnabled = true; scheduleFlush();
    } else {
      applyBootstrap(d);
    }
    lastRaw = "";
  }
  async function refresh(force) {
    if (!token) return;
    if (!force && hasPending()) return;
    const d = await api("GET", "/bootstrap");
    const raw = JSON.stringify(d);
    if (!force && raw === lastRaw) return;
    if (!force && hasPending()) return;
    lastRaw = raw;
    applyBootstrap(d);
  }
  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { refresh(false).catch(() => {}); }, POLL_MS);
  }
  function clearSession() {
    setToken(null);
    syncEnabled = false; clearInterval(pollTimer); clearTimeout(flushTimer); flushTimer = null;
    auditQueue = []; txAudit = []; meRec = null; currentUser = null;
    ARRAY_KEYS.forEach((k) => fill(state[k], []));
    state.counters = {};
    version++; listeners.forEach((l) => l());
  }
  async function reloadUsers() {
    if (!currentUser) return;
    if (currentUser.role === "admin") { fill(state.users, await api("GET", "/users")); }
    version++; listeners.forEach((l) => l());
  }

  // ---------- เวลา / ผู้ใช้ ----------
  const pad = (n) => String(n).padStart(2, "0");
  function now() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function today() { return now().slice(0, 10); }
  function setUser(u) { currentUser = u; }
  function user() { return currentUser; }
  function userName() { return currentUser ? currentUser.name : "ระบบ"; }

  // ---------- Transaction ----------
  class ERPError extends Error { constructor(msg) { super(msg); this.name = "ERPError"; } }
  function fail(msg) { throw new ERPError(msg); }

  function tx(label, fn) {
    const outer = txDepth === 0;
    const snapshot = outer ? JSON.stringify(state) : null;
    txDepth++;
    try {
      const result = fn();
      txDepth--;
      if (outer) { auditQueue.push(...txAudit.splice(0)); }
      if (outer && dirty) { dirty = false; notify(); }
      return result;
    } catch (e) {
      txDepth--;
      if (outer) {
        txAudit.length = 0;
        const data = JSON.parse(snapshot);
        ARRAY_KEYS.forEach((k) => fill(state[k], data[k]));
        state.counters = data.counters;
        dirty = false;
        console.warn(`ERP tx "${label}" rolled back:`, e.message);
      }
      throw e;
    }
  }

  // ---------- Audit log ----------
  let logSeq = 0;
  function log(action, entity, entityId, detail) {
    state.auditLogs.unshift({
      id: Date.now().toString(36) + "-" + (logSeq++).toString(36),
      at: now(),
      user: userName(),
      role: currentUser ? currentUser.role : "—",
      action, entity, entityId: entityId || "—", detail: detail || "",
    });
    if (state.auditLogs.length > 5000) state.auditLogs.length = 5000;
    if (!/^(LOGIN|LOGOUT)/.test(action)) {
      (txDepth > 0 ? txAudit : auditQueue).push({ action, entity, entityId: entityId || "—", detail: detail || "" });
    }
    notify();
  }

  // ---------- เลขที่เอกสาร: PREFIX + YYYY + MM + NNNN ----------
  function _key(prefix, dateStr) {
    const d = dateStr ? new Date(dateStr) : new Date();
    const y = d.getFullYear(), m = pad(d.getMonth() + 1);
    return { k: prefix + y + m, y, m };
  }
  function peekDocNo(prefix, dateStr) {
    const { k, y, m } = _key(prefix, dateStr);
    const seq = (state.counters[k] || 0) + 1;
    return { docNo: prefix + y + m + String(seq).padStart(4, "0"), seq, counterKey: k };
  }
  function nextDocNo(prefix, dateStr) {
    const n = peekDocNo(prefix, dateStr);
    state.counters[n.counterKey] = n.seq;
    return n;
  }
  function canDelete(rec) {
    if (!rec || !rec.counterKey) return true;
    return state.counters[rec.counterKey] === rec.seq;
  }

  // ---------- CRUD ทั่วไป (บันทึก audit อัตโนมัติ) ----------
  const ENTITY_LABEL = {
    docs: "เอกสาร", customers: "ลูกค้า", suppliers: "ผู้ขาย", workOrders: "ใบสั่งผลิต", purchaseOrders: "ใบสั่งซื้อ",
    expenses: "ค่าใช้จ่าย", employees: "พนักงาน", materials: "วัตถุดิบ", finished: "สินค้า", qc: "QC",
    molds: "แม่พิมพ์", machines: "เครื่องจักร", users: "ผู้ใช้",
  };
  function find(coll, id, idKey = "id") { return state[coll].find((x) => x[idKey] === id) || null; }
  function add(coll, rec, detail) {
    tx("add " + coll, () => {
      state[coll].unshift(rec);
      log("CREATE", ENTITY_LABEL[coll] || coll, rec.id || rec.code, detail || "");
    });
    return rec;
  }
  function update(coll, id, patch, idKey = "id", detail) {
    if (coll === "users") return updateUser(id, patch);
    return tx("update " + coll, () => {
      const r = find(coll, id, idKey);
      if (!r) fail(`ไม่พบข้อมูล ${id}`);
      const changed = Object.keys(patch).filter((k) => JSON.stringify(r[k]) !== JSON.stringify(patch[k]));
      Object.assign(r, patch);
      if (changed.length) log("UPDATE", ENTITY_LABEL[coll] || coll, id, detail || ("แก้ไข: " + changed.join(", ")));
      return r;
    });
  }
  function remove(coll, id, idKey = "id") {
    if (coll === "users") return removeUser(id);
    return tx("remove " + coll, () => {
      const i = state[coll].findIndex((x) => x[idKey] === id);
      if (i < 0) return false;
      const rec = state[coll][i];
      if (rec && rec.counterKey && state.counters[rec.counterKey] === rec.seq) state.counters[rec.counterKey] = rec.seq - 1;
      state[coll].splice(i, 1);
      log("DELETE", ENTITY_LABEL[coll] || coll, id, "");
      return true;
    });
  }

  // ---------- สต๊อก ----------
  function logMove(mv) { state.stockMovements.unshift({ id: "MV-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: now().slice(0, 16), by: userName(), ...mv }); }
  const r3 = (n) => Math.round(n * 1000) / 1000;

  function findStockItem(code) {
    if (!code) return null;
    const fg = state.finished.find((f) => f.code === code);
    if (fg) return { kind: "finished", rec: fg, unit: fg.unit || "PCS" };
    const m = state.materials.find((x) => x.code === code);
    if (m) return { kind: "materials", rec: m, unit: m.unit };
    return null;
  }
  // ปรับสต๊อก (+ รับเข้า / − จ่ายออก) พร้อมบันทึก movement — ต้องเรียกภายใน tx
  function adjustStock(code, delta, ref, note, { allowNegative = false } = {}) {
    const it = findStockItem(code);
    if (!it) return null;
    const next = r3(it.rec.stock + delta);
    if (next < 0 && !allowNegative) fail(`สต๊อก ${code} ไม่พอ (คงเหลือ ${it.rec.stock}, ต้องการ ${Math.abs(delta)})`);
    it.rec.stock = next;
    logMove({ type: delta >= 0 ? "IN" : "OUT", item: code, qty: Math.abs(delta), unit: it.unit, ref, note });
    return it;
  }

  function _norm(s) { return (s || "").toLowerCase().replace(/[^a-z0-9ก-๙]/g, ""); }
  function _matchMaterial(line) {
    if (line.item) return state.materials.find((m) => m.id === line.item) || null;
    const name = _norm(line.name);
    if (!name) return null;
    return state.materials.find((m) => { const c = _norm(m.code); return c.length >= 4 && name.includes(c); })
      || state.materials.find((m) => { const nm = _norm(m.name).slice(0, 10); return nm.length >= 5 && name.includes(nm); })
      || null;
  }

  // รับของตาม PO — ทำฝั่งเซิร์ฟเวอร์ทั้งหมดใน transaction เดียว (เพิ่มสต๊อก + movement + เปลี่ยนสถานะ PO + ตั้งเจ้าหนี้)
  // ถ้าขั้นตอนใดล้มเหลว เซิร์ฟเวอร์ rollback ทั้งหมด แล้วหน้าจอโหลดข้อมูลจริงจากเซิร์ฟเวอร์ใหม่
  async function settleSync() {
    for (let i = 0; i < 100; i++) {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (!flushing) await flush();
      if (!flushing && !flushTimer && !auditQueue.length) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  async function receivePO(poId) {
    if (!token) fail("ยังไม่ได้เข้าสู่ระบบ");
    await settleSync(); // ให้การอนุมัติ PO ที่ค้างอยู่ถึงเซิร์ฟเวอร์ก่อน
    try {
      const r = await api("POST", "/actions/purchase-orders/" + encodeURIComponent(poId) + "/receive");
      await refresh(true);
      return r;
    } catch (e) {
      try { await refresh(true); } catch (e2) { /* ignore */ }
      throw e;
    }
  }

  // บันทึกผลิต → ตัดวัตถุดิบตาม BOM, รับ FG เข้าสต๊อก, นับ shot แม่พิมพ์, สถานะเครื่อง
  function produceWO(woId, addProduced, addNg) {
    return tx("produceWO", () => {
      const wo = find("workOrders", woId);
      if (!wo) fail("ไม่พบใบสั่งผลิต " + woId);
      if (wo.status === "cancelled") fail(`${wo.id} ถูกยกเลิกแล้ว`);
      if (!(addProduced > 0)) fail("จำนวนผลิตต้องมากกว่า 0");
      if ((addNg || 0) > addProduced) fail("จำนวน NG มากกว่าจำนวนผลิต");
      const good = addProduced - (addNg || 0);
      const bom = Object.values(BOMS).find((b) => b.productCode === wo.productCode);
      const consumed = [];
      if (bom) {
        const waste = 1 + (bom.wasteRate || 0) / 100;
        bom.lines.forEach((bl) => {
          const m = state.materials.find((x) => x.id === bl.item);
          if (!m) return;
          const use = r3(bl.qty * addProduced * waste);
          m.stock = r3(m.stock - use);
          logMove({ type: "OUT", item: m.code, qty: use, unit: m.unit, ref: wo.id, note: "ตัดสต๊อกผลิต " + wo.product });
          consumed.push({ code: m.code, qty: use, unit: m.unit });
        });
      }
      const fg = state.finished.find((f) => f.code === wo.productCode);
      if (fg && good > 0) {
        fg.stock += good;
        logMove({ type: "IN", item: fg.code, qty: good, unit: fg.unit || "PCS", ref: wo.id, note: "รับเข้าสินค้าสำเร็จรูปจากการผลิต" });
      }
      const mold = state.molds.find((m) => m.id === wo.mold);
      if (mold) mold.shots = (mold.shots || 0) + Math.ceil(addProduced / Math.max(1, mold.cavities || wo.cavities || 1));
      const mc = state.machines.find((m) => m.id === wo.machine);
      wo.produced = (wo.produced || 0) + addProduced;
      wo.ng = (wo.ng || 0) + (addNg || 0);
      wo.logs = wo.logs || [];
      wo.logs.unshift({ at: now(), by: userName(), produced: addProduced, ng: addNg || 0 });
      if (wo.status === "queued" || wo.status === "setup") wo.status = "running";
      if (wo.produced - wo.ng >= wo.quantity) wo.status = "done";
      if (mc) { mc.status = wo.status === "done" ? "idle" : "running"; mc.workOrder = wo.status === "done" ? undefined : wo.id; }
      log("PRODUCE", "ใบสั่งผลิต", wo.id, `ผลิต ${addProduced} ชิ้น (NG ${addNg || 0}) · ตัดวัตถุดิบ ${consumed.length} รายการ`);
      return { ok: true, consumed, good, hasBom: !!bom };
    });
  }

  // ---------- ผู้ใช้ / รหัสผ่าน (จัดการที่ Backend: BCrypt, session token, ล็อกบัญชี) ----------
  let pendingPw = null, pendingUser = null; // ระหว่างบังคับเปลี่ยนรหัสครั้งแรก (เก็บในหน่วยความจำเท่านั้น)
  const toCurrent = (u) => ({ id: u.id, username: u.username, name: u.fullName, role: u.role });

  async function enter(u) {
    meRec = u;
    setUser(toCurrent(u));
    syncEnabled = true;
    await bootstrap();
    startPolling();
  }
  async function login(username, pw) {
    const r = await api("POST", "/auth/login", { username, password: pw });
    setToken(r.token);
    const u = r.user;
    if (r.mustChange) {
      pendingPw = pw; pendingUser = u; meRec = u;
      fill(state.users, [u]);
      return { ...u, mustChange: true };
    }
    try { await enter(u); } catch (e) { clearSession(); throw e; }
    return find("users", u.id) || u;
  }
  async function setPassword(userId, pw) {
    if (!pw || pw.length < 8) throw new ERPError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
    if (pendingUser && pendingUser.id === userId) {
      // เปลี่ยนรหัสครั้งแรกหลัง login → เข้าสู่ระบบใหม่ด้วยรหัสใหม่
      await api("POST", "/auth/change-password", { currentPassword: pendingPw, newPassword: pw });
      const name = pendingUser.username;
      setToken(null); pendingPw = null; pendingUser = null;
      await login(name, pw);
      return;
    }
    await api("POST", "/users/" + encodeURIComponent(userId) + "/reset-password", { newPassword: pw });
    await reloadUsers();
  }
  async function createUser({ username, fullName, role, email, dept }, pw, mustChange = true) {
    if (!/^[a-z0-9._-]{3,}$/i.test(username || "")) throw new ERPError("ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษ/ตัวเลข อย่างน้อย 3 ตัว");
    if (!pw || pw.length < 8) throw new ERPError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
    const r = await api("POST", "/users", { username, fullName, role, email: email || "", dept: dept || "", password: pw, mustChange });
    await reloadUsers();
    return r.user;
  }
  async function changeOwnPassword(oldPw, newPw) {
    if (!currentUser) throw new ERPError("กรุณาเข้าสู่ระบบ");
    if (oldPw === newPw) throw new ERPError("รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม");
    await api("POST", "/auth/change-password", { currentPassword: oldPw, newPassword: newPw });
  }
  function logout() {
    if (token) api("POST", "/auth/logout").catch(() => {});
    pendingPw = null; pendingUser = null;
    clearSession();
  }
  // คงการเข้าสู่ระบบไว้ระหว่าง refresh (เฉพาะแท็บนี้) — เรียกแบบ async เพราะต้องถามเซิร์ฟเวอร์
  async function restore() {
    if (!token) return null;
    try {
      const u = await api("GET", "/auth/me");
      if (u.mustChange) { setToken(null); return null; }
      await enter(u);
      return find("users", u.id) || u;
    } catch (e) { clearSession(); return null; }
  }
  function restoreSession() { return null; }
  const ready = Promise.resolve();

  // แก้ไข/ลบ users ผ่าน API (UI เรียกแบบ synchronous จึงอัปเดตหน้าจอทันทีแล้วส่งไปเซิร์ฟเวอร์ ถ้าไม่สำเร็จจะโหลดคืน)
  function userFail(e) { toast(e.message); reloadUsers().catch(() => {}); }
  function updateUser(id, patch) {
    const r = find("users", id);
    if (!r) fail(`ไม่พบข้อมูล ${id}`);
    Object.assign(r, patch);
    notify();
    (async () => {
      if ("status" in patch) await api("POST", "/users/" + encodeURIComponent(id) + (patch.status === "active" ? "/activate" : "/suspend"));
      const prof = {};
      ["fullName", "role", "email", "dept"].forEach((k) => { if (k in patch) prof[k] = patch[k]; });
      if (Object.keys(prof).length) await api("PATCH", "/users/" + encodeURIComponent(id), prof);
      await reloadUsers();
    })().catch(userFail);
    return r;
  }
  function removeUser(id) {
    const i = state.users.findIndex((x) => x.id === id);
    if (i < 0) return false;
    state.users.splice(i, 1);
    notify();
    api("DELETE", "/users/" + encodeURIComponent(id)).then(reloadUsers).catch(userFail);
    return true;
  }

  // ---------- ตั้งค่าบริษัท (ใช้บนหัวเอกสารทุกใบ) ----------
  function saveCompany(patch) {
    if (!currentUser || currentUser.role !== "admin") fail("เฉพาะผู้ดูแลระบบ");
    if (!String(patch.nameTh || "").trim() || !/^\d{13}$/.test(String(patch.taxId || "").trim())) fail("กรุณาระบุชื่อบริษัท และเลขผู้เสียภาษี 13 หลัก");
    Object.assign(COMPANY, patch);
    state.settings.company = { ...COMPANY };
    notify();
    api("PUT", "/settings/company", { ...COMPANY }).catch((e) => { toast(e.message); refresh(true).catch(() => {}); });
  }

  // ---------- backup / restore (ผ่านเซิร์ฟเวอร์) ----------
  async function exportData() {
    try {
      const data = await api("GET", "/admin/export");
      const payload = { _app: "PolyMate ERP", _exportedAt: new Date().toISOString(), state: data };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "polymate-erp-backup-" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-") + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast(e.message); }
  }
  function importData(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const parsed = JSON.parse(reader.result);
          const data = parsed.state || parsed;
          if (!Array.isArray(data.docs)) throw new Error("ไฟล์ไม่ใช่ข้อมูล PolyMate ERP");
          await api("POST", "/admin/import", data);
          await refresh(true);
          resolve(true);
        } catch (e) { reject(e); }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }
  // ข้อมูลจริงอยู่ที่เซิร์ฟเวอร์ ล้างไม่ได้จากหน้าจอ → ทำได้เพียงออกจากระบบและรีเฟรช
  function resetAll() { logout(); location.reload(); }

  return {
    state, subscribe, getVersion: () => version,
    tx, fail, ERPError, log, now, today,
    find, add, update, remove,
    adjustStock, findStockItem, receivePO, produceWO,
    peekDocNo, nextDocNo, canDelete,
    setUser, user, userName, login, logout, restore, restoreSession, createUser, setPassword, changeOwnPassword, ready,
    exportData, importData, resetAll, saveCompany,
  };
})();

function useStore() {
  return React.useSyncExternalStore(Store.subscribe, Store.getVersion);
}

window.Store = Store;
window.useStore = useStore;
