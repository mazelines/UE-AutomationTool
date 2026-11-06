[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][ValidatePattern('^\d{8}-\d{6}$')][string]$BuildTimestamp,
    [string]$BuiltDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'Invoke-PostBuild.ps1')
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$workspace = Get-Content -LiteralPath (Join-Path $RepoRoot 'LocalBuilds/AutomationMonitor/workspace.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$config = $workspace.build
function Get-RecoverySetting($Section, $Key, $Fallback) {
    $sectionProperty = $config.PSObject.Properties[$Section]
    if ($sectionProperty -and $sectionProperty.Value.PSObject.Properties[$Key]) {
        return [string]$sectionProperty.Value.PSObject.Properties[$Key].Value
    }
    return $Fallback
}
$automationLogs = Join-Path $RepoRoot 'LocalBuilds/AutomationLogs'
$buildLog = Join-Path $automationLogs "InstalledBuild-$BuildTimestamp-output.log"
$tail = Get-Content -LiteralPath $buildLog -Tail 30
if (-not ($tail -match '^AutomationTool exiting with ExitCode=0 \(Success\)')) {
    throw "BuildGraph success is not confirmed in '$buildLog'; refusing post-processing recovery."
}
if (-not $BuiltDirectory) { $BuiltDirectory = $config.Paths.OutputDirectory }
if (-not [IO.Path]::IsPathRooted($BuiltDirectory)) { $BuiltDirectory = Join-Path $RepoRoot $BuiltDirectory }
$BuiltDirectory = (Resolve-Path -LiteralPath $BuiltDirectory).Path
$hasEngine = (Test-Path -LiteralPath (Join-Path $BuiltDirectory 'Windows/Engine/Build/InstalledBuild.txt')) -or
    (Test-Path -LiteralPath (Join-Path $BuiltDirectory 'Engine/Build/InstalledBuild.txt'))
if (-not $hasEngine) { throw "InstalledBuild.txt is missing under '$BuiltDirectory'; refusing recovery." }

$env:REPO_ROOT = $RepoRoot
$env:BUILT_DIRECTORY = $BuiltDirectory
$env:BUILD_RESULT = '0'
$env:BUILD_TIMESTAMP = $BuildTimestamp
$env:BUILD_LOG_DIR = $config.Paths.LogDirectory
$env:DISTRIBUTION_TYPE = Get-RecoverySetting 'Distribution' 'DistributionType' 'Developer'
$env:ENGINE_VERSION = $config.Version.EngineVersion
$env:BUILD_NUMBER = $BuildTimestamp
$env:BUILD_LABEL = $config.Version.BuildLabel
$env:TARGET_PLATFORM = $config.Build.TargetPlatform
$env:GAME_CONFIGURATIONS = $config.Build.GameConfigurations
$env:HOST_PLATFORM_EDITOR_ONLY = $config.Build.HostPlatformEditorOnly
$env:WITH_DDC = Get-RecoverySetting 'Build' 'WithDDC' 'false'

$summaryDirectory = $env:BUILD_LOG_DIR
if (-not [IO.Path]::IsPathRooted($summaryDirectory)) { $summaryDirectory = Join-Path $RepoRoot $summaryDirectory }
$summary = Join-Path $summaryDirectory "build_summary_$BuildTimestamp.txt"
# Preserve the original summary and its actual DDC setting, regardless of current UI settings.
if (Test-Path -LiteralPath $summary) {
    $summaryText = Get-Content -LiteralPath $summary -Raw -Encoding UTF8
    if ($summaryText -match 'With DDC: (true|false)') { $env:WITH_DDC = $Matches[1] }
    foreach ($field in @(@('Version', 'ENGINE_VERSION'), @('Build Number', 'BUILD_NUMBER'), @('Build Label', 'BUILD_LABEL'), @('Platform', 'TARGET_PLATFORM'), @('Game Configurations', 'GAME_CONFIGURATIONS'), @('Editor Only', 'HOST_PLATFORM_EDITOR_ONLY'))) {
        if ($summaryText -match ('(?m)^\s*' + [regex]::Escape($field[0]) + ':\s*([^\r\n]+)')) {
            [Environment]::SetEnvironmentVariable($field[1], $Matches[1].Trim(), 'Process')
        }
    }
    $backup = "$summary.before-recovery-$(Get-Date -Format 'yyyyMMdd-HHmmss-fff')"
    Copy-Item -LiteralPath $summary -Destination $backup -ErrorAction Stop
    Write-Host "Previous summary preserved: $backup"
}
$postLog = Join-Path $automationLogs "InstalledBuild-$BuildTimestamp-postbuild-recovery-$(Get-Date -Format 'yyyyMMdd-HHmmss-fff').log"
$result = Invoke-InstalledBuildPostProcessing -ScriptPath (Join-Path $PSScriptRoot 'InstallBuild/_postbuild.bat') -LogPath $postLog
if ($result -ne 0) { throw "Post-processing recovery failed with exit code $result. See '$postLog'." }
Write-Host "Post-processing recovery succeeded. Summary: $summary"
