/* global React, ReactDOM, I, Sidebar, Topbar, PageDashboard, PageSales, PageCustomers, PageCustomerPO,
   PageProduction, PageInventory, PageMolds, PageShipping, PageProcurement, PageQC,
   PageAccounting, PageHR, PageReports, PageDocs, PageAuditLog, PageSettings, LoginScreen,
   useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakColor, TweakToggle,
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
  hr:           { title: "พนักงาน",       crumb: ["PolyMate", "บุคคล", "พนักงาน"], Comp: PageHR },
  reports:      { title: "รายงาน",        crumb: ["PolyMate", "วิเคราะห์", "รายงาน"], Comp: PageReports },
  docs:         { title: "เอกสารระบบ",     crumb: ["PolyMate", "เอกสารระบบ", "DB / API / Workflow"], Comp: PageDocs },
  audit:        { title: "Log การใช้งาน",  crumb: ["PolyMate", "เอกสารระบบ", "Audit Log"], Comp: PageAuditLog },
  users:        { title: "จัดการผู้ใช้",    crumb: ["PolyMate", "เอกสารระบบ", "จัดการผู้ใช้"], Comp: window.PageUsers },
  settings:     { title: "ตั้งค่า",        crumb: ["PolyMate", "ตั้งค่า"], Comp: PageSettings },
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#2D6CDF",
  "density": "default",
  "theme": "light"
}/*EDITMODE-END*/;

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
  const [theme, setTheme] = useState("light");
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const roleKey = user ? user.role : "admin";
  const role = user ? { ...window.ROLES[roleKey], user: { name: user.fullName, initial: (user.fullName || "?").slice(0, 2), title: window.ROLES[roleKey].label } } : null;

  useEffect(() => {
    if (role && role.pages !== "*" && !role.pages.includes(page)) {
      setPage("dashboard");
    }
  }, [roleKey, page]);

  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);
  useEffect(() => { setTheme(t.theme); }, [t.theme]);
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
          onToggleTheme={() => {
            const next = theme === "light" ? "dark" : "light";
            setTheme(next);
            setTweak("theme", next);
          }}
          role={role}
          onLogout={() => { Store.logout(); setUser(null); setPage("dashboard"); }}
          onNav={(p, focus) => { window.ERP_FOCUS = focus || null; setPage(p); setNavTick((n) => n + 1); }}
        />
        <div className="content" key={page + "-" + roleKey + "-" + navTick}>
          {canSee ? <PageErrorBoundary><Comp role={role}/></PageErrorBoundary> : <div className="card" style={{ padding: 40, textAlign: "center" }}>ไม่มีสิทธิ์เข้าถึงหน้านี้</div>}
        </div>
        <ToastHost/>
      </div>

      <TweaksPanel title="Tweaks">
        <TweakSection label="ธีม">
          <TweakRadio label="โหมด" value={t.theme} onChange={(v) => setTweak("theme", v)}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}/>
        </TweakSection>
        <TweakSection label="Accent color">
          <TweakColor label="สี" value={t.accent} onChange={(v) => setTweak("accent", v)}
            options={["#2D6CDF", "#0F9F8F", "#7C3AED", "#D97706"]}/>
        </TweakSection>
        <TweakSection label="Density">
          <TweakRadio label="ความหนาแน่น" value={t.density} onChange={(v) => setTweak("density", v)}
            options={[
              { value: "compact", label: "Compact" },
              { value: "default", label: "Default" },
              { value: "comfortable", label: "Comfy" },
            ]}/>
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

window.__erpMounted = true; // แจ้ง boot guard ใน index.html ว่าระบบเริ่มทำงานแล้ว
if (!window.__erpBlocked) ReactDOM.createRoot(document.getElementById("root")).render(<App />);
