[CmdletBinding()]
param([string]$BuiltDirectory = $env:BUILT_DIRECTORY)

$ErrorActionPreference = 'Stop'
try {
    if ([string]::IsNullOrWhiteSpace($BuiltDirectory)) { throw 'BUILT_DIRECTORY is required.' }
    $root = (Get-Item -LiteralPath $BuiltDirectory).FullName
    $source = Join-Path $root 'Windows'
    $targetEngine = Join-Path $root 'Engine'
    if (-not (Test-Path -LiteralPath $source)) {
        if (-not (Test-Path -LiteralPath $targetEngine -PathType Container)) {
            throw "No installed Engine directory found in '$root' or '$source'."
        }
        Write-Host "Installed build already finalized: $root"
        exit 0
    }
    foreach ($directory in @($root, $source)) {
        if ((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing to move through a reparse point: $directory"
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $source 'Engine') -PathType Container) -and
        -not (Test-Path -LiteralPath $targetEngine -PathType Container)) {
        throw "Installed Engine directory is missing: $source"
    }

    $entries = @(Get-ChildItem -LiteralPath $source -Force)
    # Validate every destination before moving anything. Never delete or merge existing output.
    foreach ($entry in $entries) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing to move a reparse point: $($entry.FullName)"
        }
        $target = Join-Path $root $entry.Name
        if (Test-Path -LiteralPath $target) {
            throw "Destination already exists; both outputs preserved. Source: '$($entry.FullName)'; destination: '$target'. Resolve the collision before retrying."
        }
    }
    foreach ($entry in $entries) {
        $target = Join-Path $root $entry.Name
        Write-Host "Moving '$($entry.FullName)' -> '$target'"
        # Same-parent rename: no recursive copying or deletion of engine content.
        if ($entry.PSIsContainer) { [IO.Directory]::Move($entry.FullName, $target) }
        else { [IO.File]::Move($entry.FullName, $target) }
        Write-Host "Moved: $target"
    }
    [IO.Directory]::Delete($source, $false) # Only remove an empty Windows directory.
    Write-Host "Installed build finalized: $root"
    exit 0
} catch {
    Write-Host "[ERROR] Installed build finalization failed: $($_.Exception.ToString())"
    Write-Host "[ERROR] Category: $($_.CategoryInfo); target: $($_.TargetObject)"
    exit 1
}
