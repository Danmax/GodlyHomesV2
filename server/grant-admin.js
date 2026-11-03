import { z } from 'zod';
import { db, rows } from './db.js';

try {
  const email = z.email().parse(process.env.ADMIN_EMAIL?.trim().toLowerCase());
  const [user] = await rows('SELECT id FROM users WHERE email = ?', [email]);
  if (!user) throw new Error('No account matches ADMIN_EMAIL. Create the account first.');
  await rows("UPDATE users SET role = 'admin' WHERE id = ?", [user.id]);
  console.log('The configured owner account now has Website Admin access. Credentials are unchanged.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await db.end(); }
