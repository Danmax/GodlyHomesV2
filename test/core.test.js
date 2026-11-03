import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from '../server/auth.js';
import { arrangementSchema, validateAssets } from '../server/validation.js';
import { feed } from '../server/feed.js';
import { buildMix } from '../server/audio.js';
import { mediaDirectory } from '../server/media-path.js';
import { mediaFile } from '../server/media.js';

test('Hostinger media survives release changes and invalid storage keys are rejected', () => {
  const first = '/home/account/domains/example.com/hbuilds/versions/first/nodejs';
  const second = '/home/account/domains/example.com/hbuilds/versions/second/nodejs';
  assert.equal(mediaDirectory('./data/media', first), '/home/account/domains/example.com/storage/data/media');
  assert.equal(mediaDirectory('./data/media', first), mediaDirectory('./data/media', second));
  assert.equal(mediaDirectory('/data/media', first), '/data/media');
  assert.equal(mediaDirectory('./data/media', '/local/project', '/local/project'), '/local/project/data/media');
  assert.throws(() => mediaFile('../private.txt'), /invalid/);
  assert.throws(() => mediaFile('/etc/passwd'), /invalid/);
});

test('password hashes use unique salts and reject incorrect passwords', async () => {
  const hash = await hashPassword('a sufficiently long password');
  assert.notEqual(hash, await hashPassword('a sufficiently long password'));
  assert.equal(await verifyPassword('a sufficiently long password', hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('arrangements reject invalid trims, missing assets and excessive duration', async () => {
  const id = randomUUID();
  const segment = { id: randomUUID(), assetId: id, name: 'Take', start: 0, end: 10, gain: 1, fadeIn: 0, fadeOut: 0 };
  const arrangement = { segments: [segment], music: { assetId: null, volume: .2, duck: true } };
  assert.throws(() => arrangementSchema.parse({ ...arrangement, segments: [{ ...segment, start: 11 }] }));
  await assert.rejects(validateAssets(arrangement, id, async () => []), /unavailable/);
  await assert.rejects(validateAssets(arrangement, id, async () => [{ duration: 8 }]), /beyond/);
  await assert.rejects(validateAssets({ ...arrangement, segments: Array(200).fill({ ...segment, end: 60 }) }, id, async () => [{ duration: 100 }]), /two hours/);
});

test('RSS escapes unsafe XML and advertises the real MP3 bytes, URL and stable GUID', () => {
  const id = randomUUID(), job = randomUUID();
  const xml = feed([{ episode_id: id, job_id: job, title: '<script> & title', description: ']]><img onerror="alert(1)">', episode_number: 1, published_at: new Date('2026-11-02T10:00:00Z'), duration: 10, bytes: 4321 }], 'https://godlyhomes.com');
  assert.ok(xml.includes('&lt;script&gt; &amp; title'));
  assert.ok(!xml.includes('<img'));
  assert.ok(xml.includes(`/${job}.mp3" length="4321" type="audio/mpeg"`));
  assert.ok(xml.includes(`<guid isPermaLink="false">${id}</guid>`));
});

test('render mix uses source trims and sidechain ducking for background music', () => {
  const arrangement = { segments: [{ assetId: 'voice', start: 1, end: 4, gain: .5, fadeIn: 1, fadeOut: 1 }], music: { assetId: 'music', volume: .1, duck: true } };
  const filters = buildMix(arrangement, new Map([['voice', 0], ['music', 1]])).join(';');
  assert.match(filters, /atrim=start=1:end=4/);
  assert.match(filters, /sidechaincompress/);
  assert.match(filters, /concat=n=1/);
});
