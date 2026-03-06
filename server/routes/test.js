import express from 'express';
import fetch from 'node-fetch';
import { callGroq } from '../lib/groqClient.js';

const router = express.Router();

/**
 * Comprehensive test endpoint for debugging all AI services
 */

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

// Test Mistral API (legacy)
router.get('/test-mistral', async (req, res) => {
  // Keep as-is but mark as SKIP when not configured
  const endpoint = process.env.MISTRAL_HF_ENDPOINT_URL;
  const mistralToken = process.env.MISTRAL_KEY || process.env.HF_TOKEN;
  if (!endpoint || !mistralToken) {
    return res.status(200).json({ ok: false, service: 'Mistral API', status: 'SKIP', message: 'Not configured' });
  }
  return res.json({ ok: true, service: 'Mistral API', status: 'CONFIGURED', endpoint: endpoint.substring(0, 80) + '...' });
});

// Test Groq API (replaces legacy Gemini test)
router.get('/test-groq', async (req, res) => {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

    if (!apiKey) {
      console.warn('[test-groq] FAIL - GROQ_API_KEY not set');
      return res.status(400).json({ ok: false, service: 'Groq API', status: 'NOT_CONFIGURED', error: 'GROQ_API_KEY not set' });
    }

    const messages = [
      { role: 'system', content: 'You are a diagnostic assistant. Reply with "Groq OK" only.' },
      { role: 'user', content: 'Sanity check: respond with Groq OK' }
    ];

    let out;
    try {
      out = await callGroq(messages, { models: [model] });
    } catch (e) {
      console.error('[test-groq] Groq call failed:', e.message || e);
      return res.status(502).json({ ok: false, service: 'Groq API', status: 'FAILED', error: e.message || String(e) });
    }

    const reply = out?.choices?.[0]?.message?.content || out?.choices?.[0]?.text || (out?.raw || '').toString();
    return res.json({ ok: true, service: 'Groq API', status: 'WORKING', model, reply: String(reply).slice(0, 200) });
  } catch (e) {
    console.error('[test-groq] ERROR:', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, service: 'Groq API', status: 'ERROR', error: e.message || String(e) });
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
    'GROQ_API_KEY': process.env.GROQ_API_KEY,
    'GROQ_MODEL': process.env.GROQ_MODEL,
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
    if (!db) throw new Error('Database not available');
    await db.admin().command({ ping: 1 });
    results.tests.mongodb = { status: 'PASS', message: 'Connected' };
    console.log('[test-all] MongoDB: PASS');
  } catch (e) {
    results.tests.mongodb = { status: 'FAIL', message: e.message };
    console.error('[test-all] MongoDB: FAIL -', e.message);
  }

  // Test Groq
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set');

    const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
    const messages = [
      { role: 'system', content: 'You are a diagnostic assistant. Reply with "OK".' },
      { role: 'user', content: 'test' }
    ];

    const out = await callGroq(messages, { models: [model], extra: { max_tokens: 10, temperature: 0 } });
    const reply = out?.choices?.[0]?.message?.content || out?.choices?.[0]?.text || (out?.raw || '').toString();
    results.tests.groq = { status: 'PASS', message: String(reply).slice(0, 100) };
    console.log('[test-all] Groq: PASS');
  } catch (e) {
    results.tests.groq = { status: 'FAIL', message: e.message };
    console.error('[test-all] Groq: FAIL -', e.message);
  }

  // Test Mistral (if configured)
  try {
    const endpoint = process.env.MISTRAL_HF_ENDPOINT_URL;
    const mistralToken = process.env.MISTRAL_KEY || process.env.HF_TOKEN;
    
    if (!endpoint || !mistralToken) {
      results.tests.mistral = { status: 'SKIP', message: 'Not configured' };
      console.log('[test-all] Mistral: SKIP (not configured)');
    } else {
      const payload = {
        model: "mistral-7b-instruct",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10
      };
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${mistralToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        results.tests.mistral = { status: 'PASS', message: 'API responding' };
        console.log('[test-all] Mistral: PASS');
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    }
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
  const requiredVars = ['GROQ_API_KEY', 'MONGODB_URI'];
  const missingVars = requiredVars.filter(v => !process.env[v]);
  
  results.tests.environment = {
    status: missingVars.length === 0 ? 'PASS' : 'FAIL',
    message: missingVars.length === 0 ? 'All required vars set' : `Missing: ${missingVars.join(', ')}`
  };
  console.log('[test-all] Environment:', results.tests.environment.status);

  // Summary
  const criticalTests = ['mongodb', 'groq', 'environment'];
  const criticalPassed = criticalTests.every(t => results.tests[t]?.status === 'PASS');
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
