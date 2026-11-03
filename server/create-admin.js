import { randomUUID } from 'node:crypto';
import { db, rows } from './db.js';
import { hashPassword } from './auth.js';
import { z } from 'zod';

try {
  const email = z.email().parse(process.env.ADMIN_EMAIL?.trim().toLowerCase());
  const password = z.string().min(12).max(200).parse(process.env.ADMIN_PASSWORD);
  await rows("INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'admin')", [randomUUID(), email, await hashPassword(password)]);
  console.log('Studio administrator created. Remove ADMIN_PASSWORD from the environment.');
} catch (error) {
  console.error(error.code === 'ER_DUP_ENTRY' ? 'This administrator already exists; no credentials were changed.' : 'Could not create administrator. Check the email, password (12+ characters), and database configuration.');
  process.exitCode = 1;
} finally { await db.end(); }
