import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const filePath = path.join(dataDir, 'local_schedules.json');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify({ schedules: {} }, null, 2));
}

export function loadAll() {
  try {
    ensureDataDir();
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw).schedules || {};
  } catch (e) {
    return {};
  }
}

export function saveAll(obj) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify({ schedules: obj }, null, 2));
}

export function listSchedules() {
  const schedules = loadAll();
  return Object.values(schedules).map(s => ({ ...s, id: s.id || String(s._id) }));
}

export function getSchedule(id) {
  const schedules = loadAll();
  return schedules[id] || null;
}

export function createSchedule({ name = 'New Week', date = null } = {}) {
  const schedules = loadAll();
  const id = `local-${uuidv4()}`;
  const doc = {
    _id: id,
    id,
    name,
    date: date ? String(date) : null,
    cases: [],
    createdAt: new Date().toISOString()
  };
  schedules[id] = doc;
  saveAll(schedules);
  return doc;
}

export function updateSchedule(id, patch = {}) {
  const schedules = loadAll();
  if (!schedules[id]) return null;
  schedules[id] = { ...schedules[id], ...patch };
  saveAll(schedules);
  return schedules[id];
}

export function deleteSchedule(id) {
  const schedules = loadAll();
  if (!schedules[id]) return false;
  delete schedules[id];
  saveAll(schedules);
  return true;
}

export function addCaseToSchedule(id, { caseId = null, title = 'Untitled Case' } = {}) {
  const schedules = loadAll();
  if (!schedules[id]) return null;
  const schedCaseId = `sc-${uuidv4()}`;
  const entry = { id: schedCaseId, caseId, title, addedAt: new Date().toISOString() };
  schedules[id].cases = schedules[id].cases || [];
  schedules[id].cases.push(entry);
  saveAll(schedules);
  return entry;
}

export function updateCaseInSchedule(scheduleId, schedCaseId, patch = {}) {
  const schedules = loadAll();
  if (!schedules[scheduleId]) return null;
  const cases = schedules[scheduleId].cases || [];
  const idx = cases.findIndex(c => c.id === schedCaseId);
  if (idx === -1) return null;
  cases[idx] = { ...cases[idx], ...patch };
  schedules[scheduleId].cases = cases;
  saveAll(schedules);
  return cases[idx];
}

export function removeCaseFromSchedule(scheduleId, schedCaseId) {
  const schedules = loadAll();
  if (!schedules[scheduleId]) return false;
  const before = schedules[scheduleId].cases?.length || 0;
  schedules[scheduleId].cases = (schedules[scheduleId].cases || []).filter(c => c.id !== schedCaseId);
  const after = schedules[scheduleId].cases?.length || 0;
  saveAll(schedules);
  return after < before;
}

export default {
  loadAll,
  saveAll,
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  addCaseToSchedule,
  updateCaseInSchedule,
  removeCaseFromSchedule
};
