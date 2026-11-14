#!/usr/bin/env bash
# รันครั้งเดียวบน EC2 (Amazon Linux 2023 / Ubuntu) :  sudo bash ec2-setup.sh
# ติดตั้ง Java 17 + สร้าง service "polymate-erp" ที่อ่านค่าจาก /etc/polymate-erp.env
set -euo pipefail

if command -v dnf >/dev/null; then dnf install -y java-17-amazon-corretto-headless
elif command -v apt-get >/dev/null; then apt-get update && apt-get install -y openjdk-17-jre-headless
else echo "ไม่รู้จักตัวจัดการแพ็กเกจ"; exit 1; fi

id -u erp >/dev/null 2>&1 || useradd -r -s /sbin/nologin erp
mkdir -p /opt/polymate-erp && chown erp:erp /opt/polymate-erp

if [ ! -f /etc/polymate-erp.env ]; then
  cat > /etc/polymate-erp.env <<'ENV'
# แก้ค่าด้านล่างให้ตรงกับ PostgreSQL บนเครื่องนี้ แล้ว: sudo systemctl restart polymate-erp
DB_URL=jdbc:postgresql://localhost:5432/erp
DB_USERNAME=erp_app
DB_PASSWORD=CHANGE_ME
ADMIN_INITIAL_PASSWORD=
CORS_ORIGINS=http://localhost:5173
SESSION_HOURS=12
PORT=8080
ENV
  chmod 600 /etc/polymate-erp.env
  echo ">>> แก้ /etc/polymate-erp.env (DB_PASSWORD) ก่อนเริ่ม service"
fi

cat > /etc/systemd/system/polymate-erp.service <<'UNIT'
[Unit]
Description=PolyMate ERP API
After=network.target postgresql.service

[Service]
User=erp
EnvironmentFile=/etc/polymate-erp.env
ExecStart=/usr/bin/java -Duser.timezone=Asia/Bangkok -Xmx512m -jar /opt/polymate-erp/app.jar --server.address=127.0.0.1
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable polymate-erp
echo "เสร็จ — อัปโหลด app.jar ไปที่ /opt/polymate-erp/ แล้ว: sudo systemctl restart polymate-erp ; journalctl -u polymate-erp -f"
