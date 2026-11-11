import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsletterClient } from '../server/newsletter.js';

const segmentId = 'dc77cf5b-efac-4e5e-a73e-70aaf85d699e';
test('newsletter requires its own contacts key and treats names as optional', async () => {
  assert.equal(createNewsletterClient({ RESEND_API_KEY: 'sending-key' }).ready, false);
  const calls = [];
  const client = createNewsletterClient({ RESEND_CONTACTS_API_KEY: 'contacts-key' }, async (url, options) => {
    calls.push({ url, options });
    return options.method === 'GET' ? Response.json({}, { status: 404 }) : Response.json({ id: 'contact-id' });
  });
  assert.deepEqual(await client.add('some+news@example.com'), { id: 'contact-id' });
  assert.equal(calls[0].url, 'https://api.resend.com/contacts/some%2Bnews%40example.com');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer contacts-key');
  assert.deepEqual(JSON.parse(calls[1].options.body), { email: 'some+news@example.com' });
  assert.equal(calls[1].options.redirect, 'error');
});

test('existing unsubscribed contacts retain their status when added to the newsletter segment', async () => {
  const calls = [];
  const client = createNewsletterClient({ RESEND_CONTACTS_API_KEY: 'contacts-key', RESEND_NEWSLETTER_SEGMENT_ID: segmentId }, async (url, options) => {
    calls.push({ url, options });
    return Response.json({ id: 'contact-id', unsubscribed: true });
  });
  await client.add('existing@example.com');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.endsWith(`/contacts/contact-id/segments/${segmentId}`));
  assert.equal(calls[1].options.body, undefined);
  assert.ok(calls.every(call => call.options.method !== 'PATCH'));
});

test('unknown API failures do not create contacts and error details are kept private', async () => {
  for (const status of [401, 403, 429, 503]) {
    let calls = 0;
    const client = createNewsletterClient({ RESEND_CONTACTS_API_KEY: 'private-key' }, async () => { calls++; return Response.json({ message: 'private-provider-data' }, { status }); });
    await assert.rejects(client.add('existing@example.com'), error => error.code.startsWith('NEWSLETTER_RESEND_') && !error.message.includes('private'));
    assert.equal(calls, 1);
  }
});
