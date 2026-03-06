import express from 'express';
import { ObjectId } from 'mongodb';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { resolveCase } from '../lib/caseResolver.js';

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
    console.warn(`[counterarguments] Python script not found, using: ${scriptPath}`);
  }

  const args = ['-u', scriptPath, '--prompt', prompt, '--context', context];
  console.log(`[counterarguments] Spawning Mistral inference: ${py} ${args.join(' ')}`);

  const child = spawn(py, args, {
    cwd: workspaceRoot,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.on('error', (err) => {
    console.error(`[counterarguments] Spawn error: ${err.message}`);
  });

  return child;
}

function tryParseCounterJson(text) {
  // Look for a JSON array in the response
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    const jsonStr = text.slice(start, end + 1);
    try {
      const arr = JSON.parse(jsonStr);
      if (Array.isArray(arr)) return arr;
    } catch (_) {}
  }
  return null;
}

function coerceCounters(arr) {
  return (arr || []).map((item, idx) => {
    if (typeof item === 'string') {
      return { title: `COUNTER ${idx + 1}`, text: item, confidence: 'Medium' };
    }
    return {
      title: item.title || `COUNTER ${idx + 1}`,
      text: item.text || item.content || '',
      confidence: item.confidence || 'Medium'
    };
  });
}

router.post('/generate-counterarguments', async (req, res) => {
  try {
    const db = req.db;
    const { caseId, caseTitle, side = 'both' } = req.body || {};
    const caseIdentifier = caseId || caseTitle;
    
    console.log(`[counterarguments] Request: caseIdentifier=${caseIdentifier}, side=${side}`);
    
    if (!caseIdentifier) {
      console.warn('[counterarguments] Missing caseIdentifier');
      return res.status(400).json({ error: 'caseId (or caseTitle) is required' });
    }

    const doc = await resolveCase(db, caseIdentifier);
    if (!doc) {
      console.warn(`[counterarguments] Case not found: ${caseIdentifier}`);
      return res.status(404).json({ error: 'Case not found' });
    }

    const structured = doc?.inference?.structured || {};
    const claims = Array.isArray(structured.claims) ? structured.claims : [];
    const defenses = Array.isArray(structured.defenses) ? structured.defenses : [];

    console.log(`[counterarguments] Found ${claims.length} claims, ${defenses.length} defenses`);

    const focus = side === 'petitioner' ? claims : side === 'respondent' ? defenses : [...claims, ...defenses];
    const focusText = focus.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n- ');

    const prompt = (
      'Generate counterarguments to the following legal arguments. ' +
      'Return STRICT JSON array of objects: {"title","text","confidence"} where confidence is one of ' +
      '"High","Medium","Low".\n\nArguments:\n- ' + focusText
    );

    const contextPayload = {
      caseId: caseIdentifier,
      arguments: focus,
      side,
      structured,
    };

    const context = JSON.stringify(contextPayload);
    const child = spawnLocalInference(prompt, context);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      const chunk = d.toString();
      stdout += chunk;
      console.log(`[counterarguments] stdout: ${chunk.substring(0, 120)}`);
    });

    child.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderr += chunk;
      console.error(`[counterarguments] stderr: ${chunk}`);
    });

    child.on('close', (code) => {
      try {
        console.log(`[counterarguments] Inference process exited with code ${code}`);

        if (code !== 0) {
          console.error('[counterarguments] Mistral inference failed, stderr:', stderr);
          return res.status(502).json({
            ok: false,
            error: 'Mistral 7B inference failed',
            details: stderr || stdout,
          });
        }

        // Extract reasoning text which should contain JSON array
        let responseText = stdout;
        const marker = '-- Reasoned Analysis (Mistral 7B) --';
        const idx = stdout.indexOf(marker);
        if (idx !== -1) {
          responseText = stdout.slice(idx + marker.length).trim();
        }

        console.log(`[counterarguments] Received response: ${responseText.substring(0, 100)}...`);

        const parsed = tryParseCounterJson(responseText) || [];
        const counters = coerceCounters(parsed).slice(0, 10);

        console.log(`[counterarguments] Generated ${counters.length} counterarguments`);
        return res.json({ ok: true, counters });

      } catch (err) {
        console.error('[counterarguments] Error finalizing response:', err);
        return res.status(500).json({ ok: false, error: 'Server error during counterargument processing.' });
      }
    });

  } catch (e) {
    console.error(`[counterarguments] Exception: ${e.message}`, e);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
