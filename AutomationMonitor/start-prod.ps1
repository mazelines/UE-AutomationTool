# AutomationMonitor — Production one-click launcher.
# Builds the React UI into dist/, then runs the Node server which serves BOTH the
# built UI and the /api endpoints on a single port (default 4174). One process.
[CmdletBinding()]
param(
    [switch]$NoBuild,        # skip the vite build (serve the existing dist/ as-is)
    [switch]$NoBrowser       # do not auto-open the browser
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$port = if ($env:UE6_MONITOR_PORT) { $env:UE6_MONITOR_PORT } else { '4174' }
$url  = "http://127.0.0.1:$port"

function Stop-PortListener([int]$Port) {
    # Free the port so a re-run restarts cleanly instead of hitting EADDRINUSE.
    Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

if (-not (Test-Path node_modules)) {
    Write-Host '[setup] Installing dependencies (first run)...' -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
}

if (-not $NoBuild) {
    Write-Host '[build] Building production UI (vite build)...' -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'vite build failed' }
} else {
    Write-Host '[build] Skipped (-NoBuild); serving existing dist/.' -ForegroundColor DarkYellow
}

Stop-PortListener -Port ([int]$port)

if (-not $NoBrowser) {
    # Open the browser once the server answers, so this window stays on the server log.
    Start-Job -ArgumentList $url -ScriptBlock {
        param($u)
        for ($i = 0; $i -lt 120; $i++) {
            try { Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process $u; return }
            catch { Start-Sleep -Milliseconds 500 }
        }
    } | Out-Null
}

Write-Host ""
Write-Host "[serve] Production server on $url" -ForegroundColor Green
Write-Host "        This window runs the server -- press Ctrl+C or close it to stop." -ForegroundColor Green
Write-Host ""
node server/index.js
