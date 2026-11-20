# PolyMate ERP — ทะเบียน Dependency และ License

จัดทำตามข้อกำหนดด้านลิขสิทธิ์ ข้อ 3–4 (ต้องบันทึก Dependency และ License; เพิ่ม Dependency ใหม่ต้องได้รับอนุมัติก่อน)
ตรวจล่าสุด: 2026-11-20

**วิธีตรวจ:** ✅ = อ่านจากไฟล์จริง (package.json / POM ใน Gradle cache / package.json ที่ unpkg ตามเวอร์ชันที่ pin) · ⚠️ = สรุปจากความรู้ ยังไม่ได้เปิดไฟล์ license ยืนยัน

## 1. Backend (Java 17, Gradle) — `erp/build.gradle`

| Dependency | เวอร์ชัน | ขอบเขต | License | ตรวจ |
|---|---|---|---|---|
| Spring Boot (starter-webmvc, starter-jdbc) | 4.1.2 | runtime | Apache-2.0 | ✅ |
| Spring Framework (spring-core ฯลฯ, ติดมากับ starter) | 7.0.10 | runtime | Apache-2.0 | ⚠️ |
| Spring Security Crypto (BCrypt) | 7.1.2 | runtime | Apache-2.0 | ✅ |
| PostgreSQL JDBC Driver | 42.7.14 | runtime | BSD-2-Clause | ✅ |
| Jackson (starter-jackson, ติดมากับ starter) | ตาม Spring Boot 4.1.2 | runtime | Apache-2.0 | ⚠️ |
| Embedded Postgres (zonky) | 2.0.7 | **test/dev เท่านั้น** | Apache-2.0 | ✅ |
| JUnit Jupiter / Platform | 6.0.3 | **test เท่านั้น** | EPL-2.0 | ✅ |

หมายเหตุ: transitive dependency อื่นของ Spring Boot (Tomcat ฯลฯ) ยังไม่ได้ไล่ตรวจรายตัว
Docker base image: `eclipse-temurin:17-jdk/jre` (OpenJDK, GPLv2 + Classpath Exception) ⚠️

## 2. Frontend dev server (npm) — `package.json`

| Dependency | เวอร์ชัน | License | ตรวจ |
|---|---|---|---|
| express | 4.22.3 | MIT | ✅ |
| http-proxy-middleware | 3.0.10 | MIT | ✅ |
| แพ็กเกจ transitive ใน node_modules (รวม 84 ตัวทั้งหมด) | — | MIT 81 · ISC 2 · BSD-3-Clause 1 | ✅ |

## 3. โหลดจาก CDN ใน `index.html` (ไม่ได้ฝังซอร์สในโครงการ)

| Library | เวอร์ชัน (pin + SRI) | License | ตรวจ |
|---|---|---|---|
| React | 18.3.1 | MIT | ✅ |
| ReactDOM | 18.3.1 | MIT | ✅ |
| @babel/standalone | 7.29.0 | MIT | ✅ |
| ฟอนต์ IBM Plex Sans / Sans Thai / Mono (Google Fonts) | — | SIL OFL 1.1 | ⚠️ |

หมายเหตุ: ระบบคอมไพล์ JSX ในเบราว์เซอร์ด้วย Babel และใช้ React แบบ development build เหมาะกับช่วง UAT; ก่อนใช้งานจริงควรพิจารณา build ล่วงหน้า (ไม่เกี่ยวกับลิขสิทธิ์)

## 4. แหล่งที่มาของ Source Code ที่เขียนเอง

- Backend `erp/src/**`, Frontend `*.jsx`, `styles.css`, `server.mjs`, `schema.sql`: พัฒนาสำหรับ PolyMate (ประวัติใน git)
- `assets/polymate-logo.png`: โลโก้ PolyMate ออกแบบเองโดยเจ้าของโครงการ (ยืนยันโดยเจ้าของ 2026-11-20) — ไฟล์เดียวกับ `uploads/ดีไซน์ที่ยังไม่ได้ตั้งชื่อ.png` (ตรวจแล้วเหมือนกันทุกไบต์)
- **`tweaks-panel.jsx`** (commit `5fa414f`, 2026-11-14): แม่แบบสำเร็จรูปที่ยืนยันที่มาไม่ได้ — **เลิกใช้และลบออกจาก working tree แล้วเมื่อ 2026-11-20 ตามคำตัดสินของเจ้าของ** ยังคงอยู่ในประวัติ git เป็นหลักฐาน
- **`theme-panel.jsx`** (2026-11-20): เขียนใหม่สำหรับ PolyMate ใช้แทน `tweaks-panel.jsx` ผ่าน `app.jsx`/`index.html`
- **ที่มาของชุดต้นแบบหน้าบ้าน (`uploads/ERP/`, ไฟล์ลงวันที่ 2026-06-06):** เจ้าของโครงการแจ้งเมื่อ 2026-11-20 ว่าสร้างโดย Claude (AI) ตามคำสั่งของเจ้าของ — เป็นคำแจ้งของเจ้าของ ยังไม่มีบันทึกการสนทนาต้นทางยืนยัน และยังยืนยันไม่ได้ว่า `tweaks-panel.jsx` เป็นโค้ดที่สร้างขึ้นใหม่หรือเป็นแม่แบบสำเร็จรูปของเครื่องมือที่ใช้สร้าง
- ชุดต้นแบบเดิม (`uploads/ERP/`) ถูกย้ายเมื่อ 2026-11-20 ตามคำตัดสินของเจ้าของ ไปเก็บเป็นหลักฐานนอกโปรเจกต์ (โฟลเดอร์ `ERP-PolyMate-evidence/prototype-ERP-2026-06-06` ในเครื่องเจ้าของ ไม่อยู่ใน repo) (ไม่แก้ไข ไม่ลบ) เว็บเซิร์ฟเวอร์เสิร์ฟไม่ได้อีก

## 5. รายการที่ต้องติดตาม

1. ยืนยัน license ของรายการ ⚠️ จากไฟล์จริง และไล่ transitive dependency ของ Spring Boot — เจ้าของโครงการตัดสินใจ (2026-11-20) ไม่ให้ตรวจในตอนนี้ ถือเป็นความเสี่ยงต่ำที่เจ้าของรับทราบ ตรวจภายหลังได้
2. `index.html` มี `<template id="__bundler_thumbnail">` เป็นร่องรอยของเครื่องมือออกแบบ (SVG ขนาดเล็ก) — รอตัดสินใจว่าจะลบหรือไม่
3. `server.mjs` เปิดให้โหลด `uploads/*` ผ่านเว็บ — ควรพิจารณาว่าจำเป็นหรือไม่ (ดูหัวข้อความปลอดภัย ไม่ใช่เรื่องลิขสิทธิ์โดยตรง)

## 6. บันทึกการอนุมัติ Dependency

| วันที่ | Dependency | ผู้อนุมัติ | หมายเหตุ |
|---|---|---|---|
| (ก่อน 2026-11-20) | รายการในหัวข้อ 1–3 | — | มีอยู่ก่อนนโยบาย รอเจ้าของโครงการรับรอง |
