import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { defaultDocuments } from '../shared/website.js';
import { arrangementSchema } from '../server/validation.js';
import { libraryClipSchema } from '../server/audio-library.js';

export async function testAudioLibraryBrowser(browser, origin) {
  const context = await browser.newContext({ reducedMotion: 'reduce', hasTouch: true }), page = await context.newPage(), errors = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  const wav = Buffer.alloc(44 + 24000 * 10 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 240000; i++) wav.writeInt16LE(Math.round(Math.sin(i / 24000 * 440 * Math.PI * 2) * 6000), 44 + i * 2);
  await page.route('**/library-fixture.wav', route => route.fulfill({ contentType: 'audio/wav', body: wav }));
  const episodeIds = [randomUUID(), randomUUID()];
  const assets = episodeIds.map((episodeId, index) => ({ id: randomUUID(), episodeId, name: index ? 'Second episode recording' : 'First episode recording', duration: 10, bytes: wav.length, category: 'recording', url: '/library-fixture.wav' }));
  const episodes = episodeIds.map((id, index) => ({ id, title: index ? 'Episode two' : 'Episode one', number: index + 1, version: 1, updatedAt: '2026-11-16', description: '', arrangement: { segments: [{ id: randomUUID(), assetId: assets[index].id, name: assets[index].name, role: 'segment', start: 0, end: 10, gain: 1, fadeIn: 0, fadeOut: 0 }], music: { assetId: null, volume: .12, duck: true } } }));
  let folders = [], clips = [];
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method(), body = ['POST', 'PATCH', 'PUT'].includes(method) ? route.request().postDataJSON() : null; let json, status = 200;
    if (path === '/api/public/website') json = { documents: defaultDocuments, resources: [], products: [] };
    else if (path === '/api/auth/me') json = { user: { id: randomUUID(), role: 'publisher', email: 'author@example.com' }, csrf: 'library-csrf' };
    else if (path === '/api/episodes') json = episodes;
    else if (path === '/api/assets') json = assets;
    else if (path === '/api/studio-tools/options') json = { introEnabled: false, voices: [] };
    else if (path === '/api/audio-library') json = { folders: folders.map(folder => ({ ...folder, count: clips.filter(clip => clip.folderId === folder.id).length })), clips: clips.map(clip => ({ ...clip, asset: assets.find(asset => asset.id === clip.assetId) })) };
    else if (path === '/api/audio-library/folders' && method === 'POST') { json = { id: randomUUID(), ...body }; folders.push(json); status = 201; }
    else if (path.startsWith('/api/audio-library/folders/') && method === 'PATCH') { const id = path.split('/').at(-1); folders = folders.map(folder => folder.id === id ? { ...folder, ...body } : folder); json = { ok: true }; }
    else if (path.startsWith('/api/audio-library/folders/') && method === 'DELETE') { folders = folders.filter(folder => folder.id !== path.split('/').at(-1)); json = { ok: true }; }
    else if (path === '/api/audio-library/clips' && method === 'POST') { json = { id: randomUUID(), ...libraryClipSchema.parse(body) }; clips.push(json); status = 201; }
    else if (path.startsWith('/api/audio-library/clips/') && method === 'PATCH') { const id = path.split('/').at(-1); clips = clips.map(clip => clip.id === id ? { ...clip, ...body } : clip); json = { ok: true }; }
    else if (path.startsWith('/api/audio-library/clips/') && method === 'DELETE') { clips = clips.filter(clip => clip.id !== path.split('/').at(-1)); json = { ok: true }; }
    else if (path.startsWith('/api/episodes/') && method === 'PUT') {
      const index = episodes.findIndex(episode => episode.id === path.split('/').at(-1));
      episodes[index] = { ...episodes[index], ...body, arrangement: arrangementSchema.parse(body.arrangement), version: episodes[index].version + 1 }; json = episodes[index];
    } else { unexpected.push(`${method} ${path}`); return route.fulfill({ status: 404, json: { error: 'Unexpected library fixture' } }); }
    return route.fulfill({ status, json });
  });
  const saved = () => page.getByText('Saved just now', { exact: true }).waitFor();
  const status = text => page.getByRole('status').filter({ hasText: text }).waitFor();
  const openEpisode = async title => { await page.locator('.episode-open').filter({ hasText: title }).click(); await page.getByRole('tab', { name: '2. Arrange & edit' }).click(); };
  try {
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.goto(`${origin}/studio`); await openEpisode('Episode one');
    assert.deepEqual(await page.getByLabel('Episode recordings', { exact: true }).locator('option').allTextContents(), ['Choose a recording or music track', 'First episode recording']);
    assert.equal(await page.locator('.timeline-source').count(), 1);
    await page.getByRole('button', { name: 'Clip First episode recording', exact: true }).tap();
    await page.getByRole('button', { name: 'Mute Program', exact: true }).tap();
    assert.equal(await page.getByRole('button', { name: 'Mute Program', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Mute Program', exact: true }).tap();
    await page.getByLabel('Trim start (seconds)', { exact: true }).fill('1.25'); await page.getByLabel('Trim end (seconds)', { exact: true }).fill('4.75');
    await page.getByLabel('Episode section', { exact: true }).selectOption('intro');
    await page.getByLabel('Fade in (seconds)', { exact: true }).fill('0.2'); await page.getByLabel('Fade out (seconds)', { exact: true }).fill('0.3');
    const gain = page.locator('.clip-editor input[type=range]').last(); await gain.press('Home'); for (let i = 0; i < 8; i++) await gain.press('ArrowRight');
    await page.getByLabel('Timeline start (seconds)', { exact: true }).fill('15'); await saved();
    const firstArrangement = structuredClone(episodes[0].arrangement);
    await page.getByLabel('New library folder', { exact: true }).fill('Intros'); await page.getByRole('button', { name: 'Create folder', exact: true }).click(); await status('Folder created');
    await page.getByLabel('Library clip name', { exact: true }).fill('Reusable welcome'); await page.getByRole('button', { name: 'Save clip to library', exact: true }).click(); await status('Saved “Reusable welcome”');
    assert.equal(clips.length, 1); assert.equal(clips[0].folderId, folders[0].id);
    assert.deepEqual([clips[0].start, clips[0].end, clips[0].gain, clips[0].fadeIn, clips[0].fadeOut, clips[0].role], [1.25, 4.75, .4, .2, .3, 'intro']);
    assert.equal(clips[0].position, undefined); assert.deepEqual(episodes[0].arrangement, firstArrangement);
    await page.getByRole('button', { name: 'All episodes', exact: true }).click(); await openEpisode('Episode two');
    assert.deepEqual(await page.getByLabel('Episode recordings', { exact: true }).locator('option').allTextContents(), ['Choose a recording or music track', 'Second episode recording']);
    assert.equal(await page.locator('.timeline-source').filter({ hasText: 'First episode recording' }).count(), 0);
    await page.getByRole('button', { name: /^Saved library/ }).click();
    await page.getByLabel('Timeline library folder', { exact: true }).selectOption(folders[0].id);
    await page.getByLabel('Timeline playhead (seconds)', { exact: true }).fill('8');
    await page.getByRole('button', { name: 'Add Reusable welcome at playhead', exact: true }).tap(); await saved();
    let copies = episodes[1].arrangement.segments.filter(clip => clip.assetId === assets[0].id);
    assert.equal(copies.length, 1); assert.equal(copies[0].position, 8); assert.equal(copies[0].start, 1.25); assert.equal(copies[0].end, 4.75); assert.equal(copies[0].gain, .4);
    assert.deepEqual(await page.getByLabel('Episode recordings', { exact: true }).locator('option').allTextContents(), ['Choose a recording or music track', 'Second episode recording'], 'Using a saved edit keeps its full source recording with its original episode');
    await page.getByLabel('Timeline zoom', { exact: true }).selectOption('32'); await page.locator('.timeline-editor').scrollIntoViewIfNeeded();
    await page.locator('.timeline-source').filter({ hasText: 'Reusable welcome' }).dragTo(page.locator('[data-track="narration"]'), { targetPosition: { x: 64, y: 35 } }); await saved();
    copies = episodes[1].arrangement.segments.filter(clip => clip.assetId === assets[0].id); assert.equal(copies.length, 2); assert.equal(copies.find(clip => clip.trackId === 'narration').position, 2); assert.equal(new Set(copies.map(clip => clip.id)).size, 2);
    await page.getByRole('button', { name: 'Add saved clip to episode', exact: true }).click(); await saved();
    assert.equal(episodes[1].arrangement.segments.filter(clip => clip.assetId === assets[0].id).length, 3);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await saved();
    await page.locator('[data-track="narration"] .timeline-clip').click();
    await page.getByLabel('Trim start (seconds)', { exact: true }).fill('2'); await page.getByLabel('Clip name', { exact: true }).fill('This episode only'); await saved();
    assert.equal(clips[0].start, 1.25); assert.equal(clips[0].name, 'Reusable welcome'); assert.deepEqual(episodes[0].arrangement, firstArrangement);
    await page.getByLabel('New library folder', { exact: true }).fill('Favorites'); await page.getByRole('button', { name: 'Create folder', exact: true }).click(); await status('Folder created');
    await page.locator('.library-folder-nav').getByRole('button', { name: /^All clips/ }).click();
    let card = page.locator('.saved-library-clip').filter({ hasText: 'Reusable welcome' });
    await card.getByText('Rename or move', { exact: true }).click(); await card.getByLabel('Rename saved clip Reusable welcome', { exact: true }).fill('Reusable opening');
    await card.getByRole('button', { name: 'Rename saved clip', exact: true }).click(); await status('Library clip updated');
    card = page.locator('.saved-library-clip').filter({ hasText: 'Reusable opening' });
    await card.getByLabel('Folder for Reusable opening', { exact: true }).selectOption(folders[1].id); await status('Library clip updated'); assert.equal(clips[0].folderId, folders[1].id);
    await page.locator('.library-folder-nav').getByRole('button', { name: /^Intros/ }).click(); await page.getByText('Manage Intros', { exact: true }).click();
    await page.getByLabel('Folder name', { exact: true }).fill('Openings'); await page.getByRole('button', { name: 'Rename folder', exact: true }).click(); await status('Folder renamed');
    await page.getByRole('button', { name: 'Delete empty folder', exact: true }).click(); await status('Empty folder removed'); assert.equal(folders.length, 1);
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Remove saved clip Reusable opening', exact: true }).click(); await status('Clip removed from the reusable library');
    assert.equal(clips.length, 0); assert.equal(episodes[1].arrangement.segments.length, 3); assert.deepEqual(episodes[0].arrangement, firstArrangement);
    await page.reload(); await openEpisode('Episode two'); assert.equal(await page.locator('.timeline-clip').count(), 3);
    await page.getByRole('button', { name: 'Clip This episode only', exact: true }).click();
    for (const width of [320, 390, 600, 768, 820, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1100 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Folder library fits ${width}px`);
      assert.equal(await page.locator('.timeline-track-controls button').evaluateAll(buttons => buttons.every(button => { const bounds = button.getBoundingClientRect(); return bounds.width >= 44 && bounds.height >= 44; })), true, `Touch track controls are at least 44px at ${width}px`);
    }
    await page.locator('.reusable-library').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-results/audio-library-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await page.locator('.reusable-library').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-results/audio-library-mobile.png', fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log('PASS: Episode recording isolation, saving trimmed clips to folders, cross-episode button/drag reuse, independent edits, rename/move/remove, reload persistence and responsive library layouts.');
  } catch (error) { await page.screenshot({ path: 'test-results/audio-library-failure.png', fullPage: true }); console.error('Library browser diagnostics:', errors, unexpected); throw error; }
  finally { await context.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { mkdir } = await import('node:fs/promises'), { chromium } = await import('playwright');
  const { createApp } = await import('../server/app.js'), { db } = await import('../server/db.js');
  const app = await createApp(), server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); let browser;
  try {
    await mkdir('test-results', { recursive: true }); browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    await testAudioLibraryBrowser(browser, `http://127.0.0.1:${server.address().port}`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await db.end(); }
}
