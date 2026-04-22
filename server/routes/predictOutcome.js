import express from 'express';
import { ObjectId } from 'mongodb';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { resolveCase } from '../lib/caseResolver.js';
import { callLLMJson, callLLM } from '../lib/llm.js';

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

function looksIncompleteOrNoisy(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  const noisy = /(^|\n)\s*#{2,6}\s+/m.test(t) || /\|.*\|/.test(t) || /(^|\n)\s*-{3,}\s*\|/m.test(t);
  if (noisy) return true;
  if (/[.!?]"?$/.test(t)) return false;
  if (/(?:\bif|\bwhen|\bunless|\bbecause|\band|\bor|\blacks?)\s*$/i.test(t)) return true;
  return true;
}

async function finalizeOutcomeReasoning(reasoning, text, structured, pct) {
  const base = String(reasoning || '').trim();
  if (!base) return '';
  if (!looksIncompleteOrNoisy(base)) return base;
  try {
    const { raw } = await callLLM(
      [
        {
          role: 'system',
          content:
            'Rewrite into clean, complete legal reasoning. Use short paragraphs and bullet points only. ' +
            'Do not use markdown headings, tables, or pipe separators. Ensure no sentence is cut midway.'
        },
        {
          role: 'user',
          content:
            `Draft to fix:\n${base}\n\n` +
            `Percentages: Plaintiff ${pct.plaintiff}%, Defendant ${pct.defendant}%.\n\n` +
            `Case excerpt:\n${String(text || '').slice(0, 5000)}\n\n` +
            `Structured context:\n${JSON.stringify(structured || {}).slice(0, 3000)}`
        }
      ],
      { max_tokens: 900, temperature: 0.1 }
    );
    return String(raw || '').trim() || base;
  } catch {
    return `${base}${base.endsWith('.') ? '' : '.'}`;
  }
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

    const base = predict_with_sentiment(features);
    const basePct = {
      plaintiff: Math.round(base.plaintiff * 100),
      defendant: Math.round(base.defendant * 100)
    };

    const messages = [
      {
        role: 'system',
        content:
          'You are a legal outcome predictor. Return STRICT JSON only (no markdown). ' +
          'Use the provided case excerpt and extracted structure. Give realistic percentages that sum to 100. ' +
          'Provide convincing, case-specific justifications and list key factors.'
      },
      {
        role: 'user',
        content:
          `Case excerpt:\n${(text || '').slice(0, 8000)}\n\n` +
          `Extracted structure:\n${JSON.stringify(structured || {}).slice(0, 8000)}\n\n` +
          `Heuristic baseline (you may adjust): ${JSON.stringify(basePct)}\n\n` +
          `Return JSON shape:\n` +
          JSON.stringify({
            probabilities: { plaintiff: 0, defendant: 0 },
            justification: {
              overview: '',
              key_factors_for_plaintiff: [],
              key_factors_for_defendant: [],
              biggest_uncertainties: [],
              what_evidence_would_change_this: []
            }
          })
      }
    ];

    let out;
    let narrative = null;
    try {
      const { json } = await callLLMJson(messages, { max_tokens: 900, temperature: 0.25 });
      out = json && typeof json === 'object' ? json : null;
    } catch (e) {
      out = null;
    }

    const hasJustification = Boolean(out?.justification?.overview) || Boolean(out?.justification?.key_factors_for_plaintiff?.length) || Boolean(out?.justification?.key_factors_for_defendant?.length);

    if (!out || !hasJustification) {
      try {
        const { raw } = await callLLM(
          [
            {
              role: 'system',
              content:
                'You are a legal outcome predictor. Provide a convincing, case-specific justification. ' +
                'Use bullet points and clearly separate plaintiff vs defendant factors.'
            },
            {
              role: 'user',
              content:
                `Case excerpt:\n${(text || '').slice(0, 8000)}\n\n` +
                `Extracted structure:\n${JSON.stringify(structured || {}).slice(0, 8000)}\n\n` +
                `Baseline percentages: Plaintiff ${basePct.plaintiff}%, Defendant ${basePct.defendant}%.\n\n` +
                `Write justification for these percentages and list what evidence would move the needle.`
            }
          ],
          { max_tokens: 700, temperature: 0.25 }
        );
        narrative = String(raw || '').trim();
      } catch {
        narrative = null;
      }
    }

    const p = out?.probabilities?.plaintiff;
    const d = out?.probabilities?.defendant;
    const plaintiffPct = Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : basePct.plaintiff;
    const defendantPct = Number.isFinite(d) ? Math.max(0, Math.min(100, Math.round(d))) : (100 - plaintiffPct);
    const norm = plaintiffPct + defendantPct;
    const pct = norm === 100 ? { plaintiff: plaintiffPct, defendant: defendantPct } : { plaintiff: plaintiffPct, defendant: 100 - plaintiffPct };

    let reasoning =
      out?.justification?.overview
        ? String(out.justification.overview).trim() +
          `\n\nKey factors for plaintiff:\n- ${(out.justification.key_factors_for_plaintiff || []).slice(0, 6).join('\n- ')}` +
          `\n\nKey factors for defendant:\n- ${(out.justification.key_factors_for_defendant || []).slice(0, 6).join('\n- ')}`
        : (narrative || `Baseline features: length ${features.lengthK}K, sentiment ${features.sentiment}, precedents ${features.precedents}.`);

    reasoning = await finalizeOutcomeReasoning(reasoning, text, structured, pct);

    return res.json({ ok: true, probabilities: pct, reasoning });

  } catch (e) {
    console.error(`[predictOutcome] Exception: ${e.message}`, e);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
