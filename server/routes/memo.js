import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mammoth from 'mammoth';
import fetch from 'node-fetch';
import { resolveCase } from '../lib/caseResolver.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templatesDir = path.join(__dirname, '..', '..', 'memo-templates');
if (!fs.existsSync(templatesDir)) {
  fs.mkdirSync(templatesDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, templatesDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.txt';
    const base = path.basename(file.originalname, ext);
    cb(null, `${base}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB templates
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'text/plain',
      'text/markdown'
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported template type. Allowed: DOCX, TXT, MD.'));
  }
});

async function loadTemplateText(filePath, mimetype) {
  if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const res = await mammoth.extractRawText({ path: filePath });
    return (res.value || '').trim();
  }
  return fs.readFileSync(filePath, 'utf8');
}

async function generateMemoFromTemplate(templateText, caseDoc) {
  const apiKey = process.env.MISTRAL_API_KEY;
  const endpoint = process.env.MISTRAL_API_URL || 'https://api.mistral.ai/v1/chat/completions';
  const model = process.env.MISTRAL_MODEL || 'mistral-small-latest';

  if (!apiKey) {
    throw new Error('Mistral 7B API not configured. Please set MISTRAL_API_KEY in server/.env');
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  const text = (caseDoc?.extraction?.text || '').slice(0, 20000);
  const structured = caseDoc?.inference?.structured || {};
  const summary = caseDoc?.inference?.summary || '';

  const systemPrompt =
    'You are a senior legal drafting assistant. You fill legal memorandum templates for lawyers. ' +
    'Always keep the template structure, headings, and numbering, only replacing placeholders with well-written legal prose.';

  const userContent = [
    'You are given a legal memo template and case context.',
    '',
    'TEMPLATE (keep headings and structure; replace placeholders such as [FACTS], [ISSUES], [ANALYSIS], [CONCLUSION], etc.):',
    '',
    templateText,
    '',
    'CASE CONTEXT:',
    '',
    'Summary:',
    summary,
    '',
    'Structured analysis (JSON):',
    JSON.stringify(structured, null, 2),
    '',
    'Source text excerpt:',
    text,
    '',
    'Task: Fill in the template with a professional legal memorandum for this case.',
    '- Preserve the template headings and formatting as much as possible in plain text.',
    '- Replace each placeholder with detailed but concise content grounded in the case context.',
    '- Use clear paragraphs and bullet or numbered lists where appropriate.',
    '',
    'Return ONLY the completed memorandum text. Do NOT add explanations, markdown code fences, or any commentary.'
  ].join('\n');

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    temperature: 0.3,
    max_tokens: 2000
  });

  const resp = await fetch(endpoint, { method: 'POST', headers, body });
  if (!resp.ok) {
    const textBody = await resp.text().catch(() => '');
    throw new Error(`Mistral 7B API error: ${resp.status} ${resp.statusText} ${textBody.slice(0, 200)}`);
  }

  const data = await resp.json();
  let memoText = '';
  if (data && Array.isArray(data.choices) && data.choices.length > 0) {
    const first = data.choices[0];
    if (first.message && typeof first.message.content === 'string') {
      memoText = first.message.content;
    } else if (first.delta && typeof first.delta.content === 'string') {
      memoText = first.delta.content;
    }
  }

  if (!memoText && typeof data.generated_text === 'string') {
    memoText = data.generated_text;
  }

  memoText = (memoText || '').trim();
  if (!memoText) {
    throw new Error('Mistral 7B returned empty memo content');
  }

  return memoText;
}

router.post('/memo/generate', upload.single('template'), async (req, res) => {
  let filePath = null;
  try {
    const db = req.db;
    const { caseId, caseTitle } = req.body || {};
    const caseIdentifier = caseId || caseTitle;

    if (!caseIdentifier) {
      return res.status(400).json({ ok: false, error: 'caseId (or caseTitle) is required' });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ ok: false, error: 'Template file is required' });
    }

    filePath = file.path;

    const doc = await resolveCase(db, caseIdentifier);
    if (!doc) {
      return res.status(404).json({ ok: false, error: 'Case not found' });
    }

    const templateText = await loadTemplateText(filePath, file.mimetype);
    const memoText = await generateMemoFromTemplate(templateText, doc);

    const safeBase =
      (file.originalname || 'legal-memo-template').replace(/\.[^.\s]+$/, '') || 'legal-memo';
    const filename = `${safeBase}-filled-${Date.now()}.txt`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(memoText);
  } catch (e) {
    console.error('[memo] Error generating memo:', e && e.message ? e.message : e);
    if (!res.headersSent) {
      return res
        .status(500)
        .json({ ok: false, error: e && e.message ? e.message : 'Failed to generate memo' });
    }
  } finally {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlink(filePath, () => {});
      }
    } catch {
      // ignore
    }
  }
});

export default router;

