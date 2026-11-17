import { clipEnd, episodeDuration, isVoiceClip, trackAudible } from '../shared/timeline.js';

// Stream sources instead of decoding whole, potentially two-hour recordings.
// The server render remains the final loudness-normalized master.
export function createTimelinePlayback(arrangement, assets, { onTime, onEnd, onError }) {
  const context = new AudioContext(), nodes = new Map();
  const limiter = context.createDynamicsCompressor(); limiter.connect(context.destination);
  const duration = episodeDuration(arrangement);
  let frame, origin = 0, stopped = false, lastUpdate = 0;
  const stop = () => {
    if (stopped) return;
    stopped = true; cancelAnimationFrame(frame);
    for (const { audio, gain, source } of nodes.values()) { audio.pause(); audio.removeAttribute('src'); audio.load(); source.disconnect(); gain.disconnect(); }
    nodes.clear(); limiter.disconnect(); context.close().catch(() => {});
  };
  const fail = () => { if (stopped) return; stop(); onError('An audio source could not play. Check the library preview and try again.'); };
  const nodeFor = (key, assetId, sourceTime, loop = false) => {
    if (nodes.has(key)) return nodes.get(key);
    const asset = assets.find(item => item.id === assetId);
    if (!asset?.url) { fail(); return null; }
    const audio = new Audio(); audio.preload = 'auto'; audio.loop = loop; audio.src = asset.url;
    const source = context.createMediaElementSource(audio), gain = context.createGain();
    gain.gain.value = 0; source.connect(gain); gain.connect(limiter);
    const node = { audio, source, gain }; nodes.set(key, node);
    audio.addEventListener('error', fail, { once: true });
    audio.currentTime = sourceTime;
    audio.play().catch(() => { if (!stopped) fail(); });
    return node;
  };
  const tick = () => {
    if (stopped) return;
    const time = context.currentTime - origin;
    if (time >= duration) { onTime(duration); stop(); onEnd(); return; }
    let speaking = false;
    for (const clip of arrangement.segments) {
      const track = arrangement.tracks.find(item => item.id === clip.trackId);
      const audible = track && trackAudible(track, arrangement.tracks) && track.gain > 0 && clip.gain > 0;
      const active = audible && time >= clip.position && time < clipEnd(clip);
      const existing = nodes.get(clip.id);
      if (!active) { if (existing && !existing.audio.paused) existing.audio.pause(); continue; }
      const elapsed = time - clip.position, clipDuration = clip.end - clip.start;
      const node = existing || nodeFor(clip.id, clip.assetId, clip.start + elapsed);
      if (!node || stopped) return;
      // Correct for loading/seeking delays without decoding large sources.
      if (!node.audio.seeking && Math.abs(node.audio.currentTime - (clip.start + elapsed)) > .18) node.audio.currentTime = clip.start + elapsed;
      const fadeIn = Math.min(clip.fadeIn, clipDuration / 2), fadeOut = Math.min(clip.fadeOut, clipDuration / 2);
      const envelope = Math.min(1, fadeIn ? elapsed / fadeIn : 1, fadeOut ? (clipDuration - elapsed) / fadeOut : 1);
      node.gain.gain.setTargetAtTime(clip.gain * track.gain * Math.max(0, envelope), context.currentTime, .01);
      if (isVoiceClip(clip) && track.kind === 'voice') speaking = true;
    }
    if (arrangement.music.assetId && !arrangement.tracks.some(track => track.solo)) {
      const asset = assets.find(item => item.id === arrangement.music.assetId);
      const node = nodeFor('bed', arrangement.music.assetId, asset?.duration ? time % asset.duration : 0, true);
      if (!node || stopped) return;
      const fade = Math.min(1, (duration - time) / Math.min(3, duration));
      node.gain.gain.setTargetAtTime(arrangement.music.volume * fade * (arrangement.music.duck && speaking ? .25 : 1), context.currentTime, speaking ? .02 : .3);
    }
    if (time - lastUpdate > .04) { onTime(time); lastUpdate = time; }
    frame = requestAnimationFrame(tick);
  };
  return { stop, async play(from = 0) {
    try { await context.resume(); if (stopped) return; origin = context.currentTime - from; tick(); }
    catch { if (!stopped) fail(); }
  } };
}
