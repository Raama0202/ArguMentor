import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const filePath = path.join(dataDir, 'local_cases.json');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify({ cases: {} }, null, 2));
}

export function loadAll() {
  try {
    ensureDataDir();
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw).cases || {};
  } catch (e) {
    return {};
  }
}

export function saveAll(obj) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify({ cases: obj }, null, 2));
}

export function saveCase(doc) {
  const cases = loadAll();
  // use provided _id if present, else generate one
  const id = doc._id ? String(doc._id) : `local-${uuidv4()}`;
  const toSave = { ...doc, _id: id };
  cases[id] = toSave;
  saveAll(cases);
  return id;
}

export function getCase(id) {
  const cases = loadAll();
  return cases[id] || null;
}

export function listCases() {
  const cases = loadAll();
  return Object.values(cases);
}

export function deleteCase(id) {
  try {
    const cases = loadAll();
    if (cases[id]) {
      delete cases[id];
      saveAll(cases);
      return true;
    }
    for (const [key, value] of Object.entries(cases)) {
      if (value._id === id || value.caseId === id) {
        delete cases[key];
        saveAll(cases);
        return true;
      }
    }
    return false;
  } catch (e) {
    console.error('[localCases] Delete error:', e && e.message ? e.message : e);
    return false;
  }
}