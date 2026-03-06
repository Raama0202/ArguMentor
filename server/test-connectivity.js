/**
 * Quick connectivity test for ArguMentor
 * Run: node test-connectivity.js
 *
 * Tests:
 * 1. Environment variables are set
 * 2. MongoDB connection
 * 3. OpenAI API access
 * 4. Mistral endpoint reachability
 */

import 'dotenv/config';
import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

const tests = [];

function log(label, status, message) {
  const icon = status === 'PASS' ? '✓' : status === 'WARN' ? '⚠' : '✗';
  console.log(`${icon} [${label}] ${status.padEnd(6)} - ${message}`);
  tests.push({ label, status, message });
}

async function testEnvVars() {
  console.log('\n=== ENVIRONMENT VARIABLES ===\n');

  const vars = [
    { key: 'GEMINI_API_KEY', alt: null, required: true },
    { key: 'MONGODB_URI', required: true },
    { key: 'MONGODB_DB', required: false, default: 'argumentor' }
  ];

  for (const { key, alt, required, default: def } of vars) {
    const val = process.env[key] || process.env[alt];
    if (val) {
      const masked = val.substring(0, 10) + '***' + val.substring(Math.max(10, val.length - 5));
      log(key, 'PASS', `Set: ${masked}`);
    } else if (!required) {
      log(key, 'WARN', `Not set (default: ${def})`);
    } else {
      log(key, 'FAIL', `Missing (required)`);
    }
  }
}

async function testMongoDB() {
  console.log('\n=== MONGODB CONNECTION ===\n');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    log('MongoDB URI', 'FAIL', 'No MONGODB_URI set');
    return;
  }

  try {
    const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();

    const adminDb = client.db('admin');
    const result = await adminDb.command({ ping: 1 });

    log('MongoDB Connection', 'PASS', 'Connected and ping successful');

    // List databases
    const dbs = await adminDb.admin().listDatabases();
    log('Database Count', 'PASS', `Found ${dbs.databases.length} databases`);

    await client.close();
  } catch (e) {
    log('MongoDB Connection', 'FAIL', e.message);
  }
}

async function testGemini() {
  console.log('\n=== GEMINI API ===\n');

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  if (!apiKey) {
    log('Gemini Key', 'FAIL', 'No GEMINI_API_KEY found');
    return;
  }

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const body = {
      contents: [{ parts: [{ text: 'Say hello' }] }],
      generationConfig: { maxOutputTokens: 10 }
    };

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (resp.ok) {
      const data = await resp.json();
      const ok = data && data.candidates && data.candidates.length > 0;
      log('Gemini API', 'PASS', ok ? 'Connected and responding' : 'Connected but no candidates returned');
    } else {
      const text = await resp.text();
      log('Gemini API', 'FAIL', `HTTP ${resp.status}: ${text.substring(0, 200)}`);
    }
  } catch (e) {
    log('Gemini API', 'FAIL', e.message);
  }
}

async function testMistral() {
  // Mistral has been removed from the pipeline; skip this test to avoid false failures.
  console.log('\n=== MISTRAL / HUGGING FACE ===\n');
  log('Mistral Inference', 'WARN', 'Mistral removed — using Gemini-only pipeline');
}

async function testPython() {
  console.log('\n=== PYTHON ENVIRONMENT ===\n');

  const { spawn } = await import('child_process');

  const pythonBin = process.env.PYTHON_BIN || 'python';

  return new Promise((resolve) => {
    // Avoid shell:true to prevent issues with paths that contain spaces
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
        const version = (output + error).trim();
        log('Python Executable', 'PASS', version);

        // Try to import requests
        const checkReqs = spawn(pythonBin, ['-c', 'import requests; print("OK")'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false
        });

        let reqOutput = '';
        checkReqs.stdout.on('data', (d) => { reqOutput += d.toString(); });
        checkReqs.on('close', (reqCode) => {
          if (reqCode === 0) {
            log('Python Requests Module', 'PASS', 'requests module available');
          } else {
            log('Python Requests Module', 'WARN', 'requests not installed (run: pip install requests)');
          }
          resolve();
        });
      } else {
        log('Python Executable', 'FAIL', `Not found or error: ${error}`);
        resolve();
      }
    });
  });
}

async function printSummary() {
  console.log('\n=== TEST SUMMARY ===\n');

  const passed = tests.filter(t => t.status === 'PASS').length;
  const warned = tests.filter(t => t.status === 'WARN').length;
  const failed = tests.filter(t => t.status === 'FAIL').length;

  console.log(`  PASS:  ${passed}`);
  console.log(`  WARN:  ${warned}`);
  console.log(`  FAIL:  ${failed}`);
  console.log(`  TOTAL: ${tests.length}\n`);

  if (failed === 0 && warned === 0) {
    console.log('✓ All tests passed! Your ArguMentor setup is ready.\n');
  } else if (failed === 0) {
    console.log('⚠ Some warnings present, but core functionality may work.\n');
  } else {
    console.log('✗ Some tests failed. Fix the issues above and try again.\n');
  }
}

async function runTests() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║        ArguMentor Connectivity Test Suite              ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  await testEnvVars();
  await testMongoDB();
  await testGemini();
  await testMistral();
  await testPython();
  await printSummary();
}

runTests().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
