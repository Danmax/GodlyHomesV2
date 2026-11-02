import { createApp } from './app.js';
import { config } from './config.js';
import { db } from './db.js';

// Passenger loads the entry file through require(). Keep this module graph free
// of top-level await so Node can load it before asynchronous initialization.
async function start() {
  const app = await createApp();
  const server = app.listen(config.port, '0.0.0.0', () => console.log(`Godly Homes API: http://localhost:${config.port}`));
  async function stop() { server.close(async () => { await db.end(); process.exit(0); }); }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

start().catch(async error => {
  console.error('Godly Homes startup failed:', error.message);
  await db.end();
  process.exit(1);
});
