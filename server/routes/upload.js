import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import imageSize from 'image-size';
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import { upsertCaseMemory } from '../models/caseMemory.js';
import { saveCase as saveLocalCase } from '../models/localCases.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    cb(null, `${base}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/png', 'image/jpeg', 'image/jpg', 'image/webp'
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type'));
  }
});

async function extractFromPdf(filePath) {
  const data = await pdf(fs.readFileSync(filePath));
  return { text: (data.text || '').trim(), meta: { pages: data.numpages || undefined } };
}

async function extractFromDocx(filePath) {
  const res = await mammoth.extractRawText({ path: filePath });
  return { text: (res.value || '').trim(), meta: { warnings: res.messages?.length || 0 } };
}

async function extractFromImage(filePath) {
  const dim = imageSize(filePath);
  const meta = { width: dim.width, height: dim.height, type: dim.type };
  return { text: '', meta };
}

import { locatePythonBinary } from '../lib/python.js';

function getPythonBinary() {
  const py = process.env.PYTHON_BIN || 'python';
  if (py === 'python' || py === 'python3' || py === 'py') return py;
  try {
    if (fs.existsSync(py)) return py;
  } catch (e) { /* ignore */ }
  return 'python';
}

async function spawnLocalInference(prompt, context) {
  const workspaceRoot = path.join(__dirname, '..', '..');

  const possiblePaths = [
    path.join(workspaceRoot, 'mistral_inference.py'),
    path.join(workspaceRoot, 'ai_engine', 'mistral_inference.py'),
  ];
  const scriptPath = possiblePaths.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || possiblePaths[0];

  // Try to locate a working python binary
  const { selected, results } = locatePythonBinary(workspaceRoot);
  console.log('[upload] locatePythonBinary results:', { selected, results: results.map(r => ({ candidate: r.candidate, ok: r.ok, error: r.error ? r.error.slice(0,150) : null })) });

  // If locate found a working binary, set it for subsequent spawns
  if (selected) {
    process.env.PYTHON_BIN = selected;
  }

  let pythonCmd = selected || getPythonBinary();
  let args = [scriptPath, '--prompt', prompt, '--context', context];

  // If candidate is 'py' (Windows launcher), prefer using ['-3', script]
  if (pythonCmd === 'py') {
    args = ['-3', scriptPath, '--prompt', prompt, '--context', context];
  }

  const spawnOpts = {
    cwd: path.dirname(scriptPath) || workspaceRoot,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  };

  const trySpawn = (cmd, args, opts) => {
    try {
      console.log('[upload] Attempting spawn:', cmd, args.join(' '), 'cwd:', opts.cwd);
      return spawn(cmd, args, opts);
    } catch (err) {
      console.warn('[upload] spawn() threw for', cmd, err && err.message ? err.message : err, 'code:', err && err.code);
      return null;
    }
  };

  // Primary attempt
  let child = trySpawn(pythonCmd, args, spawnOpts);
  if (child) return child;

  // Fallback via execFile (may surface permission issues differently)
  try {
    const { execFile } = await import('child_process');
    const execTry = (cmd, args) => new Promise((resolve) => {
      try {
        const p = execFile(cmd, args, { cwd: spawnOpts.cwd, env: spawnOpts.env }, (error, stdout, stderr) => {
          if (error) return resolve({ error, stdout: stdout?.toString(), stderr: stderr?.toString() });
          return resolve({ stdout: stdout?.toString(), stderr: stderr?.toString() });
        });
        // convert to a readable-like object to keep callers uniform
        resolve(p);
      } catch (e) {
        resolve({ error: e });
      }
    });

    const fallbackCandidates = [];
    if (pythonCmd !== 'python') fallbackCandidates.push({ cmd: 'python', args: [scriptPath, '--prompt', prompt, '--context', context] });
    if (pythonCmd !== 'py') fallbackCandidates.push({ cmd: 'py', args: ['-3', scriptPath, '--prompt', prompt, '--context', context] });

    for (const fb of fallbackCandidates) {
      console.warn('[upload] Trying execFile fallback:', fb.cmd, fb.args.join(' '));
      // Try execFile; we don't need to wait for full run here — if execFile returns quickly with error, collect it
      const res = await execTry(fb.cmd, fb.args);
      if (res && !res.error) {
        // If execFile succeeded, spawn a long-running child using that command
        const spawned = trySpawn(fb.cmd, fb.args, spawnOpts);
        if (spawned) return spawned;
      } else {
        console.warn('[upload] execFile fallback returned error for', fb.cmd, res && res.error ? res.error.message || res.error : res);
      }
    }
  } catch (e) {
    console.warn('[upload] execFile fallback attempt failed to initialize:', e && e.message ? e.message : e);
  }

  // As last resort, try spawning via shell (may bypass certain Windows exec permission quirks)
  try {
    console.warn('[upload] Trying shell-based spawn as last resort');
    const shellChild = spawn(process.platform === 'win32' ? 'cmd.exe' : 'sh', process.platform === 'win32' ? ['/c', `${pythonCmd} ${args.map(a => JSON.stringify(a)).join(' ')}`] : ['-c', `${pythonCmd} ${args.map(a => JSON.stringify(a)).join(' ')}`], { cwd: spawnOpts.cwd, env: spawnOpts.env, stdio: ['pipe','pipe','pipe'], windowsHide: true });
    return shellChild;
  } catch (err) {
    console.warn('[upload] Shell fallback spawn failed:', err && err.message ? err.message : err);
  }

  // If error indicates permission problem, log clear guidance
  console.error('[upload] All python spawn attempts failed. Current PYTHON_BIN:', process.env.PYTHON_BIN);
  console.error('[upload] Check that the file is executable and accessible by the Node process. You can run from the server host:');
  console.error(`  "${process.env.PYTHON_BIN || 'python'} --version"`);

  return null;
}

function extractStructuredJsonFromOutput(stdout) {
  if (!stdout) return null;
  const markers = ['-- Extracted Structure (Mistral 7B) --', '-- Extracted Structure (Mistral/Gemini) --', '-- Extracted Structure (Gemini) --'];
  const marker = markers.find(m => stdout.indexOf(m) !== -1);
  if (!marker) return null;
  const after = stdout.slice(stdout.indexOf(marker) + marker.length);
  const firstBrace = after.indexOf('{');
  if (firstBrace === -1) return null;
  let depth = 0;
  let jsonStr = '';
  for (let i = firstBrace; i < after.length; i++) {
    const ch = after[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    jsonStr += ch;
    if (depth === 0) break;
  }
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
}

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const db = req.db || null;
    const filesCol = db ? db.collection('cases') : null;

    const file = req.file;
    const userPrompt = req.body?.prompt || 'Summarize and extract named entities and legal arguments.';
    
    console.log(`[upload] File: ${file?.originalname}, size: ${file?.size}`);
    
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    // Step 1-2: store and extract text + metadata
    let extracted = { text: '', meta: {} };
    if (file.mimetype === 'application/pdf') {
      console.log('[upload] Extracting from PDF');
      extracted = await extractFromPdf(file.path);
    } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      console.log('[upload] Extracting from DOCX');
      extracted = await extractFromDocx(file.path);
    } else {
      console.log('[upload] Extracting from Image');
      extracted = await extractFromImage(file.path);
    }

    console.log(`[upload] Extracted text length: ${extracted.text?.length || 0}`);

    const context = JSON.stringify({
      file: { originalname: file.originalname, mimetype: file.mimetype, size: file.size },
      meta: extracted.meta,
      text: extracted.text?.slice(0, 10000) || ''
    });

    let responded = false;
    const persistAndRespond = async (inferenceResult) => {
      if (responded) return null;
      responded = true;
      const doc = {
        uploadedAt: new Date(),
        file: { filename: file.filename, originalname: file.originalname, mimetype: file.mimetype, size: file.size },
        extraction: extracted,
        inference: {
          raw: inferenceResult.raw || '',
          structured: inferenceResult.structured || {},
          summary: inferenceResult.summary || '',
          entities: inferenceResult.entities || [],
          claims: inferenceResult.claims || [],
          defenses: inferenceResult.defenses || [],
          precedents: inferenceResult.precedents || []
        }
      };
      let insertId = null;
      let mongoInsert = null;
      try {
        if (filesCol) {
          const insert = await filesCol.insertOne(doc);
          mongoInsert = insert;
          insertId = String(insert.insertedId);
        } else throw new Error('MongoDB not available');
      } catch (e) {
        insertId = saveLocalCase(doc);
      }
      try {
        if (db) {
          await upsertCaseMemory(db, {
            caseId: String(insertId),
            title: file.originalname,
            summary: doc.inference.summary || '',
            arguments: [...(doc.inference.claims || []), ...(doc.inference.defenses || [])],
            counterarguments: [],
            chatHistory: [],
            outcome: null
          });
        }
      } catch (e) { /* ignore */ }
      res.json({ ok: true, id: insertId, structured: doc.inference.structured, summary: doc.inference.summary });
      try { if (file?.path) fs.unlink(file.path, () => {}); } catch {}
      return { insertId, mongoInsert };
    };

    const child = await spawnLocalInference(userPrompt, context);
    if (!child || typeof child.on !== 'function') {
      console.warn('[upload] spawnLocalInference did not return a child process, falling back.');
      const fallback = { raw: '', structured: {}, summary: extracted.text?.slice(0, 500) || 'File uploaded (AI inference skipped).', entities: [], claims: [], defenses: [], precedents: [] };
      await persistAndRespond(fallback);
      return;
    }

    let stdout = '';
    let stderr = '';

    child.on('error', async (err) => {
      console.warn('[upload] Spawn/inference error:', err.message);
      const fallback = { raw: '', structured: {}, summary: extracted.text?.slice(0, 500) || 'File uploaded (AI inference unavailable).', entities: [], claims: [], defenses: [], precedents: [] };
      await persistAndRespond(fallback);
    });

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', async (code) => {
      if (responded) return;
      try {
        const structured = code === 0 ? (extractStructuredJsonFromOutput(stdout) || {}) : {};
        const summary = code === 0 ? (stdout || '').slice(0, 1000) : (extracted.text?.slice(0, 500) || 'File uploaded (AI inference failed).');
        const inferenceResult = {
          raw: stdout || '',
          structured,
          summary,
          entities: structured.entities || [],
          claims: structured.claims || [],
          defenses: structured.defenses || [],
          precedents: structured.precedents || []
        };
        if (code !== 0) console.warn('[upload] Inference exited with code', code, stderr ? stderr.slice(0, 200) : '');
        const result = await persistAndRespond(inferenceResult);
        if (result?.insertId && result?.mongoInsert && filesCol) {
          (async () => {
            try {
              const base = `http://localhost:${process.env.PORT || 5000}`;
              const r = await fetch(`${base}/api/predict-outcome`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: result.insertId }) });
              const json = await r.json();
              if (json?.ok) await filesCol.updateOne({ _id: result.mongoInsert.insertedId }, { $set: { 'inference.prediction': json } });
            } catch (e) { /* ignore */ }
          })();
        }
      } catch (err) {
        console.error('[upload] Close handler error:', err?.message);
        if (!responded) {
          const fallback = { raw: '', structured: {}, summary: extracted.text?.slice(0, 500) || 'File uploaded.', entities: [], claims: [], defenses: [], precedents: [] };
          await persistAndRespond(fallback);
        }
      }
    });
  } catch (e) {
    console.error(`[upload] Exception: ${e.message}`, e);
    return res.status(500).json({ error: e.message });
  }
});

export default router;


