import { useState } from 'react';
import { Radio, Copy } from 'lucide-react';
import spotifyIcon from './assets/spotify-icon.webp';
import { validPodcastLink } from '../shared/podcast-links.js';

export default function PodcastSubscriptions({ channel, feed = '/podcast/feed.xml' }) {
  const [message, setMessage] = useState('');
  const feedUrl = new URL(feed, location.origin).href;
  const copy = async () => {
    try { await navigator.clipboard.writeText(feedUrl); setMessage('RSS feed URL copied. Paste it into your podcast app.'); }
    catch { setMessage('Select and copy the RSS feed URL below.'); }
  };
  return <div className="podcast-subscriptions"><div className="row podcast-subscribe">
    {channel?.spotifyUrl && validPodcastLink(channel.spotifyUrl, 'spotify') && <a className="btn spotify-link" href={channel.spotifyUrl} target="_blank" rel="noopener noreferrer" aria-label={`Listen to ${channel.title} on Spotify (opens in a new tab)`}><img src={spotifyIcon} alt="" width={28} height={28} /><span><strong>Listen on Spotify</strong><span className="spotify-show-name">{channel.title}</span></span></a>}
    {channel?.applePodcastsUrl && validPodcastLink(channel.applePodcastsUrl, 'apple') && <a className="btn" href={channel.applePodcastsUrl} target="_blank" rel="noopener noreferrer" aria-label={`Listen to ${channel.title} on Apple Podcasts (opens in a new tab)`}>Apple Podcasts ↗</a>}
    <a className="btn" href={feed}><Radio size={16} />Subscribe with RSS</a><button className="btn" type="button" onClick={copy}><Copy size={15} />Copy RSS URL</button>
  </div><details className="rss-subscription-help"><summary>Use another podcast app</summary><p className="small muted">In Apple Podcasts on Mac, choose File → Follow a Show by URL. In Pocket Casts, paste the RSS URL into the search bar. Other RSS-compatible apps may call this Add by URL or Subscribe by RSS. The feed updates when new episodes are published.</p><a className="text-link" href={`https://pocketcasts.com/follow/${encodeURIComponent(feedUrl)}`} target="_blank" rel="noopener noreferrer">Open this feed in Pocket Casts ↗</a><label className="small">RSS feed URL<input className="field" type="url" readOnly value={feedUrl} onFocus={event => event.target.select()} /></label></details>{message && <p className="small message" role="status">{message}</p>}</div>;
}
