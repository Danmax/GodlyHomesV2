import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { run, buildMix, canonicalInputOptions } from '../server/audio.js';

test('auto-leveled clips encode to stereo MP3 after two-pass normalization', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gh-render-'));
  try {
    const source = path.join(directory, 'source.flac');
    const output = path.join(directory, 'episode.mp3');
    await run(ffmpeg, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-ac', '2', '-c:a', 'flac', source]);
    const arrangement = { autoLevel: true, segments: [
      { assetId: 'voice', start: 0, end: 0.78, gain: 1, fadeIn: 0.03, fadeOut: 0.03 },
      { assetId: 'voice', start: 1, end: 5, gain: 1, fadeIn: 0.03, fadeOut: 0.03 },
    ], music: { assetId: null } };
    const graph = buildMix(arrangement, new Map([['voice', 0]]));
    const inputs = [...canonicalInputOptions, '-i', source];
    const measure = await run(ffmpeg, ['-hide_banner', ...inputs, '-filter_complex', [...graph, '[mixed]loudnorm=I=-16:TP=-1:LRA=11:print_format=json[out]'].join(';'), '-map', '[out]', '-f', 'null', '-']);
    const loudness = JSON.parse(measure.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)[0]);
    const normalizer = `loudnorm=I=-16:TP=-1:LRA=11:measured_I=${loudness.input_i}:measured_TP=${loudness.input_tp}:measured_LRA=${loudness.input_lra}:measured_thresh=${loudness.input_thresh}:offset=${loudness.target_offset}:linear=true`;
    await run(ffmpeg, ['-hide_banner', '-y', ...inputs, '-filter_complex', [...graph, `[mixed]${normalizer}[out]`].join(';'), '-map', '[out]', '-ar', '44100', '-ac', '2', '-codec:a', 'libmp3lame', '-b:a', '128k', output]);
    const { stdout } = await run(ffprobe.path, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,channels,sample_rate', '-of', 'json', output]);
    const info = JSON.parse(stdout);
    assert.equal(info.streams[0].codec_name, 'mp3');
    assert.equal(info.streams[0].channels, 2);
    assert.equal(info.streams[0].sample_rate, '44100');
    assert.ok(Math.abs(Number(info.format.duration) - 4.78) < 0.1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
