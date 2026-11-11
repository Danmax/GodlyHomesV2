import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { rows, transaction, json } from './db.js';
import { requireStaff } from './auth.js';

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const verified = user => !user.email_verification_required || Boolean(user.email_verified_at);
const version = z.number().int().positive();
const summary = user => ({ id: user.id, email: user.email, role: user.role, version: user.access_version,
  verified: verified(user), disabled: Boolean(user.disabled_at), createdAt: user.created_at,
  podcasterStatus: user.podcaster_status, podcasterMessage: user.podcaster_message,
  podcasterFeedback: user.podcaster_feedback, requestedAt: user.podcaster_requested_at });

export const memberAccess = Router();
memberAccess.get('/', wrap(async (req, res) => {
  const [user] = await rows('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json(summary(user));
}));
memberAccess.post('/request', rateLimit({ windowMs: 3600000, limit: 5, keyGenerator: req => req.user.id, legacyHeaders: false }), wrap(async (req, res) => {
  const input = z.object({ message: z.string().trim().min(10, 'Tell us a little about your podcast (at least 10 characters).').max(1000) }).parse(req.body);
  await transaction(async connection => {
    const query = (sql, values) => rows(sql, values, connection);
    const [user] = await query('SELECT * FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
    if (!user || user.disabled_at || user.role !== 'member') throw fail('Only active member accounts can request podcaster access.', 403);
    if (!verified(user)) throw fail('Verify your email before requesting podcaster access.', 403);
    if (user.podcaster_status === 'pending') throw fail('Your podcaster request is already awaiting review.', 409);
    await query(`UPDATE users SET podcaster_status = 'pending', podcaster_message = ?, podcaster_feedback = '',
      podcaster_requested_at = UTC_TIMESTAMP(), access_version = access_version + 1 WHERE id = ?`, [input.message, user.id]);
  });
  res.json({ message: 'Your podcaster request is awaiting review.' });
}));

export const userAdmin = Router();
userAdmin.use(requireStaff);
userAdmin.get('/', wrap(async (req, res) => {
  const input = z.object({ q: z.string().trim().max(254).default(''), pending: z.enum(['true', 'false']).default('false'), page: z.coerce.number().int().min(1).max(100000).default(1) }).parse(req.query);
  const filters = [], values = [];
  if (input.q) { filters.push('LOCATE(?, email) > 0'); values.push(input.q); }
  if (input.pending === 'true') filters.push("podcaster_status = 'pending' AND role = 'member' AND disabled_at IS NULL");
  const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
  const [count] = await rows(`SELECT COUNT(*) AS total FROM users${where}`, values);
  const users = await rows(`SELECT * FROM users${where} ORDER BY created_at DESC, id LIMIT 50 OFFSET ${(input.page - 1) * 50}`, values);
  res.json({ users: users.map(summary), total: Number(count.total), page: input.page });
}));
userAdmin.patch('/:id', wrap(async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const input = z.discriminatedUnion('action', [
    z.object({ action: z.literal('role'), version, role: z.enum(['member', 'publisher', 'junior_admin', 'admin']) }),
    z.object({ action: z.literal('status'), version, disabled: z.boolean() }),
    z.object({ action: z.literal('sessions'), version }),
    z.object({ action: z.literal('review'), version, approve: z.boolean(), feedback: z.string().trim().max(300).default('') }),
  ]).parse(req.body);
  await transaction(async connection => {
    const query = (sql, values) => rows(sql, values, connection);
    // Serialize access changes so concurrent demotions cannot remove the last
    // administrator, and recheck the actor under lock rather than trust old auth.
    await query('SELECT id FROM user_management_gate WHERE id = 1 FOR UPDATE', []);
    const [actor] = await query('SELECT * FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
    if (!actor || actor.disabled_at || !['admin', 'junior_admin'].includes(actor.role)) throw fail('Administrator access changed. Sign in again.', 403);
    const [target] = await query('SELECT * FROM users WHERE id = ? FOR UPDATE', [id]);
    if (!target) throw fail('User not found.', 404);
    if (target.access_version !== input.version) throw fail('This account changed. Refresh before trying again.', 409);
    if (actor.role !== 'admin' && input.action !== 'review') throw fail('Only a full administrator can change account access.', 403);
    if (actor.id === target.id && ['role', 'status', 'sessions'].includes(input.action)) throw fail('Use another full administrator to change your own access.');
    const before = { role: target.role, disabled: Boolean(target.disabled_at), podcasterStatus: target.podcaster_status };
    if (input.action === 'review') {
      if (target.role !== 'member' || target.disabled_at || target.podcaster_status !== 'pending') throw fail('This account has no active podcaster request to review.', 409);
      if (!verified(target)) throw fail('The applicant must verify their email first.');
      await query(`UPDATE users SET role = ?, podcaster_status = ?, podcaster_feedback = ? WHERE id = ?`, [input.approve ? 'publisher' : 'member', input.approve ? 'approved' : 'rejected', input.feedback, id]);
    } else if (input.action === 'role') {
      if (input.role !== 'member' && (!verified(target) || target.disabled_at)) throw fail('Verify and reactivate this account before granting access.');
      if (target.role === 'admin' && input.role !== 'admin') {
        const [admins] = await query("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND disabled_at IS NULL", []);
        if (Number(admins.total) <= 1) throw fail('Keep at least one active full administrator.');
      }
      await query("UPDATE users SET role = ?, podcaster_status = ?, podcaster_feedback = '' WHERE id = ?", [input.role, input.role === 'member' ? 'none' : 'approved', id]);
    } else if (input.action === 'status') {
      if (input.disabled && target.role === 'admin' && !target.disabled_at) {
        const [admins] = await query("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND disabled_at IS NULL", []);
        if (Number(admins.total) <= 1) throw fail('Keep at least one active full administrator.');
      }
      await query('UPDATE users SET disabled_at = ? WHERE id = ?', [input.disabled ? new Date() : null, id]);
    }
    await query('UPDATE users SET access_version = access_version + 1 WHERE id = ?', [id]);
    await query('DELETE FROM sessions WHERE user_id = ?', [id]);
    await query('INSERT INTO user_access_events (id, actor_id, target_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())', [randomUUID(), actor.id, id, input.action, JSON.stringify({ before, change: input })]);
  });
  res.json({ message: 'Account updated. Previous sessions have been signed out.' });
}));
userAdmin.get('/:id/history', wrap(async (req, res) => {
  // Full administrators can inspect access history; junior administrators only review applications.
  if (req.user.role !== 'admin') throw fail('Full administrator access is required.', 403);
  const events = await rows(`SELECT e.action, e.details, e.created_at, u.email AS actor_email FROM user_access_events e
    JOIN users u ON u.id = e.actor_id WHERE e.target_id = ? ORDER BY e.created_at DESC LIMIT 30`, [z.uuid().parse(req.params.id)]);
  res.json(events.map(event => ({ action: event.action, details: json(event.details), at: event.created_at, actorEmail: event.actor_email })));
}));
