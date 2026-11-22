/* global React, I */
const { useState, useEffect, useMemo, useRef } = React;

// --- Sidebar ---
const NAV = [
  { section: "ภาพรวม" },
  { id: "dashboard", label: "แดชบอร์ด", icon: "Dashboard" },
  { section: "งานขาย" },
  { id: "sales", label: "เอกสารขาย", icon: "FileText" },
  { id: "customer-po", label: "ใบ PO ลูกค้า", icon: "Upload" },
  { id: "customers", label: "ลูกค้า", icon: "Users" },
  { section: "งานผลิต" },
  { id: "production", label: "ใบสั่งผลิต", icon: "Factory" },
  { id: "molds", label: "แม่พิมพ์", icon: "Mold" },
  { id: "qc", label: "ตรวจคุณภาพ", icon: "Check" },
  { section: "คลังสินค้า" },
  { id: "inventory", label: "สต๊อก / BOM", icon: "Boxes" },
  { section: "จัดซื้อ" },
  { id: "procurement", label: "ใบสั่งซื้อ / Supplier", icon: "Truck" },
  { section: "การจัดส่ง" },
  { id: "shipping", label: "การจัดส่งสินค้า", icon: "Truck" },
  { section: "การเงิน", grp: "fin" },
  { id: "fin-approvals", label: "รออนุมัติ", icon: "Check", grp: "fin" },
  { sub: "รายรับ", grp: "fin" },
  { id: "fin-rc-wait", label: "ใบเสร็จรอเก็บเงิน", icon: "Wallet", grp: "fin" },
  { id: "fin-receipts", label: "รับเงินลูกค้า", icon: "Wallet", grp: "fin" },
  { sub: "รายจ่าย", grp: "fin" },
  { id: "accounting", label: "บัญชี / ภพ.30 (ค่าใช้จ่าย)", icon: "Wallet", grp: "fin" },
  { id: "fin-payments", label: "จ่ายเงิน (ใบสำคัญจ่าย)", icon: "Wallet", grp: "fin" },
  { id: "fin-wht", label: "ภาษีหัก ณ ที่จ่าย (ค่าใช้จ่าย)", icon: "Wallet", grp: "fin" },
  { id: "fin-pp36", label: "ภ.พ.36 (ผู้ขายต่างประเทศ)", icon: "FileText", grp: "fin" },
  { sub: "เงินและบัญชี", grp: "fin" },
  { id: "fin-other", label: "รับ/จ่าย/โอนอื่น ๆ", icon: "Wallet", grp: "fin" },
  { id: "fin-ledger", label: "สมุดเงิน", icon: "Wallet", grp: "fin" },
  { id: "fin-recon", label: "กระทบยอดธนาคาร", icon: "Wallet", grp: "fin" },
  { id: "finance", label: "บัญชีเงิน", icon: "Wallet", grp: "fin" },
  { id: "fin-settings", label: "ตั้งค่าการเงิน", icon: "Settings", grp: "fin" },
  { section: "บุคคล" },
  { id: "hr", label: "พนักงาน", icon: "Badge" },
  { section: "วิเคราะห์" },
  { id: "reports", label: "รายงาน", icon: "BarChart" },
  { section: "เอกสารระบบ" },
  { id: "docs", label: "Database / API", icon: "Database" },
  { id: "audit", label: "Log การใช้งาน", icon: "GitBranch" },
  { id: "users", label: "จัดการผู้ใช้", icon: "Users" },
  { id: "settings", label: "ตั้งค่า", icon: "Settings" },
];

function Sidebar({ active, onNav, role, open }) {
  useStore();
  // กลุ่ม "การเงิน" พับเก็บได้ (จำค่าไว้ในเครื่อง) · ตัวเลขรออนุมัติรวมทุกเอกสารการเงินจากเซิร์ฟเวอร์
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("erp.nav.fin.collapsed") === "1"; } catch (e) { return false; } });
  const [finPend, setFinPend] = useState(0);
  const toggleFin = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem("erp.nav.fin.collapsed", n ? "1" : "0"); } catch (e) { /* ignore */ } return n; });
  useEffect(() => { if (NAV.some((x) => x.grp === "fin" && x.id === active)) setCollapsed(false); }, [active]);
  const canFin = !role || role.pages === "*" || (role.pages || []).includes("fin-approvals");
  useEffect(() => {
    if (!canFin || !window.Store || !Store.finApi) return undefined;
    let live = true;
    const load = () => Promise.all([Store.finApi("GET", "/summary"), Store.finApi("GET", "/receipts/summary"), Store.finApi("GET", "/payments/summary")])
      .then(([a, b, c]) => { if (live) setFinPend((a.pendingCount || 0) + (b.pendingCount || 0) + (c.pendingCount || 0)); }).catch(() => {});
    load();
    window.addEventListener("fin-changed", load);
    return () => { live = false; window.removeEventListener("fin-changed", load); };
  }, [active, canFin]);
  const allowed = !role || role.pages === "*"
    ? null
    : new Set(role.pages);
  const items = NAV.filter((item) => {
    if (item.section || item.sub || !allowed) return true;
    return allowed.has(item.id);
  });
  // also skip section/sub headers that have no following items
  const isHead = (x) => x.section || x.sub;
  const filtered = items.filter((item, i) => {
    if (!isHead(item)) return !(item.grp === "fin" && collapsed && active !== item.id);
    const next = items.slice(i + 1).find((x) => !isHead(x));
    const nextHead = items.slice(i + 1).find((x) => isHead(x) && (item.section || x.section || x.sub));
    if (!next) return false;
    if (nextHead && items.indexOf(nextHead) < items.indexOf(next)) return false;
    if (item.sub && collapsed) return false;
    return true;
  });

  return (
    <aside className={"sidebar" + (open ? " open" : "")}>
      <div className="sidebar-brand">
        <img src="assets/polymate-logo.png" alt="PolyMate" style={{ width: 38, height: 38, objectFit: "contain", flexShrink: 0 }}/>
        <div style={{ minWidth: 0 }}>
          <div className="brand-name">PolyMate</div>
          <div className="brand-sub">Your Plastic Partner</div>
        </div>
      </div>
      <nav className="sidebar-nav">
        {filtered.map((item, idx) => {
          if (item.section && item.grp === "fin") return <div className="sidebar-section" key={"s" + idx} onClick={toggleFin} style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }} title="กดเพื่อพับ/ขยายเมนูการเงิน"><span>{item.section}</span><span style={{ fontSize: 10, opacity: 0.7 }}>{collapsed ? "▸" : "▾"}</span></div>;
          if (item.section) return <div className="sidebar-section" key={"s" + idx}>{item.section}</div>;
          if (item.sub) return <div key={"u" + idx} style={{ fontSize: 10.5, color: "var(--text-tertiary)", padding: "8px 14px 2px 38px", letterSpacing: 0.3 }}>{item.sub}</div>;
          const Ico = I[item.icon] || I.Dashboard;
          return (
            <div
              key={item.id}
              className={"sidebar-item" + (active === item.id ? " active" : "") + (item.alert ? " alert" : "")}
              onClick={() => onNav(item.id)}
            >
              <Ico className="si-ico" />
              <span>{item.label}</span>
              {(() => { const n = item.id === "fin-approvals" ? (finPend ? { v: finPend, alert: true } : null) : window.navCount(item.id); return n ? <span className={"si-count" + (n.alert ? " alert" : "")}>{n.v}</span> : null; })()}
            </div>
          );
        })}
      </nav>
      <div className="sidebar-user">
        <div className="user-avatar" style={role ? { background: `linear-gradient(135deg, ${role.color}, ${role.color}cc)` } : null}>
          {role ? role.user.initial : "สม"}
        </div>
        <div className="user-meta">
          <div className="user-name">{role ? role.user.name : "สมชาย ใจดี"}</div>
          <div className="user-role">{role ? role.user.title + " · " + role.shortLabel : "Admin"}</div>
        </div>
        <I.More size={16} style={{ color: "#8B93A4" }} />
      </div>
    </aside>
  );
}

// --- Topbar ---
function Topbar({ onMenu, crumb, theme, onToggleTheme, role, allRoles, onChangeRole, onLogout, onNav }) {
  useStore();
  const notes = window.buildNotifications(role);
  const [pwOpen, setPwOpen] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  return (
    <header className="topbar">
      <button type="button" className="menu-btn" aria-label="เมนู" onClick={onMenu}><I.Menu size={20}/></button>
      <div className="crumb">
        {crumb.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <I.ChevronRight size={13} className="crumb-sep" />}
            {i === crumb.length - 1 ? <b>{c}</b> : <span>{c}</span>}
          </React.Fragment>
        ))}
      </div>
      <GlobalSearch onNav={onNav} role={role}/>
      <div className="topbar-actions">
        {/* Role switcher */}
        {role && allRoles && (
          <div style={{ position: "relative", marginRight: 6 }}>
            <button
              onClick={() => setRolesOpen((v) => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 10px 5px 6px", borderRadius: 8,
                border: "1px solid var(--border)", background: "var(--bg-elevated)",
                cursor: "pointer", fontSize: 12.5,
              }}
            >
              <span style={{
                width: 22, height: 22, borderRadius: 99,
                background: `linear-gradient(135deg, ${role.color}, ${role.color}cc)`,
                color: "white", display: "grid", placeItems: "center",
                fontSize: 10, fontWeight: 600,
              }}>{role.user.initial}</span>
              <span style={{ fontWeight: 500 }}>{role.shortLabel}</span>
              <I.ChevronDown size={12} style={{ color: "var(--text-tertiary)" }}/>
            </button>
            {rolesOpen && (
              <>
                <div onClick={() => setRolesOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50 }}/>
                <div style={{
                  position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 51,
                  background: "var(--bg-elevated)", border: "1px solid var(--border)",
                  borderRadius: 12, boxShadow: "var(--shadow-popover)",
                  width: 320, padding: 6, overflow: "hidden",
                }}>
                  <div style={{ padding: "8px 10px 6px", fontSize: 10.5, color: "var(--text-tertiary)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>
                    สลับมุมมองสิทธิ์การใช้งาน
                  </div>
                  {Object.entries(allRoles).map(([key, r]) => (
                    <div key={key}
                      onClick={() => { onChangeRole(key); setRolesOpen(false); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                        background: role.shortLabel === r.shortLabel ? "var(--bg-subtle)" : "transparent",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-subtle)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = role.shortLabel === r.shortLabel ? "var(--bg-subtle)" : "transparent"}
                    >
                      <span style={{
                        width: 32, height: 32, borderRadius: 99,
                        background: `linear-gradient(135deg, ${r.color}, ${r.color}cc)`,
                        color: "white", display: "grid", placeItems: "center",
                        fontWeight: 600, fontSize: 12,
                      }}>{r.user.initial}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                          {r.label}
                          {role.shortLabel === r.shortLabel && <I.Check size={13} style={{ color: "var(--success)" }}/>}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.description}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <button className="icon-btn" title="สลับธีม" onClick={onToggleTheme}>
          {theme === "dark" ? <I.Sun size={17} /> : <I.Moon size={17} />}
        </button>

        {/* Notifications */}
        <div style={{ position: "relative" }}>
          <button className="icon-btn" title="การแจ้งเตือน" onClick={() => setNotifOpen((v) => !v)}>
            <I.Bell size={17} />
            {notes.length > 0 && <span className="dot" />}
          </button>
          {notifOpen && (
            <>
              <div onClick={() => setNotifOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50 }}/>
              <div style={{
                position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 51,
                background: "var(--bg-elevated)", border: "1px solid var(--border)",
                borderRadius: 12, boxShadow: "var(--shadow-popover)",
                width: 380, overflow: "hidden",
              }}>
                <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center" }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>การแจ้งเตือน</div>
                  <span className="spacer"/>
                  <span className="badge badge-neutral">{notes.length}</span>
                </div>
                <div style={{ maxHeight: 420, overflowY: "auto" }}>
                  {!notes.length && <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--text-tertiary)" }}>ไม่มีรายการที่ต้องดำเนินการ</div>}
                  {notes.map((n) => {
                    const Ico = I[n.icon] || I.Bell;
                    const tone = ({
                      alert: { c: "var(--danger)", b: "var(--danger-subtle)" },
                      warning: { c: "var(--amber)", b: "var(--amber-subtle)" },
                      info: { c: "var(--accent)", b: "var(--accent-subtle)" },
                      success: { c: "var(--success)", b: "var(--success-subtle)" },
                    })[n.kind];
                    return (
                      <div key={n.id} style={{ display: "flex", gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                        onClick={() => { setNotifOpen(false); onNav && onNav(n.page, n.focus); }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-subtle)"}
                        onMouseLeave={(e) => e.currentTarget.style.background = ""}
                      >
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: tone.b, color: tone.c, display: "grid", placeItems: "center", flexShrink: 0 }}>
                          <Ico size={15}/>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, lineHeight: 1.45 }}>{n.title}</div>
                          <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 3 }}>{n.time}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Profile */}
        <div style={{ position: "relative" }}>
          <button className="icon-btn" title="โปรไฟล์" onClick={() => setProfileOpen((v) => !v)}>
            <span style={{
              width: 26, height: 26, borderRadius: 99,
              background: `linear-gradient(135deg, ${role.color}, ${role.color}cc)`,
              color: "white", display: "grid", placeItems: "center",
              fontSize: 11, fontWeight: 600,
            }}>{role.user.initial}</span>
          </button>
          {profileOpen && (
            <>
              <div onClick={() => setProfileOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50 }}/>
              <div style={{
                position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 51,
                background: "var(--bg-elevated)", border: "1px solid var(--border)",
                borderRadius: 12, boxShadow: "var(--shadow-popover)",
                width: 260, padding: 6,
              }}>
                <div style={{ padding: "12px 12px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--border)", marginBottom: 6 }}>
                  <span style={{
                    width: 40, height: 40, borderRadius: 99,
                    background: `linear-gradient(135deg, ${role.color}, ${role.color}cc)`,
                    color: "white", display: "grid", placeItems: "center",
                    fontWeight: 600, fontSize: 14,
                  }}>{role.user.initial}</span>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{role.user.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{role.user.title}</div>
                  </div>
                </div>
                <ProfileItem icon="Settings" label="เปลี่ยนรหัสผ่าน" onClick={() => { setProfileOpen(false); setPwOpen(true); }}/>
                <ProfileItem icon="Edit" label="ลายเซ็นของฉัน" onClick={() => { setProfileOpen(false); setSigOpen(true); }}/>
                {role.pages === "*" && <ProfileItem icon="GitBranch" label="ดู Log การใช้งาน" onClick={() => { setProfileOpen(false); onNav && onNav("audit"); }}/>}
                <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }}/>
                <ProfileItem icon="X" label="ออกจากระบบ" danger onClick={() => { setProfileOpen(false); onLogout?.(); }}/>
              </div>
            </>
          )}
        </div>
      </div>
      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)}/>}
      {sigOpen && <SignatureModal onClose={() => setSigOpen(false)}/>}
    </header>
  );
}

function ProfileItem({ icon, label, danger, onClick }) {
  const Ico = I[icon] || I.Settings;
  return (
    <div onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 10px", borderRadius: 8, cursor: "pointer",
      fontSize: 13, color: danger ? "var(--danger)" : "var(--text-primary)",
    }}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-subtle)"}
      onMouseLeave={(e) => e.currentTarget.style.background = ""}
    >
      <Ico size={15} style={{ opacity: 0.8 }}/>
      <span>{label}</span>
    </div>
  );
}

// --- Page header ---
function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-h">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="ph-actions">{actions}</div>
    </div>
  );
}

// --- Tabs ---
function Tabs({ items, value, onChange }) {
  return (
    <div className="tabs">
      {items.map((t) => (
        <div
          key={t.id}
          className={"tab" + (value === t.id ? " active" : "")}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count != null && <span className="tab-count">{t.count}</span>}
        </div>
      ))}
    </div>
  );
}

// --- Charts (lightweight SVG, no deps) ---
function AreaChart({ data, height = 220, keys = ["revenue", "cost"], colors = ["#2D6CDF", "#94A3B8"], unit = "M" }) {
  const w = 720, h = height, padL = 36, padR = 12, padT = 14, padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const max = (Math.max(0, ...data.flatMap((d) => keys.map((k) => d[k] || 0))) || 1) * 1.15;
  const stepX = innerW / Math.max(1, data.length - 1);
  const yScale = (v) => padT + innerH - (v / max) * innerH;
  const xScale = (i) => padL + i * stepX;

  const lineFor = (key) => data.map((d, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)},${yScale(d[key]).toFixed(1)}`).join(" ");
  const areaFor = (key) => `${lineFor(key)} L${xScale(data.length - 1).toFixed(1)},${padT + innerH} L${xScale(0).toFixed(1)},${padT + innerH} Z`;

  const ticks = 4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      <defs>
        <linearGradient id="ac1" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={colors[0]} stopOpacity="0.22" />
          <stop offset="100%" stopColor={colors[0]} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[...Array(ticks + 1)].map((_, i) => {
        const y = padT + (innerH / ticks) * i;
        const val = (max * (ticks - i) / ticks).toFixed(1);
        return (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={y} y2={y} stroke="var(--border)" strokeDasharray={i === ticks ? "" : "3,4"} />
            <text x={padL - 6} y={y + 3.5} fontSize="10" textAnchor="end" fill="var(--text-tertiary)" fontFamily="var(--font-num)">{val}{unit}</text>
          </g>
        );
      })}
      <path d={areaFor(keys[0])} fill="url(#ac1)" />
      {keys.map((k, i) => (
        <path key={k} d={lineFor(k)} fill="none" stroke={colors[i]} strokeWidth="2" strokeLinejoin="round" />
      ))}
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={xScale(i)} cy={yScale(d[keys[0]])} r={3} fill="white" stroke={colors[0]} strokeWidth="1.5" />
          <text x={xScale(i)} y={h - 10} fontSize="10.5" textAnchor="middle" fill="var(--text-tertiary)">{d.m}</text>
        </g>
      ))}
    </svg>
  );
}

function BarChart({ data, height = 200, keyV = "v", keyL = "l", color = "#2D6CDF" }) {
  const w = 720, h = height, padL = 36, padR = 12, padT = 8, padB = 24;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const max = (Math.max(0, ...data.map((d) => d[keyV] || 0)) || 1) * 1.15;
  const barW = (innerW / data.length) * 0.55;
  const step = innerW / data.length;
  const ticks = 4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      {[...Array(ticks + 1)].map((_, i) => {
        const y = padT + (innerH / ticks) * i;
        return <line key={i} x1={padL} x2={w - padR} y1={y} y2={y} stroke="var(--border)" strokeDasharray={i === ticks ? "" : "3,4"} />;
      })}
      {data.map((d, i) => {
        const x = padL + step * i + (step - barW) / 2;
        const bh = (d[keyV] / max) * innerH;
        const y = padT + innerH - bh;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={bh} rx={4} fill={color} opacity="0.85" />
            <text x={x + barW / 2} y={h - 8} fontSize="10.5" textAnchor="middle" fill="var(--text-tertiary)">{d[keyL]}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Donut({ data, size = 168, thickness = 22, colors = ["#2D6CDF", "#7C3AED", "#0EA5C7", "#F59E0B", "#16A34A", "#94A3B8"] }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  if (!total) return <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}><circle cx={size / 2} cy={size / 2} r={(size - thickness) / 2} fill="none" stroke="var(--bg-subtle)" strokeWidth={thickness}/></svg>;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <g transform={`translate(${size / 2}, ${size / 2}) rotate(-90)`}>
        <circle r={r} fill="none" stroke="var(--bg-subtle)" strokeWidth={thickness} />
        {data.map((d, i) => {
          const len = (d.value / total) * c;
          const seg = (
            <circle
              key={i}
              r={r}
              fill="none"
              stroke={colors[i % colors.length]}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return seg;
        })}
      </g>
    </svg>
  );
}

// --- Doc badge ---
function DocBadge({ type }) {
  const meta = window.DOC_LABEL[type];
  if (!meta) return null;
  return <span className="badge" title={meta.short} style={{ background: (window.DOC_TINT || {})[type] || undefined, color: "#2B3345", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>{meta.th}</span>;
}
function StatusBadge({ status, dict }) {
  const meta = dict[status];
  if (!meta) return <span className="badge">{status}</span>;
  return <span className={"badge badge-" + meta.color}><span className="b-dot" />{meta.th}</span>;
}

// --- Modal / Drawer ---
function Drawer({ open, onClose, title, children, width = 720, footer }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(11,18,32,0.4)", backdropFilter: "blur(2px)" }} />
      <div style={{
        position: "absolute", right: 0, top: 0, height: "100vh", width,
        background: "var(--bg-elevated)", boxShadow: "var(--shadow-lg)",
        display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)"
      }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose}><I.X size={16} /></button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>{children}</div>
        {footer && <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>{footer}</div>}
      </div>
    </div>
  );
}

Object.assign(window, {
  Sidebar, Topbar, PageHeader, Tabs,
  AreaChart, BarChart, Donut,
  DocBadge, StatusBadge, Drawer
});