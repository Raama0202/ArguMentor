@echo off
REM ArguMentor 2.0 - Install All Dependencies
REM Double-click this file to install everything

echo.
echo ========================================
echo   ArguMentor 2.0 - Installing Dependencies
echo ========================================
echo.

echo [1/4] Installing backend dependencies...
cd server
call npm install
if errorlevel 1 (
    echo ERROR: Backend installation failed!
    pause
    exit /b 1
)
cd ..

echo.
echo [2/4] Installing frontend dependencies...
cd argumentor-react2
call npm install
if errorlevel 1 (
    echo ERROR: Frontend installation failed!
    pause
    exit /b 1
)
cd ..

echo.
echo [3/4] Installing Python dependencies...
pip install requests python-dotenv
if errorlevel 1 (
    echo WARNING: Python installation failed or Python not found
    echo You can continue, but some features may not work
)

echo.
echo [4/4] Building frontend...
cd argumentor-react2
call npm run build
if errorlevel 1 (
    echo ERROR: Frontend build failed!
    pause
    exit /b 1
)
cd ..

echo.
echo ========================================
echo   Installation Complete!
echo ========================================
echo.
echo Next steps:
echo 1. Create server/.env file (see SETUP_GUIDE.md)
echo 2. Run START_SERVER.bat to start the server
echo 3. Open http://localhost:5000 in your browser
echo.
pause

