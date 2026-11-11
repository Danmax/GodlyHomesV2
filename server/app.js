import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'node:path';
import { mkdir, unlink, stat } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { memberAccess, userAdmin } from './users.js';
import { rows, transaction, json } from './db.js';
import { accountRoutes } from './account.js';
import { createMailer } from './email.js';
import { createNewsletterClient, requestNewsletterConfirmation, confirmNewsletter } from './newsletter.js';
import { createNewsletterMarketing } from './newsletter-marketing.js';
import { newsletterStudio } from './newsletter-studio.js';
import { config } from './config.js';
import { authenticate, cookieOptions, digest, hashPassword, verifyPassword, requireAdmin, requireStaff } from './auth.js';
import { episodeSchema, validateAssets } from './validation.js';
import { probe, run, importInputOptions } from './audio.js';
import { feed } from './feed.js';
import { receiveMedia, requireMediaFile, syncEpisodeMedia, mediaFile } from './media.js';
import { publicWebsite, websiteAdmin, publicImage, imageRoutes } from './website.js';
import { channelRoutes, publicChannels, channelSlug, channelSummary, seriesSummary, checkSeriesOwner } from './channels.js';
import { workerMedia } from './worker-media.js';
import { createCommerce } from './commerce.js';
import { audioUploadLimit, guardedUpload, storageUsed, withMediaTransferBudget } from './upload-budget.js';
import { studioTools } from './studio-tools.js';

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const publicQuery = `SELECT p.*, j.bytes, j.duration, c.slug AS channel_slug, c.data AS channel_data, s.slug AS series_slug, s.data AS series_data
  FROM publications p JOIN episodes e ON e.id = p.episode_id AND e.admin_hidden = FALSE
  LEFT JOIN podcast_channels c ON c.user_id = e.user_id
  LEFT JOIN podcast_series s ON s.id = p.series_id AND s.user_id = e.user_id
  JOIN render_jobs j ON j.id = p.job_id AND (c.user_id IS NULL OR c.is_public = TRUE)`;
const mapEpisode = e => ({ id: e.id, title: e.title, description: e.description, number: e.episode_number, seriesId: e.series_id || null, version: e.version, arrangement: json(e.arrangement), updatedAt: e.updated_at, adminHidden: Boolean(e.admin_hidden) });
const mapPublicEpisode = e => ({ id: e.episode_id, title: e.title, description: e.description, number: e.episode_number, duration: e.duration, publishedAt: e.published_at, url: `/media/${e.episode_id}/${e.job_id}.mp3`, channel: channelSummary(e), series: seriesSummary(e) });
const mapAsset = a => ({ id: a.id, name: a.filename, duration: a.duration, bytes: Number(a.bytes), url: `/api/assets/${a.id}/audio` });
const mapJob = j => ({ id: j.id, revision: j.revision, state: j.state, error: j.error, createdAt: j.created_at, duration: j.duration, url: j.state === 'ready' ? `/api/jobs/${j.id}/audio` : null });
async function audioPath(key, bytes) {
  try { return await requireMediaFile(key, bytes); }
  catch (error) { if (error.status === 409) throw failure('The audio file is not stored on this server.', 404); throw error; }
}

async function deleteEpisode(id, { ownerId, version } = {}) {
  const outputs = await transaction(async connection => {
    const query = (sql, values) => rows(sql, values, connection);
    const [episode] = await query(`SELECT id, version FROM episodes WHERE id = ?${ownerId ? ' AND user_id = ?' : ''} FOR UPDATE`, ownerId ? [id, ownerId] : [id]);
    if (!episode) throw failure('Episode not found.', 404);
    if (version !== undefined && episode.version !== version) throw failure('This episode changed. Refresh the list before deleting it.', 409);
    const jobs = await query('SELECT output_key FROM render_jobs WHERE episode_id = ? FOR UPDATE', [episode.id]);
    await query('DELETE FROM publications WHERE episode_id = ?', [episode.id]);
    await query('DELETE FROM render_jobs WHERE episode_id = ?', [episode.id]);
    await query('DELETE FROM episodes WHERE id = ?', [episode.id]);
    return jobs.map(job => job.output_key).filter(Boolean);
  });
  // Keep original recordings, which can be shared by other episodes.
  // Running workers discard their results when their job no longer exists.
  for (const key of outputs) {
    try { await unlink(mediaFile(key)); }
    catch (error) { if (error.code !== 'ENOENT') console.error('Could not remove deleted episode export:', error.code || error.message); }
  }
}

export async function createApp({ serveStatic = true, stripeClient, commerceSettings, studioAI, mailer = createMailer(), newsletter = createNewsletterClient(), marketing = createNewsletterMarketing() } = {}) {
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
  app.use('/api/auth', accountRoutes(mailer));
  app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false }), asyncRoute(async (req, res) => {
    const input = z.object({ email: z.email().max(254), password: z.string().min(1).max(200) }).parse(req.body);
    const [user] = await rows('SELECT * FROM users WHERE email = ?', [input.email.toLowerCase().trim()]);
    // Run scrypt even for unknown emails to avoid a fast email-enumeration path.
    const valid = await verifyPassword(input.password, user?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if (!user || !valid || user.disabled_at) throw failure('Email or password is incorrect.', 401);
    if (user.email_verification_required && !user.email_verified_at) throw failure('Verify your email before signing in. Use Resend verification if you need a new link.', 403);
    const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
    await transaction(async connection => {
      const [current] = await rows('SELECT password_hash, disabled_at, access_version FROM users WHERE id = ? FOR UPDATE', [user.id], connection);
      if (!current || current.disabled_at || current.access_version !== user.access_version || current.password_hash !== user.password_hash) throw failure('Email or password is incorrect.', 401);
      await rows('DELETE FROM sessions WHERE user_id = ? AND expires_at <= UTC_TIMESTAMP()', [user.id], connection);
      await rows('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))', [digest(token), user.id, csrf], connection);
    });
    res.cookie('gh_session', token, cookieOptions()).json({ user: { id: user.id, email: user.email, role: user.role }, csrf });
  }));
  app.get('/api/public/website', asyncRoute(async (_req, res) => res.json(await publicWebsite())));
  app.get('/images/:file', publicImage);
  app.use('/api/public/channels', publicChannels);
  app.get('/api/public/episodes', asyncRoute(async (req, res) => {
    const filters = [], values = [];
    if (req.query.channel) { filters.push('c.slug = ?'); values.push(channelSlug.parse(req.query.channel)); }
    if (req.query.series) { filters.push('s.slug = ?'); values.push(channelSlug.parse(req.query.series)); }
    const episodes = await rows(`${publicQuery}${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''} ORDER BY p.published_at DESC`, values);
    res.json(episodes.map(mapPublicEpisode));
  }));
  app.get('/api/public/episodes/:id', asyncRoute(async (req, res) => {
    const [episode] = await rows(`${publicQuery} WHERE p.episode_id = ?`, [z.uuid().parse(req.params.id)]);
    if (!episode) throw failure('This episode is not available.', 404);
    res.json(mapPublicEpisode(episode));
  }));
  app.get(['/channels/:slug/feed.xml', '/channels/:slug/series/:seriesSlug/feed.xml'], asyncRoute(async (req, res) => {
    const [channel] = await rows('SELECT * FROM podcast_channels WHERE slug = ? AND is_public = TRUE', [channelSlug.parse(req.params.slug)]);
    if (!channel) throw failure('Channel not found.', 404);
    let branding = json(channel.data), filter = '', values = [channel.slug];
    if (req.params.seriesSlug) {
      const [series] = await rows('SELECT * FROM podcast_series WHERE user_id = ? AND slug = ?', [channel.user_id, channelSlug.parse(req.params.seriesSlug)]);
      if (!series) throw failure('Series not found.', 404);
      const data = json(series.data);
      filter = ' AND p.series_id = ?'; values.push(series.id);
      branding = { ...branding, title: data.title, description: data.description, coverUrl: data.coverUrl || branding.coverUrl };
    }
    const episodes = await rows(`${publicQuery} WHERE c.slug = ?${filter} ORDER BY p.published_at DESC`, values);
    if (req.params.seriesSlug && !episodes.length) throw failure('Series not found.', 404);
    const homePath = `/channels/${channel.slug}${req.params.seriesSlug ? `/series/${req.params.seriesSlug}` : ''}`;
    res.type('application/rss+xml').send(feed(episodes, config.origin, { ...branding, homePath, feedPath: `${homePath}/feed.xml` }));
  }));
  app.get('/podcast/feed.xml', asyncRoute(async (_req, res) => {
    const [branding] = await rows("SELECT data FROM website_documents WHERE document_key = 'podcast'");
    res.type('application/rss+xml').send(feed(await rows(`${publicQuery} ORDER BY p.published_at DESC`), config.origin, branding ? json(branding.data) : {}));
  }));
  app.get('/media/:episodeId/:file', asyncRoute(async (req, res) => {
    const [publication] = await rows(`${publicQuery} WHERE p.episode_id = ?`, [req.params.episodeId]);
    if (!publication || req.params.file !== `${publication.job_id}.mp3`) throw failure('Episode audio not found.', 404);
    const [job] = await rows('SELECT output_key FROM render_jobs WHERE id = ?', [publication.job_id]);
    const file = await audioPath(job.output_key, publication.bytes);
    res.type('audio/mpeg').set('Cache-Control', 'private, no-cache, max-age=0, must-revalidate').sendFile(file, { cacheControl: false });
  }));
  app.post('/api/subscribe', rateLimit({ windowMs: 3600000, limit: 10, legacyHeaders: false }), asyncRoute(async (req, res) => {
    const { email } = z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)), consent: z.literal(true) }).parse(req.body);
    if (!mailer.ready) throw failure('Newsletter confirmation email is unavailable. Please try again later.', 503);
    await requestNewsletterConfirmation(email, mailer);
    res.json({ message: 'Thanks. If this address needs confirmation, we’ll email a link. Check your inbox and spam folder.' });
  }));
  app.post('/api/newsletter/confirm', rateLimit({ windowMs: 15 * 60000, limit: 30, legacyHeaders: false }), asyncRoute(async (req, res) => {
    const { token } = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(req.body);
    await confirmNewsletter(token, newsletter);
    res.json({ message: 'Your newsletter signup is confirmed. Thank you for joining us.' });
  }));

  app.use('/api/worker', workerMedia);
  app.use('/api/store', commerce.publicRoutes);
  app.use('/api', asyncRoute(authenticate));
  app.use('/api/auth/access', memberAccess);
  app.use('/api/admin/users', userAdmin);
  app.use('/api/admin/newsletters', newsletterStudio({ marketing, mailer, contacts: newsletter }));
  app.use('/api', (req, res, next) => {
    if (req.user.role === 'member' && !['/auth/me', '/auth/password', '/auth/logout'].includes(req.path)) return res.status(403).json({ error: 'Publisher access is required for the studio.' });
    next();
  });
  app.use('/api/channel', imageRoutes, channelRoutes);
  app.use('/api/admin/commerce', commerce.adminRoutes);
  app.use('/api/admin', websiteAdmin);
  app.get('/api/admin/episodes', requireStaff, asyncRoute(async (_req, res) => {
    const episodes = await rows(`SELECT e.id, e.title, e.version, e.admin_hidden, e.updated_at, u.email, c.slug AS channel_slug, c.data AS channel_data, c.is_public,
      p.job_id, p.title AS published_title FROM episodes e JOIN users u ON u.id = e.user_id
      LEFT JOIN podcast_channels c ON c.user_id = e.user_id
      LEFT JOIN publications p ON p.episode_id = e.id ORDER BY e.updated_at DESC`);
    res.json(episodes.map(e => ({ id: e.id, title: e.title, publishedTitle: e.published_title || null,
      version: e.version, adminHidden: Boolean(e.admin_hidden), published: Boolean(e.job_id),
      channelTitle: e.channel_data ? json(e.channel_data).title : 'No channel', channelSlug: e.channel_slug,
      channelPublic: e.channel_slug ? Boolean(e.is_public) : true, ownerEmail: e.email, updatedAt: e.updated_at })));
  }));
  app.put('/api/admin/episodes/:id/visibility', requireStaff, asyncRoute(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = z.object({ hidden: z.boolean(), expectedHidden: z.boolean() }).parse(req.body);
    await transaction(async connection => {
      const [episode] = await rows('SELECT admin_hidden FROM episodes WHERE id = ? FOR UPDATE', [id], connection);
      if (!episode) throw failure('Episode not found.', 404);
      if (Boolean(episode.admin_hidden) !== input.expectedHidden) throw failure('Visibility changed. Refresh the list and try again.', 409);
      await rows('UPDATE episodes SET admin_hidden = ? WHERE id = ?', [input.hidden, id], connection);
    });
    res.json({ ok: true });
  }));
  app.delete('/api/admin/episodes/:id', requireAdmin, asyncRoute(async (req, res) => {
    const { version } = z.object({ version: z.number().int().positive() }).parse(req.body);
    await deleteEpisode(z.uuid().parse(req.params.id), { version });
    res.json({ ok: true });
  }));
  app.get('/api/auth/me', (req, res) => res.json({ user: req.user, csrf: req.csrf }));
  app.post('/api/auth/password', rateLimit({ windowMs: 15 * 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }), asyncRoute(async (req, res) => {
    const input = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(12).max(200), confirmPassword: z.string().min(12).max(200) }).parse(req.body);
    if (input.newPassword !== input.confirmPassword) throw failure('The new passwords do not match.');
    const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
    const passwordHash = await hashPassword(input.newPassword);
    await transaction(async connection => {
      const [user] = await rows('SELECT password_hash, disabled_at FROM users WHERE id = ? FOR UPDATE', [req.user.id], connection);
      if (!user || user.disabled_at || !(await verifyPassword(input.currentPassword, user.password_hash))) throw failure('Your current password is incorrect.', 401);
      await rows('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user.id], connection);
      await rows("DELETE FROM account_tokens WHERE user_id = ? AND purpose = 'reset'", [req.user.id], connection);
      await rows('DELETE FROM sessions WHERE user_id = ?', [req.user.id], connection);
      await rows('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))', [digest(token), req.user.id, csrf], connection);
    });
    res.cookie('gh_session', token, cookieOptions()).json({ ok: true, csrf });
  }));
  app.post('/api/auth/logout', asyncRoute(async (req, res) => {
    await rows('DELETE FROM sessions WHERE user_id = ? AND csrf_token = ?', [req.user.id, req.csrf]);
    res.clearCookie('gh_session', { ...cookieOptions(), maxAge: undefined }).json({ ok: true });
  }));
  app.use('/api/studio-tools', studioTools({ generate: studioAI }));
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
    await deleteEpisode(req.params.id, { ownerId: req.user.id });
    res.json({ ok: true });
  }));
  app.put('/api/episodes/:id', asyncRoute(async (req, res) => {
    const input = episodeSchema.parse(req.body);
    await validateAssets(input.arrangement, req.user.id, rows);
    await checkSeriesOwner(input.seriesId, req.user.id);
    const result = await rows(`UPDATE episodes SET title = ?, description = ?, episode_number = ?, arrangement = ?, series_id = ?, version = version + 1
      WHERE id = ? AND user_id = ? AND version = ?`, [input.title, input.description, input.number, JSON.stringify(input.arrangement), input.seriesId, req.params.id, req.user.id, input.version]);
    if (!result.affectedRows) throw failure('This draft changed in another tab. Reload before editing again.', 409);
    const [episode] = await rows('SELECT * FROM episodes WHERE id = ?', [req.params.id]);
    res.json(mapEpisode(episode));
  }));
  app.get('/api/assets', asyncRoute(async (req, res) => res.json((await rows('SELECT * FROM assets WHERE user_id = ? ORDER BY created_at DESC', [req.user.id])).map(mapAsset))));
  const upload = multer({ dest: path.join(config.mediaDir, 'uploads'), limits: { fileSize: config.maxBytes, files: 1, fields: 1 } });
  app.post('/api/assets', audioUploadLimit(), guardedUpload('audio', upload.single('audio'), async (req, res) => {
    const file = req.file;
    if (!file) throw failure('Choose an audio file.');
    let stored;
    try {
      const id = randomUUID();
      const storageKey = `uploads/${id}.flac`;
      stored = path.join(config.mediaDir, storageKey);
      // Canonical lossless audio gives streaming WebM recordings a seekable duration,
      // strips non-audio streams, and keeps source playback consistent across browsers.
      await run(config.ffmpeg, ['-hide_banner', '-y', ...importInputOptions, '-i', file.path, '-map', '0:a:0', '-vn', '-t', '7201', '-ar', '44100', '-ac', '2', '-threads', '2', '-fs', String(config.maxProcessedBytes + 1), '-codec:a', 'flac', stored], 10 * 60 * 1000);
      const { size } = await stat(stored);
      if (size > config.maxProcessedBytes) throw failure('The processed recording exceeds the audio storage limit. Shorten the recording and retry.', 413);
      const duration = await probe(stored);
      const filename = file.originalname.replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'Recording';
      await rows('INSERT INTO assets (id, user_id, filename, storage_key, mime, bytes, duration) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, req.user.id, filename, storageKey, 'audio/flac', size, duration]);
      return { id, name: filename, duration, bytes: size, url: `/api/assets/${id}/audio` };
    } catch (error) {
      const oversized = stored && await stat(stored).then(details => details.size > config.maxProcessedBytes).catch(() => false);
      if (stored) await unlink(stored).catch(() => {});
      if (oversized) throw failure('The processed recording exceeds the audio storage limit. Shorten the recording and retry.', 413);
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
    await withMediaTransferBudget(req.user.id, () => receiveMedia(req, asset.storage_key, asset.bytes));
    res.json({ ok: true });
  }));
  app.get('/api/episodes/:id/jobs', asyncRoute(async (req, res) => {
    const jobs = await rows('SELECT j.* FROM render_jobs j JOIN episodes e ON e.id = j.episode_id WHERE e.id = ? AND e.user_id = ? ORDER BY j.created_at DESC', [req.params.id, req.user.id]);
    res.json(jobs.map(mapJob));
  }));
  app.post('/api/episodes/:id/render', rateLimit({ windowMs: 3600000, limit: 20, keyGenerator: req => req.user.id, standardHeaders: 'draft-8', legacyHeaders: false }), asyncRoute(async (req, res) => {
    const result = await transaction(async connection => {
      const query = (sql, values) => rows(sql, values, connection);
      // Acquire the budget gate before any consistent reads so concurrent
      // requests cannot reuse an older snapshot of the queue or storage usage.
      await query('SELECT id FROM upload_gate WHERE id = 1 FOR UPDATE', []);
      const [episode] = await query('SELECT * FROM episodes WHERE id = ? AND user_id = ? FOR UPDATE', [req.params.id, req.user.id]);
      if (!episode) throw failure('Episode not found.', 404);
      const arrangement = json(episode.arrangement);
      if (!arrangement.segments.length) throw failure('Add at least one take before rendering.');
      await validateAssets(arrangement, req.user.id, query);
      const [existing] = await query('SELECT * FROM render_jobs WHERE episode_id = ? AND revision = ?', [episode.id, episode.version]);
      if (existing && existing.state !== 'failed') return existing;
      const [pending] = await query("SELECT COUNT(*) AS jobs FROM render_jobs j JOIN episodes e ON e.id = j.episode_id WHERE e.user_id = ? AND j.state IN ('queued','running')", [req.user.id]);
      if (Number(pending.jobs) >= 3) throw failure('You already have three renders waiting or running. Wait for one to finish.', 429);
      const [queue] = await query("SELECT COUNT(*) AS jobs FROM render_jobs WHERE state IN ('queued','running')", []);
      if (Number(queue.jobs) >= 50) throw failure('The audio queue is full. Retry when current renders finish.', 429);
      if (await storageUsed(req.user.id, connection) + config.maxProcessedBytes > config.authorStorageBytes) throw failure('Your account storage limit has been reached. Contact the administrator.', 413);
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
    await withMediaTransferBudget(req.user.id, () => receiveMedia(req, job.output_key, job.bytes));
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
      const [channel] = await query('SELECT is_public FROM podcast_channels WHERE user_id = ?', [req.user.id]);
      if (channel && !channel.is_public) throw failure('Make your channel public in My channel before publishing.');
      await checkSeriesOwner(snapshot.seriesId, req.user.id, query);
      await query(`INSERT INTO publications (episode_id, job_id, title, description, episode_number, series_id) VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE job_id = VALUES(job_id), title = VALUES(title), description = VALUES(description), episode_number = VALUES(episode_number), series_id = VALUES(series_id)`, [episode.id, job.id, snapshot.title, snapshot.description, snapshot.number, snapshot.seriesId || null]);
    });
    res.json({ ok: true });
  }));
  app.post('/api/episodes/:id/unpublish', asyncRoute(async (req, res) => {
    await rows('DELETE p FROM publications p JOIN episodes e ON e.id = p.episode_id WHERE e.id = ? AND e.user_id = ?', [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  if (serveStatic) {
    // Vite fingerprints these files; a changed build always gets new URLs.
    app.use('/assets', express.static(path.resolve('dist/assets'), { maxAge: '1y', immutable: true, index: false }));
    app.use(express.static(path.resolve('dist')));
    app.get(['/', '/about', '/resources', '/resources/:slug', '/store', '/store/:slug', '/checkout', '/admin', '/studio', '/account', '/podcast/:id', '/channels', '/channels/:slug', '/channels/:slug/series/:seriesSlug', '/authors/:slug'], (_req, res) => res.sendFile(path.resolve('dist/index.html')));
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
