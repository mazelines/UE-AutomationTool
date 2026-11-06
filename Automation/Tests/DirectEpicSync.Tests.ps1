param([Parameter(Mandatory = $true)][string]$TestRoot)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\Sync-DirectEpic.ps1')
function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & git @Arguments
    if ($LASTEXITCODE -ne 0) { throw "git failed: $Arguments" }
}
function Invoke-LoggedStep { param($Name, $ScriptBlock) & $ScriptBlock }
function Assert-True { param($Condition, $Message) if (-not $Condition) { throw $Message } }

New-Item -ItemType Directory -Path $TestRoot -Force | Out-Null
Set-Location $TestRoot
Invoke-Git init --bare remote.git
Invoke-Git clone remote.git author
Set-Location author
Invoke-Git config user.name Test
Invoke-Git config user.email test@example.invalid
Set-Content base.txt base
Invoke-Git add .
Invoke-Git commit -m base
Invoke-Git branch -M main
Invoke-Git push origin main
Set-Location ..
Invoke-Git clone --branch main remote.git build
Set-Location build
Invoke-Git config user.name Test
Invoke-Git config user.email test@example.invalid
$remoteUrl = & git remote get-url origin
Invoke-DirectEpicSync -ExpectedUrl $remoteUrl -LocalBranch local-build
Set-Content patch.txt patch
Invoke-Git add .
Invoke-Git commit -m patch
Set-Location ../author
Set-Content upstream.txt update
Invoke-Git add .
Invoke-Git commit -m update
Invoke-Git push origin main
$remoteHead = & git rev-parse HEAD
Set-Location ../build
Invoke-DirectEpicSync -ExpectedUrl $remoteUrl -LocalBranch local-build
Assert-True ((Test-Path patch.txt) -and (Test-Path upstream.txt)) 'Patch or upstream update lost.'
Assert-True ((& git rev-parse HEAD~1) -eq $remoteHead) 'Patch was not rebased on latest Epic commit.'
$head = & git rev-parse HEAD
Invoke-DirectEpicSync -ExpectedUrl $remoteUrl -LocalBranch local-build
Assert-True ((& git rev-parse HEAD) -eq $head) 'Repeat run changed the patch commit.'
Assert-True ((& git --git-dir=$remoteUrl rev-parse refs/heads/main) -eq $remoteHead) 'Remote was modified.'
$rejected = $false
try { Invoke-DirectEpicSync -ExpectedUrl 'wrong-url' -LocalBranch local-build } catch { $rejected = $true }
Assert-True $rejected 'Mismatched remote URL was accepted.'
Assert-True ((& git remote get-url origin) -eq $remoteUrl) 'Existing remote URL was changed.'
Set-Content patch.txt uncommitted
$rejected = $false
try { Invoke-DirectEpicSync -ExpectedUrl $remoteUrl -LocalBranch local-build } catch { $rejected = $true }
Assert-True $rejected 'Uncommitted changes were accepted.'
Assert-True ((Get-Content patch.txt) -eq 'uncommitted') 'Uncommitted change was lost.'
Invoke-Git restore patch.txt

# A conflicting patch must stop rather than proceed to a build or drop the patch.
Set-Content base.txt local
Invoke-Git add .
Invoke-Git commit -m conflict-local
Set-Location ../author
Set-Content base.txt upstream
Invoke-Git add .
Invoke-Git commit -m conflict-upstream
Invoke-Git push origin main
Set-Location ../build
$rejected = $false
try { Invoke-DirectEpicSync -ExpectedUrl $remoteUrl -LocalBranch local-build } catch { $rejected = $true }
Assert-True $rejected 'Conflicting patches did not stop the workflow.'
Assert-True ([bool](& git diff --name-only --diff-filter=U)) 'Conflict state was not preserved.'
Invoke-Git rebase --abort
Write-Host 'PASS: first run, patch preservation, repeat run, no push, URL validation, dirty tree, conflict stop.'
