// PolyMate ERP — dev/static server
//   npm run dev        -> http://localhost:5173  (หน้าเว็บ + proxy /api ไปยัง Spring Boot)
// ตัวแปร: PORT (ค่าเริ่มต้น 5173), API_URL (ค่าเริ่มต้น http://localhost:8080)
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5173);
const apiUrl = process.env.API_URL || "http://localhost:8080";

const app = express();
app.disable("x-powered-by");

app.use("/api", createProxyMiddleware({
  target: apiUrl,
  changeOrigin: true,
  pathRewrite: (p) => "/api" + p,
  on: {
    error: (err, req, res) => {
      if (res && res.writeHead) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "BACKEND_UNAVAILABLE", message: "เชื่อมต่อ Backend ไม่ได้ (" + apiUrl + ")" } }));
      }
    },
  },
}));

// ให้ส่งเฉพาะไฟล์ของหน้าเว็บ ไม่เปิด docs/, erp/, node_modules/, .git
const allowed = /^\/(index\.html|styles\.css|[\w.-]+\.jsx|assets\/.*|uploads\/.*)?$/i;
app.use((req, res, next) => (req.path === "/" || allowed.test(req.path) ? next() : res.status(404).end()));
app.use(express.static(root, {
  index: "index.html",
  setHeaders(res, file) {
    res.setHeader("Cache-Control", "no-store");
    if (file.endsWith(".jsx")) res.setHeader("Content-Type", "text/babel; charset=utf-8");
  },
}));

app.listen(port, () => {
  console.log(`PolyMate ERP  http://localhost:${port}/   (API -> ${apiUrl})`);
});
