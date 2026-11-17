export function assetsForEpisode(assets, episode) {
  const ids = new Set([...(episode.arrangement.segments || []).map(clip => clip.assetId), episode.arrangement.music?.assetId].filter(Boolean));
  return assets.filter(asset => asset.episodeId === episode.id || ids.has(asset.id));
}

// A library item is a reusable edit, independent of its timeline placement.
export function clipFromSource(asset, role = 'segment', template, makeId = () => crypto.randomUUID()) {
  return { id: makeId(), assetId: asset.id, name: template?.name || asset.name,
    role: template?.role || role, start: template?.start ?? 0,
    end: template?.end ?? (role === 'transition' ? Math.min(5, asset.duration) : asset.duration),
    gain: template?.gain ?? (role === 'music' ? .2 : 1),
    fadeIn: template?.fadeIn ?? (role === 'transition' ? .5 : 0),
    fadeOut: template?.fadeOut ?? (role === 'transition' ? .5 : 0) };
}

export function libraryClipData(clip, folderId, name = clip.name) {
  const { assetId, role = 'segment', start, end, gain, fadeIn, fadeOut } = clip;
  return { assetId, name, role, start, end, gain, fadeIn, fadeOut, folderId: folderId || null };
}
