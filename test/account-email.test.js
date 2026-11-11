import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailer, accountMessage } from '../server/email.js';

test('SMTP requires complete configuration and verified TLS, and checks recipient acceptance', async () => {
  assert.equal(createMailer({}).ready, false);
  await assert.rejects(createMailer({}).verify(), /Configure SMTP/);
  let settings, message;
  const env = { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'hello@example.com', SMTP_PASSWORD: 'secret', MAIL_FROM: 'hello@example.com' };
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
