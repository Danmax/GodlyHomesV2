export const clipRoles = ['intro', 'segment', 'transition', 'closing'];
export function cutRange(clip, from, to, newId) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < clip.start || to > clip.end || to <= from) throw new Error('Choose a range inside this clip.');
  const before = from - clip.start, after = clip.end - to;
  if ((before > 0 && before < .05) || (after > 0 && after < .05)) throw new Error('Keep at least 0.05 seconds on either side of the cut.');
  return [before >= .05 ? { ...clip, end: from, fadeOut: 0 } : null, after >= .05 ? { ...clip, id: before >= .05 ? newId : clip.id, start: to, fadeIn: 0 } : null].filter(Boolean);
}

// Silence ranges use source coordinates. Keep a little room around speech.
export function suggestClips(clip, silences, mode = 'split', padding = .15, makeId = () => crypto.randomUUID()) {
  if (!['split', 'tighten'].includes(mode)) throw new Error('Choose split or tighten.');
  const pauses = silences.filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .map(s => ({ start: Math.max(clip.start, s.start), end: Math.min(clip.end, s.end) }))
    .filter(s => s.end - s.start >= .5).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const pause of pauses) {
    const previous = merged.at(-1);
    if (previous && pause.start <= previous.end) previous.end = Math.max(previous.end, pause.end);
    else merged.push({ ...pause });
  }
  const ranges = [];
  if (merged.length === 1 && merged[0].start === clip.start && merged[0].end === clip.end) return [{ ...clip }];
  let start = clip.start;
  for (const pause of merged) {
    if (mode === 'split') {
      const at = (pause.start + pause.end) / 2;
      if (at - start >= .25 && clip.end - at >= .25) { ranges.push([start, at]); start = at; }
    } else {
      const end = Math.min(clip.end, pause.start + padding);
      if (end - start >= .05) ranges.push([start, end]);
      start = Math.max(start, pause.end - padding);
    }
  }
  if (clip.end - start >= .05) ranges.push([start, clip.end]);
  // Never remove a completely quiet recording without explicit manual deletion.
  if (!ranges.length) return [{ ...clip }];
  return ranges.map(([start, end], index) => ({ ...clip, id: index ? makeId() : clip.id,
    name: ranges.length > 1 ? `${clip.name.slice(0, 185)} (${index + 1})` : clip.name, start, end,
    fadeIn: index ? .02 : Math.min(clip.fadeIn, (end - start) / 2),
    fadeOut: index < ranges.length - 1 ? .02 : Math.min(clip.fadeOut, (end - start) / 2) }));
}

export function autoMix(arrangement, preset = 'balanced') {
  const volume = { balanced: .12, intimate: .07, upbeat: .18 }[preset];
  if (volume === undefined) throw new Error('Choose a mix preset.');
  return { ...arrangement, autoLevel: true, segments: arrangement.segments.map(clip => ({ ...clip,
    gain: clip.role === 'transition' ? .6 : 1,
    fadeIn: Math.min(clip.role === 'intro' || clip.role === 'transition' ? .5 : .03, (clip.end - clip.start) / 2),
    fadeOut: Math.min(clip.role === 'closing' || clip.role === 'transition' ? 1 : .03, (clip.end - clip.start) / 2) })),
    music: { ...arrangement.music, volume, duck: true } };
}

export function introScript({ show = 'Godly Homes', host = '', topic = '', tone = 'warm' }) {
  const opening = tone === 'upbeat' ? `Welcome to ${show}!` : `Welcome to ${show}, a little encouragement for the home you’re building.`;
  return `${opening}${host.trim() ? ` I’m ${host.trim()}.` : ''}${topic.trim() ? ` Today, we’re talking about ${topic.trim()}.` : ''} ${tone === 'reflective' ? 'Take a breath, settle in, and make a little room for reflection.' : 'Whether you’re listening at home or on the go, we’re glad you’re here.'} Let’s begin.`;
}
