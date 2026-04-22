import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { callLLM } from "../lib/llm.js";
import { resolveCase } from "../lib/caseResolver.js";
import { gatherLiveLegalResearch } from "../lib/liveResearch.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function looksIncomplete(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (/[.!?]"?$/.test(t)) return false;
  if (/\|\s*$/.test(t)) return true; // broken markdown table row
  if (/(?:\bif|\bwhen|\bunless|\bbecause|\band|\bor|\blacks?)\s*$/i.test(t)) return true;
  return true;
}

function hasNoisyMarkdown(text) {
  const t = String(text || "");
  return /(^|\n)\s*#{2,6}\s+/m.test(t) || /\|.*\|/.test(t) || /(^|\n)\s*-{3,}\s*\|/m.test(t);
}

function sanitizeMarkdownArtifacts(text) {
  const cleanInline = (line) =>
    String(line || '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 - $2')
      .replace(/^\s*>\s?/, '')
      .trim();

  const rawLines = String(text || '').split(/\r?\n/);
  const lines = [];
  for (const raw of rawLines) {
    let line = raw.replace(/^\s*#{1,6}\s+/, '').trim();
    // Drop markdown table separators/rows.
    if (/^\|[-\s|:]+\|?$/.test(line) || /^\|.*\|$/.test(line)) continue;
    line = cleanInline(line);
    if (!line) continue;
    lines.push(line);
  }

  // Remove dangling markdown fragments and incomplete link wrappers.
  const joined = lines.join('\n')
    .replace(/\[[^\]\n]*$/g, '')
    .replace(/\([^\)\n]*$/g, '')
    .replace(/\*+$/g, '')
    .trim();

  return joined;
}

function forceCompleteEnding(text) {
  const t = String(text || "").trim();
  if (!t) return '';
  if (/[.!?]"?$/.test(t)) return t;
  const cleaned = t.replace(/[,:;\-\s*]+$/g, '').trim();
  return `${cleaned}.`;
}

function normalizeCleanResponse(text) {
  const base = sanitizeMarkdownArtifacts(text);
  const lines = base.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  let prevBlank = false;
  for (const l of lines) {
    // Keep numbered and bulleted lines; normalize "Section:" style lines as plain paragraphs.
    const line = l.replace(/\s{2,}/g, ' ');
    if (!line) {
      if (!prevBlank) out.push('');
      prevBlank = true;
      continue;
    }
    prevBlank = false;
    out.push(line);
  }
  return forceCompleteEnding(out.join('\n').trim());
}

function shouldIncludeComparison(userMessage, text) {
  const u = String(userMessage || '').toLowerCase();
  const explicitlyAsked =
    /\bcompare|comparison|old vs|new vs|difference|changed from\b/.test(u);
  return explicitlyAsked;
}

function removeComparisonSections(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let skip = false;
  for (const line of lines) {
    const l = line.trim().toLowerCase();
    if (
      /\bcomparison\b/.test(l) ||
      /\bold vs\b/.test(l) ||
      /\bupdated position\b/.test(l) ||
      /\bpre-20\d{2}\b/.test(l) ||
      /\bpost-20\d{2}\b/.test(l)
    ) {
      skip = true;
      continue;
    }
    if (skip) {
      // stop skipping at common next section markers
      if (/^\d+\)/.test(l) || /\bsource references\b/.test(l) || /\bconfidence\b/.test(l)) {
        skip = false;
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function removeInvalidSourceLines(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const l = line.trim();
    // Drop non-web links/pseudo links that are not clickable in UI.
    if (/attachment:/i.test(l)) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function finalizeChatReply(draft, userMessage, caseContext, liveTopBlock) {
  const base = String(draft || "").trim();
  if (!base) return "No response generated.";

  if (!hasNoisyMarkdown(base) && !looksIncomplete(base)) {
    const normalized = normalizeCleanResponse(base);
    const withoutComparison = shouldIncludeComparison(userMessage, normalized) ? normalized : removeComparisonSections(normalized);
    return removeInvalidSourceLines(withoutComparison);
  }

  try {
    const repairMessages = [
      {
        role: "system",
        content:
          "Rewrite into clean legal prose with short paragraphs and bullet points only. " +
          "Do not use markdown headings, tables, pipes, or decorative symbols. " +
          "Ensure every sentence and section is complete."
      },
      {
        role: "user",
        content:
          `User question:\n${String(userMessage || "").slice(0, 3000)}\n\n` +
          `Case context:\n${String(caseContext || "").slice(0, 3000)}\n\n` +
          `Live references:\n${String(liveTopBlock || "").slice(0, 3000)}\n\n` +
          `Draft to fix:\n${base}\n\n` +
          `Return final answer with this exact structure:\n` +
          `- Direct answer (paragraphs)\n` +
          `- Key points (bullets)\n` +
          `- Recent legal updates (only if verified from references)\n` +
          `- Comparison (Old vs Updated) ONLY when there is a real recent legal change or if user asked comparison\n` +
          `- Source references (markdown links)\n` +
          `- Confidence (single line)\n`
      }
    ];
    const repaired = await callLLM(repairMessages, { max_tokens: 1200, temperature: 0.1 });
    const firstPass = String(repaired?.raw || "").trim() || base;
    if (!hasNoisyMarkdown(firstPass) && !looksIncomplete(firstPass)) {
      const normalized = normalizeCleanResponse(firstPass);
      const withoutComparison = shouldIncludeComparison(userMessage, normalized) ? normalized : removeComparisonSections(normalized);
      return removeInvalidSourceLines(withoutComparison);
    }

    // Deterministic hard fallback if model still returns noisy/incomplete format.
    const normalized = normalizeCleanResponse(firstPass || base);
    const withoutComparison = shouldIncludeComparison(userMessage, normalized) ? normalized : removeComparisonSections(normalized);
    return removeInvalidSourceLines(withoutComparison);
  } catch {
    const normalized = normalizeCleanResponse(base);
    const withoutComparison = shouldIncludeComparison(userMessage, normalized) ? normalized : removeComparisonSections(normalized);
    return removeInvalidSourceLines(withoutComparison);
  }
}

function spawnLocalInference(prompt, context) {
  const workspaceRoot = path.join(__dirname, "..", "..");
  const py = process.env.PYTHON_BIN || "python";

  const possiblePaths = [
    path.join(workspaceRoot, "mistral_inference.py"),
    path.join(workspaceRoot, "ai_engine", "mistral_inference.py"),
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
    scriptPath = path.join(workspaceRoot, "mistral_inference.py");
    console.warn(`[chat] Python script not found in expected paths, using: ${scriptPath}`);
  }

  const args = ["-u", scriptPath, "--prompt", prompt, "--context", context];

  console.log(`[chat] Spawning inference: ${py} ${args.join(" ")}`);

  const child = spawn(py, args, {
    cwd: workspaceRoot,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.on("error", (err) => {
    console.error(`[chat] Spawn error: ${err.message}`);
  });

  return child;
}

function extractChatReply(stdout) {
  if (!stdout) return "";

  const markers = [
    "-- Reasoned Analysis (Mistral 7B) --",
    "-- Reasoned Analysis (Mistral/Gemini) --",
    "-- Reasoned Analysis (Gemini) --",
  ];
  const endMarker = "=== End ===";
  let reply = stdout;

  let markerIndex = -1;
  let markerLength = 0;
  for (const marker of markers) {
    const idx = stdout.indexOf(marker);
    if (idx !== -1) {
      markerIndex = idx;
      markerLength = marker.length;
      break;
    }
  }

  if (markerIndex !== -1) {
    let start = markerIndex + markerLength;
    if (stdout[start] === "\n") start += 1;
    let end = stdout.indexOf(endMarker, start);
    if (end === -1) end = stdout.length;
    reply = stdout.slice(start, end).trim();
  }

  if (!reply) {
    // Fallback: return the last part of the output so the user
    // still sees something sensible in the chat window.
    reply = stdout.slice(-1200).trim();
  }

  return reply;
}

async function applyAbstractionFilter(text, maxTokens) {
  const wordCount = text.split(/\s+/).length;
  const estimatedTokens = Math.ceil(wordCount / 0.75); // Rough token estimate

  if (estimatedTokens <= maxTokens * 0.9) {
    return text; // No need to filter
  }

  // Apply abstraction to fit within limits
  const filterMessages = [
    {
      role: "system",
      content: "You are a legal content abstracter. Condense the provided legal analysis into a comprehensive yet concise abstract that covers all key information, citations, and conclusions within the specified token limit. Maintain legal accuracy and completeness."
    },
    {
      role: "user",
      content: `Abstract the following legal response to fit within ${maxTokens} tokens while preserving all essential information, legal citations, and conclusions. Use structured format with clear sections.\n\nOriginal response:\n${text}`
    }
  ];

  try {
    const { raw } = await callLLM(filterMessages, { max_tokens: maxTokens, temperature: 0.1 });
    return String(raw || "").trim() || text;
  } catch {
    return text; // Fallback to original if filtering fails
  }
}

router.post("/chat", async (req, res) => {
  try {
    const io = req.app.get("io");
    const db = req.db;
    const { clientId, message, history, caseId } = req.body || {};

    if (!clientId || !message) {
      console.warn("[chat] Missing clientId or message");
      return res
        .status(400)
        .json({ error: "clientId and message are required" });
    }

    const hist = Array.isArray(history) ? history : [];
    const maxHistoryItems = Number(process.env.CHAT_HISTORY_ITEMS || 20);
    const maxHistoryChars = Number(process.env.CHAT_HISTORY_CHARS || 6000);
    const maxUserChars = Number(process.env.CHAT_USER_CHARS || 12000);
    const maxCaseExcerptChars = Number(process.env.CHAT_CASE_EXCERPT_CHARS || 12000);
    const maxStructuredChars = Number(process.env.CHAT_STRUCTURED_CHARS || 6000);
    const maxOutputTokens = Number(process.env.CHAT_MAX_TOKENS || 8000);
    const normalized = hist
      .filter((h) => h && typeof h.content === "string")
      .slice(-maxHistoryItems)
      .map((h) => ({
        role: h.role === "user" ? "user" : "assistant",
        content: String(h.content).slice(0, maxHistoryChars),
      }));

    let caseContext = '';
    if (caseId) {
      try {
        const doc = await resolveCase(db, caseId);
        if (doc) {
          const excerpt = (doc?.extraction?.text || '').slice(0, maxCaseExcerptChars);
          const structured = doc?.inference?.structured || {};
          caseContext =
            `\n\nCase Context (selected caseId=${caseId}):\n` +
            `Title: ${doc?.file?.originalname || doc?.file?.filename || ''}\n` +
            `Excerpt:\n${excerpt}\n` +
            `Structured:\n${JSON.stringify(structured).slice(0, maxStructuredChars)}\n`;
        }
      } catch (e) {
        // ignore, chat can proceed without case context
      }
    }

    // Pull recent legal updates/case references from live web sources.
    const live = await gatherLiveLegalResearch(String(message).slice(0, 500));
    const liveTopBlock = (live.top || [])
      .map((x, i) => {
        const summary = x.summary ? `\n    Summary: ${x.summary}` : '';
        return `${i + 1}. [${x.source}] ${x.title} - ${x.url}${summary}`;
      })
      .join('\n');

    const messages = [
      {
        role: "system",
        content:
          "You are ArguMentor AI, a legal assistant for Indian legal research and case investigation. " +
          "Provide comprehensive, detailed, and evidence-based legal analysis. " +
          "Draw from extensive legal knowledge, case law, statutes, and principles. " +
          "Structure responses with thorough explanations, multiple perspectives, and in-depth reasoning. " +
          "Cite relevant legal provisions, landmark cases, and scholarly interpretations where applicable. " +
          "Never invent statutes/cases/amendments. If evidence is weak, state uncertainty clearly but explore alternatives. " +
          "Write in detailed paragraphs with comprehensive coverage, using bullet points and numbered lists for clarity.",
      },
      ...normalized,
      {
        role: "user",
        content:
          String(message).slice(0, maxUserChars) +
          caseContext +
          `\n\nLive legal reference details (ranked):\n${liveTopBlock || 'No high-confidence legal references found.'}\n\n` +
          `Use ONLY the provided references for factual claims. ` +
          `If no verified live legal update is available, say "No verified recent amendment found for this issue." ` +
          `Respond in this comprehensive structure:\n` +
          `1) Direct answer (3-5 detailed paragraphs with thorough analysis)\n` +
          `2) Key points (detailed bullet list with explanations)\n` +
          `3) Legal framework and citations (relevant statutes, case law, and principles with detailed references)\n` +
          `4) Comparative analysis (Old vs Updated law, if applicable, with historical context)\n` +
          `5) Recent legal updates and impact (detailed analysis of any amendments, judgments, or developments)\n` +
          `6) Practical implications (real-world effects, enforcement challenges, and recommendations)\n` +
          `7) Source references (all cited sources with full details)\n` +
          `8) Confidence level (High/Medium/Low with detailed reasoning)\n`
      },
    ];

    const { raw } = await callLLM(messages, { max_tokens: maxOutputTokens, temperature: 0.1 });
    const draftReply = String(raw || "").trim() || "No response generated.";
    const reply = await finalizeChatReply(draftReply, message, caseContext, liveTopBlock);

    // Apply abstraction filter to ensure complete information within limits
    const filteredReply = await applyAbstractionFilter(reply, maxOutputTokens);

    // Emit a simple streaming illusion so the UI shows progress.
    if (io) {
      const parts = filteredReply.match(/[\s\S]{1,60}/g) || [filteredReply];
      for (const part of parts) {
        io.to(clientId).emit("chat:delta", { text: part });
      }
      io.to(clientId).emit("chat:end", { code: 0, error: false, full: filteredReply });
    }

    return res.json({
      ok: true,
      reply: filteredReply,
      clientId,
      engine: "llm",
      liveSources: live.sources,
      liveTop: live.top || []
    });
  } catch (err) {
    console.error(`[chat] Exception: ${err.message}`, err);
    res.status(500).json({ error: err.message || "Chat request failed" });
  }
});

export default router;



