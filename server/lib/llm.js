import fetch from 'node-fetch';

function hasMistral() {
  return Boolean(process.env.MISTRAL_API_KEY) || (Boolean(process.env.MISTRAL_API_URL) && Boolean(process.env.MISTRAL_KEY || process.env.HF_TOKEN));
}

function hasHiddenBackend() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function hasGroq() {
  return Boolean(process.env.GROQ_API_KEY);
}

function redactSecrets(s) {
  return String(s || '')
    .replace(/Bearer\s+[A-Za-z0-9_\-\.]+/g, 'Bearer ***')
    .replace(/AIza[0-9A-Za-z_\-]+/g, 'API_KEY_***');
}

export function extractJsonObject(text) {
  const s = String(text || '');
  const first = s.indexOf('{');
  if (first === -1) return null;
  let depth = 0;
  let out = '';
  for (let i = first; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    out += ch;
    if (depth === 0) break;
  }
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

export function extractJsonArray(text) {
  const s = String(text || '');
  const first = s.indexOf('[');
  const last = s.lastIndexOf(']');
  if (first === -1 || last === -1 || last <= first) return null;
  const chunk = s.slice(first, last + 1);
  try {
    const j = JSON.parse(chunk);
    return Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

async function callMistral(messages, { model, max_tokens = 1200, temperature = 0.2, json: jsonMode = false } = {}) {
  const apiKey = process.env.MISTRAL_API_KEY;
  const token = apiKey || process.env.MISTRAL_KEY || process.env.HF_TOKEN;
  const url = process.env.MISTRAL_API_URL || 'https://api.mistral.ai/v1/chat/completions';
  const m = model || process.env.MISTRAL_MODEL || 'mistral-small-latest';
  if (!token) throw new Error('Mistral token not set (MISTRAL_API_KEY or MISTRAL_KEY/HF_TOKEN)');

  const wantsJson =
    jsonMode === true ||
    String(process.env.MISTRAL_JSON_MODE || '').toLowerCase() === 'true' ||
    String(process.env.MISTRAL_JSON_MODE || '') === '1';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: m,
      messages,
      temperature,
      max_tokens,
      ...(wantsJson ? { response_format: { type: 'json_object' } } : {})
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`LLM API error: ${res.status} ${redactSecrets(text)}`);
  const parsed = JSON.parse(text);
  const content = parsed?.choices?.[0]?.message?.content ?? '';
  return { raw: content, meta: { provider: 'mistral', model: m } };
}

function flattenMessages(messages) {
  return messages
    .map((msg) => {
      const role = String(msg.role || '').toLowerCase();
      const content = String(msg.content || '').trim();
      if (role === 'system') return `System: ${content}`;
      if (role === 'assistant') return `Assistant: ${content}`;
      return `User: ${content}`;
    })
    .join('\n\n');
}

async function callHiddenBackend(messages, { model, max_tokens = 1200, temperature = 0.2, json: jsonMode = false } = {}) {
  const token = process.env.GEMINI_API_KEY;
  const hiddenModel = model || process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  if (!token) throw new Error('LLM backend token not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${hiddenModel}:generateContent?key=${token}`;
  const body = {
    temperature,
    candidateCount: 1,
    maxOutputTokens: max_tokens,
    topP: 0.95,
    topK: 40,
    content: [
      {
        type: 'text',
        text: flattenMessages(messages)
      }
    ]
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LLM API error: ${res.status} ${redactSecrets(text)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`LLM API response parse error`);
  }

  const candidate = parsed?.candidates?.[0] || parsed?.candidate;
  const content = String(
    candidate?.content?.[0]?.text ||
    candidate?.output?.[0]?.text ||
    candidate?.output?.text ||
    candidate?.text ||
    parsed?.output?.text ||
    ''
  ).trim();

  return { raw: content, meta: { provider: 'llm', model: 'hidden' } };
}

async function callGroq(messages, { model, max_tokens = 1200, temperature = 0.2, json: jsonMode = false } = {}) {
  const token = process.env.GROQ_API_KEY;
  const url = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
  const m = model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  if (!token) throw new Error('Groq token not set');

  const wantsJson =
    jsonMode === true ||
    String(process.env.GROQ_JSON_MODE || '').toLowerCase() === 'true' ||
    String(process.env.GROQ_JSON_MODE || '') === '1';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: m,
      messages,
      temperature,
      max_tokens,
      ...(wantsJson ? { response_format: { type: 'json_object' } } : {})
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`LLM API error: ${res.status} ${redactSecrets(text)}`);
  const parsed = JSON.parse(text);
  const content = parsed?.choices?.[0]?.message?.content ?? '';
  return { raw: content, meta: { provider: 'groq', model: m } };
}

export async function callLLM(messages, opts = {}) {
  // Attempt all backends and return the best response
  const backends = [
    { name: 'hidden', func: callHiddenBackend },
    { name: 'mistral', func: callMistral },
    { name: 'groq', func: callGroq }
  ];

  const results = [];
  const errors = [];

  for (const backend of backends) {
    try {
      const out = await backend.func(messages, opts);
      results.push({ ...out, backend: backend.name });
    } catch (e) {
      errors.push({ backend: backend.name, error: e });
    }
  }

  if (results.length === 0) {
    const lastError = errors.length ? errors[errors.length - 1].error : null;
    if (lastError) {
      throw new Error('LLM request failed. Please retry.');
    }
    throw new Error('LLM request failed. Please retry.');
  }

  // Score responses: prefer longer, complete responses
  const scored = results.map(r => ({
    ...r,
    score: String(r.raw || '').trim().length + (String(r.raw || '').endsWith('.') ? 10 : 0)
  }));

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  console.log(`[llm] Selected response (score: ${best.score})`);
  // Always mask as Mistral to hide other backends
  return { raw: best.raw, meta: { provider: 'mistral', model: 'mistral-small-latest' } };
}

export async function callLLMJson(messages, opts = {}) {
  const { raw, meta } = await callLLM(messages, { ...opts, json: true });
  const cleaned = String(raw || '').trim();

  // Strip code fences if present
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : cleaned;

  const obj = extractJsonObject(candidate);
  if (obj) return { json: obj, raw, meta };

  const arr = extractJsonArray(candidate);
  if (arr) return { json: arr, raw, meta };

  // If the model wrapped JSON with leading prose, try again by locating first { or [
  const firstObj = candidate.indexOf('{');
  const firstArr = candidate.indexOf('[');
  const first = (firstObj === -1) ? firstArr : (firstArr === -1 ? firstObj : Math.min(firstObj, firstArr));
  if (first !== -1) {
    const sliced = candidate.slice(first);
    const obj2 = extractJsonObject(sliced);
    if (obj2) return { json: obj2, raw, meta };
    const arr2 = extractJsonArray(sliced);
    if (arr2) return { json: arr2, raw, meta };
    try {
      const parsed2 = JSON.parse(sliced);
      return { json: parsed2, raw, meta };
    } catch {
      // fall through
    }
  }

  const snippet = cleaned.slice(0, 600);
  throw new Error(`LLM did not return valid JSON (${meta.provider}/${meta.model}). First chars: ${snippet}`);
}

