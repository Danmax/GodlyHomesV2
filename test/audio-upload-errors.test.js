import test from 'node:test';
import assert from 'node:assert/strict';
import { audioUploadError } from '../server/audio-upload-errors.js';
import { boundedAudioThreads } from '../server/audio.js';

test('FFmpeg constrains every decoder, output encoder and both filter pools', () => {
  const result = boundedAudioThreads(['-y', '-i', 'first.webm', '-i', 'music.flac', '-threads', '2', '-c:a', 'flac', 'output.flac']);
  assert.deepEqual(result.slice(0, 4), ['-filter_threads', '1', '-filter_complex_threads', '1']);
  for (let i = 0; i < result.length; i++) {
    if (result[i] === '-i') assert.deepEqual(result.slice(i - 2, i), ['-threads', '1']);
    if (result[i] === '-threads') assert.equal(result[i + 1], '1');
  }
  assert.deepEqual(result.slice(-3), ['-threads', '1', 'output.flac']);
  const render = ['-i', 'voice.flac', '-filter_complex', '[0:a]anull[out]', '-map', '[out]', 'mix.mp3'];
  assert.equal(boundedAudioThreads(render), render, 'Preserve the scheduler for existing complex render graphs');
  const error = audioUploadError(Object.assign(new Error('pthread_create() failed: Resource temporarily unavailable'), { exitCode: 245 }), 'convert');
  assert.equal(error.status, 503); assert.match(error.message, /resource limit/);
});

test('server failures are retryable and never misreported as corrupt recordings', () => {
  for (const [stage, details, pattern] of [
    ['save', { code: 'ER_BAD_FIELD_ERROR' }, /database migrations/],
    ['save', { code: 'ECONNRESET' }, /database/],
    ['validate', { code: 'ECONNREFUSED' }, /database/],
    ['convert', { code: 'EACCES' }, /FFmpeg/],
    ['convert', { exitCode: 127 }, /FFmpeg/],
    ['probe', { code: 'ENOENT' }, /ffprobe/],
    ['convert', { code: 'ENOSPC' }, /storage/],
    ['convert', { exitCode: null, signal: 'SIGKILL' }, /interrupted/],
  ]) {
    const result = audioUploadError(Object.assign(new Error('internal details'), details), stage);
    assert.equal(result.status, 503); assert.match(result.message, pattern);
    assert.doesNotMatch(result.message, /internal details|could not be read/);
  }
  assert.equal(audioUploadError(Object.assign(new Error('bad codec'), { exitCode: 1 }), 'convert').status, 400);
  const missing = Object.assign(new Error('Episode not found'), { status: 404 });
  assert.equal(audioUploadError(missing, 'validate'), missing);
  const invalid = Object.assign(new Error('Invalid episode ID'), { name: 'ZodError' });
  assert.equal(audioUploadError(invalid, 'validate'), invalid);
});
