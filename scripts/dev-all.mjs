// npm run dev:all -> รัน Backend (Spring Boot) และ Frontend พร้อมกัน
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const procs = [
  spawn(process.execPath, [path.join(here, "run-backend.mjs")], { stdio: "inherit", env: process.env }),
  spawn(process.execPath, [path.join(here, "..", "server.mjs")], { stdio: "inherit", env: process.env }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", stop));
