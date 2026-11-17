import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { assetsForEpisode, clipFromSource, libraryClipData } from '../shared/audio-library.js';
import { insertClip, toTimeline } from '../shared/timeline.js';

export async function testAudioLibraryMigration({ mysql, socket }) {
  const connection = await mysql.createConnection({ socketPath: socket, user: 'root' });
  try {
    await connection.query('CREATE DATABASE audio_library_migration_test');
    await connection.changeUser({ database: 'audio_library_migration_test' });
    const apply = async file => {
      const sql = await readFile(new URL(`../server/migrations/${file}`, import.meta.url), 'utf8');
      for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await connection.query(statement);
    };
    await apply('001_initial.sql'); await apply('015_audio_categories.sql');
    const userId = randomUUID(), firstId = randomUUID(), secondId = randomUUID(), sharedId = randomUUID(), bedId = randomUUID(), looseId = randomUUID();
    await connection.execute('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [userId, 'migration@example.com', 'fixture']);
    const arrangement = { segments: [{ assetId: sharedId }], music: { assetId: bedId } };
    await connection.execute('INSERT INTO episodes (id, user_id, title, description, arrangement, created_at) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)',
      [firstId, userId, 'Earlier episode', '', JSON.stringify(arrangement), '2026-11-01 12:00:00', secondId, userId, 'Later episode', '', JSON.stringify(arrangement), '2026-11-02 12:00:00']);
    for (const [id, category] of [[sharedId, 'recording'], [bedId, 'music'], [looseId, 'music']]) await connection.execute('INSERT INTO assets (id, user_id, filename, storage_key, mime, bytes, duration, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, userId, id, `uploads/${id}.flac`, 'audio/flac', 100, 3, category]);
    await apply('017_audio_library.sql');
    const [sources] = await connection.query('SELECT id, episode_id AS episodeId FROM assets');
    assert.equal(sources.find(asset => asset.id === sharedId).episodeId, firstId);
    assert.equal(sources.find(asset => asset.id === bedId).episodeId, firstId);
    assert.equal(assetsForEpisode(sources, { id: secondId, arrangement }).length, 0, 'Original recordings remain with their first episode');
    assert.ok(arrangement.segments.every(clip => sources.some(source => source.id === clip.assetId)), 'Existing reused clips still reference retained audio');
    const [saved] = await connection.query('SELECT c.asset_id, c.edit, f.name FROM audio_library_clips c JOIN audio_library_folders f ON f.id = c.folder_id');
    assert.equal(saved.length, 1); assert.equal(saved[0].asset_id, looseId); assert.equal(saved[0].name, 'Previous library');
    const edit = typeof saved[0].edit === 'string' ? JSON.parse(saved[0].edit) : saved[0].edit;
    assert.equal(edit.role, 'music'); assert.equal(edit.end, 3);
    await connection.execute('DELETE FROM episodes WHERE id = ?', [firstId]);
    const [[retained]] = await connection.execute('SELECT episode_id FROM assets WHERE id = ?', [sharedId]);
    assert.equal(retained.episode_id, null);
    console.log('PASS: Audio library migration assigns existing recordings to their first episode, preserves reused sources, and retains unassigned previous-library audio.');
  } finally { await connection.query('DROP DATABASE IF EXISTS audio_library_migration_test'); await connection.end(); }
}

export async function testAudioLibrary({ app, agent, mutate, otherAgent, otherCsrf, otherId, origin, fixture, rows, claimJob, processJob }) {
  const path = '/api/audio-library', suffix = randomUUID().slice(0, 8);
  assert.equal((await request(app).get(path)).status, 401);
  const episode = (await mutate('post', '/api/episodes')).body, destination = (await mutate('post', '/api/episodes')).body;
  const upload = await mutate('post', '/api/assets').field('category', 'recording').field('episodeId', episode.id).attach('audio', fixture);
  assert.equal(upload.status, 201, JSON.stringify(upload.body)); const source = upload.body;
  assert.equal(source.episodeId, episode.id);
  const allAssets = (await agent.get('/api/assets')).body;
  assert.ok(assetsForEpisode(allAssets, episode).some(asset => asset.id === source.id));
  assert.ok(!assetsForEpisode(allAssets, destination).some(asset => asset.id === source.id));
  const [otherEpisode] = await rows('SELECT id FROM episodes WHERE user_id = ? LIMIT 1', [otherId]);
  if (otherEpisode) assert.equal((await mutate('post', '/api/assets').field('episodeId', otherEpisode.id).attach('audio', fixture)).status, 404);
  const folderResponse = await mutate('post', `${path}/folders`).send({ name: `Intros ${suffix}` });
  assert.equal(folderResponse.status, 201); const folder = folderResponse.body;
  assert.equal((await mutate('post', `${path}/folders`).send({ name: folder.name })).status, 409);
  assert.equal((await agent.post(`${path}/folders`).set('Origin', origin).send({ name: 'No CSRF' })).status, 403);
  const second = (await mutate('post', `${path}/folders`).send({ name: `Promos ${suffix}` })).body;
  const original = clipFromSource(source, 'intro', { name: 'Reusable welcome', start: .25, end: 1.75, gain: .65, fadeIn: .1, fadeOut: .2 });
  const save = await mutate('post', `${path}/clips`).send(libraryClipData(original, folder.id));
  assert.equal(save.status, 201, JSON.stringify(save.body)); const savedId = save.body.id;
  let library = (await agent.get(path)).body, saved = library.clips.find(clip => clip.id === savedId);
  assert.deepEqual([saved.start, saved.end, saved.gain, saved.fadeIn, saved.fadeOut, saved.role], [.25, 1.75, .65, .1, .2, 'intro']);
  assert.equal(saved.asset.episodeId, episode.id); assert.equal(library.folders.find(item => item.id === folder.id).count, 1);
  assert.ok(!(await otherAgent.get(path)).body.clips.some(clip => clip.id === savedId));
  const other = (method, url) => otherAgent[method](url).set('Origin', origin).set('X-CSRF-Token', otherCsrf);
  assert.equal((await other('post', `${path}/clips`).send(libraryClipData(original, folder.id))).status, 404);
  assert.equal((await other('patch', `${path}/clips/${savedId}`).send({ name: 'Wrong owner' })).status, 404);
  assert.equal((await other('delete', `${path}/clips/${savedId}`)).status, 404);
  assert.equal((await other('patch', `${path}/folders/${folder.id}`).send({ name: 'Wrong owner' })).status, 404);
  assert.equal((await other('delete', `${path}/folders/${folder.id}`)).status, 404);
  assert.equal((await mutate('post', `${path}/clips`).send({ ...libraryClipData(original, folder.id), end: 9 })).status, 400);
  assert.equal((await mutate('post', `${path}/clips`).send({ ...libraryClipData(original, folder.id), folderId: randomUUID() })).status, 404);
  assert.equal((await mutate('delete', `${path}/folders/${folder.id}`)).status, 409);
  const copy = clipFromSource(saved.asset, saved.role, saved);
  let arrangement = insertClip(toTimeline(destination.arrangement), copy);
  const updated = await mutate('put', `/api/episodes/${destination.id}`).send({ ...destination, arrangement });
  assert.equal(updated.status, 200); assert.notEqual(updated.body.arrangement.segments[0].id, savedId);
  const render = await mutate('post', `/api/episodes/${destination.id}/render`); assert.equal(render.status, 202);
  const job = await claimJob(); assert.equal(job.id, render.body.id); await processJob(job);
  const [finished] = await rows('SELECT * FROM render_jobs WHERE id = ?', [job.id]);
  assert.equal(finished.state, 'ready', finished.error); assert.ok(Math.abs(finished.duration - 1.5) < .15, 'Saved clip renders its trimmed duration in another episode');
  assert.equal((await mutate('patch', `${path}/clips/${savedId}`).send({ name: 'Renamed reusable welcome', folderId: second.id })).status, 200);
  assert.equal((await mutate('patch', `${path}/folders/${second.id}`).send({ name: `Favorites ${suffix}` })).status, 200);
  assert.equal((await mutate('delete', `${path}/folders/${folder.id}`)).status, 200);
  assert.equal((await mutate('delete', `/api/episodes/${episode.id}`)).status, 200);
  library = (await agent.get(path)).body; saved = library.clips.find(clip => clip.id === savedId);
  assert.equal(saved.folderId, second.id); assert.equal(saved.start, .25); assert.equal((await agent.get(saved.asset.url)).status, 200);
  assert.equal((await mutate('delete', `${path}/clips/${savedId}`)).status, 200);
  const retained = (await agent.get('/api/episodes')).body.find(item => item.id === destination.id);
  assert.equal(retained.arrangement.segments[0].name, 'Reusable welcome'); assert.equal(retained.arrangement.segments[0].start, .25);
  assert.equal((await agent.get(source.url)).status, 200);
  assert.equal((await mutate('delete', `${path}/folders/${second.id}`)).status, 200);
  assert.equal((await mutate('delete', `/api/episodes/${destination.id}`)).status, 200);
  console.log('PASS: Episode-scoped uploads, private folder/clip CRUD, CSRF/ownership/bounds checks, exact saved-edit reuse and worker rendering, and independent episode/library deletion.');
}
