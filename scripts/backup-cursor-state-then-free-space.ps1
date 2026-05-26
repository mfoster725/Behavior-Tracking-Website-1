# 1) Waits for Cursor to exit
# 2) Deletes state.vscdb.backup FIRST (~29 GB on C:) — no extra disk needed
# 3) Copies live state.vscdb (+ wal/shm) to Google Drive if enough free space on C:
#
# Run in an external PowerShell window (launched detached from Cursor).

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
            Write-Host ">>> Close Cursor: File > Exit (save work first)." -ForegroundColor Yellow
            Write-Host ">>> This window continues when Cursor has fully exited." -ForegroundColor Yellow
            Write-Host ""
        }
        Start-Sleep -Seconds 2
        $waited += 2
        if (($waited % 30) -eq 0) {
            Write-Host "Still waiting for Cursor to exit... ($waited s)"
        }
    }
}

function Remove-PartialBackups {
    $root = "G:\My Drive\Backups\Cursor"
    if (-not (Test-Path $root)) { return }
    Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $hasLive = Test-Path (Join-Path $_.FullName "state.vscdb")
        $size = (Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue |
            Measure-Object Length -Sum).Sum
        if ($hasLive -and $size -lt 1GB) {
            Write-Log "Removing incomplete backup folder: $($_.FullName)"
            Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

try {
    Write-Log "Starting (delete-backup-first, then optional Drive copy)"

    if (-not (Test-Path "G:\My Drive")) {
        throw "Google Drive not found at G:\My Drive"
    }
    if (-not (Test-Path $gs)) {
        throw "Cursor globalStorage not found: $gs"
    }

    Wait-ForCursorExit
    Write-Log "Cursor is not running."
    Start-Sleep -Seconds 2

    $cFreeBefore = (Get-PSDrive C).Free
    Write-Log ("C: free before: {0:N2} GB" -f ($cFreeBefore / 1GB))

    Remove-PartialBackups

    # --- STEP 1: Free C: immediately (keeps live state.vscdb) ---
    if (Test-Path $backupFile) {
        $sizeGb = [math]::Round((Get-Item $backupFile).Length / 1GB, 2)
        Write-Log "Deleting duplicate backup ($sizeGb GB): $backupFile"
        Remove-Item -LiteralPath $backupFile -Force
        Write-Log "Deleted state.vscdb.backup"
    } else {
        Write-Log "state.vscdb.backup already removed."
    }

    $cFree = (Get-PSDrive C).Free
    $gFree = (Get-PSDrive G).Free
    Write-Log ("C: free after delete: {0:N2} GB" -f ($cFree / 1GB))
    Write-Log ("G: free: {0:N2} GB" -f ($gFree / 1GB))

    $liveDb = Join-Path $gs "state.vscdb"
    $liveGb = [math]::Round((Get-Item $liveDb).Length / 1GB, 2)

    # Need headroom on C: for Google Drive cache while uploading (~5 GB rolling)
    if ($cFree -lt ($liveGb + 6) * 1GB) {
        Write-Log "Skipping Drive copy: not enough C: space for upload cache after delete."
        Write-Host ""
        Write-Host "Freed space on C: by removing .backup. Drive archive skipped (low disk)." -ForegroundColor Yellow
        Write-Host "You can upload a backup later from: $liveDb" -ForegroundColor Yellow
    } else {
        # --- STEP 2: Copy live DB set to Google Drive ---
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        Write-Log "Copying live state to: $dest"

        foreach ($name in @("state.vscdb", "state.vscdb-wal", "state.vscdb-shm")) {
            $src = Join-Path $gs $name
            if (Test-Path $src) {
                Write-Log "  Copying $name ..."
                Copy-Item -LiteralPath $src -Destination $dest -Force
            }
        }

        $zipPath = "G:\My Drive\Backups\Cursor\Cursor-state-$stamp.zip"
        Write-Log "Creating zip on Google Drive..."
        $zipItems = Get-ChildItem $dest -File | Select-Object -ExpandProperty FullName
        Compress-Archive -Path $zipItems -DestinationPath $zipPath -Force
        Write-Log ("Zip size GB: {0:N2}" -f ((Get-Item $zipPath).Length / 1GB))

        Write-Host ""
        Write-Host "Drive backup created." -ForegroundColor Green
        Write-Host "  Folder: $dest"
        Write-Host "  Zip:    $zipPath"
    }

    Write-Host ""
    Write-Host "Done. Your live chat/state file was NOT deleted." -ForegroundColor Green
    Write-Host ("C: free now: {0:N2} GB" -f ((Get-PSDrive C).Free / 1GB))
    Write-Host "Reopen Cursor when ready."
    Write-Log "Finished successfully"
}
catch {
    Write-Log "ERROR: $_"
    Write-Host "ERROR: $_" -ForegroundColor Red
    Write-Host "Log: $log"
    exit 1
}

Write-Host ""
Write-Host "Press Enter to close..."
Read-Host
