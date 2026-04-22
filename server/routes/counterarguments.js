import express from 'express';
import { ObjectId } from 'mongodb';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { resolveCase } from '../lib/caseResolver.js';
import { callLLM, extractJsonArray, extractJsonObject } from '../lib/llm.js';

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

function fallbackCountersFromStructured(claims, defenses, side = 'both') {
  const toText = (x) => {
    if (typeof x === 'string') return x;
    if (x?.claim) return x.claim;
    if (x?.defense) return x.defense;
    return JSON.stringify(x || {});
  };
  const c = (Array.isArray(claims) ? claims : []).map(toText).filter(Boolean);
  const d = (Array.isArray(defenses) ? defenses : []).map(toText).filter(Boolean);
  const out = [];

  const add = (title, text, confidence = 'Medium') => {
    if (!text) return;
    out.push({ title, text, confidence });
  };

  if (side === 'petitioner' || side === 'both') {
    for (const t of c.slice(0, 4)) {
      add('COUNTER TO PETITIONER', `Challenge maintainability and proof for: ${t}. Demand strict proof of foundational facts and statutory compliance.`, 'Medium');
    }
  }
  if (side === 'respondent' || side === 'both') {
    for (const t of d.slice(0, 4)) {
      add('COUNTER TO RESPONDENT', `Rebut defense line: ${t}. Emphasize documentary trail, chronology, and adverse inference on unsupported denials.`, 'Medium');
    }
  }

  if (!out.length) {
    add('EVIDENCE WEIGHT ATTACK', 'Question admissibility, authorship, chain, and probative value of key documents relied upon by the opposite side.', 'Low');
    add('CHRONOLOGY INCONSISTENCY', 'Build a date-wise contradiction chart to challenge causal links and credibility.', 'Low');
    add('STATUTORY COMPLIANCE CHALLENGE', 'Scrutinize limitation, notice/service, jurisdiction, and mandatory procedural requirements.', 'Low');
  }
  return out.slice(0, 10);
}

function extractClaimsDefensesFromText(text, side = 'both') {
  const lines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  
  if (!lines.length) {
    return { claims: [], defenses: [] };
  }

  // Extract major sections and text content
  const fullText = (text || '').toLowerCase();
  const allText = lines.join(' ');

  // Extract main parties and legal positions
  const petitionerMatch = allText.match(/petitioner[^.]*\n([^.]*\.)/i);
  const respondentMatch = allText.match(/respondent[^.]*\n([^.]*\.)/i);
  const prayerMatch = allText.match(/prayer[^:]*:\s*([^.]+\.)/i);
  const groundsMatch = allText.match(/grounds[^:]*:\s*([^.]+\.)/i);

  const claims = [];
  const defenses = [];

  // Add prayer as a claim if available
  if (prayerMatch && prayerMatch[1]) {
    claims.push(prayerMatch[1].trim().slice(0, 200));
  }

  // Add petitioner's position as claim
  if (petitionerMatch && petitionerMatch[1]) {
    const claim = petitionerMatch[1].trim().slice(0, 200);
    if (claim && !claims.includes(claim)) {
      claims.push(claim);
    }
  }

  // Look for case objectives
  if (/allow|grant|direct|mandamus|declare|set aside/i.test(allText)) {
    const match = allText.match(/(?:allow|grant|direct|mandamus|declare|set aside)[^.]*\./i);
    if (match) {
      claims.push(match[0].trim().slice(0, 200));
    }
  }

  // Add respondent's position/grounds as defense
  if (groundsMatch && groundsMatch[1]) {
    defenses.push(groundsMatch[1].trim().slice(0, 200));
  }

  if (respondentMatch && respondentMatch[1]) {
    const defense = respondentMatch[1].trim().slice(0, 200);
    if (defense && !defenses.includes(defense)) {
      defenses.push(defense);
    }
  }

  // Extract opposing positions and grounds
  if (/objection|oppose|challenge|reject|dismiss|deny/i.test(allText)) {
    const match = allText.match(/(?:objection|oppose|challenge|reject|dismiss|deny)[^.]*\./i);
    if (match) {
      defenses.push(match[0].trim().slice(0, 200));
    }
  }

  // If still no data, extract structured information from document
  if (!claims.length && !defenses.length) {
    // Get unique sentences from the text
    const sentences = allText.match(/[^.!?]*[.!?]+/g) || [];
    
    for (const sentence of sentences) {
      const s = sentence.trim();
      if (!s || s.length < 20) continue;
      
      // Classify sentence as claim or defense
      if (/petitioner|appellant|plaintiff|prayer|sought|direct|grant|allow|declare|mandamus/i.test(s)) {
        if (claims.length < 5 && !claims.includes(s)) {
          claims.push(s.slice(0, 200));
        }
      } else if (/respondent|defendant|oppose|challenge|object|reject|dismiss|denied|contend/i.test(s)) {
        if (defenses.length < 5 && !defenses.includes(s)) {
          defenses.push(s.slice(0, 200));
        }
      }
    }
  }

  // If still empty, use generic fallback
  if (!claims.length) {
    claims.push('Petitioner seeks relief as per prayer in the case');
  }
  if (!defenses.length) {
    defenses.push('Respondent opposes the petitioner\'s claims');
  }

  return { 
    claims: claims.slice(0, 5), 
    defenses: defenses.slice(0, 5) 
  };
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
    const excerpt = (doc?.extraction?.text || '').slice(0, 8000);

    console.log(`[counterarguments] Found ${claims.length} claims, ${defenses.length} defenses`);

    // If no structured claims/defenses, extract from raw text
    let finalClaims = claims;
    let finalDefenses = defenses;
    if (!finalClaims.length && !finalDefenses.length && excerpt) {
      const extracted = extractClaimsDefensesFromText(excerpt, side);
      finalClaims = extracted.claims;
      finalDefenses = extracted.defenses;
      console.log(`[counterarguments] Extracted ${finalClaims.length} claims, ${finalDefenses.length} defenses from raw text`);
    }

    const focus = side === 'petitioner' ? finalClaims : side === 'respondent' ? finalDefenses : [...finalClaims, ...finalDefenses];

    const argsText = focus.length
      ? focus.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n- ')
      : '(No extracted arguments found; infer arguments from case excerpt.)';

    const messages = [
      {
        role: 'system',
        content:
          'You generate litigation-grade counterarguments. Return STRICT JSON only (no markdown), ' +
          'as an array of objects with fields: title, text, confidence (High|Medium|Low), and cite_support (brief).'
      },
      {
        role: 'user',
        content:
          `Side to counter: ${side}\n\n` +
          `Extracted arguments:\n- ${argsText}\n\n` +
          `Case excerpt:\n${excerpt}\n\n` +
          `Return 6-10 counterarguments as JSON array. Make them case-specific and non-repetitive.`
      }
    ];

    let arr = null;
    try {
      const { raw } = await callLLM(messages, { max_tokens: 750, temperature: 0.35 });
      arr = extractJsonArray(raw);
      if (!arr) {
        const obj = extractJsonObject(raw);
        if (obj && Array.isArray(obj.counters)) arr = obj.counters;
      }
    } catch (e) {
      arr = null;
    }

    let counters = coerceCounters(Array.isArray(arr) ? arr : []).slice(0, 10);
    if (!counters.length) {
      // Guaranteed non-empty fallback so UI is never blank.
      counters = fallbackCountersFromStructured(finalClaims, finalDefenses, side);
    }
    return res.json({ ok: true, counters });

  } catch (e) {
    console.error(`[counterarguments] Exception: ${e.message}`, e);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
