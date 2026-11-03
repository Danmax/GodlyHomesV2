import express from 'express';
import { Readable } from 'node:stream';
import { rows, json } from './db.js';
import { config } from './config.js';
import { checksum, receiveMedia, requireMediaFile } from './media.js';

const route = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const transferError = (message, publicMessage) => Object.assign(new Error(message), { publicMessage });

// The current, unexpired render lease is a short-lived capability. It is never
// exposed in studio API responses and grants access only to this job's media.
const leaseAccess = route(async (req, _res, next) => {
  const token = req.headers.authorization?.match(/^Bearer ([a-f0-9-]{36})$/)?.[1];
  if (!token) throw fail('A valid worker lease is required.', 401);
  const [job] = await rows(`SELECT j.*, e.user_id FROM render_jobs j JOIN episodes e ON e.id = j.episode_id
    WHERE j.id = ? AND j.state = 'running' AND j.lease_token = ? AND j.lease_until > UTC_TIMESTAMP()`, [req.params.id, token]);
  if (!job) throw fail('This worker lease is unavailable or expired.', 401);
  req.renderJob = job; next();
});

export const workerMedia = express.Router();
workerMedia.get('/jobs/:id/assets/:assetId', leaseAccess, route(async (req, res) => {
  const job = req.renderJob, arrangement = json(job.snapshot).arrangement;
  const ids = new Set([...arrangement.segments.map(segment => segment.assetId), arrangement.music.assetId].filter(Boolean));
  if (!ids.has(req.params.assetId)) throw fail('This recording does not belong to the render job.', 404);
  const [asset] = await rows('SELECT * FROM assets WHERE id = ? AND user_id = ?', [req.params.assetId, job.user_id]);
  if (!asset) throw fail('Source recording not found.', 404);
  let file;
  try { file = await requireMediaFile(asset.storage_key, asset.bytes); }
  catch (error) { if (error.status === 409) throw fail('The source recording is missing or incomplete on the media server.', 404); throw error; }
  res.set('X-Content-SHA256', await checksum(file)).type('audio/flac').sendFile(file);
}));
workerMedia.put('/jobs/:id/audio', leaseAccess, route(async (req, res) => {
  const bytes = Number(req.headers['content-length']);
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > config.maxBytes) throw fail('The rendered audio file size is invalid.');
  const job = req.renderJob;
  await receiveMedia(req, `exports/${job.id}-${job.lease_token}.mp3`, bytes);
  res.json({ ok: true });
}));

function remoteOrigin() {
  if (!config.remoteMediaOrigin) return null;
  const remote = new URL(config.remoteMediaOrigin);
  if (remote.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(remote.hostname)) throw new Error('Worker media transfers require HTTPS.');
  return remote.origin;
}

export async function prepareWorkerSource(asset, job) {
  try { return await requireMediaFile(asset.storage_key, asset.bytes); }
  catch (error) { if (error.status !== 409) throw error; }
  const origin = remoteOrigin();
  if (!origin) throw transferError('Source file is not available on this worker.', 'A source recording is missing from the render worker. Configure its media server or restore the recording, then retry.');
  const publicMessage = 'The worker could not retrieve a source recording from the media server. Check the connection and retry; restore the recording if it is missing.';
  try {
    const response = await fetch(new URL(`/api/worker/jobs/${job.id}/assets/${asset.id}`, origin), {
      headers: { Authorization: `Bearer ${job.lease_token}` }, redirect: 'error', signal: AbortSignal.timeout(115000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Source transfer returned HTTP ${response.status}.`); }
    if (Number(response.headers.get('content-length')) !== Number(asset.bytes)) { await response.body?.cancel(); throw new Error('Source transfer size does not match its metadata.'); }
    const input = Readable.fromWeb(response.body);
    input.headers = { 'x-content-sha256': response.headers.get('x-content-sha256') };
    await receiveMedia(input, asset.storage_key, asset.bytes);
    return await requireMediaFile(asset.storage_key, asset.bytes);
  } catch (error) { throw transferError(error.message, publicMessage); }
}

export async function uploadWorkerOutput(job, key, bytes) {
  const origin = remoteOrigin(); if (!origin) return;
  const file = await requireMediaFile(key, bytes);
  const { createReadStream } = await import('node:fs');
  try {
    const response = await fetch(new URL(`/api/worker/jobs/${job.id}/audio`, origin), {
      method: 'PUT', headers: { Authorization: `Bearer ${job.lease_token}`, Origin: origin,
        'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes), 'X-Content-SHA256': await checksum(file) },
      body: createReadStream(file), duplex: 'half', redirect: 'error', signal: AbortSignal.timeout(115000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Render upload returned HTTP ${response.status}.`); }
    await response.body?.cancel();
  } catch (error) { throw transferError(error.message, 'The audio was rendered but could not be delivered to the media server. Check the connection and retry.'); }
}
