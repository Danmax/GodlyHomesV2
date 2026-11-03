import { useEffect, useRef, useState } from 'react';
import { cutRange, clipRoles } from '../shared/podcast-editing.js';

export default function ClipEditor({ segment: clip, asset, onChange, onSplit, onCut }) {
  const player = useRef();
  const [cursor, setCursor] = useState(clip.start), [from, setFrom] = useState(clip.start), [to, setTo] = useState(clip.end), [error, setError] = useState('');
  const [peaks, setPeaks] = useState([]);
  useEffect(() => {
    const abort = new AbortController();
    let context;
    setPeaks([]);
    if (asset?.bytes < 20 * 1024 * 1024) fetch(asset.url, { signal: abort.signal }).then(response => response.arrayBuffer()).then(async data => {
      if (abort.signal.aborted) return;
      context = new AudioContext();
      const buffer = await context.decodeAudioData(data), samples = buffer.getChannelData(0), size = Math.ceil(samples.length / 100);
      const values = Array.from({ length: 100 }, (_, index) => { let peak = 0; for (let sample = index * size; sample < Math.min(samples.length, (index + 1) * size); sample += 8) peak = Math.max(peak, Math.abs(samples[sample])); return peak; });
      if (!abort.signal.aborted) setPeaks(values);
    }).catch(() => {}).finally(() => context?.close());
    return () => abort.abort();
  }, [asset?.id]);
  useEffect(() => { setFrom(clip.start); setTo(clip.end); setCursor(clip.start); }, [clip.start, clip.end]);
  const seek = value => { setCursor(value); if (player.current) player.current.currentTime = value; };
  const updateTrim = (key, value) => {
    if (!Number.isFinite(value)) return;
    const next = { ...clip, [key]: value };
    if (next.start >= 0 && next.end <= (asset?.duration || clip.end) && next.end - next.start >= .05) onChange(next);
  };
  const splitValid = cursor >= clip.start + .05 && cursor <= clip.end - .05;
  return <section className="card clip-editor"><h2>Refine this clip</h2><div className="fields"><label>Clip name<input className="field" value={clip.name} maxLength={200} onChange={e => onChange({ ...clip, name: e.target.value })} /></label><label>Episode section<select className="field" value={clip.role || 'segment'} onChange={e => onChange({ ...clip, role: e.target.value })}>{clipRoles.map(role => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>)}</select></label>
    {peaks.length > 0 && <svg className="wave" viewBox="0 0 400 100" role="img" aria-label="Source audio waveform">{peaks.map((peak, index) => <line key={index} x1={index * 4 + 2} x2={index * 4 + 2} y1={50 - Math.max(1, peak * 44)} y2={50 + Math.max(1, peak * 44)} stroke="#76866b" strokeWidth="2" />)}</svg>}
    <audio ref={player} controls src={asset?.url} aria-label="Clip preview" onLoadedMetadata={() => { player.current.currentTime = clip.start; }} onPlay={() => { if (player.current.currentTime < clip.start || player.current.currentTime >= clip.end) player.current.currentTime = clip.start; }} onTimeUpdate={() => { const audio = player.current; setCursor(audio.currentTime); if (audio.currentTime >= clip.end) { audio.pause(); audio.currentTime = clip.start; } }} />
    <label>Playhead: {cursor.toFixed(2)} seconds<input type="range" min={clip.start} max={clip.end} step="0.01" value={Math.min(clip.end, Math.max(clip.start, cursor))} onChange={e => seek(Number(e.target.value))} /></label><p className="small muted">Times refer to the original recording. Preview plays this trimmed clip; render to hear the full mix.</p>
    <div className="edit-grid"><label>Trim start (seconds)<input className="field" type="number" min="0" max={clip.end - .05} step="0.01" value={clip.start} onChange={e => updateTrim('start', Number(e.target.value))} /></label><label>Trim end (seconds)<input className="field" type="number" min={clip.start + .05} max={asset?.duration || clip.end} step="0.01" value={clip.end} onChange={e => updateTrim('end', Number(e.target.value))} /></label></div>
    <div className="row"><button className="btn" disabled={cursor >= clip.end - .05} onClick={() => updateTrim('start', cursor)}>Start at playhead</button><button className="btn" disabled={cursor <= clip.start + .05} onClick={() => updateTrim('end', cursor)}>End at playhead</button><button className="btn" disabled={!splitValid} onClick={() => onSplit(cursor)}>Split here</button></div>
    <fieldset className="fields"><legend>Cut out a range</legend><div className="edit-grid"><label>Cut from (seconds)<input className="field" type="number" min={clip.start} max={clip.end} step="0.01" value={from} onChange={e => setFrom(Number(e.target.value))} /></label><label>Cut to (seconds)<input className="field" type="number" min={clip.start} max={clip.end} step="0.01" value={to} onChange={e => setTo(Number(e.target.value))} /></label></div><div className="row"><button className="btn" onClick={() => setFrom(cursor)}>Mark cut start</button><button className="btn" onClick={() => setTo(cursor)}>Mark cut end</button><button className="btn danger" onClick={() => { try { const result = cutRange(clip, from, to, crypto.randomUUID()); if (!result.length && !confirm('Remove this entire clip from the episode?')) return; onCut(result); setError(''); } catch (error) { setError(error.message); } }}>Cut selected range</button></div>{error && <p className="message error" role="alert">{error}</p>}</fieldset>
    <div className="edit-grid">{['fadeIn', 'fadeOut'].map(key => <label key={key}>{key === 'fadeIn' ? 'Fade in (seconds)' : 'Fade out (seconds)'}<input className="field" type="number" min="0" max="5" step="0.1" value={clip[key]} onChange={e => { const value = Number(e.target.value); if (value >= 0 && value <= 5) onChange({ ...clip, [key]: value }); }} /></label>)}</div><label>Clip volume: {Math.round(clip.gain * 100)}%<input type="range" min="0" max="2" step="0.05" value={clip.gain} onChange={e => onChange({ ...clip, gain: Number(e.target.value) })} /></label><p className="small muted">Cuts preserve the source audio. Use Undo in the episode header to restore an edit.</p>
  </div></section>;
}
