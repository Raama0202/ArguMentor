import express from 'express';
import { getCaseMemory, upsertCaseMemory } from '../models/caseMemory.js';

const router = express.Router();

// Persistent vector memory from model embeddings
router.get('/memory/:caseId', async (req, res) => {
  try {
    const db = req.db;
    const { caseId } = req.params;
    const mem = await getCaseMemory(db, caseId);
    if (!mem) return res.status(404).json({ error: 'Memory not found' });
    return res.json({ ok: true, memory: mem });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/memory/save', async (req, res) => {
  try {
    const db = req.db;
    const payload = req.body || {};
    if (!payload.caseId) return res.status(400).json({ error: 'caseId is required' });
    const mem = await upsertCaseMemory(db, payload);
    return res.json({ ok: true, memory: mem });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;


