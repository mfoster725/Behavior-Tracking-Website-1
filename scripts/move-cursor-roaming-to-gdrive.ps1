# Move %APPDATA%\Cursor to Google Drive and junction the original path back.
# Requires: Cursor fully quit. Google Drive (G:) available.
# Run: powershell -ExecutionPolicy Bypass -File .\scripts\move-cursor-roaming-to-gdrive.ps1

$ErrorActionPreference = "Stop"
$source = "$env:APPDATA\Cursor"
$target = "G:\My Drive\Apps\Cursor\Roaming"
$backup = Join-Path $source "User\globalStorage\state.vscdb.backup"

if (Get-Process -Name "Cursor*" -ErrorAction SilentlyContinue) {
    Write-Error "Close Cursor completely (File > Exit), then run this script again."
}

if (-not (Test-Path "G:\My Drive")) {
    Write-Error "Google Drive (G:\My Drive) is not available. Open Google Drive and retry."
}

$item = Get-Item $source -Force -ErrorAction SilentlyContinue
if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    Write-Host "Already a junction: $source -> $($item.Target)"
    exit 0
}

if (Test-Path $target) {
    Write-Error "Target already exists: $target. Remove it manually if this is a failed prior run."
}

if (Test-Path $backup) {
    Write-Host "Removing duplicate DB backup (~29 GB): $backup"
    Remove-Item -LiteralPath $backup -Force
}

New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
Write-Host "Moving Roaming data to Google Drive (may take a while)..."
Write-Host "  From: $source"
Write-Host "  To:   $target"

$log = Join-Path $env:TEMP "cursor-roaming-move.log"
$rc = robocopy $source $target /E /COPYALL /MOV /R:2 /W:5 /MT:8 /LOG:$log /NP
# Robocopy: 0-7 = success with files copied
if ($rc -ge 8) {
    Write-Error "Robocopy failed (exit $rc). See $log"
}

$left = Get-ChildItem $source -Force -ErrorAction SilentlyContinue
if ($left -and $left.Count -gt 0) {
    Write-Error "Source not empty after move. See $log"
}

Remove-Item -LiteralPath $source -Force -Recurse -ErrorAction SilentlyContinue
cmd /c mklink /J "$source" "$target"

Write-Host ""
Write-Host "Done. Roaming now lives on Google Drive at:" -ForegroundColor Green
Write-Host "  $target"
Write-Host "  Linked from: $source"
Write-Host ""
Write-Host "Recommended in Google Drive (File Explorer):" -ForegroundColor Yellow
Write-Host "  Right-click G:\My Drive\Apps\Cursor -> Google Drive -> Online only"
Write-Host "  (keeps files in the cloud; Cursor may re-download DBs when opened)"
Write-Host ""
Write-Host "Warning: Do not open Cursor on two PCs at once on the same folder." -ForegroundColor Yellow
Write-Host "Log: $log"
