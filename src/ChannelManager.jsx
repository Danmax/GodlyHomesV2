import { useEffect, useState } from 'react';
import { api } from './api.js';

const emptyData = { title: '', description: '', coverUrl: '', coverAlt: 'Podcast cover artwork', authorName: '', authorBio: '', authorImageUrl: '', authorLink: '', accentColor: '#55644c' };
const blankSeries = () => ({ slug: '', data: { title: '', description: '', coverUrl: '', coverAlt: 'Podcast series artwork' } });
const slugify = value => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);

function Field({ label, value, onChange, multiline, required = true, ...props }) {
  return <label>{label}{multiline ? <textarea className="field" rows="4" value={value} onChange={event => onChange(event.target.value)} required={required} {...props} /> : <input className="field" value={value} onChange={event => onChange(event.target.value)} required={required} {...props} />}</label>;
}
function ImageField({ label, value, onChange, onBusy }) {
  const [error, setError] = useState('');
  const upload = async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    setError(''); onBusy(true);
    try { const body = new FormData(); body.append('image', file); const result = await api('/api/channel/images', { method: 'POST', body }); onChange(result.url); }
    catch (error) { setError(error.message); } finally { onBusy(false); }
  };
  return <div className="fields"><Field label={label} value={value} onChange={onChange} required={false} placeholder="Image URL or upload below" /><label className="small">Upload {label.toLowerCase()}<input className="field" type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} /></label>{value && <img className="admin-image-preview" src={value} alt={label} />}{error && <p className="message error" role="alert">{error}</p>}</div>;
}

export default function ChannelManager({ onDirty }) {
  const [channel, setChannel] = useState(null), [series, setSeries] = useState([]), [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => { api('/api/channel').then(result => { setChannel(result.channel || { slug: '', data: { ...emptyData }, isPublic: false, version: 0 }); setSeries(result.series); }).catch(error => setError(error.message)).finally(() => setLoading(false)); }, []);
  const change = (key, value) => { setChannel(old => ({ ...old, [key]: value })); onDirty(true); setMessage(''); };
  const data = (key, value) => { setChannel(old => ({ ...old, data: { ...old.data, [key]: value } })); onDirty(true); setMessage(''); };
  const saveChannel = async event => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { const result = await api('/api/channel', { method: 'PUT', body: channel }); setChannel(result); onDirty(false); setMessage('Your profile and channel settings are saved.'); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  const editSeries = (key, value) => { setSelected(old => ({ ...old, [key]: value })); onDirty(true); setMessage(''); };
  const seriesField = (key, value) => { setSelected(old => ({ ...old, slug: key === 'title' && !old.id && (!old.slug || old.slug === slugify(old.data.title)) ? slugify(value) : old.slug, data: { ...old.data, [key]: value } })); onDirty(true); setMessage(''); };
  const saveSeries = async event => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { const result = await api(`/api/channel/series${selected.id ? `/${selected.id}` : ''}`, { method: selected.id ? 'PUT' : 'POST', body: selected }); setSeries(old => [result, ...old.filter(item => item.id !== result.id)]); setSelected(null); onDirty(false); setMessage('Series saved. Assign it to an episode in Review & publish.'); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  if (loading) return <p role="status">Loading your channel…</p>;
  return <><div className="row between"><div><p className="eyebrow">Your voice, your home</p><h1>My channel</h1><p className="muted">Your author profile, podcast branding, and series.</p></div>{channel?.version > 0 && channel.isPublic && <a className="btn" href={`/channels/${channel.slug}`} target="_blank" rel="noopener noreferrer">View my channel ↗</a>}</div>{error && <p className="message error" role="alert">{error}</p>}{message && <p className="message" role="status">{message}</p>}
    {channel && <div className="workspace channel-manager"><form className="card fields" onSubmit={saveChannel}><h2>Author profile & channel</h2><fieldset className="fields" disabled={busy || uploading || Boolean(selected)}>
      <Field label="Author display name" value={channel.data.authorName} onChange={value => data('authorName', value)} maxLength="200" />
      <Field label="Author biography" value={channel.data.authorBio} onChange={value => data('authorBio', value)} multiline maxLength="4000" />
      <ImageField label="Author portrait" value={channel.data.authorImageUrl} onChange={value => data('authorImageUrl', value)} onBusy={setUploading} />
      <Field label="Author website or profile" value={channel.data.authorLink} onChange={value => data('authorLink', value)} required={false} />
      <Field label="Channel title" value={channel.data.title} onChange={value => data('title', value)} maxLength="200" />
      <Field label="Channel description" value={channel.data.description} onChange={value => data('description', value)} multiline maxLength="4000" />
      <Field label="Channel address" value={channel.slug} onChange={value => change('slug', value)} pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength="3" maxLength="100" placeholder="your-podcast-name" />
      <p className="small muted">Your page uses /channels/{channel.slug || 'your-podcast-name'}. Changing this address changes your public profile and RSS links.</p>
      <ImageField label="Channel cover artwork" value={channel.data.coverUrl} onChange={value => data('coverUrl', value)} onBusy={setUploading} />
      <Field label="Cover image description" value={channel.data.coverAlt} onChange={value => data('coverAlt', value)} maxLength="200" />
      <Field label="Brand color" type="color" value={channel.data.accentColor} onChange={value => data('accentColor', value)} />
      <label className="row"><input type="checkbox" checked={channel.isPublic} onChange={event => change('isPublic', event.target.checked)} />Make my profile and channel public</label>
      <p className="small muted">A private channel hides its published episodes and RSS feed. Make it public before publishing an episode. Recordings and drafts stay private.</p>
      <button className="btn primary" disabled={busy || uploading}>Save profile & channel</button>
    </fieldset></form><section className="stack"><div className="card fields"><div className="row between"><h2>Podcast series</h2><button className="btn" disabled={busy || !channel.version || Boolean(selected)} onClick={() => { setSelected(blankSeries()); setMessage(''); }}>New series</button></div><p className="small muted">Group episodes into series within your channel. A series appears publicly after its first episode is published.</p>{!channel.version && <p className="message">Save your channel to create a series.</p>}{series.map(item => <button className="btn channel-series-button" key={item.id} disabled={busy || Boolean(selected)} onClick={() => setSelected(item)}>{item.data.title}</button>)}</div>
      {selected && <form className="card fields" onSubmit={saveSeries}><h2>{selected.id ? 'Edit series' : 'Create series'}</h2><fieldset className="fields" disabled={busy || uploading}>
        <Field label="Series title" value={selected.data.title} onChange={value => seriesField('title', value)} maxLength="200" />
        <Field label="Series address" value={selected.slug} onChange={value => editSeries('slug', value)} pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength="3" maxLength="100" />
        <Field label="Series description" value={selected.data.description} onChange={value => seriesField('description', value)} multiline maxLength="4000" />
        <ImageField label="Series cover artwork" value={selected.data.coverUrl} onChange={value => seriesField('coverUrl', value)} onBusy={setUploading} />
        <Field label="Series image description" value={selected.data.coverAlt} onChange={value => seriesField('coverAlt', value)} maxLength="200" />
        <div className="row"><button className="btn primary" disabled={busy || uploading}>Save series</button><button type="button" className="btn" onClick={() => { if (confirm('Close this series and discard unsaved changes?')) { setSelected(null); onDirty(false); } }}>Cancel</button></div>
      </fieldset></form>}
    </section></div>}
  </>;
}
