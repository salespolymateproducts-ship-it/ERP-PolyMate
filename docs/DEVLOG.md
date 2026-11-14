# DEVLOG — PolyMate ERP

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
