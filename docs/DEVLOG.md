# DEVLOG — PolyMate ERP

## 2026-11-17 · ราคาวัตถุดิบเกิดจาก PO เท่านั้น (เลิกกรอกราคาตอนสร้าง/แก้วัตถุดิบ) ✅ (ยังไม่ push / ไม่ deploy)
อนุมัติโดยผู้ใช้ — ราคาขึ้นลงตลอด จึงกรอกที่ PO แล้วระบบคำนวณต้นทุนเอง; ข้อมูลใน ERP ตอนนี้เป็นข้อมูลทดลอง

**สิ่งที่เปลี่ยน**
- Server: PUT/PATCH เปลี่ยน `cost` / `costHistory` ไม่ได้ทุก role (409 `COST_MANAGED`) ส่งค่าเดิมซ้ำได้; วัตถุดิบใหม่ ส่ง `cost` = ต้นทุนยกมา (ไม่ติดลบ) และ server สร้าง `costHistory` เอง; `POST /actions/materials/{id}/adjust-cost` เฉพาะ admin ต้องมีเหตุผล บันทึกประวัติ (ref MANUAL) + audit
- หน้าวัตถุดิบ: ตัดช่องราคาทุนออก; มีช่อง "ต้นทุนยกมา" เมื่อกรอกยอดยกมา > 0 (บังคับ); ตอนแก้ไขแสดงต้นทุนอย่างเดียว + ปุ่ม "ปรับต้นทุน" สำหรับ admin; รายการแสดง "ยังไม่มีต้นทุน" เมื่อเป็น 0
- ฟอร์ม PO: ราคาตั้งต้นเป็นราคาซื้อล่าสุด (ไม่เคยซื้อ = ว่าง)
- สร้าง PO จากของขาด: ใช้ราคาซื้อล่าสุด/ต้นทุนถัวเฉลี่ย ถ้าไม่มีราคาเลยหรือจับคู่ Supplier ไม่ได้ จะแจ้งข้อความชัดเจนและไม่สร้าง (เดิมถูก server ปฏิเสธเงียบ ๆ ตามกฎ PO)
- ต้นทุนประเมิน BOM แสดง "ยังไม่มีต้นทุน" เมื่อ cost เป็น 0

**ผลทดสอบ:** gradlew test 38 เคสผ่าน (เพิ่ม: แก้ cost ตรงถูกปฏิเสธทุก role, adjust-cost เฉพาะ admin/ต้องมีเหตุผล/บันทึกประวัติและ audit, วัตถุดิบใหม่ cost 0 แล้วรับ PO แรก = ราคา PO, ต้นทุนยกมา)
**ยังไม่ได้ทดสอบ:** หน้าจอจริง (ฟอร์มวัตถุดิบ, modal ปรับต้นทุน, ปุ่มสร้าง PO จากของขาด)

## 2026-11-17 · Material Costing: ต้นทุนถัวเฉลี่ยเคลื่อนที่ + ประวัติราคาซื้อ ✅ (ยังไม่ push / ไม่ deploy)
อนุมัติขอบเขตโดยผู้ใช้ — ยังไม่ทำ FIFO / Stock Card เต็มรูปแบบ (รอ B5) และไม่แตะต้นทุนสินค้าสำเร็จรูป

**ปัญหา:** ซื้อวัตถุดิบราคาไม่เท่ากันแต่ตอนรับ PO ระบบไม่อัปเดต `cost` และ movement ไม่เก็บราคา

**สิ่งที่เปลี่ยน**
- `WorkflowService.receivePO`: คำนวณ Moving Average ใน transaction เดียวกับการเพิ่ม stock — ต้นทุนใหม่ = (stock เดิม × cost เดิม + qty × ราคา PO ก่อน VAT) ÷ (stock เดิม + qty), ปัด 4 ตำแหน่ง; stock เดิม ≤ 0 ใช้ราคา PO; บรรทัดที่ไม่มีราคาไม่เปลี่ยนต้นทุน
- movement ขารับเพิ่ม `unitCost`, `value`, `costBefore`, `costAfter`; `costHistory` ของ Material เพิ่มรายการอ้างเลข PO
- `page-inventory.jsx`: ฟอร์มแก้วัตถุดิบแสดงประวัติราคาซื้อ (ล่าสุด/เฉลี่ยถ่วงน้ำหนัก/ต่ำสุด–สูงสุด + รายการล่าสุด) จาก PO ที่รับแล้ว
- `page-procurement.jsx`: ฟอร์ม PO แสดงราคาซื้อล่าสุด/ช่วงราคา/ต้นทุนถัวเฉลี่ย และ % ต่างจากราคาล่าสุด
- ปรับสต๊อกด้วยมือและตัดวัตถุดิบตอนผลิตไม่เปลี่ยน `cost`; แก้ `cost` ด้วยมือยังทำได้เฉพาะ admin/procurement

**ผลทดสอบ:** gradlew test 36 เคสผ่านทั้งหมด (`MaterialCostingTests` 10 เคส: 100@50 + 100@56 = 53.00, ราคาลง, ต่อเนื่องหลายครั้ง, stock 0/ติดลบ, รับซ้ำไม่คำนวณซ้ำ, rollback ไม่เปลี่ยนต้นทุน, รับพร้อมกัน 10 PO ได้ผลเท่ารับต่อเนื่อง)
**ยังไม่ได้ทดสอบ:** หน้าจอจริง (UI ประวัติราคา/ข้อความในฟอร์ม PO)
**ผลกระทบ:** มูลค่าสต๊อก ต้นทุนประเมิน BOM และ analytics จะขยับตามราคาซื้อจริงหลังรับของ

## 2026-11-17 · Purchase Order Management + PO Receiving → Stock ✅ (ยังไม่ push / ไม่ deploy)
อนุมัติขอบเขตโดยผู้ใช้ — ไม่ทำรับบางส่วน/GR เต็มรูปแบบ ไม่เปลี่ยนสถาปัตยกรรม

**สาเหตุที่ stock ไม่เพิ่ม (จาก audit):** ปุ่มรับของเรียก `Store.receivePO` ฝั่งเบราว์เซอร์ แล้วซิงก์ขึ้น server ทีละ record (ไม่อยู่ใน transaction เดียว) ขณะที่ `WorkflowService.receivePO` ฝั่ง server ไม่เคยถูกเรียก, บรรทัดที่จับคู่วัตถุดิบไม่ได้ถูกข้ามเงียบ ๆ แต่ PO ยังถูกเปลี่ยนเป็น received

**สิ่งที่เปลี่ยน**
- `RecordService`: กฎ PO ฝั่ง server — Supplier ต้องมีและ active, ทุกบรรทัดต้องเลือกวัตถุดิบจากทะเบียน (ไม่ซ้ำ, qty/price > 0), server คำนวณ subtotal/VAT 7%/total เอง, สร้างได้เฉพาะ draft/pending, ลำดับสถานะ, ตั้งสถานะ received ตรง ๆ ไม่ได้, อนุมัติแล้วแก้รายการ/ยอดไม่ได้, ยกเลิกต้องมีเหตุผล, PO ที่ received/cancelled ล็อก, ลบ PO ที่ approved/received ไม่ได้, ประทับผู้อนุมัติ/เวลาโดย server
- `WorkflowService.receivePO`: จับคู่วัตถุดิบครบทุกบรรทัดก่อน บรรทัดใดจับคู่ไม่ได้ (หรือ qty <= 0 / ไม่มีรายการ) ปฏิเสธทั้งใบ แล้วค่อยเพิ่มสต๊อก + movement (ref = เลข PO) + เปลี่ยนสถานะ + ตั้งเจ้าหนี้ ใน transaction เดียว
- `store.jsx` / `page-procurement.jsx`: ปุ่มรับของเรียก `POST /actions/purchase-orders/{id}/receive` (รอให้การอนุมัติที่ค้างซิงก์ก่อน แล้วโหลดข้อมูลใหม่), กันกดซ้ำ, ฟอร์ม PO ไม่ให้ส่งบรรทัดพิมพ์เอง
- Tests: `PurchaseOrderRulesTests` (9 เคส) + ปรับ `ErpApplicationTests`/`SupplierRulesTests` ให้ใช้ PO ที่ถูกต้องตามกฎใหม่

**ผลทดสอบ:** gradlew test — 26 เคสผ่านทั้งหมด (รวมรับของพร้อมกัน 8 request เพิ่มสต๊อกครั้งเดียว, rollback เมื่อบรรทัดจับคู่ไม่ได้, รับซ้ำ/ยกเลิก/ยังไม่อนุมัติ/ไม่มีสิทธิ์ถูกปฏิเสธ)
**ยังไม่ได้ทดสอบ:** กดปุ่มในหน้าเว็บจริง (UI) — ต้องทดสอบบน UAT หลัง deploy
**ข้อควรรู้:** PO เก่าที่มีบรรทัดพิมพ์เอง/จับคู่วัตถุดิบไม่ได้ จะรับของไม่ได้ ต้องยกเลิกแล้วออกใหม่

## 2026-11-14 · UAT-1 Deploy บน EC2 ด้วย Docker ✅
อนุมัติโดยผู้ใช้: ใช้ PostgreSQL เดิมบนเครื่อง, subdomain `erp.polymateproducts.com`, HTTPS ผ่าน Cloudflare, build image บน EC2 จาก jar (Docker Desktop ในเครื่องพัฒนาเปิดไม่ได้ จึงไม่ใช้ Docker Hub)

**สิ่งที่เปลี่ยน**
- `deploy/deploy-docker.ps1`, `deploy/Dockerfile.runtime`, `deploy/docker-compose.ec2.yml`, `deploy/nginx-erp.conf` (ใหม่)
- `erp/.dockerignore` (ใหม่) — กัน `.env` และไฟล์ build เข้า build context
- `application.properties`: `server.forward-headers-strategy=native` — backend เห็น IP จริงของผู้ใช้หลัง nginx/Cloudflare
- EC2: swap 1 GB, docker-compose-v2, `/etc/polymate-erp.env`, nginx site ใหม่
- คู่มือ: [Deploy-EC2-Docker.md](Deploy-EC2-Docker.md)

**ผลทดสอบ** (image `polymate-erp-api:cb0d470`)
| # | รายการ | ผล |
|---|---|---|
| T1 | healthz บนเครื่อง 127.0.0.1:8081 | ✅ |
| T2 | https://erp.polymateproducts.com/api/v1/healthz | ✅ 200 |
| T3 | หน้า login แสดงผล, ไม่มี error ใน console | ✅ |
| T4 | login admin + เปลี่ยนรหัส ผ่าน URL จริง | ⏳ ให้ผู้ใช้ทดสอบ |
| T5 | `/docs/`, `/.env`, `/erp/.env`, `/server.mjs`, `/package.json`, `/.git/config` | ✅ 404 ทั้งหมด |
| T6 | เว็บบริษัท polymateproducts.com | ✅ 200 |
| T7 | rate limit login แยกตาม IP จริง (IP ภายนอกโดน 429, 127.0.0.1 ไม่โดน) | ✅ |
| T8 | `docker restart` กลับมาเอง (~12 วิ), policy unless-stopped | ✅ |
| T9 | RAM: API ~170 MB / limit 640 MB, ไม่มี OOM | ✅ |
| T10 | Postgres ฟังแค่ 127.0.0.1, API ฟังแค่ 127.0.0.1:8081 | ✅ |

**งานค้าง**: ขยาย disk (เหลือ ~0.9 GB), Cloudflare Full (strict) + จำกัด Security Group, ลบ role `admin` และข้อมูล UAT ก่อนใช้จริง, Vite build (B7)
