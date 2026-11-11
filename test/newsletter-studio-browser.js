import assert from 'node:assert/strict';
import { renderNewsletter } from '../server/newsletter-template.js';

export async function testNewsletterStudioBrowser(page, origin) {
  let campaign, tested = false;
  const member = { email: 'friend@example.com', firstName: '', lastName: '', confirmedAt: '2026-11-01', consentAt: '2026-11-01', contactId: 'contact', unsubscribed: false };
  const sources = [{ key: 'page:about', category: 'Around Godly Homes', title: 'Faith takes root at home', body: 'Our story and mission.', href: 'https://godlyhomes.com/about', image: '', label: 'Read our story' }];
  await page.route('**/api/admin/newsletters/**', route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    const body = method === 'GET' ? {} : route.request().postDataJSON();
    if (path.endsWith('/catalog')) return route.fulfill({ json: { sources, ready: true, testReady: true } });
    if (path.endsWith('/campaigns')) {
      if (method === 'GET') return route.fulfill({ json: campaign ? [campaign] : [] });
      campaign = { id: 'draft', version: 1, state: 'draft', contentHash: 'hash', testHash: null, data: body.data };
      return route.fulfill({ json: campaign });
    }
    if (path.endsWith('/preview')) return route.fulfill({ json: { contentHash: campaign.contentHash, version: campaign.version, html: renderNewsletter({ data: campaign.data, brand: { name: 'Godly Homes', email: 'hello@godlyhomes.com' }, sections: sources, origin: 'https://godlyhomes.com' }, { test: true }).html } });
    if (path.endsWith('/test')) { tested = true; return route.fulfill({ json: { testHash: 'hash', testTo: body.to, message: 'Test email accepted.' } }); }
    if (path.endsWith('/members')) return route.fulfill({ json: { members: [member], total: 1, page: 1 } });
    if (path.endsWith('/invite')) return route.fulfill({ json: { message: 'Confirmation email requested.' } });
    if (path.endsWith('/action')) { assert.equal(body.action, 'profile'); member.firstName = body.firstName; return route.fulfill({ json: { message: 'Subscriber updated.' } }); }
    return route.fulfill({ json: campaign || {} });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/admin`);
  await page.getByRole('navigation', { name: 'Website administration' }).getByRole('button', { name: 'Newsletters & members', exact: true }).click();
  await page.getByRole('button', { name: 'Compose newsletter', exact: true }).click();
  await page.getByRole('button', { name: 'Navy & gold', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Navy & gold', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByLabel('Add site content', { exact: true }).selectOption('page:about');
  await page.getByRole('button', { name: 'Add highlight', exact: true }).click();
  await page.getByLabel('Organization mailing address', { exact: true }).fill('123 Example Street, Example City');
  await page.getByRole('button', { name: 'Save & preview', exact: true }).click();
  await page.frameLocator('iframe[title="Newsletter preview"]').getByRole('heading', { name: 'Good things for your home.' }).waitFor();
  assert.equal(campaign.data.theme, 'navy'); assert.equal(campaign.data.blocks[0].source, 'page:about');
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), '');
  assert.equal(await page.getByRole('button', { name: 'Send newsletter', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Send test email', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Test email accepted.' }).waitFor(); assert.equal(tested, true);
  await page.getByRole('button', { name: 'Mobile', exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Newsletter editor overflow at ${width}`);
  }
  await page.screenshot({ path: 'test-results/newsletter-studio-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/newsletter-studio-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Members', exact: true }).click();
  await page.getByRole('heading', { name: member.email, exact: true }).waitFor();
  await page.getByLabel('First name (optional)', { exact: true }).fill('Friend');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Subscriber updated.' }).waitFor(); assert.equal(member.firstName, 'Friend');
  await page.getByLabel('Invite a subscriber', { exact: true }).fill('new@example.com');
  await page.getByRole('button', { name: 'Send opt-in email', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Confirmation email requested.' }).waitFor();
  await page.setViewportSize({ width: 320, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Members fit a small phone');
  console.log('PASS: Newsletter theme selection, highlight inclusion, save/preview sandbox, test-before-send controls, member editing/invitations, and desktop/mobile layouts.');
}
