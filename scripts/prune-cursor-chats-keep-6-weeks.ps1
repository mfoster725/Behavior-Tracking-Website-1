# Waits for Cursor to exit, then prunes chat/state older than 6 weeks.
# Runs in a separate window so it survives after you close Cursor.

$ErrorActionPreference = "Stop"
$py = Join-Path $PSScriptRoot "prune-cursor-chats-keep-weeks.py"

Write-Host ""
Write-Host "Cursor 6-week chat cleanup" -ForegroundColor Cyan
Write-Host "  Keeps: chats/composers from the last 6 weeks"
Write-Host "  Removes: older chats + unreferenced agent cache blobs"
Write-Host "  Then shrinks state.vscdb with VACUUM"
Write-Host ""
Write-Host ">>> Save work, then File > Exit in Cursor." -ForegroundColor Yellow
Write-Host ""

$waited = 0
while (Get-Process -Name "Cursor*" -ErrorAction SilentlyContinue) {
    if ($waited -eq 0) {
        Write-Host "Waiting for Cursor to exit..."
    }
    Start-Sleep -Seconds 2
    $waited += 2
    if (($waited % 30) -eq 0) {
        Write-Host "Still waiting... ($waited s)"
    }
}

$finishPy = Join-Path $PSScriptRoot "finish-cursor-vacuum.py"
$log = Join-Path $env:TEMP "cursor-prune-6weeks.log"
$alreadyPruned = $false
if (Test-Path $log) {
    $tail = Get-Content $log -Tail 30 -ErrorAction SilentlyContinue
    if ($tail -match "Deleted \d+ orphan agentKv" -and $tail -match "database or disk is full") {
        $alreadyPruned = $true
    }
}

if ($alreadyPruned) {
    Write-Host "Prune deletes already done (VACUUM failed earlier). Running finish-vacuum only..." -ForegroundColor Yellow
    python $finishPy
    $code = $LASTEXITCODE
} else {
    Write-Host "Cursor exited. Starting prune..." -ForegroundColor Green
    python $py
    $code = $LASTEXITCODE
    if ($code -ne 0 -and (Test-Path $finishPy)) {
        Write-Host ""
        Write-Host "Prune failed. Retrying with finish-vacuum (delete backup + compact)..." -ForegroundColor Yellow
        python $finishPy
        $code = $LASTEXITCODE
    }
}

Write-Host ""
if ($code -eq 0) {
    Write-Host "Success. Reopen Cursor." -ForegroundColor Green
} else {
    Write-Host "Failed. See: $env:TEMP\cursor-prune-6weeks.log and $env:TEMP\cursor-finish-vacuum.log" -ForegroundColor Red
}

Write-Host ""
Write-Host "Press Enter to close..."
Read-Host
