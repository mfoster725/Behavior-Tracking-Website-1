@echo off
cd /d "c:\Users\manfo\OneDrive\Desktop\Cursor"

echo Staging files...
git add app.py run.bat static/app.js templates/index.html migrate_add_ui_preferences.py static/paycheck_worksheet_example.html

echo.
echo Committing...
git commit -m "Update app, run script, static assets, templates; add migration and paycheck example"

echo.
echo Pushing to origin...
git push -u origin main

echo.
pause
