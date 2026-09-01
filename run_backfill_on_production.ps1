# Run the Aug 31, 2026 point-card location backfill against the live Render site.
# Uses SETUP_TOKEN from Render Environment (same token as /setup).

param(
    [switch]$DryRun,
    [string]$BaseUrl = "https://behavior-tracking-website-1.onrender.com",
    [string]$Date = "2026-08-31"
)

Write-Host "Backfill point card locations on production" -ForegroundColor Cyan
Write-Host "Site: $BaseUrl" -ForegroundColor Gray
Write-Host "Date: $Date" -ForegroundColor Gray
if ($DryRun) {
    Write-Host "Mode: DRY RUN (preview only)" -ForegroundColor Yellow
} else {
    Write-Host "Mode: APPLY CHANGES" -ForegroundColor Red
}
Write-Host ""

$token = $env:SETUP_TOKEN
if (-not $token) {
    $token = Read-Host "Enter SETUP_TOKEN (from Render Dashboard -> Environment)"
}
if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host "SETUP_TOKEN is required." -ForegroundColor Red
    exit 1
}

$body = @{
    token = $token
    date = $Date
    dry_run = [bool]$DryRun
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod `
        -Uri "$BaseUrl/admin/backfill-point-card-locations" `
        -Method POST `
        -ContentType "application/json" `
        -Body $body

    Write-Host "Result:" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 6

    if ($response.changes -and $response.changes.Count -gt 0) {
        Write-Host ""
        Write-Host "Sample changes:" -ForegroundColor Cyan
        $response.changes | Select-Object -First 10 | ForEach-Object {
            Write-Host ("  {0} | {1}: {2} -> {3}" -f $_.student_name, $_.time_range, ($_.old_location -replace '^$', '(empty)'), ($_.new_location -replace '^$', '(empty)'))
        }
        if ($response.changes_truncated) {
            Write-Host "  ... more changes omitted from response" -ForegroundColor Gray
        }
    }

    if ($DryRun) {
        Write-Host ""
        Write-Host "Dry run complete. Re-run without -DryRun to apply." -ForegroundColor Yellow
    } else {
        Write-Host ""
        Write-Host "Backfill applied successfully." -ForegroundColor Green
    }
} catch {
    Write-Host "Request failed:" -ForegroundColor Red
    if ($_.Exception.Response) {
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $reader.BaseStream.Position = 0
            $reader.DiscardBufferedData()
            Write-Host $reader.ReadToEnd()
        } catch {
            Write-Host $_.Exception.Message
        }
    } else {
        Write-Host $_.Exception.Message
    }
    exit 1
}
