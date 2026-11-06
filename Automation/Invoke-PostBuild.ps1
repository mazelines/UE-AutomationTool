function Invoke-InstalledBuildPostProcessing {
    param([string]$ScriptPath, [string]$LogPath)
    Write-Host "Post-processing output log: $LogPath"
    & cmd.exe /d /s /c "`"$ScriptPath`" > `"$LogPath`" 2>&1 < NUL"
    $postExitCode = $LASTEXITCODE
    # Native child output is otherwise absent from PowerShell 5.1 transcripts.
    if (Test-Path -LiteralPath $LogPath) {
        Get-Content -LiteralPath $LogPath -Tail 60 | ForEach-Object { Write-Host $_ }
    }
    if ($postExitCode -ne 0) {
        Write-Host "Post-processing exited with code $postExitCode; full stdout/stderr: $LogPath"
    }
    return $postExitCode
}
