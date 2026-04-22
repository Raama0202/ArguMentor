import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { resolveCase, listCases, deleteCase } from '../lib/caseResolver.js';
import { callLLM, callLLMJson } from '../lib/llm.js';

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

function heuristicStructuredFromText(rawText, filename = '') {
  const text = String(rawText || '');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const parties = [];
  const appellantLine = lines.find(l => /appellant|appellants/i.test(l));
  const respondentLine = lines.find(l => /respondent/i.test(l));
  if (appellantLine) parties.push({ name: appellantLine.replace(/appellants?:?/i, '').trim(), role: 'Appellant', side: 'Appellant' });
  if (respondentLine) parties.push({ name: respondentLine.replace(/respondent:?/i, '').trim(), role: 'Respondent', side: 'Respondent' });

  const exMatches = Array.from(new Set((text.match(/Ex\.P\d+/g) || [])));
  const evidence = exMatches.slice(0, 20).map((id) => ({
    id,
    type: 'Documentary Exhibit',
    description: `Referenced exhibit ${id} in case record.`,
    relevance: 'Supports factual record',
    supports: 'Trial findings',
    weaknesses: ''
  }));

  const issueMatches = lines
    .filter(l => /^whether\b/i.test(l) || /\bpoint no\./i.test(l) || /\bpoints? for (my )?consideration\b/i.test(l))
    .slice(0, 15);
  const issues = issueMatches.map((issue) => ({ issue, standard: '', notes: '' }));

  const groundsStart = lines.findIndex(l => /grounds of appeal/i.test(l));
  const groundsWindow = groundsStart >= 0 ? lines.slice(groundsStart, Math.min(lines.length, groundsStart + 120)) : [];

  const claimPatterns = [
    /\bit is (the )?(specific )?case of the complainant\b/i,
    /\bcomplainant .* (proved|established|produced)\b/i,
    /\bissued (a )?cheque\b/i,
    /\blegally enforceable debt\b/i
  ];
  const defensePatterns = [
    /\bdefen[cs]e\b/i,
    /\bsecurity cheque\b/i,
    /\bblank signed cheque\b/i,
    /\brepaid\b/i,
    /\bno legally enforceable debt\b/i,
    /\btrial court has not\b/i
  ];

  const claimLines = [];
  const defenseLines = [];
  for (const l of lines.slice(0, 420)) {
    if (claimPatterns.some(p => p.test(l))) claimLines.push(l);
    if (defensePatterns.some(p => p.test(l))) defenseLines.push(l);
  }
  for (const l of groundsWindow) {
    if (/^[a-z]\)/i.test(l) || /ground/i.test(l)) defenseLines.push(l);
  }

  const uniq = (arr) => Array.from(new Set(arr.map(s => s.trim()).filter(Boolean)));
  const normClaimLines = uniq(claimLines).slice(0, 10);
  const normDefenseLines = uniq(defenseLines).slice(0, 12);

  const claims = normClaimLines.map((claim) => ({
    claim,
    elements: [],
    support: '',
    weaknesses: ''
  }));

  const defenses = normDefenseLines.map((defense) => ({
    defense,
    support: '',
    weaknesses: ''
  }));

  // If issues are still empty, derive from claims/defenses.
  if (!issues.length) {
    for (const c of claims.slice(0, 4)) {
      issues.push({ issue: `Whether ${c.claim.replace(/\.$/, '')}?`, standard: '', notes: '' });
    }
    for (const d of defenses.slice(0, 3)) {
      issues.push({ issue: `Whether ${d.defense.replace(/\.$/, '')}?`, standard: '', notes: '' });
    }
  }

  const precedentMatches = Array.from(new Set(
    (text.match(/[A-Z][A-Za-z .&]+ vs\.? [A-Z][A-Za-z .&]+ ?\(\d{4}\)[^,\n]*/g) || [])
      .map(s => s.trim())
  )).slice(0, 12);
  const precedents = precedentMatches.map((citation) => ({ citation, holding: '', relevance: 'Cited in judgment text' }));

  const timeline = [];
  const dateMatches = text.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g) || [];
  for (const d of Array.from(new Set(dateMatches)).slice(0, 15)) {
    timeline.push({ date: d, event: 'Date referenced in case record', source: 'Judgment text' });
  }

  const summary = `Analysis derived from case text${filename ? ` (${filename})` : ''}. Key exhibits, issues, cited precedents, and timeline references were extracted for review.`;

  return {
    case_overview: { title: filename || 'Uploaded case', jurisdiction: '', court: '', procedural_posture: '', case_type: '', key_dates: timeline.map(t => t.date) },
    parties,
    involved_entities: parties.map(p => ({ name: p.name, type: 'Party', role: p.role, side: p.side, notes: '' })),
    evidence,
    timeline,
    issues,
    claims,
    defenses,
    precedents,
    recommendations: [
      { action: 'Review extracted exhibits and map each to disputed issues.', why: 'Improves argument precision.', priority: 'High' },
      { action: 'Validate precedents and add ratio/holding notes before drafting.', why: 'Strengthens legal reasoning.', priority: 'High' }
    ],
    summary
  };
}

function looksIncompleteNarrative(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/[.!?]"?$/.test(t)) return false;
  // Common abrupt endings from token cut-off.
  if (/(?:\bif|\bwhen|\bunless|\bbecause|\band|\bor|\bthat|\bwhich|\blacks?)\s*$/i.test(t)) return true;
  // Numbered/bulleted item started but unfinished.
  if (/(?:\d+\.\s+\*\*[^*]+\*\*:?\s+[^\n]*$)/.test(t)) return true;
  return true;
}

function hasNoisyFormatting(text) {
  const t = String(text || '');
  return /(^|\n)\s*#{2,6}\s+/m.test(t) || /\|.*\|/.test(t) || /(^|\n)\s*-{3,}\s*\|/m.test(t);
}

async function ensureCompleteReasoning(reasoning, query, excerpt, meta) {
  const base = String(reasoning || '').trim();
  if (!base) return '';
  if (!looksIncompleteNarrative(base) && !hasNoisyFormatting(base)) return base;

  try {
    const completionMessages = [
      {
        role: 'system',
        content:
          'You are a legal drafting assistant. Rewrite the provided draft into a complete, polished, and internally consistent final response. ' +
          'Use plain paragraphs and bullet points only. Do not use markdown headings, tables, or pipe separators. ' +
          'Do not cut any sentence midway. Keep the same structure and legal intent, but finish all points properly.'
      },
      {
        role: 'user',
        content:
          `Original user query: ${query}\n\n` +
          `Case metadata: ${JSON.stringify(meta)}\n\n` +
          `Case excerpt:\n${String(excerpt || '').slice(0, 5000)}\n\n` +
          `Truncated draft to fix:\n${base}\n\n` +
          `Return only the corrected final response.`
      }
    ];
    const out = await callLLM(completionMessages, { max_tokens: 1200, temperature: 0.1 });
    const fixed = String(out?.raw || '').trim();
    return fixed || base;
  } catch {
    // Last-resort local finish to avoid abrupt UI output.
    return `${base}${base.endsWith('.') ? '' : '.'}\n\nConclusion: Review the full record, verify statutory compliance, and finalize submissions with issue-wise evidence mapping and current precedents.`;
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

    // Keep prompts small enough to avoid provider token/request limits
    const excerpt = (text || '').slice(0, 12000);

    const schemaHint =
      'case_overview{title,jurisdiction,court,procedural_posture,case_type,key_dates[]}; ' +
      'parties[{name,role,side}]; involved_entities[{name,type,role,side,notes}]; ' +
      'evidence[{id,type,description,relevance,supports,weaknesses}]; ' +
      'timeline[{date,event,source}]; issues[{issue,standard,notes}]; ' +
      'claims[{claim,elements[],support,weaknesses}]; defenses[{defense,support,weaknesses}]; ' +
      'precedents[{citation,holding,relevance}]; risks[{risk,severity,mitigation}]; ' +
      'recommendations[{action,why,priority}]; summary; next_steps[].';

    const messages = [
      {
        role: 'system',
        content:
          'You are ArguMentor, a legal case analysis engine. ' +
          'Return ONLY JSON. Do not include any other text.'
      },
      {
        role: 'user',
        content:
          `User query: ${query}\n\n` +
          `Case metadata: ${JSON.stringify(meta)}\n\n` +
          `Case text excerpt:\n${excerpt}\n\n` +
          `Return ONLY JSON with keys per this shape:\n${schemaHint}`
      }
    ];

    let structured = {};
    try {
      const { json } = await callLLMJson(messages, { max_tokens: 1200, temperature: 0.2 });
      structured = (json && typeof json === 'object') ? json : {};
    } catch (e) {
      // Mistral sometimes returns non-strict JSON even when asked.
      // Retry once with a harder constraint and smaller excerpt.
      const retryExcerpt = (text || '').slice(0, 7000);
      const retry = [
        {
          role: 'system',
          content:
            'Return ONLY minified JSON. No prose. No markdown. No trailing commas. ' +
            'If unsure, use empty strings/arrays.'
        },
        {
          role: 'user',
          content:
            `User query: ${query}\n\n` +
            `Case text excerpt:\n${retryExcerpt}\n\n` +
            `Return ONLY JSON with this shape:\n${schemaHint}`
        }
      ];
      try {
        const { json } = await callLLMJson(retry, { max_tokens: 1200, temperature: 0.1 });
        structured = (json && typeof json === 'object') ? json : {};
      } catch (e2) {
        // Last resort: fall back to the Python mistral_inference pipeline (Mistral-only),
        // which has more tolerant JSON extraction for structure.
        try {
          const contextPayload = {
            file: doc.file || {},
            meta,
            text: (text || '').slice(0, 20000),
            caseId: caseIdentifier,
          };
          const context = JSON.stringify(contextPayload);
          const prompt = `${query}\n\nReturn structured JSON for: entities (with roles), evidence, timeline, issues, claims, defenses, precedents, risks, recommendations, and a short summary.`;

          const child = spawnLocalInference(prompt, context);
          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (d) => { stdout += d.toString(); });
          child.stderr.on('data', (d) => { stderr += d.toString(); });

          const code = await new Promise((resolve) => child.on('close', resolve));
          if (code === 0) {
            structured = extractStructuredJsonFromOutput(stdout) || {};
            if (!structured || typeof structured !== 'object') structured = {};
          } else {
            structured = { summary: 'Analysis completed, but structured JSON extraction failed.' };
            console.warn('[analyze] Python inference fallback failed:', (stderr || '').slice(0, 400));
          }
        } catch (e3) {
          structured = { summary: 'Analysis completed, but structured JSON extraction failed.' };
        }
      }
    }

    const structuredFailed =
      !structured ||
      typeof structured !== 'object' ||
      Object.keys(structured).length === 0 ||
      (typeof structured.summary === 'string' &&
        /structured json extraction failed/i.test(structured.summary));

    async function extractStructuredSectionsFromLLM(baseText, userQuery) {
      const small = (baseText || '').slice(0, 6000);
      const ask = async (instruction, fallback) => {
        try {
          const { json } = await callLLMJson(
            [
              {
                role: 'system',
                content: 'Return ONLY valid JSON. No markdown. No prose.'
              },
              {
                role: 'user',
                content: `${instruction}\n\nQuery: ${userQuery}\n\nCase text:\n${small}`
              }
            ],
            { max_tokens: 500, temperature: 0.1 }
          );
          return json ?? fallback;
        } catch {
          return fallback;
        }
      };

      const [
        case_overview,
        parties,
        involved_entities,
        evidence,
        timeline,
        issues,
        claims,
        defenses,
        precedents,
        recommendations,
        summary
      ] = await Promise.all([
        ask('Return JSON object: {"title":"","jurisdiction":"","court":"","procedural_posture":"","case_type":"","key_dates":[]}', {}),
        ask('Return JSON array of parties with: [{ "name":"","role":"","side":"" }]', []),
        ask('Return JSON array of involved entities with: [{ "name":"","type":"","role":"","side":"","notes":"" }]', []),
        ask('Return JSON array of evidence with: [{ "id":"","type":"","description":"","relevance":"","supports":"","weaknesses":"" }]', []),
        ask('Return JSON array timeline with: [{ "date":"","event":"","source":"" }]', []),
        ask('Return JSON array issues with: [{ "issue":"","standard":"","notes":"" }]', []),
        ask('Return JSON array claims with: [{ "claim":"","elements":[],"support":"","weaknesses":"" }]', []),
        ask('Return JSON array defenses with: [{ "defense":"","support":"","weaknesses":"" }]', []),
        ask('Return JSON array precedents with: [{ "citation":"","holding":"","relevance":"" }]', []),
        ask('Return JSON array recommendations with: [{ "action":"","why":"","priority":"Low|Medium|High" }]', []),
        ask('Return JSON object: {"summary":""}', { summary: '' })
      ]);

      return {
        case_overview: (case_overview && typeof case_overview === 'object') ? case_overview : {},
        parties: Array.isArray(parties) ? parties : [],
        involved_entities: Array.isArray(involved_entities) ? involved_entities : [],
        evidence: Array.isArray(evidence) ? evidence : [],
        timeline: Array.isArray(timeline) ? timeline : [],
        issues: Array.isArray(issues) ? issues : [],
        claims: Array.isArray(claims) ? claims : [],
        defenses: Array.isArray(defenses) ? defenses : [],
        precedents: Array.isArray(precedents) ? precedents : [],
        recommendations: Array.isArray(recommendations) ? recommendations : [],
        summary: typeof summary?.summary === 'string' ? summary.summary : ''
      };
    }

    let reasoning = '';
    if (structuredFailed) {
      // Try section-wise structured extraction so analysis tabs remain populated.
      try {
        const repaired = await extractStructuredSectionsFromLLM(text, query);
        if (repaired && typeof repaired === 'object') {
          const hasAny =
            (Array.isArray(repaired.parties) && repaired.parties.length) ||
            (Array.isArray(repaired.involved_entities) && repaired.involved_entities.length) ||
            (Array.isArray(repaired.evidence) && repaired.evidence.length) ||
            (Array.isArray(repaired.timeline) && repaired.timeline.length) ||
            (Array.isArray(repaired.issues) && repaired.issues.length) ||
            (Array.isArray(repaired.claims) && repaired.claims.length) ||
            (Array.isArray(repaired.defenses) && repaired.defenses.length) ||
            (Array.isArray(repaired.precedents) && repaired.precedents.length) ||
            (Array.isArray(repaired.recommendations) && repaired.recommendations.length);
          if (hasAny) structured = repaired;
        }
      } catch {
        // continue to prose fallback
      }
    }

    const stillFailed =
      !structured ||
      typeof structured !== 'object' ||
      Object.keys(structured).length === 0 ||
      (typeof structured.summary === 'string' &&
        /structured json extraction failed/i.test(structured.summary));

    if (stillFailed) {
      try {
        const fallbackMessages = [
          {
            role: 'system',
            content:
              'You are a legal analyst. Produce a clean, readable analysis in plain text. ' +
              'Use this exact structure: ' +
              '1) Case Overview (paragraph), ' +
              '2) Key Legal Issues (bullet points), ' +
              '3) Strengths and Weaknesses (bullet points), ' +
              '4) Practical Next Steps (numbered points).'
          },
          {
            role: 'user',
            content:
              `User query: ${query}\n\n` +
              `Case metadata: ${JSON.stringify(meta)}\n\n` +
              `Case text excerpt:\n${excerpt}\n\n` +
              'Write the analysis now in the requested format.'
          }
        ];

        const out = await callLLM(fallbackMessages, { max_tokens: 900, temperature: 0.2 });
        reasoning = String(out?.raw || '').trim();
      } catch (e) {
        reasoning =
          'Case Overview:\n' +
          'The case was analyzed, but structured extraction was unavailable. A concise legal read-out is provided from the available record.\n\n' +
          'Key Legal Issues:\n' +
          '- Identification of enforceable obligations and statutory compliance\n' +
          '- Evidentiary sufficiency and procedural validity\n' +
          '- Scope for appeal/rebuttal based on documented material\n\n' +
          'Strengths and Weaknesses:\n' +
          '- Strength: Core facts appear documented in the uploaded case material\n' +
          '- Weakness: Missing/unclear extracted structure limits precision\n\n' +
          'Practical Next Steps:\n' +
          '1. Re-run analysis after ensuring AI dependencies are healthy.\n' +
          '2. Verify primary exhibits and statutory notice chronology.\n' +
          '3. Prepare issue-wise arguments with supporting precedents.';
      }

      // Ensure tabs still have content even when model JSON fails.
      structured = heuristicStructuredFromText(text, doc?.file?.originalname || doc?.file?.filename || '');
    } else {
      reasoning = typeof structured.summary === 'string' && structured.summary.trim()
        ? structured.summary.trim()
        : '';
    }

    // Ensure final response shown in Summary/Reasoning is complete and not cut mid-sentence.
    reasoning = await ensureCompleteReasoning(reasoning, query, excerpt, meta);

    const summary = reasoning
      ? reasoning
      : (typeof structured.summary === 'string' && structured.summary.trim()
        ? structured.summary.trim()
        : (excerpt.slice(0, 1200) || 'Analysis completed'));

    // Persist to case record so other tools (counterarguments/outcome) can use it.
    try {
      if (db) {
        const casesCol = db.collection('cases');
        // If identifier is ObjectId, update that, else try by originalname match.
        const q = (caseId && caseId.length && /^[a-fA-F0-9]{24}$/.test(caseId)) ? { _id: new (await import('mongodb')).ObjectId(caseId) } : { 'file.originalname': doc?.file?.originalname };
        await casesCol.updateOne(q, { $set: { 'inference.structured': structured, 'inference.summary': summary } });
      } else {
        const { updateCase } = await import('../models/localCases.js');
        updateCase(caseIdentifier, { inference: { ...(doc.inference || {}), structured, summary } });
      }
    } catch (e) {
      console.warn('[analyze] Could not persist structured analysis:', e && e.message ? e.message : e);
    }

    return res.json({
      ok: true,
      structured,
      reasoning: reasoning || summary,
      summary
    });

  } catch (e) {
    console.error(`[analyze] Exception: ${e.message}`, e);
    return res.status(500).json({ ok: false, error: e.message || 'Analysis failed' });
  }
});

export default router;


