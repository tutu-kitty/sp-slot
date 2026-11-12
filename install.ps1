# =====================================================================
#  BDSM / SP 老虎机 · Windows 一键部署
#
#  用法:  右键此文件 -> "使用 PowerShell 运行"
#         (如需添加防火墙放行, 请以管理员身份运行)
#  功能:  检查 Node.js -> 选项目 -> 生成 token -> 防火墙放行 -> 启动
# =====================================================================

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "══════════ 老虎机一键部署 (Windows) ══════════" -ForegroundColor White

# ---- 1. Node.js 检查 ----
try {
  $v = node -v
} catch {
  Write-Host "未检测到 Node.js (需要 >= 18)。" -ForegroundColor Red
  Write-Host "安装: winget install OpenJS.NodeJS LTS"
  exit 1
}
Write-Host "✔ Node.js $v" -ForegroundColor Green

# ---- 2. 选项目 ----
Write-Host ""
$app = Split-Path -Leaf $Here
$targets = @($app)

if ($app -eq "sp-slot") { $defaultPorts = @{ "sp-slot" = 5062 } } else { $defaultPorts = @{ "bdsm-slot" = 5060 } }
$envNames      = @{ "bdsm-slot" = "BDSM_SLOT_TOKEN"; "sp-slot" = "SP_SLOT_TOKEN" }

# ---- 3. 逐个初始化 + 防火墙 + 启动 ----
foreach ($app in $targets) {
  $dir = Join-Path $Here $app
  if (-not (Test-Path (Join-Path $dir "server.js"))) {
    Write-Host "找不到 $dir\server.js，跳过" -ForegroundColor Red
    continue
  }

  $port = Read-Host "$app 端口 [回车=$($defaultPorts[$app])]"
  if ([string]::IsNullOrWhiteSpace($port)) { $port = [string]$defaultPorts[$app] }
  $lan = Read-Host "$app 是否允许局域网设备(手机)访问? [y/N]"
  $host2 = if ($lan -eq "y" -or $lan -eq "Y") { "0.0.0.0" } else { "localhost" }

  # .env
  $envPath = Join-Path $dir ".env"
  if (-not (Test-Path $envPath)) {
    $token = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
    $token = $token.replace("+", "A").replace("/", "B")
    "PORT=$port`nHOST=$host2`n$($envNames[$app])=$token" | Out-File -Encoding ascii $envPath
    Write-Host "✔ $app\.env 已生成 (含随机 token)" -ForegroundColor Green
  } else {
    Write-Host "・$app\.env 已存在，保留不动" -ForegroundColor Yellow
  }

  # 防火墙 (仅 0.0.0.0 时需要; 需管理员)
  if ($host2 -eq "0.0.0.0") {
    $ruleName = "bdsm-slots-$app"
    $rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if (-not $rule) {
      try {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
          -Protocol TCP -LocalPort $port | Out-Null
        Write-Host "✔ 已放行防火墙端口 $port" -ForegroundColor Green
      } catch {
        Write-Host "! 防火墙规则创建失败 (需要管理员权限)。局域网访问可能不通，请手动放行端口 $port" -ForegroundColor Yellow
      }
    }
  }

  # 启动 (新窗口, 关窗即停; 常驻建议 nssm/任务计划)
  $env:PORT = $port
  $env:HOST = $host2
  $envName = $envNames[$app]
  $env:($envName) = (Get-Content $envPath | Where-Object { $_ -match "^$envName=" }) -replace "^$envName=", ""
  Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $dir
  Write-Host "✔ $app 已在新窗口启动 (关掉那个窗口 = 停止服务)" -ForegroundColor Green
}

Write-Host ""
Write-Host "本机访问:  http://localhost:<端口>/"
Write-Host "局域网:    http://<电脑IP>:<端口>/  (ipconfig 查看 IPv4 地址)"
Write-Host "MCP:       http://<电脑IP>:<端口>/mcp  (Authorization: Bearer <token>)"
Write-Host ""
Write-Host "改池子: 编辑 data/pools.json，保存即生效 (无需重启)"
Write-Host "常驻后台建议: 用 任务计划程序 包 node server.js，或 nssm 注册为服务"
