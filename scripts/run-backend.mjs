// npm run backend        -> รัน Spring Boot (gradlew bootRun) ต่อ DB ตามค่าใน erp/.env (หรือ environment variable)
// npm run backend:local  -> รัน Postgres ฝังตัวในเครื่อง (ไม่แตะ DB จริง)
// ต้องมี JDK 17 ; erp/.env ต้องมี DB_URL / DB_USERNAME / DB_PASSWORD (ไฟล์นี้ถูก git ignore)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "erp");
const task = process.argv[2] || "bootRun";
const env = { ...process.env };

const envFile = path.join(dir, ".env");
if (task === "bootRun" && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#") && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  console.log("โหลดค่าจาก erp/.env -> DB:", (env.DB_URL || "(ไม่ได้ตั้ง)").replace(/\/\/[^@/]*@/, "//***@"));
} else if (task === "bootRun") {
  console.warn("ไม่พบ erp/.env — จะใช้ค่าเริ่มต้น localhost:5432 (คัดลอก erp/.env.example เป็น erp/.env แล้วใส่ค่าจริง)");
}

const win = process.platform === "win32";
const child = spawn(win ? ".\\gradlew.bat" : "./gradlew", [task], { cwd: dir, stdio: "inherit", shell: win, env });
child.on("exit", (code) => process.exit(code ?? 0));
