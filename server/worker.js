import path from 'node:path';
import { mkdir, rm, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { db, rows, transaction, json } from './db.js';
import { config } from './config.js';
import { run, probe, buildMix } from './audio.js';
import { prepareWorkerSource, uploadWorkerOutput } from './worker-media.js';

export async function claimJob() {
  return transaction(async connection => {
    const query = (sql, values = []) => rows(sql, values, connection);
    await query("UPDATE render_jobs SET state = 'failed', error = 'Rendering was interrupted repeatedly. Please retry.' WHERE state = 'running' AND lease_until < UTC_TIMESTAMP() AND attempts >= 3");
    const [job] = await query(`SELECT j.*, e.user_id FROM render_jobs j JOIN episodes e ON e.id = j.episode_id
      WHERE (j.state = 'queued' OR (j.state = 'running' AND j.lease_until < UTC_TIMESTAMP())) AND j.attempts < 3
      ORDER BY j.created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
    if (!job) return null;
    const lease = randomUUID();
    await query("UPDATE render_jobs SET state = 'running', attempts = attempts + 1, lease_token = ?, lease_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 MINUTE), error = NULL WHERE id = ?", [lease, job.id]);
    return { ...job, lease_token: lease };
  });
}

export async function processJob(job) {
  const heartbeat = setInterval(() => {
    rows("UPDATE render_jobs SET lease_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 MINUTE) WHERE id = ? AND lease_token = ? AND state = 'running'", [job.id, job.lease_token]).catch(error => console.error('Worker heartbeat failed:', error.code));
  }, 30000);
  const tempDir = path.join(config.mediaDir, 'work', `${job.id}-${job.lease_token}`);
  const key = `exports/${job.id}-${job.lease_token}.mp3`;
  try {
    await mkdir(tempDir, { recursive: true });
    await mkdir(path.join(config.mediaDir, 'exports'), { recursive: true });
    const { arrangement } = json(job.snapshot);
    const ids = [...new Set([...arrangement.segments.map(s => s.assetId), arrangement.music.assetId].filter(Boolean))];
    const inputs = [], indexes = new Map();
    for (const id of ids) {
      const [asset] = await rows('SELECT * FROM assets WHERE id = ? AND user_id = ?', [id, job.user_id]);
      if (!asset) throw new Error('Missing source asset');
      indexes.set(id, indexes.size);
      if (id === arrangement.music.assetId) inputs.push('-stream_loop', '-1');
      inputs.push('-i', await prepareWorkerSource(asset, job));
    }
    const graph = buildMix(arrangement, indexes);
    // Use two-pass EBU R128 measurement to normalize the actual mix, not an RMS approximation.
    const measure = await run(config.ffmpeg, ['-hide_banner', ...inputs, '-filter_complex', [...graph, '[mixed]loudnorm=I=-16:TP=-1:LRA=11:print_format=json[out]'].join(';'), '-map', '[out]', '-f', 'null', '-']);
    const match = measure.stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
    const loudness = match ? JSON.parse(match[0]) : null;
    const finite = loudness && ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'].every(k => Number.isFinite(Number(loudness[k])));
    const normalizer = finite ? `loudnorm=I=-16:TP=-1:LRA=11:measured_I=${loudness.input_i}:measured_TP=${loudness.input_tp}:measured_LRA=${loudness.input_lra}:measured_thresh=${loudness.input_thresh}:offset=${loudness.target_offset}:linear=true` : 'loudnorm=I=-16:TP=-1:LRA=11';
    const output = path.join(tempDir, 'episode.mp3');
    await run(config.ffmpeg, ['-hide_banner', '-y', ...inputs, '-filter_complex', [...graph, `[mixed]${normalizer}[out]`].join(';'), '-map', '[out]', '-ar', '44100', '-ac', '2', '-codec:a', 'libmp3lame', '-b:a', '128k', output]);
    const duration = await probe(output);
    const { stat } = await import('node:fs/promises');
    const { size } = await stat(output);
    await rename(output, path.join(config.mediaDir, key));
    // A remote studio must be able to play the export before it sees "ready".
    await uploadWorkerOutput(job, key, size);
    const result = await rows("UPDATE render_jobs SET state = 'ready', output_key = ?, bytes = ?, duration = ?, lease_until = NULL WHERE id = ? AND lease_token = ? AND state = 'running'", [key, size, duration, job.id, job.lease_token]);
    if (!result.affectedRows) await rm(path.join(config.mediaDir, key), { force: true });
  } catch (error) {
    console.error(`Render ${job.id} failed:`, error.message);
    const message = error.publicMessage || (error.code === 'ENOENT'
      ? 'Audio tools are unavailable on the render worker. Configure FFmpeg and ffprobe, then retry.'
      : 'Audio could not be rendered. Check the sources and retry; contact the administrator if it repeats.');
    await rows("UPDATE render_jobs SET state = 'failed', error = ?, lease_until = NULL WHERE id = ? AND lease_token = ?", [message, job.id, job.lease_token]);
  } finally {
    clearInterval(heartbeat);
    await rm(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let stopping = false;
  process.on('SIGTERM', () => { stopping = true; });
  process.on('SIGINT', () => { stopping = true; });
  console.log('Solo audio worker ready.');
  while (!stopping) {
    try { const job = await claimJob(); if (job) await processJob(job); else await delay(2000); }
    catch (error) { console.error('Worker database error:', error.code || error.message); await delay(5000); }
  }
  await db.end();
}
