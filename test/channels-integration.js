import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import request from 'supertest';
import { hashPassword } from '../server/auth.js';

export async function testChannels({ createApp, rows, origin, fixture, claimJob, processJob, adminAgent, adminMutate }) {
  const app = await createApp();
  const password = `test-${randomUUID()}`;
  const authors = [];
  for (const name of ['Alice', 'Beth']) {
    const id = randomUUID(), email = `${name.toLowerCase()}@channel-test.example`;
    await rows("INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'publisher')", [id, email, await hashPassword(password)]);
    const agent = request.agent(app), login = await agent.post('/api/auth/login').set('Origin', origin).send({ email, password });
    assert.equal(login.status, 200);
    authors.push({ id, name, email, agent, csrf: login.body.csrf, mutate: (method, url) => agent[method](url).set('Origin', origin).set('X-CSRF-Token', login.body.csrf) });
  }
  const [alice, beth] = authors;
  assert.equal((await request(app).get('/api/channel')).status, 401);
  assert.equal((await alice.agent.put('/api/channel').set('Origin', origin).send({})).status, 403);
  const data = name => ({ title: `${name} Family Podcast`, description: 'A channel for faith and family.', authorName: name, authorBio: `Meet ${name}, our author.`, authorImageUrl: '', authorLink: 'https://example.com/author', coverUrl: '', coverAlt: 'Channel artwork', accentColor: '#765432', spotifyUrl: `https://open.spotify.com/show/${name}Show123`, applePodcastsUrl: 'https://podcasts.apple.com/us/podcast/test-show/id123456', rssEmail: `${name.toLowerCase()}@podcast-owner.example` });
  let aliceChannel = (await alice.mutate('put', '/api/channel').send({ slug: 'alice-family', data: data('Alice'), isPublic: false, version: 0 })).body;
  assert.equal(aliceChannel.version, 1);
  assert.equal((await request(app).get('/api/public/channels/alice-family')).status, 404);
  assert.equal((await request(app).get('/channels/alice-family/feed.xml')).status, 404);
  assert.equal((await beth.agent.get('/api/channel')).body.channel, null);
  assert.equal((await beth.mutate('put', '/api/channel').send({ slug: 'alice-family', data: data('Beth'), isPublic: true, version: 0 })).status, 409);
  assert.equal((await beth.mutate('put', '/api/channel').send({ slug: 'beth-family', data: data('Beth'), isPublic: true, version: 0 })).status, 200);
  const seriesBody = { slug: 'family-rhythms', data: { title: 'Family Rhythms', description: 'Stories and practices for family life.', coverUrl: '', coverAlt: 'Series cover' } };
  const aliceSeries = (await alice.mutate('post', '/api/channel/series').send(seriesBody)).body;
  const bethSeries = (await beth.mutate('post', '/api/channel/series').send(seriesBody)).body;
  assert.ok(aliceSeries.id); assert.ok(bethSeries.id);
  assert.equal((await beth.agent.get('/api/channel')).body.series.length, 1);
  assert.equal((await alice.mutate('post', '/api/channel/images').attach('image', 'src/assets/godly-homes-logo.png')).status, 201);
  assert.equal((await alice.agent.get('/api/admin/documents')).status, 403);
  assert.equal((await beth.mutate('put', `/api/channel/series/${aliceSeries.id}`).send({ ...seriesBody, version: 1 })).status, 409);
  for (const [author, series] of [[alice, aliceSeries], [beth, bethSeries]]) {
    const source = await author.mutate('post', '/api/assets').attach('audio', fixture);
    assert.equal(source.status, 201);
    const created = await author.mutate('post', '/api/episodes');
    const draft = { ...created.body, title: `${author.name} episode`, seriesId: series.id,
      arrangement: { segments: [{ id: randomUUID(), assetId: source.body.id, name: 'Introduction', start: 0, end: 1, role: 'intro', gain: 1, fadeIn: 0, fadeOut: 0 }], music: { assetId: null, volume: .2, duck: true } } };
    assert.equal((await author.mutate('put', `/api/episodes/${draft.id}`).send({ ...draft, seriesId: author === alice ? bethSeries.id : aliceSeries.id })).status, 400);
    const saved = await author.mutate('put', `/api/episodes/${draft.id}`).send(draft);
    assert.equal(saved.status, 200);
    const rendering = await author.mutate('post', `/api/episodes/${draft.id}/render`);
    assert.equal(rendering.status, 202, JSON.stringify(rendering.body));
    const job = await claimJob(); assert.equal(job.id, rendering.body.id); await processJob(job);
    const publish = () => author.mutate('post', `/api/episodes/${draft.id}/publish`).send({ jobId: job.id });
    if (author === alice) {
      assert.equal((await publish()).status, 400);
      aliceChannel = (await alice.mutate('put', '/api/channel').send({ ...aliceChannel, isPublic: true })).body;
    }
    assert.equal((await publish()).status, 200);
    author.episode = saved.body; author.jobId = job.id;
  }
  const profile = await request(app).get('/api/public/channels/alice-family');
  assert.equal(profile.body.series.length, 1); assert.equal(profile.body.authorName, 'Alice');
  assert.equal(profile.body.spotifyUrl, 'https://open.spotify.com/show/AliceShow123');
  assert.equal((await alice.mutate('put', '/api/channel').send({ ...aliceChannel, data: { ...aliceChannel.data, spotifyUrl: 'https://example.com/show/not-spotify' } })).status, 400);
  assert.equal(profile.body.user_id, undefined); assert.equal(profile.body.email, undefined);
  const list = await request(app).get('/api/public/episodes?channel=alice-family&series=family-rhythms');
  assert.deepEqual(list.body.map(item => item.title), ['Alice episode']);
  assert.equal(list.body[0].channel.authorName, 'Alice'); assert.equal(list.body[0].series.id, aliceSeries.id);
  const mediaBeforePrivate = await request(app).get(`/media/${alice.episode.id}/${alice.jobId}.mp3`);
  assert.equal(mediaBeforePrivate.status, 200);
  assert.match(mediaBeforePrivate.headers['cache-control'], /private/);
  assert.match(mediaBeforePrivate.headers['cache-control'], /no-cache/);
  assert.equal((await beth.agent.get(`/api/jobs/${alice.jobId}/audio`)).status, 404);
  for (const feedPath of ['/channels/alice-family/feed.xml', '/channels/alice-family/series/family-rhythms/feed.xml']) {
    const response = await request(app).get(feedPath);
    assert.equal(response.status, 200); assert.ok(response.text.includes('Alice episode')); assert.ok(!response.text.includes('Beth episode'));
    assert.ok(response.text.includes(feedPath)); assert.match(response.text, /<itunes:author>Alice<\/itunes:author>/);
    assert.match(response.text, /<itunes:email>alice@podcast-owner.example<\/itunes:email>/);
  }
  const adminPath = `/api/admin/episodes/${alice.episode.id}`;
  assert.equal((await request(app).get('/api/admin/episodes')).status, 401);
  assert.equal((await alice.agent.get('/api/admin/episodes')).status, 403);
  assert.equal((await beth.mutate('put', `${adminPath}/visibility`).send({ hidden: true, expectedHidden: false })).status, 403);
  assert.equal((await beth.mutate('delete', adminPath).send({ version: alice.episode.version })).status, 403);
  assert.equal((await adminAgent.put(`${adminPath}/visibility`).set('Origin', origin).send({ hidden: true, expectedHidden: false })).status, 403);
  assert.equal((await adminMutate('put', `${adminPath}/visibility`).send({ hidden: 'yes', expectedHidden: false })).status, 400);
  assert.equal((await adminAgent.get('/api/admin/episodes')).body.some(e => e.id === alice.episode.id && e.ownerEmail === alice.email), true);
  assert.equal((await adminMutate('put', `${adminPath}/visibility`).send({ hidden: true, expectedHidden: false })).status, 200);
  assert.equal((await adminMutate('put', `${adminPath}/visibility`).send({ hidden: false, expectedHidden: false })).status, 409);
  assert.equal((await alice.agent.get('/api/episodes')).body.find(e => e.id === alice.episode.id).adminHidden, true);
  assert.equal((await request(app).get(`/api/public/episodes/${alice.episode.id}`)).status, 404);
  assert.equal((await request(app).get(`/media/${alice.episode.id}/${alice.jobId}.mp3`).set('If-None-Match', mediaBeforePrivate.headers.etag)).status, 404);
  assert.equal((await request(app).get('/api/public/episodes?channel=alice-family')).body.length, 0);
  assert.equal((await request(app).get('/api/public/channels/alice-family')).body.series.length, 0);
  for (const feedPath of ['/podcast/feed.xml', '/channels/alice-family/feed.xml', '/channels/alice-family/series/family-rhythms/feed.xml']) {
    assert.equal((await request(app).get(feedPath)).text.includes('Alice episode'), false);
  }
  assert.equal((await alice.mutate('post', `/api/episodes/${alice.episode.id}/publish`).send({ jobId: alice.jobId })).status, 200);
  assert.equal((await request(app).get(`/api/public/episodes/${alice.episode.id}`)).status, 404, 'Author republishing must not undo admin moderation');
  assert.equal((await adminMutate('put', `${adminPath}/visibility`).send({ hidden: false, expectedHidden: true })).status, 200);
  assert.equal((await request(app).get(`/api/public/episodes/${alice.episode.id}`)).status, 200);
  const privateCreated = await alice.mutate('post', '/api/episodes');
  assert.equal(privateCreated.status, 201, JSON.stringify(privateCreated.body));
  const privateDraft = privateCreated.body;
  assert.equal((await adminMutate('put', `/api/admin/episodes/${privateDraft.id}/visibility`).send({ hidden: true, expectedHidden: false })).status, 200);
  const restoreDraft = await adminMutate('put', `/api/admin/episodes/${privateDraft.id}/visibility`).send({ hidden: false, expectedHidden: true });
  assert.equal(restoreDraft.status, 200, JSON.stringify({ response: restoreDraft.body, draft: privateDraft.id, rows: await rows('SELECT id, admin_hidden FROM episodes WHERE id = ?', [privateDraft.id]) }));
  assert.equal((await request(app).get(`/api/public/episodes/${privateDraft.id}`)).status, 404, 'Restoring a draft must not publish it');
  assert.equal((await adminMutate('delete', `/api/admin/episodes/${privateDraft.id}`).send({ version: privateDraft.version + 1 })).status, 409);
  assert.equal((await adminMutate('delete', `/api/admin/episodes/${privateDraft.id}`).send({ version: privateDraft.version })).status, 200);
  const nextSeries = (await alice.mutate('post', '/api/channel/series').send({ ...seriesBody, slug: 'new-series' })).body;
  const resaved = await alice.mutate('put', `/api/episodes/${alice.episode.id}`).send({ ...alice.episode, seriesId: nextSeries.id });
  assert.equal(resaved.status, 200);
  assert.equal((await request(app).get(`/api/public/episodes/${alice.episode.id}`)).body.series.id, aliceSeries.id);
  assert.equal((await request(app).get('/api/public/channels/alice-family')).body.series.length, 1);
  const previous = aliceChannel;
  aliceChannel = (await alice.mutate('put', '/api/channel').send({ ...aliceChannel, isPublic: false })).body;
  assert.equal((await alice.mutate('put', '/api/channel').send(previous)).status, 409);
  assert.equal((await request(app).get(`/api/public/episodes/${alice.episode.id}`)).status, 404);
  assert.equal((await request(app).get(`/media/${alice.episode.id}/${alice.jobId}.mp3`)).status, 404);
  assert.equal((await request(app).get(`/media/${alice.episode.id}/${alice.jobId}.mp3`).set('If-None-Match', mediaBeforePrivate.headers.etag)).status, 404);
  assert.equal((await request(app).get('/channels/alice-family/feed.xml')).status, 404);
  assert.equal((await request(app).get('/podcast/feed.xml')).text.includes('Alice episode'), false);
  aliceChannel = (await alice.mutate('put', '/api/channel').send({ ...aliceChannel, isPublic: true })).body;

  if (process.env.RUN_BROWSER === '1') {
    const { chromium } = await import('playwright'), { config } = await import('../server/config.js');
    const previousOrigin = config.origin, server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}`; config.origin = url;
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedPodcastFeed = text; } } }); });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${url}/studio`);
      await page.getByLabel('Email', { exact: true }).fill(alice.email); await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in to your studio' }).click();
      assert.equal(await page.getByRole('button', { name: 'Website Admin', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'My channel', exact: true }).click();
      await page.getByLabel('Channel title', { exact: true }).fill('Alice’s Updated Channel');
      await page.getByLabel('Spotify show URL', { exact: true }).fill('https://open.spotify.com/show/AliceUpdated123');
      await page.getByRole('button', { name: 'Save profile & channel', exact: true }).click();
      await page.getByText('Your profile and channel settings are saved.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'New series', exact: true }).click();
      await page.getByLabel('Series title', { exact: true }).fill('Browser series');
      await page.getByLabel('Series description', { exact: true }).fill('A new podcast series from the author.');
      await page.getByRole('button', { name: 'Save series', exact: true }).click();
      await page.getByText('Series saved. Assign it to an episode in Review & publish.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Podcasts', exact: true }).click();
      await page.locator('.episode-open').filter({ hasText: 'Alice episode' }).click();
      await page.getByRole('tab', { name: '3. Review & publish' }).click();
      await page.getByRole('option', { name: 'Browser series', exact: true }).waitFor({ state: 'attached' });
      assert.equal(await page.getByLabel('Podcast series', { exact: true }).inputValue(), nextSeries.id);
      await page.getByRole('button', { name: 'My channel', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: 'My channel' }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await mkdir('test-results', { recursive: true });
      await page.screenshot({ path: 'test-results/author-channel-mobile.png', fullPage: true });
      for (const route of ['/channels', '/channels/alice-family', '/authors/alice-family', '/channels/alice-family/series/family-rhythms', `/podcast/${alice.episode.id}`]) {
        await page.goto(url + route);
        await page.getByRole('heading', { level: 1 }).waitFor();
        await page.getByText('Loading channel…').waitFor({ state: 'hidden' });
        if (route !== '/channels') {
          const spotify = page.getByRole('link', { name: /on Spotify \(opens/ });
          await spotify.waitFor();
          assert.equal(await spotify.getAttribute('href'), 'https://open.spotify.com/show/AliceUpdated123');
          assert.equal(await page.locator('a[href="https://open.spotify.com/show/BethShow123"]').count(), 0);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, route);
      }
      await page.goto(`${url}/channels/alice-family/series/family-rhythms`);
      await page.getByRole('heading', { level: 1, name: 'Family Rhythms' }).waitFor();
      await page.getByRole('link', { name: 'Alice episode', exact: true }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'Beth episode', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Copy RSS URL', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'RSS feed URL copied.' }).waitFor();
      assert.equal(await page.evaluate(() => window.copiedPodcastFeed), `${url}/channels/alice-family/series/family-rhythms/feed.xml`);
      await page.getByText('Use another podcast app', { exact: true }).click();
      assert.equal(await page.getByLabel('RSS feed URL', { exact: true }).inputValue(), `${url}/channels/alice-family/series/family-rhythms/feed.xml`);
      await page.screenshot({ path: 'test-results/author-series-mobile.png', fullPage: true });
      await page.goto(`${url}/channels/beth-family`);
      await page.getByRole('link', { name: /on Spotify \(opens/ }).waitFor();
      assert.equal(await page.getByRole('link', { name: /on Spotify \(opens/ }).getAttribute('href'), 'https://open.spotify.com/show/BethShow123');
      const bethChannel = (await beth.agent.get('/api/channel')).body.channel;
      assert.equal((await beth.agent.put('/api/channel').set('Origin', url).set('X-CSRF-Token', beth.csrf).send({ ...bethChannel, data: { ...bethChannel.data, spotifyUrl: '' } })).status, 200);
      await page.reload();
      await page.getByRole('heading', { level: 1, name: 'Beth Family Podcast' }).waitFor();
      assert.equal(await page.getByRole('link', { name: /on Spotify \(opens/ }).count(), 0);
      await page.goto(url);
      await page.getByRole('heading', { level: 1 }).waitFor();
      assert.equal(await page.getByRole('link', { name: /on Spotify \(opens/ }).count(), 0);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); config.origin = previousOrigin; }
  }
  assert.equal((await adminMutate('delete', `/api/admin/episodes/${beth.episode.id}`).send({ version: beth.episode.version })).status, 200);
  assert.equal((await request(app).get(`/api/public/episodes/${beth.episode.id}`)).status, 404);
  assert.equal((await request(app).get(`/media/${beth.episode.id}/${beth.jobId}.mp3`)).status, 404);
  assert.equal((await rows('SELECT id FROM render_jobs WHERE episode_id = ?', [beth.episode.id])).length, 0);
  assert.ok((await beth.agent.get('/api/assets')).body.length, 'Admin deletion preserves original sources');
  console.log('PASS: Admin cross-channel episode visibility/deletion, publisher and CSRF protection, hidden RSS/media protection, republish moderation, safe draft restoration and stale deletion prevention.');
  // Remove these isolated author publications so the remaining suite uses its original fixtures.
  for (const author of authors) await author.mutate('post', `/api/episodes/${author.episode.id}/unpublish`);
  console.log('PASS: Author-owned profiles/channels/series, publisher branding access, isolated series assignment, publication snapshots, private-channel media/RSS protection, channel/series RSS and mobile author pages.');
}
