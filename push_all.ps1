# Push all changes: stage, commit, push
# Run from project folder: .\push_all.ps1

Set-Location $PSScriptRoot

Write-Host "Staging all changes..." -ForegroundColor Cyan
git add -A

Write-Host "Committing..." -ForegroundColor Cyan
git commit -m "Recent changes: marketplace plan, paycheck cron, migrations (grades_taught, marketplace, hidden_rules), UI, app and static updates"

Write-Host "Pushing to origin..." -ForegroundColor Cyan
git push -u origin main

Write-Host "Done." -ForegroundColor Green
