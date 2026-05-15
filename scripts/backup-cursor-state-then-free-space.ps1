# Backs up state.vscdb (+ wal/shm) to Google Drive, then deletes state.vscdb.backup (~29 GB).
# Runs in a SEPARATE PowerShell window so it continues after you close Cursor.
#
# How to use:
#   1. A window will open (or run this file yourself in PowerShell).
#   2. Save work, then File > Exit in Cursor (do not use Task Manager unless needed).
#   3. This script waits until Cursor exits, then copies and deletes the backup.

$ErrorActionPreference = "Stop"

$gs = "$env:APPDATA\Cursor\User\globalStorage"
$backupFile = Join-Path $gs "state.vscdb.backup"
$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$dest = "G:\My Drive\Backups\Cursor\$stamp"
$log = Join-Path $env:TEMP "cursor-backup-free-space.log"

function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $log -Value $line
    Write-Host $line
}

function Wait-ForCursorExit {
    $waited = 0
    while (Get-Process -Name "Cursor*" -ErrorAction SilentlyContinue) {
        if ($waited -eq 0) {
            Write-Host ""
            Write-Host ">>> Close Cursor now: File > Exit (save your work first)." -ForegroundColor Yellow
            Write-Host ">>> This window will continue automatically when Cursor has exited." -ForegroundColor Yellow
            Write-Host ""
        }
        Start-Sleep -Seconds 2
        $waited += 2
        if (($waited % 30) -eq 0) {
            Write-Host "Still waiting for Cursor to exit... ($waited s)"
        }
    }
}

try {
    Write-Log "Starting Cursor backup + free-space script"
    Write-Log "Log file: $log"

    if (-not (Test-Path "G:\My Drive")) {
        throw "Google Drive not found at G:\My Drive. Open Google Drive and run this script again."
    }

    if (-not (Test-Path $gs)) {
        throw "Cursor globalStorage not found: $gs"
    }

    Wait-ForCursorExit
    Write-Log "Cursor is not running."

    Start-Sleep -Seconds 2

    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    Write-Log "Backup folder: $dest"

    $toCopy = @("state.vscdb", "state.vscdb-wal", "state.vscdb-shm")
    foreach ($name in $toCopy) {
        $src = Join-Path $gs $name
        if (Test-Path $src) {
            Write-Log "Copying $name ..."
            Copy-Item -LiteralPath $src -Destination $dest -Force
        }
    }

    $zipPath = Join-Path (Split-Path $dest) "Cursor-state-$stamp.zip"
    Write-Log "Creating zip: $zipPath"
    $zipItems = Get-ChildItem $dest -File | Select-Object -ExpandProperty FullName
    if ($zipItems.Count -gt 0) {
        Compress-Archive -Path $zipItems -DestinationPath $zipPath -Force
        Write-Log "Zip size GB: $([math]::Round((Get-Item $zipPath).Length / 1GB, 2))"
    }

    if (Test-Path $backupFile) {
        $sizeGb = [math]::Round((Get-Item $backupFile).Length / 1GB, 2)
        Write-Log "Deleting local duplicate backup ($sizeGb GB): $backupFile"
        Remove-Item -LiteralPath $backupFile -Force
        Write-Log "Deleted state.vscdb.backup"
    } else {
        Write-Log "state.vscdb.backup not found (may already be deleted)."
    }

    Write-Host ""
    Write-Host "Done." -ForegroundColor Green
    Write-Host "  Backup folder: $dest"
    Write-Host "  Zip (if created): $zipPath"
    Write-Host "  Freed ~29 GB on C: (removed .backup only; live state.vscdb kept)"
    Write-Host "  Log: $log"
    Write-Host ""
    Write-Host "Optional: In File Explorer, right-click the backup folder on Google Drive"
    Write-Host "  -> Google Drive -> Online only (saves local G: space)"
    Write-Host ""
    Write-Host "You can reopen Cursor now." -ForegroundColor Cyan
    Write-Log "Finished successfully"
}
catch {
    Write-Log "ERROR: $_"
    Write-Host "ERROR: $_" -ForegroundColor Red
    Write-Host "Log: $log"
    exit 1
}

Write-Host "Press Enter to close this window..."
Read-Host
