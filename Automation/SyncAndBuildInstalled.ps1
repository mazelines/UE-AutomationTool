[CmdletBinding()]
param(
    [string]$RepoRoot,
    [string]$Branch,
    [string]$OriginRemote = 'origin',
    [string]$UpstreamRemote = 'upstream',
    [string]$UpstreamUrl = 'https://github.com/EpicGames/UnrealEngine.git',
    [string]$UpstreamBranch = 'ue6-main',
    [string]$BuiltDirectory,
    [Alias('SkipSetup')]
    [switch]$SkipDependencySync,
    [switch]$SkipGenerateProjectFiles,
    [switch]$NoClean,
    [switch]$SkipUpstreamSync,
    [switch]$SkipPushOrigin,
    [string]$InstallConfig,
    [bool]$WithDDC = $true,
    [switch]$NoDDC,
    [switch]$AllowMergeCommit
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $scriptDirectory = Split-Path -Parent $PSCommandPath
    $RepoRoot = (Resolve-Path (Join-Path $scriptDirectory '..')).Path
}

function Invoke-LoggedStep {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$ScriptBlock
    )

    $startedAt = Get-Date
    Write-Host "[$($startedAt.ToString('yyyy-MM-dd HH:mm:ss'))] START $Name"
    & $ScriptBlock
    $finishedAt = Get-Date
    Write-Host "[$($finishedAt.ToString('yyyy-MM-dd HH:mm:ss'))] DONE  $Name ($([int]($finishedAt - $startedAt).TotalSeconds)s)"
}

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Read-IniFile {
    param([string]$Path)

    $ini = @{}
    if (-not (Test-Path $Path)) { return $ini }
    $section = ''
    # ponytail: -Encoding UTF8 is required — the ini has BOM-less UTF-8 Korean comments and PS 5.1 defaults to ANSI, which eats newlines mid-decode.
    foreach ($line in Get-Content $Path -Encoding UTF8) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith(';') -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -match '^\[(.+)\]$') { $section = $Matches[1]; continue }
        if ($trimmed -match '^([^=]+)=(.*)$') { $ini["$section.$($Matches[1].Trim())"] = $Matches[2].Trim() }
    }
    return $ini
}

$RepoRoot = (Resolve-Path $RepoRoot).Path

if ([string]::IsNullOrWhiteSpace($InstallConfig)) {
    $InstallConfig = Join-Path $RepoRoot 'install_build_config.ini'
}

# Settings live in AutomationMonitor/workspace.json (build section, flat "Section.Key" map);
# the legacy install_build_config.ini path is kept as a fallback for old branches.
$workspacePath = Join-Path $RepoRoot 'AutomationMonitor\workspace.json'
$config = @{}
if (Test-Path $workspacePath) {
    $workspaceJson = Get-Content $workspacePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($workspaceJson.PSObject.Properties['build']) {
        foreach ($sectionProp in $workspaceJson.build.PSObject.Properties) {
            foreach ($kvProp in $sectionProp.Value.PSObject.Properties) {
                $config["$($sectionProp.Name).$($kvProp.Name)"] = [string]$kvProp.Value
            }
        }
    }
} else {
    $config = Read-IniFile -Path $InstallConfig
}

if ([string]::IsNullOrWhiteSpace($Branch)) {
    $Branch = if ($config['Run.Branch']) { $config['Run.Branch'] } else { 'ue6-automationSys' }
}

# Upstream remote/url/branch resolve from config when not passed explicitly, so Save Config
# in the monitor UI can point the sync at a different upstream without editing this script.
if (-not $PSBoundParameters.ContainsKey('UpstreamRemote') -and $config['Run.UpstreamRemote']) {
    $UpstreamRemote = $config['Run.UpstreamRemote']
}
if (-not $PSBoundParameters.ContainsKey('UpstreamUrl') -and $config['Run.UpstreamUrl']) {
    $UpstreamUrl = $config['Run.UpstreamUrl']
}
if (-not $PSBoundParameters.ContainsKey('UpstreamBranch') -and $config['Run.UpstreamBranch']) {
    $UpstreamBranch = $config['Run.UpstreamBranch']
}
# Config can disable upstream sync entirely (build from the fork branch as-is).
if (-not $SkipUpstreamSync -and $config['Run.SkipUpstreamSync']) {
    $SkipUpstreamSync = [System.Convert]::ToBoolean($config['Run.SkipUpstreamSync'])
}

if ([string]::IsNullOrWhiteSpace($BuiltDirectory)) {
    $BuiltDirectory = if ($config['Paths.OutputDirectory']) { $config['Paths.OutputDirectory'] } else { 'LocalBuilds\Engine' }
}
if (-not [System.IO.Path]::IsPathRooted($BuiltDirectory)) {
    $BuiltDirectory = Join-Path $RepoRoot $BuiltDirectory
}
if (-not $PSBoundParameters.ContainsKey('WithDDC') -and $config['Build.WithDDC']) {
    $WithDDC = [System.Convert]::ToBoolean($config['Build.WithDDC'])
}
if ($NoDDC) {
    $WithDDC = $false
}

$logDirectory = Join-Path $RepoRoot 'LocalBuilds\AutomationLogs'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$logPath = Join-Path $logDirectory ("SyncAndBuildInstalled-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Start-Transcript -Path $logPath -Append | Out-Null

try {
    Write-Host "Repository: $RepoRoot"
    Write-Host "Branch: $Branch"
    if ($SkipUpstreamSync) {
        Write-Host "Upstream: sync disabled (SkipUpstreamSync) — building $Branch as-is"
    } else {
        Write-Host "Upstream: $UpstreamRemote -> $UpstreamUrl ($UpstreamBranch)"
    }
    Write-Host "Installed build output: $BuiltDirectory"
    Write-Host "Log: $logPath"

    Push-Location $RepoRoot

    Invoke-LoggedStep 'Validate repository state' {
        Invoke-Git rev-parse --is-inside-work-tree | Out-Null

        $trackedChanges = (& git status --porcelain --untracked-files=no)
        if ($LASTEXITCODE -ne 0) {
            throw 'git status failed.'
        }

        $blockingChanges = @($trackedChanges | Where-Object {
            $changePath = $_.Substring(3).Replace('"', '')
            -not ($changePath -like 'Automation/*' -or $changePath -like 'AutomationMonitor/*')
        })

        if ($blockingChanges.Count -gt 0) {
            throw "Tracked local changes exist outside automation tooling. Commit, stash, or revert them before running the automated sync.`n$($blockingChanges -join [Environment]::NewLine)"
        }

        if ($trackedChanges) {
            Write-Host 'Ignoring tracked changes under Automation/ and AutomationMonitor/ for sync safety check.'
        }

        $conflictingProcesses = @(Get-CimInstance Win32_Process | Where-Object {
            $_.ProcessId -ne $PID -and
            $_.CommandLine -like "*$RepoRoot*" -and
            ($_.CommandLine -like '*UnrealBuildTool.dll*' -or $_.CommandLine -like '*BuildGraph*' -or $_.CommandLine -like '*RunUAT.bat*')
        } | Select-Object ProcessId,Name,CommandLine)

        if ($conflictingProcesses.Count -gt 0) {
            $summary = ($conflictingProcesses | ForEach-Object { "PID $($_.ProcessId) $($_.Name): $($_.CommandLine)" }) -join [Environment]::NewLine
            throw "Another Unreal build/generation process is already running for this repository. Stop it or wait for it to finish before running automation.`n$summary"
        }
    }

    if (-not $SkipUpstreamSync) {
        Invoke-LoggedStep 'Configure upstream remote' {
            $remoteNames = & git remote
            if ($LASTEXITCODE -ne 0) {
                throw 'git remote failed.'
            }

            if ($remoteNames -contains $UpstreamRemote) {
                Invoke-Git remote set-url $UpstreamRemote $UpstreamUrl
            } else {
                Invoke-Git remote add $UpstreamRemote $UpstreamUrl
            }
        }
    } else {
        Write-Host 'Skipping upstream remote configuration because -SkipUpstreamSync was provided.'
    }

    Invoke-LoggedStep 'Fetch origin and upstream' {
        # -c http.version=HTTP/1.1: git's HTTP/2 multiplexing corrupts large packfiles on Windows
        # ("inflate: data stream error / invalid index-pack output"); force HTTP/1.1 on the network fetch.
        Invoke-Git -c http.version=HTTP/1.1 fetch --prune $OriginRemote $Branch
        if (-not $SkipUpstreamSync) {
            Invoke-Git -c http.version=HTTP/1.1 fetch --prune $UpstreamRemote $UpstreamBranch
        } else {
            Write-Host 'Skipping upstream fetch because -SkipUpstreamSync was provided.'
        }
    }

    Invoke-LoggedStep 'Checkout build branch' {
        $branchExists = $true
        & git rev-parse --verify --quiet $Branch | Out-Null
        if ($LASTEXITCODE -ne 0) {
            $branchExists = $false
        }

        if ($branchExists) {
            Invoke-Git checkout $Branch
        } else {
            Invoke-Git checkout -b $Branch "$OriginRemote/$Branch"
        }
    }

    if (-not $SkipUpstreamSync) {
        Invoke-LoggedStep 'Merge upstream into local branch' {
            if ($AllowMergeCommit) {
                Invoke-Git merge --no-edit "$UpstreamRemote/$UpstreamBranch"
            } else {
                Invoke-Git merge --ff-only "$UpstreamRemote/$UpstreamBranch"
            }
        }
    } else {
        Write-Host 'Skipping upstream merge because -SkipUpstreamSync was provided.'
    }

    if (-not $SkipPushOrigin) {
        Invoke-LoggedStep 'Push synced branch to fork origin' {
            Invoke-Git push $OriginRemote "${Branch}:${Branch}"
        }
    } else {
        Write-Host 'Skipping push to origin because -SkipPushOrigin was provided.'
    }

    if (-not $SkipDependencySync) {
        Invoke-LoggedStep 'Sync Unreal dependencies' {
            # ponytail: GitDependencies direct, not Setup.bat — Setup.bat also runs the VC++/GameInput installers (a UAC prompt each) and UnrealVersionSelector /register (a modal dialog) on EVERY run; those are one-time machine setup and block unattended builds.
            & cmd.exe /d /s /c "`"$RepoRoot\Engine\Binaries\DotNET\GitDependencies\win-x64\GitDependencies.exe`" --force < NUL"
            if ($LASTEXITCODE -ne 0) {
                throw "GitDependencies.exe failed with exit code $LASTEXITCODE"
            }
        }
    }

    if (-not $SkipGenerateProjectFiles) {
        Invoke-LoggedStep 'Generate project files' {
            & cmd.exe /d /s /c "`"$RepoRoot\GenerateProjectFiles.bat`" < NUL"
            if ($LASTEXITCODE -ne 0) {
                throw "GenerateProjectFiles.bat failed with exit code $LASTEXITCODE"
            }
        }
    }

    $preBuild = Join-Path $RepoRoot 'Automation\InstallBuild\_prebuild.bat'
    if (Test-Path $preBuild) {
        Invoke-LoggedStep 'Install build pre-processing' {
            & cmd.exe /d /s /c "`"$preBuild`" < NUL"
            if ($LASTEXITCODE -ne 0) {
                throw "_prebuild.bat failed with exit code $LASTEXITCODE"
            }
        }
    }

    $buildTimestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $script:buildExitCode = 0
    Invoke-LoggedStep 'Build Win64 installed engine' {
        $uat = Join-Path $RepoRoot 'Engine\Build\BatchFiles\RunUAT.bat'
        $buildArgs = @(
            'BuildGraph',
            '-script=Engine/Build/InstalledEngineBuild.xml',
            '-target=Make Installed Build Win64',
            '-set:HostPlatformOnly=true',
            "-set:WithDDC=$($WithDDC.ToString().ToLowerInvariant())",
            "-set:BuiltDirectory=$BuiltDirectory",
            '-set:AllowParallelExecutor=true'
        )

        if ($config['Build.HostPlatformEditorOnly']) { $buildArgs += "-set:HostPlatformEditorOnly=$($config['Build.HostPlatformEditorOnly'].ToLowerInvariant())" }
        # ponytail: embedded quotes required — the ';' in multi-config values is an argument separator to cmd when RunUAT.bat is invoked unquoted.
        if ($config['Build.GameConfigurations'])     { $buildArgs += "-set:GameConfigurations=`"$($config['Build.GameConfigurations'])`"" }
        if ($config['Build.WithClient'])             { $buildArgs += "-set:WithClient=$($config['Build.WithClient'].ToLowerInvariant())" }
        if ($config['Build.WithServer'])             { $buildArgs += "-set:WithServer=$($config['Build.WithServer'].ToLowerInvariant())" }

        if (-not $NoClean) {
            $buildArgs += '-clean'
        }

        $buildOutputLog = Join-Path $logDirectory ("InstalledBuild-{0}-output.log" -f $buildTimestamp)
        Write-Host "Build output log: $buildOutputLog"
        # ponytail: cmd-level redirect — a PS 5.1 transcript misses native output when stdout is piped, and an in-process 2>&1 wraps stderr lines into ErrorRecords under ErrorActionPreference=Stop.
        $flatArgs = ($buildArgs | ForEach-Object { if ($_ -match '\s' -and $_ -notlike '*"*') { "`"$_`"" } else { $_ } }) -join ' '
        & cmd.exe /d /s /c "`"$uat`" $flatArgs > `"$buildOutputLog`" 2>&1 < NUL"
        $script:buildExitCode = $LASTEXITCODE
    }

    $postBuild = Join-Path $RepoRoot 'Automation\InstallBuild\_postbuild.bat'
    if (Test-Path $postBuild) {
        Invoke-LoggedStep 'Install build post-processing' {
            $buildNumber = $config['Version.BuildNumber']
            if (-not $buildNumber -or $buildNumber -eq 'AUTO') { $buildNumber = $buildTimestamp }

            $env:BUILD_RESULT = "$script:buildExitCode"
            $env:BUILT_DIRECTORY = $BuiltDirectory
            $env:DISTRIBUTION_TYPE = "$($config['Distribution.DistributionType'])"
            $env:ENGINE_VERSION = "$($config['Version.EngineVersion'])"
            $env:BUILD_NUMBER = $buildNumber
            $env:BUILD_LABEL = "$($config['Version.BuildLabel'])"
            $env:BUILD_TIMESTAMP = $buildTimestamp
            $env:TARGET_PLATFORM = "$($config['Build.TargetPlatform'])"
            $env:GAME_CONFIGURATIONS = "$($config['Build.GameConfigurations'])"
            $env:HOST_PLATFORM_EDITOR_ONLY = "$($config['Build.HostPlatformEditorOnly'])"
            $env:WITH_DDC = $WithDDC.ToString().ToLowerInvariant()
            $env:BUILD_LOG_DIR = if ($config['Paths.LogDirectory']) { $config['Paths.LogDirectory'] } else { 'LocalBuilds\Logs' }

            & cmd.exe /d /s /c "`"$postBuild`" < NUL"
            if ($LASTEXITCODE -ne 0 -and $script:buildExitCode -eq 0) {
                throw "_postbuild.bat failed with exit code $LASTEXITCODE"
            }
        }
    }

    if ($script:buildExitCode -ne 0) {
        throw "Installed build failed with exit code $script:buildExitCode"
    }
} finally {
    Pop-Location
    Stop-Transcript | Out-Null
}

