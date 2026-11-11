import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink, link } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function mediaFile(key, root = config.mediaDir) {
  if (typeof key !== 'string' || !/^(uploads\/[a-f0-9-]+\.flac|exports\/[a-f0-9-]+\.mp3)$/.test(key)) {
    throw fail('Audio storage key is invalid.', 500);
  }
  return path.join(root, key);
}

export async function requireMediaFile(key, expectedBytes) {
  const file = mediaFile(key);
  const details = await stat(file).catch(error => {
    if (error.code === 'ENOENT') throw fail('Audio is missing from this server. Restore its media files before publishing.', 409);
    throw error;
  });
  if (!details.isFile() || details.size !== Number(expectedBytes)) throw fail('Audio is incomplete on this server. Restore it before publishing.', 409);
  return file;
}

export async function checksum(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// The caller authenticates ownership and looks up the immutable key and size.
// A transfer can restore a missing file, but can never replace an existing file.
export async function receiveMedia(req, key, expectedBytes) {
  const expectedHash = req.headers['x-content-sha256'];
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) throw fail('A SHA-256 checksum is required.');
  const bytes = Number(expectedBytes);
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > config.maxBytes) throw fail('Audio file size is invalid.');
  const destination = mediaFile(key);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.incoming-${randomUUID()}`;
  const hash = createHash('sha256');
  let received = 0, signature = Buffer.alloc(0);
  const inspect = new Transform({ transform(chunk, _encoding, callback) {
    received += chunk.length;
    if (received > bytes) return callback(fail('Audio transfer exceeds the expected file size.'));
    if (signature.length < 4) signature = Buffer.concat([signature, chunk.subarray(0, 4 - signature.length)]);
    hash.update(chunk); callback(null, chunk);
  } });
  try {
    await pipeline(req, inspect, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    if (received !== bytes || hash.digest('hex') !== expectedHash) throw fail('Audio transfer failed its size or checksum check.');
    const valid = key.endsWith('.flac') ? signature.toString() === 'fLaC' : signature.subarray(0, 3).toString() === 'ID3' || (signature[0] === 0xff && (signature[1] & 0xe0) === 0xe0);
    if (!valid) throw fail('The transferred file is not the expected audio format.');
    try { await link(temporary, destination); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const details = await stat(destination);
      if (details.size !== bytes || await checksum(destination) !== expectedHash) throw fail('A different audio file already exists. It has not been overwritten.', 409);
    }
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function syncEpisodeMedia({ job, assets, origin, cookie, csrf }) {
  const remote = new URL(origin);
  if (remote.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(remote.hostname)) throw fail('Remote media transfers require HTTPS.', 500);
  const files = [...assets.map(asset => ({ key: asset.storage_key, bytes: asset.bytes, endpoint: `/api/assets/${asset.id}/audio` })),
    { key: job.output_key, bytes: job.bytes, endpoint: `/api/jobs/${job.id}/audio` }];
  for (const entry of files) {
    const source = await requireMediaFile(entry.key, entry.bytes);
    const target = new URL(entry.endpoint, remote);
    const headers = { Cookie: cookie, Origin: remote.origin, 'X-CSRF-Token': csrf };
    const existing = await fetch(target, { method: 'HEAD', headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (existing.ok && Number(existing.headers.get('content-length')) === Number(entry.bytes)) continue;
    if (![404, 409].includes(existing.status)) throw fail(`Remote audio storage is not accessible (${existing.status}).`, 503);
    const response = await fetch(target, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(entry.bytes), 'X-Content-SHA256': await checksum(source) },
      body: createReadStream(source), duplex: 'half', redirect: 'error', signal: AbortSignal.timeout(115000),
    });
    if (!response.ok) throw fail(`Remote audio transfer failed (${response.status}). The episode has not been published.`, 503);
    await response.body?.cancel();
  }
}
