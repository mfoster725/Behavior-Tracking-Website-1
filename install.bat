@echo off
echo Installing Behavior Tracking System Dependencies...
echo.

REM Try different Python commands
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo Trying 'py' command...
    py -m pip install -r requirements.txt
    if errorlevel 1 (
        echo Trying 'pip3' command...
        pip3 install -r requirements.txt
        if errorlevel 1 (
            echo.
            echo ERROR: Could not install dependencies.
            echo.
            echo Please try one of these commands manually:
            echo   python -m pip install -r requirements.txt
            echo   py -m pip install -r requirements.txt
            echo   pip3 install -r requirements.txt
            echo.
            echo Or install Python from https://www.python.org/
            pause
            exit /b 1
        )
    )
)

echo.
echo Installation complete!
echo.
echo To start the server, run: python app.py
echo Or double-click run.bat
pause

