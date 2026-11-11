import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rows, transaction } from './db.js';
import { digest, hashPassword } from './auth.js';
import { accountMessage, sendWelcome } from './email.js';

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const passwordSchema = z.string().min(12, 'Use at least 12 characters.').max(200);
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/, 'This link is invalid. Request a new email.');
const invalid = () => Object.assign(new Error('This link has expired or has already been used. Request a new email.'), { status: 400 });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const generic = { message: 'If this address is eligible, an email will arrive shortly. Check your inbox and spam folder.' };

export function accountRoutes(mailer) {
  const router = Router();
  const registrationEnabled = process.env.REGISTRATION_ENABLED !== 'false';
  router.get('/options', (_req, res) => res.json({ emailEnabled: mailer.ready, registrationEnabled: registrationEnabled && mailer.ready }));
  router.use((req, _res, next) => ['/register', '/resend-verification', '/forgot-password', '/verify-email', '/reset-password'].includes(req.path) ? next() : next('router'));
  router.use(rateLimit({ windowMs: 15 * 60000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false }));
  router.use((_req, res, next) => mailer.ready ? next() : res.status(503).json({ error: 'Account email is being set up. Please try again later.' }));

  async function requestLink(email, purpose) {
    // Serializing on the user prevents concurrent requests bypassing the cooldown.
    await transaction(async connection => {
      const query = (sql, values) => rows(sql, values, connection);
      const [user] = await query('SELECT * FROM users WHERE email = ? FOR UPDATE', [email]);
      if (!user || user.disabled_at || (purpose === 'verify' ? user.email_verified_at : (user.email_verification_required && !user.email_verified_at))) return;
      const [recent] = await query('SELECT token_hash FROM account_tokens WHERE user_id = ? AND purpose = ? AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE)', [user.id, purpose]);
      if (recent) return;
      const token = randomBytes(32).toString('hex');
      await query('DELETE FROM account_tokens WHERE user_id = ? AND purpose = ?', [user.id, purpose]);
      await query(`INSERT INTO account_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${purpose === 'verify' ? '24 HOUR' : '30 MINUTE'}))`, [digest(token), user.id, purpose]);
      // A delivery failure rolls back the token replacement, allowing a retry.
      await mailer.send({ to: user.email, ...accountMessage(purpose, token) });
    });
  }
  async function deliverLink(email, purpose) {
    try { await requestLink(email, purpose); }
    catch (error) {
      // Do not log credentials, recipients, or link tokens, or reveal account existence.
      console.error('Account email request failed:', error.code || 'delivery_error');
    }
  }
  router.post('/register', wrap(async (req, res) => {
    if (!registrationEnabled) return res.status(403).json({ error: 'New registration is currently closed.' });
    const input = z.object({ email: emailSchema, password: passwordSchema, confirmPassword: passwordSchema }).parse(req.body);
    if (input.password !== input.confirmPassword) return res.status(400).json({ error: 'The passwords do not match.' });
    const passwordHash = await hashPassword(input.password);
    await rows("INSERT IGNORE INTO users (id, email, password_hash, role, email_verification_required) VALUES (?, ?, ?, 'member', TRUE)", [randomUUID(), input.email, passwordHash]);
    await deliverLink(input.email, 'verify');
    res.json(generic);
  }));
  for (const [path, purpose] of [['resend-verification', 'verify'], ['forgot-password', 'reset']]) {
    router.post(`/${path}`, wrap(async (req, res) => {
      const { email } = z.object({ email: emailSchema }).parse(req.body);
      await deliverLink(email, purpose);
      res.json(generic);
    }));
  }
  async function consume(token, purpose, update) {
    const [candidate] = await rows('SELECT user_id FROM account_tokens WHERE token_hash = ? AND purpose = ?', [digest(token), purpose]);
    if (!candidate) throw invalid();
    return transaction(async connection => {
      const query = (sql, values) => rows(sql, values, connection);
      const [user] = await query('SELECT * FROM users WHERE id = ? FOR UPDATE', [candidate.user_id]);
      const [valid] = await query('SELECT token_hash FROM account_tokens WHERE token_hash = ? AND user_id = ? AND purpose = ? AND expires_at > UTC_TIMESTAMP() FOR UPDATE', [digest(token), candidate.user_id, purpose]);
      if (!user || user.disabled_at || !valid) throw invalid();
      await update(user, query);
      await query('DELETE FROM account_tokens WHERE user_id = ? AND purpose = ?', [user.id, purpose]);
      return user.id;
    });
  }
  router.post('/verify-email', wrap(async (req, res) => {
    const { token } = z.object({ token: tokenSchema }).parse(req.body);
    const id = await consume(token, 'verify', async (user, query) => {
      if (user.email_verified_at) throw invalid();
      await query('UPDATE users SET email_verified_at = UTC_TIMESTAMP() WHERE id = ?', [user.id]);
    });
    try { await deliverWelcome(id, mailer); }
    catch (error) { console.error('Welcome email pending:', error.code || 'delivery_error'); }
    res.json({ message: 'Your email is verified. You can now sign in.' });
  }));
  router.post('/reset-password', wrap(async (req, res) => {
    const input = z.object({ token: tokenSchema, password: passwordSchema, confirmPassword: passwordSchema }).parse(req.body);
    if (input.password !== input.confirmPassword) return res.status(400).json({ error: 'The passwords do not match.' });
    const hash = await hashPassword(input.password);
    await consume(input.token, 'reset', async (user, query) => {
      if (user.email_verification_required && !user.email_verified_at) throw invalid();
      await query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
      await query('DELETE FROM sessions WHERE user_id = ?', [user.id]);
    });
    res.json({ message: 'Password reset. Sign in with your new password. All previous sessions have been signed out.' });
  }));
  return router;
}

export async function deliverWelcome(id, mailer) {
  return transaction(async connection => {
    const query = (sql, values) => rows(sql, values, connection);
    const [user] = await query('SELECT * FROM users WHERE id = ? FOR UPDATE', [id]);
    if (user) await sendWelcome(user, mailer, query);
  });
}
export async function retryAccountEmail(mailer) {
  if (!mailer.ready) return;
  await rows('DELETE FROM account_tokens WHERE expires_at <= UTC_TIMESTAMP()');
  const pending = await rows('SELECT id FROM users WHERE email_verified_at IS NOT NULL AND welcome_sent_at IS NULL LIMIT 20');
  for (const user of pending) await deliverWelcome(user.id, mailer);
}
