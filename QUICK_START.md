# ⚡ Quick Start Guide - ArguMentor 2.0

## 🚀 Fast Setup (5 Minutes)

### Prerequisites Check
```powershell
node --version    # Should show v16+
npm --version     # Should show v8+
python --version  # Should show v3.8+
```

### Step 1: Install Dependencies
```powershell
# Backend
cd server
npm install
cd ..

# Frontend
cd argumentor-react2
npm install
npm run build
cd ..

# Python
pip install requests python-dotenv
```

### Step 2: Configure Environment
Create `server/.env` file:
```env
PORT=5000
MISTRAL_API_KEY=cpDSZyCqPHiRtSR66vnGdO25pMON4cxQ
MISTRAL_MODEL=mistral-small-latest
MISTRAL_API_URL=https://api.mistral.ai/v1/chat/completions
```

### Step 3: Start Server
```powershell
cd server
npm start
```

### Step 4: Open Browser
```
http://localhost:5000
```

**Done! 🎉**

---

## 📋 Complete Command List

```powershell
# 1. Install everything
cd server && npm install && cd .. && cd argumentor-react2 && npm install && npm run build && cd .. && pip install requests python-dotenv

# 2. Create .env (manually edit server/.env)

# 3. Start server
cd server && npm start
```

---

## ❓ Common Issues

**Port 5000 in use?**
```powershell
# Kill process on port 5000
netstat -ano | findstr :5000
taskkill /PID <PID> /F
```

**Module not found?**
```powershell
cd server && npm install
cd ../argumentor-react2 && npm install
```

**Python not found?**
- Install Python from python.org
- Check "Add to PATH" during installation
- Restart terminal

---

For detailed instructions, see `SETUP_GUIDE.md`

