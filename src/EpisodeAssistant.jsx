import { useEffect, useState } from 'react';
import { api } from './api.js';
import { autoMix, introScript } from '../shared/podcast-editing.js';

export default function EpisodeAssistant({ draft, onMix, onSaveScript, onGenerated, onAdd, onBusy, disabled }) {
  const [preset, setPreset] = useState('balanced'), [mixed, setMixed] = useState(false);
  const saved = draft.arrangement.introDraft;
  const [show, setShow] = useState(saved?.show || 'Godly Homes'), [host, setHost] = useState(saved?.host || ''), [topic, setTopic] = useState(saved?.topic || draft.title), [tone, setTone] = useState(saved?.tone || 'warm');
  const [script, setScript] = useState(saved?.script || ''), [voice, setVoice] = useState(saved?.voice || 'marin'), [options, setOptions] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [generated, setGenerated] = useState(null), [added, setAdded] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { api('/api/studio-tools/options').then(setOptions).catch(() => setOptions({ introEnabled: false })); }, []);
  const perform = async fn => { onBusy?.(true); setBusy(true); setError(''); setMessage(''); try { await fn(); } catch (error) { setError(error.message); } finally { setBusy(false); onBusy?.(false); } };
  const fields = { show, host, topic, tone };
  return <section className="card fields episode-assistant"><div><p className="eyebrow">A little help in the studio</p><h2>Intro & auto mix</h2></div>
    <label>Mix style<select className="field" value={preset} disabled={disabled || busy} onChange={e => setPreset(e.target.value)}><option value="balanced">Balanced conversation</option><option value="intimate">Quiet reflection</option><option value="upbeat">Upbeat show</option></select></label>
    <button className="btn primary" disabled={disabled || busy || !draft.arrangement.segments.length} onClick={() => { onMix(autoMix(draft.arrangement, preset)); setMixed(true); }}>Apply auto mix</button>
    <p className="small muted">Sets clip levels, smooth fades, and music volume with automatic voice ducking. The rendered MP3 is loudness normalized. Your clip order and cuts stay as arranged.</p>
    {mixed && <p className="message" role="status">Mix settings applied. Render in Review & publish to hear the complete mix. Use Undo to restore your previous settings.</p>}
    <details className="intro-generator"><summary>Intro Generator</summary><fieldset className="fields" disabled={disabled || busy}><div className="edit-grid"><label>Show name<input className="field" value={show} maxLength={200} onChange={e => setShow(e.target.value)} /></label><label>Host name (optional)<input className="field" value={host} maxLength={200} onChange={e => setHost(e.target.value)} /></label></div><label>Episode topic<input className="field" value={topic} maxLength={500} onChange={e => setTopic(e.target.value)} /></label><label>Intro tone<select className="field" value={tone} onChange={e => setTone(e.target.value)}><option value="warm">Warm & welcoming</option><option value="reflective">Reflective</option><option value="upbeat">Upbeat</option></select></label>
      <div className="row"><button className="btn" disabled={!show.trim() || !topic.trim()} onClick={() => setScript(introScript(fields))}>Build starter script</button><button className="btn" disabled={!options?.introEnabled || !show.trim() || !topic.trim()} onClick={() => perform(async () => { const result = await api('/api/studio-tools/intro/script', { method: 'POST', body: fields }); setScript(result.script); })}>Generate AI script</button></div>
      <label>Intro script<textarea className="field" rows={7} maxLength={1200} value={script} onChange={e => setScript(e.target.value)} placeholder="Build a starter script, generate one, or write your own." /></label>
      <div className="row"><button className="btn" disabled={!script.trim()} onClick={() => { onSaveScript({ ...fields, script, voice }); setMessage('Script added to your episode draft. Wait for Saved before leaving.'); }}>Save intro script</button><button className="btn" disabled={!script.trim()} onClick={() => perform(async () => { await navigator.clipboard.writeText(script); setMessage('Script copied. You can record it in your own voice from the Record tab.'); })}>Copy script</button></div>
      <label>Generated voice<select className="field" value={voice} onChange={e => setVoice(e.target.value)}>{['marin', 'cedar', 'coral', 'sage'].map(name => <option key={name} value={name}>{name[0].toUpperCase() + name.slice(1)}</option>)}</select></label>
      <p className="small muted">Generated audio uses an AI voice. A spoken AI disclosure is included before your script. Listen before adding it to your episode.</p>
      <button className="btn accent" disabled={!options?.introEnabled || !script.trim()} onClick={() => perform(async () => {
        const asset = await api('/api/studio-tools/intro/voice', { method: 'POST', body: { script, voice } });
        await onGenerated(asset); setGenerated({ ...asset, script, voice }); setAdded(false);
      })}>{busy ? 'Generating…' : 'Generate voice preview'}</button>
    </fieldset>
    {options && !options.introEnabled && <p className="message" role="status">AI scripts and voices need the voice service to be enabled by your administrator. You can build a starter script, record it yourself, or upload an intro now.</p>}
    {generated && <div className="fields"><p className="small muted">Saved to your library: {generated.name}. This preview uses the script as it was when generated.</p><audio controls src={generated.url} aria-label="Generated intro preview" /><button className="btn primary" disabled={disabled || busy || added} onClick={() => perform(async () => { await onAdd(generated, 'intro'); setAdded(true); })}>{added ? 'Intro added to episode' : 'Add this intro to episode'}</button></div>}
    </details>{error && <p className="message error" role="alert">{error}</p>}{message && <p className="message" role="status">{message}</p>}
  </section>;
}
