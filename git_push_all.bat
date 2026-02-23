@echo off
cd /d "c:\Users\manfo\OneDrive\Desktop\Cursor"

echo Staging all changes...
git add -A

echo.
echo Committing...
git commit -m "Recent changes: marketplace plan, paycheck cron, migrations (grades_taught, marketplace, hidden_rules), UI, app and static updates"

echo.
echo Pushing to origin...
git push -u origin main

echo.
pause
