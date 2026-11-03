// Fully isolated database/server/media; never connects to the project's configured database.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import mysql from 'mysql2/promise';
import request from 'supertest';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

const root = await mkdtemp(path.join(os.tmpdir(), 'gh-mvp-'));
const data = path.join(root, 'mysql'), socket = path.join(root, 'mysql.sock');
await mkdir(data);
const mysqld = process.env.MYSQLD_PATH || '/opt/homebrew/bin/mysqld';
async function command(file, args) {
  const child = spawn(file, args, { stdio: 'pipe' });
  let output = ''; child.stderr.on('data', d => { output += d; });
  return new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(output))); });
}
let daemon, connection, db, mediaServer;
try {
  await command(mysqld, ['--no-defaults', '--initialize-insecure', `--datadir=${data}`]);
  daemon = spawn(mysqld, ['--no-defaults', `--datadir=${data}`, `--socket=${socket}`, '--skip-networking', '--mysqlx=OFF', `--pid-file=${root}/mysql.pid`, `--log-error=${root}/mysql.log`], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { connection = await mysql.createConnection({ socketPath: socket, user: 'root' }); break; }
    catch { await delay(200); }
  }
  if (!connection) throw new Error(`MySQL could not start: ${await readFile(path.join(root, 'mysql.log'), 'utf8')}`);
  await connection.query('CREATE DATABASE godly_homes_test');
  Object.assign(process.env, { DB_SOCKET: socket, DB_USER: 'root', DB_PASSWORD: '', DB_NAME: 'godly_homes_test', MEDIA_DIR: path.join(root, 'media'), FFMPEG_PATH: ffmpeg, FFPROBE_PATH: ffprobe.path, APP_URL: 'http://localhost:5173' });
  await command(process.execPath, ['server/migrate.js']);
  ({ db } = await import('../server/db.js'));
  const { rows } = await import('../server/db.js');
  const { hashPassword } = await import('../server/auth.js');
  const { createApp } = await import('../server/app.js');
  const { claimJob, processJob } = await import('../server/worker.js');
  const { run } = await import('../server/audio.js');
  const app = await createApp();
  const origin = 'http://localhost:5173';
  const userId = randomUUID(), otherId = randomUUID();
  const password = `test-${randomUUID()}`;
  await rows('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?), (?, ?, ?)', [userId, 'test@godlyhomes.com', await hashPassword(password), otherId, 'other@godlyhomes.com', await hashPassword(password)]);
  const agent = request.agent(app);
  assert.equal((await agent.get('/api/episodes')).status, 401);
  assert.equal((await agent.post('/api/auth/login').send({ email: 'test@godlyhomes.com', password })).status, 403);
  assert.equal((await agent.post('/api/auth/login').set('Origin', origin).send({ email: 'test@godlyhomes.com', password: 'wrong' })).status, 401);
  const login = await agent.post('/api/auth/login').set('Origin', origin).send({ email: 'test@godlyhomes.com', password });
  assert.equal(login.status, 200);
  assert.ok(login.headers['set-cookie'][0].includes('HttpOnly'));
  const csrf = login.body.csrf;
  const mutate = (method, url) => agent[method](url).set('Origin', origin).set('X-CSRF-Token', csrf);
  assert.equal((await agent.post('/api/episodes').set('Origin', origin)).status, 403);
  const created = await mutate('post', '/api/episodes');
  assert.equal(created.status, 201);
  let episode = created.body;
  const fixture = path.join(root, 'voice.wav');
  await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', fixture]);
  const invalid = await mutate('post', '/api/assets').attach('audio', Buffer.from('invalid audio'), 'bad.wav');
  assert.equal(invalid.status, 400);
  const uploaded = await mutate('post', '/api/assets').attach('audio', fixture);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const asset = uploaded.body;
  assert.equal(Math.round(asset.duration), 3);
  assert.equal((await request(app).get(asset.url)).status, 401);
  assert.equal((await agent.get(asset.url).set('Range', 'bytes=0-99')).status, 206);
  const arrangement = { segments: [{ id: randomUUID(), assetId: asset.id, name: 'Test take', start: .1, end: 2.8, gain: .8, fadeIn: .1, fadeOut: .1 }], music: { assetId: asset.id, volume: .1, duck: true } };
  const saved = await mutate('put', `/api/episodes/${episode.id}`).send({ ...episode, title: 'A test & <episode>', description: 'Notes ]]> with safe XML', arrangement });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal((await mutate('put', `/api/episodes/${episode.id}`).send({ ...episode, arrangement })).status, 409);
  episode = saved.body;
  const stranger = request.agent(app);
  const otherLogin = await stranger.post('/api/auth/login').set('Origin', origin).send({ email: 'other@godlyhomes.com', password });
  assert.equal((await stranger.get(`/api/assets/${asset.id}/audio`)).status, 404);
  assert.equal((await stranger.post(`/api/episodes/${episode.id}/render`).set('Origin', origin).set('X-CSRF-Token', otherLogin.body.csrf)).status, 404);
  assert.equal((await request(app).get('/api/public/episodes')).body.length, 0);
  const render = await mutate('post', `/api/episodes/${episode.id}/render`);
  assert.equal(render.status, 202, JSON.stringify(render.body));
  const repeated = await mutate('post', `/api/episodes/${episode.id}/render`);
  assert.equal(repeated.body.id, render.body.id);
  assert.equal((await mutate('post', `/api/episodes/${episode.id}/publish`).send({ jobId: render.body.id })).status, 400);
  const job = await claimJob();
  assert.equal(job.id, render.body.id);
  assert.equal(await claimJob(), null);
  await processJob(job);
  const [finished] = await rows('SELECT * FROM render_jobs WHERE id = ?', [job.id]);
  assert.equal(finished.state, 'ready', finished.error);
  assert.ok(finished.bytes > 1000);
  const renderedFile = path.join(process.env.MEDIA_DIR, finished.output_key);
  const renderedBytes = await readFile(renderedFile);
  const renderedHash = createHash('sha256').update(renderedBytes).digest('hex');
  const restore = () => mutate('put', `/api/jobs/${job.id}/audio`).set('Content-Type', 'application/octet-stream').set('X-Content-SHA256', renderedHash).send(renderedBytes);
  await unlink(renderedFile);
  const missingAudio = await agent.get(`/api/jobs/${job.id}/audio`);
  assert.equal(missingAudio.status, 404);
  assert.ok(!JSON.stringify(missingAudio.body).includes(process.env.MEDIA_DIR));
  assert.equal((await mutate('post', `/api/episodes/${episode.id}/publish`).send({ jobId: job.id })).status, 409);
  assert.equal((await request(app).get('/api/public/episodes')).body.length, 0);
  assert.equal((await stranger.put(`/api/jobs/${job.id}/audio`).set('Origin', origin).set('X-CSRF-Token', otherLogin.body.csrf).set('Content-Type', 'application/octet-stream').set('X-Content-SHA256', renderedHash).send(renderedBytes)).status, 404);
  assert.equal((await mutate('put', `/api/jobs/${job.id}/audio`).set('Content-Type', 'application/octet-stream').set('X-Content-SHA256', '0'.repeat(64)).send(renderedBytes)).status, 400);
  assert.equal((await agent.get(`/api/jobs/${job.id}/audio`)).status, 404);
  assert.equal((await restore()).status, 200);
  assert.deepEqual(await readFile(renderedFile), renderedBytes);
  assert.equal((await restore()).status, 200); // Repeated transfers are idempotent.
  const conflicting = Buffer.from(renderedBytes); conflicting[conflicting.length - 1] ^= 1;
  assert.equal((await mutate('put', `/api/jobs/${job.id}/audio`).set('Content-Type', 'application/octet-stream').set('X-Content-SHA256', createHash('sha256').update(conflicting).digest('hex')).send(conflicting)).status, 409);
  assert.deepEqual(await readFile(renderedFile), renderedBytes);
  const [sourceRecord] = await rows('SELECT * FROM assets WHERE id = ?', [asset.id]);
  const sourcePath = path.join(process.env.MEDIA_DIR, sourceRecord.storage_key);
  const sourceBytes = await readFile(sourcePath);
  await unlink(sourcePath);
  assert.equal((await mutate('put', `/api/assets/${asset.id}/audio`).set('Content-Type', 'application/octet-stream').set('X-Content-SHA256', createHash('sha256').update(sourceBytes).digest('hex')).send(sourceBytes)).status, 200);
  assert.deepEqual(await readFile(sourcePath), sourceBytes);
  // A second app shares MySQL but has a separate filesystem, as on Hostinger.
  const remoteMedia = path.join(root, 'remote-media');
  mediaServer = spawn(process.execPath, ['--input-type=module', '-e', `
    import { createApp } from './server/app.js';
    import { config } from './server/config.js';
    import { db } from './server/db.js';
    const app = await createApp();
    const server = app.listen(0, '127.0.0.1', () => {
      config.origin = 'http://127.0.0.1:' + server.address().port;
      process.send({ origin: config.origin });
    });
    process.on('SIGTERM', () => server.close(async () => { await db.end(); process.exit(0); }));
  `], { env: { ...process.env, MEDIA_DIR: remoteMedia, MEDIA_REMOTE_URL: '' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const remoteOrigin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Remote media test server did not start.')), 10000);
    mediaServer.once('message', message => { clearTimeout(timer); resolve(message.origin); });
    mediaServer.once('error', error => { clearTimeout(timer); reject(error); });
  });
  const { syncEpisodeMedia } = await import('../server/media.js');
  const { config: mediaConfig } = await import('../server/config.js');
  const cookie = login.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
  await syncEpisodeMedia({ job: finished, assets: [sourceRecord], origin: remoteOrigin, cookie, csrf });
  assert.deepEqual(await readFile(path.join(remoteMedia, sourceRecord.storage_key)), sourceBytes);
  assert.deepEqual(await readFile(path.join(remoteMedia, finished.output_key)), renderedBytes);
  await unlink(path.join(remoteMedia, finished.output_key));
  mediaConfig.remoteMediaOrigin = remoteOrigin;
  const privateAudio = await agent.get(`/api/jobs/${job.id}/audio`).set('Range', 'bytes=0-99');
  assert.equal(privateAudio.status, 206);
  assert.equal((await mutate('post', `/api/episodes/${episode.id}/publish`).send({ jobId: job.id })).status, 200);
  assert.deepEqual(await readFile(path.join(remoteMedia, finished.output_key)), renderedBytes);
  mediaConfig.remoteMediaOrigin = null;
  mediaServer.kill('SIGTERM'); await new Promise(resolve => mediaServer.once('exit', resolve)); mediaServer = null;
  assert.equal((await mutate('post', `/api/episodes/${episode.id}/publish`).send({ jobId: job.id })).status, 200);
  const publicEpisodes = await request(app).get('/api/public/episodes');
  assert.equal(publicEpisodes.body.length, 1);
  assert.equal((await request(app).get(publicEpisodes.body[0].url).set('Range', 'bytes=0-99')).status, 206);
  const rss = await request(app).get('/podcast/feed.xml');
  assert.equal(rss.status, 200); assert.ok(rss.text.includes('A test &amp; &lt;episode&gt;'));
  const changed = await mutate('put', `/api/episodes/${episode.id}`).send({ ...episode, title: 'Private draft title' });
  assert.equal(changed.status, 200);
  assert.equal((await request(app).get('/api/public/episodes')).body[0].title, 'A test & <episode>');
  assert.equal((await mutate('post', `/api/episodes/${episode.id}/publish`).send({ jobId: job.id })).status, 409);
  assert.equal((await mutate('post', `/api/episodes/${episode.id}/unpublish`)).status, 200);
  assert.equal((await request(app).get(publicEpisodes.body[0].url)).status, 404);
  // An interrupted worker loses its lease. A replacement can claim the same durable job.
  const nextRender = await mutate('post', `/api/episodes/${episode.id}/render`);
  assert.equal(nextRender.status, 202);
  const interrupted = await claimJob(); assert.equal(interrupted.id, nextRender.body.id);
  await rows('UPDATE render_jobs SET lease_until = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE id = ?', [interrupted.id]);
  const replacement = await claimJob();
  assert.equal(replacement.id, interrupted.id); assert.notEqual(replacement.lease_token, interrupted.lease_token);
  const staleWrite = await rows("UPDATE render_jobs SET state = 'failed' WHERE id = ? AND lease_token = ?", [interrupted.id, interrupted.lease_token]);
  assert.equal(staleWrite.affectedRows, 0);
  await processJob(replacement);
  assert.equal((await rows('SELECT state FROM render_jobs WHERE id = ?', [replacement.id]))[0].state, 'ready');
  assert.equal((await request(app).post('/api/subscribe').set('Origin', origin).send({ email: 'reader@example.com', consent: false })).status, 400);
  assert.equal((await request(app).post('/api/subscribe').set('Origin', origin).send({ email: 'reader@example.com', consent: true })).status, 200);
  console.log('PASS: MySQL authentication, CSRF, ownership, uploads, drafts, FFmpeg render, checksum-verified source/MP3 recovery, missing-file publication prevention, publish, RSS, byte-range audio, unpublish and subscriptions.');

  if (process.env.RUN_BROWSER === '1') {
    const { chromium } = await import('playwright');
    const { config } = await import('../server/config.js');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    config.origin = url;
    let browser;
    try {
      browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url); await page.getByRole('heading', { name: 'Peace for the home you’re building.' }).waitFor();
      await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
      await page.goto(`${url}/studio`);
      await page.getByLabel('Email', { exact: true }).fill('test@godlyhomes.com');
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in to your studio' }).click();
      await page.getByRole('button', { name: 'New episode' }).waitFor();
      await page.getByRole('button', { name: 'New episode' }).click();
      await page.getByRole('button', { name: 'Start recording', exact: true }).click();
      await page.getByText('Recording. Take your time.').waitFor();
      await delay(3200);
      await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
      await page.getByText('Take saved to your episode.').waitFor({ timeout: 30000 });
      await page.screenshot({ path: 'test-results/studio-record.png', fullPage: true });
      await page.getByRole('button', { name: 'Arrange your episode' }).click();
      await page.locator('.segment-name').first().click();
      await page.getByRole('heading', { name: 'Refine this segment' }).waitFor();
      await page.locator('audio').evaluate(audio => new Promise((resolve, reject) => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) return resolve();
        audio.addEventListener('loadedmetadata', () => audio.duration > 0 ? resolve() : reject(new Error('Invalid source duration')), { once: true });
        audio.addEventListener('error', () => reject(new Error('Source audio could not play')), { once: true });
      }));
      await page.getByRole('tab', { name: '3. Review & publish' }).click();
      await page.getByLabel('Episode title', { exact: true }).fill('Browser recorded episode');
      await page.getByText('Saved just now', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Render episode audio' }).click();
      await page.getByRole('button', { name: 'Waiting for audio worker…' }).waitFor();
      const browserJob = await claimJob(); assert.ok(browserJob); await processJob(browserJob);
      await page.getByRole('heading', { name: 'Ready for your ears.' }).waitFor({ timeout: 15000 });
      await page.locator('audio').evaluate(audio => audio.play());
      await delay(100); await page.locator('audio').evaluate(audio => audio.pause());
      await page.getByLabel('I’ve reviewed this audio and its details.').check();
      await page.getByRole('button', { name: 'Publish episode', exact: true }).click();
      await page.getByRole('heading', { name: 'Your episode is live.' }).waitFor();
      await page.screenshot({ path: 'test-results/studio-publish.png', fullPage: true });
      await page.reload();
      await page.getByRole('button', { name: /Browser recorded episode/ }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 }); await page.goto(url);
      await page.screenshot({ path: 'test-results/home-mobile.png', fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.goto(`${url}/studio`); await page.getByRole('button', { name: /Browser recorded episode/ }).click();
      await page.screenshot({ path: 'test-results/studio-mobile.png', fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      // Simulate a connection failure after recording. The raw take must survive reload.
      await page.route('**/api/assets', route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
      await page.getByRole('button', { name: 'Start recording', exact: true }).click();
      await page.getByText('Recording. Take your time.').waitFor(); await delay(2200);
      await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
      await page.getByRole('button', { name: 'Download recording backup' }).waitFor();
      await page.getByRole('button', { name: 'Start recording', exact: true }).waitFor();
      await page.reload(); await page.getByRole('heading', { name: 'Recover recordings' }).waitFor();
      await page.unroute('**/api/assets');
      await page.getByRole('button', { name: 'Restore', exact: true }).click();
      await page.getByRole('heading', { name: 'Browser recorded episode', exact: true }).waitFor();
      await page.getByRole('heading', { name: 'Recover recordings' }).waitFor({ state: 'hidden' });
      await page.getByText('2 segments ready to arrange.').waitFor();
      await page.screenshot({ path: 'test-results/studio-recovered-mobile.png', fullPage: true });
      // Audio may upload successfully while the following draft save fails.
      // Reload and restore must reuse that uploaded asset instead of losing it.
      await page.route('**/api/episodes/*', route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue());
      await page.getByRole('button', { name: 'Start recording', exact: true }).click();
      await page.getByText('Recording. Take your time.').waitFor(); await delay(2200);
      await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
      await page.getByRole('button', { name: 'Download recording backup' }).waitFor();
      await page.getByRole('button', { name: 'Start recording', exact: true }).waitFor();
      const assetsBeforeRecovery = (await rows('SELECT COUNT(*) AS count FROM assets WHERE user_id = ?', [userId]))[0].count;
      page.once('dialog', dialog => dialog.accept());
      await page.reload(); await page.getByRole('heading', { name: 'Recover recordings' }).waitFor();
      await page.unroute('**/api/episodes/*');
      await page.getByRole('button', { name: 'Restore', exact: true }).click();
      await page.getByText('3 segments ready to arrange.').waitFor();
      await page.getByRole('heading', { name: 'Recover recordings' }).waitFor({ state: 'hidden' });
      assert.equal((await rows('SELECT COUNT(*) AS count FROM assets WHERE user_id = ?', [userId]))[0].count, assetsBeforeRecovery);
      assert.deepEqual(errors, []);
      console.log('PASS: Desktop/mobile browser, real MediaRecorder, FLAC/MP3 playback, upload/save, render/review/publish, reload persistence, failed-upload recovery after reload, no page errors or horizontal overflow.');
    } finally { config.origin = origin; await browser?.close(); await new Promise(resolve => server.close(resolve)); }
  }
  assert.equal((await mutate('post', '/api/auth/logout')).status, 200);
  assert.equal((await agent.get('/api/episodes')).status, 401);
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  if (mediaServer) { mediaServer.kill('SIGTERM'); await new Promise(resolve => mediaServer.once('exit', resolve)); }
  await db?.end();
  await connection?.end();
  if (daemon) { daemon.kill('SIGTERM'); await new Promise(resolve => daemon.once('close', resolve)); }
  await rm(root, { recursive: true, force: true });
}
