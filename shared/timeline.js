export const defaultTracks = [
  { id: 'program', name: 'Program', kind: 'voice', color: 'sage' },
  { id: 'narration', name: 'Narrator', kind: 'voice', color: 'blue' },
  { id: 'music', name: 'Music', kind: 'music', color: 'gold' },
  { id: 'effects', name: 'FX & actions', kind: 'effects', color: 'rose' },
  { id: 'promos', name: 'Announcements & promos', kind: 'voice', color: 'purple' },
].map(track => ({ ...track, gain: 1, muted: false, solo: false }));

export const roundTime = value => Math.round(value * 1000) / 1000;
export const clipDuration = clip => clip.end - clip.start;
export const clipEnd = clip => (clip.position || 0) + clipDuration(clip);
export const isVoiceClip = clip => !['music', 'effects', 'action', 'transition'].includes(clip.role);
export const trackAudible = (track, tracks) => !track.muted && (!tracks.some(item => item.solo) || track.solo);

export function episodeDuration(arrangement) {
  return arrangement.tracks
    ? Math.max(0, ...arrangement.segments.map(clipEnd))
    : arrangement.segments.reduce((sum, clip) => sum + clipDuration(clip), 0);
}

// Old episodes retain their exact order and timing when opened in the timeline.
export function toTimeline(arrangement) {
  if (arrangement.tracks) return arrangement;
  let position = 0;
  return { ...arrangement, tracks: defaultTracks.map(track => ({ ...track })),
    segments: arrangement.segments.map(clip => {
      const next = { ...clip, trackId: 'program', position: roundTime(position) };
      position += clipDuration(clip);
      return next;
    }) };
}

export function insertClip(arrangement, clip, { at, trackId, anchorId } = {}) {
  const timeline = toTimeline(arrangement);
  if (timeline.segments.length >= 200) throw new Error('Episodes can contain up to 200 clips.');
  const target = trackId || ({ narrator: 'narration', music: 'music', effects: 'effects', action: 'effects', announcement: 'promos', promo: 'promos' }[clip.role] || 'program');
  const track = timeline.tracks.find(item => item.id === target) || timeline.tracks[0];
  const anchor = timeline.segments.find(item => item.id === anchorId);
  let segments = [...timeline.segments], position = at;
  if (position === undefined) {
    if (track.id === 'program') {
      const closing = segments.find(item => item.role === 'closing' && item.trackId === track.id);
      position = clip.role === 'intro' ? 0 : clip.role === 'closing'
        ? episodeDuration(timeline) : anchor?.trackId === track.id ? clipEnd(anchor)
          : closing?.position ?? Math.max(0, ...segments.filter(item => item.trackId === track.id).map(clipEnd));
      segments = segments.map(item => item.position >= position ? { ...item, position: roundTime(item.position + clipDuration(clip)) } : item);
    } else position = anchor?.position || 0;
  }
  position = roundTime(Math.max(0, Math.min(7200 - clipDuration(clip), position)));
  const next = { ...clip, trackId: track.id, position };
  if (clip.role === 'intro') segments.unshift(next); else segments.push(next);
  if (Math.max(0, ...segments.map(clipEnd)) > 7200) throw new Error('Episodes are limited to two hours.');
  return { ...timeline, segments };
}

export function splitClip(clip, sourceTime, newId) {
  if (!Number.isFinite(sourceTime) || sourceTime - clip.start < .05 - 1e-8 || clip.end - sourceTime < .05 - 1e-8) throw new Error('Keep at least 0.05 seconds on each side of the split.');
  return [{ ...clip, end: sourceTime, fadeOut: 0 },
    { ...clip, id: newId, name: `${clip.name.slice(0, 195)} (2)`, start: sourceTime, fadeIn: 0,
      ...(clip.position !== undefined ? { position: roundTime(clip.position + sourceTime - clip.start) } : {}) }];
}

export function trimClip(clip, edge, delta, sourceDuration) {
  if (edge === 'start') {
    const shift = Math.max(-clip.start, -(clip.position || 0), Math.min(delta, clipDuration(clip) - .05));
    return { ...clip, start: roundTime(clip.start + shift), position: roundTime((clip.position || 0) + shift) };
  }
  return { ...clip, end: roundTime(Math.max(clip.start + .05,
    Math.min(sourceDuration, clip.end + delta, clip.start + 7200 - (clip.position || 0)))) };
}
