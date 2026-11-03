export function validPodcastLink(value, provider) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (provider === 'spotify') return url.hostname === 'open.spotify.com' && /^\/show\/[A-Za-z0-9]+\/?$/.test(url.pathname);
    if (provider === 'apple') return url.hostname === 'podcasts.apple.com' && /\/podcast\//.test(url.pathname);
    return false;
  } catch { return false; }
}
