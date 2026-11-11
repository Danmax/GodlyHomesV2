import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reserveUpload, withMediaTransferBudget } from '../server/upload-budget.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../server/config.js';

export async function testUploadSecurity({ rows, userId, otherId, mutate, fixture, arrangement }) {
  const ids = [];
  try {
    const simultaneous = await Promise.allSettled([reserveUpload(userId, 'audio'), reserveUpload(userId, 'audio')]);
    const accepted = simultaneous.filter(result => result.status === 'fulfilled');
    ids.push(...accepted.map(result => result.value));
    assert.equal(accepted.length, 1); assert.equal(simultaneous.find(result => result.status === 'rejected').reason.status, 429);
    ids.push(await reserveUpload(otherId, 'audio'));
    await assert.rejects(reserveUpload(randomUUID(), 'audio'), error => error.status === 429);
  } finally { for (const id of ids) await rows('DELETE FROM upload_reservations WHERE id = ?', [id]); }
  const [source] = await rows('SELECT * FROM assets WHERE id = ?', [arrangement.segments[0].assetId]);
  const bytes = await readFile(path.join(config.mediaDir, source.storage_key));
  const transfer = await reserveUpload(userId, 'transfer');
  try {
    const blocked = await mutate('put', `/api/assets/${source.id}/audio`).set('Content-Type', 'application/octet-stream').set('X-Content-SHA256', createHash('sha256').update(bytes).digest('hex')).send(bytes);
    assert.equal(blocked.status, 429, 'Restoration cannot bypass the account transfer concurrency gate');
  } finally { await rows('DELETE FROM upload_reservations WHERE id = ?', [transfer]); }
  await assert.rejects(withMediaTransferBudget(userId, async () => { throw new Error('Test interruption'); }), /Test interruption/);
  assert.equal((await rows("SELECT COUNT(*) AS total FROM upload_reservations WHERE kind = 'transfer' AND user_id = ?", [userId]))[0].total, 0);
  const storage = config.authorStorageBytes, output = config.maxProcessedBytes;
  const before = Number((await rows('SELECT COUNT(*) AS count FROM assets WHERE user_id = ?', [userId]))[0].count);
  try {
    config.authorStorageBytes = 1;
    assert.equal((await mutate('post', '/api/assets').attach('audio', fixture)).status, 413);
    config.authorStorageBytes = storage;
    config.maxProcessedBytes = 10000;
    assert.equal((await mutate('post', '/api/assets').attach('audio', fixture)).status, 413);
  } finally { config.authorStorageBytes = storage; config.maxProcessedBytes = output; }
  assert.equal(Number((await rows('SELECT COUNT(*) AS count FROM assets WHERE user_id = ?', [userId]))[0].count), before);
  assert.equal(Number((await rows('SELECT COUNT(*) AS count FROM upload_reservations WHERE user_id = ?', [userId]))[0].count), 0);
  const episodes = [];
  try {
    for (let index = 0; index < 4; index++) {
      const created = (await mutate('post', '/api/episodes')).body;
      const saved = await mutate('put', `/api/episodes/${created.id}`).send({ ...created, arrangement });
      assert.equal(saved.status, 200); episodes.push(created.id);
    }
    const renders = await Promise.all(episodes.map(id => mutate('post', `/api/episodes/${id}/render`)));
    assert.equal(renders.filter(response => response.status === 202).length, 3);
    assert.equal(renders.filter(response => response.status === 429).length, 1);
  } finally { for (const id of episodes) await mutate('delete', `/api/episodes/${id}`); }
  console.log('PASS: Cross-request upload concurrency limits, global processing capacity, account quotas, processed-file bounds, and reservation cleanup.');
}
