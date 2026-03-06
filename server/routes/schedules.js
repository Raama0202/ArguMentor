import express from 'express';
import { ObjectId } from 'mongodb';
import * as localSchedules from '../models/schedules.js';

const router = express.Router();

router.get('/schedules', async (req, res) => {
  try {
    const db = req.db;
    if (db) {
      const col = db.collection('schedules');
      const docs = await col.find({}).toArray();
      return res.json({ ok: true, schedules: docs.map(d => ({ ...d, id: String(d._id) })) });
    }

    // fallback to local file
    const docs = localSchedules.listSchedules();
    return res.json({ ok: true, schedules: docs });
  } catch (e) {
    console.error('[schedules] GET /schedules error:', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.post('/schedules', async (req, res) => {
  try {
    const { name, date } = req.body || {};
    const db = req.db;
    if (db) {
      const col = db.collection('schedules');
      const insert = await col.insertOne({ name: name || 'New Week', date: date || null, cases: [], createdAt: new Date() });
      const created = await col.findOne({ _id: insert.insertedId });
      return res.json({ ok: true, schedule: { ...created, id: String(created._id) } });
    }

    const created = localSchedules.createSchedule({ name, date });
    return res.json({ ok: true, schedule: created });
  } catch (e) {
    console.error('[schedules] POST /schedules error:', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.put('/schedules/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { name, date } = req.body || {};
    const db = req.db;

    if (db) {
      const col = db.collection('schedules');
      const _id = ObjectId.isValid(id) ? new ObjectId(id) : id;
      const update = {};
      if (name !== undefined) update.name = name;
      if (date !== undefined) update.date = date;
      await col.updateOne({ _id }, { $set: update });
      const updated = await col.findOne({ _id });
      return res.json({ ok: true, schedule: { ...updated, id: String(updated._id) } });
    }

    const updated = localSchedules.updateSchedule(id, { name, date });
    if (!updated) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, schedule: updated });
  } catch (e) {
    console.error('[schedules] PUT /schedules/:id error:', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.delete('/schedules/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const db = req.db;
    if (db) {
      const col = db.collection('schedules');
      const _id = ObjectId.isValid(id) ? new ObjectId(id) : id;
      const r = await col.deleteOne({ _id });
      if (r.deletedCount === 0) return res.status(404).json({ ok: false, error: 'Not found' });
      return res.json({ ok: true });
    }
    const ok = localSchedules.deleteSchedule(id);
    if (!ok) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[schedules] DELETE /schedules/:id error:', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// add case to schedule
router.post('/schedules/:id/cases', async (req, res) => {
  try {
    const scheduleId = req.params.id;
    const { caseId, title } = req.body || {};
    const db = req.db;

    if (db) {
      const col = db.collection('schedules');
      const _id = ObjectId.isValid(scheduleId) ? new ObjectId(scheduleId) : scheduleId;
      const entry = { id: String(new ObjectId()), caseId: caseId || null, title: title || 'Untitled Case', addedAt: new Date() };
      await col.updateOne({ _id }, { $push: { cases: entry } }, { upsert: true });
      const updated = await col.findOne({ _id });
      return res.json({ ok: true, schedule: { ...updated, id: String(updated._id) }, added: entry });
    }

    const added = localSchedules.addCaseToSchedule(scheduleId, { caseId, title });
    if (!added) return res.status(404).json({ ok: false, error: 'Schedule not found' });
    return res.json({ ok: true, added, schedule: localSchedules.getSchedule(scheduleId) });
  } catch (e) {
    console.error('[schedules] POST /schedules/:id/cases error:', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.put('/schedules/:id/cases/:caseEntryId', async (req, res) => {
  try {
    const scheduleId = req.params.id;
    const entryId = req.params.caseEntryId;
    const { title } = req.body || {};
    const db = req.db;

    if (db) {
      const col = db.collection('schedules');
      const _id = ObjectId.isValid(scheduleId) ? new ObjectId(scheduleId) : scheduleId;
      const schedulesDoc = await col.findOne({ _id });
      if (!schedulesDoc) return res.status(404).json({ ok: false, error: 'Not found' });
      const cases = schedulesDoc.cases || [];
      const idx = cases.findIndex(c => c.id === entryId || String(c.id) === entryId);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Case entry not found' });
      cases[idx] = { ...cases[idx], ...(title !== undefined ? { title } : {}) };
      await col.updateOne({ _id }, { $set: { cases } });
      const updated = await col.findOne({ _id });
      return res.json({ ok: true, schedule: { ...updated, id: String(updated._id) } });
    }

    const updated = localSchedules.updateCaseInSchedule(scheduleId, entryId, { title });
    if (!updated) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, caseEntry: updated });
  } catch (e) {
    console.error('[schedules] PUT /schedules/:id/cases/:caseEntryId error:', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

router.delete('/schedules/:id/cases/:caseEntryId', async (req, res) => {
  try {
    const scheduleId = req.params.id;
    const entryId = req.params.caseEntryId;
    const db = req.db;

    if (db) {
      const col = db.collection('schedules');
      const _id = ObjectId.isValid(scheduleId) ? new ObjectId(scheduleId) : scheduleId;
      const schedulesDoc = await col.findOne({ _id });
      if (!schedulesDoc) return res.status(404).json({ ok: false, error: 'Not found' });
      const before = (schedulesDoc.cases || []).length;
      const filtered = (schedulesDoc.cases || []).filter(c => String(c.id) !== entryId && c.id !== entryId);
      await col.updateOne({ _id }, { $set: { cases: filtered } });
      const after = filtered.length;
      return res.json({ ok: true, deleted: after < before });
    }

    const ok = localSchedules.removeCaseFromSchedule(scheduleId, entryId);
    if (!ok) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[schedules] DELETE /schedules/:id/cases/:caseEntryId error:', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

export default router;
