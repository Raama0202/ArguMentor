// Persistent vector memory from model embeddings

export async function getCaseMemoryCollection(db) {
  const col = db.collection('case_memory');
  await col.createIndex({ caseId: 1 }, { unique: true });
  return col;
}

export async function upsertCaseMemory(db, payload) {
  const col = await getCaseMemoryCollection(db);
  const { caseId } = payload;
  const doc = {
    caseId,
    title: payload.title || null,
    summary: payload.summary || null,
    arguments: Array.isArray(payload.arguments) ? payload.arguments : [],
    counterarguments: Array.isArray(payload.counterarguments) ? payload.counterarguments : [],
    chatHistory: Array.isArray(payload.chatHistory) ? payload.chatHistory : [],
    outcome: payload.outcome || null,
    updatedAt: new Date(),
  };
  await col.updateOne(
    { caseId },
    { $set: doc, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
  return await col.findOne({ caseId });
}

export async function getCaseMemory(db, caseId) {
  const col = await getCaseMemoryCollection(db);
  return await col.findOne({ caseId });
}


