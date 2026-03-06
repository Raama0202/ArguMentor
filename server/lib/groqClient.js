import fetch from 'node-fetch';

const DEFAULT_FALLBACKS = [
  process.env.GROQ_MODEL
].filter(Boolean);

export async function callGroq(messages, options = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const candidates = options.models || DEFAULT_FALLBACKS;
  let lastErr = null;

  for (const model of candidates) {
    try {
      const payload = {
        model,
        messages,
        stream: false,
        ...(options.extra || {})
      };

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });

      const text = await res.text();
      if (!res.ok) {
        // try to parse error code
        try {
          const json = JSON.parse(text);
          if (json?.error?.code === 'model_decommissioned') {
            // propagate a clear error with recommendation
            throw new Error('model_decommissioned: The configured Groq model is decommissioned. Please update GROQ_MODEL in server/.env with a supported model. See https://console.groq.com/docs/deprecations');
          }
        } catch (_) {}
        throw new Error(`Groq API error: ${res.status} - ${text}`);
      }

      // success
      try {
        return JSON.parse(text);
      } catch (e) {
        return { raw: text };
      }
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('Groq request failed');
}

export default callGroq;
