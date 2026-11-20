/* global React, ReactDOM, I, Sidebar, Topbar, PageDashboard, PageSales, PageCustomers, PageCustomerPO,
   PageProduction, PageInventory, PageMolds, PageShipping, PageProcurement, PageQC,
   PageAccounting, PageFinance, PageFinApprovals, PageFinReceipts, PageFinRcWait, PageFinPayments, PageFinOther, PageFinLedger, PageFinSettings, PageHR, PageReports, PageDocs, PageAuditLog, PageSettings, LoginScreen,
   useThemeSettings, ThemePanel,
   useState, useEffect */

const PAGES = {
  dashboard:    { title: "แดชบอร์ด",      crumb: ["PolyMate", "แดชบอร์ด"],     Comp: PageDashboard },
  sales:        { title: "เอกสารขาย",    crumb: ["PolyMate", "งานขาย", "เอกสารขาย"], Comp: PageSales },
  "customer-po":{ title: "PO ลูกค้า",     crumb: ["PolyMate", "งานขาย", "ใบ PO ลูกค้า"], Comp: PageCustomerPO },
  customers:    { title: "ลูกค้า",        crumb: ["PolyMate", "งานขาย", "ลูกค้า"], Comp: PageCustomers },
  production:   { title: "ใบสั่งผลิต",     crumb: ["PolyMate", "งานผลิต", "ใบสั่งผลิต"], Comp: PageProduction },
  molds:        { title: "แม่พิมพ์",       crumb: ["PolyMate", "งานผลิต", "แม่พิมพ์"], Comp: PageMolds },
  qc:           { title: "ตรวจคุณภาพ",   crumb: ["PolyMate", "งานผลิต", "QC"], Comp: PageQC },
  shipping:     { title: "การจัดส่ง",      crumb: ["PolyMate", "การจัดส่ง", "ใบส่งสินค้า"], Comp: PageShipping },
  inventory:    { title: "คลังสินค้า",     crumb: ["PolyMate", "คลัง", "สต๊อก"], Comp: PageInventory },
  procurement:  { title: "ฝ่ายจัดซื้อ",     crumb: ["PolyMate", "จัดซื้อ", "PO / Supplier"], Comp: PageProcurement },
  accounting:   { title: "บัญชี",         crumb: ["PolyMate", "การเงิน", "บัญชี"], Comp: PageAccounting },
  finance:      { title: "บัญชีเงิน", crumb: ["PolyMate", "การเงิน", "บัญชีเงิน"], Comp: PageFinance },
  "fin-approvals": { title: "รออนุมัติ", crumb: ["PolyMate", "การเงิน", "รออนุมัติ"], Comp: PageFinApprovals },
  "fin-rc-wait":   { title: "ใบเสร็จรอเก็บเงิน", crumb: ["PolyMate", "การเงิน", "ใบเสร็จรอเก็บเงิน"], Comp: PageFinRcWait },
  "fin-receipts":  { title: "รับเงินลูกค้า", crumb: ["PolyMate", "การเงิน", "รับเงินลูกค้า"], Comp: PageFinReceipts },
  "fin-payments":  { title: "จ่ายเงิน (ใบสำคัญจ่าย)", crumb: ["PolyMate", "การเงิน", "จ่ายเงิน"], Comp: PageFinPayments },
  "fin-other":     { title: "รับ/จ่าย/โอนอื่น ๆ", crumb: ["PolyMate", "การเงิน", "รับ/จ่าย/โอนอื่น ๆ"], Comp: PageFinOther },
  "fin-ledger":    { title: "สมุดเงิน", crumb: ["PolyMate", "การเงิน", "สมุดเงิน"], Comp: PageFinLedger },
  "fin-settings":  { title: "ตั้งค่าการเงิน", crumb: ["PolyMate", "การเงิน", "ตั้งค่า"], Comp: PageFinSettings },
  hr:           { title: "พนักงาน",       crumb: ["PolyMate", "บุคคล", "พนักงาน"], Comp: PageHR },
  reports:      { title: "รายงาน",        crumb: ["PolyMate", "วิเคราะห์", "รายงาน"], Comp: PageReports },
  docs:         { title: "เอกสารระบบ",     crumb: ["PolyMate", "เอกสารระบบ", "DB / API / Workflow"], Comp: PageDocs },
  audit:        { title: "Log การใช้งาน",  crumb: ["PolyMate", "เอกสารระบบ", "Audit Log"], Comp: PageAuditLog },
  users:        { title: "จัดการผู้ใช้",    crumb: ["PolyMate", "เอกสารระบบ", "จัดการผู้ใช้"], Comp: window.PageUsers },
  settings:     { title: "ตั้งค่า",        crumb: ["PolyMate", "ตั้งค่า"], Comp: PageSettings },
};

const THEME_DEFAULTS = { accent: "#2D6CDF", density: "default", theme: "light" };

function App() {
  const [user, setUser] = useState(null); // บัญชีที่เข้าสู่ระบบ (จาก Backend)
  const [booting, setBooting] = useState(true);
  useEffect(() => {
    let alive = true;
    Store.restore().then((u) => { if (alive) { if (u) setUser(u); setBooting(false); } }).catch(() => alive && setBooting(false));
    const onExpired = () => { setUser(null); setPage("dashboard"); };
    window.addEventListener("erp-session-expired", onExpired);
    return () => { alive = false; window.removeEventListener("erp-session-expired", onExpired); };
  }, []);
  const [page, setPage] = useState("dashboard");
  const [navTick, setNavTick] = useState(0); // บังคับเปิดหน้าใหม่เมื่อกดลิงก์จากการค้นหา/แจ้งเตือน
  const [t, setThemeSetting] = useThemeSettings(THEME_DEFAULTS);
  const theme = t.theme;

  const roleKey = user ? user.role : "admin";
  const role = user ? { ...window.ROLES[roleKey], user: { name: user.fullName, initial: (user.fullName || "?").slice(0, 2), title: window.ROLES[roleKey].label } } : null;

  useEffect(() => {
    if (role && role.pages !== "*" && !role.pages.includes(page)) {
      setPage("dashboard");
    }
  }, [roleKey, page]);

  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);
  useEffect(() => { document.documentElement.setAttribute("data-density", t.density); }, [t.density]);
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", t.accent);
    document.documentElement.style.setProperty("--accent-hover", t.accent);
  }, [t.accent]);

  if (booting) return <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", color: "#5B6478" }}>กำลังเชื่อมต่อเซิร์ฟเวอร์…</div>;
  if (!user) {
    return <><LoginScreen onLogin={(u) => setUser(u)}/><ToastHost/></>;
  }

  const { Comp, crumb } = PAGES[page];
  const canSee = role.pages === "*" || role.pages.includes(page);

  return (
    <div className="app" data-screen-label={"ERP / " + PAGES[page].title}>
      <Sidebar active={page} onNav={setPage} role={role}/>
      <div className="main">
        <Topbar
          crumb={crumb}
          theme={theme}
          onToggleTheme={() => setThemeSetting("theme", theme === "light" ? "dark" : "light")}
          role={role}
          onLogout={() => { Store.logout(); setUser(null); setPage("dashboard"); }}
          onNav={(p, focus) => { window.ERP_FOCUS = focus || null; setPage(p); setNavTick((n) => n + 1); }}
        />
        <div className="content" key={page + "-" + roleKey + "-" + navTick}>
          {canSee ? <PageErrorBoundary><Comp role={role}/></PageErrorBoundary> : <div className="card" style={{ padding: 40, textAlign: "center" }}>ไม่มีสิทธิ์เข้าถึงหน้านี้</div>}
        </div>
        <ToastHost/>
      </div>

      <ThemePanel settings={t} onChange={setThemeSetting}/>
    </div>
  );
}

window.__erpMounted = true; // แจ้ง boot guard ใน index.html ว่าระบบเริ่มทำงานแล้ว
if (!window.__erpBlocked) ReactDOM.createRoot(document.getElementById("root")).render(<App />);
