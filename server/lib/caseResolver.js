/**
 * Case Resolver Helper
 * Allows lookups by both MongoDB ID and filename/title for user-friendly access
 */

import { ObjectId } from 'mongodb';
import { listCases as listLocalCases } from '../models/localCases.js';

export async function resolveCase(db, caseIdentifier) {
  if (!caseIdentifier) {
    throw new Error('caseIdentifier is required');
  }

  let doc = null;

  // If a DB is available, try Mongo lookups first
  if (db) {
    try {
      const casesCol = db.collection('cases');

      // Try as MongoDB ObjectId first
      try {
        if (ObjectId.isValid(caseIdentifier)) {
          doc = await casesCol.findOne({ _id: new ObjectId(caseIdentifier) });
          if (doc) {
            console.log(`[caseResolver] Found case by ID: ${caseIdentifier}`);
            return doc;
          }
        }
      } catch (e) {
        console.warn(`[caseResolver] ObjectId lookup failed:`, e && e.message ? e.message : e);
      }

      // Try by filename (original name from upload)
      try {
        doc = await casesCol.findOne({ 'file.originalname': { $regex: caseIdentifier, $options: 'i' } });
        if (doc) {
          console.log(`[caseResolver] Found case by filename: ${caseIdentifier}`);
          return doc;
        }
      } catch (e) {
        console.warn(`[caseResolver] Filename lookup failed:`, e && e.message ? e.message : e);
      }
    } catch (e) {
      console.warn('[caseResolver] Mongo lookup failed:', e && e.message ? e.message : e);
    }
  }

  // Try local fallback (for cases saved without MongoDB)
  try {
    const { getCase } = await import('../models/localCases.js');
    doc = getCase(caseIdentifier);
    if (doc) {
      console.log(`[caseResolver] Found case in local store: ${caseIdentifier}`);
      return doc;
    }
  } catch (e) {
    console.warn(`[caseResolver] Local store lookup failed:`, e && e.message ? e.message : e);
  }

  // Not found
  console.warn(`[caseResolver] Case not found: ${caseIdentifier}`);
  return null;
}

/**
 * List all cases with their IDs and filenames for UI selection
 */
export async function listCases(db) {
  if (db) {
    try {
      const casesCol = db.collection('cases');
      const cases = await casesCol
        .find({}, { projection: { _id: 1, 'file.originalname': 1, 'file.filename': 1, uploadedAt: 1 } })
        .toArray();

      if (cases.length) {
        return cases.map(c => ({
          id: String(c._id),
          filename: c.file?.originalname || c.file?.filename || 'Unknown',
          uploadedAt: c.uploadedAt || new Date()
        }));
      }
    } catch (err) {
      console.warn('[caseResolver] Failed to list Mongo cases:', err && err.message ? err.message : err);
    }
  }

  try {
    const localCases = listLocalCases();
    if (Array.isArray(localCases) && localCases.length) {
      return localCases.map((c, idx) => ({
        id: String(c._id || c.id || `local-${idx}`),
        filename: c.file?.originalname || c.file?.filename || c.title || 'Local Case',
        uploadedAt: c.uploadedAt || c.file?.uploadedAt || new Date().toISOString()
      }));
    }
  } catch (err) {
    console.warn('[caseResolver] Failed to list local cases:', err && err.message ? err.message : err);
  }

  return [];
}

/**
 * Delete a case by ID from MongoDB or local store
 */
export async function deleteCase(db, caseId) {
  if (!caseId) {
    throw new Error('caseId is required');
  }

  console.log(`[caseResolver] Attempting to delete case: ${caseId}`);

  // Try MongoDB first (if caseId is a valid ObjectId)
  if (db && ObjectId.isValid(caseId)) {
    try {
      const casesCol = db.collection('cases');
      const result = await casesCol.deleteOne({ _id: new ObjectId(caseId) });
      if (result.deletedCount > 0) {
        console.log(`[caseResolver] Deleted case from MongoDB: ${caseId}`);
        return { ok: true, deleted: true, source: 'mongo' };
      } else {
        console.log(`[caseResolver] Case not found in MongoDB: ${caseId}`);
      }
    } catch (e) {
      console.warn('[caseResolver] MongoDB delete failed:', e && e.message ? e.message : e);
    }
  }

  // Try local store (for both local-* IDs and any other format)
  try {
    const { deleteCase: deleteLocalCase } = await import('../models/localCases.js');
    const deleted = deleteLocalCase(caseId);
    if (deleted) {
      console.log(`[caseResolver] Deleted case from local store: ${caseId}`);
      return { ok: true, deleted: true, source: 'local' };
    } else {
      console.log(`[caseResolver] Case not found in local store: ${caseId}`);
    }
  } catch (e) {
    console.error('[caseResolver] Local store delete failed:', e && e.message ? e.message : e);
  }

  // Also try MongoDB with caseId as string (for non-ObjectId cases stored in MongoDB)
  if (db && !ObjectId.isValid(caseId)) {
    try {
      const casesCol = db.collection('cases');
      // Try deleting by _id as string
      const result1 = await casesCol.deleteOne({ _id: caseId });
      if (result1.deletedCount > 0) {
        console.log(`[caseResolver] Deleted case from MongoDB (string ID): ${caseId}`);
        return { ok: true, deleted: true, source: 'mongo' };
      }
      // Try deleting by caseId field
      const result2 = await casesCol.deleteOne({ caseId: caseId });
      if (result2.deletedCount > 0) {
        console.log(`[caseResolver] Deleted case from MongoDB (by caseId field): ${caseId}`);
        return { ok: true, deleted: true, source: 'mongo' };
      }
    } catch (e) {
      console.warn('[caseResolver] MongoDB delete (string) failed:', e && e.message ? e.message : e);
    }
  }

  return { ok: false, deleted: false, error: 'Case not found in MongoDB or local store' };
}

export default { resolveCase, listCases, deleteCase };
