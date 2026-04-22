@echo off
REM ============================================
REM Argumentor Metrics Calculator
REM Calculates Accuracy, Precision, Recall
REM for Binary Classification (Guilty/Not Guilty)
REM Processing time: ~20 seconds
REM ============================================

echo.
echo ============================================
echo Running Argumentor Metrics Calculation...
echo ============================================
echo.

REM Change to the ai_engine directory
cd /d "%~dp0"

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH.
    echo Please install Python and add it to your system PATH.
    pause
    exit /b 1
)

REM Run the metrics script
echo Processing metrics (this will take approximately 20 seconds)...
echo.

python metrics.py

echo.
echo ============================================
echo Metrics calculation completed!
echo ============================================
echo.

pause
