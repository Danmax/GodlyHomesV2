import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'node:path';
import { mkdir, unlink, stat } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rows, transaction, json } from './db.js';
import { config } from './config.js';
import { authenticate, cookieOptions, digest, verifyPassword } from './auth.js';
import { episodeSchema, validateAssets } from './validation.js';
import { probe, run } from './audio.js';
import { feed } from './feed.js';
import { receiveMedia, requireMediaFile, syncEpisodeMedia, mediaFile } from './media.js';
import { publicWebsite, websiteAdmin, publicImage } from './website.js';
import { workerMedia } from './worker-media.js';
import { createCommerce } from './commerce.js';

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const publicQuery = `SELECT p.*, j.bytes, j.duration FROM publications p JOIN render_jobs j ON j.id = p.job_id`;
const mapEpisode = e => ({ id: e.id, title: e.title, description: e.description, number: e.episode_number, version: e.version, arrangement: json(e.arrangement), updatedAt: e.updated_at });
const mapAsset = a => ({ id: a.id, name: a.filename, duration: a.duration, bytes: Number(a.bytes), url: `/api/assets/${a.id}/audio` });
const mapJob = j => ({ id: j.id, revision: j.revision, state: j.state, error: j.error, createdAt: j.created_at, duration: j.duration, url: j.state === 'ready' ? `/api/jobs/${j.id}/audio` : null });
async function audioPath(key, bytes) {
  try { return await requireMediaFile(key, bytes); }
  catch (error) { if (error.status === 409) throw failure('The audio file is not stored on this server.', 404); throw error; }
}

export async function createApp({ serveStatic = true, stripeClient, commerceSettings } = {}) {
  await mkdir(path.join(config.mediaDir, 'uploads'), { recursive: true });
  await mkdir(path.join(config.mediaDir, 'exports'), { recursive: true });
  const app = express();
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'https:'],
    mediaSrc: ["'self'", 'blob:'], connectSrc: ["'self'"], upgradeInsecureRequests: config.production ? [] : null,
  } } }));
  const commerce = createCommerce({ stripeClient, settings: commerceSettings });
  // Signature verification requires the untouched body. Stripe cannot send a
  // browser Origin or studio CSRF token; only this signed endpoint bypasses them.
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), commerce.webhook);
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.origin) {
      return res.status(403).json({ error: 'Request origin is not allowed.' });
    }
    next();
  });
  app.get('/api/health', asyncRoute(async (_req, res) => {
    await rows('SELECT 1'); res.json({ ok: true });
  }));
  app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false }), asyncRoute(async (req, res) => {
    const input = z.object({ email: z.email().max(254), password: z.string().min(1).max(200) }).parse(req.body);
    const [user] = await rows('SELECT * FROM users WHERE email = ?', [input.email.toLowerCase().trim()]);
    // Run scrypt even for unknown emails to avoid a fast email-enumeration path.
    const valid = await verifyPassword(input.password, user?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if (!user || !valid) throw failure('Email or password is incorrect.', 401);
    const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
    await rows('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()');
    await rows('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))', [digest(token), user.id, csrf]);
    res.cookie('gh_session', token, cookieOptions()).json({ user: { id: user.id, email: user.email, role: user.role }, csrf });
  }));
  app.get('/api/public/website', asyncRoute(async (_req, res) => res.json(await publicWebsite())));
  app.get('/images/:file', publicImage);
  app.get('/api/public/episodes', asyncRoute(async (_req, res) => {
    const episodes = await rows(`${publicQuery} ORDER BY p.published_at DESC`);
    res.json(episodes.map(e => ({ id: e.episode_id, title: e.title, description: e.description, number: e.episode_number, duration: e.duration, publishedAt: e.published_at, url: `/media/${e.episode_id}/${e.job_id}.mp3` })));
  }));
  app.get('/podcast/feed.xml', asyncRoute(async (_req, res) => {
    res.type('application/rss+xml').send(feed(await rows(`${publicQuery} ORDER BY p.published_at DESC`), config.origin));
  }));
  app.get('/media/:episodeId/:file', asyncRoute(async (req, res) => {
    const [publication] = await rows(`${publicQuery} WHERE p.episode_id = ?`, [req.params.episodeId]);
    if (!publication || req.params.file !== `${publication.job_id}.mp3`) throw failure('Episode audio not found.', 404);
    const [job] = await rows('SELECT output_key FROM render_jobs WHERE id = ?', [publication.job_id]);
    const file = await audioPath(job.output_key, publication.bytes);
    res.type('audio/mpeg').set('Cache-Control', 'public, max-age=3600').sendFile(file);
  }));
  app.post('/api/subscribe', rateLimit({ windowMs: 3600000, limit: 10, legacyHeaders: false }), asyncRoute(async (req, res) => {
    const { email, consent } = z.object({ email: z.email().max(254), consent: z.literal(true) }).parse(req.body);
    await rows('INSERT IGNORE INTO subscribers (email) VALUES (?)', [email.toLowerCase().trim()]);
    res.json({ message: 'You’re on the list. Thank you for joining us.' });
  }));

  app.use('/api/worker', workerMedia);
  app.use('/api/store', commerce.publicRoutes);
  app.use('/api', asyncRoute(authenticate));
  app.use('/api/admin/commerce', commerce.adminRoutes);
  app.use('/api/admin', websiteAdmin);
  app.get('/api/auth/me', (req, res) => res.json({ user: req.user, csrf: req.csrf }));
  app.post('/api/auth/logout', asyncRoute(async (req, res) => {
    await rows('DELETE FROM sessions WHERE user_id = ? AND csrf_token = ?', [req.user.id, req.csrf]);
    res.clearCookie('gh_session', { ...cookieOptions(), maxAge: undefined }).json({ ok: true });
  }));
  app.get('/api/episodes', asyncRoute(async (req, res) => {
    const episodes = await rows('SELECT * FROM episodes WHERE user_id = ? ORDER BY updated_at DESC', [req.user.id]);
    const published = await rows('SELECT p.episode_id, p.job_id FROM publications p JOIN episodes e ON e.id = p.episode_id WHERE e.user_id = ?', [req.user.id]);
    res.json(episodes.map(e => ({ ...mapEpisode(e), publication: published.find(p => p.episode_id === e.id) || null })));
  }));
  app.post('/api/episodes', asyncRoute(async (req, res) => {
    const id = randomUUID();
    const arrangement = { segments: [], music: { assetId: null, volume: 0.2, duck: true } };
    await rows('INSERT INTO episodes (id, user_id, title, description, arrangement) VALUES (?, ?, ?, ?, ?)', [id, req.user.id, 'Untitled episode', '', JSON.stringify(arrangement)]);
    const [episode] = await rows('SELECT * FROM episodes WHERE id = ?', [id]);
    res.status(201).json(mapEpisode(episode));
  }));
  app.delete('/api/episodes/:id', asyncRoute(async (req, res) => {
    const outputs = await transaction(async connection => {
      const query = (sql, values) => rows(sql, values, connection);
      const [episode] = await query('SELECT id FROM episodes WHERE id = ? AND user_id = ? FOR UPDATE', [req.params.id, req.user.id]);
      if (!episode) throw failure('Episode not found.', 404);
      const jobs = await query('SELECT output_key FROM render_jobs WHERE episode_id = ? FOR UPDATE', [episode.id]);
      await query('DELETE FROM publications WHERE episode_id = ?', [episode.id]);
      await query('DELETE FROM render_jobs WHERE episode_id = ?', [episode.id]);
      await query('DELETE FROM episodes WHERE id = ?', [episode.id]);
      return jobs.map(job => job.output_key).filter(Boolean);
    });
    // Originals may be shared by other episodes. Only remove this episode's
    // exports from this server; running workers discard results for deleted jobs.
    for (const key of outputs) {
      try { await unlink(mediaFile(key)); }
      catch (error) { if (error.code !== 'ENOENT') console.error('Could not remove deleted episode export:', error.code || error.message); }
    }
    res.json({ ok: true });
  }));
  app.put('/api/episodes/:id', asyncRoute(async (req, res) => {
    const input = episodeSchema.parse(req.body);
    await validateAssets(input.arrangement, req.user.id, rows);
    const result = await rows(`UPDATE episodes SET title = ?, description = ?, episode_number = ?, arrangement = ?, version = version + 1
      WHERE id = ? AND user_id = ? AND version = ?`, [input.title, input.description, input.number, JSON.stringify(input.arrangement), req.params.id, req.user.id, input.version]);
    if (!result.affectedRows) throw failure('This draft changed in another tab. Reload before editing again.', 409);
    const [episode] = await rows('SELECT * FROM episodes WHERE id = ?', [req.params.id]);
    res.json(mapEpisode(episode));
  }));
  app.get('/api/assets', asyncRoute(async (req, res) => res.json((await rows('SELECT * FROM assets WHERE user_id = ? ORDER BY created_at DESC', [req.user.id])).map(mapAsset))));
  const upload = multer({ dest: path.join(config.mediaDir, 'uploads'), limits: { fileSize: config.maxBytes, files: 1, fields: 1 } });
  app.post('/api/assets', upload.single('audio'), asyncRoute(async (req, res) => {
    const file = req.file;
    if (!file) throw failure('Choose an audio file.');
    let stored;
    try {
      const id = randomUUID();
      const storageKey = `uploads/${id}.flac`;
      stored = path.join(config.mediaDir, storageKey);
      // Canonical lossless audio gives streaming WebM recordings a seekable duration,
      // strips non-audio streams, and keeps source playback consistent across browsers.
      await run(config.ffmpeg, ['-hide_banner', '-y', '-i', file.path, '-map', '0:a:0', '-vn', '-t', '7201', '-ar', '44100', '-ac', '2', '-codec:a', 'flac', stored], 10 * 60 * 1000);
      const duration = await probe(stored);
      const { size } = await stat(stored);
      const filename = file.originalname.replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'Recording';
      await rows('INSERT INTO assets (id, user_id, filename, storage_key, mime, bytes, duration) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, req.user.id, filename, storageKey, 'audio/flac', size, duration]);
      res.status(201).json({ id, name: filename, duration, bytes: size, url: `/api/assets/${id}/audio` });
    } catch (error) {
      if (stored) await unlink(stored).catch(() => {});
      if (error.code === 'ENOENT') throw failure('Audio tools are unavailable. Ask the administrator to configure FFmpeg and ffprobe.', 503);
      if (!error.status) throw failure('This audio could not be read. Choose a valid WAV, MP3, M4A, OGG, FLAC or WebM recording.');
      throw error;
    } finally { await unlink(file.path).catch(() => {}); }
  }));
  app.get('/api/assets/:id/audio', asyncRoute(async (req, res) => {
    const [asset] = await rows('SELECT * FROM assets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!asset) throw failure('Audio source not found.', 404);
    const file = await audioPath(asset.storage_key, asset.bytes);
    res.type(asset.mime).set('Content-Disposition', 'inline').sendFile(file);
  }));
  app.put('/api/assets/:id/audio', asyncRoute(async (req, res) => {
    const [asset] = await rows('SELECT * FROM assets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!asset) throw failure('Audio source not found.', 404);
    await receiveMedia(req, asset.storage_key, asset.bytes);
    res.json({ ok: true });
  }));
  app.get('/api/episodes/:id/jobs', asyncRoute(async (req, res) => {
    const jobs = await rows('SELECT j.* FROM render_jobs j JOIN episodes e ON e.id = j.episode_id WHERE e.id = ? AND e.user_id = ? ORDER BY j.created_at DESC', [req.params.id, req.user.id]);
    res.json(jobs.map(mapJob));
  }));
  app.post('/api/episodes/:id/render', asyncRoute(async (req, res) => {
    const result = await transaction(async connection => {
      const query = (sql, values) => rows(sql, values, connection);
      const [episode] = await query('SELECT * FROM episodes WHERE id = ? AND user_id = ? FOR UPDATE', [req.params.id, req.user.id]);
      if (!episode) throw failure('Episode not found.', 404);
      const arrangement = json(episode.arrangement);
      if (!arrangement.segments.length) throw failure('Add at least one take before rendering.');
      await validateAssets(arrangement, req.user.id, query);
      const [existing] = await query('SELECT * FROM render_jobs WHERE episode_id = ? AND revision = ?', [episode.id, episode.version]);
      if (existing && existing.state !== 'failed') return existing;
      if (existing) {
        await query("UPDATE render_jobs SET state = 'queued', attempts = 0, error = NULL WHERE id = ?", [existing.id]);
        return { ...existing, state: 'queued', error: null };
      }
      const id = randomUUID();
      await query('INSERT INTO render_jobs (id, episode_id, revision, snapshot) VALUES (?, ?, ?, ?)', [id, episode.id, episode.version, JSON.stringify(mapEpisode(episode))]);
      return { id, revision: episode.version, state: 'queued' };
    });
    res.status(202).json(mapJob(result));
  }));
  app.get('/api/jobs/:id/audio', asyncRoute(async (req, res) => {
    const [job] = await rows("SELECT j.* FROM render_jobs j JOIN episodes e ON e.id = j.episode_id WHERE j.id = ? AND e.user_id = ? AND j.state = 'ready'", [req.params.id, req.user.id]);
    if (!job) throw failure('Rendered audio is not available.', 404);
    const file = await audioPath(job.output_key, job.bytes);
    res.type('audio/mpeg').sendFile(file);
  }));
  app.put('/api/jobs/:id/audio', asyncRoute(async (req, res) => {
    const [job] = await rows("SELECT j.* FROM render_jobs j JOIN episodes e ON e.id = j.episode_id WHERE j.id = ? AND e.user_id = ? AND j.state = 'ready'", [req.params.id, req.user.id]);
    if (!job) throw failure('Rendered audio is not available.', 404);
    await receiveMedia(req, job.output_key, job.bytes);
    res.json({ ok: true });
  }));
  app.post('/api/episodes/:id/publish', asyncRoute(async (req, res) => {
    const { jobId } = z.object({ jobId: z.uuid() }).parse(req.body);
    const [prepared] = await rows("SELECT j.*, e.version AS current_version FROM render_jobs j JOIN episodes e ON e.id = j.episode_id WHERE j.id = ? AND e.id = ? AND e.user_id = ? AND j.state = 'ready'", [jobId, req.params.id, req.user.id]);
    if (!prepared) throw failure('Review a completed render before publishing.');
    if (prepared.revision !== prepared.current_version) throw failure('This draft has changed. Render and review its current version first.', 409);
    await requireMediaFile(prepared.output_key, prepared.bytes);
    if (config.remoteMediaOrigin) {
      const arrangement = json(prepared.snapshot).arrangement;
      const ids = [...new Set([...arrangement.segments.map(s => s.assetId), arrangement.music.assetId].filter(Boolean))];
      const assets = [];
      for (const id of ids) {
        const [asset] = await rows('SELECT * FROM assets WHERE id = ? AND user_id = ?', [id, req.user.id]);
        if (!asset) throw failure('An audio source is unavailable.');
        assets.push(asset);
      }
      await syncEpisodeMedia({ job: prepared, assets, origin: config.remoteMediaOrigin, cookie: req.headers.cookie, csrf: req.csrf });
    }
    await transaction(async connection => {
      const query = (sql, values) => rows(sql, values, connection);
      const [episode] = await query('SELECT * FROM episodes WHERE id = ? AND user_id = ? FOR UPDATE', [req.params.id, req.user.id]);
      if (!episode) throw failure('Episode not found.', 404);
      const [job] = await query("SELECT * FROM render_jobs WHERE id = ? AND episode_id = ? AND state = 'ready'", [jobId, episode.id]);
      if (!job) throw failure('Review a completed render before publishing.');
      if (job.revision !== episode.version) throw failure('This draft has changed. Render and review its current version first.', 409);
      await requireMediaFile(job.output_key, job.bytes);
      const snapshot = json(job.snapshot);
      await query(`INSERT INTO publications (episode_id, job_id, title, description, episode_number) VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE job_id = VALUES(job_id), title = VALUES(title), description = VALUES(description), episode_number = VALUES(episode_number)`, [episode.id, job.id, snapshot.title, snapshot.description, snapshot.number]);
    });
    res.json({ ok: true });
  }));
  app.post('/api/episodes/:id/unpublish', asyncRoute(async (req, res) => {
    await rows('DELETE p FROM publications p JOIN episodes e ON e.id = p.episode_id WHERE e.id = ? AND e.user_id = ?', [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  if (serveStatic) {
    app.use(express.static(path.resolve('dist')));
    app.get(['/', '/about', '/resources', '/resources/:slug', '/store', '/store/:slug', '/checkout', '/admin', '/studio', '/podcast/:id'], (_req, res) => res.sendFile(path.resolve('dist/index.html')));
  }
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.code === 'ENOENT') return res.status(404).type('json').json({ error: 'The audio file is not stored on this server.' });
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message || 'Check your input.' });
    if (error instanceof multer.MulterError) return res.status(400).json({ error: 'Choose one audio file smaller than 512 MB.' });
    const status = error.status || 500;
    if (status >= 500) console.error('Request failed:', error.code || error.message);
    res.status(status).json({ error: status >= 500 ? (error.status ? error.message : 'The server could not complete the request. Please try again.') : error.message });
  });
  return app;
}
