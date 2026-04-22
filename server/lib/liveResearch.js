import fetch from 'node-fetch';

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchText(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Argumentor/2.0 (legal research aggregator)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(t);
  }
}

function uniqueByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it?.url) continue;
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    out.push(it);
  }
  return out;
}

function isLikelyLegalIndianLink(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const p = (u.pathname || '').toLowerCase();
    return (
      h.includes('indiacode.nic.in') ||
      h.includes('indiankanoon.org') ||
      h.endsWith('.gov.in') ||
      h.endsWith('.nic.in') ||
      h.includes('supremecourt') ||
      h.includes('highcourt') ||
      h.includes('law') ||
      p.includes('act') ||
      p.includes('judgment') ||
      p.includes('case')
    );
  } catch {
    return false;
  }
}

function scoreResult(result, queryTerms = []) {
  const title = String(result?.title || '').toLowerCase();
  const url = String(result?.url || '').toLowerCase();
  let score = 0;
  for (const t of queryTerms) {
    if (!t) continue;
    if (title.includes(t)) score += 2;
    if (url.includes(t)) score += 1;
  }
  if (/indiacode\.nic\.in/.test(url)) score += 7;
  if (/indiankanoon\.org/.test(url)) score += 7;
  if (/supremecourt|highcourt|ecourts|gov\.in|nic\.in/.test(url)) score += 4;
  if (/\/doc\/|judgment|order|act|rules|amend/.test(url)) score += 3;
  if (/wiki|youtube|facebook|instagram|pinterest/.test(url)) score -= 6;
  return score;
}

function parseAnchors(html, { limit = 6 } = {}) {
  const out = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < limit * 4) {
    const href = decodeHtmlEntities(m[1] || '').trim();
    const title = stripHtml(decodeHtmlEntities(m[2] || '')).trim();
    if (!href || !title) continue;
    if (!/^https?:\/\//i.test(href)) continue;
    out.push({ title, url: href });
  }
  return uniqueByUrl(out).slice(0, limit);
}

async function searchBing(query, limit = 5) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=${limit}`;
  const { ok, text } = await fetchText(url);
  if (!ok) return [];
  // Parse RSS items first (more stable direct links)
  const out = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(text)) && out.length < limit) {
    const item = m[1];
    const t = (item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1]
      || item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
      || '').trim();
    const l = (item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '').trim();
    if (!t || !l) continue;
    if (/bing\.com/i.test(l)) continue;
    out.push({ title: stripHtml(decodeHtmlEntities(t)), url: decodeHtmlEntities(l) });
  }
  if (out.length) return uniqueByUrl(out).slice(0, limit);
  return parseAnchors(text, { limit }).filter(r => !/bing\.com/i.test(r.url) && !/\/search\?/.test(r.url));
}

async function searchGoogle(query, limit = 5) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${limit}&hl=en`;
  const { ok, text } = await fetchText(url);
  if (!ok) return [];
  const raw = parseAnchors(text, { limit: limit * 3 });
  const cleaned = raw
    .map((r) => {
      // Google often wraps outbound links as /url?q=...
      const u = r.url;
      const m = u.match(/\/url\?q=([^&]+)/);
      if (m && m[1]) {
        try {
          return { ...r, url: decodeURIComponent(m[1]) };
        } catch {
          return r;
        }
      }
      return r;
    })
    .filter(r => /^https?:\/\//i.test(r.url) && !/google\./i.test(new URL(r.url).hostname));
  return uniqueByUrl(cleaned).slice(0, limit);
}

async function searchDuckDuckGo(query, limit = 5) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const { ok, text } = await fetchText(url);
  if (!ok) return [];
  const raw = parseAnchors(text, { limit: limit * 3 });
  const cleaned = raw.map((r) => {
    // DDG redirect: /l/?uddg=<url>
    try {
      const u = new URL(r.url, 'https://duckduckgo.com');
      const target = u.searchParams.get('uddg');
      if (target) return { ...r, url: decodeURIComponent(target) };
    } catch {
      // ignore
    }
    return r;
  }).filter(r => /^https?:\/\//i.test(r.url));
  return uniqueByUrl(cleaned).slice(0, limit);
}

async function searchIndianKanoon(query, limit = 5) {
  const url = `https://indiankanoon.org/search/?formInput=${encodeURIComponent(query)}`;
  const { ok, text } = await fetchText(url);
  if (!ok) return [];
  const raw = parseAnchors(text, { limit: limit * 6 })
    .filter(r => /indiankanoon\.org/i.test(r.url));
  const docsFirst = raw.filter(r => /\/doc\//i.test(r.url));
  const merged = uniqueByUrl([...docsFirst, ...raw]);
  return merged.slice(0, limit);
}

async function searchIndiaCode(query, limit = 5) {
  // IndiaCode pages are difficult to crawl reliably; use site-targeted search.
  const q = `site:indiacode.nic.in ${query}`;
  const [bing, ddg] = await Promise.all([
    searchBing(q, Math.max(2, limit)),
    searchDuckDuckGo(q, Math.max(2, limit))
  ]);
  const merged = uniqueByUrl([...bing, ...ddg]).filter(r => /indiacode\.nic\.in/i.test(r.url));
  return merged.slice(0, limit);
}

function extractMetaDescription(html) {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  if (m && m[1]) return stripHtml(decodeHtmlEntities(m[1])).trim();
  const m2 = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  if (m2 && m2[1]) return stripHtml(decodeHtmlEntities(m2[1])).trim();
  return '';
}

function extractFirstParagraph(html) {
  const m = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (m && m[1]) return stripHtml(decodeHtmlEntities(m[1])).trim();
  return '';
}

async function fetchPagePreview(url) {
  try {
    const { ok, text } = await fetchText(url, 7000);
    if (!ok || !text) return '';
    const description = extractMetaDescription(text) || extractFirstParagraph(text);
    return String(description || '').slice(0, 240).trim();
  } catch {
    return '';
  }
}

export async function gatherLiveLegalResearch(userQuery) {
  const raw = String(userQuery || '').toLowerCase();
  const tokens = raw
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(t => t.length > 3)
    .filter(t => !['compare', 'latest', 'recent', 'under', 'with', 'from', 'that', 'this', 'where', 'what'].includes(t));
  const core = tokens.slice(0, 8).join(' ');
  const q = `${core} India law amendment recent case`;
  const kanoonQ = `${core} site:indiankanoon.org`;
  const indiaCodeQ = `${core} site:indiacode.nic.in`;

  const [indiaCode, indianKanoon, google, duckduckgo, bing] = await Promise.all([
    searchIndiaCode(indiaCodeQ, 4).catch(() => []),
    searchIndianKanoon(kanoonQ, 5).catch(() => []),
    searchGoogle(q, 5).catch(() => []),
    searchDuckDuckGo(q, 5).catch(() => []),
    searchBing(q, 5).catch(() => []),
  ]);

  const bingFiltered = bing.filter(x => isLikelyLegalIndianLink(x.url));
  const queryTerms = core.split(/\s+/).filter(Boolean).slice(0, 8);

  const sources = {
    IndiaCode: indiaCode.length ? indiaCode : [{ title: 'India Code Search', url: `https://www.indiacode.nic.in/` }],
    IndianKanoon: indianKanoon.length ? indianKanoon : [{ title: 'Indian Kanoon Search', url: `https://indiankanoon.org/search/?formInput=${encodeURIComponent(core || 'latest amendment')}` }],
    Google: google.length ? google : [{ title: 'Google Search', url: `https://www.google.com/search?q=${encodeURIComponent(q)}` }],
    DuckDuckGo: duckduckgo.length ? duckduckgo : [{ title: 'DuckDuckGo Search', url: `https://duckduckgo.com/?q=${encodeURIComponent(q)}` }],
    Bing: bingFiltered.length ? bingFiltered : [{ title: 'Bing Search', url: `https://www.bing.com/search?q=${encodeURIComponent(q)}` }]
  };

  const all = uniqueByUrl([
    ...sources.IndiaCode.map(x => ({ ...x, source: 'IndiaCode' })),
    ...sources.IndianKanoon.map(x => ({ ...x, source: 'IndianKanoon' })),
    ...sources.Google.map(x => ({ ...x, source: 'Google' })),
    ...sources.DuckDuckGo.map(x => ({ ...x, source: 'DuckDuckGo' })),
    ...sources.Bing.map(x => ({ ...x, source: 'Bing' })),
  ]);

  const ranked = [...all]
    .map(r => ({ ...r, score: scoreResult(r, queryTerms) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  const top = ranked.slice(0, 10);
  const previewTasks = top.slice(0, 5).map(async (r) => ({
    ...r,
    summary: await fetchPagePreview(r.url).catch(() => '')
  }));
  const topWithPreview = await Promise.all(previewTasks);

  return {
    sources,
    combined: ranked,
    top: topWithPreview.map(r => ({
      source: r.source,
      title: r.title,
      url: r.url,
      summary: r.summary || ''
    }))
  };
}

