import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

export async function testUserManagement({ createApp, rows, hashPassword, origin }) {
  const app = await createApp();
  const password = 'User-management-password-123';
  const hash = await hashPassword(password);
  async function account(name, role, verified = true) {
    const id = randomUUID(), email = `${name}@users-test.example`;
    await rows('INSERT INTO users (id, email, password_hash, role, email_verification_required, email_verified_at) VALUES (?, ?, ?, ?, ?, ?)', [id, email, hash, role, !verified, verified ? new Date() : null]);
    return { id, email, agent: request.agent(app) };
  }
  async function login(user) {
    const result = await user.agent.post('/api/auth/login').set('Origin', origin).send({ email: user.email, password });
    assert.equal(result.status, 200, JSON.stringify(result.body)); user.csrf = result.body.csrf;
  }
  const mutate = (user, method, path, body) => user.agent[method](path).set('Origin', origin).set('X-CSRF-Token', user.csrf).send(body);
  const state = async user => (await rows('SELECT * FROM users WHERE id = ?', [user.id]))[0];
  const change = async (actor, target, body) => mutate(actor, 'patch', `/api/admin/users/${target.id}`, { version: (await state(target)).access_version, ...body });
  const owner = await account('owner', 'admin'), junior = await account('junior', 'junior_admin'), member = await account('applicant', 'member'), unverified = await account('unverified', 'member', false), second = await account('second-owner', 'admin');
  for (const user of [owner, junior, member, second]) await login(user);
  assert.equal((await request(app).get('/api/admin/users')).status, 401);
  assert.equal((await member.agent.get('/api/admin/users')).status, 403);
  assert.equal((await member.agent.get('/api/auth/access')).body.podcasterStatus, 'none');
  assert.equal((await mutate(member, 'post', '/api/auth/access/request', { message: 'Faith and family conversations each week.' })).status, 200);
  assert.equal((await mutate(member, 'post', '/api/auth/access/request', { message: 'Another request is not needed.' })).status, 409);
  const pending = await junior.agent.get('/api/admin/users?pending=true');
  assert.ok(pending.body.users.some(user => user.id === member.id));
  assert.ok(pending.body.users.every(user => !('password_hash' in user)));
  const oldVersion = (await state(member)).access_version;
  assert.equal((await member.agent.patch(`/api/admin/users/${member.id}`).set('Origin', origin).send({ action: 'role', version: oldVersion, role: 'admin' })).status, 403);
  assert.equal((await change(junior, member, { action: 'role', role: 'admin' })).status, 403);
  const reviews = await Promise.all([
    mutate(junior, 'patch', `/api/admin/users/${member.id}`, { action: 'review', approve: true, version: oldVersion }),
    mutate(owner, 'patch', `/api/admin/users/${member.id}`, { action: 'review', approve: false, version: oldVersion }),
  ]);
  assert.deepEqual(reviews.map(r => r.status).sort(), [200, 409]);
  assert.equal((await member.agent.get('/api/auth/me')).status, 401, 'Review revokes the old member session');
  // Ensure this fixture is approved irrespective of which competing review won.
  if ((await state(member)).role !== 'publisher') assert.equal((await change(owner, member, { action: 'role', role: 'publisher' })).status, 200);
  await login(member);
  assert.equal((await member.agent.get('/api/episodes')).status, 200);
  assert.equal((await junior.agent.get('/api/admin/documents')).status, 200);
  const about = (await junior.agent.get('/api/admin/documents')).body.find(doc => doc.key === 'about');
  assert.equal((await mutate(junior, 'put', '/api/admin/documents/about', { data: about.data, version: about.version })).status, 200);
  for (const path of ['/api/admin/entries/product', '/api/admin/entries/%70roduct', '/api/admin/commerce/orders']) assert.equal((await junior.agent.get(path)).status, 403);
  assert.equal((await junior.agent.get('/api/admin/episodes')).status, 200);
  assert.equal((await mutate(junior, 'delete', `/api/admin/episodes/${randomUUID()}`, { version: 1 })).status, 403);
  assert.equal((await change(junior, owner, { action: 'status', disabled: true })).status, 403);
  assert.equal((await change(owner, unverified, { action: 'role', role: 'junior_admin' })).status, 400);
  assert.equal((await change(owner, owner, { action: 'role', role: 'member' })).status, 400, 'Self-demotion is blocked');
  assert.equal((await change(owner, member, { action: 'role', role: 'junior_admin' })).status, 200);
  assert.equal((await member.agent.get('/api/auth/me')).status, 401);
  await login(member);
  assert.equal((await member.agent.get('/api/admin/documents')).status, 200);
  assert.equal((await change(owner, member, { action: 'status', disabled: true })).status, 200);
  assert.equal((await member.agent.get('/api/auth/me')).status, 401);
  assert.equal((await member.agent.post('/api/auth/login').set('Origin', origin).send({ email: member.email, password })).status, 401);
  assert.equal((await change(owner, member, { action: 'status', disabled: false })).status, 200);
  await login(member);
  assert.equal((await change(owner, member, { action: 'sessions' })).status, 200);
  assert.equal((await member.agent.get('/api/auth/me')).status, 401);
  const history = await owner.agent.get(`/api/admin/users/${member.id}/history`);
  assert.ok(history.body.some(event => event.action === 'review'));
  assert.ok(history.body.some(event => event.action === 'role'));
  assert.equal((await junior.agent.get(`/api/admin/users/${member.id}/history`)).status, 403);
  // Both actors start as full admins; serialization must prevent both demotions.
  const versions = await Promise.all([state(owner), state(second)]);
  const changes = await Promise.all([
    mutate(owner, 'patch', `/api/admin/users/${second.id}`, { action: 'role', role: 'member', version: versions[1].access_version }),
    mutate(second, 'patch', `/api/admin/users/${owner.id}`, { action: 'role', role: 'member', version: versions[0].access_version }),
  ]);
  assert.equal(changes.filter(r => r.status === 200).length, 1);
  assert.equal((await rows("SELECT COUNT(*) AS total FROM users WHERE id IN (?, ?) AND role = 'admin' AND disabled_at IS NULL", [owner.id, second.id]))[0].total, 1);
  // Preserve the singleton-owner fixture for all later suites.
  await rows("UPDATE users SET role = 'member' WHERE id IN (?, ?, ?, ?)", [owner.id, second.id, member.id, junior.id]);
  console.log('PASS: Podcaster requests/approval races, junior content editing and financial restrictions, admin grants, disabled accounts, session revocation, audit history, CSRF, encoded paths, stale edits, and concurrent admin demotions.');
}
