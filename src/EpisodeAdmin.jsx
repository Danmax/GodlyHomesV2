import { useEffect, useState } from 'react';
import { Eye, EyeOff, RefreshCw, Trash2 } from 'lucide-react';
import { api } from './api.js';

export default function EpisodeAdmin() {
  const [episodes, setEpisodes] = useState([]), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all');
  const load = async () => { setEpisodes(await api('/api/admin/episodes')); };
  useEffect(() => { load().catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  const action = async task => {
    setBusy(true); setError(''); setMessage('');
    try { await task(); await load(); }
    catch (e) { setError(e.message); await load().catch(() => {}); }
    finally { setBusy(false); }
  };
  const visibility = episode => action(async () => {
    await api(`/api/admin/episodes/${episode.id}/visibility`, { method: 'PUT', body: { hidden: !episode.adminHidden, expectedHidden: episode.adminHidden } });
    setMessage(episode.adminHidden ? 'Visibility restored. Published episodes appear when their channel is public.' : 'Episode hidden from the public website, RSS feeds, and public audio links.');
  });
  const remove = episode => {
    if (!confirm(`Permanently delete “${episode.title}” from ${episode.channelTitle}? This deletes its draft, published episode, and rendered audio. Original recordings remain available to the author. This cannot be undone.`)) return;
    action(async () => {
      await api(`/api/admin/episodes/${episode.id}`, { method: 'DELETE', body: { version: episode.version } });
      setMessage('Episode permanently deleted.');
    });
  };
  const shown = episodes.filter(e => `${e.title} ${e.publishedTitle || ''} ${e.channelTitle} ${e.ownerEmail}`.toLowerCase().includes(search.toLowerCase())
    && (filter === 'all' || (filter === 'hidden' ? e.adminHidden : filter === 'published' ? e.published && !e.adminHidden && e.channelPublic : !e.published)));
  return <>
    <div className="row between"><div><h2>Podcast episodes</h2><p className="small muted">Manage episodes across all channels. Hiding preserves the draft and audio. Restoring visibility keeps unpublished drafts private.</p><p className="small muted">Podcast providers may retain downloaded episodes or take time to refresh their feeds.</p></div><button className="btn" disabled={busy || loading} onClick={() => action(async () => {})}><RefreshCw size={15} />Refresh episodes</button></div>
    {error && <p className="message error" role="alert">{error}</p>}
    {message && <p className="message" role="status">{message}</p>}
    <div className="admin-field-grid"><label>Search episodes<input className="field" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Title, channel, or author email" /></label><label>Episode filter<select aria-label="Episode filter" className="field" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All episodes</option><option value="published">Public episodes</option><option value="hidden">Hidden by admin</option><option value="draft">Unpublished drafts</option></select></label></div>
    {loading ? <p role="status">Loading episodes…</p> : <div className="admin-entry-list">{shown.map(e => <article className="card admin-episode-card" key={e.id} aria-label={`Manage ${e.title}`}>
      <div className="row between"><div><h3>{e.title}</h3><p className="small muted">{e.channelTitle} · {e.ownerEmail}</p>{e.publishedTitle && e.publishedTitle !== e.title && <p className="small muted">Published as: {e.publishedTitle}</p>}</div><span className={`badge ${e.adminHidden || !e.published || !e.channelPublic ? 'draft' : ''}`}>{e.adminHidden ? 'Hidden by admin' : !e.published ? 'Draft' : !e.channelPublic ? 'Private channel' : 'Public'}</span></div>
      <div className="row" style={{ marginTop: 16 }}><button className="btn" disabled={busy} onClick={() => visibility(e)}>{e.adminHidden ? <Eye size={15} /> : <EyeOff size={15} />}{e.adminHidden ? 'Restore visibility' : 'Hide episode'}</button>{e.published && !e.adminHidden && e.channelPublic && <a className="btn" href={`/podcast/${e.id}`} target="_blank" rel="noopener noreferrer">View episode</a>}<button className="btn danger" disabled={busy} onClick={() => remove(e)}><Trash2 size={15} />Delete episode</button></div>
    </article>)}{!shown.length && <p className="card muted">No episodes match this view.</p>}</div>}
  </>;
}
