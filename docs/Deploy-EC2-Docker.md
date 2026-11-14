# Deploy ERP (UAT) บน EC2 ด้วย Docker

สถานะ: ใช้งานจริงตั้งแต่ 2026-11-14 · URL: https://erp.polymateproducts.com
> repo นี้เป็น public — ห้ามใส่ IP ของ EC2, รหัสผ่าน หรือ path ของ key ลงในเอกสาร/โค้ด (IP origin หลุด = ยิงข้าม Cloudflare ได้)

## ภาพรวม
```
ผู้ใช้ → Cloudflare (HTTPS, SSL mode Flexible) → nginx :80 ─┬─ polymateproducts.com → container my-html-web :8080 (เว็บบริษัท)
                                                           └─ erp.polymateproducts.com
                                                                ├─ /      → /var/www/erp (ไฟล์หน้าเว็บ allow-list)
                                                                └─ /api/  → container polymate-erp-api 127.0.0.1:8081
                                                                              → PostgreSQL 18 บนเครื่อง 127.0.0.1:5432 (DB polymate_erp)
```

| ส่วน | ที่อยู่บนเครื่อง |
|---|---|
| compose | `/opt/polymate-erp/docker-compose.yml` (จาก `deploy/docker-compose.ec2.yml`) |
| ค่าลับ | `/etc/polymate-erp.env` (root, chmod 600) |
| หน้าเว็บ | `/var/www/erp` (รุ่นก่อนหน้า: `/var/www/erp.old`) |
| nginx | `/etc/nginx/sites-available/polymateproducts-erp` → symlink ใน `sites-enabled` |
| image | `polymate-erp-api:<git-sha>` + `:latest` (build บนเครื่องจาก jar, เก็บ 3 รุ่นล่าสุด) |

ชื่อไฟล์ nginx ต้องเรียงหลัง `polymateproducts` เสมอ ไม่งั้นจะกลายเป็น default server ของเว็บหลัก

## Deploy / อัปเดต (จากเครื่อง Windows)
ต้องมี JDK 17, ssh/scp และ key ของ EC2 — ไม่ต้องใช้ Docker Desktop
```powershell
git status   # ควร commit ให้เรียบร้อยก่อน (ไม่งั้น image ติดแท็ก -dirty)
powershell -ExecutionPolicy Bypass -File deploy\deploy-docker.ps1 -HostName <EC2 IP/DNS> -KeyFile <path\to\key.pem>
```
สคริปต์: build jar → ส่ง jar + หน้าเว็บ + compose + nginx → EC2 build image (JRE+jar) → `nginx -t` แล้ว reload → `docker compose up -d` → รอ `/api/v1/healthz`
ถ้า `nginx -t` ไม่ผ่าน สคริปต์จะถอด site ERP ออกเอง เว็บหลักไม่กระทบ

## ย้อนรุ่น
```bash
sudo docker images polymate-erp-api                       # ดูแท็กที่มี
cd /opt/polymate-erp && sudo ERP_IMAGE=polymate-erp-api:<sha> docker compose up -d
sudo rm -rf /var/www/erp && sudo mv /var/www/erp.old /var/www/erp   # ถ้าต้องย้อนหน้าเว็บด้วย
```

## ดูสถานะ / log
```bash
curl -s http://127.0.0.1:8081/api/v1/healthz
sudo docker logs --tail 100 -f polymate-erp-api
sudo docker stats --no-stream
free -h; df -h /
```

## ตั้งเครื่องครั้งแรก (ทำแล้ว 2026-11-14)
1. swap 1 GB: `/swapfile` + `/etc/fstab`, `vm.swappiness=10` (disk เล็ก จึงไม่ใช้ 2 GB)
2. `sudo apt-get install -y docker-compose-v2`
3. `/etc/polymate-erp.env` (root, 600):
   ```
   DB_URL=jdbc:postgresql://127.0.0.1:5432/polymate_erp
   DB_USERNAME=polymate_erp
   DB_PASSWORD=<รหัสของ role polymate_erp>
   PORT=8081
   SERVER_ADDRESS=127.0.0.1
   CORS_ORIGINS=https://erp.polymateproducts.com
   SESSION_HOURS=12
   ADMIN_INITIAL_PASSWORD=
   ```
4. Cloudflare: record `erp` เปิด proxy (เมฆส้ม), SSL mode = Flexible (origin ฟังแค่ :80)

## ค่าที่จำกัดหน่วยความจำ (เครื่อง RAM 908 MB)
- container: `mem_limit 640m`, heap `-Xmx384m`, SerialGC, `ExitOnOutOfMemoryError` (ล่มแล้ว Docker restart ให้)
- ใช้จริงหลังบูต ~170 MB

## ข้อจำกัด/งานค้าง (ก่อนใช้งานจริง)
- **Disk เหลือ ~0.9 GB (87%)** — ควรขยาย EBS เป็น 15–20 GB ก่อน deploy ถี่ ๆ
- **Cloudflare Flexible**: ช่วง Cloudflare → origin ไม่เข้ารหัส และ port 80 ของ origin ยังรับจากทุก IP → เปลี่ยนเป็น Full (strict) + Cloudflare Origin Certificate และจำกัด Security Group :80/:443 ให้รับเฉพาะ IP ของ Cloudflare
- หน้าเว็บใช้ React dev build + Babel ในเบราว์เซอร์ (โหลดช้า) → แทนด้วย Vite build ใน B7
- DB ยังเป็นข้อมูล UAT และมี PostgreSQL role ทดสอบ `admin` (superuser) → ลบ role และเคลียร์ข้อมูลก่อนใช้จริง
- ตาราง `erp_audit_logs` ยังไม่เก็บ IP (rate limit login ใช้ IP จริงแล้ว)
- `deploy/deploy.ps1` + `deploy/ec2-setup.sh` (แบบ systemd) เลิกใช้แล้ว — ใช้ `deploy-docker.ps1` แทน
