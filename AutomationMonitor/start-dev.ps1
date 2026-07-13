# AutomationMonitor — Development one-click launcher.
# Starts TWO processes in their own windows:
#   1. Backend in dev mode  (node server/index.js --dev)  on port 4174  → serves /api only
#   2. Vite dev server       (npm run ui)                  on port 5173  → HMR UI, proxies /api → 4174
# Open the UI at http://127.0.0.1:5173 (NOT 4174 — in dev the backend returns 404 for static files).
[CmdletBinding()]
param(
    [switch]$NoBrowser       # do not auto-open the browser
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$apiPort = if ($env:UE6_MONITOR_PORT) { $env:UE6_MONITOR_PORT } else { '4174' }
$uiUrl   = 'http://127.0.0.1:5173'

function Stop-PortListener([int]$Port) {
    Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

if (-not (Test-Path node_modules)) {
    Write-Host '[setup] Installing dependencies (first run)...' -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
}

# Free both ports so a re-run restarts cleanly.
Stop-PortListener -Port ([int]$apiPort)
Stop-PortListener -Port 5173

# Each server gets its own console window (cmd /k keeps it open, showing live logs).
Write-Host "[dev] Starting backend (--dev) on port $apiPort ..." -ForegroundColor Cyan
Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','node server/index.js --dev' -WorkingDirectory $PSScriptRoot

Write-Host '[dev] Starting Vite dev server on port 5173 ...' -ForegroundColor Cyan
Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','npm run ui' -WorkingDirectory $PSScriptRoot

if (-not $NoBrowser) {
    Write-Host '[dev] Waiting for Vite to come up, then opening the browser...' -ForegroundColor Cyan
    for ($i = 0; $i -lt 120; $i++) {
        try { Invoke-WebRequest -Uri $uiUrl -UseBasicParsing -TimeoutSec 2 | Out-Null; break }
        catch { Start-Sleep -Milliseconds 500 }
    }
    Start-Process $uiUrl
}

Write-Host ""
Write-Host "[dev] Running. UI: $uiUrl  (proxies /api -> http://127.0.0.1:$apiPort)" -ForegroundColor Green
Write-Host '      Two console windows opened (API + UI). Close them to stop the servers.' -ForegroundColor Green
