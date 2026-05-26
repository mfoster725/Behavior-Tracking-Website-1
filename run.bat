@echo off
cd /d "%~dp0"
echo Starting Behavior Tracking System...
echo (In PowerShell use:  .\run.bat   or   .\run.ps1)
echo.
echo Installing dependencies...
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo Error: Python or pip not found. Trying alternative method...
    py -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo ERROR: Could not install dependencies.
        echo Please ensure Python is installed and try one of these:
        echo   python -m pip install -r requirements.txt
        echo   py -m pip install -r requirements.txt
        echo   pip3 install -r requirements.txt
        pause
        exit /b 1
    )
)
echo.
echo Stopping any existing server on port 5000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000" ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)
echo.
echo Starting server (local SQLite database)...
echo Open your browser to http://localhost:5000
echo.
set USE_LOCAL_DB=1
set DATABASE_URL=
python app.py
if errorlevel 1 (
    py app.py
)
pause

