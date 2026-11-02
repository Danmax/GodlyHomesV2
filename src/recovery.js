import { openDB } from 'idb';

const database = () => openDB('godly-homes-recordings', 1, { upgrade(db) {
  db.createObjectStore('sessions', { keyPath: 'id' });
  db.createObjectStore('chunks', { keyPath: ['sessionId', 'sequence'] }).createIndex('session', 'sessionId');
} });
export async function createRecovery(session) {
  const db = await database(); await db.put('sessions', session);
}
export async function saveChunk(sessionId, sequence, blob) {
  const db = await database(); await db.put('chunks', { sessionId, sequence, blob });
}
export async function recoveries(userId) {
  const db = await database();
  return (await db.getAll('sessions')).filter(s => s.userId === userId);
}
export async function recoveryBlob(session) {
  const db = await database();
  const chunks = await db.getAllFromIndex('chunks', 'session', session.id);
  chunks.sort((a, b) => a.sequence - b.sequence);
  return new Blob(chunks.map(c => c.blob), { type: session.mime });
}
export async function removeRecovery(id) {
  const db = await database();
  const tx = db.transaction(['sessions', 'chunks'], 'readwrite');
  const keys = await tx.objectStore('chunks').index('session').getAllKeys(id);
  for (const key of keys) await tx.objectStore('chunks').delete(key);
  await tx.objectStore('sessions').delete(id); await tx.done;
}
