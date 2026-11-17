import test from 'node:test';
import assert from 'node:assert/strict';
import { audioUploadError } from '../server/audio-upload-errors.js';

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
