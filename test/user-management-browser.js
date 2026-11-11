import assert from 'node:assert/strict';
import { defaultDocuments } from '../shared/website.js';

export async function testUserManagementBrowser(page, origin) {
  page.on('pageerror', error => console.error('User management browser error:', error.message));
  await page.unroute('**/api/auth/**');
  let role = 'admin', requestStatus = 'none';
  const updates = [];
  const applicant = { id: 'applicant-id', email: 'applicant@example.com', role: 'member', version: 1, verified: true, disabled: false, createdAt: '2026-11-01T12:00:00Z', podcasterStatus: 'pending', podcasterMessage: 'Weekly conversations about faith and family.', podcasterFeedback: '' };
  await page.route('**/api/auth/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { user: { id: 'viewer-id', email: 'viewer@example.com', role }, csrf: 'browser-csrf' } });
    if (path.endsWith('/access/request')) { requestStatus = 'pending'; return route.fulfill({ json: { message: 'Request saved.' } }); }
    if (path.endsWith('/access')) return route.fulfill({ json: { podcasterStatus: requestStatus, podcasterFeedback: '' } });
    return route.fulfill({ json: {} });
  });
  await page.route('**/api/episodes', route => route.fulfill({ json: [] }));
  await page.route('**/api/assets', route => route.fulfill({ json: [] }));
  await page.route('**/api/admin/documents', route => route.fulfill({ json: Object.entries(defaultDocuments).map(([key, data]) => ({ key, data, version: 1 })) }));
  await page.route(/\/api\/admin\/users(?:\/|\?|$)/, route => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON(); updates.push(body);
      if (body.action === 'role') { applicant.role = body.role; applicant.podcasterStatus = 'approved'; }
      return route.fulfill({ json: { message: 'Account updated. Previous sessions have been signed out.' } });
    }
    return route.fulfill({ json: { users: [applicant], total: 1, page: 1 } });
  });
  await page.route('**/api/admin/episodes', route => route.fulfill({ json: [{ id: 'episode', title: 'Family episode', channelTitle: 'Family show', ownerEmail: 'author@example.com', updatedAt: '2026-11-01T12:00:00Z', version: 1, adminHidden: false, published: false }] }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/admin`);
  await page.getByLabel('Account role', { exact: true }).selectOption('junior_admin');
  await page.getByLabel('Your password to confirm access changes', { exact: true }).fill('owner-password-123');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Save role', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Account updated' }).waitFor();
  assert.equal(updates.at(-1).role, 'junior_admin');
  role = 'junior_admin'; applicant.role = 'member'; applicant.podcasterStatus = 'pending';
  await page.reload();
  await page.getByRole('button', { name: 'Approve podcaster', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Account role', { exact: true }).count(), 0);
  const nav = page.getByRole('navigation', { name: 'Website administration' });
  assert.equal(await nav.getByRole('button', { name: 'Orders', exact: true }).count(), 0);
  assert.equal(await nav.getByRole('button', { name: 'Store items', exact: true }).count(), 0);
  assert.equal(await nav.getByRole('button', { name: 'Newsletters & members', exact: true }).count(), 0);
  await nav.getByRole('button', { name: 'About page', exact: true }).click();
  await page.getByLabel('About headline', { exact: true }).waitFor();
  await nav.getByRole('button', { name: 'Podcast episodes', exact: true }).click();
  await page.getByRole('button', { name: 'Hide episode', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Delete episode', exact: true }).count(), 0);
  await nav.getByRole('button', { name: 'Users & approvals', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Approve podcaster', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Account updated' }).waitFor();
  assert.equal(updates.at(-1).approve, true);
  role = 'member';
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.goto(`${origin}/studio`);
  await page.getByLabel('Tell us about your podcast').fill('Weekly conversations about faith and family.');
  await page.getByRole('button', { name: 'Request podcaster access', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'awaiting review' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  role = 'admin';
  await page.goto(`${origin}/admin`);
  await page.getByLabel('Search by email', { exact: true }).waitFor();
  await page.getByLabel('Account role', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'User administration fits a small phone');
  console.log('PASS: User role assignment, junior approval/content/moderation controls, hidden store/customer controls, member application, and mobile user management.');
}
