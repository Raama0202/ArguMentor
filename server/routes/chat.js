import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

router.post("/chat", async (req, res) => {
  try {
    const io = req.app.get("io");
    const { clientId, message, history } = req.body || {};

    if (!clientId || !message) {
      console.warn("[chat] Missing clientId or message");
      return res
        .status(400)
        .json({ error: "clientId and message are required" });
    }

    const contextPayload = {
      history: Array.isArray(history) ? history : [],
      latestQuestion: message,
    };

    const context = JSON.stringify(contextPayload);
    const child = spawnLocalInference(message, context);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      const chunk = d.toString();
      stdout += chunk;
      console.log(`[chat] stdout: ${chunk.substring(0, 120)}`);
    });

    child.stderr.on("data", (d) => {
      const chunk = d.toString();
      stderr += chunk;
      console.error(`[chat] stderr: ${chunk}`);
    });

    child.on("close", async (code) => {
      try {
        console.log(`[chat] Inference process exited with code ${code}`);

        if (code !== 0) {
          console.error("[chat] Mistral 7B inference failed, stderr:", stderr);
          const errorMsg = `Mistral 7B inference failed: ${stderr || "Unknown error"}`;
          if (io) {
            io
              .to(clientId)
              .emit("chat:end", { code: 1, error: true, full: errorMsg });
          }
          return res
            .status(502)
            .json({ ok: false, error: errorMsg, engine: "mistral-7b" });
        }

        const reply = extractChatReply(stdout) || "No response generated.";

        console.log(`[chat] Reply (Mistral 7B): ${reply.substring(0, 200)}...`);

        if (io) {
          io.to(clientId).emit("chat:delta", { text: reply });
          io
            .to(clientId)
            .emit("chat:end", { code: 0, error: false, full: reply });
        }

        return res.json({
          ok: true,
          reply,
          clientId,
          engine: "mistral-7b",
        });
      } catch (err) {
        console.error("[chat] Error finalizing chat response:", err);
        if (io) {
          io.to(clientId).emit("chat:end", {
            code: 1,
            error: true,
            full: "Server error during chat processing.",
          });
        }
        return res
          .status(500)
          .json({ ok: false, error: "Server error during chat processing." });
      }
    });
  } catch (err) {
    console.error(`[chat] Exception: ${err.message}`, err);
    res.status(500).json({ error: err.message || "Chat request failed" });
  }
});

export default router;



