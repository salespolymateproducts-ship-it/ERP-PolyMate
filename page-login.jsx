/* global React, I, ROLES, Store */

/* เข้าสู่ระบบด้วยบัญชีผู้ใช้จริง (Store.users) — รหัสผ่านเก็บเป็น SHA-256 + salt
   บัญชีเริ่มต้น admin / admin1234 ระบบบังคับเปลี่ยนรหัสผ่านเมื่อเข้าครั้งแรก
   บัญชีใหม่สร้างโดยผู้ดูแลระบบที่เมนู "จัดการผู้ใช้" */
function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState("login"); // 'login' | 'change'
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pendingUser, setPendingUser] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await Store.ready;
      const u = await Store.login(username.trim(), password);
      if (u.mustChange) { setPendingUser(u); setMode("change"); }
      else onLogin(u);
    } catch (err) { setError(err.message); }
    setLoading(false);
  };
  const handleChange = async (e) => {
    e.preventDefault();
    setError("");
    if (newPw !== newPw2) { setError("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน"); return; }
    if (newPw === password) { setError("รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม"); return; }
    setLoading(true);
    try { await Store.setPassword(pendingUser.id, newPw); onLogin(Store.find("users", pendingUser.id)); }
    catch (err) { setError(err.message); }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      background: "var(--bg)",
    }}>
      {/* Left — branding panel */}
      <div style={{
        background: "linear-gradient(135deg, #0F2A5A 0%, #1E4DAB 45%, #2D6CDF 100%)",
        position: "relative",
        overflow: "hidden",
        color: "white",
        display: "flex",
        flexDirection: "column",
        padding: "48px 56px",
      }}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.12 }} viewBox="0 0 600 600">
          <defs>
            <pattern id="dots" width="32" height="32" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.2" fill="white"/>
            </pattern>
          </defs>
          <rect width="600" height="600" fill="url(#dots)"/>
          <circle cx="500" cy="100" r="220" fill="none" stroke="#7CC576" strokeWidth="1" opacity="0.4"/>
          <circle cx="100" cy="500" r="260" fill="none" stroke="white" strokeWidth="1" opacity="0.3"/>
        </svg>

        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14 }}>
          <img src="assets/polymate-logo.png" alt="PolyMate" style={{ width: 56, height: 56, objectFit: "contain", background: "white", borderRadius: 12, padding: 6 }}/>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>PolyMate Products</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>Your Plastic Partner · ERP System</div>
          </div>
        </div>

        <div style={{ position: "relative", marginTop: "auto", marginBottom: "auto" }}>
          <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 14 }}>Plastic Injection · Mold · Trading · OEM/ODM</div>
          <div style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.02em", maxWidth: 480 }}>
            ระบบ ERP สำหรับ<br/>
            <span style={{ color: "#7CC576" }}>โรงงานพลาสติก</span>ครบวงจร
          </div>
          <div style={{ fontSize: 14, marginTop: 14, opacity: 0.78, maxWidth: 440, lineHeight: 1.55 }}>
            จัดการทุกขั้นตอน — จากใบเสนอราคา การผลิต คงคลัง แม่พิมพ์ ไปจนถึงการส่งมอบและบัญชี ในระบบเดียว
          </div>

          <div style={{ display: "flex", gap: 14, marginTop: 28, flexWrap: "wrap" }}>
            {[
              { icon: "Factory", label: "Real-time Production" },
              { icon: "Boxes", label: "Stock Auto-Deduction" },
              { icon: "Wrench", label: "Mold Lifecycle" },
              { icon: "TrendUp", label: "Live Cost Analytics" },
            ].map((s, i) => {
              const Ico = I[s.icon];
              return (
                <div key={i} style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  padding: "8px 12px", borderRadius: 999,
                  display: "flex", alignItems: "center", gap: 7,
                  fontSize: 12.5, backdropFilter: "blur(4px)"
                }}>
                  <Ico size={14}/> {s.label}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ position: "relative", fontSize: 11.5, opacity: 0.6 }}>
          © 2026 PolyMate Products Co., Ltd. · v1.0.0
        </div>
      </div>

      {/* Right — login form */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "48px", background: "var(--bg-elevated)", overflowY: "auto"
      }}>
        {mode === "login" && (
          <form onSubmit={handleLogin} style={{ width: "100%", maxWidth: 380 }}>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>เข้าสู่ระบบ</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 6, marginBottom: 28 }}>กรอกชื่อผู้ใช้และรหัสผ่านที่ได้รับจากผู้ดูแลระบบ</p>
            <label className="field-label" htmlFor="login-user">ชื่อผู้ใช้</label>
            <div style={{ position: "relative", marginBottom: 14 }}>
              <I.Users size={15} style={{ position: "absolute", left: 11, top: 11, color: "var(--text-tertiary)" }}/>
              <input id="login-user" autoFocus autoComplete="username" className="input" style={{ paddingLeft: 34, height: 38 }} value={username} onChange={(e) => setUsername(e.target.value)}/>
            </div>
            <label className="field-label" htmlFor="login-pw">รหัสผ่าน</label>
            <div style={{ position: "relative", marginBottom: 18 }}>
              <I.Settings size={15} style={{ position: "absolute", left: 11, top: 11, color: "var(--text-tertiary)" }}/>
              <input id="login-pw" type="password" autoComplete="current-password" className="input" style={{ paddingLeft: 34, height: 38 }} value={password} onChange={(e) => setPassword(e.target.value)}/>
            </div>
            {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <button type="submit" disabled={loading || !username || !password} className="btn btn-primary" style={{ width: "100%", height: 42, justifyContent: "center", fontSize: 14, fontWeight: 600 }}>
              {loading ? "กำลังตรวจสอบ…" : <>เข้าสู่ระบบ <I.ArrowRight size={15}/></>}
            </button>
            <div style={{ textAlign: "center", marginTop: 18, fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>
              ลืมรหัสผ่านหรือยังไม่มีบัญชี? ติดต่อ <b style={{ color: "var(--text-primary)" }}>ผู้ดูแลระบบ</b> เพื่อรีเซ็ต/สร้างบัญชี
            </div>
          </form>
        )}
        {mode === "change" && (
          <form onSubmit={handleChange} style={{ width: "100%", maxWidth: 380 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>ตั้งรหัสผ่านใหม่</h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 6, marginBottom: 24 }}>บัญชี <b>{pendingUser && pendingUser.username}</b> ต้องเปลี่ยนรหัสผ่านก่อนเริ่มใช้งาน (อย่างน้อย 8 ตัวอักษร)</p>
            <label className="field-label" htmlFor="pw1">รหัสผ่านใหม่</label>
            <input id="pw1" type="password" autoComplete="new-password" className="input" style={{ height: 38, marginBottom: 14 }} value={newPw} onChange={(e) => setNewPw(e.target.value)}/>
            <label className="field-label" htmlFor="pw2">ยืนยันรหัสผ่านใหม่</label>
            <input id="pw2" type="password" autoComplete="new-password" className="input" style={{ height: 38, marginBottom: 18 }} value={newPw2} onChange={(e) => setNewPw2(e.target.value)}/>
            {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <button type="submit" disabled={loading || newPw.length < 8} className="btn btn-primary" style={{ width: "100%", height: 42, justifyContent: "center", fontSize: 14, fontWeight: 600 }}>
              {loading ? "กำลังบันทึก…" : "บันทึกและเข้าสู่ระบบ"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

window.LoginScreen = LoginScreen;
