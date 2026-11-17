import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assetsForEpisode, clipFromSource, libraryClipData } from '../shared/audio-library.js';
import { libraryClipSchema } from '../server/audio-library.js';
import { insertClip, toTimeline } from '../shared/timeline.js';

test('recordings stay with their episode even when removed from its timeline', () => {
  const episode = { id: randomUUID(), arrangement: { segments: [{ assetId: 'legacy' }], music: { assetId: 'bed' } } };
  const assets = [{ id: 'owned', episodeId: episode.id }, { id: 'other', episodeId: randomUUID() }, { id: 'legacy' }, { id: 'bed' }, { id: 'unassigned' }];
  assert.deepEqual(assetsForEpisode(assets, episode).map(asset => asset.id), ['owned', 'legacy', 'bed']);
  assert.deepEqual(assetsForEpisode(assets, { ...episode, arrangement: { segments: [], music: {} } }).map(asset => asset.id), ['owned']);
  assert.equal(assetsForEpisode(assets, { id: randomUUID(), arrangement: { segments: [], music: {} } }).length, 0);
});

test('saved clip settings exclude episode placement and reuse as independent timeline copies', () => {
  const asset = { id: randomUUID(), name: 'Full episode recording', duration: 300 };
  const original = { id: randomUUID(), assetId: asset.id, name: 'Welcome', role: 'intro', start: 10, end: 22, gain: 0, fadeIn: .3, fadeOut: .8, trackId: 'program', position: 45 };
  const folderId = randomUUID(), saved = libraryClipSchema.parse(libraryClipData(original, folderId));
  assert.equal(saved.position, undefined); assert.equal(saved.trackId, undefined); assert.equal(saved.id, undefined);
  assert.equal(saved.assetId, asset.id); assert.equal(saved.folderId, folderId); assert.equal(saved.gain, 0);
  const copy = clipFromSource(asset, 'segment', { ...saved, id: randomUUID(), asset });
  assert.notEqual(copy.id, original.id); assert.equal(copy.name, 'Welcome'); assert.equal(copy.role, 'intro');
  assert.deepEqual([copy.start, copy.end, copy.gain, copy.fadeIn, copy.fadeOut], [10, 22, 0, .3, .8]);
  assert.equal(copy.folderId, undefined); assert.equal(copy.position, undefined);
  const episode = insertClip(toTimeline({ segments: [], music: { assetId: null, volume: .12, duck: true } }), copy);
  assert.equal(episode.segments[0].position, 0);
  episode.segments[0].start = 12; episode.segments[0].name = 'My episode welcome';
  assert.equal(saved.start, 10); assert.equal(saved.name, 'Welcome'); assert.equal(original.position, 45);
  assert.throws(() => libraryClipSchema.parse({ ...saved, end: saved.start }));
  assert.throws(() => libraryClipSchema.parse({ ...saved, gain: 3 }));
  assert.throws(() => libraryClipSchema.parse({ ...saved, name: '\n' }));
});
