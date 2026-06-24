# Download and extract the latest FTC Sim Windows release from GitHub
$ErrorActionPreference = "Stop"
$releaseDir = Join-Path (Split-Path $PSScriptRoot -Parent) "release"
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

$api = Invoke-RestMethod -Uri "https://api.github.com/repos/Pleasantnoob/VibeCodedFTCSIM/releases/latest"
$asset = $api.assets | Where-Object { $_.name -eq "FTC-Sim-win-x64.zip" } | Select-Object -First 1
if (-not $asset) { throw "FTC-Sim-win-x64.zip not found in latest release." }

$zip = Join-Path $releaseDir $asset.name
Write-Host "Downloading $($api.tag_name): $($asset.name) ($([math]::Round($asset.size / 1MB)) MB)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing

Write-Host "Extracting to $releaseDir ..."
tar -xf $zip -C $releaseDir
Write-Host "Done. Run ..\start.ps1 or release\FTC Sim\FTC Sim.exe"
