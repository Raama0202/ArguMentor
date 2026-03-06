import 'dotenv/config';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded from the server directory
const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });

import express from 'express';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import uploadRouter from './routes/upload.js';
import analyzeRouter from './routes/analyze.js';
import chatRouter from './routes/chat.js';
import counterargumentsRouter from './routes/counterarguments.js';
import predictOutcomeRouter from './routes/predictOutcome.js';
import memoryRouter from './routes/memory.js';
import schedulesRouter from './routes/schedules.js';
import testRouter from './routes/test.js';
import memoRouter from './routes/memo.js';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';

const app = express();
const server = http.createServer(app);
try {
  const io = new SocketIOServer(server, { cors: { origin: '*'} });
  app.set('io', io);
  console.log('[server] ✅ Socket.IO initialized');
} catch (e) {
  console.error('[server] ❌ Socket.IO initialization failed:', e.message);
  console.error(e);
}
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Serve the built React frontend
const frontendPath = path.join(__dirname, '..', 'argumentor-react2', 'dist');
app.use(express.static(frontendPath));

// Configure global logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    return originalSend.call(this, data);
  };
  next();
});

// MongoDB connection
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const mongoDbName = process.env.MONGODB_DB || 'argumentor';

let mongoClient; // shared client
async function initMongo() {
  if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected()) {
    console.log('[server] MongoDB already connected');
    return;
  }
  
  const baseOptions = {
    ignoreUndefined: true,
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    family: 4, // force IPv4 DNS to avoid IPv6/SRV edge cases
  };

  const makeClient = (uri) => new MongoClient(uri, baseOptions);
  const attemptUris = [mongoUri];
  // Allow explicit direct URI override via env
  if (process.env.MONGODB_URI_DIRECT) attemptUris.push(process.env.MONGODB_URI_DIRECT);
  if (process.env.DIRECT_MONGODB_URI) attemptUris.push(process.env.DIRECT_MONGODB_URI);
  // Fallback: if SRV lookup fails, try a direct connection string (same host) without SRV
  if (mongoUri.startsWith('mongodb+srv://')) {
    try {
      const srvUrl = new URL(mongoUri);
      const host = srvUrl.hostname; // e.g., argumentor.9koqypr.mongodb.net
      // Preserve credentials and search params if present
      const directUri = `mongodb://${srvUrl.username ? `${srvUrl.username}:${srvUrl.password}@` : ''}${host}/${srvUrl.pathname.replace(/^\//, '') || ''}${srvUrl.search || ''}`;
      // Ensure retryWrites and TLS if not already set
      const hasRetry = /[?&]retryWrites=/.test(directUri);
      const hasTls = /[?&](tls|ssl)=/.test(directUri);
      const suffixParts = [];
      if (!hasRetry) suffixParts.push('retryWrites=true');
      if (!hasTls) suffixParts.push('tls=true');
      const suffix = suffixParts.length ? (directUri.includes('?') ? '&' : '?') + suffixParts.join('&') : '';
      attemptUris.push(directUri + suffix);
    } catch {
      // ignore malformed URL
    }
  }

  let lastErr;
  for (const candidate of attemptUris) {
    mongoClient = makeClient(candidate);
    try {
      console.log(`[server] 🔄 Attempting to connect to MongoDB...`);
      console.log(`[server] MongoDB URI: ${candidate.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);
      await mongoClient.connect();

      // Verify connection
      const db = mongoClient.db(mongoDbName);
      await db.command({ ping: 1 });
      console.log(`[server] ✅ Connected to MongoDB successfully`);
      console.log(`[server] Database: ${mongoDbName}`);

      // Test a simple operation
      const collections = await db.listCollections().toArray();
      console.log(`[server] Collections found: ${collections.length}`);

      app.set('mongoConnected', true);
      return;
    } catch (err) {
      lastErr = err;
      console.error('[server] ❌ Failed to connect to MongoDB with URI:', candidate.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));
      console.error('[server] Error message:', err && err.message ? err.message : err);
      console.error('[server] Error code:', err?.code);
      console.error('[server] Error name:', err?.name);
      if (err?.stack) {
        console.error('[server] Stack trace:', err.stack.split('\n').slice(0, 5).join('\n'));
      }
      // Try next candidate, if any
    }
  }

  console.error('[server] ❌ All MongoDB connection attempts failed.');
  if (lastErr) {
    console.error('[server] Last error message:', lastErr?.message);
  }
  app.set('mongoConnected', false);
}

// Create a backup of server/.env on startup if it exists and a backup is not present.
try {
  const envPath = path.join(__dirname, '.env');
  const backupPath = path.join(__dirname, '.env.backup');
  if (fs.existsSync(envPath) && !fs.existsSync(backupPath)) {
    fs.copyFileSync(envPath, backupPath);
    console.log('[server] Created backup of server/.env -> server/.env.backup');
  }
} catch (e) {
  console.warn('[server] Could not create .env backup:', e && e.message ? e.message : e);
}

// If a virtualenv python exists in workspace .venv, set PYTHON_BIN so child processes use it (helps ensure requests/python-dotenv are available)
try {
  const venvPython = path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe');
  if (!process.env.PYTHON_BIN && fs.existsSync(venvPython)) {
    process.env.PYTHON_BIN = venvPython;
    console.log('[server] Set PYTHON_BIN to workspace venv:', venvPython);
  }
} catch (e) {
  // ignore
}

// Inject db into request
app.use(async (req, res, next) => {
  try {
    if (!mongoClient || !mongoClient.topology || !mongoClient.topology.isConnected()) {
      try { 
        await initMongo(); 
      } catch (e) { 
        // MongoDB connection failed but don't block - routes can handle failures
        console.warn('[server] MongoDB unavailable for request, continuing with fallback');
      }
    }
    if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected()) {
      req.db = mongoClient.db(mongoDbName);
    } else {
      // Set a flag so routes know MongoDB isn't available
      req.mongoAvailable = false;
    }
  } catch (e) {
    console.error('[server] Error setting up DB middleware:', e.message);
    req.mongoAvailable = false;
  }
  next();
});

// Routes
app.use('/api', uploadRouter);
app.use('/api', analyzeRouter);
app.use('/api', chatRouter);
app.use('/api', counterargumentsRouter);
app.use('/api', predictOutcomeRouter);
app.use('/api', memoryRouter);
app.use('/api', schedulesRouter);
app.use('/api', memoRouter);
app.use('/api/test', testRouter);

// Multer / upload error handler - return JSON responses for common upload errors (file size, unsupported type)
app.use((err, req, res, next) => {
  try {
    console.error('[server] Error middleware caught:', err && err.message ? err.message : err);
    if (err && (err.code === 'LIMIT_FILE_SIZE' || /file size/i.test(err.message || ''))) {
      return res.status(413).json({ ok: false, error: 'File too large. Max size is 50MB.' });
    }
    if (err && err.message === 'Unsupported file type') {
      return res.status(400).json({ ok: false, error: 'Unsupported file type. Allowed: PDF, DOCX, PNG, JPG, WEBP.' });
    }
    if (err && err.name === 'MulterError') {
      return res.status(400).json({ ok: false, error: err.message || 'Upload failed' });
    }
  } catch (e) {
    console.error('[server] Error handler failed:', e && e.message ? e.message : e);
  }
  return next(err);
});

// Health endpoint for quick checks
app.get('/health', async (req, res) => {
  const env = {
    hasGroqKey: !!(process.env.GROQ_API_KEY),
    mongoUriConfigured: !!process.env.MONGODB_URI
  };

  // try quick mongo ping if client exists
  let mongo = { connected: false };
  try {
    if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected()) {
      mongo.connected = true;
    } else if (app.get('mongoConnected')) {
      mongo.connected = true;
    } else {
      // attempt to init in case it hasn't
      await initMongo();
      mongo.connected = true;
    }
  } catch (e) {
    mongo.connected = false;
  }

  res.json({ ok: true, env, mongo });
});

// Catch-all route to serve React SPA
app.get('*', (req, res) => {
  const indexPath = path.join(frontendPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error('[server] Error serving index.html:', err.message);
      res.status(500).send('Server error');
    }
  });
});

// Global JSON error handler - ensure clients receive JSON on unexpected errors
app.use((err, req, res, next) => {
  try {
    console.error('[server] Unhandled error:', err && err.message ? err.message : err);
    if (res.headersSent) return next(err);
    res.status(err && err.status ? err.status : 500).json({ ok: false, error: err && err.message ? err.message : 'Internal Server Error' });
  } catch (e) {
    console.error('[server] Error in global error handler:', e && e.message ? e.message : e);
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
});

const port = process.env.PORT || 5000;

server.on('error', (err) => {
  console.error('[server] ❌ Server error:', err.message);
  process.exit(1);
});

server.listen(port, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[server] 🚀 ArguMentor Backend Started`);
  console.log(`${'='.repeat(60)}`);
  console.log(`[server] ✅ Server listening on http://localhost:${port}`);
  console.log(`[server] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[server] Groq API: ${process.env.GROQ_API_KEY ? '✅ Configured' : '❌ Not set'}`);
  console.log(`[server] MongoDB URI: ${process.env.MONGODB_URI ? '✅ Configured' : '❌ Not set'}`);
  
  // Initialize MongoDB connection
  initMongo().catch(err => {
    console.error('[server] MongoDB initialization failed:', err.message);
  });
  console.log(`[server]`);
  console.log(`[server] 📊 Test endpoints:`);
  console.log(`[server]   GET /api/test/all     - Full system health check`);
  console.log(`[server]   GET /api/test-mongo   - MongoDB connectivity`);
  console.log(`[server]   GET /api/test-groq    - Groq API test`);
  console.log(`[server]   GET /api/test-python  - Python interpreter test`);
  console.log(`[server]   GET /api/test-env     - Environment variables`);
  console.log(`[server]`);
  console.log(`[server] 🏥 Health endpoint: GET /health`);
  console.log(`${'='.repeat(60)}\n`);
});

process.on('uncaughtException', (err) => {
  console.error('[server] ❌ Uncaught Exception:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[server] ❌ Unhandled Rejection at:', promise, 'reason:', reason);
  console.error(reason);
});


