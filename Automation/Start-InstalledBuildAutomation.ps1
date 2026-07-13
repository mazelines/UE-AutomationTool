[CmdletBinding()]
param(
    [ValidateSet('Now', 'RegisterTask', 'RegisterTaskAndRun')]
    [string]$Mode = 'Now',
    [string]$TaskName = 'UE6 Nightly Upstream Sync And Installed Build',
    [string]$At = '02:00',
    [string]$Branch = 'ue6-automationSys',
    [string]$BuiltDirectory = 'LocalBuilds\Engine',
    [switch]$SkipSetup,
    [switch]$SkipGenerateProjectFiles,
    [switch]$NoClean,
    [switch]$SkipPushOrigin,
    [switch]$NoDDC,
    [switch]$AllowMergeCommit
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDirectory = Split-Path -Parent $PSCommandPath
$buildScript = Join-Path $scriptDirectory 'SyncAndBuildInstalled.ps1'
$registerScript = Join-Path $scriptDirectory 'Register-NightlyInstalledBuildTask.ps1'

function New-CommonArguments {
    $arguments = @(
        '-Branch', $Branch,
        '-BuiltDirectory', $BuiltDirectory
    )

    if ($SkipSetup) { $arguments += '-SkipSetup' }
    if ($SkipGenerateProjectFiles) { $arguments += '-SkipGenerateProjectFiles' }
    if ($NoClean) { $arguments += '-NoClean' }
    if ($SkipPushOrigin) { $arguments += '-SkipPushOrigin' }
    if ($NoDDC) { $arguments += '-NoDDC' }

    return $arguments
}

function Invoke-ImmediateBuild {
    $arguments = New-CommonArguments
    if ($AllowMergeCommit) { $arguments += '-AllowMergeCommit' }

    Write-Host "Running installed build automation now."
    & $buildScript @arguments
}

function Register-NightlyTask {
    $arguments = @(
        '-TaskName', $TaskName,
        '-At', $At,
        '-Branch', $Branch,
        '-BuiltDirectory', $BuiltDirectory
    )

    if ($SkipSetup) { $arguments += '-SkipSetup' }
    if ($SkipGenerateProjectFiles) { $arguments += '-SkipGenerateProjectFiles' }
    if ($NoClean) { $arguments += '-NoClean' }
    if ($SkipPushOrigin) { $arguments += '-SkipPushOrigin' }
    if ($NoDDC) { $arguments += '-NoDDC' }
    if ($AllowMergeCommit) { $arguments += '-AllowMergeCommit' }

    Write-Host "Registering nightly scheduled task."
    & $registerScript @arguments
}

switch ($Mode) {
    'Now' {
        Invoke-ImmediateBuild
    }
    'RegisterTask' {
        Register-NightlyTask
    }
    'RegisterTaskAndRun' {
        Register-NightlyTask
        Invoke-ImmediateBuild
    }
}




