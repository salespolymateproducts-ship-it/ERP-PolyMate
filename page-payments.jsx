/* global React, I, Store, ErpModal, DateInput, notify, _fmt, fmtDate, finErr, finMoney, COMPANY, printDoc, useListView, ListToolbar, SortTh, Pager */

/*
  การเงิน ขั้น A3: ใบสำคัญจ่าย (PV) → อนุมัติ → จ่ายเงิน (เลือกบัญชี/วันที่/อ้างอิง) · หัก ณ ที่จ่าย ออกเลขหนังสือตอนจ่ายจริง
  กฎทั้งหมดอยู่ที่เซิร์ฟเวอร์ (PaymentService) — หน้านี้แสดงผลและส่งคำขอ
*/

const PV_STATUS = {
  pending: { th: "รออนุมัติ", cls: "badge-warning" }, approved: { th: "อนุมัติแล้ว · รอจ่าย", cls: "badge-info" }, paid: { th: "จ่ายแล้ว", cls: "badge-success" },
  rejected: { th: "ไม่อนุมัติ", cls: "badge-danger" }, void: { th: "ยกเลิก/กลับรายการ", cls: "badge-neutral" },
};

function PayAccountFields({ accounts, f, set }) {
  const lbl = { fontSize: 12, color: "var(--text-secondary)", fontWeight: 500, display: "block", margin: "10px 0 4px" };
  return (
    <div className="grid-2" style={{ gap: 10 }}>
      <div><label style={lbl}>จ่ายจากบัญชี *</label>
        <select className="select" value={f.accountId} onChange={(e) => set("accountId", e.target.value)}>
          <option value="">— เลือกบัญชีที่จ่ายเงิน —</option>
          {accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}{a.bankName ? " · " + a.bankName : ""}{a.accountNo ? " (…" + String(a.accountNo).replace(/\D/g, "").slice(-4) + ")" : ""} · คงเหลือ {finMoney(a.balance)}</option>)}
        </select></div>
      <div><label style={lbl}>วันที่จ่ายจริง *</label><DateInput className="input" value={f.payDate} max={Store.today()} onChange={(e) => set("payDate", e.target.value)}/></div>
      <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>เลขที่อ้างอิง (สลิป/เช็ค)</label><input className="input" value={f.refNo} onChange={(e) => set("refNo", e.target.value)}/></div>
    </div>
  );
}

function FinPayVoucherModal({ accounts, pre, onClose, onDone }) {
  const [rows, setRows] = React.useState([]);
  const [sel, setSel] = React.useState({});
  const [f, setF] = React.useState({ date: Store.today(), note: "" });
  const [now, setNow] = React.useState(false);
  const [p, setP] = React.useState({ accountId: "", payDate: Store.today(), refNo: "" });
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { Store.finApi("GET", "/payments/payables").then((r) => {
    setRows(r);
    const hit = pre && r.find((x) => x.id === pre);
    if (hit) { setSel({ [hit.id]: true }); setVendorF(hit.vendor); }   // มาจากปุ่มของรายการ → ติ๊กไว้ให้และกรองเฉพาะผู้รับเงินรายนั้น
    else if (pre) setErr("รายการ " + pre + " ทำใบสำคัญจ่ายไม่ได้ (อาจจ่ายแล้ว อยู่ในใบสำคัญจ่ายอื่น หรือยังไม่อนุมัติ)");
  }).catch((e) => setErr(e.message || String(e))); }, []);
  const chosen = rows.filter((r) => sel[r.id]);
  const payee = chosen[0] ? chosen[0].vendor : "";
  const sum = (k) => Math.round(chosen.reduce((s, r) => s + r[k], 0) * 100) / 100;
  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const okRow = (r) => !payee || same(r.vendor, payee);          // เลือกผู้รับเงินแล้ว → รายการของคนอื่นเลือกไม่ได้
  const toggle = (r) => { if (okRow(r)) setSel((x) => Object.assign({}, x, { [r.id]: !x[r.id] })); };
  const mixed = chosen.some((r) => !same(r.vendor, payee));
  // ตัวกรอง/เรียง/ค้นหา/แบ่งหน้า (การเลือกคงอยู่ข้ามหน้าและข้ามการค้นหา)
  const [vendorF, setVendorF] = React.useState("ALL");
  const vendors = React.useMemo(() => Array.from(new Set(rows.map((r) => r.vendor))).sort((a, b) => String(a).localeCompare(String(b), "th")), [rows]);
  const view = useListView(rows, {
    text: (r) => [r.id, r.ref, r.vendor, r.desc, r.category].join(" "),
    dateKey: (r) => r.date, dateLabel: "วันที่",
    filter: (r) => vendorF === "ALL" || same(r.vendor, vendorF), filterKey: vendorF,
    defaultSort: { key: "date", dir: "desc" }, pageSize: 25,
    sorts: { id: (r) => r.id, ref: (r) => r.ref || "", date: (r) => r.date, vendor: (r) => r.vendor, base: (r) => r.base, vat: (r) => r.vat, wht: (r) => r.wht, net: (r) => r.net },
  });
  const pickable = view.pageRows.filter(okRow);
  const allOn = pickable.length > 0 && pickable.every((r) => sel[r.id]);
  const togglePage = () => setSel((x) => { const n = Object.assign({}, x); const first = !payee && pickable[0] ? pickable[0].vendor : payee; pickable.filter((r) => !first || same(r.vendor, first)).forEach((r) => { n[r.id] = !allOn; }); return n; });
  const save = async () => {
    setErr(""); setBusy(true);
    try {
      const body = { date: f.date, note: f.note, expenseIds: chosen.map((r) => r.id) };
      if (now) body.pay = p;
      const v = await Store.finApi("POST", "/payments", body);
      notify(v.status === "paid" ? "จ่ายแล้ว " + v.id : v.status === "approved" ? "สร้างใบสำคัญจ่าย " + v.id + " (อนุมัติแล้ว รอจ่าย)" : "สร้างใบสำคัญจ่าย " + v.id + " — รอ admin อนุมัติ", "success");
      onDone();
    } catch (e) { setErr(e && e.message ? e.message : String(e)); setBusy(false); }
  };
  const lbl = { fontSize: 12, color: "var(--text-secondary)", fontWeight: 500, display: "block", margin: "10px 0 4px" };
  const isAdmin = (Store.user() || {}).role === "admin";
  return (
    <ErpModal title="สร้างใบสำคัญจ่าย" width={1080} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" disabled={busy || !chosen.length || mixed || (now && !p.accountId)} onClick={save}>{now ? "บันทึกและจ่ายทันที" : "บันทึกใบสำคัญจ่าย"}</button></>}>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>เลือกค่าใช้จ่ายที่อนุมัติแล้วและยังไม่ได้จ่าย — ใบสำคัญจ่าย 1 ใบ จ่ายผู้รับเงินคนเดียว (พอเลือกรายการแรก รายการของผู้รับเงินรายอื่นจะเลือกไม่ได้)</div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 10, marginTop: 8, overflow: "hidden" }}>
        <ListToolbar view={view} placeholder="ค้นหา เลขที่ / PO / ผู้รับเงิน / รายการ…">
          <select className="select" style={{ width: 220 }} value={vendorF} onChange={(e) => setVendorF(e.target.value)} aria-label="กรองตามผู้รับเงิน">
            <option value="ALL">ผู้รับเงินทุกราย</option>{vendors.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </ListToolbar>
        <div style={{ maxHeight: 340, overflow: "auto", borderTop: "1px solid var(--border)" }}>
          <table className="table" style={{ margin: 0 }}>
            <thead><tr>
              <th style={{ width: 34 }}><input type="checkbox" checked={allOn} disabled={!pickable.length} onChange={togglePage} title="เลือก/ไม่เลือกทั้งหน้า (เฉพาะผู้รับเงินรายเดียวกัน)" aria-label="เลือกทั้งหน้า"/></th>
              <SortTh view={view} k="id">เลขที่</SortTh><SortTh view={view} k="ref">มาจาก</SortTh><SortTh view={view} k="date">วันที่</SortTh><SortTh view={view} k="vendor">ผู้รับเงิน</SortTh><th>รายการ</th>
              <SortTh view={view} k="base" className="num">ฐาน</SortTh><SortTh view={view} k="vat" className="num">VAT</SortTh><SortTh view={view} k="wht" className="num">หัก ณ ที่จ่าย</SortTh><SortTh view={view} k="net" className="num">จ่ายสุทธิ</SortTh>
            </tr></thead>
            <tbody>
              {view.pageRows.map((r) => {
                const ok = okRow(r);
                return (
                  <tr key={r.id} onClick={() => toggle(r)} style={{ cursor: ok ? "pointer" : "not-allowed", opacity: ok ? 1 : 0.4, background: sel[r.id] ? "var(--bg-subtle, #f5f5f5)" : undefined }} title={ok ? "" : "คนละผู้รับเงินกับรายการที่เลือกไว้"}>
                    <td><input type="checkbox" checked={!!sel[r.id]} disabled={!ok} readOnly/></td>
                    <td className="mono" style={{ whiteSpace: "nowrap", fontSize: 12 }}><b>{r.id}</b></td>
                    <td className="mono" style={{ whiteSpace: "nowrap", fontSize: 11.5 }}>{r.ref || <span style={{ color: "var(--text-tertiary)" }}>คีย์เอง</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                    <td style={{ minWidth: 150 }}>{r.vendor}</td>
                    <td style={{ fontSize: 12, color: "var(--text-secondary)", minWidth: 160 }}>{r.desc || r.category}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>{finMoney(r.base)}</td><td className="num" style={{ whiteSpace: "nowrap" }}>{r.vat ? finMoney(r.vat) : "—"}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>{r.wht ? finMoney(r.wht) : "—"}</td><td className="num" style={{ whiteSpace: "nowrap" }}><b>{finMoney(r.net)}</b></td>
                  </tr>
                );
              })}
              {!view.total && <tr><td colSpan={10} style={{ textAlign: "center", padding: 22, color: "var(--text-tertiary)" }}>{rows.length ? "ไม่พบรายการตามเงื่อนไข — ลองเปลี่ยนคำค้นหรือกด \"ล้างตัวกรอง\"" : "ไม่มีค่าใช้จ่ายรอจ่าย (บันทึกค่าใช้จ่ายและอนุมัติในหน้า บัญชี / ค่าใช้จ่าย ก่อน)"}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager view={view}/>
      </div>
      <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 8, background: "var(--bg-subtle, #f5f5f5)", fontSize: 12.5, lineHeight: 1.7 }}>
        {chosen.length ? <>ผู้รับเงิน <b>{payee}</b> · {chosen.length} รายการ · รวม <b>{finMoney(sum("base") + sum("vat"))}</b> · หัก ณ ที่จ่าย <b>{finMoney(sum("wht"))}</b> · <b>จ่ายสุทธิ {finMoney(sum("net"))}</b></> : "ยังไม่ได้เลือกรายการ"}
        {mixed && <div style={{ color: "var(--danger)" }}>เลือกผู้รับเงินหลายราย — ใบสำคัญจ่าย 1 ใบจ่ายได้คนเดียว</div>}
      </div>
      <div className="grid-2" style={{ gap: 10 }}>
        <div><label style={lbl}>วันที่ใบสำคัญจ่าย</label><DateInput className="input" value={f.date} max={Store.today()} onChange={(e) => setF({ ...f, date: e.target.value })}/></div>
        <div><label style={lbl}>หมายเหตุ</label><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })}/></div>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, marginTop: 12 }}><input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)}/> บันทึกและจ่ายทันที (สำหรับรายการเล็ก) {!isAdmin && <span style={{ color: "var(--text-tertiary)" }}>— ต้องให้ admin อนุมัติก่อนจึงจ่ายได้ ผู้ใช้อื่นจะได้ใบรออนุมัติ</span>}</label>
      {now && <PayAccountFields accounts={accounts} f={p} set={(k, v) => setP({ ...p, [k]: v })}/>}
      {err && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

function FinPayModal({ v, accounts, onClose, onDone }) {
  const [p, setP] = React.useState({ accountId: "", payDate: Store.today(), refNo: "" });
  const [err, setErr] = React.useState("");
  const save = async () => {
    setErr("");
    try { const r = await Store.finApi("POST", "/payments/" + v.id + "/pay", p); notify("จ่ายแล้ว " + v.id + (r.whtCertNo ? " · หนังสือหัก ณ ที่จ่าย " + r.whtCertNo : ""), "success"); onDone(); }
    catch (e) { setErr(e && e.message ? e.message : String(e)); }
  };
  return (
    <ErpModal title={"จ่ายเงิน · " + v.id} width={560} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" disabled={!p.accountId} onClick={save}>ยืนยันจ่ายเงิน</button></>}>
      <div style={{ fontSize: 12.5 }}>{v.payee} · จ่ายสุทธิ <b>{finMoney(v.net)}</b> บาท{v.wht > 0 ? <> · หัก ณ ที่จ่าย {finMoney(v.wht)} (ออกเลขหนังสือตามวันที่จ่ายจริง)</> : null}</div>
      <PayAccountFields accounts={accounts} f={p} set={(k, x) => setP({ ...p, [k]: x })}/>
      {err && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)", fontSize: 12.5 }}>{err}</div>}
    </ErpModal>
  );
}

/** รายละเอียดใบสำคัญจ่าย: จ่ายใคร · ค่าอะไร · มาจากเอกสารใด — ให้ผู้อนุมัติตรวจก่อนกด */
function FinPayDetailModal({ v, isAdmin, user, onClose, onApprove, onReject, onPay, onCancel, onPrint }) {
  const st = PV_STATUS[v.status] || { th: v.status, cls: "badge-neutral" };
  const mine = user && v.createdBy === user.fullName;
  const cell = { fontSize: 12.5, padding: "2px 0" };
  return (
    <ErpModal title={"ใบสำคัญจ่าย " + v.id} width={860} onClose={onClose}
      footer={<>
        <button className="btn btn-outline btn-sm" onClick={onClose}>ปิด</button>
        {v.status !== "rejected" && <button className="btn btn-outline btn-sm" onClick={() => onPrint(v)}><I.Printer size={14}/> พิมพ์</button>}
        {v.status === "pending" && isAdmin && <><button className="btn btn-outline btn-sm" onClick={() => onReject(v)}>ไม่อนุมัติ</button><button className="btn btn-primary btn-sm" onClick={() => onApprove(v)}>อนุมัติ</button></>}
        {v.status === "approved" && <button className="btn btn-primary btn-sm" onClick={() => onPay(v)}>จ่ายเงิน</button>}
        {(v.status === "pending" || v.status === "approved") && (mine || isAdmin) && <button className="btn btn-ghost btn-sm" onClick={() => onCancel(v)}>ยกเลิก</button>}
      </>}>
      <div className="grid-2" style={{ gap: 6 }}>
        <div style={cell}>ผู้รับเงิน: <b>{v.payee}</b></div><div style={cell}>สถานะ: <span className={"badge " + st.cls}>{st.th}</span></div>
        <div style={cell}>วันที่ใบสำคัญจ่าย: {fmtDate(v.date)}</div><div style={cell}>ผู้บันทึก: {v.createdBy} · {v.createdAt}</div>
        {v.note ? <div style={{ ...cell, gridColumn: "1 / -1" }}>หมายเหตุ: {v.note}</div> : null}
        {v.status === "paid" && <div style={{ ...cell, gridColumn: "1 / -1" }}>จ่ายเมื่อ {fmtDate(v.payDate)} จากบัญชี {v.accountId}{v.refNo ? " · อ้างอิง " + v.refNo : ""}{v.whtCertNo ? " · หนังสือหัก ณ ที่จ่าย " + v.whtCertNo : ""}</div>}
      </div>
      <table className="table" style={{ marginTop: 10 }}>
        <thead><tr><th>ค่าใช้จ่าย</th><th>มาจากเอกสาร</th><th>รายการ / หมวด</th><th>วันที่</th><th>ครบกำหนด</th><th className="num">ฐาน</th><th className="num">VAT</th><th className="num">หัก ณ ที่จ่าย</th><th className="num">จ่ายสุทธิ</th></tr></thead>
        <tbody>
          {v.items.map((i) => (
            <tr key={i.expenseId}>
              <td className="mono"><b>{i.expenseId}</b></td>
              <td className="mono">{i.ref ? <span className="badge badge-info">{i.ref}</span> : <span style={{ color: "var(--text-tertiary)" }}>คีย์เองในหน้าบัญชี</span>}</td>
              <td style={{ fontSize: 12 }}>{i.descr || "—"}<div style={{ color: "var(--text-tertiary)" }}>{i.category}</div></td>
              <td>{i.expenseDate ? fmtDate(i.expenseDate) : "—"}</td><td>{i.due && i.due !== "—" ? fmtDate(i.due) : "—"}</td>
              <td className="num">{finMoney(i.base)}</td><td className="num">{i.vat ? finMoney(i.vat) : "—"}</td>
              <td className="num">{i.wht ? finMoney(i.wht) + " (" + i.whtRate + "%)" : "—"}</td><td className="num"><b>{finMoney(i.net)}</b></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr style={{ fontWeight: 700 }}><td colSpan={5} style={{ textAlign: "right" }}>รวม</td><td className="num" colSpan={2}>{finMoney(v.gross)}</td><td className="num">{v.wht ? finMoney(v.wht) : "—"}</td><td className="num" style={{ color: "var(--danger)" }}>{finMoney(v.net)}</td></tr></tfoot>
      </table>
    </ErpModal>
  );
}

/** แบบฟอร์มใบสำคัญจ่าย (พิมพ์ A4 ต้นฉบับ + สำเนา) — ข้อมูลทั้งหมดมาจาก PV ที่เซิร์ฟเวอร์ ไม่คำนวณใหม่ */
function FinPayPrintModal({ v, accounts, onClose }) {
  const C = window.COMPANY || {};
  const acc = (accounts || []).find((a) => a.id === v.accountId);
  // ข้อมูลผู้รับเงิน: ใช้สำเนาที่บันทึกในรายการค่าใช้จ่าย → ถ้าไม่มีดูจากทะเบียนผู้ขาย
  const exps = (v.items || []).map((i) => Store.state.expenses.find((e) => e.id === i.expenseId)).filter(Boolean);
  const sup = (Store.state.suppliers || []).find((s) => s.name === v.payee || (exps[0] && exps[0].supplierId && s.id === exps[0].supplierId));
  const taxId = (exps.find((e) => e.vendorTaxId) || {}).vendorTaxId || (sup && sup.taxId && sup.taxId !== "—" ? sup.taxId : "");
  const address = (exps.find((e) => e.vendorAddress) || {}).vendorAddress || (sup && sup.address) || "";
  const base = (v.items || []).reduce((s, i) => s + (i.base || 0), 0), vat = (v.items || []).reduce((s, i) => s + (i.vat || 0), 0);
  const isVoid = v.status === "void", isPaid = v.status === "paid";
  const stTh = (PV_STATUS[v.status] || { th: v.status }).th;
  const b = "1px solid #0B1220", cell = { border: b, padding: "4px 6px", fontSize: 11 }, lab = { color: "#5B6478" };
  // ลายเซ็นอิเล็กทรอนิกส์: ระดับ 1 = พิมพ์ชื่อ + วันเวลาที่อนุมัติ/จ่ายจากระบบ · ระดับ 2 = ภาพลายเซ็นของผู้นั้น (ถ้าตั้งไว้) เฉพาะใบที่อนุมัติ/จ่ายแล้ว
  // การเปิดหน้านี้ดึงภาพจากเซิร์ฟเวอร์และถูกบันทึกใน Audit Log (SIGNATURE_USE)
  const [sigs, setSigs] = React.useState({});
  React.useEffect(() => {
    let live = true;
    if (v.status === "approved" || v.status === "paid") {
      Store.sigApi("GET", "/for/pv/" + v.id).then((r) => { if (live) setSigs(Object.fromEntries((r.signers || []).map((s) => [s.role, s]))); }).catch(() => {});
    }
    return () => { live = false; };
  }, [v.id, v.status]);
  const fmtAt = (s) => (s ? fmtDate(String(s).slice(0, 10)) + " " + String(s).slice(11, 16) : "");
  const sig = (title, role, name, at) => {
    const s = sigs[role];
    return (
      <div style={{ flex: 1, textAlign: "center", fontSize: 11 }}>
        <div style={{ height: 48, borderBottom: "1px dotted #0B1220", margin: "0 10px", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          {s && s.image ? <img src={s.image} alt="" style={{ maxHeight: 44, maxWidth: "100%", objectFit: "contain" }}/> : null}
        </div>
        <div style={{ marginTop: 4, fontWeight: 600 }}>{title}</div>
        <div>{name ? "(" + name + ")" : ""}</div>
        <div style={{ color: "#5B6478" }}>{at ? fmtAt(at) : "วันที่ ......../......../........"}</div>
      </div>
    );
  };
  return (
    <ErpModal title={"พิมพ์ใบสำคัญจ่าย · " + v.id} width={900} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ปิด</button>
        <button className="btn btn-primary btn-sm" onClick={() => printDoc(v.id, { title: "ใบสำคัญจ่าย " + v.id, pageMargin: "10mm 10mm 10mm 10mm", bare: true })}><I.Printer size={14}/> พิมพ์ / PDF (ต้นฉบับ + สำเนา)</button></>}>
      {v.status === "pending" || v.status === "approved" ? <div className="no-print" style={{ fontSize: 12, color: "var(--amber)", marginBottom: 8 }}>ใบนี้ยังไม่ได้จ่ายเงิน — ช่องบัญชี/วันที่จ่ายจะว่างบนกระดาษ</div> : null}
      <div className="print-area-wrap" style={{ overflowX: "auto", background: "var(--bg)", padding: 8 }}>
        <div className="print-area" data-copies="2" style={{ width: "190mm", padding: "8mm 8mm", boxSizing: "border-box", background: "white", color: "#0B1220", margin: "0 auto", position: "relative", fontFamily: '"IBM Plex Sans Thai", "Noto Sans Thai", Tahoma, sans-serif' }}>
          {isVoid && <div style={{ position: "absolute", top: "38%", left: 0, right: 0, textAlign: "center", fontSize: 54, fontWeight: 800, color: "rgba(200,30,30,.18)", transform: "rotate(-18deg)", pointerEvents: "none" }}>ยกเลิก / กลับรายการ</div>}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <img src="assets/polymate-logo.png" alt="PolyMate" style={{ width: 54, height: 54, objectFit: "contain", flex: "none" }}/>
              <div style={{ fontSize: 11, lineHeight: 1.5 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{C.nameTh}</div>
                <div>{C.address}</div><div>เลขประจำตัวผู้เสียภาษี {C.taxId}{C.phone ? " · โทร " + C.phone : ""}</div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>ใบสำคัญจ่าย</div><div style={{ fontSize: 10.5, color: "#5B6478" }}>PAYMENT VOUCHER</div>
              <div className="copy-mark" style={{ display: "inline-block", marginTop: 4, border: b, padding: "1px 10px", fontSize: 11, fontWeight: 700 }}>ต้นฉบับ</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 10, fontSize: 11.5, lineHeight: 1.6 }}>
            <div style={{ flex: 1.6, border: b, padding: "6px 8px" }}>
              <div><span style={lab}>จ่ายให้ </span><b>{v.payee}</b></div>
              {address ? <div><span style={lab}>ที่อยู่ </span>{address}</div> : null}
              {taxId ? <div><span style={lab}>เลขประจำตัวผู้เสียภาษี </span>{taxId}</div> : null}
            </div>
            <div style={{ flex: 1, border: b, padding: "6px 8px" }}>
              <div><span style={lab}>เลขที่ </span><b>{v.id}</b></div><div><span style={lab}>วันที่ </span>{fmtDate(v.date)}</div>
              <div><span style={lab}>สถานะ </span>{stTh}</div>
            </div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
            <thead><tr style={{ background: "#F1F3F7" }}>
              <th style={{ ...cell, width: 24 }}>#</th><th style={cell}>รายการ</th><th style={{ ...cell, width: 96 }}>เลขที่ค่าใช้จ่าย / อ้างอิง</th>
              <th style={{ ...cell, width: 70, textAlign: "right" }}>ฐาน</th><th style={{ ...cell, width: 60, textAlign: "right" }}>VAT</th><th style={{ ...cell, width: 66, textAlign: "right" }}>หัก ณ ที่จ่าย</th><th style={{ ...cell, width: 76, textAlign: "right" }}>จ่ายสุทธิ</th>
            </tr></thead>
            <tbody>
              {(v.items || []).map((i, n) => (
                <tr key={i.expenseId}>
                  <td style={{ ...cell, textAlign: "center" }}>{n + 1}</td>
                  <td style={cell}>{i.descr || i.category || "—"}{i.category && i.descr ? <div style={{ color: "#5B6478", fontSize: 10 }}>{i.category}</div> : null}</td>
                  <td style={{ ...cell, fontSize: 10 }}>{i.expenseId}{i.ref ? <div>{i.ref}</div> : null}</td>
                  <td style={{ ...cell, textAlign: "right" }}>{finMoney(i.base)}</td><td style={{ ...cell, textAlign: "right" }}>{i.vat ? finMoney(i.vat) : "—"}</td>
                  <td style={{ ...cell, textAlign: "right" }}>{i.wht ? finMoney(i.wht) + " (" + i.whtRate + "%)" : "—"}</td><td style={{ ...cell, textAlign: "right" }}><b>{finMoney(i.net)}</b></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={3} style={{ ...cell, textAlign: "right", fontWeight: 700 }}>รวม</td><td style={{ ...cell, textAlign: "right" }}>{finMoney(base)}</td><td style={{ ...cell, textAlign: "right" }}>{vat ? finMoney(vat) : "—"}</td><td style={{ ...cell, textAlign: "right" }}>{v.wht ? finMoney(v.wht) : "—"}</td><td style={{ ...cell, textAlign: "right", fontWeight: 800 }}>{finMoney(v.net)}</td></tr>
              <tr><td colSpan={7} style={{ ...cell, fontWeight: 600 }}>จำนวนเงินจ่ายสุทธิ (ตัวอักษร): {window.bahtText ? window.bahtText(v.net) : ""}</td></tr>
            </tfoot>
          </table>
          <div style={{ border: b, borderTop: 0, padding: "6px 8px", fontSize: 11.5, lineHeight: 1.7 }}>
            <div><span style={lab}>จ่ายจากบัญชี </span>{isPaid ? (acc ? acc.code + " · " + acc.name + (acc.bankName ? " · " + acc.bankName : "") : v.accountId) : "......................................................"}
              {"  "}<span style={lab}>วันที่จ่าย </span>{isPaid ? fmtDate(v.payDate) : "......../......../........"}</div>
            <div><span style={lab}>เลขอ้างอิง (สลิป/เช็ค) </span>{isPaid ? (v.refNo || "—") : "................................"}
              {v.whtCertNo ? <>{"  "}<span style={lab}>หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) เลขที่ </span><b>{v.whtCertNo}</b></> : null}</div>
            {v.note ? <div><span style={lab}>หมายเหตุ </span>{v.note}</div> : null}
            {isVoid ? <div style={{ color: "#B42318" }}>ยกเลิก/กลับรายการเมื่อ {v.voidDate ? fmtDate(v.voidDate) : ""}{v.voidReason ? " — " + v.voidReason : ""}</div> : null}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            {sig("ผู้จัดทำ", "creator", v.createdBy, v.createdAt)}
            {sig("ผู้อนุมัติ", "approver", v.approvedBy, v.approvedAt)}
            {sig("ผู้จ่ายเงิน", "payer", isPaid ? v.paidBy : "", isPaid ? v.paidAt : null)}
            {sig("ผู้รับเงิน", "recipient", "", null)}
          </div>
        </div>
      </div>
    </ErpModal>
  );
}

function FinPayments({ accounts, isAdmin, user, setModal, reload, tick }) {
  const [sum, setSum] = React.useState(null);
  const [filter, setFilter] = React.useState("ALL");
  // มาจากปุ่ม "ทำใบสำคัญจ่าย" ของรายการค่าใช้จ่าย/เจ้าหนี้ → เปิดฟอร์มสร้างโดยติ๊กรายการนั้นไว้แล้ว
  const [sub, setSub] = React.useState(() => { const x = window.takeFocus ? window.takeFocus("pvExpense") : null; return x ? { t: "new", pre: x } : null; });
  const v0 = useServerListView("/payments", { params: { status: filter }, tick, onError: finErr });
  const list = v0.pageRows;
  React.useEffect(() => {
    let live = true;
    Store.finApi("GET", "/payments/summary").then((s) => { if (live) setSum(s); }).catch(finErr);
    return () => { live = false; };
  }, [tick]);
  const approve = async (id) => { try { await Store.finApi("POST", "/payments/" + id + "/approve"); notify("อนุมัติ " + id + " แล้ว", "success"); reload(); } catch (e) { finErr(e); } };
  const done = () => { setSub(null); reload(); };
  return (
    <>
      <div className="grid-4" style={{ margin: "0 0 12px" }}>
        <div className="card" style={{ padding: 12 }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>ค่าใช้จ่ายรอทำใบสำคัญจ่าย</div><div style={{ fontSize: 18, fontWeight: 700 }}>{sum ? sum.payableCount : 0} รายการ</div></div>
        <div className="card" style={{ padding: 12 }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>ใบรออนุมัติ</div><div style={{ fontSize: 18, fontWeight: 700, color: "var(--amber)" }}>{sum ? sum.pendingCount : 0} ใบ</div></div>
        <div className="card" style={{ padding: 12 }}><div style={{ fontSize: 12, color: "var(--text-secondary)" }}>อนุมัติแล้ว รอจ่าย</div><div style={{ fontSize: 18, fontWeight: 700, color: "var(--danger)" }}>{sum ? sum.toPayCount : 0} ใบ · {finMoney(sum ? sum.toPayAmount : 0)}</div></div>
        <div className="card" style={{ padding: 12, display: "flex", alignItems: "center" }}><button className="btn btn-primary btn-sm" onClick={() => setSub({ t: "new" })}><I.Plus size={14}/> สร้างใบสำคัญจ่าย</button></div>
      </div>
      <div className="card">
        <ListToolbar view={v0} placeholder="ค้นหาเลขที่ ผู้รับเงิน ค่าใช้จ่าย เลข PO…">
          <select className="select" style={{ width: 220 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="ALL">ทุกสถานะ</option>{Object.keys(PV_STATUS).map((k) => <option key={k} value={k}>{PV_STATUS[k].th}</option>)}
          </select>
        </ListToolbar>
        <table className="table">
          <thead><tr><SortTh view={v0} k="id">เลขที่</SortTh><SortTh view={v0} k="date">วันที่</SortTh><SortTh view={v0} k="payee">ผู้รับเงิน</SortTh><th>ค่าใช้จ่าย</th><SortTh view={v0} k="gross" className="num">รวม</SortTh><th className="num">หัก ณ ที่จ่าย</th><SortTh view={v0} k="net" className="num">จ่ายสุทธิ</SortTh><SortTh view={v0} k="status">สถานะ / การจ่าย</SortTh><th></th></tr></thead>
          <tbody>
            {list.map((v) => {
              const st = PV_STATUS[v.status] || { th: v.status, cls: "badge-neutral" };
              const mine = user && v.createdBy === user.fullName;
              return (
                <tr key={v.id}>
                  <td className="mono"><b>{v.id}</b></td><td>{fmtDate(v.date)}</td><td>{v.payee}</td>
                  <td style={{ fontSize: 12 }}>{v.items.map((i) => <div key={i.expenseId}><span className="mono">{i.expenseId}</span>{i.ref ? <> · <span className="mono">{i.ref}</span></> : null}{i.descr ? <div style={{ color: "var(--text-tertiary)" }}>{i.descr}</div> : null}</div>)}</td>
                  <td className="num">{finMoney(v.gross)}</td><td className="num">{v.wht ? finMoney(v.wht) : "—"}</td><td className="num" style={{ fontWeight: 600, color: "var(--danger)" }}>{finMoney(v.net)}</td>
                  <td><span className={"badge " + st.cls}>{st.th}</span>
                    {v.status === "paid" && <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{fmtDate(v.payDate)} · {v.accountId}{v.refNo ? " · " + v.refNo : ""}{v.whtCertNo ? " · " + v.whtCertNo : ""}</div>}
                    {v.status === "rejected" && v.rejectReason ? <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{v.rejectReason}</div> : null}
                    {v.status === "void" && v.voidReason ? <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{v.voidReason}</div> : null}
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{v.createdBy}{v.selfApproved ? <span className="badge badge-warning" style={{ marginLeft: 4 }}>อนุมัติเอง</span> : null}</div></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSub({ t: "detail", v })}>รายละเอียด</button>
                    {v.status !== "rejected" && <button className="btn btn-ghost btn-sm" onClick={() => setSub({ t: "print", v })} title="พิมพ์ใบสำคัญจ่าย" aria-label="พิมพ์ใบสำคัญจ่าย"><I.Printer size={13}/></button>}
                    {v.status === "pending" && isAdmin && <><button className="btn btn-primary btn-sm" onClick={() => approve(v.id)}>อนุมัติ</button> <button className="btn btn-outline btn-sm" onClick={() => setModal({ t: "pvreject", id: v.id })}>ไม่อนุมัติ</button> </>}
                    {v.status === "approved" && <button className="btn btn-primary btn-sm" onClick={() => setSub({ t: "pay", v })}>จ่ายเงิน</button>}
                    {(v.status === "pending" || v.status === "approved") && (mine || isAdmin) && <button className="btn btn-ghost btn-sm" onClick={() => setModal({ t: "pvcancel", id: v.id })}>ยกเลิก</button>}
                    {v.status === "paid" && isAdmin && <button className="btn btn-outline btn-sm" onClick={() => setModal({ t: "pvvoid", id: v.id })}>กลับรายการ</button>}
                  </td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={9} style={{ textAlign: "center", padding: 28, color: "var(--text-tertiary)" }}>{v0.loading ? "กำลังโหลด…" : v0.active || filter !== "ALL" ? "ไม่พบใบสำคัญจ่ายที่ตรงกับตัวกรอง" : "ยังไม่มีใบสำคัญจ่าย"}</td></tr>}
          </tbody>
        </table>
        <Pager view={v0}/>
      </div>
      {sub && sub.t === "new" && <FinPayVoucherModal accounts={accounts} pre={sub.pre} onClose={() => setSub(null)} onDone={done}/>}
      {sub && sub.t === "detail" && <FinPayDetailModal v={sub.v} isAdmin={isAdmin} user={user} onClose={() => setSub(null)}
        onApprove={async (x) => { await approve(x.id); setSub(null); }} onReject={(x) => { setSub(null); setModal({ t: "pvreject", id: x.id }); }}
        onPay={(x) => setSub({ t: "pay", v: x })} onCancel={(x) => { setSub(null); setModal({ t: "pvcancel", id: x.id }); }} onPrint={(x) => setSub({ t: "print", v: x })}/>}
      {sub && sub.t === "print" && <FinPayPrintModal v={sub.v} accounts={accounts} onClose={() => setSub(null)}/>}
      {sub && sub.t === "pay" && <FinPayModal v={sub.v} accounts={accounts} onClose={() => setSub(null)} onDone={done}/>}
    </>
  );
}

window.FinPayments = FinPayments;

/** คิวอนุมัติรวม: รายการรับ/จ่าย/โอน + ใบรับเงินลูกค้า + ใบสำคัญจ่าย — บอกชนิดเอกสารและสิ่งที่กำลังอนุมัติให้ชัด */
function FinApprovals({ txns, receipts, vouchers, accName, isAdmin, user, setModal, reload }) {
  const [sub, setSub] = React.useState(null);
  const rows = [
    ...txns.map((t) => ({ kind: "txn", id: t.id, date: t.date, label: "รับ/จ่าย/โอนเงิน", cls: "badge-neutral",
      what: ({ other_in: "รับเงินอื่น ๆ", other_out: "จ่ายเงินอื่น ๆ", transfer: "โอนระหว่างบัญชี" })[t.kind] + " · " + (t.kind === "transfer" ? accName(t.accountId) + " → " + accName(t.toAccountId) : accName(t.accountId)) + " · " + [t.category, t.counterparty].filter(Boolean).join(" · "),
      amount: t.amount, sign: t.kind === "other_in" ? 1 : t.kind === "other_out" ? -1 : 0, by: t.createdBy, raw: t })),
    ...receipts.map((r) => ({ kind: "rv", id: r.id, date: r.date, label: "รับเงินลูกค้า", cls: "badge-success",
      what: r.customerName + " · ตัดใบกำกับ " + r.allocations.map((a) => a.invoiceId).join(", ") + " · เข้าบัญชี " + r.accountId, amount: r.received, sign: 1, by: r.createdBy, raw: r })),
    ...vouchers.map((v) => ({ kind: "pv", id: v.id, date: v.date, label: "ใบสำคัญจ่าย", cls: "badge-info",
      what: v.payee + " · " + v.items.map((i) => i.expenseId + (i.ref ? " (" + i.ref + ")" : "")).join(", "), amount: v.net, sign: -1, by: v.createdBy, raw: v })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
  const base = { txn: "/txns/", rv: "/receipts/", pv: "/payments/" };
  const approve = async (x) => { try { await Store.finApi("POST", base[x.kind] + x.id + "/approve"); notify("อนุมัติ " + x.id + " แล้ว", "success"); setSub(null); reload(); } catch (e) { finErr(e); } };
  const reject = (x) => setModal({ t: { txn: "reject", rv: "rvreject", pv: "pvreject" }[x.kind], id: x.id });
  const cancel = (x) => setModal({ t: { txn: "cancel", rv: "rvcancel", pv: "pvcancel" }[x.kind], id: x.id });
  return (
    <div className="card">
      <div style={{ padding: "12px 16px", fontSize: 12.5, color: "var(--text-secondary)" }}>รวมทุกเอกสารที่รออนุมัติ — กด "รายละเอียด" เพื่อดูว่าเป็นเอกสารที่มาจากใบกำกับ/ค่าใช้จ่าย/PO ใบไหน ก่อนอนุมัติ</div>
      <table className="table">
        <thead><tr><th>ชนิดเอกสาร</th><th>เลขที่</th><th>วันที่</th><th>เรื่อง / ที่มา</th><th className="num">จำนวนเงิน</th><th>ผู้บันทึก</th><th></th></tr></thead>
        <tbody>
          {rows.map((x) => {
            const mine = user && x.by === user.fullName;
            return (
              <tr key={x.kind + x.id}>
                <td><span className={"badge " + x.cls}>{x.label}</span></td><td className="mono"><b>{x.id}</b></td><td>{fmtDate(x.date)}</td>
                <td style={{ fontSize: 12.5, maxWidth: 420 }}>{x.what}</td>
                <td className="num" style={{ fontWeight: 600, color: x.sign > 0 ? "var(--success)" : x.sign < 0 ? "var(--danger)" : "inherit" }}>{finMoney(x.amount)}</td>
                <td style={{ fontSize: 11.5 }}>{x.by}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {x.kind !== "txn" && <button className="btn btn-ghost btn-sm" onClick={() => setSub(x)}>รายละเอียด</button>}
                  {isAdmin && <><button className="btn btn-primary btn-sm" onClick={() => approve(x)}>อนุมัติ</button> <button className="btn btn-outline btn-sm" onClick={() => reject(x)}>ไม่อนุมัติ</button> </>}
                  {(mine || isAdmin) && <button className="btn btn-ghost btn-sm" onClick={() => cancel(x)}>ยกเลิก</button>}
                </td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, color: "var(--text-tertiary)" }}>ไม่มีรายการรออนุมัติ</td></tr>}
        </tbody>
      </table>
      {sub && sub.kind === "pv" && <FinPayDetailModal v={sub.raw} isAdmin={isAdmin} user={user} onClose={() => setSub(null)} onApprove={() => approve(sub)} onReject={() => { setSub(null); reject(sub); }} onPay={() => setSub(null)} onCancel={() => { setSub(null); cancel(sub); }}/>}
      {sub && sub.kind === "rv" && <FinReceiptDetailModal r={sub.raw} isAdmin={isAdmin} user={user} onClose={() => setSub(null)} onApprove={() => approve(sub)} onReject={() => { setSub(null); reject(sub); }} onCancel={() => { setSub(null); cancel(sub); }}/>}
    </div>
  );
}

window.FinApprovals = FinApprovals;
