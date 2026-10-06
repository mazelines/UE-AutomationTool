function Restart-AsAdministrator {
    param([string]$ScriptPath, [hashtable]$BoundParameters)
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { return }
    Write-Host '[admin] Administrator permission required. Approve the Windows UAC prompt.'
    $launchArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $ScriptPath))
    foreach ($key in $BoundParameters.Keys) {
        if ($BoundParameters[$key] -is [Management.Automation.SwitchParameter] -and $BoundParameters[$key].IsPresent) {
            $launchArguments += "-$key"
        }
    }
    try {
        $elevated = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList $launchArguments -PassThru -Wait
        exit $elevated.ExitCode
    } catch { throw 'Administrator launch failed or UAC was cancelled. Run the launcher as administrator.' }
}
