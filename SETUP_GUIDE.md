# 🚀 ArguMentor 2.0 - Complete Setup Guide

## 📋 Prerequisites

Before starting, ensure you have the following installed:

1. **Node.js** (v16 or higher)
   - Download: https://nodejs.org/
   - Verify: `node --version` and `npm --version`

2. **Python** (v3.8 or higher)
   - Download: https://www.python.org/downloads/
   - Verify: `python --version`
   - **Important**: Check "Add Python to PATH" during installation

3. **MongoDB** (Optional - for database storage)
   - Download: https://www.mongodb.com/try/download/community
   - Or use MongoDB Atlas (cloud): https://www.mongodb.com/cloud/atlas
   - **Note**: Project works without MongoDB (uses local JSON storage)

4. **Git** (Optional - for cloning)
   - Download: https://git-scm.com/downloads

---

## 📦 Step 1: Extract Project

1. Extract the zip file to a folder (e.g., `H:\Argumentor 2.0`)
2. Open terminal/command prompt in the project root folder

---

## 🔧 Step 2: Install Dependencies

### Install Backend Dependencies

```powershell
# Navigate to project root
cd "H:\Argumentor 2.0"

# Install backend dependencies
cd server
npm install
cd ..
```

### Install Frontend Dependencies

```powershell
# Install frontend dependencies
cd argumentor-react2
npm install
cd ..
```

### Install Python Dependencies

```powershell
# Install Python packages for AI inference
pip install requests python-dotenv
```

**OR** if you have `requirements.txt`:

```powershell
pip install -r requirements.txt
```

---

## ⚙️ Step 3: Configure Environment Variables

### Create `.env` file in `server` folder

1. Navigate to `server` folder
2. Create a file named `.env` (no extension)
3. Add the following content:

```env
# Server Configuration
PORT=5000
NODE_ENV=production

# MongoDB Configuration (Optional)
# If using MongoDB, uncomment and set your connection string:
# MONGODB_URI=mongodb://localhost:27017/argumentor
# Or for MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/argumentor

# Mistral AI API Configuration (REQUIRED)
MISTRAL_API_KEY=cpDSZyCqPHiRtSR66vnGdO25pMON4cxQ
MISTRAL_MODEL=mistral-small-latest
MISTRAL_API_URL=https://api.mistral.ai/v1/chat/completions

# Python Configuration (Optional)
PYTHON_BIN=python
```

**Important Notes:**
- Replace `MISTRAL_API_KEY` with your own Mistral API key if needed
- If you don't have MongoDB, leave `MONGODB_URI` commented out (project will use local JSON storage)
- The project will work with or without MongoDB

---

## 🏗️ Step 4: Build Frontend

```powershell
# From project root
cd argumentor-react2
npm run build
cd ..
```

This creates the production build in `argumentor-react2/dist/`

---

## 🚀 Step 5: Start the Server

### Option A: Start Backend Only

```powershell
# From project root
cd server
npm start
```

### Option B: Start with Both Commands (Recommended)

Open **two separate terminal windows**:

**Terminal 1 - Backend:**
```powershell
cd "H:\Argumentor 2.0\server"
npm start
```

**Terminal 2 - Frontend Dev (Optional, for development):**
```powershell
cd "H:\Argumentor 2.0\argumentor-react2"
npm run dev
```

**Note**: For production, you only need the backend server (it serves the built frontend).

---

## 🌐 Step 6: Access the Application

Open your web browser and navigate to:

```
http://localhost:5000
```

You should see the ArguMentor dashboard!

---

## ✅ Step 7: Verify Installation

### Check Backend

1. Open browser: `http://localhost:5000/health`
2. Should return JSON with server status

### Check API Endpoints

1. Cases list: `http://localhost:5000/api/cases`
2. Should return JSON array of cases (may be empty initially)

---

## 📝 Quick Start Commands (All-in-One)

Copy and paste these commands in order:

```powershell
# 1. Navigate to project
cd "H:\Argumentor 2.0"

# 2. Install backend dependencies
cd server
npm install
cd ..

# 3. Install frontend dependencies
cd argumentor-react2
npm install
cd ..

# 4. Install Python dependencies
pip install requests python-dotenv

# 5. Build frontend
cd argumentor-react2
npm run build
cd ..

# 6. Create .env file (see Step 3 above)
# Edit server/.env with your configuration

# 7. Start server
cd server
npm start
```

---

## 🔍 Troubleshooting

### Issue: "npm: command not found"
**Solution**: Install Node.js from https://nodejs.org/

### Issue: "python: command not found"
**Solution**: 
- Install Python from https://www.python.org/
- Make sure to check "Add Python to PATH" during installation
- Restart terminal after installation

### Issue: "Port 5000 already in use"
**Solution**: 
```powershell
# Windows - Find and kill process on port 5000
netstat -ano | findstr :5000
taskkill /PID <PID_NUMBER> /F

# Or change port in server/.env:
PORT=5001
```

### Issue: "Mistral API error"
**Solution**: 
- Check `MISTRAL_API_KEY` in `server/.env`
- Verify API key is valid
- Check internet connection

### Issue: "Module not found" errors
**Solution**: 
```powershell
# Reinstall dependencies
cd server
rm -rf node_modules
npm install
cd ../argumentor-react2
rm -rf node_modules
npm install
```

### Issue: Frontend not loading
**Solution**: 
```powershell
# Rebuild frontend
cd argumentor-react2
npm run build
cd ..
```

### Issue: MongoDB connection error
**Solution**: 
- Project works without MongoDB (uses local JSON storage)
- Comment out `MONGODB_URI` in `server/.env` if not using MongoDB
- Cases will be stored in `server/data/local_cases.json`

---

## 📁 Project Structure

```
Argumentor 2.0/
├── server/                 # Backend (Node.js/Express)
│   ├── .env               # Environment variables (CREATE THIS)
│   ├── index.js           # Main server file
│   ├── routes/            # API routes
│   ├── lib/               # Utilities
│   ├── models/            # Data models
│   └── data/              # Local storage (auto-created)
│       └── local_cases.json
├── argumentor-react2/      # Frontend (React/TypeScript)
│   ├── src/               # Source files
│   └── dist/              # Built files (after npm run build)
├── mistral_inference.py   # AI inference script
└── SETUP_GUIDE.md        # This file
```

---

## 🎯 Features

Once running, you can:

1. **Upload Cases**: Dashboard → Upload legal documents
2. **Analyze Cases**: Analysis tab → Select case → Run analysis
3. **AI Chat**: Chat tab → Ask questions about cases
4. **Predict Outcomes**: Outcome tab → Get predictions
5. **Generate Counterarguments**: Counterarguments tab
6. **Delete Cases**: Click trash icon on any case

---

## 🔐 Security Notes

- Keep `server/.env` file private (contains API keys)
- Don't commit `.env` to version control
- Use environment variables for sensitive data

---

## 📞 Support

If you encounter issues:

1. Check server terminal for error messages
2. Check browser console (F12) for frontend errors
3. Verify all prerequisites are installed
4. Ensure `.env` file is configured correctly
5. Try rebuilding frontend: `cd argumentor-react2 && npm run build`

---

## ✅ Installation Checklist

- [ ] Node.js installed (`node --version`)
- [ ] Python installed (`python --version`)
- [ ] Backend dependencies installed (`cd server && npm install`)
- [ ] Frontend dependencies installed (`cd argumentor-react2 && npm install`)
- [ ] Python packages installed (`pip install requests python-dotenv`)
- [ ] `.env` file created in `server/` folder
- [ ] Frontend built (`cd argumentor-react2 && npm run build`)
- [ ] Server started (`cd server && npm start`)
- [ ] Application accessible at `http://localhost:5000`

---

**🎉 You're all set! Enjoy using ArguMentor 2.0!**

