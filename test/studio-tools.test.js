import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { suggestClips, autoMix, introScript } from '../shared/podcast-editing.js';
import { arrangementSchema } from '../server/validation.js';
import { buildMix } from '../server/audio.js';
import { generateIntro } from '../server/studio-ai.js';
import { parseSilences } from '../server/studio-tools.js';

const clip = () => ({ id: randomUUID(), assetId: randomUUID(), name: 'Conversation', role: 'segment', start: 10, end: 30, gain: .5, fadeIn: 1, fadeOut: 1 });
test('pause splits preserve duration; tightening handles overlaps, boundaries and quiet recordings', () => {
  const original = clip(), pauses = [{ start: 14, end: 16 }, { start: 15, end: 17 }, { start: 20, end: 23 }];
  const split = suggestClips(original, pauses);
  assert.deepEqual(split.map(s => [s.start, s.end]), [[10, 15.5], [15.5, 21.5], [21.5, 30]]);
  assert.equal(split.reduce((sum, s) => sum + s.end - s.start, 0), 20);
  assert.equal(new Set(split.map(s => s.id)).size, 3);
  const tightened = suggestClips(original, pauses, 'tighten');
  assert.deepEqual(tightened.map(s => [s.start, s.end]), [[10, 14.15], [16.85, 20.15], [22.85, 30]]);
  assert.ok(tightened.every(s => s.assetId === original.assetId && s.role === original.role));
  assert.equal(original.end, 30);
  assert.deepEqual(suggestClips(original, [{ start: 0, end: 60 }], 'tighten'), [original]);
  assert.deepEqual(suggestClips(original, []), [original]);
  assert.deepEqual(parseSilences('silence_start: 0\nsilence_end: 2\nsilence_start: 8', 10, 20), [{ start: 10, end: 12 }, { start: 18, end: 20 }]);
});

test('auto mix preserves edit order, normalizes voice clips and ducks music without altering sources', () => {
  const first = clip(), second = { ...clip(), role: 'transition' };
  const source = { segments: [first, second], music: { assetId: randomUUID(), volume: .8, duck: false } };
  const mixed = arrangementSchema.parse(autoMix(source));
  assert.deepEqual(mixed.segments.map(s => [s.id, s.assetId, s.start, s.end]), source.segments.map(s => [s.id, s.assetId, s.start, s.end]));
  assert.equal(mixed.autoLevel, true); assert.equal(mixed.music.volume, .12); assert.equal(mixed.music.duck, true);
  assert.equal(source.segments[0].gain, .5); assert.equal(source.music.duck, false);
  const filters = buildMix(mixed, new Map([[first.assetId, 0], [second.assetId, 1], [source.music.assetId, 2]]));
  assert.match(filters[0], /loudnorm=I=-18/); assert.doesNotMatch(filters[1], /loudnorm/);
  assert.match(filters.join(';'), /sidechaincompress/);
  assert.equal(arrangementSchema.parse(source).autoLevel, false);
  assert.match(introScript({ show: 'Our Show', host: 'Sam', topic: 'family rhythms' }), /I’m Sam.*family rhythms/);
});

test('intro transport returns completed PCM or text, closes sessions, and sanitizes provider failures', async () => {
  const sockets = [];
  class Socket extends EventEmitter {
    constructor(url, options) { super(); this.url = url; this.options = options; this.sent = []; sockets.push(this); queueMicrotask(() => this.emit('message', Buffer.from('{"type":"session.created"}'))); }
    send(raw) {
      const event = JSON.parse(raw); this.sent.push(event);
      if (event.type === 'session.update') queueMicrotask(() => this.emit('message', Buffer.from('{"type":"session.updated"}')));
      if (event.type === 'response.create') queueMicrotask(() => {
        const audio = event.response.output_modalities[0] === 'audio';
        this.emit('message', Buffer.from(JSON.stringify(audio ? { type: 'response.output_audio.delta', delta: Buffer.from([1, 2, 3, 4]).toString('base64') } : { type: 'response.output_text.delta', delta: 'Welcome to our show.' })));
        this.emit('message', Buffer.from('{"type":"response.done","response":{"status":"completed"}}'));
      });
    }
    close() { this.closed = true; this.emit('close'); }
    terminate() { this.closed = true; }
  }
  const options = { apiKey: 'private-test-key', Socket };
  assert.equal(await generateIntro({ instructions: 'Write an intro.', text: 'Family', userId: 'hashed-user' }, options), 'Welcome to our show.');
  assert.deepEqual(await generateIntro({ instructions: 'Read it.', text: 'Hello.', voice: 'cedar', audio: true, userId: 'hashed-user' }, options), Buffer.from([1, 2, 3, 4]));
  assert.ok(sockets.every(s => s.closed && s.url.includes('gpt-realtime-2.1-mini')));
  assert.equal(sockets[1].sent[0].session.audio.output.voice, 'cedar');
  await assert.rejects(generateIntro({ text: 'Hi' }, { apiKey: '' }), /configuration/);
  class Rejected extends Socket { send() { queueMicrotask(() => this.emit('message', Buffer.from('{"type":"error","error":{"message":"secret-provider-detail"}}'))); } }
  await assert.rejects(generateIntro({ text: 'Hi' }, { ...options, Socket: Rejected }), error => error.status === 503 && !error.message.includes('secret-provider-detail'));
  class Stalled extends Socket { send() {} }
  await assert.rejects(generateIntro({ text: 'Hi' }, { ...options, Socket: Stalled, timeout: 10 }), /unavailable/);
});
