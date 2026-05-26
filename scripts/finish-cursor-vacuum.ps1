# Finishes a failed prune: deletes duplicate backup, then VACUUMs state.vscdb.
# Run in an external PowerShell window after File > Exit in Cursor.

$ErrorActionPreference = "Stop"
$py = Join-Path $PSScriptRoot "finish-cursor-vacuum.py"

Write-Host ""
Write-Host "Cursor: finish VACUUM (free ~50+ GB on C:)" -ForegroundColor Cyan
Write-Host "  1. Save work, then File > Exit in Cursor" -ForegroundColor Yellow
Write-Host "  2. This window runs when Cursor has exited" -ForegroundColor Yellow
Write-Host ""

$waited = 0
while (Get-Process -Name "Cursor*" -ErrorAction SilentlyContinue) {
    if ($waited -eq 0) { Write-Host "Waiting for Cursor to exit..." }
    Start-Sleep -Seconds 2
    $waited += 2
}

Write-Host "Cursor exited. Compacting database..." -ForegroundColor Green
python $py
$code = $LASTEXITCODE

Write-Host ""
if ($code -eq 0) {
    Write-Host "Success. Reopen Cursor." -ForegroundColor Green
} else {
    Write-Host "Failed. See log: $env:TEMP\cursor-finish-vacuum.log" -ForegroundColor Red
}

Write-Host ""
Write-Host "Press Enter to close..."
Read-Host
