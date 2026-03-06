import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { resolveCase, listCases, deleteCase } from '../lib/caseResolver.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function spawnLocalInference(prompt, context) {
  const workspaceRoot = path.join(__dirname, '..', '..');
  const py = process.env.PYTHON_BIN || 'python';

  const possiblePaths = [
    path.join(workspaceRoot, 'mistral_inference.py'),
    path.join(workspaceRoot, 'ai_engine', 'mistral_inference.py'),
  ];

  let scriptPath = null;
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        scriptPath = p;
        break;
      }
    } catch {
      // ignore
    }
  }

  if (!scriptPath) {
    scriptPath = path.join(workspaceRoot, 'mistral_inference.py');
    console.warn(`[analyze] Python script not found in expected paths, using: ${scriptPath}`);
  }

  const args = ['-u', scriptPath, '--prompt', prompt, '--context', context];
  console.log(`[analyze] Spawning inference: ${py} ${args.join(' ')}`);

  const child = spawn(py, args, {
    cwd: workspaceRoot,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.on('error', (err) => {
    console.error(`[analyze] Spawn error: ${err.message}`);
  });

  return child;
}

function extractStructuredJsonFromOutput(stdout) {
  if (!stdout) return {};
  const startMarker = '-- Extracted Structure (Mistral 7B) --';
  const legacyMarker = '-- Extracted Structure (Mistral/Gemini) --';
  const legacyMarker2 = '-- Extracted Structure (Gemini) --';
  const markerIndex =
    stdout.indexOf(startMarker) !== -1
      ? stdout.indexOf(startMarker)
      : stdout.indexOf(legacyMarker) !== -1
      ? stdout.indexOf(legacyMarker)
      : stdout.indexOf(legacyMarker2);
  if (markerIndex === -1) return {};

  const markerLength = stdout.indexOf(startMarker) !== -1
    ? startMarker.length
    : stdout.indexOf(legacyMarker) !== -1
    ? legacyMarker.length
    : legacyMarker2.length;

  const after = stdout.slice(markerIndex + markerLength);
  const firstBrace = after.indexOf('{');
  if (firstBrace === -1) return {};

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
  } catch {
    return {};
  }
}

// Delete case endpoint - MUST be defined before GET /cases to ensure proper routing
router.delete('/cases/:caseId', async (req, res) => {
  try {
    const db = req.db;
    let { caseId } = req.params;
    
    // Decode URL-encoded case ID
    if (caseId) {
      try {
        caseId = decodeURIComponent(caseId);
      } catch (e) {
        // If decode fails, use original
        console.warn('[cases] URL decode failed, using original:', caseId);
      }
    }
    
    if (!caseId || caseId === 'undefined' || caseId === 'null') {
      return res.status(400).json({ ok: false, error: 'caseId is required' });
    }

    const result = await deleteCase(db, caseId);

    if (result.deleted) {
      return res.json({ ok: true, message: 'Case deleted successfully', source: result.source });
    } else {
      return res.status(404).json({ ok: false, error: result.error || 'Case not found in database' });
    }
  } catch (e) {
    console.error('[cases] Delete error:', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, error: e.message || 'Internal server error' });
  }
});

// List all uploaded cases for UI selection
router.get('/cases', async (req, res) => {
  try {
    const db = req.db;
    const cases = await listCases(db);
    return res.json({ ok: true, cases, source: db ? 'mongo' : 'local' });
  } catch (e) {
    console.error('[cases] Error:', e && e.message ? e.message : e);
    return res.status(500).json({ error: e.message });
  }
});

router.post('/analyze', async (req, res) => {
  try {
    const db = req.db;
    // Accept either caseId (MongoDB ID) or caseTitle/filename
    const { caseId, caseTitle, query } = req.body || {};
    const caseIdentifier = caseId || caseTitle;
    
    console.log(`[analyze] Request: caseIdentifier=${caseIdentifier}, query="${query?.substring(0, 50)}..."`);
    
    if (!caseIdentifier || !query) {
      console.warn('[analyze] Missing caseIdentifier or query');
      return res.status(400).json({ error: 'caseId (or caseTitle) and query are required' });
    }

    const doc = await resolveCase(db, caseIdentifier);
    if (!doc) {
      console.warn(`[analyze] Case not found: ${caseIdentifier}`);
      return res.status(404).json({ error: 'Case not found' });
    }

    console.log(`[analyze] Found case, text length: ${doc?.extraction?.text?.length || 0}`);

    const text = doc?.extraction?.text || '';
    const meta = doc?.extraction?.meta || {};

    const contextPayload = {
      file: doc.file || {},
      meta,
      text: (text || '').slice(0, 20000),
      caseId: caseIdentifier,
    };

    const context = JSON.stringify(contextPayload);
    const prompt = `${query}\n\nAnalyze this legal case and return a detailed explanation and structured JSON (entities, claims, defenses, precedents, risks, recommendations).`;

    const child = spawnLocalInference(prompt, context);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      const chunk = d.toString();
      stdout += chunk;
      console.log(`[analyze] stdout: ${chunk.substring(0, 120)}`);
    });

    child.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderr += chunk;
      console.error(`[analyze] stderr: ${chunk}`);
    });

    child.on('close', (code) => {
      try {
        console.log(`[analyze] Inference process exited with code ${code}`);

        if (code !== 0) {
          console.error('[analyze] Mistral 7B inference failed, stderr:', stderr);
          console.error('[analyze] stdout:', stdout);
          
          // Check if it's a Mistral API configuration error
          let errorMsg = 'Mistral 7B inference failed';
          if (stderr.includes('Mistral') || stdout.includes('Mistral')) {
            if (stderr.includes('not configured') || stdout.includes('not configured')) {
              errorMsg = 'Mistral 7B API not configured. Please set MISTRAL_API_KEY in server/.env';
            } else if (stderr.includes('HTTP error') || stdout.includes('HTTP error')) {
              errorMsg = 'Mistral 7B API error. Check your API key and endpoint configuration.';
            } else {
              errorMsg = 'Mistral 7B inference error. Check backend logs for details.';
            }
          }
          
          return res.status(502).json({
            ok: false,
            error: errorMsg,
            details: (stderr || stdout).slice(0, 500),
          });
        }

        // Check if stdout contains an error JSON from Python
        let errorJson = null;
        try {
          // Try to find JSON error in stdout
          const errorMatch = stdout.match(/\{"error":\s*"[^"]+"\}/);
          if (errorMatch) {
            errorJson = JSON.parse(errorMatch[0]);
          }
          // Also check for error messages in text
          if (!errorJson && (stdout.includes('error') || stdout.includes('Error') || stdout.includes('failed'))) {
            const lowerStdout = stdout.toLowerCase();
            if (lowerStdout.includes('mistral') && (lowerStdout.includes('not configured') || lowerStdout.includes('api key'))) {
              errorJson = { error: 'Mistral 7B API not configured. Please set MISTRAL_API_KEY in server/.env' };
            }
          }
        } catch (e) {
          // Not JSON error, continue
        }

        if (errorJson && errorJson.error) {
          // Sanitize error message - remove any Groq references
          let errorMsg = errorJson.error.replace(/groq|Groq|GROQ/gi, 'Mistral 7B');
          errorMsg = errorMsg.replace(/gemini|Gemini|GEMINI/gi, 'Mistral 7B');
          console.error('[analyze] Python returned error:', errorMsg);
          return res.status(502).json({
            ok: false,
            error: errorMsg,
            details: stdout.slice(0, 500).replace(/groq|Groq|GROQ/gi, 'Mistral 7B'),
          });
        }

        // Also check stderr for any error messages
        if (stderr && (stderr.toLowerCase().includes('error') || stderr.toLowerCase().includes('failed'))) {
          const sanitizedStderr = stderr.replace(/groq|Groq|GROQ/gi, 'Mistral 7B');
          if (sanitizedStderr.toLowerCase().includes('mistral') && sanitizedStderr.toLowerCase().includes('not configured')) {
            return res.status(502).json({
              ok: false,
              error: 'Mistral 7B API not configured. Please set MISTRAL_API_KEY in server/.env',
              details: sanitizedStderr.slice(0, 500),
            });
          }
        }

        const structured = extractStructuredJsonFromOutput(stdout) || {};

        // Reasoning block
        let reasoning = '';
        const marker = '-- Reasoned Analysis (Mistral 7B) --';
        const legacyMarker = '-- Reasoned Analysis (Gemini) --';
        const endMarker = '=== End ===';
        const idx = stdout.indexOf(marker) !== -1 ? stdout.indexOf(marker) : stdout.indexOf(legacyMarker);
        if (idx !== -1) {
          const markerLen = stdout.indexOf(marker) !== -1 ? marker.length : legacyMarker.length;
          let start = idx + markerLen;
          if (stdout[start] === '\n') start += 1;
          let end = stdout.indexOf(endMarker, start);
          if (end === -1) end = stdout.length;
          reasoning = stdout.slice(start, end).trim();
        } else {
          // Fallback: try to extract any meaningful text
          const structureEnd = stdout.indexOf('=== End ===');
          if (structureEnd !== -1) {
            reasoning = stdout.slice(structureEnd + 11).trim();
          } else {
            reasoning = stdout.slice(-2000).trim();
          }
        }

        // Ensure we have some content
        if (!reasoning && Object.keys(structured).length === 0) {
          const fallback = stdout.trim() || stderr.trim();
          if (fallback) {
            reasoning = fallback.slice(-2000);
          } else {
            return res.status(502).json({
              ok: false,
              error: 'Mistral 7B returned empty response. Check API configuration.',
              details: stdout.slice(0, 500),
            });
          }
        }

        return res.json({
          ok: true,
          structured,
          reasoning: reasoning || 'Analysis completed using Mistral 7B',
          summary: reasoning.slice(0, 1000) || 'Analysis completed',
        });
      } catch (err) {
        console.error('[analyze] Error finalizing analysis response:', err);
        return res
          .status(500)
          .json({ ok: false, error: 'Server error during analysis processing.' });
      }
    });

  } catch (e) {
    console.error(`[analyze] Exception: ${e.message}`, e);
    return res.status(500).json({ error: e.message });
  }
});

export default router;


