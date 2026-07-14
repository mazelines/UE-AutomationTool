# AutomationMonitor — stop both servers (backend :4174 + Vite dev :5173).
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$apiPort = if ($env:UE6_MONITOR_PORT) { [int]$env:UE6_MONITOR_PORT } else { 4174 }

function Stop-PortListener([int]$Port) {
    $pids = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $pids) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "[stop] Killed PID $procId on port $Port" -ForegroundColor Yellow
    }
    if (-not $pids) { Write-Host "[stop] Nothing listening on port $Port" -ForegroundColor DarkGray }
}

Stop-PortListener -Port $apiPort   # backend
Stop-PortListener -Port 5173       # Vite dev server
Write-Host '[stop] Done.' -ForegroundColor Green
