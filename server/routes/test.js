import express from 'express';
import { callLLM } from '../lib/llm.js';

const router = express.Router();

/**
 * Comprehensive test endpoint for debugging all AI services
 */

// Backwards-compatible aliases (README/server banner expects these)
router.get('/all', (req, res, next) => { req.url = '/test-all'; next(); });
router.get('/mongo', (req, res, next) => { req.url = '/test-mongo'; next(); });
router.get('/mistral', (req, res, next) => { req.url = '/test-mistral'; next(); });
router.get('/python', (req, res, next) => { req.url = '/test-python'; next(); });
router.get('/env', (req, res, next) => { req.url = '/test-env'; next(); });

// Test MongoDB connection
router.get('/test-mongo', async (req, res) => {
  try {
    const db = req.db;
    if (!db) {
      console.warn('[test-mongo] Database not available in request');
      return res.status(503).json({
        ok: false,
        service: 'MongoDB',
        status: 'UNAVAILABLE',
        error: 'Database connection not available. Check MongoDB connection and middleware setup.'
      });
    }
    const pingResult = await db.admin().command({ ping: 1 });
    
    console.log('[test-mongo] PASS - MongoDB is connected');
    console.log('[test-mongo] Ping result:', pingResult);
    
    return res.json({
      ok: true,
      service: 'MongoDB',
      status: 'CONNECTED',
      ping: pingResult,
      uri: process.env.MONGODB_URI ? process.env.MONGODB_URI.substring(0, 40) + '...' : 'NOT_SET'
    });
  } catch (e) {
    console.error('[test-mongo] FAIL:', e.message);
    return res.status(500).json({
      ok: false,
      service: 'MongoDB',
      status: 'FAILED',
      error: e.message,
      uri: process.env.MONGODB_URI ? process.env.MONGODB_URI.substring(0, 40) + '...' : 'NOT_SET'
    });
  }
});

// Test Mistral API
router.get('/test-mistral', async (req, res) => {
  try {
    if (!(process.env.MISTRAL_API_KEY || process.env.MISTRAL_KEY || process.env.HF_TOKEN)) {
      return res.status(400).json({ ok: false, service: 'Mistral API', status: 'NOT_CONFIGURED', error: 'MISTRAL_API_KEY not set' });
    }

    const messages = [
      { role: 'system', content: 'You are a diagnostic assistant. Reply with "Mistral OK" only.' },
      { role: 'user', content: 'Sanity check: respond with Mistral OK' }
    ];

    const out = await callLLM(messages, { max_tokens: 30, temperature: 0 });
    const reply = String(out?.raw || '').slice(0, 200);
    return res.json({ ok: true, service: 'Mistral API', status: 'WORKING', model: out?.meta?.model, reply });
  } catch (e) {
    console.error('[test-mistral] ERROR:', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, service: 'Mistral API', status: 'ERROR', error: e.message || String(e) });
  }
});

// Test Python inference engine
router.get('/test-python', async (req, res) => {
  try {
    const { spawn } = await import('child_process');
    const path = await import('path');
    const pythonBin = process.env.PYTHON_BIN || 'python';
    
    console.log(`[test-python] Using python binary: ${pythonBin}`);

    return new Promise((resolve) => {
      const child = spawn(pythonBin, ['--version'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false
      });

      let output = '';
      let error = '';

      child.stdout.on('data', (d) => { output += d.toString(); });
      child.stderr.on('data', (d) => { error += d.toString(); });

      child.on('close', (code) => {
        if (code === 0) {
          console.log('[test-python] PASS - Python version:', output.trim());
          resolve(res.json({
            ok: true,
            service: 'Python Interpreter',
            status: 'WORKING',
            version: output.trim(),
            pythonBin
          }));
        } else {
          console.error('[test-python] FAIL - Python not found or error:', error);
          resolve(res.status(500).json({
            ok: false,
            service: 'Python Interpreter',
            status: 'FAILED',
            error: error || 'Python executable not found',
            pythonBin
          }));
        }
      });

      child.on('error', (err) => {
        console.error('[test-python] ERROR:', err.message);
        resolve(res.status(500).json({
          ok: false,
          service: 'Python Interpreter',
          status: 'ERROR',
          error: err.message,
          pythonBin
        }));
      });
    });
  } catch (e) {
    console.error('[test-python] ERROR:', e.message);
    return res.status(500).json({
      ok: false,
      service: 'Python Interpreter',
      status: 'ERROR',
      error: e.message
    });
  }
});

// Enhanced python locator diagnostic
router.get('/test-python-locate', (req, res) => {
  try {
    const path = require('path');
    const { locatePythonBinary } = require('../lib/python.js');
    const workspaceRoot = path.join(__dirname, '..', '..');
    const r = locatePythonBinary(workspaceRoot);
    return res.json({ ok: true, locator: r });
  } catch (e) {
    console.error('[test-python-locate] ERROR:', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
  }
});

// Diagnostic: attempt to run the real inference script with a short timeout to reproduce spawn errors (safe, non-destructive)
router.get('/test-python-run', async (req, res) => {
  try {
    const path = require('path');
    const workspaceRoot = path.join(__dirname, '..', '..');
    const possiblePaths = [
      path.join(workspaceRoot, 'mistral_inference.py'),
      path.join(workspaceRoot, 'ai_engine', 'mistral_inference.py')
    ];
    const scriptPath = possiblePaths.find(p => require('fs').existsSync(p));
    if (!scriptPath) return res.status(404).json({ ok: false, error: 'Inference script not found' });

    const { locatePythonBinary } = require('../lib/python.js');
    const { selected, results } = locatePythonBinary(workspaceRoot);
    const pythonCmd = selected || process.env.PYTHON_BIN || 'python';

    console.log('[test-python-run] Attempting to run', pythonCmd, scriptPath);

    const { spawn } = require('child_process');
    const child = spawn(pythonCmd, [scriptPath, '--prompt', 'diagnostic', '--context', '{}'], { cwd: path.dirname(scriptPath), env: { ...process.env }, stdio: ['pipe','pipe','pipe'], windowsHide: true });

    let out = '';
    let err = '';
    let timedOut = false;

    const to = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch(e) {}
    }, 5000);

    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });

    child.on('close', (code, signal) => {
      clearTimeout(to);
      return res.json({ ok: true, code, signal, timedOut, stdout: out.slice(0, 2000), stderr: err.slice(0, 2000), selected, locateResults: results.map(r => ({ candidate: r.candidate, ok: r.ok, error: r.error })) });
    });

    child.on('error', (e) => {
      clearTimeout(to);
      console.error('[test-python-run] spawn error:', e && e.message ? e.message : e);
      return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e), selected, locateResults: results.map(r => ({ candidate: r.candidate, ok: r.ok, error: r.error })) });
    });
  } catch (e) {
    console.error('[test-python-run] ERROR:', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
  }
});

// Test environment variables
router.get('/test-env', (req, res) => {
  const requiredVars = {
    'MISTRAL_API_KEY': process.env.MISTRAL_API_KEY || process.env.MISTRAL_KEY || process.env.HF_TOKEN,
    'MISTRAL_MODEL': process.env.MISTRAL_MODEL,
    'MONGODB_URI': process.env.MONGODB_URI,
    'MONGODB_DB': process.env.MONGODB_DB,
    'PORT': process.env.PORT
  };

  const optionalVars = {
    'MISTRAL_KEY': process.env.MISTRAL_KEY,
    'MISTRAL_HF_ENDPOINT_URL': process.env.MISTRAL_HF_ENDPOINT_URL,
    'PYTHON_BIN': process.env.PYTHON_BIN,
    'NODE_ENV': process.env.NODE_ENV
  };

  const missingRequired = Object.entries(requiredVars)
    .filter(([_, v]) => !v)
    .map(([k]) => k);

  console.log('[test-env] Environment variables check:');
  console.log('[test-env] Required vars set:', Object.keys(requiredVars).length - missingRequired.length, '/', Object.keys(requiredVars).length);
  if (missingRequired.length > 0) {
    console.warn('[test-env] Missing required:', missingRequired);
  }

  return res.json({
    ok: missingRequired.length === 0,
    required: Object.fromEntries(
      Object.entries(requiredVars).map(([k, v]) => [
        k,
        v ? { status: 'SET', value: v.substring(0, 20) + '...' } : { status: 'MISSING', value: null }
      ])
    ),
    optional: Object.fromEntries(
      Object.entries(optionalVars).map(([k, v]) => [
        k,
        v ? { status: 'SET', value: v.substring(0, 20) + '...' } : { status: 'NOT_SET', value: null }
      ])
    ),
    missing: missingRequired
  });
});

// Comprehensive health check
router.get('/test-all', async (req, res) => {
  console.log('[test-all] Running comprehensive system test...');
  
  const results = {
    timestamp: new Date().toISOString(),
    tests: {}
  };

  // Test MongoDB
  try {
    const db = req.db;
    if (!db) {
      results.tests.mongodb = { status: 'SKIP', message: 'MongoDB not available (using local fallback storage)' };
      console.log('[test-all] MongoDB: SKIP (fallback mode)');
    } else {
    await db.admin().command({ ping: 1 });
    results.tests.mongodb = { status: 'PASS', message: 'Connected' };
    console.log('[test-all] MongoDB: PASS');
    }
  } catch (e) {
    results.tests.mongodb = { status: 'FAIL', message: e.message };
    console.error('[test-all] MongoDB: FAIL -', e.message);
  }

  // Test Mistral
  try {
    const messages = [
      { role: 'system', content: 'You are a diagnostic assistant. Reply with "Mistral OK".' },
      { role: 'user', content: 'test' }
    ];
    const out = await callLLM(messages, { max_tokens: 20, temperature: 0 });
    const reply = String(out?.raw || '');
    results.tests.mistral = { status: 'PASS', message: String(reply).slice(0, 100) };
    console.log('[test-all] Mistral: PASS');
  } catch (e) {
    results.tests.mistral = { status: 'FAIL', message: e.message };
    console.error('[test-all] Mistral: FAIL -', e.message);
  }

  // Test Python
  try {
    const { spawn } = await import('child_process');
    const pythonBin = process.env.PYTHON_BIN || 'python';
    
    await new Promise((resolve, reject) => {
      const child = spawn(pythonBin, ['--version'], { stdio: 'pipe' });
      let output = '';
      child.stdout.on('data', (d) => { output += d.toString(); });
      child.on('close', (code) => {
        if (code === 0) {
          results.tests.python = { status: 'PASS', message: output.trim() };
          console.log('[test-all] Python: PASS');
          resolve();
        } else {
          reject(new Error('Python not found'));
        }
      });
      child.on('error', reject);
    });
  } catch (e) {
    results.tests.python = { status: 'FAIL', message: e.message };
    console.error('[test-all] Python: FAIL -', e.message);
  }

  // Test Environment
  const requiredVars = ['MISTRAL_API_KEY'];
  const missingVars = requiredVars.filter(v => !process.env[v]);
  
  results.tests.environment = {
    status: missingVars.length === 0 ? 'PASS' : 'FAIL',
    message: missingVars.length === 0 ? 'All required vars set' : `Missing: ${missingVars.join(', ')}`
  };
  console.log('[test-all] Environment:', results.tests.environment.status);

  // Summary
  const criticalTests = ['mongodb', 'mistral', 'environment'];
  const criticalPassed = criticalTests.every(t => results.tests[t]?.status === 'PASS' || results.tests[t]?.status === 'SKIP');
  const allPassed = Object.values(results.tests).every(t => t.status === 'PASS' || t.status === 'SKIP');
  
  results.summary = {
    allPassed: criticalPassed,
    totalTests: Object.keys(results.tests).length,
    passed: Object.values(results.tests).filter(t => t.status === 'PASS').length,
    failed: Object.values(results.tests).filter(t => t.status === 'FAIL').length,
    skipped: Object.values(results.tests).filter(t => t.status === 'SKIP').length
  };

  console.log('[test-all] Summary:', results.summary);
  
  return res.json({ ok: criticalPassed, ...results });
});

export default router;
