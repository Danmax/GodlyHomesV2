import { createApp } from './app.js';
import { config } from './config.js';
import { db } from './db.js';

const app = await createApp();
const server = app.listen(config.port, '0.0.0.0', () => console.log(`Godly Homes API: http://localhost:${config.port}`));
async function stop() { server.close(async () => { await db.end(); process.exit(0); }); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
