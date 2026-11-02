import path from 'node:path';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
function audioTool(name, environmentValue) {
  // Explicit executable paths always win. Local installs include portable tools;
  // the production Docker image supplies its own system FFmpeg/ffprobe.
  if (environmentValue && environmentValue !== name) return environmentValue;
  if (process.env.NODE_ENV !== 'production') {
    try {
      const bundled = name === 'ffmpeg' ? require('ffmpeg-static') : require('ffprobe-static').path;
      if (bundled && existsSync(bundled)) return bundled;
    } catch { /* Production-only installs may omit the local tool packages. */ }
  }
  return environmentValue || name;
}

export const config = {
  production: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3001),
  origin: new URL(process.env.APP_URL || 'http://localhost:5173').origin,
  mediaDir: path.resolve(process.env.MEDIA_DIR || './data/media'),
  ffmpeg: audioTool('ffmpeg', process.env.FFMPEG_PATH),
  ffprobe: audioTool('ffprobe', process.env.FFPROBE_PATH),
  maxBytes: 512 * 1024 * 1024,
};
