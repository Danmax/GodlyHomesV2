import { z } from 'zod';
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
  await transaction(async connection => {
    const query = (sql, values) => rows(sql, values, connection);
    const [subscriber] = await query(`SELECT *, resend_retry_at > UTC_TIMESTAMP() AS cooling_down
      FROM subscribers WHERE email = ? FOR UPDATE`, [email]);
    if (!subscriber || subscriber.cooling_down || (subscriber.resend_synced_at && (subscriber.resend_segment_id || null) === client.segmentId)) return;
    try {
      const contact = await client.add(subscriber.email);
      await query(`UPDATE subscribers SET resend_contact_id = ?, resend_segment_id = ?, resend_synced_at = UTC_TIMESTAMP(),
        resend_sync_attempts = 0, resend_retry_at = NULL, resend_sync_error = NULL WHERE email = ?`, [contact.id, client.segmentId, subscriber.email]);
    } catch (error) {
      const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'NEWSLETTER_SYNC_ERROR';
      const retrySeconds = Math.min(3600, 60 * 2 ** Math.min(Number(subscriber.resend_sync_attempts), 6));
      await query(`UPDATE subscribers SET resend_sync_attempts = resend_sync_attempts + 1,
        resend_retry_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), resend_sync_error = ? WHERE email = ?`, [retrySeconds, code, subscriber.email]);
      console.error('Newsletter contact sync pending:', code);
    }
  });
}

export async function syncPendingNewsletter(client, limit = 10) {
  if (!client.ready) return;
  const pending = await rows(`SELECT email FROM subscribers
    WHERE (resend_synced_at IS NULL OR COALESCE(resend_segment_id, '') <> ?)
      AND (resend_retry_at IS NULL OR resend_retry_at <= UTC_TIMESTAMP())
    ORDER BY consent_at LIMIT ?`, [client.segmentId || '', limit]);
  for (const subscriber of pending) await syncNewsletterSubscriber(subscriber.email, client);
}
