import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignSchema, renderNewsletter, absoluteNewsletterLink } from '../server/newsletter-template.js';
import { createNewsletterMarketing } from '../server/newsletter-marketing.js';

const data = { subject: 'A letter', title: 'Faith & family', previewText: 'This week', intro: '<script>alert(1)</script> {{{contact.email}}}', closing: '', address: '123 Example Street', theme: 'sage', showImages: true, blocks: [] };
const snapshot = { data, brand: { name: 'Godly Homes', email: 'hello@example.com' }, sections: [], origin: 'https://godlyhomes.com' };
test('both newsletter themes escape HTML and provider variables while keeping the live unsubscribe link', () => {
  for (const theme of ['sage', 'navy']) {
    const result = renderNewsletter({ ...snapshot, data: { ...data, theme } });
    assert.ok(result.html.includes('&lt;script&gt;'));
    assert.equal(result.html.includes('<script>'), false);
    assert.equal(result.text.includes('{{{contact.email}}}'), false);
    assert.equal(result.html.match(/\{\{\{/g).length, 1);
    assert.ok(result.html.includes('{{{RESEND_UNSUBSCRIBE_URL}}}'));
    const preview = renderNewsletter(snapshot, { test: true });
    assert.equal(preview.html.includes('{{{RESEND_UNSUBSCRIBE_URL}}}'), false);
  }
  const changedTarget = renderNewsletter({ ...snapshot, delivery: { segmentId: 'other' } });
  assert.notEqual(changedTarget.hash, renderNewsletter(snapshot).hash);
  assert.throws(() => renderNewsletter({ ...snapshot, data: { ...data, intro: '<'.repeat(95000) } }), /too long/);
});
test('campaign validation rejects unsafe links, duplicate public sources and header injection', () => {
  for (const href of ['javascript:alert(1)', '//evil.example', 'http://evil.example', '/\\evil.example']) assert.throws(() => absoluteNewsletterLink(href, snapshot.origin));
  assert.equal(absoluteNewsletterLink('/resources', snapshot.origin), 'https://godlyhomes.com/resources');
  assert.equal(campaignSchema.safeParse({ ...data, subject: 'Hello\r\nBcc: stranger@example.com' }).success, false);
  assert.equal(campaignSchema.safeParse({ ...data, blocks: [{ source: 'page:about' }, { source: 'page:about' }] }).success, false);
});
test('marketing creates draft-only broadcasts scoped to the configured segment and keeps errors private', async () => {
  const segmentId = 'f11d5375-93a0-4918-89e0-43d766079a26', calls = [];
  const env = { RESEND_CONTACTS_API_KEY: 'private-key', RESEND_NEWSLETTER_SEGMENT_ID: segmentId, MAIL_FROM: 'hello@example.com' };
  const client = createNewsletterMarketing(env, async (url, options) => { calls.push({ url, ...options }); return Response.json({ id: 'broadcast' }); });
  await client.createBroadcast({ send: true, segment_id: 'other', from: 'other@example.com', html: 'A letter' });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.send, false); assert.equal(body.segment_id, segmentId); assert.equal(body.from, 'Godly Homes <hello@example.com>');
  await client.sendBroadcast('broadcast');
  assert.equal(calls[1].url, 'https://api.resend.com/broadcasts/broadcast/send');
  const broken = createNewsletterMarketing(env, async () => Response.json({ message: 'private provider details' }, { status: 403 }));
  await assert.rejects(broken.segment(), error => error.code === 'NEWSLETTER_PROVIDER_403' && !error.message.includes('private provider'));
  assert.equal(createNewsletterMarketing({}).ready, false);
});
