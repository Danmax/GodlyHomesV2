import { spawn } from 'node:child_process';
import { config } from './config.js';
import { episodeDuration, isVoiceClip, trackAudible } from '../shared/timeline.js';

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
  if (arrangement.tracks) return buildTimelineMix(arrangement, inputIndexes);
  const filters = arrangement.segments.map((s, i) => {
    const duration = s.end - s.start;
    const fi = Math.min(s.fadeIn, duration / 2), fo = Math.min(s.fadeOut, duration / 2);
    // loudnorm can leave its output channel layout unspecified. Restore the
    // stereo format after resampling so the final MP3 pass can negotiate it.
    const level = arrangement.autoLevel && isVoiceClip(s) ? 'loudnorm=I=-18:TP=-2:LRA=9,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,' : '';
    return `[${inputIndexes.get(s.assetId)}:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,${level}volume=${s.gain}${fi > 0 ? `,afade=t=in:d=${fi}` : ''}${fo > 0 ? `,afade=t=out:st=${duration - fo}:d=${fo}` : ''}[s${i}]`;
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

function buildTimelineMix(arrangement, inputIndexes) {
  const total = episodeDuration(arrangement), filters = [], speech = [], layers = [], lanes = [];
  [...arrangement.segments].sort((a, b) => a.position - b.position).forEach((clip, index) => {
    const track = arrangement.tracks.find(item => item.id === clip.trackId);
    if (!track || !trackAudible(track, arrangement.tracks) || !track.gain || !clip.gain) return;
    const duration = clip.end - clip.start, fadeIn = Math.min(clip.fadeIn, duration / 2), fadeOut = Math.min(clip.fadeOut, duration / 2);
    const voice = track.kind === 'voice' && isVoiceClip(clip);
    const level = arrangement.autoLevel && voice ? 'loudnorm=I=-18:TP=-2:LRA=9,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,' : '';
    filters.push(`[${inputIndexes.get(clip.assetId)}:a]atrim=start=${clip.start}:end=${clip.end},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,${level}volume=${clip.gain * track.gain}${fadeIn > 0 ? `,afade=t=in:d=${fadeIn}` : ''}${fadeOut > 0 ? `,afade=t=out:st=${duration - fadeOut}:d=${fadeOut}` : ''}[c${index}]`);
    // Concatenate nonoverlapping clips with generated silence. A separate
    // multi-hour adelay buffer for every late clip would exhaust worker memory.
    let lane = lanes.find(item => item.voice === voice && item.end <= clip.position + 1e-8);
    if (!lane) { lane = { voice, end: 0, inputs: [] }; lanes.push(lane); }
    const gapSamples = Math.round((clip.position - lane.end) * 44100);
    if (gapSamples > 0) {
      filters.push(`anullsrc=r=44100:cl=stereo,atrim=end_sample=${gapSamples}[gap${index}]`);
      lane.inputs.push(`[gap${index}]`);
    }
    lane.inputs.push(`[c${index}]`); lane.end = clip.position + duration;
  });
  lanes.forEach((lane, index) => {
    filters.push(`${lane.inputs.join('')}concat=n=${lane.inputs.length}:v=0:a=1[lane${index}]`);
    (lane.voice ? speech : layers).push(`[lane${index}]`);
  });
  // A finite silent backbone preserves leading gaps, trailing muted clips and
  // fully muted projects without generating an unbounded FFmpeg stream.
  filters.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${total}[silence]`);
  const bedAllowed = !arrangement.tracks.some(track => track.solo);
  if (arrangement.music.assetId && bedAllowed) {
    filters.push(`[${inputIndexes.get(arrangement.music.assetId)}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${total},volume=${arrangement.music.volume},afade=t=out:st=${Math.max(0, total - 3)}:d=${Math.min(3, total)}[bed]`);
    if (arrangement.music.duck && speech.length) {
      filters.push(`${speech.join('')}amix=inputs=${speech.length}:normalize=0:duration=longest,apad=whole_dur=${total},atrim=duration=${total},asplit=2[voice][side]`);
      filters.push('[bed][side]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=600[ducked]');
      speech.splice(0, speech.length, '[voice]'); layers.push('[ducked]');
    } else layers.push('[bed]');
  }
  const inputs = ['[silence]', ...speech, ...layers];
  filters.push(`${inputs.join('')}amix=inputs=${inputs.length}:normalize=0:duration=longest,atrim=duration=${total}[mixed]`);
  return filters;
}
