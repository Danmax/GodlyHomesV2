import path from 'node:path';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mediaDirectory } from './media-path.js';

const require = createRequire(import.meta.url);
const storageMegabytes = Number(process.env.AUTHOR_STORAGE_MB || 5120);
if (!Number.isSafeInteger(storageMegabytes) || storageMegabytes < 1) throw new Error('AUTHOR_STORAGE_MB must be a positive integer.');
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
  mediaDir: mediaDirectory(process.env.MEDIA_DIR, path.resolve(import.meta.dirname, '..')),
  remoteMediaOrigin: process.env.MEDIA_REMOTE_URL ? new URL(process.env.MEDIA_REMOTE_URL).origin : null,
  ffmpeg: audioTool('ffmpeg', process.env.FFMPEG_PATH),
  ffprobe: audioTool('ffprobe', process.env.FFPROBE_PATH),
  maxBytes: 512 * 1024 * 1024,
  maxProcessedBytes: 512 * 1024 * 1024,
  authorStorageBytes: storageMegabytes * 1024 * 1024,
  maxConcurrentAudioUploads: 2,
  maxConcurrentImageUploads: 4,
};
