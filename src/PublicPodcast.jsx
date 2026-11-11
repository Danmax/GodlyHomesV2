import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from './api.js';
import { useSiteContent } from './SiteContent.jsx';
import PodcastSubscriptions from './PodcastSubscriptions.jsx';
import PodcastBranding from './PodcastBranding.jsx';
import SiteLayout from './SiteLayout.jsx';
import { EpisodeCard } from './ChannelPages.jsx';

export function PodcastSection() {
  const { documents: { home } } = useSiteContent();
  const [episodes, setEpisodes] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => { api('/api/public/episodes').then(setEpisodes).catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  return <section id="podcast" className="py-24 lg:py-32" style={{ background: '#f4ede3' }}><div className="max-w-7xl mx-auto px-5 lg:px-8 grid lg:grid-cols-12 gap-12"><div className="lg:col-span-5"><p className="eyebrow">The Godly Homes Podcast</p><h2 className="serif text-5xl font-semibold copy-text">{home.podcastTitle}</h2><p className="mt-6 leading-relaxed" style={{ color: '#5a534c' }}>{home.podcastDescription}</p><PodcastBranding /><PodcastSubscriptions /><div className="row podcast-subscribe"><a href="/channels" className="btn">Browse authors & channels</a></div></div><div className="lg:col-span-7 stack">{loading ? <p role="status">Loading episodes…</p> : error ? <p className="message error" role="alert">Episodes are temporarily unavailable. Please try again later.</p> : !episodes.length ? <div className="card"><h3 className="serif text-3xl">Something good is taking shape.</h3><p className="muted mt-3">Our first conversations will appear here as they’re published.</p></div> : episodes.map(e => <EpisodeCard key={e.id} episode={e} />)}</div></div></section>;
}

export function NewsletterSection() {
  const { documents: { newsletter, site } } = useSiteContent();
  const [email, setEmail] = useState(''), [consent, setConsent] = useState(false), [state, setState] = useState('idle'), [error, setError] = useState(''), [signupMessage, setSignupMessage] = useState('');
  const submit = async event => {
    event.preventDefault(); setState('saving'); setError('');
    try { const result = await api('/api/subscribe', { method: 'POST', body: { email, consent } }); setSignupMessage(result.message); setState('done'); }
    catch (e) { setError(e.message); setState('idle'); }
  };
  return <section id="join" className="px-5 lg:px-8 py-24"><div className="max-w-7xl mx-auto rounded-3xl p-9 sm:p-14 grid lg:grid-cols-2 gap-10" style={{ background: '#55644c', color: '#fbf7f1' }}><div><p className="eyebrow" style={{ color: '#dfe5d6' }}>Stay close</p><h2 className="serif text-5xl font-semibold copy-text">{newsletter.title}</h2><p className="mt-5 leading-relaxed">{newsletter.description}</p></div>{state === 'done' ? <div role="status" className="self-center"><h3 className="serif text-3xl">Thanks for signing up.</h3><p className="mt-3">{signupMessage}</p></div> : <form className="self-center" onSubmit={submit}><label>Email address<input className="field" type="email" required autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label><label className="row small mt-4"><input type="checkbox" checked={consent} required onChange={e => setConsent(e.target.checked)} />I’d like to receive Godly Homes updates.</label>{error && <p role="alert" className="mt-3">{error}</p>}<button className="btn accent mt-5" disabled={state === 'saving'}>{state === 'saving' ? 'Joining…' : newsletter.buttonLabel}</button><p className="small mt-4" style={{ opacity: .8 }}>To leave the list, contact {site.email}.</p></form>}</div></section>;
}

export function PublicEpisode({ id }) {
  const [episode, setEpisode] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => { api(`/api/public/episodes/${id}`).then(ep => { setEpisode(ep); document.title = `${ep.title} — ${ep.channel?.title || 'Godly Homes'}`; }).catch(() => setError('Could not load this episode. Please try again later.')).finally(() => setLoading(false)); }, [id]);
  return <SiteLayout><div className="public-episode"><a href="/#podcast" className="btn ghost"><ArrowLeft size={15} />Godly Homes Podcast</a>{loading ? <p role="status">Loading episode…</p> : error ? <p role="alert" className="message error">{error}</p> : <article className="card" style={{ marginTop: 30 }}><p className="eyebrow">Episode {episode.number} · {new Date(episode.publishedAt).toLocaleDateString()}</p><h1 className="serif text-5xl font-semibold">{episode.title}</h1><PodcastBranding channel={episode.channel} />{episode.series && episode.channel && <p><a className="text-link" href={`/channels/${episode.channel.slug}/series/${episode.series.slug}`}>Series: {episode.series.title}</a></p>}{episode.channel && <p><a className="text-link" href={`/authors/${episode.channel.slug}`}>About {episode.channel.authorName}</a></p>}<audio controls src={episode.url} /><p className="notes" style={{ marginTop: 30 }}>{episode.description}</p><PodcastSubscriptions channel={episode.channel} feed={episode.channel ? `/channels/${episode.channel.slug}/feed.xml` : '/podcast/feed.xml'} /></article>}</div></SiteLayout>;
}
