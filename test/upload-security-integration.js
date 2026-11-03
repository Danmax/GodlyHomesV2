import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reserveUpload } from '../server/upload-budget.js';
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
