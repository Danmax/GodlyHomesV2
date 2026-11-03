import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import Stripe from 'stripe';
import request from 'supertest';

// Called only by the isolated MySQL integration runner. Stripe network calls
// are replaced, but signatures use the real SDK and requests use the real app.
export async function testCommerce({ createApp, rows, origin, password }) {
  const sdk = new Stripe('sk_test_integration_not_a_real_key');
  const webhookSecret = 'whsec_isolated_integration';
  const product = { id: 'prod_integration', active: true, name: 'Family journal', description: 'A journal for families.', images: [], shippable: null };
  const price = { id: 'price_integration', active: true, type: 'one_time', unit_amount: 1200, currency: 'usd', livemode: false, product };
  const sessions = new Map(), calls = [];
  let failCreation = false, shippingCurrency = 'usd';
  const stripeClient = {
    webhooks: sdk.webhooks,
    accounts: { retrieve: async () => ({ charges_enabled: true, business_profile: { name: 'Integration store' } }) },
    prices: { retrieve: async () => structuredClone(price), list: async () => ({ data: [price, { ...price, id: 'price_recurring', type: 'recurring' }], has_more: false }) },
    shippingRates: { retrieve: async id => ({ id, active: true, type: 'fixed_amount', livemode: false, fixed_amount: { amount: 500, currency: shippingCurrency } }), list: async () => ({ data: [], has_more: false }) },
    checkout: { sessions: {
      create: async (params, options) => {
        calls.push({ params, options });
        const session = { id: `cs_test_${randomUUID()}`, mode: 'payment', metadata: params.metadata, client_reference_id: params.client_reference_id,
          currency: 'usd', amount_total: price.unit_amount, livemode: false, payment_status: 'unpaid', status: 'open', url: 'https://checkout.stripe.com/c/pay/integration' };
        sessions.set(session.id, session);
        if (failCreation) throw Object.assign(new Error('Simulated ambiguous network timeout'), { type: 'StripeConnectionError' });
        return structuredClone(session);
      },
      retrieve: async id => structuredClone(sessions.get(id)),
    } },
  };
  const app = await createApp({ stripeClient, commerceSettings: { webhookSecret, automaticTax: false } });
  const admin = request.agent(app), publisher = request.agent(app);
  const login = await admin.post('/api/auth/login').set('Origin', origin).send({ email: 'test@godlyhomes.com', password });
  const other = await publisher.post('/api/auth/login').set('Origin', origin).send({ email: 'other@godlyhomes.com', password });
  const mutate = (method, url) => admin[method](url).set('Origin', origin).set('X-CSRF-Token', login.body.csrf);
  assert.equal((await request(app).get('/api/admin/commerce/orders')).status, 401);
  for (const endpoint of ['catalog', 'orders', 'status', 'shipping-rates']) assert.equal((await publisher.get(`/api/admin/commerce/${endpoint}`)).status, 403);
  assert.equal((await publisher.post('/api/admin/commerce/import').set('Origin', origin).set('X-CSRF-Token', other.body.csrf).send({ priceId: price.id, kind: 'digital' })).status, 403);
  assert.equal((await admin.post('/api/admin/commerce/import').set('Origin', origin).send({ priceId: price.id, kind: 'digital' })).status, 403);
  const status = await admin.get('/api/admin/commerce/status'); assert.equal(status.status, 200); assert.equal(status.body.webhookConfigured, true);
  assert.equal(status.body.connected, true);
  const listPrices = stripeClient.prices.list, retrieveAccount = stripeClient.accounts.retrieve;
  stripeClient.prices.list = async () => { throw { type: 'StripeAuthenticationError', statusCode: 401, message: 'Invalid API key: NEVER_EXPOSE_THIS_KEY' }; };
  const rejectedKey = await admin.get('/api/admin/commerce/status');
  assert.equal(rejectedKey.status, 200); assert.equal(rejectedKey.body.configured, true); assert.equal(rejectedKey.body.connected, false);
  assert.equal(rejectedKey.body.connectionError.code, 'authentication_failed'); assert.match(rejectedKey.body.connectionError.message, /STRIPE_SECRET_KEY/);
  assert.ok(!JSON.stringify(rejectedKey.body).includes('NEVER_EXPOSE_THIS_KEY'));
  stripeClient.prices.list = async () => { throw { type: 'StripePermissionError', statusCode: 403 }; };
  assert.equal((await admin.get('/api/admin/commerce/status')).body.connectionError.code, 'permission_denied');
  stripeClient.prices.list = async () => { throw { type: 'StripeConnectionError' }; };
  assert.equal((await admin.get('/api/admin/commerce/status')).body.connectionError.code, 'connection_failed');
  stripeClient.prices.list = listPrices;
  stripeClient.accounts.retrieve = async () => { throw { type: 'StripePermissionError', statusCode: 403 }; };
  const restrictedKey = await admin.get('/api/admin/commerce/status');
  assert.equal(restrictedKey.status, 200); assert.equal(restrictedKey.body.connected, true); assert.equal(restrictedKey.body.account, null); assert.ok(restrictedKey.body.accountWarning);
  stripeClient.accounts.retrieve = retrieveAccount;
  assert.equal((await admin.get('/api/admin/commerce/catalog')).body.items.length, 1);
  const imported = await mutate('post', '/api/admin/commerce/import').send({ priceId: price.id, kind: 'digital' });
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  const again = await mutate('post', '/api/admin/commerce/import').send({ priceId: price.id, kind: 'physical' });
  assert.equal(again.status, 200); assert.equal(again.body.id, imported.body.id);
  const itemId = imported.body.id;
  let item = (await admin.get('/api/admin/entries/product')).body.find(entry => entry.id === itemId);
  assert.equal(item.status, 'draft'); assert.equal(item.data.kind, 'digital');
  const buy = extra => request(app).post('/api/store/checkout').set('Origin', origin).send({ productId: itemId, ...extra });
  assert.equal((await buy()).status, 404);
  assert.equal((await request(app).post('/api/store/checkout').send({ productId: itemId })).status, 403);
  const publish = await mutate('put', `/api/admin/entries/product/${itemId}`).send({ ...item, status: 'published' });
  assert.equal(publish.status, 200); item = publish.body;
  assert.equal((await buy({ priceCents: 1, stripePriceId: 'price_attacker', quantity: 100 })).status, 201);
  const { params, options } = calls.at(-1);
  assert.deepEqual(params.line_items, [{ price: price.id, quantity: 1 }]);
  assert.equal(params.automatic_tax.enabled, false); assert.equal(params.shipping_options, undefined);
  assert.match(options.idempotencyKey, /godly-homes-order-/);
  const success = new URL(params.success_url), orderId = success.searchParams.get('order'), token = success.searchParams.get('token');
  assert.equal(success.origin, origin);
  const [sessionId, session] = [...sessions].at(-1);
  const publicStatus = () => request(app).get(`/api/store/orders/${orderId}?token=${token}`);
  assert.equal((await publicStatus()).body.paymentStatus, 'pending');
  assert.equal((await request(app).get(`/api/store/orders/${orderId}?token=${'a'.repeat(64)}`)).status, 404);
  let order = (await admin.get('/api/admin/commerce/orders')).body.items.find(order => order.id === orderId);
  assert.equal((await mutate('patch', `/api/admin/commerce/orders/${orderId}`).send({ version: order.version, fulfillmentStatus: 'fulfilled', notes: '' })).status, 409);
  const notify = (type, eventId = `evt_${randomUUID()}`, secret = webhookSecret, timestamp) => {
    const payload = JSON.stringify({ id: eventId, type, data: { object: { id: sessionId } } });
    const signature = sdk.webhooks.generateTestHeaderString({ payload, secret, ...(timestamp ? { timestamp } : {}) });
    return request(app).post('/api/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', signature).send(payload);
  };
  assert.equal((await notify('checkout.session.completed', undefined, 'wrong_secret')).status, 400);
  assert.equal((await notify('checkout.session.completed', undefined, webhookSecret, Math.floor(Date.now() / 1000) - 1000)).status, 400);
  assert.equal((await publicStatus()).body.paymentStatus, 'pending');
  session.status = 'complete';
  assert.equal((await notify('checkout.session.completed')).status, 200);
  assert.equal((await publicStatus()).body.paymentStatus, 'pending'); // delayed payment
  session.payment_status = 'paid'; session.customer_details = { email: 'buyer@example.com', name: 'Test buyer' };
  const eventId = `evt_${randomUUID()}`;
  const concurrent = await Promise.all([notify('checkout.session.async_payment_succeeded', eventId), notify('checkout.session.async_payment_succeeded', eventId)]);
  assert.deepEqual(concurrent.map(response => response.status), [200, 200]);
  assert.equal((await rows('SELECT event_id FROM stripe_webhook_events WHERE event_id = ?', [eventId])).length, 1);
  let publicOrder = (await publicStatus()).body;
  assert.equal(publicOrder.paymentStatus, 'paid'); assert.equal(publicOrder.email, undefined); assert.equal(publicOrder.shipping, undefined); assert.equal(publicOrder.testMode, true);
  assert.equal((await notify('checkout.session.expired')).status, 200);
  assert.equal((await publicStatus()).body.paymentStatus, 'paid');
  order = (await admin.get('/api/admin/commerce/orders')).body.items.find(order => order.id === orderId);
  assert.equal(order.email, 'buyer@example.com');
  assert.equal((await mutate('patch', `/api/admin/commerce/orders/${orderId}`).send({ version: order.version, fulfillmentStatus: 'fulfilled', notes: 'Sent the journal.' })).status, 200);
  assert.equal((await mutate('patch', `/api/admin/commerce/orders/${orderId}`).send({ version: order.version, fulfillmentStatus: 'fulfilled', notes: 'Stale notes' })).status, 409);
  assert.equal((await publicStatus()).body.fulfillmentStatus, 'fulfilled');
  // Never silently charge a changed Stripe price or mix live/test catalogs.
  price.unit_amount = 1300; assert.equal((await buy()).status, 409); price.unit_amount = 1200;
  price.livemode = true; assert.equal((await buy()).status, 409); price.livemode = false;
  assert.equal((await mutate('put', `/api/admin/entries/product/${itemId}`).send({ ...item, data: { ...item.data, kind: 'physical' } })).status, 400);
  item = (await mutate('put', `/api/admin/entries/product/${itemId}`).send({ ...item, status: 'draft', data: { ...item.data, kind: 'physical' } })).body;
  assert.equal((await buy()).status, 404);
  item = (await mutate('put', `/api/admin/entries/product/${itemId}`).send({ ...item, status: 'published', data: { ...item.data, shippingCountries: ['US', 'CA'], shippingRates: ['shr_test'] } })).body;
  shippingCurrency = 'eur'; assert.equal((await buy()).status, 409); shippingCurrency = 'usd';
  assert.equal((await buy()).status, 201);
  assert.deepEqual(calls.at(-1).params.shipping_address_collection, { allowed_countries: ['US', 'CA'] });
  assert.deepEqual(calls.at(-1).params.shipping_options, [{ shipping_rate: 'shr_test' }]);
  const [physicalSessionId, physicalSession] = [...sessions].at(-1);
  const physicalNotify = type => {
    const payload = JSON.stringify({ id: `evt_${randomUUID()}`, type, data: { object: { id: physicalSessionId } } });
    return request(app).post('/api/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', sdk.webhooks.generateTestHeaderString({ payload, secret: webhookSecret })).send(payload);
  };
  assert.equal((await physicalNotify('checkout.session.async_payment_failed')).status, 200);
  assert.equal((await rows('SELECT payment_status FROM store_orders WHERE id = ?', [physicalSession.metadata.orderId]))[0].payment_status, 'failed');
  physicalSession.status = 'expired';
  assert.equal((await physicalNotify('checkout.session.expired')).status, 200);
  assert.equal((await rows('SELECT payment_status FROM store_orders WHERE id = ?', [physicalSession.metadata.orderId]))[0].payment_status, 'expired');
  physicalSession.status = 'complete'; physicalSession.payment_status = 'paid'; physicalSession.amount_total = 1700;
  physicalSession.collected_information = { shipping_details: { name: 'A buyer', address: { line1: '1 Test Street', city: 'Test City', country: 'US' } } };
  const physicalPayload = JSON.stringify({ id: `evt_${randomUUID()}`, type: 'checkout.session.completed', data: { object: { id: physicalSessionId } } });
  assert.equal((await request(app).post('/api/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', sdk.webhooks.generateTestHeaderString({ payload: physicalPayload, secret: webhookSecret })).send(physicalPayload)).status, 200);
  const physicalOrders = await admin.get('/api/admin/commerce/orders');
  assert.equal(physicalOrders.status, 200, JSON.stringify(physicalOrders.body));
  const physicalOrder = physicalOrders.body.items.find(order => order.sessionId === physicalSessionId);
  assert.equal(physicalOrder.amountTotal, 1700); assert.equal(physicalOrder.shipping.address.country, 'US');
  // A timeout after Stripe creates a session must remain recoverable by webhook.
  failCreation = true; assert.equal((await buy()).status, 502); failCreation = false;
  const [timeoutSessionId, timeoutSession] = [...sessions].at(-1);
  timeoutSession.status = 'complete'; timeoutSession.payment_status = 'paid';
  const timeoutPayload = JSON.stringify({ id: `evt_${randomUUID()}`, type: 'checkout.session.completed', data: { object: { id: timeoutSessionId } } });
  assert.equal((await request(app).post('/api/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', sdk.webhooks.generateTestHeaderString({ payload: timeoutPayload, secret: webhookSecret })).send(timeoutPayload)).status, 200);
  assert.equal((await rows('SELECT payment_status FROM store_orders WHERE id = ?', [timeoutSession.metadata.orderId]))[0].payment_status, 'paid');
  await mutate('delete', `/api/admin/entries/product/${itemId}`).send({ version: item.version });
  assert.equal((await publicStatus()).body.paymentStatus, 'paid'); // history survives product deletion
  const unconfiguredApp = await createApp({ commerceSettings: { secretKey: '', webhookSecret: '', automaticTax: false } });
  assert.equal((await request(unconfiguredApp).post('/api/store/checkout').set('Origin', origin).send({ productId: itemId })).status, 503);
  assert.equal((await request(unconfiguredApp).post('/api/stripe/webhook').set('Content-Type', 'application/json').send('{}')).status, 503);

  if (process.env.RUN_BROWSER === '1') {
    await mkdir('test-results', { recursive: true });
    const { chromium } = await import('playwright');
    const { config } = await import('../server/config.js');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}`, previousOrigin = config.origin;
    config.origin = url;
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${url}/admin`);
      await page.getByLabel('Email', { exact: true }).fill('test@godlyhomes.com');
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in to your studio' }).click();
      await page.getByRole('heading', { level: 1, name: 'Website Admin' }).waitFor();
      stripeClient.prices.list = async () => { throw { type: 'StripeAuthenticationError', statusCode: 401, message: 'NEVER_EXPOSE_THIS_KEY' }; };
      await page.getByRole('button', { name: 'Stripe catalog', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Stripe rejected the server API key.' }).waitFor();
      await page.getByText('Connection setup', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Import or sync price' }).count(), 0);
      assert.ok(!(await page.locator('body').innerText()).includes('NEVER_EXPOSE_THIS_KEY'));
      stripeClient.prices.list = listPrices;
      await page.getByRole('button', { name: 'Refresh connection', exact: true }).click();
      await page.getByRole('button', { name: 'Import or sync price' }).click();
      await page.getByText(/imported as a draft/).waitFor();
      await page.getByRole('button', { name: 'Store items', exact: true }).click();
      await page.getByRole('button', { name: /Family journal/ }).click();
      await page.getByLabel('Visibility', { exact: true }).selectOption('published');
      await page.getByRole('button', { name: 'Save store item', exact: true }).click();
      await page.getByText('Store item saved. It is live on the website.', { exact: true }).waitFor();
      const shopper = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await shopper.goto(`${url}/store`);
      await shopper.getByRole('link', { name: 'View item', exact: true }).click();
      await shopper.getByRole('button', { name: 'Buy now', exact: true }).waitFor();
      assert.equal(await shopper.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await shopper.route('https://checkout.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Mock Stripe checkout</h1>' }));
      await shopper.getByRole('button', { name: 'Buy now', exact: true }).click();
      await shopper.getByRole('heading', { name: 'Mock Stripe checkout' }).waitFor();
      const [browserSessionId, browserSession] = [...sessions].at(-1);
      const returnUrl = calls.at(-1).params.success_url;
      await shopper.goto(returnUrl);
      await shopper.getByRole('heading', { name: 'Confirming your payment.' }).waitFor();
      browserSession.status = 'complete'; browserSession.payment_status = 'paid';
      const payload = JSON.stringify({ id: `evt_${randomUUID()}`, type: 'checkout.session.completed', data: { object: { id: browserSessionId } } });
      assert.equal((await request(app).post('/api/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', sdk.webhooks.generateTestHeaderString({ payload, secret: webhookSecret })).send(payload)).status, 200);
      await shopper.getByRole('heading', { name: 'Thank you for your order.' }).waitFor();
      await shopper.screenshot({ path: 'test-results/store-order-confirmation-mobile.png', fullPage: true });
      await page.getByRole('button', { name: 'Orders', exact: true }).click();
      const details = page.locator('details.commerce-order').filter({ hasText: 'Family journal' }).first();
      await details.locator('summary').click();
      await details.getByLabel('Fulfillment notes').fill('Digital journal delivered.');
      await details.getByLabel('Resource delivered or package shipped').check();
      await details.getByRole('button', { name: 'Save fulfillment' }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('.commerce-order summary')].some(el => el.textContent.includes('fulfilled')));
      await page.screenshot({ path: 'test-results/store-orders-mobile.png', fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await shopper.close(); await page.close();
      // Leave the fixture catalog clean for the rest of the browser suite.
      await rows("DELETE FROM website_entries WHERE kind = 'product' AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.stripePriceId')) = ?", [price.id]);
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); config.origin = previousOrigin; }
    console.log('PASS: Mobile admin Stripe import/publish, store checkout redirect, webhook-confirmed return page, order fulfillment and overflow checks.');
  }
  console.log('PASS: Stripe catalog import, draft visibility, server-owned prices, CSRF/admin permissions, shipping validation, signed raw webhooks, delayed/duplicate/out-of-order events, private order status, fulfillment conflicts and timeout recovery.');
  return { app, stripeClient, price, product, orders: [orderId] };
}
