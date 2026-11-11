import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import ffmpeg from 'ffmpeg-static';
import { run, importInputOptions } from '../server/audio.js';

test('audio imports reject local-file playlists and still accept common self-contained formats', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gh-media-security-'));
  try {
    const privateFile = path.join(directory, 'private.wav');
    await run(ffmpeg, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'sine=frequency=611:duration=1', privateFile]);
    const playlist = path.join(directory, 'upload.m3u8');
    await writeFile(playlist, `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXTINF:1.0,\n${privateFile}\n#EXT-X-ENDLIST\n`);
    await assert.rejects(run(ffmpeg, ['-hide_banner', '-y', ...importInputOptions, '-i', playlist, path.join(directory, 'leak.flac')], 10000), /whitelist/);
    for (const [extension, codec] of [['wav', 'pcm_s16le'], ['mp3', 'libmp3lame'], ['m4a', 'aac'], ['ogg', 'libvorbis'], ['webm', 'libopus'], ['flac', 'flac']]) {
      const source = path.join(directory, `source.${extension}`);
      await run(ffmpeg, ['-hide_banner', '-y', '-i', privateFile, '-c:a', codec, source]);
      await run(ffmpeg, ['-hide_banner', '-y', ...importInputOptions, '-i', source, '-c:a', 'flac', path.join(directory, 'canonical.flac')]);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
