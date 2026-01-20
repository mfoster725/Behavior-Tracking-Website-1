# Script to push Behavior Tracking System to GitHub
# Make sure Git is in your PATH before running this script

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Push to GitHub Helper Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Git is available and add to PATH if needed
$gitCheck = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCheck) {
    # Try to find Git in common installation locations
    $gitPaths = @(
        "C:\Program Files\Git\bin\git.exe",
        "C:\Program Files (x86)\Git\bin\git.exe"
    )
    
    $foundGit = $false
    foreach ($gitPath in $gitPaths) {
        if (Test-Path $gitPath) {
            $gitDir = Split-Path $gitPath -Parent
            $env:Path += ";$gitDir"
            Write-Host "[INFO] Added Git to PATH: $gitDir" -ForegroundColor Yellow
            $foundGit = $true
            break
        }
    }
    
    if (-not $foundGit) {
        Write-Host "[ERROR] Git is not found in PATH or common installation locations!" -ForegroundColor Red
        Write-Host ""
        Write-Host "Please install Git from: https://git-scm.com/download/win" -ForegroundColor Yellow
        Write-Host "Or restart PowerShell if Git is already installed." -ForegroundColor Yellow
        exit 1
    }
}

$gitVersion = git --version
Write-Host "[OK] Git is available: $gitVersion" -ForegroundColor Green

Write-Host ""

# Check current branch
$currentBranch = git branch --show-current
Write-Host "Current branch: $currentBranch" -ForegroundColor Cyan
Write-Host ""

# Check if remote exists
$remoteUrl = git remote get-url origin 2>$null
if ($remoteUrl) {
    Write-Host "[OK] Remote repository found: $remoteUrl" -ForegroundColor Green
    Write-Host ""
    $useExisting = Read-Host "Use this existing remote? (Y/n)"
    if ($useExisting -eq "n" -or $useExisting -eq "N") {
        Write-Host ""
        Write-Host "To change the remote URL, run:" -ForegroundColor Yellow
        Write-Host "  git remote set-url origin <your-new-repo-url>" -ForegroundColor Yellow
        exit 0
    }
} else {
    Write-Host "No remote repository configured." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Before continuing, you need to:" -ForegroundColor Yellow
    Write-Host "1. Go to https://github.com/new" -ForegroundColor Cyan
    Write-Host "2. Create a new repository (don't initialize with README)" -ForegroundColor Cyan
    Write-Host "3. Copy the repository URL" -ForegroundColor Cyan
    Write-Host ""
    $repoUrl = Read-Host "Enter your GitHub repository URL (e.g., https://github.com/username/repo-name.git)"
    
    if ($repoUrl) {
        Write-Host ""
        Write-Host "Adding remote repository..." -ForegroundColor Cyan
        git remote add origin $repoUrl
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] Remote added successfully!" -ForegroundColor Green
        } else {
            Write-Host "[ERROR] Failed to add remote. Please check your URL and try again." -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "No URL provided. Exiting." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""

# Ensure we're on main branch
if ($currentBranch -ne "main") {
    Write-Host "Switching to main branch..." -ForegroundColor Cyan
    git branch -M main
    Write-Host "[OK] Now on main branch" -ForegroundColor Green
    Write-Host ""
}

# Push to GitHub
Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
Write-Host ""
git push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  [SUCCESS] Successfully pushed to GitHub!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Your repository is now available on GitHub!" -ForegroundColor Cyan
    Write-Host ""
    $remoteUrl = git remote get-url origin
    Write-Host "Repository URL: $remoteUrl" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  [ERROR] Push failed!" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Common issues:" -ForegroundColor Yellow
    Write-Host "1. Authentication required - GitHub may prompt for credentials" -ForegroundColor Yellow
    Write-Host "2. If using HTTPS, you may need a Personal Access Token" -ForegroundColor Yellow
    Write-Host "   Get one at: https://github.com/settings/tokens" -ForegroundColor Cyan
    Write-Host "3. If using SSH, make sure your SSH key is set up" -ForegroundColor Yellow
    Write-Host ""
}
