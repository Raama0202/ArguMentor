#!/usr/bin/env node
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const endpoints = [
  'https://api.groq.com/v1/models',
  'https://api.groq.com/models',
  'https://api.groq.com/openai/v1/models',
  'https://api.groq.com/openai/models'
];

async function tryEndpoint(url) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } });
    const txt = await res.text();
    if (!res.ok) {
      return { ok: false, url, status: res.status, body: txt };
    }
    try {
      const json = JSON.parse(txt);
      return { ok: true, url, json };
    } catch (e) {
      return { ok: true, url, text: txt };
    }
  } catch (e) {
    return { ok: false, url, error: String(e) };
  }
}

(async () => {
  if (!process.env.GROQ_API_KEY) {
    console.error('GROQ_API_KEY not set in environment');
    process.exit(2);
  }
  const results = [];
  for (const e of endpoints) {
    const r = await tryEndpoint(e);
    results.push(r);
    if (r.ok && r.json) break;
  }

  // Write results to stdout
  console.log(JSON.stringify(results, null, 2));

  // If we have model list in results, attempt to extract model names
  const firstSuccess = results.find(r => r.ok && r.json);
  if (firstSuccess) {
    const j = firstSuccess.json;
    let models = [];
    // try common shapes
    if (Array.isArray(j.data)) {
      models = j.data.map(x => x.id || x.name).filter(Boolean);
    } else if (Array.isArray(j.models)) {
      models = j.models.map(x => x.id || x.name).filter(Boolean);
    } else if (Array.isArray(j)) {
      models = j.map(x => x.id || x.name).filter(Boolean);
    }

    if (models.length) {
      console.log('\nDetected models:');
      models.forEach(m => console.log('-', m));

      // pick first llama-like model if available
      const candidate = models.find(m => /llama/i.test(m)) || models[0];
      console.log('\nSelected model:', candidate);

      // update server/.env
      const envPath = path.join(process.cwd(), '..', 'server', '.env');
      if (fs.existsSync(envPath)) {
        let env = fs.readFileSync(envPath, 'utf8');
        if (/^GROQ_MODEL=/m.test(env)) {
          env = env.replace(/^GROQ_MODEL=.*$/m, `GROQ_MODEL=${candidate}`);
        } else {
          env += `\nGROQ_MODEL=${candidate}\n`;
        }
        fs.writeFileSync(envPath, env, 'utf8');
        console.log('Updated', envPath);
      } else {
        console.warn('Could not find server/.env to update');
      }
    } else {
      console.warn('Could not extract models from response');
    }
  } else {
    console.error('No model-list response from Groq endpoints');
    process.exit(3);
  }

})();
