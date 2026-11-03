import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';

export function databaseTLS(env = process.env) {
  const local = Boolean(env.DB_SOCKET) || ['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST || '127.0.0.1');
  if (!local && ['false', '0', 'disabled'].includes(env.DB_TLS)) throw new Error('Remote database connections require verified TLS. Use a local SSH tunnel if TLS is unavailable.');
  if (local && env.DB_TLS !== 'required') return {};
  if (!local && isIP(env.DB_HOST)) throw new Error('Use the database certificate hostname for remote TLS connections, not an IP address.');
  return { ssl: { rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2',
    ...(env.DB_SSL_CA_FILE ? { ca: readFileSync(env.DB_SSL_CA_FILE, 'utf8') } : {}),
  } };
}
