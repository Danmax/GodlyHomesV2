import { spawn } from 'node:child_process';
import { config } from './config.js';

// Imported media must be self-contained. HLS/DASH/concat and other playlist
// demuxers can follow file references even when network protocols are disabled.
export const importInputOptions = ['-protocol_whitelist', 'file,pipe', '-format_whitelist',
  'aac,aiff,amr,ape,asf,au,avi,caf,flac,flv,matroska,webm,mov,mp4,m4a,3gp,3g2,mj2,mp3,ogg,wav,wv'];
export const canonicalInputOptions = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'flac', '-f', 'flac'];

export function run(command, args, timeout = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', data => { stdout = (stdout + data).slice(-100000); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-100000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`Audio process failed (${code}): ${stderr.slice(-1000)}`)); });
  });
}
export async function probe(file) {
  const { stdout } = await run(config.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], 60000);
  const info = JSON.parse(stdout);
  const duration = Number(info.format?.duration);
  if (!info.streams?.some(s => s.codec_type === 'audio') || !Number.isFinite(duration) || duration <= 0 || duration > 7200) {
    throw Object.assign(new Error('Choose a valid audio file of up to two hours.'), { status: 400 });
  }
  return duration;
}

// All times and gains have passed server-side numeric validation. Paths are internal UUIDs.
export function buildMix(arrangement, inputIndexes) {
  const filters = arrangement.segments.map((s, i) => {
    const duration = s.end - s.start;
    const fi = Math.min(s.fadeIn, duration / 2), fo = Math.min(s.fadeOut, duration / 2);
    const level = arrangement.autoLevel && s.role !== 'transition' ? 'loudnorm=I=-18:TP=-2:LRA=9,aresample=44100,' : '';
    return `[${inputIndexes.get(s.assetId)}:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,${level}volume=${s.gain},afade=t=in:d=${fi},afade=t=out:st=${duration - fo}:d=${fo}[s${i}]`;
  });
  filters.push(`${arrangement.segments.map((_, i) => `[s${i}]`).join('')}concat=n=${arrangement.segments.length}:v=0:a=1[voice]`);
  if (arrangement.music.assetId) {
    const total = arrangement.segments.reduce((n, s) => n + s.end - s.start, 0);
    filters.push(`[${inputIndexes.get(arrangement.music.assetId)}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${arrangement.music.volume},atrim=duration=${total},afade=t=out:st=${Math.max(0, total - 3)}:d=${Math.min(3, total)}[bed]`);
    if (arrangement.music.duck) {
      filters.push('[voice]asplit=2[main][side]');
      filters.push('[bed][side]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=600[ducked]');
      filters.push('[main][ducked]amix=inputs=2:duration=first:normalize=0[mixed]');
    } else filters.push('[voice][bed]amix=inputs=2:duration=first:normalize=0[mixed]');
  } else filters.push('[voice]anull[mixed]');
  return filters;
}
