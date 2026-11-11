import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailer, accountMessage } from '../server/email.js';

test('SMTP requires complete configuration and verified TLS, and checks recipient acceptance', async () => {
  assert.equal(createMailer({}).ready, false);
  await assert.rejects(createMailer({}).verify(), /Configure RESEND_API_KEY/);
  let settings, message;
  const env = { MAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'hello@example.com', SMTP_PASSWORD: 'secret', MAIL_FROM: 'hello@example.com' };
  const mailer = createMailer(env, options => { settings = options; return { verify: async () => true, sendMail: async value => { message = value; return { accepted: [value.to] }; } }; });
  await mailer.verify();
  await mailer.send({ to: 'member@example.com', subject: 'Welcome', text: 'Hello' });
  assert.equal(settings.secure, true);
  assert.equal(settings.tls.rejectUnauthorized, true);
  assert.equal(settings.disableUrlAccess, true);
  assert.equal(message.from.address, env.MAIL_FROM);
  createMailer({ ...env, SMTP_PORT: '587' }, options => { assert.equal(options.secure, false); assert.equal(options.requireTLS, true); return {}; });
  assert.throws(() => createMailer({ ...env, SMTP_PORT: '25' }), /SMTP_PORT/);
  const rejected = createMailer(env, () => ({ sendMail: async () => ({ accepted: [] }) }));
  await assert.rejects(rejected.send({ to: 'member@example.com' }), /did not accept/);
});

test('email links use a fixed application origin and fragments for secrets', () => {
  const token = 'a'.repeat(64);
  for (const purpose of ['verify', 'reset']) {
    const message = accountMessage(purpose, token);
    const url = new URL(message.text.match(/https?:\/\/[^\s]+/)[0]);
    assert.equal(url.pathname, '/account');
    assert.equal(url.search, '');
    assert.equal(new URLSearchParams(url.hash.slice(1)).get('token'), token);
    assert.ok(message.text.includes(purpose === 'verify' ? '24 hours' : '30 minutes'));
  }
});

test('Gmail OAuth refreshes once, composes a real MIME message and sends through the Gmail API', async () => {
  const env = { MAIL_PROVIDER: 'gmail', MAIL_FROM: 'hello@example.com', GMAIL_CLIENT_ID: 'client', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' };
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/token')) return Response.json({ access_token: 'access', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.send' });
    return Response.json({ id: 'gmail-message' });
  };
  const mailer = createMailer(env, undefined, request);
  assert.equal(mailer.provider, 'gmail');
  await Promise.all([mailer.verify(), mailer.verify()]);
  await mailer.send({ to: 'member@example.com', subject: 'Welcome', text: 'Hello from Godly Homes' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.body.get('grant_type'), 'refresh_token');
  assert.equal(calls[0].options.body.get('refresh_token'), 'refresh');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer access');
  const mime = Buffer.from(JSON.parse(calls[1].options.body).raw, 'base64url').toString();
  assert.match(mime, /From: Godly Homes <hello@example.com>/);
  assert.match(mime, /To: member@example.com/);
  assert.match(mime, /Subject: Welcome/);
  assert.match(mime, /Hello from Godly Homes/);
  assert.equal(calls[1].options.redirect, 'error');
});

test('Gmail OAuth configuration fails closed and never falls back to a password', async () => {
  const incomplete = createMailer({ MAIL_PROVIDER: 'gmail', SMTP_PASSWORD: 'unused' });
  assert.equal(incomplete.ready, false);
  await assert.rejects(incomplete.verify(), /GMAIL_CLIENT_ID/);
  const env = { MAIL_PROVIDER: 'gmail', MAIL_FROM: 'hello@example.com', GMAIL_CLIENT_ID: 'client', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' };
  const denied = createMailer(env, undefined, async () => Response.json({ error: 'invalid_grant', error_description: 'sensitive details' }, { status: 400 }));
  await assert.rejects(denied.verify(), error => error.code === 'EMAIL_OAUTH_AUTH' && !error.message.includes('sensitive'));
  const wrongScope = createMailer(env, undefined, async () => Response.json({ access_token: 'access', expires_in: 3600, scope: 'openid' }));
  await assert.rejects(wrongScope.verify(), error => error.code === 'EMAIL_OAUTH_SCOPE');
  assert.throws(() => createMailer({ MAIL_PROVIDER: 'unknown' }), /MAIL_PROVIDER/);
});

test('Gmail retries only an explicit unauthorized send and does not repeat ambiguous failures', async () => {
  const env = { MAIL_PROVIDER: 'gmail', MAIL_FROM: 'hello@example.com', GMAIL_CLIENT_ID: 'client', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' };
  let refreshes = 0, sends = 0;
  const request = async url => {
    if (url.endsWith('/token')) { refreshes++; return Response.json({ access_token: `access-${refreshes}`, expires_in: 3600 }); }
    sends++;
    return sends === 1 ? Response.json({}, { status: 401 }) : Response.json({ id: 'sent' });
  };
  await createMailer(env, undefined, request).send({ to: 'member@example.com', subject: 'Test', text: 'Test' });
  assert.equal(refreshes, 2); assert.equal(sends, 2);
  sends = 0;
  const failing = createMailer(env, undefined, async url => {
    if (url.endsWith('/token')) return Response.json({ access_token: 'access', expires_in: 3600 });
    sends++;
    return Response.json({}, { status: 503 });
  });
  await assert.rejects(failing.send({ to: 'member@example.com', subject: 'Test', text: 'Test' }), error => error.code === 'EMAIL_GMAIL_SEND');
  assert.equal(sends, 1);
});

test('Resend is the default provider and uses a sending-only API key without management calls', async () => {
  const calls = [];
  const mailer = createMailer({ RESEND_API_KEY: 'private-key', MAIL_FROM: 'hello@example.com' }, undefined, async (url, options) => {
    calls.push({ url, options }); return Response.json({ id: 'resend-message' });
  });
  assert.equal(mailer.ready, true); assert.equal(mailer.provider, 'resend');
  await mailer.verify();
  assert.equal(calls.length, 0, 'Configuration check makes no authentication or delivery claim');
  assert.deepEqual(await mailer.send({ to: 'member@example.com', subject: 'Welcome', text: 'Hello', idempotencyKey: 'welcome-user/123' }), { id: 'resend-message' });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer private-key');
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'welcome-user/123');
  assert.equal(calls[0].options.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].options.body), { from: 'Godly Homes <hello@example.com>', to: ['member@example.com'], subject: 'Welcome', text: 'Hello' });
});

test('Resend rejects incomplete settings and sanitizes provider errors without retrying or falling back', async () => {
  const unavailable = createMailer({ MAIL_PROVIDER: 'resend', SMTP_PASSWORD: 'unused', GMAIL_CLIENT_ID: 'unused' });
  assert.equal(unavailable.ready, false);
  await assert.rejects(unavailable.verify(), /Configure RESEND_API_KEY/);
  for (const [status, code] of [[401, 'EMAIL_RESEND_AUTH'], [403, 'EMAIL_RESEND_FORBIDDEN'], [429, 'EMAIL_RESEND_RATE_LIMIT'], [503, 'EMAIL_RESEND_SEND'], [200, 'EMAIL_RESEND_SEND']]) {
    let requests = 0;
    const mailer = createMailer({ RESEND_API_KEY: 'private-key', MAIL_FROM: 'hello@example.com' }, undefined, async () => {
      requests++; return Response.json({ message: 'sensitive provider details' }, { status });
    });
    await assert.rejects(mailer.send({ to: 'member@example.com', subject: 'Test', text: 'Test' }), error => error.code === code && !error.message.includes('sensitive') && !error.message.includes('private-key'));
    assert.equal(requests, 1);
  }
});
