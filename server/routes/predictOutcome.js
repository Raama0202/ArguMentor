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
    console.warn(`[predictOutcome] Python script not found, using: ${scriptPath}`);
  }

  const args = ['-u', scriptPath, '--prompt', prompt, '--context', context];
  console.log(`[predictOutcome] Spawning Mistral inference: ${py} ${args.join(' ')}`);

  const child = spawn(py, args, {
    cwd: workspaceRoot,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.on('error', (err) => {
    console.error(`[predictOutcome] Spawn error: ${err.message}`);
  });

  return child;
}

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function basicSentimentScore(text = '') {
  const pos = ['success', 'favorable', 'reasonable', 'valid', 'support', 'grant'];
  const neg = ['void', 'unreasonable', 'deny', 'reject', 'violate', 'breach'];
  const t = text.toLowerCase();
  let s = 0;
  pos.forEach(w => { if (t.includes(w)) s += 1; });
  neg.forEach(w => { if (t.includes(w)) s -= 1; });
  return s;
}

function predict_with_sentiment(features) {
  // Outcome probability from logistic regression
  const { lengthK, sentiment, precedents } = features;
  const w0 = -0.4;
  const w1 = 0.25;
  const w2 = 0.6;
  const w3 = 0.35;
  const z = w0 + w1 * lengthK + w2 * sentiment + w3 * precedents;
  const p = sigmoid(z);
  return { plaintiff: p, defendant: 1 - p };
}

router.post('/predict-outcome', async (req, res) => {
  try {
    const db = req.db;
    const { caseId, caseTitle } = req.body || {};
    const caseIdentifier = caseId || caseTitle;
    
    console.log(`[predictOutcome] Request: caseIdentifier=${caseIdentifier}`);
    
    if (!caseIdentifier) {
      console.warn('[predictOutcome] Missing caseIdentifier');
      return res.status(400).json({ error: 'caseId (or caseTitle) is required' });
    }

    const doc = await resolveCase(db, caseIdentifier);
    if (!doc) {
      console.warn(`[predictOutcome] Case not found: ${caseIdentifier}`);
      return res.status(404).json({ error: 'Case not found' });
    }

    const text = doc?.extraction?.text || '';
    const structured = doc?.inference?.structured || {};
    const precedentsCount = Array.isArray(structured.precedents) ? structured.precedents.length : 0;

    console.log(`[predictOutcome] Text length: ${text.length}, precedents: ${precedentsCount}`);

    const features = {
      lengthK: Math.min(10, Math.round((text.length || 0) / 1000)),
      sentiment: Math.max(-2, Math.min(2, basicSentimentScore(text))),
      precedents: Math.min(5, precedentsCount)
    };

    console.log(`[predictOutcome] Features: ${JSON.stringify(features)}`);

    const probs = predict_with_sentiment(features);

    // Use Mistral 7B for reasoning
    const prompt = 'Given the case context and features, provide a brief rationale for predicted outcome probabilities. Explain why plaintiff has ' + Math.round(probs.plaintiff * 100) + '% chance and defendant has ' + Math.round(probs.defendant * 100) + '% chance.';
    
    const contextPayload = {
      file: doc.file,
      excerpt: text.slice(0, 1500),
      structured,
      features,
      probabilities: {
        plaintiff: Math.round(probs.plaintiff * 100),
        defendant: Math.round(probs.defendant * 100)
      }
    };

    const context = JSON.stringify(contextPayload);
    const child = spawnLocalInference(prompt, context);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      const chunk = d.toString();
      stdout += chunk;
    });

    child.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderr += chunk;
    });

    child.on('close', (code) => {
      try {
        let reasoning = '';
        
        if (code === 0) {
          // Extract reasoning from Mistral output
          const marker = '-- Reasoned Analysis (Mistral 7B) --';
          const idx = stdout.indexOf(marker);
          if (idx !== -1) {
            const endMarker = '=== End ===';
            let start = idx + marker.length;
            if (stdout[start] === '\n') start += 1;
            let end = stdout.indexOf(endMarker, start);
            if (end === -1) end = stdout.length;
            reasoning = stdout.slice(start, end).trim();
          } else {
            reasoning = stdout.slice(-2000).trim();
          }
        } else {
          console.warn('[predictOutcome] Mistral inference failed, using fallback reasoning');
          reasoning = `Based on case features: document length ${features.lengthK}K, sentiment score ${features.sentiment}, and ${features.precedents} precedents.`;
        }

        const pct = {
          plaintiff: Math.round(probs.plaintiff * 100),
          defendant: Math.round(probs.defendant * 100)
        };
        
        console.log(`[predictOutcome] Response: ${JSON.stringify(pct)}`);
        return res.json({ ok: true, probabilities: pct, reasoning });
      } catch (err) {
        console.error('[predictOutcome] Error finalizing response:', err);
        return res.status(500).json({ ok: false, error: 'Server error during prediction processing.' });
      }
    });

  } catch (e) {
    console.error(`[predictOutcome] Exception: ${e.message}`, e);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
