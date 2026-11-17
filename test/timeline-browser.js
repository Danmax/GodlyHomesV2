import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { defaultDocuments } from '../shared/website.js';
import { arrangementSchema } from '../server/validation.js';

export async function testTimelineBrowser(browser, origin) {
  const context = await browser.newContext({ reducedMotion: 'reduce' }), page = await context.newPage(), errors = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  const wav = Buffer.alloc(44 + 24000 * 10 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 240000; i++) wav.writeInt16LE(Math.round(Math.sin(i / 24000 * 440 * Math.PI * 2) * 6000), 44 + i * 2);
  await page.route('**/timeline-fixture.wav', route => route.fulfill({ contentType: 'audio/wav', body: wav }));
  const source = (name, category = 'recording') => ({ id: randomUUID(), name, category, duration: 10, bytes: wav.length, url: '/timeline-fixture.wav' });
  const assets = [source('Sunday conversation'), source('Gentle piano', 'music'), source('Opening welcome'), source('Soft chime'), source('This week at Godly Homes')];
  let episode = { id: randomUUID(), title: 'A little room for grace', number: 12, description: '', updatedAt: '2026-11-16', version: 1,
    arrangement: { segments: [{ id: randomUUID(), assetId: assets[0].id, name: assets[0].name, role: 'segment', start: 0, end: 10, gain: 1, fadeIn: 0, fadeOut: 0 }], music: { assetId: null, volume: .12, duck: true } } };
  assets.forEach(asset => { asset.episodeId = episode.id; });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method(); let json;
    if (path === '/api/public/website') json = { documents: defaultDocuments, resources: [], products: [] };
    else if (path === '/api/auth/me') json = { user: { id: randomUUID(), role: 'publisher', email: 'author@example.com' }, csrf: 'timeline-csrf' };
    else if (path === '/api/episodes') json = [episode];
    else if (path === '/api/assets') { if (method === 'POST') { const uploaded = { ...source('Dropped chime.wav'), episodeId: episode.id }; assets.push(uploaded); json = uploaded; } else json = assets; }
    else if (path === `/api/episodes/${episode.id}` && method === 'PUT') {
      const body = route.request().postDataJSON();
      const parsed = arrangementSchema.safeParse(body.arrangement);
      if (!parsed.success) { errors.push(parsed.error.message); return route.fulfill({ status: 400, json: { error: 'Invalid timeline fixture save' } }); }
      episode = { ...episode, ...body, arrangement: parsed.data, version: episode.version + 1 }; json = episode;
    } else if (path === '/api/audio-library') json = { folders: [], clips: [] };
    else if (path === '/api/studio-tools/options') json = { introEnabled: false, voices: [] };
    else { unexpected.push(path); return route.fulfill({ status: 404, json: { error: `Unexpected fixture: ${path}` } }); }
    return route.fulfill({ json });
  });
  const saved = () => page.getByText('Saved just now', { exact: true }).waitFor();
  try {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(`${origin}/studio`); await page.locator('.episode-open').click();
    await page.getByRole('tab', { name: '2. Arrange & edit' }).click();
    assert.equal(await page.locator('.timeline-clip').count(), 1);
    assert.equal(episode.arrangement.tracks, undefined, 'Simply opening a legacy episode does not rewrite it');
    await page.getByLabel('Timeline zoom', { exact: true }).selectOption('32');
    const main = page.getByRole('button', { name: 'Clip Sunday conversation', exact: true });
    await main.scrollIntoViewIfNeeded();
    let box = await main.boundingBox();
    await page.mouse.move(box.x + 30, box.y + 20); await page.mouse.down();
    await page.mouse.move(box.x + 94, box.y + 110, { steps: 10 }); await page.mouse.up();
    await saved();
    assert.equal(episode.arrangement.segments[0].trackId, 'narration', 'Pointer drag changes tracks');
    assert.equal(episode.arrangement.segments[0].position, 2, 'Pointer drag changes start time');
    box = await page.getByRole('button', { name: 'Trim start of Sunday conversation', exact: true }).boundingBox();
    await page.mouse.move(box.x + 4, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + 36, box.y + 30, { steps: 8 }); await page.mouse.up();
    await saved(); assert.equal(episode.arrangement.segments[0].start, 1); assert.equal(episode.arrangement.segments[0].position, 3);
    box = await page.getByRole('button', { name: 'Trim end of Sunday conversation', exact: true }).boundingBox();
    await page.mouse.move(box.x + 4, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x - 60, box.y + 30, { steps: 8 }); await page.mouse.up();
    await saved(); assert.equal(episode.arrangement.segments[0].end, 8);
    await page.getByLabel('Timeline playhead (seconds)', { exact: true }).fill('6');
    await page.getByRole('button', { name: 'Split at playhead', exact: true }).click();
    await saved(); assert.deepEqual(episode.arrangement.segments.map(clip => [clip.position, clip.start, clip.end]), [[3, 1, 4], [6, 4, 8]]);
    await page.getByRole('button', { name: 'Duplicate clip', exact: true }).click(); await saved(); assert.equal(episode.arrangement.segments.length, 3);
    assert.equal(await page.locator('[data-track="narration"] .timeline-clip').count(), 3, 'Overlaps can stack within a track');
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await saved(); assert.equal(episode.arrangement.segments.length, 2);
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); await saved(); assert.equal(episode.arrangement.segments.length, 3);
    await page.getByRole('button', { name: 'Delete selected clip', exact: true }).click(); await saved(); assert.equal(episode.arrangement.segments.length, 2);
    await page.locator('.timeline-editor').scrollIntoViewIfNeeded();
    const musicSource = page.locator('.timeline-source').filter({ hasText: 'Gentle piano' });
    await musicSource.dragTo(page.locator('[data-track="music"]'), { targetPosition: { x: 128, y: 40 } });
    await saved();
    const music = episode.arrangement.segments.find(clip => clip.role === 'music');
    assert.ok(music); assert.equal(music.trackId, 'music'); assert.equal(music.position, 4);
    const fileDrop = await page.evaluateHandle(() => {
      const data = new DataTransfer(); data.items.add(new File([new Uint8Array([1, 2, 3])], 'Dropped chime.wav', { type: 'audio/wav' })); return data;
    });
    const effectsLane = page.locator('[data-track="effects"]'), effectsBox = await effectsLane.boundingBox();
    await effectsLane.dispatchEvent('drop', { dataTransfer: fileDrop, clientX: effectsBox.x + 480, clientY: effectsBox.y + 40 });
    await page.getByRole('button', { name: 'Clip Dropped chime.wav', exact: true }).waitFor();
    await saved();
    const dropped = episode.arrangement.segments.find(clip => clip.name === 'Dropped chime.wav');
    assert.ok(dropped); assert.equal(dropped.trackId, 'effects'); assert.equal(dropped.position, 15); assert.equal(dropped.role, 'effects');
    await fileDrop.dispose();
    await page.getByRole('button', { name: 'Mute Music', exact: true }).click(); await saved();
    assert.equal(episode.arrangement.tracks.find(track => track.id === 'music').muted, true);
    await page.getByRole('button', { name: 'Mute Music', exact: true }).click(); await saved();
    await page.getByRole('button', { name: 'Solo Narrator', exact: true }).click(); await saved();
    assert.equal(episode.arrangement.tracks.find(track => track.id === 'narration').solo, true);
    await page.getByRole('button', { name: 'Solo Narrator', exact: true }).click(); await saved();
    await page.getByLabel('Timeline playhead (seconds)', { exact: true }).fill('3');
    await page.getByRole('button', { name: 'Play timeline', exact: true }).click();
    await page.getByRole('button', { name: 'Pause timeline', exact: true }).waitFor();
    await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Timeline playhead (seconds)"]').value) > 3.3);
    await page.getByRole('button', { name: 'Pause timeline', exact: true }).click();
    await page.getByRole('button', { name: 'Clip Gentle piano', exact: true }).focus();
    await page.keyboard.press('ArrowRight'); await saved(); assert.equal(episode.arrangement.segments.find(clip => clip.role === 'music').position, 4.1);
    await page.getByRole('button', { name: 'Add track', exact: true }).click(); await saved(); assert.equal(episode.arrangement.tracks.length, 6);
    await page.getByRole('button', { name: 'Remove Audio 6 track', exact: true }).click(); await saved(); assert.equal(episode.arrangement.tracks.length, 5);
    // Production roles remain editable, including with numeric controls on touch devices.
    await page.getByLabel('Add as', { exact: true }).selectOption('intro');
    await page.getByLabel('Episode recordings', { exact: true }).selectOption(assets[2].id);
    await page.getByRole('button', { name: 'Add clip to episode', exact: true }).click(); await saved();
    assert.equal(episode.arrangement.segments[0].role, 'intro');
    await page.getByLabel('Trim end (seconds)', { exact: true }).fill('3'); await saved();
    for (const [role, assetId] of [['transition', assets[3].id], ['action', assets[3].id], ['announcement', assets[4].id], ['promo', assets[4].id], ['closing', assets[2].id]]) {
      await page.getByLabel('Add as', { exact: true }).selectOption(role); await page.getByLabel('Episode recordings', { exact: true }).selectOption(assetId);
      await page.getByRole('button', { name: 'Add clip to episode', exact: true }).click(); await saved();
      assert.ok(episode.arrangement.segments.some(clip => clip.role === role));
    }
    await page.getByLabel('Timeline zoom', { exact: true }).selectOption('fit');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1200 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Timeline stays inside ${width}px viewport`);
    }
    await page.locator('.timeline-editor').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/timeline-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.timeline-editor').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/timeline-mobile.png', fullPage: true });
    const beforeReload = structuredClone(episode.arrangement);
    await page.reload(); await page.locator('.episode-open').click(); await page.getByRole('tab', { name: '2. Arrange & edit' }).click();
    assert.deepEqual(episode.arrangement, beforeReload); assert.equal(await page.locator('.timeline-clip').count(), beforeReload.segments.length);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log('PASS: Timeline cross-track pointer dragging, edge trims, playhead split, overlapping duplication, Undo/Redo, library drop, mute/solo, real playback, keyboard movement, production roles, persistence and responsive layouts.');
  } catch (error) {
    await page.screenshot({ path: 'test-results/timeline-failure.png', fullPage: true });
    console.error('Timeline browser diagnostics:', errors, unexpected); throw error;
  } finally { await context.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { mkdir } = await import('node:fs/promises');
  const { chromium } = await import('playwright');
  const { createApp } = await import('../server/app.js');
  const { db } = await import('../server/db.js');
  const app = await createApp(), server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    await mkdir('test-results', { recursive: true });
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    await testTimelineBrowser(browser, `http://127.0.0.1:${server.address().port}`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await db.end(); }
}
