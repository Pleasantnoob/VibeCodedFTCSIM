# Launch FTC Sim (local build with fullscreen support)
$built = Join-Path $PSScriptRoot "apps\desktop\release\FTC-Sim\FTC Sim.exe"
$release = Join-Path $PSScriptRoot "release\FTC Sim\FTC Sim.exe"
$exe = if (Test-Path $built) { $built } elseif (Test-Path $release) { $release } else { $null }
if (-not $exe) {
    Write-Error "FTC Sim.exe not found. Run: pnpm build:desktop"
    exit 1
}
Start-Process -FilePath $exe
