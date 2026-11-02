import { readFile, readdir } from 'node:fs/promises';
import { db } from './db.js';

try {
  // Single migration runner, with a database advisory lock to prevent competing deployments.
  const connection = await db.getConnection();
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK('godly_homes_migrations', 30) AS acquired");
    if (lock.acquired !== 1) throw new Error('Another migration is running.');
    await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(200) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
    const directory = new URL('./migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) {
      const [existing] = await connection.execute('SELECT name FROM schema_migrations WHERE name = ?', [name]);
      if (existing.length) continue;
      const source = await readFile(new URL(name, directory), 'utf8');
      for (const statement of source.split(';').map(s => s.trim()).filter(Boolean)) await connection.query(statement);
      await connection.execute('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
      console.log(`Applied ${name}`);
    }
    await connection.query("SELECT RELEASE_LOCK('godly_homes_migrations')");
  } finally { connection.release(); }
} finally { await db.end(); }
