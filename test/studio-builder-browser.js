import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { defaultDocuments } from '../shared/website.js';

export async function testStudioBuilderBrowser(browser, origin) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  const wav = Buffer.alloc(44 + 24000 * 10 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 240000; i++) wav.writeInt16LE(Math.round(Math.sin(i / 24000 * 440 * Math.PI * 2) * 6000), 44 + i * 2);
  await page.route('**/fixture-audio', route => route.fulfill({ contentType: 'audio/wav', body: wav }));
  const asset = name => ({ id: randomUUID(), name, duration: 10, bytes: wav.length, url: '/fixture-audio' });
  let assets = [asset('Sunday recording'), asset('Music bed')], voiceEnabled = true;
  let episode = { id: randomUUID(), title: 'Family rhythms', number: 1, description: '', updatedAt: '2026-11-11', version: 1, seriesId: null, arrangement: { segments: [{ id: randomUUID(), assetId: assets[0].id, name: assets[0].name, role: 'segment', start: 0, end: 10, gain: 1, fadeIn: 0, fadeOut: 0 }], music: { assetId: null, volume: .2, duck: true } } };
  const generated = asset('AI intro — marin');
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    let json;
    if (path === '/api/public/website') json = { documents: defaultDocuments, resources: [], products: [] };
    else if (path === '/api/auth/me') json = { user: { id: randomUUID(), role: 'publisher', email: 'author@example.com' }, csrf: 'test-csrf' };
    else if (path === '/api/episodes') json = [episode];
    else if (path === '/api/assets') { if (method === 'POST') { const uploaded = asset('Uploaded intro.wav'); assets.unshift(uploaded); json = uploaded; } else json = assets; }
    else if (path === `/api/episodes/${episode.id}`) { episode = { ...episode, ...route.request().postDataJSON(), version: episode.version + 1 }; json = episode; }
    else if (path.endsWith('/jobs')) json = [];
    else if (path === '/api/studio-tools/options') json = { introEnabled: voiceEnabled, voices: ['marin', 'cedar'] };
    else if (path.endsWith('/analyze')) json = { silences: [{ start: 3, end: 4 }] };
    else if (path.startsWith('/api/studio-tools/assets/') && method === 'PATCH') { const id = path.split('/').at(-1); assets = assets.map(a => a.id === id ? { ...a, name: route.request().postDataJSON().name } : a); json = assets.find(a => a.id === id); }
    else if (path.endsWith('/intro/script')) json = { script: 'Welcome to our show. Today we are talking about family rhythms.' };
    else if (path.endsWith('/intro/voice')) { assets.unshift(generated); json = generated; }
    else { unexpected.push(path); return route.fulfill({ status: 404, json: { error: `Unexpected fixture: ${path}` } }); }
    return route.fulfill({ json });
  });
  const saved = () => page.getByText('Saved just now', { exact: true }).waitFor();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/studio`);
    await page.locator('.episode-open').click();
    await page.getByRole('tab', { name: '2. Arrange & edit' }).click();
    await page.getByLabel('Add as', { exact: true }).selectOption('intro');
    await page.locator('input[type=file][multiple]').setInputFiles({ name: 'Intro.wav', mimeType: 'audio/wav', buffer: Buffer.from('isolated-upload-fixture') });
    await page.getByRole('status').filter({ hasText: '1 file uploaded' }).waitFor();
    assert.equal(await page.locator('.segment-name').count(), 2);
    assert.equal(episode.arrangement.segments[0].role, 'intro');
    await page.getByLabel('Recording name', { exact: true }).fill('Welcome music');
    await page.getByRole('button', { name: 'Rename recording', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Recording renamed' }).waitFor();
    assert.equal(assets[0].name, 'Welcome music');
    await page.getByLabel('Clip name', { exact: true }).fill('Opening welcome');
    await saved(); assert.equal(episode.arrangement.segments[0].name, 'Opening welcome');
    await page.getByRole('slider', { name: 'Seek in waveform' }).press('ArrowRight');
    assert.ok(Number(await page.getByRole('slider', { name: 'Seek in waveform' }).inputValue()) > 0, 'Waveform supports keyboard seeking');
    await page.getByRole('button', { name: 'Analyze pauses', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '2 resulting clips' }).waitFor();
    await page.getByRole('button', { name: 'Apply suggested edits', exact: true }).click();
    await saved(); assert.equal(episode.arrangement.segments.length, 3);
    assert.equal(episode.arrangement.segments.reduce((sum, s) => sum + s.end - s.start, 0), 20);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await saved(); assert.equal(episode.arrangement.segments.length, 2);
    await page.getByLabel('Smart edit action').selectOption('tighten');
    await page.getByRole('button', { name: 'Analyze pauses', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '0.7 seconds removed' }).waitFor();
    await page.getByRole('button', { name: 'Apply suggested edits', exact: true }).click();
    await saved(); assert.ok(episode.arrangement.segments.reduce((sum, s) => sum + s.end - s.start, 0) < 20);
    const count = episode.arrangement.segments.length;
    await page.getByLabel('Audio library').selectOption(assets.find(a => a.name === 'Music bed').id);
    await page.getByLabel('Add as', { exact: true }).selectOption('music');
    await page.getByRole('button', { name: 'Use as background music', exact: true }).click();
    await saved(); assert.equal(episode.arrangement.segments.length, count);
    await page.getByRole('button', { name: 'Apply auto mix', exact: true }).click();
    await saved(); assert.equal(episode.arrangement.autoLevel, true); assert.equal(episode.arrangement.music.volume, .12);
    await page.getByText('Intro Generator', { exact: true }).click();
    await page.getByRole('button', { name: 'Build starter script', exact: true }).click();
    assert.match(await page.getByLabel('Intro script', { exact: true }).inputValue(), /Family rhythms/);
    await page.getByRole('button', { name: 'Save intro script', exact: true }).click();
    await saved(); assert.ok(episode.arrangement.introDraft.script);
    await page.getByRole('button', { name: 'Generate AI script', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some(el => el.value.startsWith('Welcome to our show')));
    await page.getByRole('button', { name: 'Generate voice preview', exact: true }).click();
    await page.getByRole('button', { name: 'Add this intro to episode', exact: true }).waitFor();
    assert.equal(episode.arrangement.segments.length, count, 'Generating an intro does not add it before review');
    await page.getByRole('button', { name: 'Add this intro to episode', exact: true }).click();
    await saved(); assert.equal(episode.arrangement.segments[0].assetId, generated.id);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Studio tools fit ${width}px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('.studio-header').count(), 1);
    await page.getByLabel('Intro script', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/studio-builder-mobile.png' });
    voiceEnabled = false;
    await page.reload(); await page.locator('.episode-open').click();
    await page.getByRole('tab', { name: '2. Arrange & edit' }).click();
    await page.getByText('Intro Generator', { exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'voice service' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Generate voice preview', exact: true }).isDisabled(), true);
    assert.ok(await page.getByLabel('Intro script', { exact: true }).inputValue(), 'Saved script survives reload');
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    console.log('PASS: Mobile studio uploads, library/clip renaming, suggested splits/tightening and Undo, music placement, auto mix, saved scripts, reviewed voice insertion and unavailable-provider controls.');
  } finally { await context.close(); }
}
