# Shared by the build wrapper and isolated Git integration tests.
# The caller provides Invoke-Git and Invoke-LoggedStep and selects the repository cwd.
function Invoke-DirectEpicSync {
    param(
        [string]$ExpectedUrl = 'https://github.com/EpicGames/UnrealEngine.git',
        [string]$LocalBranch
    )

    foreach ($state in @('rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD')) {
        $statePath = & git rev-parse --git-path $state
        if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Git operation state.' }
        if (Test-Path -LiteralPath $statePath) {
            throw 'An unfinished Git operation exists. Finish or abort it before Epic direct sync.'
        }
    }
    $changes = & git status --porcelain --untracked-files=no
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect tracked changes.' }
    if ($changes) { throw 'Commit local patches before Epic direct sync; tracked working tree must be clean.' }

    $source = @{}
    Invoke-LoggedStep 'Fetch Epic source' {
        Invoke-Git check-ref-format --branch $LocalBranch
        & git show-ref --verify --quiet "refs/heads/$LocalBranch"
        if ($LASTEXITCODE -eq 0) {
            $trackingBranch = $LocalBranch
        } elseif ($LASTEXITCODE -eq 1) {
            $trackingBranch = & git symbolic-ref --quiet --short HEAD
            if ($LASTEXITCODE -ne 0) { throw 'Epic direct mode requires a checked-out clone branch with remote tracking.' }
        } else { throw 'Cannot inspect the build branch.' }
        $Remote = & git for-each-ref '--format=%(upstream:remotename)' "refs/heads/$trackingBranch"
        if ($LASTEXITCODE -ne 0) { throw 'Cannot read the clone tracking remote.' }
        $remoteRef = & git for-each-ref '--format=%(upstream:remoteref)' "refs/heads/$trackingBranch"
        if ($LASTEXITCODE -ne 0) { throw 'Cannot read the clone tracking branch.' }
        if (-not $Remote -or $Remote -eq '.' -or -not $remoteRef -or -not $remoteRef.StartsWith('refs/heads/')) {
            throw "Branch '$trackingBranch' has no remote tracking branch. Set its Git upstream to the cloned Epic branch before running."
        }
        $RemoteBranch = $remoteRef.Substring('refs/heads/'.Length)
        Invoke-Git check-ref-format --branch $RemoteBranch
        $existingUrl = & git remote get-url $Remote
        if ($LASTEXITCODE -ne 0) { throw 'Cannot read Epic remote URL.' }
        if ($existingUrl -ne $ExpectedUrl) {
            throw "Clone tracking remote '$Remote' points to '$existingUrl', expected '$ExpectedUrl'. Select an Epic clone."
        }
        Write-Host "Epic clone tracking: $trackingBranch -> $Remote/$RemoteBranch"
        $source.Remote = $Remote
        $source.RemoteBranch = $RemoteBranch
        # Explicit refspec also works with a single-branch clone's restricted fetch configuration.
        Invoke-Git -c http.version=HTTP/1.1 fetch --no-tags $Remote "refs/heads/${RemoteBranch}:refs/remotes/${Remote}/${RemoteBranch}"
    }

    $Remote = $source.Remote
    $RemoteBranch = $source.RemoteBranch
    Invoke-LoggedStep 'Reapply local patches on Epic source' {
        & git show-ref --verify --quiet "refs/heads/$LocalBranch"
        if ($LASTEXITCODE -eq 0) {
            Invoke-Git checkout $LocalBranch
        } elseif ($LASTEXITCODE -eq 1) {
            Invoke-Git checkout --track -b $LocalBranch "refs/remotes/$Remote/$RemoteBranch"
        } else {
            throw 'Cannot inspect the local build branch.'
        }
        $script:releaseBaseCommit = & git rev-parse HEAD
        if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve release notes base commit.' }
        # Keep patch commits locally; neither the Epic remote nor a fork receives a push.
        # Disable user autostash so unattended runs never hide authored changes.
        try {
            Invoke-Git -c rebase.autoStash=false rebase --rebase-merges "refs/remotes/$Remote/$RemoteBranch"
        } catch {
            throw "Epic patch rebase failed. Resolve conflicts and run git rebase --continue, or git rebase --abort, then retry. $($_.Exception.Message)"
        }
    }
}
