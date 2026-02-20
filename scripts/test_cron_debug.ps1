# Step 3: Test the cron debug endpoint
# Run this after deploying your app. Secrets are read from environment variables
# so you don't commit them. Remove this script after fixing the cron.
#
# One-time setup (run in PowerShell, then run this script):
#   $env:APP_URL       = "https://YOUR-APP.onrender.com"
#   $env:CRON_SECRET   = "paste from Render Environment"
#   $env:RENDER_USER   = "your Render HTTP auth username"   # optional if no HTTP auth
#   $env:RENDER_PASS   = "your Render HTTP auth password"  # optional if no HTTP auth
#
# Then run:
#   .\scripts\test_cron_debug.ps1

$ErrorActionPreference = "Stop"

$baseUrl = $env:APP_URL
$cronSecret = $env:CRON_SECRET
$renderUser = $env:RENDER_USER
$renderPass = $env:RENDER_PASS

if (-not $baseUrl -or -not $cronSecret) {
    Write-Host "Missing env vars. Set these in PowerShell, then run this script again:" -ForegroundColor Yellow
    Write-Host '  $env:APP_URL     = "https://YOUR-APP.onrender.com"'
    Write-Host '  $env:CRON_SECRET = "paste from Render -> Environment"'
    Write-Host '  $env:RENDER_USER = "username"   # only if Render HTTP auth is on'
    Write-Host '  $env:RENDER_PASS = "password"   # only if Render HTTP auth is on'
    exit 1
}

$debugUrl = $baseUrl.TrimEnd("/") + "/api/paycheck/cron-debug"
$headers = @{
    "X-Cron-Secret" = $cronSecret
}

Write-Host "Calling: $debugUrl" -ForegroundColor Cyan
Write-Host ""

try {
    if ($renderUser -and $renderPass) {
        $pair = "${renderUser}:${renderPass}"
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($pair)
        $b64 = [Convert]::ToBase64String($bytes)
        $headers["Authorization"] = "Basic $b64"
    }
    $response = Invoke-RestMethod -Uri $debugUrl -Method Get -Headers $headers
} catch {
    Write-Host "Request failed: $_" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $reader.BaseStream.Position = 0
        Write-Host $reader.ReadToEnd()
    }
    exit 1
}

Write-Host "Debug endpoint response:" -ForegroundColor Green
$response | ConvertTo-Json | Write-Host
Write-Host ""

$match = $response.match
$present = $response.x_cron_secret_present
$configured = $response.cron_secret_configured

if ($match) {
    Write-Host "Result: Secret MATCHES. Cron should work. Try the real endpoint next." -ForegroundColor Green
} elseif (-not $present) {
    Write-Host "Result: X-Cron-Secret header was NOT received. Check header name (exactly: X-Cron-Secret)." -ForegroundColor Yellow
} elseif ($response.provided_length -ne $response.expected_length) {
    Write-Host "Result: Length mismatch (sent $($response.provided_length), expected $($response.expected_length)). Fix the secret value." -ForegroundColor Yellow
} else {
    Write-Host "Result: Secret does not match (same length but wrong value). Copy CRON_SECRET from Render again." -ForegroundColor Yellow
}

if (-not $configured) {
    Write-Host "Warning: CRON_SECRET is not set on the server (cron_secret_configured: false)." -ForegroundColor Red
}
