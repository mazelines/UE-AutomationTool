[CmdletBinding()]
param(
    [string]$TaskName = 'UE6 Automation Monitor Server',
    [string]$ServerRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($ServerRoot)) {
    $scriptDirectory = Split-Path -Parent $PSCommandPath
    $ServerRoot = (Resolve-Path (Join-Path $scriptDirectory '..\AutomationMonitor')).Path
}

$node = (Get-Command node.exe).Source
$repoRoot = (Resolve-Path (Join-Path $ServerRoot '..')).Path
$logDirectory = Join-Path $repoRoot 'LocalBuilds\AutomationMonitor'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

# ponytail: powershell -WindowStyle Hidden wrapper — a direct node.exe action pops a console window in the interactive session at every logon.
$serverCommand = "Set-Location '$ServerRoot'; & '$node' server/index.js *>> '$logDirectory\server-task.log'"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"$serverCommand`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Runs the AutomationMonitor web server (http://localhost:4174) for the UE6 build automation.' `
    -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Trigger: at logon of $env:USERDOMAIN\$env:USERNAME"
Write-Host "Action: powershell.exe (hidden) -> node server/index.js in $ServerRoot"
