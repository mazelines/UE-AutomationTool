param([Parameter(Mandatory = $true)][string]$TestRoot)
$ErrorActionPreference = 'Stop'
$automation = Split-Path -Parent $PSScriptRoot
$finalizer = Join-Path $automation 'InstallBuild/Finalize-InstalledBuild.ps1'
function Assert-True($Condition, $Message) { if (-not $Condition) { throw $Message } }
function New-Fixture($Name) {
    $fixture = Join-Path $TestRoot $Name
    New-Item -ItemType Directory -Path "$fixture/Windows/Engine/Build" -Force | Out-Null
    Set-Content -LiteralPath "$fixture/Windows/Engine/Build/InstalledBuild.txt" -Value 'fixture'
    return $fixture
}
function Run-Finalizer($Fixture, $ExpectedCode) {
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $finalizer -BuiltDirectory $Fixture 2>&1
    Assert-True ($LASTEXITCODE -eq $ExpectedCode) "Unexpected finalizer exit code: $LASTEXITCODE; $output"
    return ($output -join "`n")
}

$fresh = New-Fixture 'fresh build'
New-Item -ItemType Directory -Path "$fresh/Windows/Templates" | Out-Null
Set-Content -LiteralPath "$fresh/Windows/ToolComplete.txt" -Value 'done'
$null = Run-Finalizer $fresh 0
Assert-True ((Test-Path "$fresh/Engine/Build/InstalledBuild.txt") -and (Test-Path "$fresh/Templates") -and (Test-Path "$fresh/ToolComplete.txt")) 'Installed layout is incomplete.'
$null = Run-Finalizer $fresh 0

$partial = New-Fixture 'partial'
New-Item -ItemType Directory -Path "$partial/Templates" | Out-Null
Set-Content -LiteralPath "$partial/Templates/existing.txt" -Value 'preserve'
$null = Run-Finalizer $partial 0
Assert-True ((Get-Content "$partial/Templates/existing.txt") -eq 'preserve') 'Previously moved templates were altered.'

$collision = New-Fixture 'collision'
New-Item -ItemType Directory -Path "$collision/Engine" | Out-Null
Set-Content -LiteralPath "$collision/Engine/existing.txt" -Value 'preserve'
$collisionLog = Run-Finalizer $collision 1
Assert-True ($collisionLog.Contains('Destination already exists')) 'Missing destination collision diagnostic.'
Assert-True ((Test-Path "$collision/Windows/Engine/Build/InstalledBuild.txt") -and ((Get-Content "$collision/Engine/existing.txt") -eq 'preserve')) 'Collision damaged source or destination.'

$locked = New-Fixture 'locked'
Set-Content -LiteralPath "$locked/Windows/locked.txt" -Value 'preserve'
$handle = [IO.File]::Open("$locked/Windows/locked.txt", [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
    $lockLog = Run-Finalizer $locked 1
    Assert-True ($lockLog.Contains('Installed build finalization failed')) 'Missing OS error diagnostic.'
    Assert-True (Test-Path "$locked/Windows/locked.txt") 'Locked source was lost.'
} finally { $handle.Dispose() }
$null = Run-Finalizer $locked 0
Assert-True ((Get-Content "$locked/locked.txt") -eq 'preserve') 'Retry lost the previously locked file.'

# Run actual batch post-processing through recovery; verify logs, summary, and idempotence.
$repo = Join-Path $TestRoot 'recovery repo'
$outputRoot = Join-Path $repo 'LocalBuilds/Engine'
New-Item -ItemType Directory -Path "$repo/LocalBuilds/AutomationMonitor", "$repo/LocalBuilds/AutomationLogs", "$repo/LocalBuilds/Logs", "$outputRoot/Windows/Engine/Build" -Force | Out-Null
Set-Content "$outputRoot/Windows/Engine/Build/InstalledBuild.txt" fixture
Set-Content "$repo/LocalBuilds/AutomationMonitor/workspace.json" '{"build":{"Paths":{"OutputDirectory":"LocalBuilds/Engine","LogDirectory":"LocalBuilds/Logs"},"Build":{"TargetPlatform":"Win64","GameConfigurations":"Development","HostPlatformEditorOnly":"true","WithDDC":"false"},"Version":{"EngineVersion":"6.0","BuildLabel":"Developer"}}}'
$stamp = '20261105-152945'
$buildLog = "$repo/LocalBuilds/AutomationLogs/InstalledBuild-$stamp-output.log"
Set-Content $buildLog 'AutomationTool exiting with ExitCode=6 (6)'
$recovery = Join-Path $automation 'Resume-InstalledBuildPostProcessing.ps1'
$ErrorActionPreference = 'Continue'
$null = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $recovery -RepoRoot $repo -BuildTimestamp $stamp 2>&1
$ErrorActionPreference = 'Stop'
Assert-True ($LASTEXITCODE -ne 0 -and (Test-Path "$outputRoot/Windows/Engine")) 'Recovery accepted a failed BuildGraph run.'
Set-Content $buildLog 'AutomationTool exiting with ExitCode=0 (Success)'
$summary = "$repo/LocalBuilds/Logs/build_summary_$stamp.txt"
Set-Content $summary "  With DDC: false`r`n  Status: FAILED`r`n  Error Code: 1"
for ($attempt = 0; $attempt -lt 2; $attempt++) {
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $recovery -RepoRoot $repo -BuildTimestamp $stamp 2>&1
    Assert-True ($LASTEXITCODE -eq 0) "Recovery failed: $output"
    Assert-True ([bool](Select-String -LiteralPath $summary -Pattern 'Status: SUCCESS')) 'Success summary not saved.'
}
Assert-True (@(Get-ChildItem "$repo/LocalBuilds/AutomationLogs/*postbuild-recovery*.log").Count -eq 2) 'Post-processing logs not saved.'
Assert-True (@(Get-ChildItem "$summary.before-recovery-*").Count -eq 2) 'Previous summaries not preserved.'
Write-Host 'PASS: full layout, partial move, repeat, collisions, OS lock diagnostics, retry, recovery log and summary.'
