import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rows, transaction, json } from './db.js';
import { config } from './config.js';
import { requireAdmin, verifyPassword } from './auth.js';
import { publicWebsite } from './website.js';
import { campaignSchema, renderNewsletter, absoluteNewsletterLink } from './newsletter-template.js';
import { requestNewsletterConfirmation, syncNewsletterSubscriber } from './newsletter.js';

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const versionBody = z.object({ version: z.number().int().positive() });
const summary = item => ({ id: item.id, version: item.version, state: item.state, data: json(item.data), contentHash: item.content_hash,
  testHash: item.test_hash, testTo: item.test_to, testedAt: item.tested_at, broadcastId: item.broadcast_id,
  segmentId: item.segment_id, sentAt: item.sent_at, lastError: item.last_error, updatedAt: item.updated_at });
const sanitizeCode = error => typeof error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'NEWSLETTER_OPERATION_FAILED';

export async function newsletterCatalog() {
  const website = await publicWebsite();
  const episodes = await rows(`SELECT p.episode_id, p.title, p.description, p.published_at, c.data AS channel_data
    FROM publications p JOIN episodes e ON e.id = p.episode_id AND e.admin_hidden = FALSE
    LEFT JOIN podcast_channels c ON c.user_id = e.user_id
    WHERE c.user_id IS NULL OR c.is_public = TRUE ORDER BY p.published_at DESC LIMIT 30`);
  const link = value => absoluteNewsletterLink(value, config.origin);
  const sources = episodes.map(item => ({ key: `episode:${item.episode_id}`, category: 'Podcast highlight', title: item.title,
    body: item.description.slice(0, 400), href: link(`/podcast/${item.episode_id}`), image: link(item.channel_data ? json(item.channel_data).coverUrl : ''), label: 'Listen to the episode' }));
  for (const item of website.resources) sources.push({ key: `resource:${item.id}`, category: 'Reflexion', title: item.title, body: item.description.slice(0, 400), href: link(item.externalUrl), image: link(item.imageUrl), label: 'Read the reflexion' });
  for (const item of website.products) sources.push({ key: `product:${item.id}`, category: 'From the store', title: item.title, body: item.description.slice(0, 400), href: link(`/store/${item.slug}`), image: link(item.imageUrl), label: 'Explore this resource' });
  for (const [key, title, body, href] of [
    ['about', website.documents.about.title, website.documents.about.description, '/about'],
    ['resources', website.documents.resources.title, website.documents.resources.description, '/resources'],
    ['store', website.documents.store.title, website.documents.store.description, '/store'],
    ['channels', 'Voices from our community', 'Explore podcasts and stories from Godly Homes authors.', '/channels'],
  ]) sources.push({ key: `page:${key}`, category: 'Around Godly Homes', title, body: body.slice(0, 400), href: link(href), image: '', label: 'Visit Godly Homes' });
  if (website.documents.home.announcementEnabled) sources.push({ key: 'page:announcement', category: 'Community update', title: website.documents.home.announcementText,
    body: '', href: link(website.documents.home.announcementHref), image: '', label: website.documents.home.announcementLabel });
  return { sources, brand: { name: website.documents.site.name, email: website.documents.site.email } };
}
async function snapshotFor(data) {
  const catalog = await newsletterCatalog();
  const sections = data.blocks.map(block => {
    const source = block.source === 'custom' ? { category: 'A note from Godly Homes', title: '', body: '', href: '', label: '', image: '' } : catalog.sources.find(item => item.key === block.source);
    if (!source) throw fail('A selected item is no longer public. Remove it or choose another item before saving or sending.', 409);
    return { ...source, title: block.title || source.title, body: block.body || source.body,
      href: block.source === 'custom' ? absoluteNewsletterLink(block.href, config.origin) : source.href, label: block.label || source.label };
  });
  return { data, brand: catalog.brand, sections, origin: config.origin };
}
async function validatePublicSources(data) {
  const catalog = await newsletterCatalog();
  if (data.blocks.some(block => block.source !== 'custom' && !catalog.sources.some(item => item.key === block.source))) throw fail('A highlighted item is no longer public. Edit and test a new draft before sending.', 409);
}
async function adminPassword(userId, password, connection) {
  const [actor] = await rows('SELECT role, disabled_at, password_hash FROM users WHERE id = ?', [userId], connection);
  if (!actor || actor.disabled_at || actor.role !== 'admin') throw fail('Full administrator access is required.', 403);
  if (!(await verifyPassword(password, actor.password_hash))) throw fail('Your current password is incorrect.', 401);
}

export function newsletterStudio({ marketing, mailer, contacts }) {
  const router = Router();
  const delivery = () => ({ from: marketing.from || '', segmentId: marketing.segmentId || null });
  const validateDelivery = item => {
    const target = json(item.snapshot).delivery;
    if (!target || target.from !== delivery().from || target.segmentId !== delivery().segmentId) throw fail('Newsletter delivery settings changed. Save and test this draft again.', 409);
  };
  router.use(requireAdmin);
  router.get('/catalog', wrap(async (_req, res) => res.json({ ...await newsletterCatalog(), ready: marketing.ready, segmentId: marketing.segmentId, sender: marketing.from, testReady: mailer.ready })));
  router.get('/audience', wrap(async (req, res) => {
    const after = z.string().uuid().optional().parse(req.query.after);
    const segment = await marketing.segment();
    const members = await marketing.members(after);
    res.json({ segment: { id: segment.id, name: segment.name }, members: members.data.map(item => ({ id: item.id, email: item.email, firstName: item.first_name || '', lastName: item.last_name || '', unsubscribed: Boolean(item.unsubscribed), createdAt: item.created_at })), hasMore: Boolean(members.has_more), after: members.data.at(-1)?.id || null });
  }));
  router.get('/members', wrap(async (req, res) => {
    const input = z.object({ q: z.string().trim().max(254).default(''), status: z.enum(['all', 'pending', 'confirmed', 'unsubscribed', 'sync_pending']).default('all'), page: z.coerce.number().int().min(1).max(100000).default(1) }).parse(req.query);
    const clauses = [], values = [];
    if (input.q) { clauses.push('(LOCATE(?, email) > 0 OR LOCATE(?, first_name) > 0 OR LOCATE(?, last_name) > 0)'); values.push(input.q, input.q, input.q); }
    if (input.status === 'pending') clauses.push('confirmed_at IS NULL AND newsletter_unsubscribed_at IS NULL');
    if (input.status === 'confirmed') clauses.push('confirmed_at IS NOT NULL AND newsletter_unsubscribed_at IS NULL AND COALESCE(resend_unsubscribed, FALSE) = FALSE');
    if (input.status === 'unsubscribed') clauses.push('(newsletter_unsubscribed_at IS NOT NULL OR resend_unsubscribed = TRUE)');
    if (input.status === 'sync_pending') { clauses.push('confirmed_at IS NOT NULL AND newsletter_unsubscribed_at IS NULL AND (resend_synced_at IS NULL OR COALESCE(resend_segment_id, \'\') <> ?)'); values.push(marketing.segmentId || ''); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const [count] = await rows(`SELECT COUNT(*) AS total FROM subscribers${where}`, values);
    const subscribers = await rows(`SELECT email, consent_at, confirmed_at, first_name, last_name, newsletter_unsubscribed_at,
      resend_unsubscribed, resend_status_checked_at, resend_synced_at, resend_contact_id, resend_segment_id, resend_sync_error
      FROM subscribers${where} ORDER BY consent_at DESC, email LIMIT 50 OFFSET ${(input.page - 1) * 50}`, values);
    res.json({ members: subscribers.map(item => ({ email: item.email, firstName: item.first_name, lastName: item.last_name, consentAt: item.consent_at, confirmedAt: item.confirmed_at,
      unsubscribed: Boolean(item.newsletter_unsubscribed_at || item.resend_unsubscribed), syncedAt: item.resend_synced_at, contactId: item.resend_contact_id,
      segmentId: item.resend_segment_id, statusCheckedAt: item.resend_status_checked_at, syncError: item.resend_sync_error })), total: Number(count.total), page: input.page });
  }));
  router.post('/members/invite', rateLimit({ windowMs: 3600000, limit: 15, keyGenerator: req => req.user.id, legacyHeaders: false }), wrap(async (req, res) => {
    const input = z.object({ email }).parse(req.body);
    if (!mailer.ready) throw fail('Configure account email before inviting subscribers.', 503);
    await requestNewsletterConfirmation(input.email, mailer);
    res.json({ message: 'If confirmation is needed, an opt-in email will be sent. No one joins the list without confirming.' });
  }));
  async function contactFor(input) {
    if (input.contactId) {
      const segments = await marketing.contactSegments(input.contactId);
      if (!segments.data?.some(item => item.id === marketing.segmentId)) throw fail('This contact is not in the newsletter segment.', 404);
      return marketing.contact(input.contactId);
    }
    const [local] = await rows('SELECT * FROM subscribers WHERE email = ?', [input.email]);
    if (!local) throw fail('Subscriber not found.', 404);
    return local.resend_contact_id ? marketing.contact(local.resend_contact_id) : { email: local.email, id: null, first_name: local.first_name, last_name: local.last_name, unsubscribed: Boolean(local.newsletter_unsubscribed_at) };
  }
  const memberTarget = { email: email.optional(), contactId: z.string().uuid().optional() };
  router.post('/members/action', rateLimit({ windowMs: 15 * 60000, limit: 30, keyGenerator: req => req.user.id, legacyHeaders: false }), wrap(async (req, res) => {
    const input = z.object({ ...memberTarget, action: z.enum(['profile', 'unsubscribe', 'refresh', 'retry']), firstName: z.string().trim().max(100).default(''), lastName: z.string().trim().max(100).default(''), currentPassword: z.string().max(200).default('') }).refine(value => value.email || value.contactId, 'Choose a subscriber.').parse(req.body);
    const contact = await contactFor(input);
    if (input.action === 'profile') {
      if (contact.id) await marketing.updateContact(contact.id, { first_name: input.firstName, last_name: input.lastName });
      await rows('UPDATE subscribers SET first_name = ?, last_name = ? WHERE email = ?', [input.firstName, input.lastName, contact.email]);
    } else if (input.action === 'unsubscribe') {
      await adminPassword(req.user.id, input.currentPassword);
      const lease = randomUUID();
      const local = await transaction(async connection => {
        const [subscriber] = await rows('SELECT *, resend_lease_until > UTC_TIMESTAMP() AS leased FROM subscribers WHERE email = ? FOR UPDATE', [contact.email], connection);
        if (!subscriber) return false;
        if (subscriber.leased) throw fail('A subscriber update is in progress. Try again shortly.', 409);
        await rows('UPDATE subscribers SET resend_lease_token = ?, resend_lease_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 MINUTE) WHERE email = ?', [lease, contact.email], connection);
        return true;
      });
      try {
        if (contact.id) await marketing.updateContact(contact.id, { unsubscribed: true });
        await rows('UPDATE subscribers SET newsletter_unsubscribed_at = UTC_TIMESTAMP(), confirmation_token_hash = NULL, confirmation_expires_at = NULL, resubscribe_pending = FALSE, resend_unsubscribed = TRUE, resend_status_checked_at = UTC_TIMESTAMP() WHERE email = ? AND resend_lease_token = ?', [contact.email, lease]);
      } finally {
        if (local) await rows('UPDATE subscribers SET resend_lease_token = NULL, resend_lease_until = NULL WHERE email = ? AND resend_lease_token = ?', [contact.email, lease]);
      }
    } else if (input.action === 'refresh') {
      await rows(`UPDATE subscribers SET first_name = ?, last_name = ?, resend_unsubscribed = ?, resend_status_checked_at = UTC_TIMESTAMP(),
        newsletter_unsubscribed_at = IF(?, COALESCE(newsletter_unsubscribed_at, UTC_TIMESTAMP()), newsletter_unsubscribed_at) WHERE email = ?`, [contact.first_name || '', contact.last_name || '', Boolean(contact.unsubscribed), Boolean(contact.unsubscribed), contact.email]);
    } else {
      await rows('UPDATE subscribers SET resend_retry_at = NULL WHERE email = ?', [contact.email]);
      await syncNewsletterSubscriber(contact.email, contacts);
    }
    res.json({ message: input.action === 'unsubscribe' ? 'Subscriber opted out of newsletters. Account emails remain available.' : 'Subscriber updated.' });
  }));

  router.get('/campaigns', wrap(async (_req, res) => res.json((await rows('SELECT * FROM newsletter_campaigns ORDER BY created_at DESC LIMIT 100')).map(summary))));
  router.get('/campaigns/:id', wrap(async (req, res) => {
    const [item] = await rows('SELECT * FROM newsletter_campaigns WHERE id = ?', [z.uuid().parse(req.params.id)]);
    if (!item) throw fail('Newsletter draft not found.', 404);
    res.json(summary(item));
  }));
  async function save(req, res, id) {
    const data = campaignSchema.parse(req.body.data), snapshot = { ...await snapshotFor(data), delivery: delivery() }, rendered = renderNewsletter(snapshot);
    if (id) {
      const input = versionBody.parse(req.body);
      const result = await rows(`UPDATE newsletter_campaigns SET data = ?, snapshot = ?, content_hash = ?, test_hash = NULL, tested_at = NULL, test_to = NULL,
        version = version + 1, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND version = ? AND state = 'draft' AND broadcast_id IS NULL`, [JSON.stringify(data), JSON.stringify(snapshot), rendered.hash, req.user.id, id, input.version]);
      if (!result.affectedRows) throw fail('This newsletter changed or has already entered sending. Refresh it before continuing.', 409);
    } else {
      id = randomUUID();
      await rows(`INSERT INTO newsletter_campaigns (id, data, snapshot, content_hash, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`, [id, JSON.stringify(data), JSON.stringify(snapshot), rendered.hash, req.user.id, req.user.id]);
    }
    const [saved] = await rows('SELECT * FROM newsletter_campaigns WHERE id = ?', [id]);
    res.status(req.method === 'POST' ? 201 : 200).json(summary(saved));
  }
  router.post('/campaigns', wrap((req, res) => save(req, res)));
  router.put('/campaigns/:id', wrap((req, res) => save(req, res, z.uuid().parse(req.params.id))));
  router.post('/campaigns/:id/preview', wrap(async (req, res) => {
    const [item] = await rows('SELECT * FROM newsletter_campaigns WHERE id = ?', [z.uuid().parse(req.params.id)]);
    if (!item) throw fail('Newsletter draft not found.', 404);
    await validatePublicSources(json(item.data));
    const rendered = renderNewsletter(json(item.snapshot), { test: true });
    res.json({ html: rendered.html, contentHash: item.content_hash, version: item.version });
  }));
  router.post('/campaigns/:id/test', rateLimit({ windowMs: 3600000, limit: 10, keyGenerator: req => req.user.id, legacyHeaders: false }), wrap(async (req, res) => {
    const id = z.uuid().parse(req.params.id), input = versionBody.extend({ to: email }).parse(req.body);
    const [item] = await rows('SELECT * FROM newsletter_campaigns WHERE id = ?', [id]);
    if (!item || item.version !== input.version || item.state !== 'draft') throw fail('Save and refresh this draft before sending a test.', 409);
    if (!mailer.ready) throw fail('Configure email delivery before sending a test.', 503);
    validateDelivery(item);
    await validatePublicSources(json(item.data));
    const rendered = renderNewsletter(json(item.snapshot), { test: true });
    await mailer.send({ to: input.to, subject: `[TEST] ${json(item.data).subject}`, html: rendered.html, text: rendered.text });
    const result = await rows('UPDATE newsletter_campaigns SET test_hash = content_hash, test_to = ?, tested_at = UTC_TIMESTAMP() WHERE id = ? AND version = ? AND state = \'draft\'', [input.to, id, input.version]);
    if (!result.affectedRows) throw fail('The draft changed while its test was being sent. Test the updated version again.', 409);
    res.json({ message: 'Test email accepted by the mail provider. Check its layout in your inbox.', testHash: item.content_hash, testTo: input.to });
  }));
  router.post('/campaigns/:id/send', rateLimit({ windowMs: 86400000, limit: 5, keyGenerator: req => req.user.id, legacyHeaders: false }), wrap(async (req, res) => {
    const id = z.uuid().parse(req.params.id), input = versionBody.extend({ currentPassword: z.string().min(1).max(200), confirm: z.literal('SEND'), previewHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(req.body);
    if (!marketing.ready) throw fail('Configure the newsletter segment, full-access key, and sender before sending.', 503);
    const claim = await transaction(async connection => {
      await adminPassword(req.user.id, input.currentPassword, connection);
      const [item] = await rows('SELECT * FROM newsletter_campaigns WHERE id = ? FOR UPDATE', [id], connection);
      if (!item || item.version !== input.version || item.state !== 'draft' || item.broadcast_id) throw fail('This draft has changed or a send has already started. Check its status.', 409);
      validateDelivery(item);
      const data = json(item.data);
      if (data.address.length < 10) throw fail('Add your organization mailing address to the newsletter footer before sending.');
      if (item.test_hash !== item.content_hash || input.previewHash !== item.content_hash) throw fail('Preview and send a test of this exact draft before sending it to members.', 409);
      const token = randomUUID();
      await rows("UPDATE newsletter_campaigns SET state = 'preparing', segment_id = ?, operation_token = ?, operation_at = UTC_TIMESTAMP(), version = version + 1 WHERE id = ?", [marketing.segmentId, token, id], connection);
      return { item, token };
    });
    let sendAttempted = false;
    try {
      await validatePublicSources(json(claim.item.data));
      const rendered = renderNewsletter(json(claim.item.snapshot));
      const broadcast = await marketing.createBroadcast({ name: `GH ${id}`, subject: json(claim.item.data).subject, html: rendered.html, text: rendered.text });
      if (!broadcast.id) throw fail('Resend did not return a broadcast reference.', 502);
      const recorded = await rows("UPDATE newsletter_campaigns SET broadcast_id = ?, state = 'sending' WHERE id = ? AND operation_token = ? AND state = 'preparing'", [broadcast.id, id, claim.token]);
      if (!recorded.affectedRows) throw fail('Campaign preparation changed. Check the Resend draft before continuing.', 409);
      sendAttempted = true;
      await marketing.sendBroadcast(broadcast.id);
      await rows("UPDATE newsletter_campaigns SET state = 'queued', sent_at = UTC_TIMESTAMP(), last_error = NULL WHERE id = ? AND operation_token = ?", [id, claim.token]);
      res.json({ message: 'Newsletter queued in Resend for the configured newsletter segment. Track delivery in Resend.' });
    } catch (error) {
      await rows(`UPDATE newsletter_campaigns SET state = ?, last_error = ? WHERE id = ? AND operation_token = ?`, [sendAttempted ? 'needs_review' : 'draft', sanitizeCode(error), id, claim.token]);
      // Creating a broadcast is always draft-only. An uncertain send never
      // triggers an automatic retry or a new broadcast that could duplicate it.
      throw error;
    }
  }));
  router.post('/campaigns/:id/status', wrap(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const [item] = await rows('SELECT *, operation_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 MINUTE) AS active_operation FROM newsletter_campaigns WHERE id = ?', [id]);
    if (!item || !item.broadcast_id) throw fail('No Resend broadcast is attached. A draft-only preparation failure can be duplicated into a new draft.', 409);
    if (item.active_operation && ['preparing', 'sending'].includes(item.state)) throw fail('Sending is still in progress. Check again shortly.', 409);
    const remote = await marketing.broadcast(item.broadcast_id);
    const state = remote.status === 'sent' ? 'sent' : ['scheduled', 'queued', 'sending'].includes(remote.status) ? 'queued' : 'needs_review';
    await rows('UPDATE newsletter_campaigns SET state = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND broadcast_id = ? AND state = ?', [state, id, item.broadcast_id, item.state]);
    res.json({ state, providerState: remote.status, message: state === 'needs_review' ? 'Review this existing broadcast in Resend. Do not create another send until its status is clear.' : `Resend status: ${remote.status}` });
  }));
  return router;
}
