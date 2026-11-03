export const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export function feed(episodes, origin, branding = {}) {
  const title = xml(branding.title || process.env.SHOW_TITLE || 'Godly Homes');
  const description = xml(branding.description || process.env.SHOW_DESCRIPTION || 'Encouragement for the home you are building.');
  const image = branding.coverUrl ? new URL(branding.coverUrl, origin).href : branding.homePath ? null : process.env.SHOW_IMAGE_URL;
  const author = xml(branding.authorName || branding.title || process.env.SHOW_TITLE || 'Godly Homes');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${title}</title><link>${xml(new URL(branding.homePath || '/', origin).href)}</link><description>${description}</description><language>en-us</language>
<atom:link href="${xml(new URL(branding.feedPath || '/podcast/feed.xml', origin).href)}" rel="self" type="application/rss+xml"/>
<itunes:author>${author}</itunes:author><itunes:explicit>false</itunes:explicit><itunes:type>episodic</itunes:type>
<itunes:owner><itunes:name>${title}</itunes:name><itunes:email>${xml(process.env.SHOW_EMAIL || 'hello@godlyhomes.com')}</itunes:email></itunes:owner>
<itunes:category text="Religion &amp; Spirituality"><itunes:category text="Christianity"/></itunes:category>
${image ? `<itunes:image href="${xml(image)}"/>` : ''}
${episodes.map(e => `<item><title>${xml(e.title)}</title><description>${xml(e.description)}</description>
<link>${xml(origin)}/podcast/${e.episode_id}</link><guid isPermaLink="false">${e.episode_id}</guid>
<pubDate>${new Date(e.published_at).toUTCString()}</pubDate><itunes:episode>${e.episode_number}</itunes:episode><itunes:duration>${Math.round(e.duration)}</itunes:duration><itunes:explicit>false</itunes:explicit>
<enclosure url="${xml(origin)}/media/${e.episode_id}/${e.job_id}.mp3" length="${e.bytes}" type="audio/mpeg"/></item>`).join('\n')}
</channel></rss>`;
}
