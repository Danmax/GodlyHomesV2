import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { rows, transaction } from './db.js';
import { config } from './config.js';

const fail = (message, status = 429) => Object.assign(new Error(message), { status });
export const audioUploadLimit = () => rateLimit({ windowMs: 3600000, limit: 12, keyGenerator: req => req.user.id, standardHeaders: 'draft-8', legacyHeaders: false });
export const imageUploadLimit = () => rateLimit({ windowMs: 3600000, limit: 30, keyGenerator: req => req.user.id, standardHeaders: 'draft-8', legacyHeaders: false });
export async function storageUsed(userId, connection) {
  const [usage] = await rows(`SELECT
    (SELECT COALESCE(SUM(bytes), 0) FROM assets WHERE user_id = ?) +
    (SELECT COALESCE(SUM(bytes), 0) FROM image_uploads WHERE user_id = ?) +
    (SELECT COALESCE(SUM(j.bytes), 0) FROM render_jobs j JOIN episodes e ON e.id = j.episode_id WHERE e.user_id = ? AND j.state = 'ready') +
    (SELECT COUNT(*) FROM render_jobs j JOIN episodes e ON e.id = j.episode_id WHERE e.user_id = ? AND j.state IN ('queued', 'running')) * ? +
    (SELECT COALESCE(SUM(bytes), 0) FROM upload_reservations WHERE user_id = ? AND expires_at > UTC_TIMESTAMP()) AS bytes`,
  [userId, userId, userId, userId, config.maxProcessedBytes, userId], connection);
  return Number(usage.bytes);
}
export async function reserveUpload(userId, kind) {
  const id = randomUUID(), bytes = kind === 'transfer' ? 0 : kind === 'audio' ? config.maxBytes + config.maxProcessedBytes : 5 * 1024 * 1024;
  await transaction(async connection => {
    await rows('SELECT id FROM upload_gate WHERE id = 1 FOR UPDATE', [], connection);
    await rows('DELETE FROM upload_reservations WHERE expires_at <= UTC_TIMESTAMP()', [], connection);
    const [active] = await rows('SELECT COUNT(*) AS total, COALESCE(SUM(user_id = ?), 0) AS own FROM upload_reservations WHERE kind = ?', [userId, kind], connection);
    if (Number(active.own) >= 1) throw fail('An upload is already being processed for your account. Wait for it to finish.');
    if (Number(active.total) >= (kind !== 'image' ? config.maxConcurrentAudioUploads : config.maxConcurrentImageUploads)) throw fail('The upload service is busy. Please retry shortly.');
    if (await storageUsed(userId, connection) + bytes > config.authorStorageBytes) throw fail('Your account storage limit has been reached. Contact the administrator.', 413);
    await rows('INSERT INTO upload_reservations (id, user_id, kind, bytes, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 20 MINUTE))', [id, userId, kind, bytes], connection);
  });
  return id;
}

// Keep the reservation through conversion, even if the browser disconnects.
export function guardedUpload(kind, upload, handler) {
  return (req, res, next) => {
    let reservation;
    Promise.resolve().then(async () => {
      const forwardedImage = kind === 'image' && config.remoteMediaOrigin && config.remoteMediaOrigin !== config.origin && req.hostname !== new URL(config.remoteMediaOrigin).hostname;
      if (!forwardedImage) reservation = await reserveUpload(req.user.id, kind);
      await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
      await handler(req, res);
    }).finally(async () => {
      if (reservation) await rows('DELETE FROM upload_reservations WHERE id = ?', [reservation]).catch(error => console.error('Upload reservation cleanup failed:', error.code));
    }).catch(next);
  };
}

// Restored files already count toward account storage through their immutable
// metadata. Reserve concurrency without charging their bytes a second time.
export async function withMediaTransferBudget(userId, task) {
  const id = await reserveUpload(userId, 'transfer');
  try { return await task(); }
  finally { await rows('DELETE FROM upload_reservations WHERE id = ?', [id]); }
}
