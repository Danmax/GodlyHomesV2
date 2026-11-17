export function audioUploadError(error, stage) {
  if (error.status || error.name === 'ZodError') return error;
  let message, status = 503;
  if (['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE'].includes(error.code)) {
    message = 'The server database needs its latest update. Ask the administrator to run database migrations, then restore your take from Recover recordings.';
  } else if (['ENOENT', 'EACCES', 'ENOEXEC'].includes(error.code) || [126, 127].includes(error.exitCode)) {
    message = 'Audio tools could not run on the server. Ask the administrator to check FFmpeg and ffprobe, then restore your take from Recover recordings.';
  } else if (stage === 'validate' || stage === 'save' || ['ENOSPC', 'EDQUOT', 'EROFS', 'EIO'].includes(error.code)) {
    message = 'The server could not save this recording. Ask the administrator to check audio storage and the database, then restore your take from Recover recordings.';
  } else if (error.signal || error.exitCode === null) {
    message = 'Audio processing was interrupted on the server. Please retry your take from Recover recordings.';
  } else {
    status = 400;
    message = 'This audio could not be read. Choose a valid WAV, MP3, M4A, OGG, FLAC or WebM recording.';
  }
  return Object.assign(new Error(message), { status });
}
