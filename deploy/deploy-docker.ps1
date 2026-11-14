# Deploy ERP (UAT) ขึ้น EC2 ด้วย Docker — รันจากเครื่อง Windows (ต้องมี JDK 17 + ssh/scp; ไม่ต้องใช้ Docker Desktop)
#   powershell -ExecutionPolicy Bypass -File deploy\deploy-docker.ps1 -HostName <EC2 IP/DNS> -KeyFile C:\path\key.pem
# ขั้นตอน: build jar ในเครื่อง → อัปโหลด jar + ไฟล์หน้าเว็บ + compose + nginx → EC2 build image (JRE+jar) → up → เช็ก healthz
# ต้องตั้งเครื่องครั้งแรกตาม docs/Deploy-EC2-Docker.md ก่อน (swap, docker-compose-v2, /etc/polymate-erp.env)
param(
  [Parameter(Mandatory = $true)][string]$HostName,
  [Parameter(Mandatory = $true)][string]$KeyFile,
  [string]$User = "ubuntu",
  [string]$Image = "polymate-erp-api",
  [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$tag = (git -C $root rev-parse --short HEAD).Trim()
if (git -C $root status --porcelain) {
  Write-Warning "มีไฟล์ที่ยังไม่ commit — image จะติดแท็ก $tag-dirty"
  $tag = "$tag-dirty"
}
Write-Host ">>> deploy $Image`:$tag -> $User@$HostName"

# 1) build jar
if (-not $SkipBuild) {
  Push-Location (Join-Path $root "erp")
  try {
    & .\gradlew.bat bootJar -x test --no-daemon -q
    if ($LASTEXITCODE -ne 0) { throw "gradle bootJar ไม่สำเร็จ" }
  } finally { Pop-Location }
}
$jar = Get-ChildItem (Join-Path $root "erp\build\libs\*-SNAPSHOT.jar") | Where-Object { $_.Name -notmatch "plain" } | Select-Object -First 1
if (-not $jar) { throw "ไม่พบไฟล์ jar ใน erp\build\libs" }

# 2) รวมไฟล์ที่จะส่ง: หน้าเว็บ (เฉพาะไฟล์ที่ต้องใช้ — ห้ามส่ง docs/, erp/, .env ขึ้นเว็บ) + jar + Dockerfile
$stage = Join-Path $env:TEMP "erp-deploy"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
$web = Join-Path $stage "web"; $img = Join-Path $stage "image"
New-Item -ItemType Directory $web, $img | Out-Null
Copy-Item (Join-Path $root "index.html"), (Join-Path $root "styles.css") $web
Get-ChildItem $root -Filter *.jsx -File | Copy-Item -Destination $web
Copy-Item (Join-Path $root "assets") $web -Recurse
Copy-Item $jar.FullName (Join-Path $img "app.jar")
Copy-Item (Join-Path $root "deploy\Dockerfile.runtime") (Join-Path $img "Dockerfile")
Copy-Item (Join-Path $root "deploy\docker-compose.ec2.yml"), (Join-Path $root "deploy\nginx-erp.conf") $stage
$tgz = Join-Path $env:TEMP "erp-deploy.tgz"
Remove-Item $tgz -ErrorAction SilentlyContinue
tar -czf $tgz -C $stage .
if ($LASTEXITCODE -ne 0) { throw "สร้าง tgz ไม่สำเร็จ" }

$sshOpts = @("-i", $KeyFile, "-o", "ConnectTimeout=20")
scp @sshOpts $tgz "${User}@${HostName}:/tmp/erp-deploy.tgz"
if ($LASTEXITCODE -ne 0) { throw "scp ไม่สำเร็จ" }

# 3) ติดตั้งบน EC2
$remote = @'
set -euo pipefail
IMG="__IMAGE__:__TAG__"
D=/tmp/erp-deploy
rm -rf "$D" && mkdir -p "$D" && tar -xzf /tmp/erp-deploy.tgz -C "$D"

# image: JRE + jar (ติดแท็กตาม git sha เพื่อย้อนรุ่นได้)
sudo docker build -q -t "$IMG" -t "__IMAGE__:latest" "$D/image"

sudo install -d -m 755 /opt/polymate-erp
sudo install -m 644 "$D/docker-compose.ec2.yml" /opt/polymate-erp/docker-compose.yml

# หน้าเว็บ: แตกลงโฟลเดอร์ใหม่ แล้วสลับ (เก็บรุ่นก่อนไว้ที่ /var/www/erp.old)
sudo rm -rf /var/www/erp.new && sudo cp -r "$D/web" /var/www/erp.new
sudo chown -R root:root /var/www/erp.new
sudo find /var/www/erp.new -type d -exec chmod 755 {} +
sudo find /var/www/erp.new -type f -exec chmod 644 {} +
sudo rm -rf /var/www/erp.old
if [ -d /var/www/erp ]; then sudo mv /var/www/erp /var/www/erp.old; fi
sudo mv /var/www/erp.new /var/www/erp

# nginx: ทดสอบก่อน reload ถ้าผิดให้ถอด site ERP ออก เว็บหลักไม่กระทบ
sudo install -m 644 "$D/nginx-erp.conf" /etc/nginx/sites-available/polymateproducts-erp
sudo ln -sf /etc/nginx/sites-available/polymateproducts-erp /etc/nginx/sites-enabled/polymateproducts-erp
if ! sudo nginx -t; then sudo rm -f /etc/nginx/sites-enabled/polymateproducts-erp; echo "nginx config ผิด — ถอด site ERP ออกแล้ว"; exit 1; fi
sudo systemctl reload nginx

# API
cd /opt/polymate-erp
sudo ERP_IMAGE="$IMG" docker compose up -d
rm -rf "$D" /tmp/erp-deploy.tgz
# เก็บ image ERP ไว้แค่ 3 รุ่นล่าสุด (disk น้อย)
sudo docker images "__IMAGE__" --format '{{.Tag}}' | grep -v '^latest$' | tail -n +4 | xargs -r -I{} sudo docker rmi "__IMAGE__:{}" >/dev/null 2>&1 || true
for i in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8081/api/v1/healthz; then echo; echo "DEPLOY OK: $IMG"; exit 0; fi
  sleep 3
done
echo "healthz ไม่ตอบภายใน 2 นาที"; sudo docker logs --tail 80 polymate-erp-api; exit 1
'@
$remote = ($remote -replace "__IMAGE__", $Image -replace "__TAG__", $tag) -replace "`r`n", "`n"
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remote))
ssh @sshOpts "${User}@${HostName}" "echo $b64 | base64 -d | bash"
if ($LASTEXITCODE -ne 0) { throw "deploy บน EC2 ไม่สำเร็จ" }
