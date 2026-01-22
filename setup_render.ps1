# Script to setup users on Render
# Run this after setting SETUP_TOKEN in Render's environment variables

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Render Database Setup Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if users exist
Write-Host "Step 1: Checking if users exist in database..." -ForegroundColor Yellow
try {
    $checkResponse = Invoke-RestMethod -Uri "https://behavior-tracking-website-1.onrender.com/check-users" -Method GET
    Write-Host "Current users in database: $($checkResponse.user_count)" -ForegroundColor Green
    if ($checkResponse.user_count -gt 0) {
        Write-Host "Users found:" -ForegroundColor Green
        $checkResponse.users | ForEach-Object {
            Write-Host "  - $($_.username) ($($_.role))" -ForegroundColor Cyan
        }
        Write-Host ""
        $continue = Read-Host "Users already exist. Do you want to create default users anyway? (y/n)"
        if ($continue -ne 'y') {
            Write-Host "Setup cancelled." -ForegroundColor Yellow
            exit 0
        }
    }
} catch {
    Write-Host "Error checking users: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "This might mean the endpoint isn't deployed yet. Make sure Render has finished deploying." -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Step 2: Get setup token
Write-Host "Step 2: Setup Token" -ForegroundColor Yellow
Write-Host "Enter the SETUP_TOKEN you set in Render's environment variables:" -ForegroundColor White
Write-Host "(If you haven't set it yet, go to Render Dashboard -> Your Service -> Environment -> Add SETUP_TOKEN)" -ForegroundColor Gray
$setupToken = Read-Host "Setup Token"

if ([string]::IsNullOrWhiteSpace($setupToken)) {
    Write-Host "Error: Setup token is required!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 3: Creating default users..." -ForegroundColor Yellow

# Step 3: Call setup endpoint
try {
    $body = @{
        token = $setupToken
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "https://behavior-tracking-website-1.onrender.com/setup" -Method POST -ContentType "application/json" -Body $body
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  SUCCESS!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host $response.message -ForegroundColor Green
    Write-Host ""
    Write-Host "Default users created:" -ForegroundColor Cyan
    foreach ($user in $response.users) {
        Write-Host "  Username: $($user.username)" -ForegroundColor White
        Write-Host "  Password: $($user.password)" -ForegroundColor White
        Write-Host "  Role: $($user.role)" -ForegroundColor White
        Write-Host ""
    }
    Write-Host "WARNING: $($response.warning)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "You can now log in at: https://behavior-tracking-website-1.onrender.com/login" -ForegroundColor Cyan
    
} catch {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  ERROR!" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        $errorObj = $responseBody | ConvertFrom-Json -ErrorAction SilentlyContinue
        
        if ($errorObj -and $errorObj.error) {
            Write-Host "Error: $($errorObj.error)" -ForegroundColor Red
        } else {
            Write-Host "Error: $responseBody" -ForegroundColor Red
        }
    } else {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Write-Host ""
    Write-Host "Common issues:" -ForegroundColor Yellow
    Write-Host "1. SETUP_TOKEN not set in Render environment variables" -ForegroundColor Yellow
    Write-Host "2. SETUP_TOKEN doesn't match what you entered" -ForegroundColor Yellow
    Write-Host "3. Render hasn't finished deploying the latest code" -ForegroundColor Yellow
    Write-Host "4. Service might be sleeping (first request takes longer)" -ForegroundColor Yellow
}
