/* global React */
// theme-panel.jsx — แผงปรับธีมของ PolyMate ERP (เขียนขึ้นใหม่สำหรับโครงการนี้)
// - useThemeSettings: เก็บค่าธีม/สี/ความหนาแน่น และจำไว้ใน localStorage
// - ThemePanel: ปุ่มลอยมุมขวาล่าง กดแล้วเปิดแผงเลือกค่า
// ใช้ CSS variables เดิมของระบบ (--bg-elevated, --border, --text-primary, --accent ฯลฯ)

const THEME_STORAGE_KEY = "polymate-erp-theme-v1";

function useThemeSettings(defaults) {
  const [settings, setSettings] = React.useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || "null");
      return saved && typeof saved === "object" ? { ...defaults, ...saved } : defaults;
    } catch (e) {
      return defaults;
    }
  });
  const update = React.useCallback((key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(next)); } catch (e) { /* โหมด private ฯลฯ — ใช้ต่อได้ แค่ไม่จำค่า */ }
      return next;
    });
  }, []);
  return [settings, update];
}

function ThemeChoice({ label, value, options, onChange }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 4, background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 8, padding: 3 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={on}
              style={{
                flex: 1, border: 0, borderRadius: 6, padding: "6px 4px", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
                background: on ? "var(--bg-elevated)" : "transparent",
                color: on ? "var(--text-primary)" : "var(--text-secondary)",
                boxShadow: on ? "0 1px 2px rgba(0,0,0,.15)" : "none",
                fontWeight: on ? 600 : 400,
              }}>{o.label}</button>
          );
        })}
      </div>
    </div>
  );
}

function ThemeSwatches({ label, value, colors, onChange }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 8 }}>
        {colors.map((c) => (
          <button key={c} type="button" onClick={() => onChange(c)} aria-label={c} aria-pressed={c === value}
            style={{
              width: 28, height: 28, borderRadius: "50%", background: c, cursor: "pointer", padding: 0,
              border: c === value ? "2px solid var(--text-primary)" : "2px solid transparent",
              outline: "2px solid var(--bg-elevated)", outlineOffset: -4,
            }}/>
        ))}
      </div>
    </div>
  );
}

function ThemePanel({ settings, onChange }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 900, fontFamily: "inherit" }}>
      {open && (
        <div role="dialog" aria-label="ปรับธีม" style={{
          width: 260, marginBottom: 8, padding: 14, borderRadius: 12,
          background: "var(--bg-elevated)", color: "var(--text-primary)",
          border: "1px solid var(--border-strong)", boxShadow: "0 8px 24px rgba(0,0,0,.18)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <strong style={{ fontSize: 13 }}>ปรับแต่งหน้าจอ</strong>
            <button type="button" onClick={() => setOpen(false)} aria-label="ปิด"
              style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--text-secondary)", fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
          <ThemeChoice label="โหมด" value={settings.theme} onChange={(v) => onChange("theme", v)}
            options={[{ value: "light", label: "สว่าง" }, { value: "dark", label: "มืด" }]}/>
          <ThemeChoice label="ความหนาแน่น" value={settings.density} onChange={(v) => onChange("density", v)}
            options={[{ value: "compact", label: "กะทัดรัด" }, { value: "default", label: "ปกติ" }, { value: "comfortable", label: "โปร่ง" }]}/>
          <ThemeSwatches label="สีหลัก" value={settings.accent} onChange={(v) => onChange("accent", v)}
            colors={["#2D6CDF", "#0F9F8F", "#7C3AED", "#D97706"]}/>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="ปรับแต่งหน้าจอ"
          style={{
            width: 38, height: 38, borderRadius: "50%", cursor: "pointer", fontSize: 16,
            border: "1px solid var(--border-strong)", background: "var(--bg-elevated)", color: "var(--text-primary)",
            boxShadow: "0 2px 8px rgba(0,0,0,.15)",
          }}>◐</button>
      </div>
    </div>
  );
}

Object.assign(window, { useThemeSettings, ThemePanel });
