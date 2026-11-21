/* global React, I, Store, ErpModal, notify, printDoc, COMPANY, _fmt, whtAmount, fmtDate, useStore */

/*
  หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) ที่ "เรา" ออกให้ผู้ขาย/ผู้รับเงิน
  ------------------------------------------------------------
  • ออกได้เมื่อรายการค่าใช้จ่ายที่มีหัก ณ ที่จ่ายจ่ายแล้วผ่านใบสำคัญจ่าย (PV) — วันที่จ่าย = วันที่ในหนังสือ · เลขที่ใช้เลข WT ที่ออกตอนจ่ายใน PV
    (PV เดียวที่มีหลายรายการหัก ณ ที่จ่าย จะพิมพ์หนังสือแยกรายการแต่ใช้เลขเดียวกัน — ให้ผู้ทำบัญชีตรวจรูปแบบก่อนใช้จริง)
  • เลขที่ = WT + ปีเดือนที่จ่าย + ลำดับ 4 หลัก (เช่น WT2026110006) จากตัวนับกลางเดียวกับเอกสารอื่น
  • เก็บใน expense.whtCert พร้อมสำเนาข้อมูลผู้ถูกหัก ณ วันที่ออก (ออกแล้วแก้ไม่ได้ — พิมพ์ซ้ำได้)
  • ประเภทเงินได้เลือกได้ทุกข้อของแบบ (1–6 รวมข้อย่อยของ 4(ข))
  • พิมพ์ A4 2 ฉบับเหมือนกัน (ฉบับที่ 1 สำหรับผู้ถูกหัก ฉบับที่ 2 เก็บเป็นหลักฐาน) — จัดหน้าตามแบบฟอร์มตัวอย่างที่ได้รับ
    ก่อนใช้ยื่นจริงให้ฝ่ายบัญชีเทียบกับแบบทางการของกรมสรรพากร
*/

// ---------- ตัวเลข → ข้อความภาษาไทย (บาท/สตางค์) ----------
const _whtD = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const _whtP = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];
function _whtReadInt(n) {
  if (n <= 0) return "";
  if (n >= 1000000) return _whtReadInt(Math.floor(n / 1000000)) + "ล้าน" + _whtReadInt(n % 1000000);
  const str = String(n), len = str.length;
  let s = "";
  for (let i = 0; i < len; i++) {
    const d = Number(str[i]), pos = len - i - 1;
    if (d === 0) continue;
    if (pos === 0) s += d === 1 && len > 1 ? "เอ็ด" : _whtD[d];
    else if (pos === 1) s += d === 1 ? "สิบ" : d === 2 ? "ยี่สิบ" : _whtD[d] + "สิบ";
    else s += _whtD[d] + _whtP[pos];
  }
  return s;
}
function bahtText(v) {
  const n = Math.round(Math.abs(Number(v) || 0) * 100);
  const baht = Math.floor(n / 100), satang = n % 100;
  return (baht === 0 ? "ศูนย์" : _whtReadInt(baht)) + "บาท" + (satang ? _whtReadInt(satang) + "สตางค์" : "ถ้วน");
}

// ---------- ข้อมูลผู้ถูกหัก (จากทะเบียนผู้ขายตามชื่อ/รหัสในรายการค่าใช้จ่าย) ----------
function findPayee(vendor) {
  const v = String(vendor || "").trim().toLowerCase();
  if (!v) return null;
  const sups = Store.state.suppliers;
  return sups.find((s) => [s.code, s.name, s.nameEn].some((x) => String(x || "").trim().toLowerCase() === v))
    || sups.find((s) => s.name && (s.name.toLowerCase().includes(v) || v.includes(s.name.toLowerCase()))) || null;
}
function payeeSnapshot(exp) {
  const s = findPayee(exp.vendor);
  return {
    name: s ? s.name : exp.vendor || "", taxId: s && s.taxId && s.taxId !== "—" ? s.taxId : "", address: s ? s.address || "" : "",
    type: s && s.payeeType === "individual" ? "individual" : "juristic", found: !!s,
  };
}

// ---------- ประเภทเงินได้พึงประเมินจ่าย: ครบทุกแถวของแบบ (เลือกได้ทุกข้อ 1–6 รวมข้อย่อย 4(ข)) ----------
// kind: "pay" = แถวที่ใส่วันที่/จำนวนเงิน/ภาษีได้ · "head" = หัวข้อ (ไม่มีช่องตัวเลข) · indent = ระดับย่อหน้า · note = แถวที่ต้องระบุรายละเอียดต่อท้าย
const WHT_FORM_ROWS = [
  { k: "1", kind: "pay", ind: 0, t: "1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)", label: "ข้อ 1 เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ — ม.40 (1)" },
  { k: "2", kind: "pay", ind: 0, t: "2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)", label: "ข้อ 2 ค่าธรรมเนียม ค่านายหน้า ฯลฯ — ม.40 (2)" },
  { k: "3", kind: "pay", ind: 0, t: "3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)", label: "ข้อ 3 ค่าแห่งลิขสิทธิ์ ฯลฯ — ม.40 (3)" },
  { k: "4a", kind: "pay", ind: 0, t: "4. (ก) ดอกเบี้ย ฯลฯ ตามมาตรา 40 (4)(ก)", label: "ข้อ 4 (ก) ดอกเบี้ย ฯลฯ — ม.40 (4)(ก)" },
  { k: "4b", kind: "head", ind: 1, t: "(ข) เงินปันผล เงินส่วนแบ่งกำไร ฯลฯ ตามมาตรา 40 (4)(ข)" },
  { k: "4b1", kind: "head", ind: 2, t: "(1) กรณีผู้ได้รับเงินปันผลได้รับเครดิตภาษี โดยจ่ายจากกำไรสุทธิของกิจการที่ได้ต้องเสียภาษีเงินได้นิติบุคคลในอัตรา ดังนี้" },
  { k: "4b11", kind: "pay", ind: 3, t: "(1.1) อัตราร้อยละ 30 ของกำไรสุทธิ", label: "ข้อ 4 (ข) (1.1) เครดิตภาษี อัตราร้อยละ 30 ของกำไรสุทธิ" },
  { k: "4b12", kind: "pay", ind: 3, t: "(1.2) อัตราร้อยละ 25 ของกำไรสุทธิ", label: "ข้อ 4 (ข) (1.2) เครดิตภาษี อัตราร้อยละ 25 ของกำไรสุทธิ" },
  { k: "4b13", kind: "pay", ind: 3, t: "(1.3) อัตราร้อยละ 20 ของกำไรสุทธิ", label: "ข้อ 4 (ข) (1.3) เครดิตภาษี อัตราร้อยละ 20 ของกำไรสุทธิ" },
  { k: "4b14", kind: "pay", ind: 3, t: "(1.4) อัตราอื่นๆ (ระบุ)", tail: "ของกำไรสุทธิ", note: true, label: "ข้อ 4 (ข) (1.4) เครดิตภาษี อัตราอื่นๆ (ระบุ)" },
  { k: "4b2", kind: "head", ind: 2, t: "(2) กรณีผู้ได้รับเงินปันผลไม่ได้รับเครดิตภาษีเนื่องจากจ่ายจาก" },
  { k: "4b21", kind: "pay", ind: 3, t: "(2.1) กำไรสุทธิของกิจการที่ได้รับยกเว้นภาษีเงินได้นิติบุคคล", label: "ข้อ 4 (ข) (2.1) กำไรสุทธิที่ได้รับยกเว้นภาษีเงินได้นิติบุคคล" },
  { k: "4b22", kind: "pay", ind: 3, t: "(2.2) เงินปันผลหรือส่วนแบ่งของกำไรที่ได้รับยกเว้นไม่ต้องนำมารวมคำนวณเป็นรายได้เพื่อเสียภาษีเงินได้นิติบุคคล", label: "ข้อ 4 (ข) (2.2) เงินปันผลที่ได้รับยกเว้นไม่ต้องนำมารวมคำนวณ" },
  { k: "4b23", kind: "pay", ind: 3, t: "(2.3) กำไรสุทธิที่ได้หักผลขาดทุนสุทธิยกมาไม่เกิน 5 ปีก่อนรอบระยะเวลาบัญชีปีปัจจุบัน", label: "ข้อ 4 (ข) (2.3) กำไรสุทธิที่หักผลขาดทุนยกมาไม่เกิน 5 ปี" },
  { k: "4b24", kind: "pay", ind: 3, t: "(2.4) กำไรที่รับรู้ทางบัญชีโดยวิธีส่วนได้เสีย (equity method)", label: "ข้อ 4 (ข) (2.4) กำไรที่รับรู้ทางบัญชีโดยวิธีส่วนได้เสีย" },
  { k: "4b25", kind: "pay", ind: 3, t: "(2.5) อื่นๆ (ระบุ)", note: true, label: "ข้อ 4 (ข) (2.5) อื่นๆ (ระบุ)" },
  { k: "5", kind: "pay", ind: 0, t: "5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่ายตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส เช่น รางวัล ส่วนลดหรือประโยชน์ใดๆ เนื่องจากการส่งเสริมการขาย รางวัลในการประกวด การแข่งขัน การชิงโชค ค่าแสดงของนักแสดงสาธารณะ ค่าจ้างทำของ ค่าโฆษณา ค่าเช่า ค่าขนส่ง ค่าบริการ ค่าเบี้ยประกันวินาศภัย ฯลฯ", label: "ข้อ 5 ค่าจ้างทำของ ค่าโฆษณา ค่าเช่า ค่าขนส่ง ค่าบริการ ฯลฯ (ม.3 เตรส)" },
  { k: "6", kind: "pay", ind: 0, t: "6. อื่นๆ (ระบุ)", note: true, label: "ข้อ 6 อื่นๆ (ระบุ)" },
];
const WHT_INCOME_ROWS = Object.fromEntries(WHT_FORM_ROWS.filter((r) => r.kind === "pay").map((r) => [r.k, r.label]));
const WHT_NOTE_ROWS = WHT_FORM_ROWS.filter((r) => r.note).map((r) => r.k);

// ---------- ออกหนังสือ (ฝั่งข้อมูล) ----------
function whtCertCanIssue(exp) {
  if (!exp || exp.status === "cancelled") return { ok: false, reason: "รายการถูกยกเลิก" };
  if (!(exp.whtRate > 0)) return { ok: false, reason: "รายการนี้ไม่มีหัก ณ ที่จ่าย" };
  if (exp.status !== "paid" || !exp.paidDate) return { ok: false, reason: "ต้องบันทึกว่าจ่ายแล้วก่อน (วันที่จ่ายใช้เป็นวันที่ในหนังสือ)" };
  if (exp.whtCert) return { ok: false, reason: "ออกหนังสือแล้ว" };
  if (exp.payVoucher && !exp.payWtNo) return { ok: false, reason: "ใบสำคัญจ่าย " + exp.payVoucher + " ไม่มีเลขหนังสือหัก ณ ที่จ่าย (กลับรายการแล้วจ่ายใหม่)" };
  return { ok: true };
}
function issueWhtCertificate(expId, opts) {
  return Store.tx("issueWhtCert", () => {
    const u = Store.user();
    if (!(u && (u.role === "admin" || u.role === "accounting"))) Store.fail("เฉพาะผู้ดูแลระบบและฝ่ายบัญชีออกหนังสือรับรองหักภาษี ณ ที่จ่ายได้");
    const e = Store.find("expenses", expId);
    if (!e) Store.fail("ไม่พบรายการค่าใช้จ่าย " + expId);
    const c = whtCertCanIssue(e); if (!c.ok) Store.fail(c.reason);
    const row = String((opts && opts.incomeRow) || "5");
    if (!WHT_INCOME_ROWS[row]) Store.fail("ประเภทเงินได้ไม่ถูกต้อง");
    const note = String((opts && opts.incomeNote) || "").trim();
    if (WHT_NOTE_ROWS.includes(row) && !note) Store.fail("ประเภทเงินได้ที่เลือกต้องระบุรายละเอียด");
    const payee = payeeSnapshot(e);
    // จ่ายผ่านใบสำคัญจ่าย → ใช้เลขที่ออกตอนจ่าย (ไม่ออกเลขซ้ำ) · รายการเก่าที่ไม่มีใบสำคัญจ่าย → ออกเลขใหม่แบบเดิม
    const n = e.payWtNo ? { docNo: e.payWtNo, seq: null, counterKey: null } : Store.nextDocNo("WT", e.paidDate);
    const cert = {
      no: n.docNo, seq: n.seq, counterKey: n.counterKey, date: e.paidDate, base: e.amount, rate: e.whtRate, tax: whtAmount(e.amount, e.whtRate),
      form: payee.type === "individual" ? "pnd3" : "pnd53", incomeRow: row, incomeNote: note, payee, by: Store.userName(), at: Store.now(),
    };
    Store.update("expenses", expId, { whtCert: cert }, "id", "ออกหนังสือรับรองหัก ณ ที่จ่าย " + cert.no + " ภาษี " + cert.tax);
    return cert;
  });
}

// ---------- หน้ากระดาษ (จัดตามแบบฟอร์มตัวอย่าง) ----------
const WF = { b: "1px solid #0B1220", dot: "1px dotted #0B1220" };

function WhtTaxIdBoxes({ value }) {
  // 13 หลัก แบ่งกลุ่ม 1-4-5-2-1 มีขีดคั่นระหว่างกลุ่มเหมือนในแบบ
  const d = String(value || "").replace(/\D/g, "").slice(0, 13).padEnd(13, " ").split("");
  const groups = [[0, 1], [1, 5], [5, 10], [10, 12], [12, 13]];
  const box = { display: "inline-block", width: "calc(var(--u) * 1.284)", height: "calc(var(--u) * 1.582)", border: WF.b, textAlign: "center", lineHeight: "calc(var(--u) * 1.522)", fontSize: "calc(var(--u) * 0.985)", marginLeft: -1 };
  return (
    <span style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center" }}>
      {groups.map((g, gi) => (
        <React.Fragment key={gi}>
          {gi > 0 && <span style={{ display: "inline-block", width: "calc(var(--u) * 0.716)", borderTop: WF.b, margin: "0 0 0 1px" }}/>}
          <span style={{ display: "inline-flex", marginLeft: gi > 0 ? 1 : 0 }}>{d.slice(g[0], g[1]).map((c, i) => <span key={i} style={box}>{c.trim()}</span>)}</span>
        </React.Fragment>
      ))}
    </span>
  );
}
function WhtCheck({ on, size }) {
  const s = size || "calc(var(--u) * 1.075)";
  return <span style={{ display: "inline-block", width: s, height: s, border: WF.b, textAlign: "center", lineHeight: s, fontSize: "calc(var(--u) * 1.015)", fontWeight: 700, verticalAlign: "-calc(var(--u) * 0.209)", marginRight: "calc(var(--u) * 0.478)" }}>{on ? "✓" : ""}</span>;
}
// ช่องจำนวนเงิน: บาท | สตางค์ (แยกคอลัมน์สตางค์เหมือนในแบบ)
function WhtMoney({ v }) {
  if (v == null) return <span style={{ display: "flex", height: "100%" }}><span style={{ flex: 1 }}/><span style={{ width: "calc(var(--u) * 1.94)", borderLeft: WF.b }}/></span>;
  const n = Math.round(Math.abs(Number(v) || 0) * 100), b = Math.floor(n / 100), s = String(n % 100).padStart(2, "0");
  return (
    <span style={{ display: "flex", height: "100%" }}>
      <span style={{ flex: 1, textAlign: "right", paddingRight: "calc(var(--u) * 0.299)", alignSelf: "flex-end" }}>{b.toLocaleString("en-US")}</span>
      <span style={{ width: "calc(var(--u) * 1.94)", borderLeft: WF.b, textAlign: "left", paddingLeft: "calc(var(--u) * 0.239)", alignSelf: "flex-end" }}>.{s}</span>
    </span>
  );
}

function WhtCertPaper({ cert, draft }) {
  // cert = ที่ออกแล้ว · draft = ตัวอย่างก่อนออก ({ payee, base, rate, tax, date, incomeRow, incomeNote, form })
  const c = cert || draft;
  const co = window.COMPANY || {};
  const p = c.payee || {};
  const row = String(c.incomeRow);
  const hint = { fontSize: "calc(var(--u) * 0.746)", color: "#0B1220", marginLeft: "calc(var(--u) * 0.657)", lineHeight: 1.1 };
  const fill = { flex: 1, borderBottom: WF.dot, minHeight: "calc(var(--u) * 1.373)", paddingLeft: "calc(var(--u) * 0.299)" };
  const box = { border: WF.b, borderRadius: "calc(var(--u) * 0.657)", padding: "calc(var(--u) * 0.478) calc(var(--u) * 0.896) calc(var(--u) * 0.537)" };
  const flat = { border: WF.b, padding: "calc(var(--u) * 0.448) calc(var(--u) * 0.896)" };
  const colW = "1fr calc(var(--u) * 6.567) calc(var(--u) * 10.149) calc(var(--u) * 8.657)";
  const NameBlock = ({ nameVal, addrVal, taxVal }) => (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b style={{ fontSize: "calc(var(--u) * 1.075)" }}>{taxVal.title}</b>
        <span style={{ fontSize: "calc(var(--u) * 1)", whiteSpace: "nowrap" }}><b>เลขประจำตัวผู้เสียภาษีอากร (13หลัก)*</b> <WhtTaxIdBoxes value={taxVal.id}/></span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "calc(var(--u) * 0.896)", marginTop: "calc(var(--u) * 0.179)" }}>
        <b style={{ fontSize: "calc(var(--u) * 1.075)" }}>ชื่อ</b>
        <span style={fill}>{nameVal}</span>
        <b style={{ fontSize: "calc(var(--u) * 1)", whiteSpace: "nowrap" }}>เลขประจำตัวผู้เสียภาษีอากร</b>
        <WhtTaxIdBoxes value=""/>
      </div>
      <div style={hint}>(ให้ระบุว่าเป็น บุคคล นิติบุคคล บริษัท สมาคม หรือคณะบุคคล)</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "calc(var(--u) * 0.896)", marginTop: "calc(var(--u) * 0.119)" }}>
        <b style={{ fontSize: "calc(var(--u) * 1.075)" }}>ที่อยู่</b>
        <span style={fill}>{addrVal}</span>
      </div>
      <div style={hint}>(ให้ระบุ ชื่ออาคาร/หมู่บ้าน ห้องเลขที่ ชั้นที่ เลขที่ ตรอก/ซอย หมู่ที่ ถนน ตำบล/แขวง อำเภอ/เขต จังหวัด)</div>
    </>
  );
  const cellDot = { borderBottom: WF.dot, borderLeft: WF.b, padding: "0 calc(var(--u) * 0.299)", textAlign: "center" };
  return (
    <div className="wht-form" style={{ background: "white", color: "#0B1220", fontFamily: "var(--font-thai)", "--u": "2.65mm", fontSize: "var(--u)", lineHeight: 1.38 }}>
      <div style={{ fontSize: "calc(var(--u) * 0.955)", lineHeight: 1.45, marginBottom: "calc(var(--u) * 0.478)" }}>
        <div><b>ฉบับที่ 1</b> &nbsp;(สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)</div>
        <div><b>ฉบับที่ 2</b> &nbsp;(สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)</div>
      </div>

      <div style={{ border: "calc(var(--u) * 0.149) solid #0B1220", padding: "calc(var(--u) * 0.716) calc(var(--u) * 0.896) calc(var(--u) * 0.716)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1, textAlign: "center", paddingTop: "calc(var(--u) * 0.299)", marginLeft: "calc(var(--u) * 5.97)" }}>
            <div style={{ fontSize: "calc(var(--u) * 1.612)", fontWeight: 700, lineHeight: 1.25 }}>หนังสือรับรองการหักภาษี ณ ที่จ่าย</div>
            <div style={{ fontSize: "calc(var(--u) * 1.134)", marginTop: "calc(var(--u) * 0.299)" }}>ตามมาตรา 50 ทวิแห่งประมวลรัษฎากร</div>
          </div>
          <div style={{ width: "calc(var(--u) * 13.731)", fontSize: "calc(var(--u) * 1.134)", lineHeight: 1.8 }}>
            <div style={{ display: "flex" }}><span>เล่มที่ </span><span style={{ flex: 1, borderBottom: WF.dot, marginLeft: 2 }}/></div>
            <div style={{ display: "flex" }}><span>เลขที่ </span><span style={{ flex: 1, borderBottom: WF.dot, marginLeft: 2, textAlign: "center", fontWeight: 400 }}>{cert ? cert.no : "(ออกเมื่อบันทึก)"}</span></div>
          </div>
        </div>

        <div style={{ ...box, marginTop: "calc(var(--u) * 0.478)" }}>
          <NameBlock nameVal={co.nameTh || co.name || ""} addrVal={co.address || ""} taxVal={{ title: "ผู้มีหน้าที่หักภาษี ณ ที่จ่าย : -", id: co.taxId }}/>
        </div>

        <div style={{ ...box, marginTop: "calc(var(--u) * 0.418)" }}>
          <NameBlock nameVal={p.name || ""} addrVal={p.address || ""} taxVal={{ title: "ผู้ถูกหักภาษี ณ ที่จ่าย : -", id: p.taxId }}/>
          <div style={{ display: "flex", alignItems: "flex-start", marginTop: "calc(var(--u) * 0.358)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "calc(var(--u) * 0.597)", whiteSpace: "nowrap" }}>
              <b style={{ fontSize: "calc(var(--u) * 1.075)" }}>ลำดับที่</b><span style={{ display: "inline-block", width: "calc(var(--u) * 5.075)", height: "calc(var(--u) * 1.791)", border: WF.b }}/><span style={{ fontSize: "calc(var(--u) * 1.075)" }}>ในแบบ</span>
            </div>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1.25fr 0.9fr 1fr", rowGap: "calc(var(--u) * 0.448)", marginLeft: "calc(var(--u) * 1.194)", fontSize: "calc(var(--u) * 1.075)" }}>
              <span><WhtCheck on={false}/>(1) ภ.ง.ด.1ก</span><span><WhtCheck on={false}/>(2) ภ.ง.ด.1ก พิเศษ</span><span><WhtCheck on={false}/>(3) ภ.ง.ด.2</span><span><WhtCheck on={c.form === "pnd3"}/>(4) ภ.ง.ด.3</span>
              <span><WhtCheck on={false}/>(5) ภ.ง.ด.2ก</span><span><WhtCheck on={false}/>(6) ภ.ง.ด.3ก</span><span><WhtCheck on={c.form === "pnd53"}/>(7) ภ.ง.ด.53</span><span/>
            </div>
          </div>
          <div style={{ fontSize: "calc(var(--u) * 0.716)", lineHeight: 1.15, marginTop: "-calc(var(--u) * 0.896)", width: "calc(var(--u) * 11.343)" }}>(ให้สามารถอ้างอิงหรือสอบยันกันได้ระหว่างลำดับที่ตามหนังสือรับรองฯ กับแบบยื่นรายการภาษีหักที่จ่าย)</div>
        </div>

        <div style={{ border: WF.b, borderRadius: "calc(var(--u) * 0.657)", marginTop: "calc(var(--u) * 0.418)", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: colW, borderBottom: WF.b, textAlign: "center", fontWeight: 700, fontSize: "calc(var(--u) * 1.075)", lineHeight: 1.25 }}>
            <div style={{ padding: "calc(var(--u) * 0.657) 0", alignSelf: "center" }}>ประเภทเงินได้พึงประเมินจ่าย</div>
            <div style={{ borderLeft: WF.b, padding: "calc(var(--u) * 0.358) 0" }}>วัน เดือน<br/>หรือปีภาษี ที่จ่าย</div>
            <div style={{ borderLeft: WF.b, padding: "calc(var(--u) * 0.657) 0", alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "center" }}>จำนวนเงินที่จ่าย</div>
            <div style={{ borderLeft: WF.b, padding: "calc(var(--u) * 0.358) 0" }}>ภาษีที่หัก<br/>และนำส่งไว้</div>
          </div>
          {WHT_FORM_ROWS.map((r) => {
            const on = r.kind === "pay" && row === r.k;
            const pay = r.kind === "pay";
            return (
              <div key={r.k} style={{ display: "grid", gridTemplateColumns: colW, alignItems: "stretch", fontSize: r.k === "5" ? "calc(var(--u) * 0.985)" : "calc(var(--u) * 1.045)", lineHeight: 1.32 }}>
                <div style={{ padding: "calc(var(--u) * 0.149) calc(var(--u) * 0.448) calc(var(--u) * 0.149) " + "calc(var(--u) * " + ((1.8 + r.ind * 4.2) / 3.35) + ")", display: "flex", alignItems: "flex-end", gap: "calc(var(--u) * 0.299)" }}>
                  <span>{r.t}{r.note && <span style={{ display: "inline-block", minWidth: r.k === "6" ? "calc(var(--u) * 15.522)" : "calc(var(--u) * 8.955)", borderBottom: WF.dot, marginLeft: "calc(var(--u) * 0.448)", paddingLeft: "calc(var(--u) * 0.299)" }}>{on ? c.incomeNote : ""}</span>}{r.tail ? " " + r.tail : ""}</span>
                </div>
                {pay ? <>
                  <div style={cellDot}>{on ? fmtDate(c.date) : ""}</div>
                  <div style={{ ...cellDot, padding: 0 }}><WhtMoney v={on ? c.base : null}/></div>
                  <div style={{ ...cellDot, padding: 0 }}><WhtMoney v={on ? c.tax : null}/></div>
                </> : <><div/><div/><div/></>}
              </div>
            );
          })}
          <div style={{ display: "grid", gridTemplateColumns: colW, borderTop: WF.b, fontWeight: 700, fontSize: "calc(var(--u) * 1.075)" }}>
            <div style={{ padding: "calc(var(--u) * 0.418) calc(var(--u) * 0.896)", textAlign: "right" }}>รวมเงินที่จ่ายและภาษีที่หักนำส่ง</div>
            <div style={{ borderLeft: WF.b }}/>
            <div style={{ borderLeft: WF.b, borderBottom: WF.b }}><WhtMoney v={c.base}/></div>
            <div style={{ borderLeft: WF.b, borderBottom: WF.b }}><WhtMoney v={c.tax}/></div>
          </div>
          <div style={{ borderTop: WF.b, padding: "calc(var(--u) * 0.478) calc(var(--u) * 0.896)", fontSize: "calc(var(--u) * 1.075)" }}>
            <b>รวมเงินภาษีที่หักนำส่ง</b> (ตัวอักษร) &nbsp; ({bahtText(c.tax)})
          </div>
        </div>

        <div style={{ ...box, marginTop: "calc(var(--u) * 0.418)", fontSize: "calc(var(--u) * 0.985)" }}>
          <b>เงินที่จ่ายเข้า</b> &nbsp;กบข./กสจ./กองทุนสงเคราะห์ครูโรงเรียนเอกชน<span style={{ display: "inline-block", width: "calc(var(--u) * 6.567)", borderBottom: WF.dot, margin: "0 calc(var(--u) * 0.299)" }}/>บาท &nbsp; กองทุนประกันสังคม<span style={{ display: "inline-block", width: "calc(var(--u) * 5.373)", borderBottom: WF.dot, margin: "0 calc(var(--u) * 0.299)" }}/>บาท &nbsp; กองทุนสำรองเลี้ยงชีพ<span style={{ display: "inline-block", width: "calc(var(--u) * 4.776)", borderBottom: WF.dot, margin: "0 calc(var(--u) * 0.299)" }}/>บาท
        </div>

        <div style={{ ...box, marginTop: "calc(var(--u) * 0.418)", fontSize: "calc(var(--u) * 1.075)" }}>
          <b>ผู้ที่จ่ายเงิน</b> &nbsp; &nbsp;<WhtCheck on={true} size="calc(var(--u) * 1.313)"/>(1) หัก ณ ที่จ่าย &nbsp; <WhtCheck on={false} size="calc(var(--u) * 1.313)"/>(2) ออกให้ตลอดไป &nbsp; <WhtCheck on={false} size="calc(var(--u) * 1.313)"/>(3) ออกให้ครั้งเดียว &nbsp; <WhtCheck on={false} size="calc(var(--u) * 1.313)"/>(4) อื่นๆ (ระบุ)<span style={{ display: "inline-block", width: "calc(var(--u) * 10.746)", borderBottom: WF.dot, marginLeft: "calc(var(--u) * 0.448)" }}/>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "calc(var(--u) * 16.716) 1fr", gap: "calc(var(--u) * 0.418)", marginTop: "calc(var(--u) * 0.418)" }}>
          <div style={{ ...box, fontSize: "calc(var(--u) * 0.985)", lineHeight: 1.7, padding: "calc(var(--u) * 0.597) calc(var(--u) * 0.776)" }}>
            <b>คำเตือน</b>&nbsp; ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย ฝ่าฝืนไม่ปฏิบัติตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร ต้องรับโทษทางอาญาตามมาตรา 35 แห่งประมวลรัษฎากร
          </div>
          <div style={{ ...box, position: "relative", fontSize: "calc(var(--u) * 1.015)", minHeight: "calc(var(--u) * 14.03)", padding: "calc(var(--u) * 0.597) calc(var(--u) * 1.194)" }}>
            <div>ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ</div>
            <div style={{ position: "absolute", right: "calc(var(--u) * 1.791)", top: "calc(var(--u) * 3.284)", width: "calc(var(--u) * 5.672)", height: "calc(var(--u) * 5.672)", border: "calc(var(--u) * 0.09) solid #6B7488", borderRadius: "50%", fontSize: "calc(var(--u) * 0.776)", lineHeight: 1.25, textAlign: "center", color: "#0B1220", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <span>ประทับตรา</span><span>นิติบุคคล</span><span style={{ fontStyle: "italic" }}>(ถ้ามี)</span>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", marginTop: "calc(var(--u) * 6.567)" }}><span>ลงชื่อ</span><span style={{ flex: 1, borderBottom: WF.dot, margin: "0 calc(var(--u) * 0.299)" }}/><span>ผู้จ่ายเงิน</span></div>
            <div style={{ textAlign: "center", marginTop: "calc(var(--u) * 0.657)", lineHeight: 1.3 }}>
              {(() => { const d = String(fmtDate(c.date)).split("/"); const part = (t, w) => <span style={{ display: "inline-block", minWidth: w, borderBottom: WF.dot, textAlign: "center" }}>{t}</span>; return <span>{part(d[0], "calc(var(--u) * 2.687)")} / {part(d[1], "calc(var(--u) * 2.687)")} / {part(d[2], "calc(var(--u) * 3.881)")}</span>; })()}
              <div>(วัน เดือน ปี ที่ออกหนังสือรับรองฯ)</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ fontSize: "calc(var(--u) * 0.866)", marginTop: "calc(var(--u) * 0.597)", lineHeight: 1.5, display: "flex", gap: "calc(var(--u) * 0.896)" }}>
        <b style={{ whiteSpace: "nowrap" }}>หมายเหตุ</b>
        <div>
          <div>เลขประจำตัวผู้เสียภาษีอากร (13 หลัก)* หมายถึง 1. กรณีบุคคลธรรมดาไทย ให้ใช้เลขประจำตัวประชาชนของกรมการปกครอง</div>
          <div style={{ marginLeft: "calc(var(--u) * 2.985)" }}>2. กรณีนิติบุคคล ให้ใช้เลขทะเบียนนิติบุคคลของกรมพัฒนาธุรกิจการค้า</div>
          <div style={{ marginLeft: "calc(var(--u) * 2.985)" }}>3. กรณีอื่นๆ นอกเหนือจาก 1. และ 2. ให้ใช้เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) ของกรมสรรพากร</div>
        </div>
      </div>
    </div>
  );
}

// ---------- หน้าต่างออก / พิมพ์ ----------
function WhtIssueModal({ exp0, onClose }) {
  useStore();
  const exp = Store.state.expenses.find((x) => x.id === exp0.id) || exp0;
  const [row, setRow] = React.useState(exp.whtCert ? String(exp.whtCert.incomeRow) : "5");
  const [note, setNote] = React.useState(exp.whtCert ? exp.whtCert.incomeNote || "" : "");
  const [err, setErr] = React.useState("");
  const role = Store.user() ? Store.user().role : null;
  const canIssue = role === "admin" || role === "accounting";
  const cert = exp.whtCert || null;
  const can = whtCertCanIssue(exp);
  const payee = payeeSnapshot(exp);
  const draft = { payee, base: exp.amount, rate: exp.whtRate, tax: whtAmount(exp.amount, exp.whtRate), date: exp.paidDate || Store.today(), incomeRow: row, incomeNote: note, form: payee.type === "individual" ? "pnd3" : "pnd53" };
  const needNote = WHT_NOTE_ROWS.includes(row);
  const issue = () => {
    setErr("");
    try { const c = issueWhtCertificate(exp.id, { incomeRow: row, incomeNote: note }); notify("ออกหนังสือรับรองหัก ณ ที่จ่าย " + c.no + " แล้ว", "success"); }
    catch (e) { setErr(e && e.message ? e.message : String(e)); }
  };
  return (
    <ErpModal title={"หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) · " + exp.id} width={1000} onClose={onClose}
      footer={<>
        <button className="btn btn-outline btn-sm" onClick={onClose}>ปิด</button>
        {cert ? <button className="btn btn-primary btn-sm" onClick={() => printDoc(cert.no, { title: "หนังสือรับรองหัก ณ ที่จ่าย " + cert.no, pageMargin: "6mm 6mm 6mm 6mm", bare: true })}><I.Printer size={14}/> พิมพ์ / PDF (ฉบับที่ 1 + 2)</button>
          : <button className="btn btn-primary btn-sm" disabled={!canIssue || !can.ok} title={!canIssue ? "เฉพาะ admin / บัญชี" : can.ok ? "" : can.reason} onClick={issue}><I.Check size={14}/> ออกหนังสือ (ออกเลขที่)</button>}
      </>}>
      {!cert && (
        <div className="no-print" style={{ marginBottom: 10, fontSize: 12.5 }}>
          {!can.ok && <div style={{ color: "var(--amber)", marginBottom: 6 }}>ยังออกไม่ได้: {can.reason}</div>}
          {!payee.found && <div style={{ color: "var(--amber)", marginBottom: 6 }}>ไม่พบ "{exp.vendor}" ในทะเบียนผู้ขาย — ไม่มีเลขผู้เสียภาษีและที่อยู่ในหนังสือ (ควรเพิ่มผู้ขายก่อนออก)</div>}
          {payee.found && !payee.taxId && <div style={{ color: "var(--amber)", marginBottom: 6 }}>ผู้ขายนี้ยังไม่มีเลขประจำตัวผู้เสียภาษี — กรอกในทะเบียนผู้ขายก่อนออกหนังสือ</div>}
          <label style={{ fontSize: 12, color: "var(--text-secondary)", marginRight: 8 }}>ประเภทเงินได้</label>
          <select className="select" style={{ width: 560, maxWidth: "100%", display: "inline-block" }} value={row} onChange={(e) => setRow(e.target.value)}>
            {WHT_FORM_ROWS.filter((r) => r.kind === "pay").map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}
          </select>
          {needNote && <input className="input" style={{ width: 260, marginLeft: 8, display: "inline-block" }} placeholder="ระบุรายละเอียด" value={note} onChange={(e) => setNote(e.target.value)}/>}
          <div style={{ marginTop: 6, color: "var(--text-tertiary)" }}>แบบที่ยื่น: {payee.type === "individual" ? "ภ.ง.ด.3 (บุคคลธรรมดา)" : "ภ.ง.ด.53 (นิติบุคคล)"} — เลือกประเภทผู้รับเงินในทะเบียนผู้ขาย</div>
          {err && <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "var(--danger-subtle, #fee2e2)", color: "var(--danger)" }}>{err}</div>}
        </div>
      )}
      {cert && <div className="no-print" style={{ marginBottom: 10, fontSize: 12.5, color: "var(--success)" }}>ออกแล้ว: {cert.no} · วันที่ {fmtDate(cert.date)} · ภาษี {_fmt(cert.tax, 2)} บาท · โดย {cert.by} (ออกแล้วแก้ไขไม่ได้ พิมพ์ซ้ำได้)</div>}
      <div className="print-area-wrap" style={{ overflowX: "auto", background: "var(--bg)", padding: 8 }}>
        <div className="print-area" data-copies="2" style={{ width: "210mm", padding: "6mm 8mm", boxSizing: "border-box", background: "white", margin: "0 auto" }}><WhtCertPaper cert={cert} draft={draft}/></div>
      </div>
    </ErpModal>
  );
}

Object.assign(window, { bahtText, whtCertCanIssue, issueWhtCertificate, WhtIssueModal, WhtCertPaper, WHT_INCOME_ROWS, WHT_FORM_ROWS });
