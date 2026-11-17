import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { toTimeline } from '../shared/timeline.js';

export async function testTimelineIntegration({ mutate, agent, rows, asset, claimJob, processJob }) {
  const episode = (await mutate('post', '/api/episodes')).body;
  const arrangement = toTimeline({ autoLevel: true, segments: [], music: { assetId: asset.id, volume: .1, duck: true } });
  const clip = values => ({ id: randomUUID(), assetId: asset.id, name: 'Timeline source', role: 'segment', start: 0, end: 2, gain: .8, fadeIn: .1, fadeOut: .1, trackId: 'program', position: 0, ...values });
  arrangement.segments = [clip({}), clip({ role: 'narrator', start: 1, trackId: 'narration', position: .5 }),
    clip({ role: 'effects', end: 1, trackId: 'effects', position: 1 }), clip({ role: 'closing', end: 1, position: 5 })];
  const saved = await mutate('put', `/api/episodes/${episode.id}`).send({ ...episode, title: 'Layered integration', arrangement });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const restored = (await agent.get('/api/episodes')).body.find(item => item.id === episode.id);
  assert.deepEqual(restored.arrangement, saved.body.arrangement);
  assert.equal((await mutate('put', `/api/episodes/${episode.id}`).send({ ...saved.body, arrangement: { ...arrangement, segments: [{ ...arrangement.segments[0], trackId: 'missing' }] } })).status, 400);
  assert.equal((await mutate('put', `/api/episodes/${episode.id}`).send({ ...saved.body, arrangement: { ...arrangement, segments: [{ ...arrangement.segments[0], position: 7199 }] } })).status, 400);
  const rendered = await mutate('post', `/api/episodes/${episode.id}/render`);
  assert.equal(rendered.status, 202, JSON.stringify(rendered.body));
  const job = await claimJob(); assert.equal(job.id, rendered.body.id); await processJob(job);
  const [finished] = await rows('SELECT * FROM render_jobs WHERE id = ?', [job.id]);
  assert.equal(finished.state, 'ready', finished.error);
  assert.ok(Math.abs(finished.duration - 6) < .15, 'Export duration follows timeline gaps/overlaps rather than summed source durations');
  const audio = await agent.get(`/api/jobs/${job.id}/audio`); assert.equal(audio.status, 200); assert.match(audio.headers['content-type'], /audio\/mpeg/);
  assert.equal((await mutate('delete', `/api/episodes/${episode.id}`)).status, 200);
  assert.equal((await agent.get(asset.url)).status, 200, 'Deleting a timeline preserves its original library source');
  console.log('PASS: Timeline tracks/positions round-trip through MySQL, invalid timing/track references fail, and the real worker renders overlapping leveled voice, FX, looping music and a delayed outro.');
}
