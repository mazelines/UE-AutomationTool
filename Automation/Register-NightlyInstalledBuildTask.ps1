[CmdletBinding()]
param(
    [string]$TaskName = 'UE6 Nightly Upstream Sync And Installed Build',
    [string]$At = '02:00',
    [string]$Branch,
    [string]$BuiltDirectory,
    [string]$BuildScriptPath,
    [switch]$SkipSetup,
    [switch]$SkipGenerateProjectFiles,
    [switch]$NoClean,
    [switch]$SkipUpstreamSync,
    [switch]$SkipPushOrigin,
    [switch]$NoDDC,
    [switch]$AllowMergeCommit
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($BuildScriptPath)) {
    $scriptDirectory = Split-Path -Parent $PSCommandPath
    $BuildScriptPath = Join-Path $scriptDirectory 'SyncAndBuildInstalled.ps1'
}

$BuildScriptPath = (Resolve-Path $BuildScriptPath).Path
$runArguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', "`"$BuildScriptPath`""
)

# ponytail: no hardcoded fallbacks — omitted args resolve from AutomationMonitor/workspace.json (build section) at run time, so Save Config edits apply to the scheduled task without re-registering.
if (-not [string]::IsNullOrWhiteSpace($Branch)) { $runArguments += @('-Branch', "`"$Branch`"") }
if (-not [string]::IsNullOrWhiteSpace($BuiltDirectory)) { $runArguments += @('-BuiltDirectory', "`"$BuiltDirectory`"") }

if ($SkipSetup) { $runArguments += '-SkipSetup' }
if ($SkipGenerateProjectFiles) { $runArguments += '-SkipGenerateProjectFiles' }
if ($NoClean) { $runArguments += '-NoClean' }
if ($SkipUpstreamSync) { $runArguments += '-SkipUpstreamSync' }
if ($SkipPushOrigin) { $runArguments += '-SkipPushOrigin' }
if ($NoDDC) { $runArguments += '-NoDDC' }
if ($AllowMergeCommit) { $runArguments += '-AllowMergeCommit' }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ($runArguments -join ' ')
$trigger = New-ScheduledTaskTrigger -Daily -At ([DateTime]::ParseExact($At, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture))
# ponytail: RunLevel Limited — Highest needs an elevated registrar, and the build chain (git/Setup/UBT/RunUAT) runs fine unelevated.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 23) `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Sync UE6 fork with Epic upstream and run a Win64 installed build.' `
    -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Schedule: daily at $At"
Write-Host "Action: powershell.exe $($runArguments -join ' ')"




