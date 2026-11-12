// Focused UI contract test; database/payment/email behavior is covered by commerce-integration.js.
import assert from 'node:assert/strict';
import { preview } from 'vite';
import { chromium } from 'playwright';
import { defaultDocuments } from '../shared/website.js';

const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], updates = [];
  page.on('pageerror', error => errors.push(error.message));
  const order = { id: 'order', item: { title: 'Family journal', kind: 'physical', quantity: 1 }, amountTotal: 1700, currency: 'USD', paymentStatus: 'paid', fulfillmentStatus: 'ready', refundStatus: 'none', disputeStatus: 'none', amountRefunded: 0, email: 'buyer@example.com', name: 'Test buyer', createdAt: '2026-11-01', notes: '', sessionId: 'cs_test', testMode: true, version: 1, canFulfill: true };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let json = [];
    if (path === '/api/auth/me') json = { user: { id: 'admin', email: 'admin@example.com', role: 'admin' }, csrf: 'test-csrf' };
    else if (path === '/api/public/website') json = { documents: defaultDocuments, products: [], resources: [] };
    else if (path === '/api/admin/documents') json = Object.entries(defaultDocuments).map(([key, data]) => ({ key, data, version: 1 }));
    else if (path === '/api/admin/users') json = { users: [], page: 1, total: 0 };
    else if (path === '/api/admin/commerce/orders') json = { items: [order], hasMore: false };
    else if (path === '/api/admin/commerce/orders/order' && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON(); updates.push(body);
      Object.assign(order, body, { version: order.version + 1 });
      if (body.fulfillmentStatus === 'shipped') Object.assign(order, { shippedAt: '2026-11-11T12:00:00Z', shipmentEmailSentAt: '2026-11-11T12:00:00Z' });
      if (body.fulfillmentStatus === 'fulfilled') order.deliveredAt = '2026-11-11T18:00:00Z';
      json = { ok: true, message: 'Shipment confirmation sent to the buyer.' };
    } else if (path === '/api/store/orders/order') json = order;
    return route.fulfill({ json });
  });
  await page.goto(`${origin}/admin`);
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  await page.locator('.commerce-order summary').click();
  await page.getByLabel('Shipping carrier').fill('USPS');
  await page.getByLabel('Tracking number').fill('9400111899223856928499');
  assert.equal(await page.getByRole('option', { name: 'Completed — delivered to buyer' }).count(), 0);
  await page.getByLabel('Fulfillment status').selectOption('shipped');
  await page.getByRole('button', { name: 'Save fulfillment' }).click();
  await page.getByRole('status').filter({ hasText: 'Shipment confirmation sent' }).waitFor();
  assert.equal(updates[0].trackingNumber, '9400111899223856928499');
  await page.locator('.commerce-order summary').click();
  assert.equal(await page.getByLabel('Tracking number').isDisabled(), true);
  await page.getByLabel('Fulfillment status').selectOption('fulfilled');
  await page.getByRole('button', { name: 'Save fulfillment' }).click();
  await page.locator('.commerce-order summary').filter({ hasText: 'Completed' }).waitFor();
  assert.equal(updates[1].fulfillmentStatus, 'fulfilled');
  await page.goto(`${origin}/checkout?order=order&token=test`);
  await page.getByText('Your order is complete. Your item has been delivered.', { exact: true }).waitFor();
  await page.getByText(/Tracking number: 9400111899223856928499/).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('PASS: Mobile shipment tracking entry, shipment confirmation, delivery completion, buyer tracking and no browser errors.');
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
