#!/usr/bin/env pwsh
# Quick start script for ArguMentor
# Run: .\start.ps1

Write-Host "`n╔════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║            ArguMentor Quick Start Script               ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════╝`n" -ForegroundColor Green

# Check if we're in the right directory
if (-not (Test-Path ".\server\package.json")) {
    Write-Host "❌ Error: Run this script from the ArguMentor root directory" -ForegroundColor Red
    Write-Host "   Expected to find: .\server\package.json`n" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Running from correct directory`n" -ForegroundColor Green

# Check Node.js
Write-Host "Checking Node.js..." -ForegroundColor Cyan
$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
    Write-Host "❌ Node.js not found. Please install Node.js >= 16" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Node.js $nodeVersion`n" -ForegroundColor Green

# Check Python
Write-Host "Checking Python..." -ForegroundColor Cyan
$pythonVersion = python --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Python not found. Please install Python >= 3.8" -ForegroundColor Red
    Write-Host "   Or set PYTHON_BIN environment variable`n" -ForegroundColor Yellow
    exit 1
}
Write-Host "✓ $pythonVersion`n" -ForegroundColor Green

# Check .env
Write-Host "Checking configuration..." -ForegroundColor Cyan
if (-not (Test-Path ".\server\.env")) {
    Write-Host "❌ Missing: .\server\.env" -ForegroundColor Red
    Write-Host "   Please create and configure your API keys. See README.md`n" -ForegroundColor Yellow
    exit 1
}

$envContent = Get-Content ".\server\.env" -Raw
if ($envContent -match "GEMINI_API_KEY\s*=\s*$") {
    Write-Host "⚠  Warning: GEMINI_API_KEY not fully configured" -ForegroundColor Yellow
}
if ($envContent -match "MISTRAL_KEY\s*=\s*$|HF_TOKEN\s*=\s*$") {
    Write-Host "⚠  Warning: MISTRAL_KEY not fully configured" -ForegroundColor Yellow
}
if ($envContent -match "MONGODB_URI\s*=\s*$") {
    Write-Host "⚠  Warning: MONGODB_URI not configured" -ForegroundColor Yellow
}
if ($envContent -match "MISTRAL_HF_ENDPOINT_URL\s*=\s*$") {
    Write-Host "⚠  Warning: MISTRAL_HF_ENDPOINT_URL is empty" -ForegroundColor Yellow
    Write-Host "   Using default: https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2`n" -ForegroundColor Yellow
}

Write-Host "✓ Configuration file found`n" -ForegroundColor Green

# Offer to run test
Write-Host "Would you like to run connectivity tests first? (y/n)" -ForegroundColor Cyan
$testResponse = Read-Host
if ($testResponse -eq 'y' -or $testResponse -eq 'Y') {
    Write-Host "`nRunning connectivity tests...`n" -ForegroundColor Cyan
    cd server
    node test-connectivity.js
    cd ..
    Write-Host ""
}

# Start servers
Write-Host "Starting servers...`n" -ForegroundColor Green

Write-Host "┌─ Opening Terminal 1: Backend Server (Port 5000)" -ForegroundColor Cyan
Write-Host "└─ Opening Terminal 2: Frontend Client (Port 5173)" -ForegroundColor Cyan
Write-Host ""

# Start server in new PowerShell window
$serverArgs = @{
    FilePath = "powershell.exe"
    ArgumentList = @("-NoExit", "-Command", "cd '$PWD\server'; npm run dev")
    WindowStyle = "Normal"
}
Start-Process @serverArgs

# Wait a moment for server to start
Start-Sleep -Seconds 3

# Start client in new PowerShell window
$clientArgs = @{
    FilePath = "powershell.exe"
    ArgumentList = @("-NoExit", "-Command", "cd '$PWD\argumentor-react2'; npm run dev")
    WindowStyle = "Normal"
}
Start-Process @clientArgs

Write-Host "✓ Servers starting...`n" -ForegroundColor Green

Write-Host "📝 Server logs will appear in Terminal 1`n" -ForegroundColor Yellow
Write-Host "🌐 Frontend will open at: http://localhost:5173" -ForegroundColor Yellow
Write-Host "`n💡 Tip: If you see connection errors, check:" -ForegroundColor Yellow
Write-Host "   1. Server is running on http://localhost:5000" -ForegroundColor Yellow
Write-Host "   2. API keys in .\server\.env are correct" -ForegroundColor Yellow
Write-Host "   3. MongoDB connection string is valid" -ForegroundColor Yellow
Write-Host "`n⚖️  Happy arguing! (legally, of course)`n" -ForegroundColor Green
