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

$scriptDirectory = Split-Path -Parent $PSCommandPath

# This script now ships separately from the UE clone it builds (previously $scriptDirectory\..
# WAS the clone); the target repo must be passed explicitly, normally by AutomationMonitor
# via the currently selected/active repo (see server/repos.js).
if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    throw "-RepoRoot is required (the UE clone to sync/build) — it is no longer inferred from this script's location."
}

function Invoke-LoggedStep {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$ScriptBlock
    )

    # ponytail: the DONE label must never be printed for a failed step — a "DONE (42s)" on a
    # failing step misled the post-mortem diagnosis (2026-10-05, SCC blocked SteamDeck.Automation.dll).
    # Emit DONE with the exit code when the step succeeds, FAILED when the scriptblock throws,
    # then rethrow so the transcript carries both the failing step and the original error.
    $startedAt = Get-Date
    Write-Host "[$($startedAt.ToString('yyyy-MM-dd HH:mm:ss'))] START $Name"
    try {
        & $ScriptBlock
    } catch {
        $finishedAt = Get-Date
        # Message goes on its own MSG line: exception text can contain ")/s)-like" tails that
        # would corrupt the "(Ns)" duration suffix parsing of the FAILED line itself.
        Write-Host "[$($finishedAt.ToString('yyyy-MM-dd HH:mm:ss'))] FAILED $Name ($([int]($finishedAt - $startedAt).TotalSeconds)s)"
        Write-Host "[$($finishedAt.ToString('yyyy-MM-dd HH:mm:ss'))] FAILED-MSG $($_.Exception.Message.Replace("`r", ' ').Replace("`n", ' '))"
        throw
    }
    $finishedAt = Get-Date
    Write-Host "[$($finishedAt.ToString('yyyy-MM-dd HH:mm:ss'))] DONE  $Name ($([int]($finishedAt - $startedAt).TotalSeconds)s)"
}

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    # Native stderr is otherwise missing from PS 5.1 transcripts when the monitor
    # redirects the wrapper process. Render it as host output for AI diagnosis.
    $ErrorActionPreference = 'Continue'
    & git @Arguments 2>&1 | ForEach-Object { Write-Host $_.ToString() }
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

# Settings live in <repo>/LocalBuilds/AutomationMonitor/workspace.json (build section, flat
# "Section.Key" map, written by the Node server per selected repo); the legacy
# install_build_config.ini path is kept as a fallback for old branches.
$workspacePath = Join-Path $RepoRoot 'LocalBuilds\AutomationMonitor\workspace.json'
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
# Logging.Verbose (UI "Verbose Log" toggle) drives RunUAT/BuildGraph -Verbose and extra console
# detail. Defaults to true to match the historical saved value and aid first-run debugging.
$Verbose = if ($config['Logging.Verbose']) { [System.Convert]::ToBoolean($config['Logging.Verbose']) } else { $true }

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
    Write-Host "Verbose: $($Verbose.ToString().ToLowerInvariant())"
    Write-Host "Log: $logPath"

    Push-Location $RepoRoot

    # ponytail: Smart App Control "On" blocks loading unsigned locally built .NET assemblies
    # (SteamDeck.Automation.dll → 0x800711C7 at "Initializing script modules"), so the installed
    # build can never start AutomationTool. Fail in seconds with an actionable message instead of
    # an obscure policy error deep in BuildGraph. The setting must be changed manually in
    # Windows Security → App & browser control → Smart App Control settings.
    Invoke-LoggedStep 'Check application control policy' {
        $sccState = $null
        try { $sccState = (Get-MpComputerStatus -ErrorAction Stop).SmartAppControlState } catch { }
        # The CI Policy registry value is only a hint (it can read stale after SCC was disabled);
        # Get-MpComputerStatus is the authoritative live state, so it alone gates the hard failure.
        $ciPolicy = $null
        try {
            $raw = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -ErrorAction Stop).VerifiedAndReputablePolicyState
            $ciPolicy = @{ 0 = 'Off'; 1 = 'On'; 2 = 'Eval' }[[int]$raw]
        } catch { }
        Write-Host "Smart App Control state: $sccState (CI policy hint: $ciPolicy)"
        if ($sccState -eq 'On') {
            throw "Smart App Control is ON — Windows blocks loading the unsigned locally built AutomationTool script DLLs (0x800711C7). Turn it off (Windows Security → App & browser control → Smart App Control settings → Off), then rerun the build."
        }
        if ($sccState -eq 'Eval') {
            Write-Host 'WARNING: Smart App Control is in evaluation mode; unsigned build output may be blocked intermittently.'
        }
    }

    Invoke-LoggedStep 'Validate repository state' {
        Invoke-Git rev-parse --is-inside-work-tree | Out-Null

        # Template projects' Config/DefaultEngine.ini are rewritten by editor/build runs and
        # always resurface as tracked changes, blocking the sync. Discard them every run so
        # the working tree is clean before fetch/merge — they are build-generated, not authored.
        $templateChanges = @(& git status --porcelain --untracked-files=no -- Templates)
        if ($templateChanges.Count -gt 0) {
            & git checkout -- Templates
            Write-Host "Discarded $($templateChanges.Count) tracked change(s) under Templates/ before sync."
        }

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

    $releaseBaseCommit = (& git rev-parse HEAD)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve release notes base commit.' }
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

    # ponytail: a conflict "resolved" by committing the markers verbatim (NessUObjectBindings.cpp,
    # 2026-07-24) survives every later merge and is only caught by the compiler ~90 minutes in.
    # Scan tracked text files before push/build so a bad merge fails the run in seconds — and never
    # reaches origin. Runs even with -SkipUpstreamSync: manual merges break builds just the same.
    Invoke-LoggedStep 'Check for merge conflict markers' {
        $markerFiles = @(& git grep -l -E "^(<{7}|>{7}) " -- "*.cpp" "*.h" "*.hpp" "*.c" "*.cc" "*.cxx" "*.inl" "*.cs" "*.usf" "*.ush" "*.verse" "*.py" "*.bat" "*.ps1" "*.xml" "*.ini" "*.json" "*.md" "*.txt" 2>$null)
        if ($markerFiles.Count -gt 0) {
            throw "Unresolved merge conflict markers found in $($markerFiles.Count) file(s). Resolve them before building:`n$($markerFiles -join [Environment]::NewLine)"
        }
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

    # _prebuild.bat/_postbuild.bat ship with this script (Automation/InstallBuild), not with
    # the target repo — resolve them relative to $scriptDirectory, and hand the target repo
    # to them via REPO_ROOT since they can no longer infer it from their own location either.
    $env:REPO_ROOT = $RepoRoot
    $preBuild = Join-Path $scriptDirectory 'InstallBuild\_prebuild.bat'
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
    $postBuild = Join-Path $scriptDirectory 'InstallBuild\_postbuild.bat'

    # ponytail: _postbuild.bat saves the build summary for FAILED builds too (it reads
    # BUILD_RESULT), so the env must be ready before the build step and the catch below runs
    # post-processing even when the build step throws.
    $env:BUILD_RESULT = '0'
    $env:BUILT_DIRECTORY = $BuiltDirectory
    $env:DISTRIBUTION_TYPE = "$($config['Distribution.DistributionType'])"
    $env:ENGINE_VERSION = "$($config['Version.EngineVersion'])"
    $buildNumber = $config['Version.BuildNumber']
    if (-not $buildNumber -or $buildNumber -eq 'AUTO') { $buildNumber = $buildTimestamp }
    $env:BUILD_NUMBER = $buildNumber
    $env:BUILD_LABEL = "$($config['Version.BuildLabel'])"
    $env:BUILD_TIMESTAMP = $buildTimestamp
    $env:TARGET_PLATFORM = "$($config['Build.TargetPlatform'])"
    $env:GAME_CONFIGURATIONS = "$($config['Build.GameConfigurations'])"
    $env:HOST_PLATFORM_EDITOR_ONLY = "$($config['Build.HostPlatformEditorOnly'])"
    $env:WITH_DDC = $WithDDC.ToString().ToLowerInvariant()
    $env:VERBOSE = $Verbose.ToString().ToLowerInvariant()
    $env:BUILD_LOG_DIR = if ($config['Paths.LogDirectory']) { $config['Paths.LogDirectory'] } else { 'LocalBuilds\Logs' }

    try {
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
        if ($Verbose) {
            $buildArgs += '-Verbose'
        }

        $buildOutputLog = Join-Path $logDirectory ("InstalledBuild-{0}-output.log" -f $buildTimestamp)
        Write-Host "Build output log: $buildOutputLog"
        if ($Verbose) {
            Write-Host "BuildGraph args: $($buildArgs -join ' ')"
        }
        # ponytail: cmd-level redirect — a PS 5.1 transcript misses native output when stdout is piped, and an in-process 2>&1 wraps stderr lines into ErrorRecords under ErrorActionPreference=Stop.
        $flatArgs = ($buildArgs | ForEach-Object { if ($_ -match '\s' -and $_ -notlike '*"*') { "`"$_`"" } else { $_ } }) -join ' '
        try {
            & cmd.exe /d /s /c "`"$uat`" $flatArgs > `"$buildOutputLog`" 2>&1 < NUL"
        } finally {
            # ponytail: capture $LASTEXITCODE in finally — if cmd.exe itself fails to launch, the
            # statement throws before the assignment runs and the exit code would default to 0.
            $script:buildExitCode = if ($LASTEXITCODE) { $LASTEXITCODE } else { 0 }
        }
        if ($script:buildExitCode -ne 0) {
            # Fail the step immediately (FAILED label + monitor) instead of printing DONE and
            # letting the run limp to a late generic throw. The wrapper catch runs _postbuild.bat.
            throw "BuildGraph (RunUAT) exited with code $script:buildExitCode — see $buildOutputLog"
        }
    }
    } catch {
        if ($script:buildExitCode -eq 0) { $script:buildExitCode = 1 }
        $env:BUILD_RESULT = "$script:buildExitCode"
        if (Test-Path $postBuild) {
            Write-Host 'Build step failed — running post-processing to save the failure summary.'
            & cmd.exe /d /s /c "`"$postBuild`" < NUL"
        }
        throw
    }

    if (Test-Path $postBuild) {
        Invoke-LoggedStep 'Install build post-processing' {
            # Environment (BUILD_RESULT etc.) was set before the build step so the failed-build
            # catch path can run this same script for its failure summary.
            & cmd.exe /d /s /c "`"$postBuild`" < NUL"
            if ($LASTEXITCODE -ne 0 -and $script:buildExitCode -eq 0) {
                throw "_postbuild.bat failed with exit code $LASTEXITCODE"
            }
        }
    }

    if ($script:buildExitCode -ne 0) {
        throw "Installed build failed with exit code $script:buildExitCode"
    }
    Invoke-LoggedStep 'Write release notes' {
        $releaseHead = (& git rev-parse HEAD)
        if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve release notes head commit.' }
        $notesDirectory = if ($config['Paths.LogDirectory']) { $config['Paths.LogDirectory'] } else { 'LocalBuilds\Logs' }
        if (-not [System.IO.Path]::IsPathRooted($notesDirectory)) { $notesDirectory = Join-Path $RepoRoot $notesDirectory }
        New-Item -ItemType Directory -Force -Path $notesDirectory | Out-Null
        $previousEncoding = [Console]::OutputEncoding
        try {
            [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
            $commits = @(& git -c i18n.logOutputEncoding=utf-8 log --reverse '--format=commit %h%nAuthor: %an%nDate: %aI%n%B' "$releaseBaseCommit..$releaseHead")
            if ($LASTEXITCODE -ne 0) { throw 'Cannot read release commit list.' }
            $changedFiles = @(& git -c core.quotepath=false diff --name-status $releaseBaseCommit $releaseHead)
            if ($LASTEXITCODE -ne 0) { throw 'Cannot read release changed files.' }
        } finally { [Console]::OutputEncoding = $previousEncoding }
        $notes = @(
            "Installed Build Release Notes - $buildTimestamp",
            "Branch: $Branch", "Upstream: $UpstreamRemote/$UpstreamBranch",
            "Before merge: $releaseBaseCommit", "Built commit: $releaseHead", '',
            'Merged commits:', $(if ($commits.Count) { $commits } else { 'No new commits (upstream sync skipped or already up to date).' }), '',
            'Changed files:', $(if ($changedFiles.Count) { $changedFiles } else { 'No file changes.' })
        )
        $notesPath = Join-Path $notesDirectory "releasseNote_$buildTimestamp.txt"
        [System.IO.File]::WriteAllLines($notesPath, [string[]]$notes, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "Release notes: $notesPath"
    }
} finally {
    Pop-Location
    Stop-Transcript | Out-Null
}

