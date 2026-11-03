import { z } from 'zod';
import { db, rows, json } from './db.js';
import { config } from './config.js';
import { syncEpisodeMedia } from './media.js';

const args = process.argv.slice(2);
const origin = config.remoteMediaOrigin;
let cookie, csrf;
try {
  if (!args.includes('--job')) throw new Error('Usage: npm run media:sync -- --job <render-job-id>');
  const id = z.uuid().parse(args[args.indexOf('--job') + 1]);
  if (!origin) throw new Error('Set MEDIA_REMOTE_URL to the HTTPS website that should store the audio.');
  const [job] = await rows("SELECT j.*, e.user_id FROM render_jobs j JOIN episodes e ON e.id = j.episode_id WHERE j.id = ? AND j.state = 'ready'", [id]);
  if (!job) throw new Error('The completed render job was not found.');
  const login = await fetch(new URL('/api/auth/login', origin), {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }), signal: AbortSignal.timeout(15000),
  });
  if (!login.ok) throw new Error(`Sign-in to remote media storage failed (${login.status}). Check ADMIN_EMAIL and ADMIN_PASSWORD locally.`);
  const session = await login.json();
  cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); csrf = session.csrf;
  if (session.user.id !== job.user_id) throw new Error('Sign in as the owner of this episode to restore its audio.');
  const arrangement = json(job.snapshot).arrangement;
  const ids = [...new Set([...arrangement.segments.map(s => s.assetId), arrangement.music.assetId].filter(Boolean))];
  const assets = [];
  for (const assetId of ids) {
    const [asset] = await rows('SELECT * FROM assets WHERE id = ? AND user_id = ?', [assetId, job.user_id]);
    if (!asset) throw new Error('A source asset record is missing.');
    assets.push(asset);
  }
  await syncEpisodeMedia({ job, assets, origin, cookie, csrf });
  console.log(`Restored ${assets.length} source file(s) and the MP3 export to ${origin}.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (cookie && csrf) await fetch(new URL('/api/auth/logout', origin), { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'X-CSRF-Token': csrf }, signal: AbortSignal.timeout(10000) }).catch(() => {});
  await db.end();
}
