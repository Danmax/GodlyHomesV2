import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { rows } from './db.js';
import { config } from './config.js';

const scrypt = promisify(scryptCallback);
export const digest = token => createHash('sha256').update(token).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, hash) {
  const [salt, expected] = hash.split(':');
  const key = await scrypt(password, salt, 64);
  const stored = Buffer.from(expected, 'hex');
  return stored.length === key.length && timingSafeEqual(stored, key);
}
export async function authenticate(req, res, next) {
  const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('gh_session='))?.slice(11);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({ error: 'Sign in to continue.' });
  const [session] = await rows(`SELECT s.csrf_token, s.user_id, u.email FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()`, [digest(token)]);
  if (!session) return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  req.user = { id: session.user_id, email: session.email };
  req.csrf = session.csrf_token;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-csrf-token'] !== req.csrf) {
    return res.status(403).json({ error: 'Refresh the page and try again.' });
  }
  next();
}
export const cookieOptions = () => ({ httpOnly: true, secure: config.production, sameSite: 'strict', path: '/', maxAge: 7 * 86400000 });
