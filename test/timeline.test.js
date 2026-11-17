import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clipEnd, episodeDuration, insertClip, splitClip, toTimeline, trimClip } from '../shared/timeline.js';
import { autoMix, cutRange, suggestClips } from '../shared/podcast-editing.js';
import { arrangementSchema, validateAssets } from '../server/validation.js';
import { buildMix, run } from '../server/audio.js';
import { config } from '../server/config.js';

const clip = (props = {}) => ({ id: randomUUID(), assetId: randomUUID(), name: 'Conversation', role: 'segment', start: 2, end: 12, gain: 1, fadeIn: 0, fadeOut: 0, ...props });
const project = segments => ({ segments, music: { assetId: null, volume: .12, duck: true } });

test('legacy episodes convert without changing source trims, order or duration', () => {
  const original = project([clip({ role: 'intro', end: 5 }), clip(), clip({ role: 'closing', end: 7 })]);
  const timeline = toTimeline(original);
  assert.deepEqual(timeline.segments.map(item => item.position), [0, 3, 13]);
  assert.equal(episodeDuration(timeline), episodeDuration(original));
  assert.equal(original.tracks, undefined); assert.equal(original.segments[0].position, undefined);
  assert.deepEqual(timeline.segments.map(({ position, trackId, ...rest }) => rest), original.segments);
  assert.equal(toTimeline(timeline), timeline);
});

test('clips insert into program order or stack on independent tracks; bounds and IDs validate', async () => {
  const main = clip(), original = toTimeline(project([main]));
  const intro = insertClip(original, clip({ role: 'intro', end: 5 }));
  assert.equal(intro.segments.find(item => item.id === main.id).position, 3);
  const layered = insertClip(intro, clip({ role: 'music' }), { at: 2, trackId: 'music' });
  assert.equal(episodeDuration(layered), 13);
  assert.equal(layered.segments.at(-1).trackId, 'music');
  assert.equal(arrangementSchema.parse(layered).tracks.length, 5);
  const invalid = props => arrangementSchema.safeParse({ ...layered, ...props }).success;
  assert.equal(invalid({ segments: [{ ...layered.segments[0], trackId: 'unknown' }] }), false);
  assert.equal(invalid({ segments: [{ ...layered.segments[0], position: -1 }] }), false);
  assert.equal(invalid({ segments: [{ ...layered.segments[0], position: 7200 }] }), false);
  assert.equal(invalid({ segments: [{ ...layered.segments[0], position: undefined }] }), false);
  assert.equal(invalid({ tracks: [layered.tracks[0], layered.tracks[0]] }), false);
  assert.equal(invalid({ segments: [layered.segments[0], layered.segments[0]] }), false);
  // Layered source durations may exceed two hours; the episode itself may not.
  const long = toTimeline(project([]));
  long.segments = [clip({ start: 0, end: 5000, position: 0, trackId: 'program' }), clip({ start: 0, end: 5000, position: 0, trackId: 'narration' })];
  assert.equal(arrangementSchema.safeParse(long).success, true);
  await validateAssets(long, randomUUID(), async () => [{ duration: 5000 }]);
  await assert.rejects(validateAssets({ ...long, segments: [{ ...long.segments[0], position: 3000 }] }, randomUUID(), async () => [{ duration: 5000 }]), /two hours/);
});

test('splits, range cuts, pause edits and edge trims preserve independent timeline placement', () => {
  const original = clip({ position: 20, trackId: 'program' });
  const split = splitClip(original, 6, randomUUID());
  assert.deepEqual(split.map(item => [item.position, item.start, item.end]), [[20, 2, 6], [24, 6, 12]]);
  assert.equal(clipEnd(split[1]), 30);
  const cut = cutRange(original, 5, 8, randomUUID());
  assert.deepEqual(cut.map(item => [item.position, item.start, item.end]), [[20, 2, 5], [23, 8, 12]]);
  assert.equal(clipEnd(cut[1]), 27);
  const pauses = [{ start: 5, end: 8 }];
  assert.equal(clipEnd(suggestClips(original, pauses).at(-1)), 30);
  assert.ok(Math.abs(clipEnd(suggestClips(original, pauses, 'tighten').at(-1)) - 27.3) < .001);
  const left = trimClip(original, 'start', 3, 20);
  assert.deepEqual([left.position, left.start, left.end], [23, 5, 12]);
  assert.equal(clipEnd(left), 30);
  assert.deepEqual([trimClip(original, 'start', -100, 20).position, trimClip(original, 'start', -100, 20).start], [18, 0]);
  assert.equal(trimClip(original, 'end', 100, 20).end, 20);
  assert.ok(Math.abs(trimClip(original, 'end', -100, 20).end - 2.05) < .00001);
  assert.throws(() => splitClip(original, 2.01, randomUUID()), /0.05/);
  assert.equal(original.position, 20); assert.equal(original.start, 2);
  const mixed = autoMix({ ...toTimeline(project([])), segments: [original, clip({ role: 'music', position: 0, trackId: 'music' })] });
  assert.equal(mixed.segments[0].position, 20); assert.equal(mixed.segments[1].gain, .12);
});

test('FFmpeg exports actual overlaps, gaps, track gain, mute/solo, ducking and fully muted projects', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gh-timeline-'));
  try {
    const voice = path.join(directory, 'voice.wav'), music = path.join(directory, 'music.wav');
    await run(config.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', voice]);
    await run(config.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=4', music]);
    const arrangement = toTimeline(project([]));
    arrangement.segments = [clip({ assetId: 'voice', start: .5, end: 2.5, position: 1, trackId: 'program' }),
      clip({ assetId: 'voice', role: 'narrator', start: 0, end: 1, position: 1.5, trackId: 'narration', gain: .5 }),
      clip({ assetId: 'voice', start: 0, end: 1, position: 4, trackId: 'program' }),
      clip({ assetId: 'music', role: 'music', start: 0, end: 3, position: 2, trackId: 'music' })];
    arrangement.tracks = arrangement.tracks.map(track => track.id === 'music' ? { ...track, gain: .5 } : track);
    let render = 0;
    const samples = async project => {
      const output = path.join(directory, `${render++}.pcm`);
      await run(config.ffmpeg, ['-v', 'error', '-y', '-i', voice, '-stream_loop', '-1', '-i', music, '-filter_complex', buildMix(project, new Map([['voice', 0], ['music', 1]])).join(';'), '-map', '[mixed]', '-ar', '44100', '-ac', '1', '-c:a', 'pcm_f32le', '-f', 'f32le', output]);
      const data = await readFile(output);
      assert.ok(Math.abs(data.length / 4 / 44100 - 5) < .002, 'Timeline ends at last clip boundary, including muted clips');
      return data;
    };
    const amplitude = (data, start, frequency) => {
      const count = 8820, offset = Math.round(start * 44100); let re = 0, im = 0;
      for (let i = 0; i < count; i++) { const value = data.readFloatLE((offset + i) * 4), angle = 2 * Math.PI * frequency * i / 44100; re += value * Math.cos(angle); im += value * Math.sin(angle); }
      return Math.hypot(re, im) * 2 / count;
    };
    const mixed = await samples(arrangement);
    assert.ok(amplitude(mixed, .2, 440) < .00001, 'Leading gap is silent');
    const baseline = amplitude(mixed, 1.2, 440); assert.ok(baseline > .05);
    assert.ok(Math.abs(amplitude(mixed, 2.2, 440) / baseline - 1.5) < .01, 'Narration overlaps the main voice under music');
    assert.ok(Math.abs(amplitude(mixed, 2.2, 880) / baseline - .5) < .01, 'Music overlaps at its track gain');
    assert.ok(amplitude(mixed, 3.2, 440) < .00001, 'Voice gap remains intact');
    assert.ok(amplitude(mixed, 4.2, 440) > .05, 'Reused source plays again later');
    const solo = await samples({ ...arrangement, tracks: arrangement.tracks.map(track => ({ ...track, solo: track.id === 'program' })) });
    assert.ok(amplitude(solo, 2.2, 880) < .00001); assert.ok(amplitude(solo, 2.2, 440) > .05);
    const muted = await samples({ ...arrangement, tracks: arrangement.tracks.map(track => ({ ...track, muted: true })) });
    assert.ok(amplitude(muted, 2.2, 440) < .00001); assert.ok(amplitude(muted, 2.2, 880) < .00001);
    const bedProject = { ...arrangement, segments: arrangement.segments.filter(item => item.role !== 'music'), music: { assetId: 'music', volume: .2, duck: true } };
    const ducked = await samples(bedProject), constant = await samples({ ...bedProject, music: { ...bedProject.music, duck: false } });
    assert.ok(amplitude(ducked, 1.5, 880) < amplitude(constant, 1.5, 880) * .8, 'Speech ducks the looping music bed');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
