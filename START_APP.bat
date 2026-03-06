@echo off
REM ArguMentor 2.0 - Start Application (Server + Client)
cd /d "%~dp0"

echo.
echo ========================================
echo   ArguMentor 2.0 - Launching System
echo ========================================
echo.

echo Starting Server (port 5000)...
start "Argumentor Server" cmd /k "cd /d ""%~dp0server"" && npm run dev"

timeout /t 3 /nobreak >nul

echo Starting Client (port 5173)...
start "Argumentor Client" cmd /k "cd /d ""%~dp0argumentor-react2"" && npm run dev"

echo.
echo System launched! Open http://localhost:5173 in your browser.
echo Server must be running on port 5000 for uploads to work.
pause