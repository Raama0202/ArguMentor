@echo off
REM ArguMentor 2.0 - Start Server Script
REM Double-click this file to start the server

echo.
echo ========================================
echo   ArguMentor 2.0 - Starting Server
echo ========================================
echo.

cd server
..\tools\node-v20.11.1-win-x64\node.exe index.js

pause

