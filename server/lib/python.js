import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

export function locatePythonBinary(workspaceRoot) {
  const candidates = [];
  const envBin = process.env.PYTHON_BIN;
  if (envBin) candidates.push({ value: envBin, source: 'PYTHON_BIN' });

  // common venv locations
  candidates.push({ value: path.join(workspaceRoot, '.venv', 'Scripts', 'python.exe'), source: '.venv\Scripts' });
  candidates.push({ value: path.join(workspaceRoot, 'venv', 'Scripts', 'python.exe'), source: 'venv\Scripts' });
  candidates.push({ value: path.join(workspaceRoot, '.venv', 'bin', 'python'), source: '.venv/bin' });

  // system names
  candidates.push({ value: 'py', source: 'system' });
  candidates.push({ value: 'python', source: 'system' });
  candidates.push({ value: 'python3', source: 'system' });

  const results = [];
  let selected = null;

  for (const cand of candidates) {
    const c = cand.value;
    const info = { candidate: c, source: cand.source, exists: false, executable: false, ok: false, stdout: '', stderr: '', error: null };

    try {
      // If it's an absolute path, check file exists
      if (path.isAbsolute(c)) {
        info.exists = fs.existsSync(c);
        if (info.exists) {
          try {
            fs.accessSync(c, fs.constants.R_OK);
            info.executable = true; // on Windows this is a best-effort
          } catch (e) {
            info.executable = false;
            info.error = e && e.message ? e.message : String(e);
          }
        }
      }

      // Try running --version to verify
      const r = spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 3000, shell: false });
      info.stdout = (r.stdout || '').toString().trim();
      info.stderr = (r.stderr || '').toString().trim();
      if (r.error) {
        info.error = r.error && r.error.message ? r.error.message : String(r.error);
      }
      if (r.status === 0 || info.stdout.match(/Python\s*\d+/i) || info.stderr.match(/Python\s*\d+/i)) {
        info.ok = true;
      }
    } catch (e) {
      info.error = e && e.message ? e.message : String(e);
    }

    results.push(info);
    if (!selected && info.ok) selected = c;
  }

  return { selected, results };
}
