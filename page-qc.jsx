/* global React, I, QC_INSPECTIONS, QC_RESULT, DEFECT_TYPES, PageHeader, Tabs, Drawer, _fmt, Store, useStore, runAction, exportCSV, ErpModal */

function PageQC() {
  const [tab, setTab] = useState("INSPECT");
  const [open, setOpen] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  useStore();

  const total = QC_INSPECTIONS.length;
  const passed = QC_INSPECTIONS.filter((q) => q.result === "pass").length;
  const rework = QC_INSPECTIONS.filter((q) => q.result === "rework").length;
  const failed = QC_INSPECTIONS.filter((q) => q.result === "fail").length;
  const passRate = total ? Math.round((passed / total) * 100) : 0;
  // บันทึก QC: ค้นหา (เลขที่/สินค้า/ใบสั่งผลิต/ผู้ตรวจ/defect) · ผลตรวจ · ช่วงวันที่ · เรียง · แบ่งหน้า
  const [qcResult, setQcResult] = useState("ALL");
  const view = useListView(QC_INSPECTIONS, {
    text: (q) => [q.id, q.product, q.wo, q.inspector, (q.defects || []).map((d) => d.type).join(" "), (QC_RESULT[q.result] || {}).th].join(" "),
    dateKey: (q) => q.date, dateLabel: "วันที่ตรวจ",
    filter: (q) => qcResult === "ALL" || q.result === qcResult, filterKey: qcResult,
    defaultSort: { key: "date", dir: "desc" },
    sorts: { id: (q) => q.id, date: (q) => q.date, product: (q) => q.product, inspector: (q) => q.inspector, sample: (q) => q.sampleSize || 0, failed: (q) => (q.sampleSize ? q.failed / q.sampleSize : 0), result: (q) => (QC_RESULT[q.result] || {}).th || q.result },
  });

  return (
    <>
      <PageHeader
        title="ตรวจคุณภาพ (QC)"
        subtitle="ตรวจสอบสินค้าก่อนส่งมอบ · บันทึก defect · ติดตามคุณภาพ"
        actions={
          <>
            <button className="btn btn-outline btn-sm" onClick={() => printReport("รายงานตรวจสอบคุณภาพ (QC)")}><I.Printer size={14}/> พิมพ์ / PDF</button>
            <button className="btn btn-outline btn-sm" disabled={!total} onClick={() => exportCSV(`QC-${Store.today()}.csv`, ["เลขที่", "วันที่", "ใบสั่งผลิต", "สินค้า", "ผู้ตรวจ", "ตัวอย่าง", "ผ่าน", "เสีย", "Defects", "ผล"], view.sorted.map((q) => [q.id, q.date, q.wo, q.product, q.inspector, q.sampleSize, q.passed, q.failed, q.defects.map((d) => d.type + "x" + d.count).join(" "), QC_RESULT[q.result].th]))}><I.Download size={14}/> รายงาน QC (CSV)</button>
            <button className="btn btn-primary btn-sm" onClick={() => setFormOpen(true)}><I.Plus size={14}/> บันทึก QC ใหม่</button>
          </>
        }
      />

      <div className="grid-4" style={{ marginBottom: 14 }}>
        <KPI icon="Check" tone="success" label="Pass Rate" value={passRate + "%"} foot={`${passed}/${total} ครั้ง`}/>
        <KPI icon="Alert" tone="amber" label="ต้องแก้ไข" value={rework} unit="ครั้ง" foot="Rework"/>
        <KPI icon="X" tone="danger" label="ไม่ผ่าน" value={failed} unit="ครั้ง" foot="Fail"/>
        <KPI icon="FileText" tone="accent" label="ตรวจรวม" value={total} unit="ครั้ง" foot="ทั้งหมด"/>
      </div>

      <Tabs
        items={[
          { id: "INSPECT", label: "บันทึกการตรวจ", count: QC_INSPECTIONS.length },
          { id: "DEFECTS", label: "ประเภท Defect", count: DEFECT_TYPES.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "INSPECT" && (
        <div className="card">
          <ListToolbar view={view} placeholder="เลขที่ / สินค้า / ใบสั่งผลิต / ผู้ตรวจ / Defect…">
            <select className="select" style={{ width: 140 }} value={qcResult} onChange={(e) => setQcResult(e.target.value)}>
            <option value="ALL">ทุกผลตรวจ</option>{Object.keys(QC_RESULT).map((k) => <option key={k} value={k}>{QC_RESULT[k].th}</option>)}
          </select>
          </ListToolbar>
          <table className="table">
            <thead>
              <tr>
                <SortTh view={view} k="id">เลขที่</SortTh>
                <SortTh view={view} k="date">วันที่ตรวจ</SortTh>
                <SortTh view={view} k="product">WO / สินค้า</SortTh>
                <SortTh view={view} k="inspector">ผู้ตรวจ</SortTh>
                <SortTh view={view} k="sample" className="num">Sample</SortTh>
                <SortTh view={view} k="failed">ผ่าน / ไม่ผ่าน</SortTh>
                <th>Defects</th>
                <SortTh view={view} k="result">ผล</SortTh>
              </tr>
            </thead>
            <tbody>
              {view.pageRows.map((q) => {
                const meta = QC_RESULT[q.result];
                const failRate = (q.failed / q.sampleSize) * 100;
                return (
                  <tr key={q.id} onClick={() => setOpen(q)} style={{ cursor: "pointer" }}>
                    <td className="mono"><b>{q.id}</b></td>
                    <td className="num" style={{ fontSize: 12 }}>{q.date}</td>
                    <td>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{q.product}</div>
                      <div className="mono" style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{q.wo}</div>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{q.inspector}</td>
                    <td className="num">{q.sampleSize}</td>
                    <td className="num">
                      <span style={{ color: "var(--success)" }}>{q.passed}</span>
                      <span style={{ color: "var(--text-tertiary)", margin: "0 4px" }}>/</span>
                      <span style={{ color: failRate > 5 ? "var(--danger)" : failRate > 2 ? "var(--amber)" : "var(--text-secondary)", fontWeight: failRate > 2 ? 500 : 400 }}>{q.failed}</span>
                      <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: 6 }}>({_fmt(failRate, 1)}%)</span>
                    </td>
                    <td>
                      {q.defects.length === 0
                        ? <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>—</span>
                        : q.defects.map((d, i) => <span key={i} className="badge badge-warning" style={{ marginRight: 3 }}>{d.type} ×{d.count}</span>)
                      }
                    </td>
                    <td><span className={"badge badge-" + meta.color}><span className="b-dot"/>{meta.th}</span></td>
                  </tr>
                );
              })}
              {!view.total && <EmptyRow cols={8} text={QC_INSPECTIONS.length ? "ไม่พบบันทึก QC ตามเงื่อนไข" : "ยังไม่มีบันทึก QC — กด “บันทึก QC ใหม่”"}/>}
            </tbody>
          </table>
          <Pager view={view}/>
        </div>
      )}

      {tab === "DEFECTS" && (
        <div className="grid-2">
          {DEFECT_TYPES.map((d) => {
            const count = QC_INSPECTIONS.reduce((s, q) => s + (q.defects.find((x) => x.type === d.name)?.count || 0), 0);
            return (
              <div key={d.name} className="card" style={{ padding: 16, display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: count > 3 ? "var(--danger-subtle)" : count > 0 ? "var(--amber-subtle)" : "var(--bg-subtle)", color: count > 3 ? "var(--danger)" : count > 0 ? "var(--amber)" : "var(--text-secondary)", display: "grid", placeItems: "center" }}>
                  <I.Alert size={20}/>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{d.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{d.desc}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="num" style={{ fontSize: 18, fontWeight: 700, color: count > 3 ? "var(--danger)" : count > 0 ? "var(--amber)" : "var(--text-tertiary)" }}>{count}</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>ชิ้น (รวมทั้งหมด)</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {formOpen && <QCForm onClose={() => setFormOpen(false)}/>}
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? `บันทึก QC · ${open.id}` : ""} width={640}
        footer={open && <button className="btn btn-outline btn-sm" onClick={() => printDoc(open.id)}><I.Printer size={13}/> พิมพ์ใบตรวจ QC</button>}>
        {open && <div className="print-area" style={{ background: "var(--bg-elevated)" }}><div style={{ padding: "0 20px" }}><PrintHead title="ใบรายงานผลตรวจสอบคุณภาพ" en="QC Inspection Report" no={open.id} date={open.date}/></div><QCDetail q={open}/></div>}
      </Drawer>
    </>
  );
}

// บันทึกผลตรวจ QC จริง (เชื่อมกับใบสั่งผลิต)
function QCForm({ onClose }) {
  const wos = Store.state.workOrders.filter((w) => w.produced > 0 && w.status !== "cancelled");
  const [wo, setWo] = useState(wos[0] ? wos[0].id : "");
  const [sample, setSample] = useState(50);
  const [counts, setCounts] = useState({});
  const [note, setNote] = useState("");
  const failed = Object.values(counts).reduce((s, n) => s + (Number(n) || 0), 0);
  const rate = sample > 0 ? failed / sample * 100 : 0;
  const auto = rate > 5 ? "fail" : rate > 2 ? "rework" : "pass";
  const [result, setResult] = useState(null);
  function save() {
    const w = wos.find((x) => x.id === wo);
    const ok = runAction(() => {
      if (!w) Store.fail("กรุณาเลือกใบสั่งผลิต");
      if (!(Number(sample) > 0)) Store.fail("จำนวนตัวอย่างต้องมากกว่า 0");
      if (failed > Number(sample)) Store.fail("จำนวนของเสียมากกว่าจำนวนตัวอย่าง");
      const n = Store.nextDocNo("QC");
      const rec = { id: n.docNo, seq: n.seq, counterKey: n.counterKey, date: Store.today(), wo: w.id, product: w.product, inspector: Store.userName(),
        sampleSize: Number(sample), passed: Number(sample) - failed, failed,
        defects: Object.entries(counts).filter(([, c]) => Number(c) > 0).map(([type, c]) => ({ type, count: Number(c) })),
        result: result || auto, note };
      Store.add("qc", rec, `${w.id} ผล ${QC_RESULT[rec.result].th} (เสีย ${failed}/${sample})`);
      return rec;
    }, (r) => `บันทึก QC ${r.id} แล้ว`);
    if (ok) onClose();
  }
  return (
    <ErpModal title="บันทึกผลตรวจคุณภาพ" width={620} onClose={onClose}
      footer={<><button className="btn btn-outline btn-sm" onClick={onClose}>ยกเลิก</button><button className="btn btn-primary btn-sm" disabled={!wo} onClick={save}><I.Check size={14}/> บันทึก</button></>}>
      {!wos.length && <div style={{ color: "var(--amber)", fontSize: 13, marginBottom: 10 }}>ยังไม่มีใบสั่งผลิตที่บันทึกการผลิตแล้ว</div>}
      <div className="grid-2" style={{ gap: 12 }}>
        <div><label className="field-label">ใบสั่งผลิต</label><select className="input" value={wo} onChange={(e) => setWo(e.target.value)}>{wos.map((w) => <option key={w.id} value={w.id}>{w.id} · {w.product}</option>)}</select></div>
        <div><label className="field-label">จำนวนตัวอย่าง (ชิ้น)</label><input className="input num" type="number" min="1" value={sample} onChange={(e) => setSample(e.target.value)}/></div>
      </div>
      <div style={{ fontWeight: 600, fontSize: 13, margin: "14px 0 6px" }}>จำนวนของเสียตามประเภท</div>
      <div className="grid-2" style={{ gap: 8 }}>
        {DEFECT_TYPES.map((d) => (
          <label key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <span style={{ flex: 1 }}>{d.name}</span>
            <input className="input input-sm num" type="number" min="0" style={{ width: 80, textAlign: "right" }} value={counts[d.name] || ""} onChange={(e) => setCounts({ ...counts, [d.name]: e.target.value })}/>
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14 }}>
        <span style={{ fontSize: 13 }}>เสีย {failed}/{sample} ({_fmt(rate, 1)}%) → ระบบประเมิน: <b>{QC_RESULT[auto].th}</b></span>
        <select className="input" style={{ width: 160 }} aria-label="ผลการตรวจ" value={result || auto} onChange={(e) => setResult(e.target.value)}>{Object.entries(QC_RESULT).map(([k, v]) => <option key={k} value={k}>{v.th}</option>)}</select>
      </div>
      <label className="field-label" style={{ marginTop: 12 }}>หมายเหตุ</label>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)}/>
    </ErpModal>
  );
}

function QCDetail({ q }) {
  const meta = QC_RESULT[q.result];
  const passRate = (q.passed / q.sampleSize) * 100;
  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, background: "var(--bg-subtle)", borderRadius: 12, marginBottom: 16 }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: meta.color === "success" ? "var(--success-subtle)" : meta.color === "danger" ? "var(--danger-subtle)" : "var(--amber-subtle)", color: meta.color === "success" ? "var(--success)" : meta.color === "danger" ? "var(--danger)" : "var(--amber)", display: "grid", placeItems: "center" }}>
          <I.Check size={22}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{q.product}</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{q.wo} · ตรวจโดย {q.inspector}</div>
        </div>
        <span className={"badge badge-" + meta.color} style={{ fontSize: 13, padding: "5px 12px" }}>{meta.th}</span>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <KV k="วันที่ตรวจ" v={q.date}/>
        <KV k="Pass Rate" v={_fmt(passRate, 1) + "%"}/>
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Mini k="Sample" v={q.sampleSize}/>
        <Mini k="ผ่าน" v={q.passed} tone="success"/>
        <Mini k="ไม่ผ่าน" v={q.failed} tone="danger"/>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><div className="card-title">รายละเอียด Defect</div></div>
        <div style={{ padding: 18 }}>
          {q.defects.length === 0 && <div style={{ color: "var(--text-tertiary)", textAlign: "center", padding: 16, fontSize: 13 }}>✓ ไม่พบข้อบกพร่อง</div>}
          {q.defects.map((d, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: i < q.defects.length - 1 ? "1px solid var(--border)" : "none" }}>
              <I.Alert size={16} style={{ color: "var(--amber)", marginRight: 10 }}/>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{d.type}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{DEFECT_TYPES.find((x) => x.name === d.type)?.desc}</div>
              </div>
              <div className="num" style={{ fontWeight: 600, fontSize: 14 }}>×{d.count}</div>
            </div>
          ))}
        </div>
      </div>

      {q.note && (
        <div style={{ padding: 12, background: "var(--bg-subtle)", borderRadius: 10, fontSize: 13 }}>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>หมายเหตุ</div>
          {q.note}
        </div>
      )}
    </div>
  );
}

function KPI({ icon, tone, label, value, unit, foot }) {
  const Ico = I[icon] || I.Check;
  const c = ({ success: { c:"var(--success)", b:"var(--success-subtle)" }, accent: { c:"var(--accent)", b:"var(--accent-subtle)" }, amber: { c:"var(--amber)", b:"var(--amber-subtle)" }, danger: { c:"var(--danger)", b:"var(--danger-subtle)" } })[tone];
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="kpi-label"><span className="kpi-ico" style={{ background: c.b, color: c.c }}><Ico size={14}/></span>{label}</div>
      <div className="kpi-value">{value}{unit && <span className="kpi-unit"> {unit}</span>}</div>
      <div className="kpi-foot" style={{ marginTop: 6 }}>{foot}</div>
    </div>
  );
}
function KV({ k, v }) { return <div><div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{k}</div><div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{v}</div></div>; }
function Mini({ k, v, tone }) {
  const c = tone === "success" ? "var(--success)" : tone === "danger" ? "var(--danger)" : "var(--text-primary)";
  return <div style={{ background: "var(--bg-subtle)", borderRadius: 10, padding: 12 }}>
    <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{k}</div>
    <div className="num" style={{ fontSize: 18, fontWeight: 700, marginTop: 2, color: c }}>{v}</div>
  </div>;
}

window.PageQC = PageQC;
