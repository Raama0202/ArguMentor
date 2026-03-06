# ArguMentor 2.0 - Automated Setup Script
# Run this script from the project root folder

Write-Host "`n╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     ArguMentor 2.0 - Automated Setup Script            ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

# Check prerequisites
Write-Host "`n[1/6] Checking prerequisites..." -ForegroundColor Yellow

$nodeVersion = node --version 2>$null
$npmVersion = npm --version 2>$null
$pythonVersion = python --version 2>$null

if (-not $nodeVersion) {
    Write-Host "❌ Node.js not found! Please install from https://nodejs.org/" -ForegroundColor Red
    exit 1
} else {
    Write-Host "✅ Node.js: $nodeVersion" -ForegroundColor Green
}

if (-not $npmVersion) {
    Write-Host "❌ npm not found!" -ForegroundColor Red
    exit 1
} else {
    Write-Host "✅ npm: $npmVersion" -ForegroundColor Green
}

if (-not $pythonVersion) {
    Write-Host "⚠️  Python not found! Some features may not work." -ForegroundColor Yellow
    Write-Host "   Install from https://www.python.org/" -ForegroundColor Yellow
} else {
    Write-Host "✅ Python: $pythonVersion" -ForegroundColor Green
}

# Install backend dependencies
Write-Host "`n[2/6] Installing backend dependencies..." -ForegroundColor Yellow
Set-Location server
if (Test-Path "node_modules") {
    Write-Host "   node_modules exists, skipping..." -ForegroundColor Gray
} else {
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Backend installation failed!" -ForegroundColor Red
        Set-Location ..
        exit 1
    }
}
Set-Location ..

# Install frontend dependencies
Write-Host "`n[3/6] Installing frontend dependencies..." -ForegroundColor Yellow
Set-Location argumentor-react2
if (Test-Path "node_modules") {
    Write-Host "   node_modules exists, skipping..." -ForegroundColor Gray
} else {
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Frontend installation failed!" -ForegroundColor Red
        Set-Location ..
        exit 1
    }
}
Set-Location ..

# Install Python dependencies
Write-Host "`n[4/6] Installing Python dependencies..." -ForegroundColor Yellow
if ($pythonVersion) {
    pip install requests python-dotenv 2>&1 | Out-Null
    Write-Host "✅ Python packages installed" -ForegroundColor Green
} else {
    Write-Host "⚠️  Skipping Python packages (Python not found)" -ForegroundColor Yellow
}

# Build frontend
Write-Host "`n[5/6] Building frontend..." -ForegroundColor Yellow
Set-Location argumentor-react2
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Frontend build failed!" -ForegroundColor Red
    Set-Location ..
    exit 1
}
Set-Location ..

# Check/create .env file
Write-Host "`n[6/6] Checking environment configuration..." -ForegroundColor Yellow
$envPath = "server\.env"
if (Test-Path $envPath) {
    Write-Host "✅ .env file exists" -ForegroundColor Green
} else {
    Write-Host "⚠️  .env file not found. Creating template..." -ForegroundColor Yellow
    $envContent = @"
PORT=5000
MISTRAL_API_KEY=cpDSZyCqPHiRtSR66vnGdO25pMON4cxQ
MISTRAL_MODEL=mistral-small-latest
MISTRAL_API_URL=https://api.mistral.ai/v1/chat/completions
PYTHON_BIN=python

# MongoDB (Optional - comment out if not using)
# MONGODB_URI=mongodb://localhost:27017/argumentor
"@
    Set-Content -Path $envPath -Value $envContent
    Write-Host "✅ Created .env file template" -ForegroundColor Green
    Write-Host "   Please edit server/.env with your API keys if needed" -ForegroundColor Yellow
}

# Summary
Write-Host "`n╔══════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║              Setup Complete! ✅                           ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Green

Write-Host "`n📝 Next Steps:" -ForegroundColor Cyan
Write-Host "   1. Edit server/.env if needed (add your Mistral API key)" -ForegroundColor White
Write-Host "   2. Start the server: cd server && npm start" -ForegroundColor White
Write-Host "   3. Open browser: http://localhost:5000" -ForegroundColor White
Write-Host "`n📚 For detailed instructions, see SETUP_GUIDE.md" -ForegroundColor Yellow
Write-Host ""

