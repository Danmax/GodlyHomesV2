import assert from 'node:assert/strict';
import { defaultDocuments } from '../shared/website.js';

// Populated screens catch intrinsic-width problems that empty lists cannot reveal.
export async function testMobilePages(browser, origin) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [], failures = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  const word = 'FamilyReflections'.repeat(5);
  const channel = { slug: 'family', title: word, description: 'Conversations about faith and family.', authorName: word, authorBio: 'Encouragement for everyday life.', accentColor: '#55644c', spotifyUrl: 'https://open.spotify.com/show/family', series: [{ id: 'series', slug: 'home', title: word, description: 'Life at home.' }] };
  const episode = { id: 'episode', title: word, number: 1, duration: 60, description: 'Faith and family. '.repeat(20), publishedAt: '2026-11-01', updatedAt: '2026-11-01', version: 1, channel, series: channel.series[0], arrangement: { segments: [{ id: 'segment', assetId: 'asset', name: word, role: 'segment', start: 0, end: 60, gain: 1, fadeIn: 0, fadeOut: 0 }], music: { assetId: null, volume: .2, duck: true } } };
  const product = { id: 'product', slug: 'home-guide', title: word, description: 'A guide for your home.', kind: 'digital', priceCents: 1500, currency: 'USD', imageUrl: '', checkoutUrl: '' };
  const order = { id: 'order', item: { ...product, quantity: 1 }, amountTotal: 1500, currency: 'USD', paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled', refundStatus: 'none', disputeStatus: 'none', email: `${word}@example.com`, name: word, createdAt: '2026-11-01', notes: '', sessionId: 'cs_test_example', testMode: true };
  let signedIn = false;
  await page.route(/https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort());
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    let json;
    if (path === '/api/public/website') json = { documents: defaultDocuments, resources: [{ id: 'resource', slug: 'family', title: word, type: 'Article', description: 'A reflection for families.', externalUrl: 'https://example.com/resource', imageUrl: '', imageAlt: '' }], products: [product] };
    else if (path === '/api/auth/me') return route.fulfill(signedIn ? { json: { user: { id: 'viewer', email: 'viewer@example.com', role: 'admin' }, csrf: 'test-csrf' } } : { status: 401, json: { error: 'Sign in to continue.' } });
    else if (path === '/api/auth/options') json = { emailEnabled: true, registrationEnabled: true };
    else if (path === '/api/public/channels') json = [channel];
    else if (path.startsWith('/api/public/channels/')) json = channel;
    else if (path === '/api/public/episodes') json = [episode];
    else if (path.startsWith('/api/public/episodes/')) json = episode;
    else if (path.startsWith('/api/store/orders/')) json = order;
    else if (path === '/api/episodes') json = [episode];
    else if (path === '/api/assets') json = [{ id: 'asset', name: word, duration: 60, url: '/fixture-audio' }];
    else if (path === '/api/studio-tools/options') json = { introEnabled: false, voices: ['marin', 'cedar', 'coral', 'sage'] };
    else if (path.endsWith('/jobs')) json = [];
    else if (path === '/api/channel') json = { channel: { slug: 'family', version: 1, isPublic: true, data: channel }, series: channel.series.map(item => ({ ...item, data: item })) };
    else if (path === '/api/admin/documents') json = Object.entries(defaultDocuments).map(([key, data]) => ({ key, data, version: 1 }));
    else if (path === '/api/admin/users') json = { users: [], total: 0, page: 1 };
    else if (path === '/api/admin/episodes') json = [];
    else if (path.startsWith('/api/admin/entries/')) json = [];
    else if (path === '/api/admin/commerce/status') json = { connected: true, configured: true, events: [], webhookUrl: `${origin}/api/store/webhook` };
    else if (path === '/api/admin/commerce/catalog') json = { items: [{ ...product, priceId: 'price_test' }], next: null };
    else if (path === '/api/admin/commerce/discounts') json = { items: [] };
    else if (path === '/api/admin/commerce/orders') json = { items: [order], hasMore: false };
    else if (path.endsWith('/newsletters/campaigns')) json = [];
    else if (path.endsWith('/newsletters/catalog')) json = { sources: [], ready: true, testReady: true };
    else { unexpected.push(path); return route.fulfill({ status: 404, json: { error: `Unexpected fixture request: ${path}` } }); }
    return route.fulfill({ json });
  });
  async function check(label, width) {
    await page.evaluate(() => document.fonts.ready);
    const problems = await page.evaluate(() => {
      const outside = [...document.querySelectorAll('h1,h2,h3,p,a,button,input,select,textarea,audio')].filter(el => {
        if (!el.getClientRects().length || el.closest('.skip-link, .sr-only')) return false;
        const rect = el.getBoundingClientRect();
        return rect.right > innerWidth + 1 || rect.left < -1;
      }).map(el => `${el.tagName}.${el.className}: ${el.textContent.slice(0, 70)}`);
      const smallFields = [...document.querySelectorAll('input:not([type=checkbox]):not([type=range]):not([type=file]):not([type=color]),select,textarea')].filter(el => el.getClientRects().length && parseFloat(getComputedStyle(el).fontSize) < 16).length;
      const smallButtons = [...document.querySelectorAll('.btn,.tabs button,.admin-nav button,.newsletter-theme')].filter(el => el.getClientRects().length && el.getBoundingClientRect().height < 44).length;
      return { overflow: document.documentElement.scrollWidth > innerWidth, outside, smallFields, smallButtons };
    });
    if (problems.overflow || problems.outside.length || (width <= 600 && (problems.smallFields || problems.smallButtons))) failures.push({ label, width, ...problems });
  }
  try {
    for (const width of [320, 390, 768, 1024, 1440]) {
      console.log(`Reviewing populated screens at ${width}px…`);
      await page.setViewportSize({ width, height: 900 });
      signedIn = false;
      for (const [path, ready] of [['/', '.podcast-subscriptions'], ['/about', '.about-connect'], ['/resources', '.resource-card'], ['/resources/old-link', '.not-found-actions'], ['/store', '.product-card'], ['/store/home-guide', '.product-detail'], ['/checkout?order=order&token=test', '.commerce-code'], ['/channels', '.resource-grid .card'], ['/channels/family', '.author-spotlight'], ['/channels/family/series/home', '.author-spotlight'], ['/authors/family', '.author-spotlight'], ['/podcast/episode', '.public-episode article'], ['/store/missing', '.not-found-actions'], ['/account', 'input[type=email]'], ['/studio', 'input[type=email]']]) {
        await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
        await page.locator(ready).first().waitFor();
        await check(path, width);
      }
      signedIn = true;
      await page.goto(`${origin}/admin`);
      await page.getByRole('navigation', { name: 'Website administration' }).waitFor();
      const nav = page.getByRole('navigation', { name: 'Website administration' });
      const labels = await nav.getByRole('button').allTextContents();
      for (const label of labels) {
        await nav.getByRole('button', { name: label, exact: true }).click();
        await page.locator('.admin-content').waitFor();
        await page.getByText(/^(Loading|Checking Stripe connection)/).waitFor({ state: 'hidden' });
        await check(`Admin: ${label}`, width);
        if (label === 'Reflexions' || label === 'Store items') {
          await page.getByRole('button', { name: label === 'Reflexions' ? 'New reflexion' : 'New store item', exact: true }).click();
          await page.getByLabel('Title', { exact: true }).waitFor();
          await check(`Admin editor: ${label}`, width);
        }
        if (label === 'Orders') {
          await page.locator('.commerce-order summary').click();
          await check('Admin: expanded order', width);
        }
      }
      await page.goto(`${origin}/studio`);
      await page.locator('.episode-open').click();
      for (const name of ['1. Record', '2. Arrange & edit', '3. Review & publish']) {
        await page.getByRole('tab', { name, exact: true }).click();
        await check(`Studio: ${name}`, width);
      }
      await page.getByRole('button', { name: 'My channel', exact: true }).click();
      await page.getByLabel('Channel title', { exact: true }).waitFor();
      await check('My channel', width);
      await page.getByRole('button', { name: 'New series', exact: true }).click();
      await page.getByLabel('Series title', { exact: true }).waitFor();
      await check('Series editor', width);
      if (width === 390) await page.screenshot({ path: 'test-results/channel-editor-mobile.png', fullPage: true });
    }
    await page.setViewportSize({ width: 667, height: 320 });
    await page.goto(`${origin}/about`);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const lastLink = page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link').last();
    await lastLink.scrollIntoViewIfNeeded();
    const bounds = await lastLink.boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 321, 'The last navigation link is reachable on a short landscape screen');
    await lastLink.click();
    await page.waitForURL(`${origin}/#join`);
    assert.deepEqual(unexpected, [], 'All API requests use isolated fixtures');
    assert.deepEqual(errors, [], 'No browser errors');
    assert.deepEqual(failures, [], 'All page content stays within the viewport; phone fields avoid focus zoom');
    console.log('PASS: All public route types, all admin sections/editors, studio workflow and channel/series editors at 320/390/768/1024/1440px, populated with long titles.');
  } finally { await context.close(); }
}
