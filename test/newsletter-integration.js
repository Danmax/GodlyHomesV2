import assert from 'node:assert/strict';
import request from 'supertest';
import { db } from '../server/db.js';
import { digest } from '../server/auth.js';
import { syncPendingNewsletter, syncNewsletterSubscriber } from '../server/newsletter.js';

export async function testNewsletter({ createApp, rows, origin }) {
  const calls = [], messages = [];
  let failing = false;
  const client = { ready: true, segmentId: null, add: async email => {
    calls.push(email);
    if (failing) throw Object.assign(new Error('Sensitive error'), { code: 'NEWSLETTER_RESEND_API' });
    return { id: 'contact-' + calls.length };
  } };
  const mailer = { ready: true, send: async message => { messages.push(message); } };
  const app = await createApp({ newsletter: client, mailer });
  const signup = body => request(app).post('/api/subscribe').set('Origin', origin).send(body);
  const tokenFrom = message => new URLSearchParams(new URL(message.text.match(/https?:\/\/[^\s]+/)[0]).hash.slice(1)).get('token');
  const confirm = token => request(app).post('/api/newsletter/confirm').set('Origin', origin).send({ token });
  assert.equal((await signup({ email: 'news@example.com', consent: false })).status, 400);
  assert.equal((await signup({ email: ' NEWS@example.com ', consent: true })).status, 200);
  assert.deepEqual(calls, [], 'Signup cannot add an unconfirmed address to Resend');
  let [subscriber] = await rows('SELECT * FROM subscribers WHERE email = ?', ['news@example.com']);
  const token = tokenFrom(messages.at(-1));
  assert.equal(subscriber.confirmed_at, null);
  assert.equal(subscriber.confirmation_token_hash, digest(token));
  assert.notEqual(subscriber.confirmation_token_hash, token);
  await syncPendingNewsletter(client);
  assert.equal(calls.length, 0, 'Background sync also skips unconfirmed subscribers');
  assert.equal((await confirm(token)).status, 200);
  assert.equal((await confirm(token)).status, 400, 'Confirmation links work once');
  [subscriber] = await rows('SELECT * FROM subscribers WHERE email = ?', ['news@example.com']);
  assert.ok(subscriber.confirmed_at); assert.ok(subscriber.resend_synced_at);
  const consentAt = subscriber.consent_at;
  const sent = messages.length;
  await signup({ email: 'news@example.com', consent: true });
  assert.equal(calls.length, 1); assert.equal(messages.length, sent, 'Confirmed repeat signups do not trigger more mail');
  assert.equal((await rows('SELECT consent_at FROM subscribers WHERE email = ?', ['news@example.com']))[0].consent_at.getTime(), consentAt.getTime());

  await signup({ email: 'outage-news@example.com', consent: true });
  failing = true;
  assert.equal((await confirm(tokenFrom(messages.at(-1)))).status, 200);
  [subscriber] = await rows('SELECT * FROM subscribers WHERE email = ?', ['outage-news@example.com']);
  assert.ok(subscriber.confirmed_at); assert.equal(subscriber.resend_synced_at, null);
  assert.equal(subscriber.resend_sync_attempts, 1); assert.equal(subscriber.resend_sync_error, 'NEWSLETTER_RESEND_API');
  const before = calls.length;
  await syncNewsletterSubscriber(subscriber.email, client);
  assert.equal(calls.length, before, 'Repeated requests respect retry delay');
  failing = false;
  await rows('UPDATE subscribers SET resend_retry_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) WHERE email = ?', [subscriber.email]);
  await syncPendingNewsletter(client);
  assert.ok((await rows('SELECT resend_synced_at FROM subscribers WHERE email = ?', [subscriber.email]))[0].resend_synced_at);

  await signup({ email: 'expired-news@example.com', consent: true });
  const expiredToken = tokenFrom(messages.at(-1));
  await rows('UPDATE subscribers SET confirmation_expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) WHERE email = ?', ['expired-news@example.com']);
  assert.equal((await confirm(expiredToken)).status, 400);
  await signup({ email: 'expired-news@example.com', consent: true });
  assert.equal(tokenFrom(messages.at(-1)), expiredToken, 'The confirmation cooldown is durable');
  await rows('UPDATE subscribers SET confirmation_requested_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 MINUTE) WHERE email = ?', ['expired-news@example.com']);
  await signup({ email: 'expired-news@example.com', consent: true });
  const renewed = tokenFrom(messages.at(-1));
  const race = await Promise.all([confirm(renewed), confirm(renewed)]);
  assert.deepEqual(race.map(result => result.status).sort(), [200, 400]);

  await rows('INSERT INTO subscribers (email, confirmed_at) VALUES (?, UTC_TIMESTAMP())', ['legacy-news@example.com']);
  await syncPendingNewsletter(client);
  assert.ok(calls.includes('legacy-news@example.com'));
  const segmented = { ...client, segmentId: 'dc77cf5b-efac-4e5e-a73e-70aaf85d699e' };
  await syncPendingNewsletter(segmented);
  assert.equal((await rows('SELECT resend_segment_id FROM subscribers WHERE email = ?', ['news@example.com']))[0].resend_segment_id, segmented.segmentId);
  await rows('INSERT INTO subscribers (email, confirmed_at) VALUES (?, UTC_TIMESTAMP())', ['race-news@example.com']);
  const start = calls.length;
  await Promise.all([syncNewsletterSubscriber('race-news@example.com', client), syncNewsletterSubscriber('race-news@example.com', client)]);
  assert.equal(calls.length, start + 1);

  const offline = await createApp({ newsletter: { ready: false }, mailer });
  assert.equal((await request(offline).post('/api/subscribe').set('Origin', origin).send({ email: 'pending-news@example.com', consent: true })).status, 200);
  assert.equal((await rows('SELECT confirmed_at FROM subscribers WHERE email = ?', ['pending-news@example.com']))[0].confirmed_at, null);

  // Leave only one DB connection available, then stall the external provider.
  // A health query must still obtain that final connection during the API call.
  const reserved = [];
  let releaseSend, entered;
  const sendGate = new Promise(resolve => { releaseSend = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  await rows('INSERT INTO subscribers (email, confirmed_at) VALUES (?, UTC_TIMESTAMP())', ['slow-news@example.com']);
  let work, probe;
  try {
    for (let index = 0; index < 7; index++) reserved.push(await db.getConnection());
    work = syncNewsletterSubscriber('slow-news@example.com', { ready: true, segmentId: null, add: async () => { entered(); await sendGate; return { id: 'slow-contact' }; } });
    await started;
    probe = db.getConnection();
    let timer;
    const available = await Promise.race([probe, new Promise(resolve => { timer = setTimeout(() => resolve(null), 1000); })]);
    clearTimeout(timer);
    if (available) available.release();
    releaseSend();
    await work;
    if (!available) (await probe).release();
    assert.ok(available, 'Slow Resend calls must not exhaust the database pool');
  } finally { releaseSend(); await work; for (const connection of reserved) connection.release(); }
  console.log('PASS: Newsletter ownership confirmation, token expiry/replay/races, signup deduplication, failure retries, segment sync, and database availability during slow external calls.');
}
