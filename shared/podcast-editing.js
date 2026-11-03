export const clipRoles = ['intro', 'segment', 'transition', 'closing'];
export function cutRange(clip, from, to, newId) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < clip.start || to > clip.end || to <= from) throw new Error('Choose a range inside this clip.');
  const before = from - clip.start, after = clip.end - to;
  if ((before > 0 && before < .05) || (after > 0 && after < .05)) throw new Error('Keep at least 0.05 seconds on either side of the cut.');
  return [before >= .05 ? { ...clip, end: from, fadeOut: 0 } : null, after >= .05 ? { ...clip, id: before >= .05 ? newId : clip.id, start: to, fadeIn: 0 } : null].filter(Boolean);
}
