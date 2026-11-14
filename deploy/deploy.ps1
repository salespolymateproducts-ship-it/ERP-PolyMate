# รันจากเครื่อง Windows:  powershell -File deploy\deploy.ps1 -HostName <EC2 public DNS/IP> -KeyFile C:\path\key.pem [-User ec2-user]
param(
  [Parameter(Mandatory=$true)][string]$HostName,
  [Parameter(Mandatory=$true)][string]$KeyFile,
  [string]$User = "ec2-user"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Push-Location "$root\erp"
try {
  & .\gradlew.bat bootJar -x test --no-daemon
  if ($LASTEXITCODE -ne 0) { throw "build ไม่สำเร็จ" }
  $jar = Get-ChildItem build\libs\*-SNAPSHOT.jar | Where-Object { $_.Name -notmatch "plain" } | Select-Object -First 1
  scp -i $KeyFile $jar.FullName "${User}@${HostName}:/tmp/app.jar"
  ssh -i $KeyFile "${User}@${HostName}" "sudo mv /tmp/app.jar /opt/polymate-erp/app.jar && sudo chown erp:erp /opt/polymate-erp/app.jar && sudo systemctl restart polymate-erp && sleep 8 && curl -s http://127.0.0.1:8080/api/v1/healthz"
} finally { Pop-Location }
