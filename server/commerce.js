import express from 'express';
import rateLimit from 'express-rate-limit';
import Stripe from 'stripe';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rows, transaction, json } from './db.js';
import { requireAdmin, digest } from './auth.js';
import { config } from './config.js';
import { productSchema } from './website-validation.js';

const route = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const currencies = ['usd', 'cad', 'eur', 'gbp', 'aud'];
const events = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'];
const reviewEvents = ['refund.created', 'refund.updated', 'refund.failed', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated'];
const stripeId = value => typeof value === 'string' ? value : value?.id || null;
const canFulfill = order => order.payment_status === 'paid' && Number(order.amount_refunded) === 0 && order.refund_status === 'none' && ['none', 'won', 'warning_closed'].includes(order.dispute_status);
const idSchema = z.string().uuid();
const priceSchema = z.string().regex(/^price_[A-Za-z0-9]+$/).max(255);
const promotionCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{2,39}$/, 'Use 3–40 uppercase letters, numbers, hyphens, or underscores.');
const discountSchema = z.object({
  code: promotionCodeSchema,
  percentOff: z.number().int().min(1).max(100).nullable(),
  amountOff: z.number().int().min(1).max(99999999).nullable(),
  currency: z.enum(['USD', 'CAD', 'EUR', 'GBP', 'AUD']),
  maxRedemptions: z.number().int().min(1).max(100000).nullable(),
  expiresAt: z.string().datetime().nullable(),
}).superRefine((value, context) => {
  if ((value.percentOff === null) === (value.amountOff === null)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose either a percentage or a fixed discount.' });
  if (value.expiresAt && Date.parse(value.expiresAt) <= Date.now()) context.addIssue({ code: z.ZodIssueCode.custom, message: 'The expiration must be in the future.' });
});
const slugify = value => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 110) || 'stripe-item';
const usablePrice = price => price.active && price.type === 'one_time' && Number.isSafeInteger(price.unit_amount)
  && price.unit_amount >= 0 && price.unit_amount <= 99999999 && currencies.includes(price.currency)
  && price.product && typeof price.product !== 'string' && !price.product.deleted && price.product.active;

export function commerceSettings() {
  return { secretKey: (process.env.STRIPE_SECRET_KEY || '').trim(), webhookSecret: (process.env.STRIPE_WEBHOOK_SECRET || '').trim(), automaticTax: process.env.STRIPE_AUTOMATIC_TAX === 'true' };
}

function connectionFailure(error) {
  // Stripe error messages can contain the submitted key. Return only our own
  // diagnostics, never the upstream message, headers or request configuration.
  if (error.type === 'StripeAuthenticationError' || error.statusCode === 401) return {
    code: 'authentication_failed', message: 'Stripe rejected the server API key. Replace STRIPE_SECRET_KEY in Hostinger with a valid secret or restricted API key for this account, then restart the app. Do not use a publishable key or webhook signing secret.',
  };
  if (error.type === 'StripePermissionError' || error.statusCode === 403) return {
    code: 'permission_denied', message: 'The Stripe key does not allow catalog access. Give this restricted key read access to Prices and Products, then retry.',
  };
  if (error.type === 'StripeRateLimitError' || error.statusCode === 429) return {
    code: 'rate_limited', message: 'Stripe is limiting requests. Wait a moment and refresh the connection.',
  };
  return { code: 'connection_failed', message: 'Stripe could not be reached or checked. Retry, and check the server connection and Stripe account configuration if it continues.' };
}

export function createCommerce({ stripeClient, settings = commerceSettings() } = {}) {
  const stripe = stripeClient || (settings.secretKey ? new Stripe(settings.secretKey, { maxNetworkRetries: 2, timeout: 20000 }) : null);
  const requireStripe = () => { if (!stripe) throw fail('Stripe is not connected. Ask the administrator to configure the store.', 503); return stripe; };
  const requireCheckout = () => { requireStripe(); if (!settings.webhookSecret) throw fail('Stripe payment confirmation is not configured. Please contact the store.', 503); };
  const stripeCall = async fn => {
    try { return await fn(requireStripe()); }
    catch (error) {
      if (error.status) throw error;
      // Do not expose Stripe request details, credentials or customer information.
      console.error('Stripe request failed:', error.type || 'connection_error');
      throw fail('Stripe could not complete this request. Check the account configuration and retry.', 502);
    }
  };
  const getPrice = async id => {
    const price = await stripeCall(client => client.prices.retrieve(id, { expand: ['product'] }));
    if (!usablePrice(price)) throw fail('Choose an active, fixed, one-time Stripe price in a supported currency.');
    return price;
  };
  const reviewPayment = async session => {
    const paymentIntent = stripeId(session.payment_intent);
    if (!paymentIntent) {
      if (session.payment_status === 'no_payment_required' && session.amount_total === 0) return { refunded: 0, refund: 'none', dispute: 'none' };
      throw fail('Stripe payment details are not ready for review. Retry before fulfilling this order.', 409);
    }
    const intent = await stripeCall(client => client.paymentIntents.retrieve(paymentIntent, { expand: ['latest_charge'] }, { timeout: 8000, maxNetworkRetries: 0 }));
    const charge = typeof intent.latest_charge === 'string' ? await stripeCall(client => client.charges.retrieve(intent.latest_charge)) : intent.latest_charge;
    if (!charge || stripeId(charge.payment_intent) !== paymentIntent || charge.currency !== session.currency || Boolean(charge.livemode) !== Boolean(session.livemode)) throw fail('Stripe payment details could not be matched to this order.', 409);
    const [refunds, disputes] = await Promise.all([
      stripeCall(client => client.refunds.list({ payment_intent: paymentIntent, limit: 100 }, { timeout: 8000, maxNetworkRetries: 0 })),
      stripeCall(client => client.disputes.list({ payment_intent: paymentIntent, limit: 100 }, { timeout: 8000, maxNetworkRetries: 0 })),
    ]);
    const refunded = Number(charge.amount_refunded || 0);
    const pending = refunds.data.some(refund => ['pending', 'requires_action'].includes(refund.status));
    const openDispute = disputes.data.find(dispute => !['won', 'warning_closed'].includes(dispute.status));
    return { refunded, refund: refunds.has_more ? 'needs_review' : pending ? 'pending' : refunded > 0 ? refunded >= Number(session.amount_total) ? 'refunded' : 'partially_refunded' : 'none',
      dispute: disputes.has_more ? 'needs_review' : openDispute?.status || (charge.disputed && !disputes.data.length ? 'needs_review' : disputes.data[0]?.status || 'none') };
  };
  const syncReview = async (id, expectedVersion, event) => transaction(async connection => {
    const [order] = await rows('SELECT * FROM store_orders WHERE id = ? FOR UPDATE', [id], connection);
    if (!order) throw fail('Order not found.', 404);
    if (expectedVersion !== undefined && order.version !== expectedVersion) throw fail('This order changed. Refresh it before saving.', 409);
    if (event && (await rows('SELECT event_id FROM stripe_webhook_events WHERE event_id = ?', [event.id], connection)).length) return order;
    if (!order.stripe_session_id) throw fail('Stripe checkout details are not ready. Retry shortly.', 409);
    const session = await stripeCall(client => client.checkout.sessions.retrieve(order.stripe_session_id));
    if (session.metadata?.source !== 'godly_homes' || session.metadata.orderId !== order.id || session.client_reference_id !== order.id || session.currency !== order.currency || Boolean(session.livemode) !== Boolean(order.livemode)) throw fail('Stripe session does not match this order.', 409);
    const payment = session.status === 'complete' && ['paid', 'no_payment_required'].includes(session.payment_status) ? 'paid' : session.status === 'expired' ? 'expired' : 'pending';
    const review = payment === 'paid' ? await reviewPayment(session) : { refunded: Number(order.amount_refunded), refund: order.refund_status, dispute: order.dispute_status };
    await rows(`UPDATE store_orders SET stripe_payment_intent_id = ?, amount_refunded = ?, refund_status = ?, dispute_status = ?, payment_status = ?, payment_checked_at = UTC_TIMESTAMP(), version = version + 1 WHERE id = ?`,
      [stripeId(session.payment_intent), review.refunded, review.refund, review.dispute, payment, order.id], connection);
    if (event) await rows('INSERT INTO stripe_webhook_events (event_id, event_type) VALUES (?, ?)', [event.id, event.type], connection);
    return { ...order, payment_status: payment, amount_refunded: review.refunded, refund_status: review.refund, dispute_status: review.dispute, version: order.version + 1 };
  });

  const publicRoutes = express.Router(), adminRoutes = express.Router();
  publicRoutes.post('/checkout', rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }), route(async (req, res) => {
    requireCheckout();
    const { productId } = z.object({ productId: idSchema }).parse(req.body);
    const [item] = await rows("SELECT * FROM website_entries WHERE id = ? AND kind = 'product' AND status = 'published'", [productId]);
    if (!item) throw fail('This item is not available.', 404);
    const product = productSchema.parse(json(item.data));
    if (!product.stripePriceId) throw fail('This item does not use Stripe Checkout.');
    const price = await getPrice(product.stripePriceId);
    if (price.livemode !== product.stripeLivemode || price.product.id !== product.stripeProductId
      || price.unit_amount !== product.priceCents || price.currency.toUpperCase() !== product.currency) {
      throw fail('This item’s Stripe price changed. The store administrator must sync it before checkout.', 409);
    }
    const shipping = {};
    if (product.kind === 'physical') {
      if (!product.shippingCountries.length || !product.shippingRates.length) throw fail('Shipping is not configured for this item. Please contact the store.', 409);
      for (const id of product.shippingRates) {
        const rate = await stripeCall(client => client.shippingRates.retrieve(id));
        if (!rate.active || rate.type !== 'fixed_amount' || rate.fixed_amount?.currency !== price.currency || rate.livemode !== price.livemode) throw fail('A shipping rate is unavailable or uses a different currency. Please contact the store.', 409);
      }
      shipping.shipping_address_collection = { allowed_countries: product.shippingCountries };
      shipping.shipping_options = product.shippingRates.map(shipping_rate => ({ shipping_rate }));
    }
    const id = randomUUID(), token = randomBytes(32).toString('hex');
    const snapshot = { title: product.title, kind: product.kind, slug: item.slug, priceCents: price.unit_amount, currency: price.currency.toUpperCase(), quantity: 1 };
    await rows(`INSERT INTO store_orders (id, token_hash, item_id, item_snapshot, stripe_price_id, livemode, amount_total, currency, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')`, [id, digest(token), item.id, JSON.stringify(snapshot), price.id, price.livemode, price.unit_amount, price.currency]);
    let session;
    try {
      session = await stripeCall(client => client.checkout.sessions.create({
        mode: 'payment', line_items: [{ price: price.id, quantity: 1 }], client_reference_id: id,
        metadata: { source: 'godly_homes', orderId: id },
        success_url: `${config.origin}/checkout?order=${id}&token=${token}`,
        cancel_url: `${config.origin}/store/${item.slug}?checkout=cancelled`,
        automatic_tax: { enabled: settings.automaticTax }, allow_promotion_codes: true, ...shipping,
      }, { idempotencyKey: `godly-homes-order-${id}` }));
    } catch (error) {
      // A network timeout may still have created a Stripe Session. A later
      // verified webhook can recover this order and mark it paid.
      await rows("UPDATE store_orders SET payment_status = 'failed' WHERE id = ? AND payment_status = 'pending'", [id]);
      throw error;
    }
    await rows('UPDATE store_orders SET stripe_session_id = ? WHERE id = ? AND (stripe_session_id IS NULL OR stripe_session_id = ?)', [session.id, id, session.id]);
    const url = new URL(session.url);
    if (url.protocol !== 'https:') throw fail('Stripe did not return a secure checkout address.', 502);
    res.status(201).json({ url: url.href });
  }));

  // A random capability authorizes this minimal status view. Never return a
  // customer address/email or accept a success query string as proof of payment.
  publicRoutes.get('/orders/:id', rateLimit({ windowMs: 60000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false }), route(async (req, res) => {
    const id = idSchema.parse(req.params.id), token = z.string().regex(/^[a-f0-9]{64}$/).parse(req.query.token);
    const [order] = await rows('SELECT * FROM store_orders WHERE id = ? AND token_hash = ?', [id, digest(token)]);
    if (!order) throw fail('Order not found.', 404);
    res.json({ id: order.id, item: json(order.item_snapshot), paymentStatus: order.payment_status, fulfillmentStatus: order.fulfillment_status, amountTotal: Number(order.amount_total), amountRefunded: Number(order.amount_refunded), refundStatus: order.refund_status, disputeStatus: order.dispute_status, currency: order.currency, testMode: !order.livemode });
  }));

  adminRoutes.use(requireAdmin);
  adminRoutes.get('/status', route(async (_req, res) => {
    let account = null, connected = false, connectionError = null, accountWarning = null;
    if (stripe) {
      try {
        // Verify the capability this page needs. Account details are optional:
        // restricted keys can read the catalog without access to /v1/account.
        await stripe.prices.list({ active: true, limit: 1, expand: ['data.product'] }, { timeout: 8000, maxNetworkRetries: 0 });
        connected = true;
      } catch (error) {
        console.error('Stripe connection check failed:', error.type || 'connection_error');
        connectionError = connectionFailure(error);
      }
      if (connected) {
        try {
          const details = await stripe.accounts.retrieve(null, {}, { timeout: 8000, maxNetworkRetries: 0 });
          account = { name: details.business_profile?.name || details.settings?.dashboard?.display_name || 'Stripe account', chargesEnabled: details.charges_enabled };
        } catch {
          accountWarning = 'Catalog access is verified, but account details could not be checked. You can manage products here and check payment readiness in the Stripe Dashboard.';
        }
      }
    }
    const [last] = await rows('SELECT processed_at FROM stripe_webhook_events ORDER BY processed_at DESC LIMIT 1');
    res.json({ configured: Boolean(stripe), connected, connectionError, accountWarning, webhookConfigured: Boolean(settings.webhookSecret), automaticTax: settings.automaticTax, account,
      webhookUrl: `${config.origin}/api/stripe/webhook`, events: [...events, ...reviewEvents], lastWebhookAt: last?.processed_at || null });
  }));
  adminRoutes.get('/catalog', route(async (req, res) => {
    const cursor = req.query.after ? priceSchema.parse(req.query.after) : undefined;
    const page = await stripeCall(client => client.prices.list({ active: true, type: 'one_time', limit: 30, expand: ['data.product'], ...(cursor ? { starting_after: cursor } : {}) }));
    res.json({ items: page.data.filter(usablePrice).map(price => ({ priceId: price.id, productId: price.product.id, title: price.product.name, description: price.product.description || '', imageUrl: price.product.images?.[0] || '', priceCents: price.unit_amount, currency: price.currency.toUpperCase(), physical: price.product.shippable, livemode: price.livemode })), next: page.has_more ? page.data.at(-1)?.id : null });
  }));
  adminRoutes.get('/shipping-rates', route(async (_req, res) => {
    const page = await stripeCall(client => client.shippingRates.list({ active: true, limit: 100 }));
    res.json({ items: page.data.filter(rate => rate.type === 'fixed_amount').map(rate => ({ id: rate.id, name: rate.display_name, amount: rate.fixed_amount.amount, currency: rate.fixed_amount.currency.toUpperCase() })), hasMore: page.has_more });
  }));
  adminRoutes.get('/discounts', route(async (_req, res) => {
    const page = await stripeCall(client => client.promotionCodes.list({ limit: 100, expand: ['data.promotion.coupon'] }));
    res.json({ items: page.data.map(promotion => {
      const coupon = promotion.promotion?.coupon || promotion.coupon;
      return { id: promotion.id, code: promotion.code, active: promotion.active, createdAt: promotion.created * 1000,
        maxRedemptions: promotion.max_redemptions, timesRedeemed: promotion.times_redeemed,
        expiresAt: promotion.expires_at ? promotion.expires_at * 1000 : null,
        percentOff: coupon?.percent_off ?? null, amountOff: coupon?.amount_off ?? null, currency: coupon?.currency?.toUpperCase() || null };
    }) });
  }));
  adminRoutes.post('/discounts', route(async (req, res) => {
    const input = discountSchema.parse(req.body);
    const coupon = await stripeCall(client => client.coupons.create(input.percentOff !== null
      ? { percent_off: input.percentOff, duration: 'once', name: input.code }
      : { amount_off: input.amountOff, currency: input.currency.toLowerCase(), duration: 'once', name: input.code }));
    try {
      const promotion = await stripeCall(client => client.promotionCodes.create({ promotion: { type: 'coupon', coupon: coupon.id }, code: input.code,
        ...(input.maxRedemptions ? { max_redemptions: input.maxRedemptions } : {}),
        ...(input.expiresAt ? { expires_at: Math.floor(Date.parse(input.expiresAt) / 1000) } : {}) }));
      res.status(201).json({ id: promotion.id, code: promotion.code });
    } catch (error) {
      // Avoid orphaned coupons when promotion-code creation fails.
      await stripeCall(client => client.coupons.del(coupon.id)).catch(() => {});
      throw error;
    }
  }));
  adminRoutes.post('/discounts/:id/deactivate', route(async (req, res) => {
    const id = z.string().regex(/^promo_[A-Za-z0-9]+$/).max(255).parse(req.params.id);
    await stripeCall(client => client.promotionCodes.update(id, { active: false }));
    res.json({ ok: true });
  }));
  adminRoutes.post('/import', route(async (req, res) => {
    const { priceId, kind } = z.object({ priceId: priceSchema, kind: z.enum(['digital', 'physical']) }).parse(req.body);
    const price = await getPrice(priceId), product = price.product;
    const result = await transaction(async connection => {
      // Serialize imports across admins, making repeated imports idempotent.
      await rows("SELECT document_key FROM website_documents WHERE document_key = 'store' FOR UPDATE", [], connection);
      const [existing] = await rows("SELECT * FROM website_entries WHERE kind = 'product' AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.stripePriceId')) = ? FOR UPDATE", [price.id], connection);
      if (existing) {
        const data = productSchema.parse({ ...json(existing.data), priceCents: price.unit_amount, currency: price.currency.toUpperCase(), stripeProductId: product.id, stripeLivemode: price.livemode });
        await rows('UPDATE website_entries SET data = ?, version = version + 1, updated_by = ? WHERE id = ?', [JSON.stringify(data), req.user.id, existing.id], connection);
        return { id: existing.id, created: false };
      }
      const id = randomUUID();
      const data = productSchema.parse({ title: product.name.slice(0, 250), description: (product.description || product.name).slice(0, 12000), kind,
        priceCents: price.unit_amount, currency: price.currency.toUpperCase(), imageUrl: product.images?.[0] || '', imageAlt: product.name.slice(0, 250), checkoutUrl: '',
        stripePriceId: price.id, stripeProductId: product.id, stripeLivemode: price.livemode });
      await rows("INSERT INTO website_entries (id, kind, slug, status, data, updated_by) VALUES (?, 'product', ?, 'draft', ?, ?)", [id, `${slugify(product.name)}-${id.slice(0, 8)}`, JSON.stringify(data), req.user.id], connection);
      return { id, created: true };
    });
    res.status(result.created ? 201 : 200).json(result);
  }));
  adminRoutes.get('/orders', route(async (req, res) => {
    const page = z.coerce.number().int().min(1).max(100000).parse(req.query.page || 1);
    const orders = await rows(`SELECT * FROM store_orders ORDER BY created_at DESC, id DESC LIMIT 26 OFFSET ${(page - 1) * 25}`);
    res.json({ items: orders.slice(0, 25).map(order => ({ id: order.id, item: json(order.item_snapshot), paymentStatus: order.payment_status, fulfillmentStatus: order.fulfillment_status,
      amountTotal: Number(order.amount_total), currency: order.currency, email: order.customer_email, name: order.customer_name, shipping: order.shipping ? json(order.shipping) : null,
      sessionId: order.stripe_session_id, testMode: !order.livemode, notes: order.notes, version: order.version, createdAt: order.created_at,
      amountRefunded: Number(order.amount_refunded), refundStatus: order.refund_status, disputeStatus: order.dispute_status, paymentCheckedAt: order.payment_checked_at,
      canFulfill: canFulfill(order) })), hasMore: orders.length > 25 });
  }));
  adminRoutes.patch('/orders/:id', route(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { version, fulfillmentStatus, notes } = z.object({ version: z.number().int().positive(), fulfillmentStatus: z.enum(['unfulfilled', 'fulfilled']), notes: z.string().max(4000) }).parse(req.body);
    const [order] = await rows('SELECT * FROM store_orders WHERE id = ?', [id]);
    if (!order || order.version !== version) throw fail('This order changed. Refresh it before saving.', 409);
    let expectedVersion = version;
    if (fulfillmentStatus === 'fulfilled' && order.fulfillment_status !== 'fulfilled') {
      if (order.payment_status !== 'paid') throw fail('Only paid orders can be fulfilled.', 409);
      const reviewed = await syncReview(id, version);
      expectedVersion = reviewed.version;
      if (!canFulfill(reviewed)) throw fail('This order has a refund or dispute. Do not fulfill it. Refresh the order and review it in Stripe.', 409);
    }
    const result = await rows(`UPDATE store_orders SET fulfillment_status = ?, notes = ?, version = version + 1
      WHERE id = ? AND version = ?`, [fulfillmentStatus, notes, id, expectedVersion]);
    if (!result.affectedRows) throw fail('Reload this order before saving. Only paid orders can be marked fulfilled.', 409);
    res.json({ ok: true });
  }));
  adminRoutes.post('/orders/:id/sync', route(async (req, res) => {
    await syncReview(idSchema.parse(req.params.id));
    res.json({ ok: true });
  }));

  const webhook = route(async (req, res) => {
    if (!stripe || !settings.webhookSecret) throw fail('Stripe webhooks are not configured.', 503);
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], settings.webhookSecret); }
    catch { throw fail('Stripe webhook signature is invalid.', 400); }
    if (![...events, ...reviewEvents].includes(event.type)) return res.json({ received: true });
    if ((await rows('SELECT event_id FROM stripe_webhook_events WHERE event_id = ?', [event.id])).length) return res.json({ received: true });
    if (reviewEvents.includes(event.type)) {
      const object = event.data.object;
      let paymentIntent = stripeId(object.payment_intent);
      if (!paymentIntent && (object.charge || object.object === 'charge')) {
        const charge = await stripeCall(client => client.charges.retrieve(stripeId(object.charge) || object.id));
        paymentIntent = stripeId(charge.payment_intent);
      }
      if (!paymentIntent) return res.json({ received: true });
      let [order] = await rows('SELECT id FROM store_orders WHERE stripe_payment_intent_id = ?', [paymentIntent]);
      if (!order) {
        const sessions = await stripeCall(client => client.checkout.sessions.list({ payment_intent: paymentIntent, limit: 100 }));
        const session = sessions.data.find(item => item.metadata?.source === 'godly_homes' && idSchema.safeParse(item.metadata.orderId).success);
        if (!session) return res.json({ received: true });
        [order] = await rows('SELECT id FROM store_orders WHERE id = ?', [session.metadata.orderId]);
        if (!order) throw fail('Order is not yet available. Retry this webhook.', 503);
      }
      await syncReview(order.id, undefined, event);
      return res.json({ received: true });
    }
    // Retrieve current state instead of trusting event ordering or redirect data.
    const session = await stripeCall(client => client.checkout.sessions.retrieve(event.data.object.id));
    if (session.metadata?.source !== 'godly_homes' || session.mode !== 'payment' || !idSchema.safeParse(session.metadata?.orderId).success) return res.json({ received: true });
    const orderId = session.metadata.orderId;
    await transaction(async connection => {
      // Lock order first: concurrent/repeated events serialize without deadlocks.
      const [order] = await rows('SELECT * FROM store_orders WHERE id = ? FOR UPDATE', [orderId], connection);
      if (!order) throw fail('Order is not yet available. Retry this webhook.', 503);
      if ((await rows('SELECT event_id FROM stripe_webhook_events WHERE event_id = ?', [event.id], connection)).length) return;
      if (session.client_reference_id !== order.id || Boolean(session.livemode) !== Boolean(order.livemode)
        || (order.stripe_session_id && order.stripe_session_id !== session.id) || session.currency !== order.currency) throw fail('Stripe session does not match this order.');
      let state = order.payment_status;
      if (['paid', 'no_payment_required'].includes(session.payment_status) && session.status === 'complete') state = 'paid';
      else if (state !== 'paid') {
        if (session.status === 'expired') state = 'expired';
        else if (event.type === 'checkout.session.async_payment_failed') state = 'failed';
      }
      const shipping = session.collected_information?.shipping_details || session.shipping_details || null;
      await rows(`UPDATE store_orders SET stripe_session_id = ?, stripe_payment_intent_id = ?, payment_status = ?, amount_total = ?, customer_email = ?, customer_name = ?, shipping = ?, version = version + 1 WHERE id = ?`,
        [session.id, stripeId(session.payment_intent), state, session.amount_total ?? order.amount_total, session.customer_details?.email || null, session.customer_details?.name || null, shipping ? JSON.stringify(shipping) : null, order.id], connection);
      await rows('INSERT INTO stripe_webhook_events (event_id, event_type) VALUES (?, ?)', [event.id, event.type], connection);
    });
    res.json({ received: true });
  });
  return { publicRoutes, adminRoutes, webhook };
}
