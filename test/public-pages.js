import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { defaultDocuments } from '../shared/website.js';

// Exercise the production server and built UI without connecting to any database.
const directory = await mkdtemp(path.join(os.tmpdir(), 'gh-pages-'));
process.env.MEDIA_DIR = path.join(directory, 'media');
const { createApp } = await import('../server/app.js');
const { db } = await import('../server/db.js');
const app = await createApp();
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const reflexions = [
  { id: 'reflection-1', slug: 'family-rhythm', title: 'A family rhythm', type: 'Article', description: 'A gentle practice for home.', imageUrl: 'https://example.com/family-rhythm.jpg', imageAlt: 'A family at a table', externalUrl: 'https://example.com/family-rhythm' },
  { id: 'reflection-2', slug: 'quiet-morning', title: 'A quiet morning', type: 'Guide', description: 'Start the day with grace.', imageUrl: 'https://example.com/quiet-morning.jpg', imageAlt: 'Morning light on a Bible', externalUrl: 'https://example.com/quiet-morning' },
];
let browser;
try {
  for (const route of ['/about', '/resources', '/store', '/checkout']) {
    assert.equal((await fetch(`${origin}${route}`)).status, 200, `Direct route: ${route}`);
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  await page.route('https://example.com/**', route => route.abort());
  await page.route('**/api/public/episodes', route => route.fulfill({ json: [] }));
  await page.route('**/api/public/website', route => route.fulfill({ json: { documents: defaultDocuments, resources: reflexions, products: [] } }));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mkdir('test-results', { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [route, title] of [['/about', 'About'], ['/resources', 'Reflexions'], ['/store', 'Store']]) {
      await page.goto(`${origin}${route}`);
      await page.getByRole('heading', { level: 1 }).waitFor();
      await page.getByRole('region', { name: 'Current announcement' }).waitFor();
      await page.waitForFunction(title => document.title.startsWith(title), title);
      await page.locator('.site-logo img').first().evaluate(img => img.decode());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow: ${route} at ${width}`);
      if (width < 1024) {
        await page.getByRole('button', { name: 'Open navigation' }).click();
        await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: title, exact: true }).waitFor();
        await page.getByRole('button', { name: 'Close navigation' }).click();
      } else {
        assert.equal(await page.getByRole('navigation', { name: 'Main navigation' }).locator('[aria-current="page"]').textContent(), title);
      }
      if (width !== 320) await page.screenshot({ path: `test-results/${title.toLowerCase()}-${width}.png`, fullPage: true });
    }
  }
  await page.goto(`${origin}/resources`);
  await page.locator('.resource-card').first().waitFor();
  assert.equal(await page.locator('.resource-card').count(), 2);
  await page.getByLabel('Search reflexions').fill('quiet');
  assert.equal(await page.locator('.resource-card').count(), 1);
  await page.getByLabel('Search reflexions').fill('no-such-resource');
  await page.getByRole('heading', { name: 'No resources found.' }).waitFor();
  await page.getByRole('button', { name: 'Show all reflexions' }).click();
  assert.equal(await page.locator('.resource-card').count(), 2);
  const external = page.getByRole('link', { name: 'Open A family rhythm in a new tab' });
  assert.equal(await external.getAttribute('href'), 'https://example.com/family-rhythm');
  assert.equal(await external.getAttribute('target'), '_blank');
  await page.goto(`${origin}/store`);
  await page.getByText('No products are available for purchase yet.').waitFor();
  assert.equal(await page.getByRole('button', { name: /buy|checkout|add to cart/i }).count(), 0);
  await page.goto(origin);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'About', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: /Faith takes root/ }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: Direct production routes, page titles, shared navigation, desktop/mobile layouts (1440/390/320), external Reflexion links/search and honest store availability.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await db.end();
  await rm(directory, { recursive: true, force: true });
}
