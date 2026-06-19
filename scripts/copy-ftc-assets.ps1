# Sync FTC Live v7.5.0 public assets into the sim (audio, fonts, overlays, video, bundle).
$ErrorActionPreference = 'Stop'

$sources = @(
  (Join-Path $env:LOCALAPPDATA 'firstinspires\ftclive-2026-default\data\public'),
  (Join-Path $env:USERPROFILE 'Documents\FIRST Tech Challenge Live\DECODE (2026)\public')
)

$src = $sources | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $src) {
  Write-Host 'FTC Live public assets not found. Launch FTCLive 2026 once, then re-run.'
  Write-Host 'Expected: %LOCALAPPDATA%\firstinspires\ftclive-2026-default\data\public'
  exit 1
}

$root = Join-Path $PSScriptRoot '..'
$dest = Join-Path $root 'apps\web\public\ftc-live'
$vendor = Join-Path $root 'vendor\ftc-live-assets'
New-Item -ItemType Directory -Force -Path $dest, $vendor | Out-Null

robocopy $src $dest /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
robocopy $src $vendor /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null

$audio = Join-Path $dest 'audio'
$aliases = @{
  '3-2-1-02d002f8c74568631e6dc9990c9537f4.wav' = '3-2-1.wav'
  'endauto-bcea0449f8e32349de8b72fa1688f0cf.wav' = 'endauto.wav'
  'endauto_with_warning-76b904702aaed301b49f0bdee3de5fcb.wav' = 'endauto_with_warning.wav'
  'endmatch-8f2d86fb5bcc3cae5d0adc2c27b64f93.wav' = 'endmatch.wav'
  'charge-d9f8185a64572b9f7eef9a20e4d4b5b1.wav' = 'charge.wav'
  'firebell-2f4e0af105ee5b70746e61c4f3faac96.wav' = 'firebell.wav'
  'factwhistle-a6f08240d8c31040e3d400204ed65304.wav' = 'factwhistle.wav'
  'results-9b4cddbef8bc2b6a2eba772704cf0754.wav' = 'results.wav'
  'fogblast-ef516f3364f46f67c6ffdea072b9c2b0.wav' = 'fogblast.wav'
  'unmute-490ab2286bb591e6ceabe812ce2db8db.wav' = 'unmute.wav'
}

foreach ($entry in $aliases.GetEnumerator()) {
  $from = Join-Path $audio $entry.Key
  if (Test-Path $from) {
    Copy-Item $from (Join-Path $audio $entry.Value) -Force
  }
}

$count = (Get-ChildItem $dest -Recurse -File).Count
$mb = [math]::Round(((Get-ChildItem $dest -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host "Synced $count files ($mb MB) from:`n  $src`nto:`n  $dest"
