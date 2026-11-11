import { randomUUID, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { digest } from './auth.js';
import { rows, transaction } from './db.js';

const errorCode = status => status === 401 ? 'NEWSLETTER_RESEND_AUTH' : status === 403 ? 'NEWSLETTER_RESEND_FORBIDDEN' : status === 429 ? 'NEWSLETTER_RESEND_RATE_LIMIT' : 'NEWSLETTER_RESEND_API';
const failed = status => Object.assign(new Error('Resend contact synchronization failed.'), { code: errorCode(status) });

export function createNewsletterClient(env = process.env, request = fetch) {
  const segmentId = env.RESEND_NEWSLETTER_SEGMENT_ID ? z.uuid().parse(env.RESEND_NEWSLETTER_SEGMENT_ID) : null;
  // Separate from the restricted key used by transactional account emails.
  const key = env.RESEND_CONTACTS_API_KEY;
  if (!key) return { ready: false, segmentId };
  async function call(path, { method = 'GET', body, allowMissing = false } = {}) {
    const response = await request(`https://api.resend.com${path}`, {
      method, headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000), redirect: 'error',
    });
    if (allowMissing && response.status === 404) { await response.arrayBuffer(); return null; }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw failed(response.status);
    return result;
  }
  return {
    ready: true, segmentId,
    add: async email => {
      z.email().max(254).parse(email);
      const path = `/contacts/${encodeURIComponent(email)}`;
      let contact = await call(path, { allowMissing: true });
      if (!contact) {
        // Omitting subscription status also protects against races/upserts:
        // never overwrite an existing contact's unsubscribe preference.
        contact = await call('/contacts', { method: 'POST', body: { email } });
      }
      if (typeof contact.id !== 'string' || !contact.id) throw failed(502);
      if (segmentId) await call(`/contacts/${encodeURIComponent(contact.id)}/segments/${segmentId}`, { method: 'POST' });
      return { id: contact.id };
    },
  };
}

export async function syncNewsletterSubscriber(email, client) {
  if (!client.ready) return;
  const claim = await transaction(async connection => {
    const query = (sql, values) => rows(sql, values, connection);
    const [subscriber] = await query(`SELECT *, resend_retry_at > UTC_TIMESTAMP() AS cooling_down,
      resend_lease_until > UTC_TIMESTAMP() AS leased FROM subscribers WHERE email = ? FOR UPDATE`, [email]);
    if (!subscriber || !subscriber.confirmed_at || subscriber.cooling_down || subscriber.leased || (subscriber.resend_synced_at && (subscriber.resend_segment_id || null) === client.segmentId)) return null;
    const lease = randomUUID();
    await query('UPDATE subscribers SET resend_lease_token = ?, resend_lease_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 MINUTE) WHERE email = ?', [lease, email]);
    return { subscriber, lease };
  });
  if (!claim) return;
  try {
    const contact = await client.add(claim.subscriber.email);
    await rows(`UPDATE subscribers SET resend_contact_id = ?, resend_segment_id = ?, resend_synced_at = UTC_TIMESTAMP(),
      resend_sync_attempts = 0, resend_retry_at = NULL, resend_sync_error = NULL, resend_lease_token = NULL, resend_lease_until = NULL
      WHERE email = ? AND resend_lease_token = ?`, [contact.id, client.segmentId, email, claim.lease]);
  } catch (error) {
    const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'NEWSLETTER_SYNC_ERROR';
    const retrySeconds = Math.min(3600, 60 * 2 ** Math.min(Number(claim.subscriber.resend_sync_attempts), 6));
    await rows(`UPDATE subscribers SET resend_sync_attempts = resend_sync_attempts + 1,
      resend_retry_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), resend_sync_error = ?, resend_lease_token = NULL, resend_lease_until = NULL
      WHERE email = ? AND resend_lease_token = ?`, [retrySeconds, code, email, claim.lease]);
    console.error('Newsletter contact sync pending:', code);
  }
}

export async function syncPendingNewsletter(client, limit = 10) {
  if (!client.ready) return;
  const pending = await rows(`SELECT email FROM subscribers
    WHERE confirmed_at IS NOT NULL AND (resend_synced_at IS NULL OR COALESCE(resend_segment_id, '') <> ?)
      AND (resend_retry_at IS NULL OR resend_retry_at <= UTC_TIMESTAMP())
      AND (resend_lease_until IS NULL OR resend_lease_until <= UTC_TIMESTAMP())
    ORDER BY consent_at LIMIT ?`, [client.segmentId || '', limit]);
  for (const subscriber of pending) await syncNewsletterSubscriber(subscriber.email, client);
}


export async function requestNewsletterConfirmation(email, mailer) {
  const delivery = await transaction(async connection => {
    const query = (sql, values) => rows(sql, values, connection);
    await query('INSERT IGNORE INTO subscribers (email) VALUES (?)', [email]);
    const [subscriber] = await query(`SELECT *, confirmation_requested_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) AS cooling_down
      FROM subscribers WHERE email = ? FOR UPDATE`, [email]);
    if (subscriber.confirmed_at || subscriber.cooling_down) return null;
    const token = randomBytes(32).toString('hex'), hash = digest(token);
    await query(`UPDATE subscribers SET confirmation_token_hash = ?, confirmation_requested_at = UTC_TIMESTAMP(),
      confirmation_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 24 HOUR), confirmation_sent_at = NULL WHERE email = ?`, [hash, email]);
    return { token, hash };
  });
  if (!delivery) return;
  const url = new URL('/account', config.origin);
  url.hash = new URLSearchParams({ action: 'newsletter', token: delivery.token }).toString();
  try {
    await mailer.send({ to: email, subject: 'Confirm your Godly Homes newsletter signup', idempotencyKey: `newsletter-confirm/${delivery.hash}`,
      text: `Please confirm that you want Godly Homes newsletter updates:\n\n${url.href}\n\nThis link expires in 24 hours and works once. If you did not request this newsletter, ignore this email; you will not be added to the mailing list.` });
    await rows('UPDATE subscribers SET confirmation_sent_at = UTC_TIMESTAMP() WHERE email = ? AND confirmation_token_hash = ?', [email, delivery.hash]);
  } catch (error) { console.error('Newsletter confirmation request failed:', error.code || 'delivery_error'); }
}

export async function confirmNewsletter(token, client) {
  const hash = digest(token);
  const invalid = () => Object.assign(new Error('This newsletter link has expired or has already been used. Sign up again for a new confirmation email.'), { status: 400 });
  const [candidate] = await rows('SELECT email FROM subscribers WHERE confirmation_token_hash = ?', [hash]);
  if (!candidate) throw invalid();
  await transaction(async connection => {
    const query = (sql, values) => rows(sql, values, connection);
    const [subscriber] = await query('SELECT *, confirmation_expires_at > UTC_TIMESTAMP() AS valid FROM subscribers WHERE email = ? FOR UPDATE', [candidate.email]);
    if (!subscriber || subscriber.confirmed_at || subscriber.confirmation_token_hash !== hash || !subscriber.valid) throw invalid();
    await query('UPDATE subscribers SET confirmed_at = UTC_TIMESTAMP(), confirmation_token_hash = NULL, confirmation_expires_at = NULL WHERE email = ?', [candidate.email]);
  });
  try { await syncNewsletterSubscriber(candidate.email, client); }
  catch (error) { console.error('Confirmed newsletter sync pending:', error.code || 'sync_error'); }
}
