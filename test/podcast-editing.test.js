import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cutRange } from '../shared/podcast-editing.js';
import { arrangementSchema } from '../server/validation.js';
import { documentSchemas } from '../server/website-validation.js';
import { defaultDocuments } from '../shared/website.js';
import { feed } from '../server/feed.js';
import { buildMix, run, probe } from '../server/audio.js';
import { config } from '../server/config.js';

test('cutting removes only the selected range and preserves source and section', () => {
  const clip = { id: randomUUID(), assetId: randomUUID(), name: 'Conversation', role: 'segment', start: 2, end: 12, gain: 1, fadeIn: .2, fadeOut: .2 };
  const result = cutRange(clip, 5, 8, randomUUID());
  assert.deepEqual(result.map(item => [item.start, item.end]), [[2, 5], [8, 12]]);
  assert.equal(result.reduce((sum, item) => sum + item.end - item.start, 0), 7);
  assert.equal(result[0].assetId, clip.assetId); assert.equal(result[1].role, clip.role);
  assert.notEqual(result[0].id, result[1].id); assert.equal(clip.end, 12);
  assert.deepEqual(cutRange(clip, 2, 12, randomUUID()), []);
  assert.equal(cutRange(clip, 2, 5, randomUUID())[0].id, clip.id);
  assert.throws(() => cutRange(clip, 1, 5, randomUUID()));
  assert.throws(() => cutRange(clip, 5, 5, randomUUID()));
  assert.throws(() => cutRange(clip, 2.01, 5, randomUUID()));
});

test('branding validates author details and safely publishes cover and author to RSS', () => {
  const branding = { ...defaultDocuments.podcast, title: 'Faith & Family', authorName: 'Author <name>', authorBio: 'Meet the host.', coverUrl: '/images/cover.png', spotlightEnabled: true };
  assert.equal(documentSchemas.podcast.safeParse(branding).success, true);
  assert.equal(documentSchemas.podcast.safeParse({ ...branding, authorName: '' }).success, false);
  assert.equal(documentSchemas.podcast.safeParse({ ...branding, authorLink: 'javascript:alert(1)' }).success, false);
  const rss = feed([], 'https://godlyhomes.com', branding);
  assert.match(rss, /Faith &amp; Family/); assert.match(rss, /Author &lt;name&gt;/);
  assert.match(rss, /https:\/\/godlyhomes.com\/images\/cover.png/);
});

test('FFmpeg renders intro, cut speech, musical transition and closing with expected duration', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gh-editing-'));
  try {
    const voice = path.join(directory, 'voice.wav'), music = path.join(directory, 'music.wav'), output = path.join(directory, 'mix.mp3');
    await run(config.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', voice]);
    await run(config.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', music]);
    const voiceId = randomUUID(), musicId = randomUUID();
    const clip = (assetId, role, start, end) => ({ id: randomUUID(), assetId, role, name: role, start, end, gain: .8, fadeIn: .2, fadeOut: .2 });
    const speech = clip(voiceId, 'segment', 1, 6);
    const arrangement = arrangementSchema.parse({ segments: [clip(voiceId, 'intro', 0, 1), ...cutRange(speech, 2, 4, randomUUID()), clip(musicId, 'transition', 0, 2), clip(voiceId, 'closing', 6, 7)], music: { assetId: null, volume: .2, duck: true } });
    assert.deepEqual(arrangement.segments.map(item => item.role), ['intro', 'segment', 'segment', 'transition', 'closing']);
    await run(config.ffmpeg, ['-y', '-i', voice, '-i', music, '-filter_complex', buildMix(arrangement, new Map([[voiceId, 0], [musicId, 1]])).join(';'), '-map', '[mixed]', '-codec:a', 'libmp3lame', output]);
    assert.ok(Math.abs(await probe(output) - 7) < .15);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
