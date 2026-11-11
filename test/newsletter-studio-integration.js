import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { syncNewsletterSubscriber } from '../server/newsletter.js';

export async function testNewsletterStudio({ createApp, rows, hashPassword, origin }) {
  const password = 'Newsletter-studio-password-123', adminId = randomUUID(), juniorId = randomUUID(), contactId = randomUUID();
  const hash = await hashPassword(password);
  await rows('INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?), (?, ?, ?, ?)', [adminId, 'newsletter-owner@example.com', hash, 'admin', juniorId, 'newsletter-junior@example.com', hash, 'junior_admin']);
  const messages = [], broadcasts = [], sends = [], contacts = [];
  let timeout = false, failTest = false, holdSend, entered;
  const remote = { id: contactId, email: 'studio-member@example.com', first_name: '', last_name: '', unsubscribed: false };
  const marketing = { ready: true, from: 'hello@godlyhomes.com', segmentId: randomUUID(),
    segment: async () => ({ id: marketing.segmentId, name: 'GH newsletter' }),
    members: async () => ({ data: [remote], has_more: false }),
    contact: async () => ({ ...remote }), contactSegments: async () => ({ data: [{ id: marketing.segmentId }] }),
    updateContact: async (_id, patch) => Object.assign(remote, patch),
    createBroadcast: async body => { broadcasts.push(body); return { id: randomUUID() }; },
    sendBroadcast: async id => { sends.push(id); entered?.(); if (holdSend) await holdSend; if (timeout) throw Object.assign(new Error('Uncertain provider result'), { status: 502 }); },
    broadcast: async () => ({ status: 'sent' }),
  };
  const client = { ready: true, segmentId: marketing.segmentId, add: async (email, profile) => { contacts.push({ email, profile }); return { id: contactId, unsubscribed: false }; } };
  const app = await createApp({ marketing, newsletter: client, mailer: { ready: true, send: async message => { if (failTest) throw Object.assign(new Error('Test rejected'), { status: 502 }); messages.push(message); } } });
  const agent = request.agent(app), junior = request.agent(app);
  const login = await agent.post('/api/auth/login').set('Origin', origin).send({ email: 'newsletter-owner@example.com', password });
  const juniorLogin = await junior.post('/api/auth/login').set('Origin', origin).send({ email: 'newsletter-junior@example.com', password });
  const base = '/api/admin/newsletters';
  const mutate = (method, path, body) => agent[method](base + path).set('Origin', origin).set('X-CSRF-Token', login.body.csrf).send(body);
  assert.equal(login.status, 200);
  assert.equal((await request(app).get(base + '/members')).status, 401);
  assert.equal((await junior.get(base + '/members')).status, 403);
  assert.equal((await junior.post(base + '/campaigns').set('Origin', origin).set('X-CSRF-Token', juniorLogin.body.csrf).send({})).status, 403);
  assert.equal((await agent.post(base + '/campaigns').set('Origin', origin).send({})).status, 403);
  const data = { subject: 'Community encouragement', previewText: 'Fresh conversations', title: 'Good things for your home', intro: 'Hello friends', closing: 'With love', theme: 'sage', showImages: true, address: '123 Example Street, Example City', blocks: [{ source: 'page:about' }] };
  const create = async (patch = {}) => { const result = await mutate('post', '/campaigns', { data: { ...data, ...patch } }); assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body; };
  const test = async draft => { const result = await mutate('post', `/campaigns/${draft.id}/test`, { version: draft.version, to: 'preview@example.com' }); assert.equal(result.status, 200, JSON.stringify(result.body)); return result; };
  const send = draft => mutate('post', `/campaigns/${draft.id}/send`, { version: draft.version, currentPassword: password, confirm: 'SEND', previewHash: draft.contentHash });
  const get = async id => (await agent.get(base + '/campaigns/' + id)).body;
  // Private channels, hidden episodes, and unpublished drafts never enter the picker.
  const episodes = [];
  await rows('INSERT INTO podcast_channels (user_id, slug, data, is_public) VALUES (?, ?, ?, FALSE)', [juniorId, 'newsletter-private-fixture', JSON.stringify({ coverUrl: '' })]);
  for (const [owner, hidden, published] of [[adminId, false, true], [adminId, true, true], [juniorId, false, true], [adminId, false, false]]) {
    const id = randomUUID(), jobId = randomUUID(); episodes.push({ id, jobId });
    await rows('INSERT INTO episodes (id, user_id, title, description, arrangement, admin_hidden) VALUES (?, ?, ?, ?, ?, ?)', [id, owner, 'Newsletter fixture', 'Encouragement', '{}', hidden]);
    if (published) {
      await rows('INSERT INTO render_jobs (id, episode_id, revision, snapshot) VALUES (?, ?, 1, ?)', [jobId, id, '{}']);
      await rows('INSERT INTO publications (episode_id, job_id, title, description, episode_number) VALUES (?, ?, ?, ?, 1)', [id, jobId, 'Newsletter fixture', 'Encouragement']);
    }
  }
  const catalog = (await agent.get(base + '/catalog')).body;
  assert.ok(catalog.sources.some(item => item.key === `episode:${episodes[0].id}`));
  for (const item of episodes.slice(1)) assert.equal(catalog.sources.some(source => source.key === `episode:${item.id}`), false);
  const removed = await create({ blocks: [{ source: `episode:${episodes[0].id}` }] });
  await rows('UPDATE episodes SET admin_hidden = TRUE WHERE id = ?', [episodes[0].id]);
  assert.equal((await mutate('post', `/campaigns/${removed.id}/preview`)).status, 409);
  assert.equal((await mutate('post', `/campaigns/${removed.id}/test`, { version: 1, to: 'preview@example.com' })).status, 409);
  assert.equal((await mutate('post', '/campaigns', { data: { ...data, blocks: [{ source: `episode:${episodes[2].id}` }] } })).status, 409);
  for (const item of episodes) {
    await rows('DELETE FROM publications WHERE episode_id = ?', [item.id]);
    await rows('DELETE FROM render_jobs WHERE episode_id = ?', [item.id]);
    await rows('DELETE FROM episodes WHERE id = ?', [item.id]);
  }
  await rows('DELETE FROM podcast_channels WHERE user_id = ?', [juniorId]);
  let draft = await create();
  const preview = await mutate('post', `/campaigns/${draft.id}/preview`);
  assert.equal(preview.status, 200); assert.ok(preview.body.html.includes('Godly Homes'));
  assert.equal((await send(draft)).status, 409, 'Cannot send without a successful test');
  failTest = true;
  assert.equal((await mutate('post', `/campaigns/${draft.id}/test`, { version: 1, to: 'preview@example.com' })).status, 502);
  assert.equal((await get(draft.id)).testHash, null); failTest = false;
  await test(draft); assert.ok(messages.at(-1).html.includes('test preview'));
  const updated = await mutate('put', `/campaigns/${draft.id}`, { version: draft.version, data: { ...data, theme: 'navy' } });
  assert.equal(updated.status, 200); assert.equal(updated.body.testHash, null);
  assert.equal((await mutate('put', `/campaigns/${draft.id}`, { version: draft.version, data })).status, 409);
  draft = updated.body; await test(draft);
  assert.equal((await mutate('post', `/campaigns/${draft.id}/send`, { version: draft.version, currentPassword: 'wrong', confirm: 'SEND', previewHash: draft.contentHash })).status, 401);
  // Two requests for the same version can produce only one broadcast/send.
  let release; holdSend = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const sending = send(draft).then(value => value); await started;
  assert.equal((await mutate('post', `/campaigns/${draft.id}/status`)).status, 409, 'Status polling cannot overwrite a live send');
  assert.equal((await send(draft)).status, 409);
  release(); assert.equal((await sending).status, 200); holdSend = null; entered = null;
  assert.equal(broadcasts.length, 1); assert.equal(sends.length, 1);
  assert.equal((await get(draft.id)).state, 'queued');
  assert.equal((await mutate('put', `/campaigns/${draft.id}`, { version: 2, data })).status, 409);
  assert.equal((await mutate('post', `/campaigns/${draft.id}/status`)).body.state, 'sent');
  // An uncertain provider send must remain locked, never be silently retried.
  const uncertain = await create(); await test(uncertain); timeout = true;
  assert.equal((await send(uncertain)).status, 502); timeout = false;
  assert.equal((await get(uncertain.id)).state, 'needs_review');
  assert.equal(sends.length, 2);
  // Changed target configuration invalidates the previous test without creating a broadcast.
  const changed = await create(); await test(changed); marketing.segmentId = randomUUID();
  assert.equal((await mutate('post', `/campaigns/${changed.id}/test`, { version: 1, to: 'preview@example.com' })).status, 409);
  marketing.segmentId = client.segmentId;
  // New invitations cannot directly enroll a mailbox; pending addresses cannot be synced.
  const invite = 'studio-member@example.com';
  assert.equal((await mutate('post', '/members/invite', { email: invite })).status, 200);
  assert.equal(contacts.length, 0);
  await mutate('post', '/members/action', { email: invite, action: 'retry' }); assert.equal(contacts.length, 0);
  const tokenFrom = message => new URLSearchParams(new URL(message.text.match(/https?:\/\/[^\s]+/)[0]).hash.slice(1)).get('token');
  const confirm = token => request(app).post('/api/newsletter/confirm').set('Origin', origin).send({ token });
  assert.equal((await confirm(tokenFrom(messages.at(-1)))).status, 200); assert.equal(contacts.length, 1);
  assert.equal((await mutate('post', '/members/action', { email: invite, action: 'profile', firstName: 'Daniel' })).status, 200);
  assert.equal(remote.first_name, 'Daniel');
  assert.equal((await mutate('post', '/members/action', { email: invite, action: 'unsubscribe', currentPassword: 'wrong' })).status, 401);
  await rows('UPDATE subscribers SET resend_lease_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE email = ?', [invite]);
  assert.equal((await mutate('post', '/members/action', { email: invite, action: 'unsubscribe', currentPassword: password })).status, 409);
  await rows('UPDATE subscribers SET resend_lease_until = NULL WHERE email = ?', [invite]);
  assert.equal((await mutate('post', '/members/action', { email: invite, action: 'unsubscribe', currentPassword: password })).status, 200);
  assert.equal(remote.unsubscribed, true);
  await syncNewsletterSubscriber(invite, client); assert.equal(contacts.length, 1, 'Admin sync cannot re-subscribe an opted-out member');
  await rows('UPDATE subscribers SET confirmation_requested_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 MINUTE) WHERE email = ?', [invite]);
  await mutate('post', '/members/invite', { email: invite });
  assert.equal(contacts.length, 1);
  assert.equal((await confirm(tokenFrom(messages.at(-1)))).status, 200);
  assert.equal(contacts.length, 2); assert.equal(contacts.at(-1).profile.resubscribe, true);
  assert.equal((await agent.get(base + '/audience')).body.segment.name, 'GH newsletter');
  await rows("UPDATE users SET role = 'member' WHERE id IN (?, ?)", [adminId, juniorId]);
  console.log('PASS: Newsletter full-admin authorization/CSRF, saved themes/previews, test acceptance, stale edits, duplicate-send prevention, uncertain sends, target changes, membership consent and guarded unsubscribe/rejoin.');
}
