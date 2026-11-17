import { useEffect, useRef, useState } from 'react';
import { GripVertical, Music2 } from 'lucide-react';
import { clipRoles, roleLabels } from '../shared/podcast-editing.js';
import { formatTime } from '../shared/audio-time.js';
import { api, uploadAudio } from './api.js';

export default function ClipLibrary({ assets, episodeId, onAdd, onUpload, onRename, onBusy, disabled }) {
  const [source, setSource] = useState(''), [role, setRole] = useState('segment'), [name, setName] = useState('');
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const choices = assets.filter(item => !['music', 'music-layer'].includes(role) || item.category === 'music');
  const file = useRef(), asset = choices.find(item => item.id === source);
  useEffect(() => { if (source && !choices.some(item => item.id === source)) setSource(''); }, [assets, role, source]);
  useEffect(() => { setName(asset?.name || ''); }, [asset?.id, asset?.name]);
  const perform = async fn => {
    onBusy?.(true); setWorking(true); setError(''); setMessage('');
    try { await fn(); } catch (error) { setError(error.message); } finally { setWorking(false); onBusy?.(false); }
  };
  const upload = event => {
    const files = [...event.target.files]; event.target.value = '';
    if (!files.length) return;
    perform(async () => {
      for (const file of files) {
        if (file.size > 512 * 1024 * 1024) throw new Error(`${file.name}: choose a file smaller than 512 MB.`);
        const imported = await uploadAudio(file, file.name, ['music', 'music-layer'].includes(role) ? 'music' : 'recording', episodeId);
        await onUpload(imported, role); setSource(imported.id);
      }
      setMessage(`${files.length} ${files.length === 1 ? 'file uploaded' : 'files uploaded'}${role === 'library' ? ' to this episode’s recordings' : ' and added to this episode'}.`);
    });
  };
  return <section className="card fields"><div><p className="eyebrow">This episode</p><h3>Episode recordings</h3><p className="small muted">Upload audio for this episode, then add it to a track. Save the clips you want to reuse in a reusable library folder. WAV, MP3, M4A, OGG, FLAC, and WebM, up to 512 MB per file.</p></div>
    <label>Add as<select className="field" aria-label="Add as" value={role} disabled={working || disabled} onChange={e => setRole(e.target.value)}>{clipRoles.map(value => <option key={value} value={value === 'music' ? 'music-layer' : value}>{roleLabels[value]}</option>)}<option value="music">Background music (looping bed)</option><option value="library">Keep in episode only</option></select></label>
    <input ref={file} type="file" accept="audio/*,.m4a,.flac,.ogg,.wav,.mp3,.webm" multiple hidden onChange={upload} />
    <button className="btn primary" disabled={disabled || working} onClick={() => file.current.click()}>{working ? 'Working with your audio…' : 'Upload audio files'}</button>
    <label>Episode recordings<select className="field" aria-label="Episode recordings" disabled={working || disabled} value={source} onChange={e => { setSource(e.target.value); setMessage(''); }}><option value="">{role === 'music' ? 'Choose a background music track' : 'Choose a recording or music track'}</option>{choices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {asset && <><div className="draggable-library-source" draggable={!disabled && !working} onDragStart={event => {
      event.dataTransfer.setData('application/x-godly-audio', JSON.stringify({ assetId: asset.id, role: role === 'music' ? 'music-bed' : role }));
      event.dataTransfer.effectAllowed = 'copy';
    }}><GripVertical size={18} /><Music2 size={20} /><div><strong>{asset.name}</strong><span>{formatTime(asset.duration)} · Drag onto a timeline track</span></div></div><label>Audio type<select className="field" aria-label="Audio type" value={asset.category || 'recording'} disabled={disabled || working} onChange={e => { const category = e.target.value; perform(async () => {
      const updated = await api(`/api/studio-tools/assets/${asset.id}`, { method: 'PATCH', body: { category } });
      onRename(updated); setMessage('Audio type saved.');
    }); }}><option value="recording">Recording</option><option value="music">Background music</option></select></label><audio controls preload="none" src={asset.url} aria-label="Library recording preview" /><label>Recording name<input className="field" maxLength={200} value={name} disabled={disabled || working} onChange={e => setName(e.target.value)} /></label><button className="btn" disabled={disabled || working || !name.trim() || name.trim() === asset.name} onClick={() => perform(async () => {
      const updated = await api(`/api/studio-tools/assets/${asset.id}`, { method: 'PATCH', body: { name: name.trim() } });
      onRename(updated); setMessage('Recording renamed. Timeline clips and saved library clips keep their own names.');
    })}>Rename recording</button></>}
    <button className="btn" disabled={disabled || working || !asset || role === 'library'} onClick={() => perform(async () => { await onAdd(asset, role); })}>{role === 'music' ? 'Use as background music' : 'Add clip to episode'}</button>
    {error && <p className="message error" role="alert">{error}</p>}{message && <p className="message" role="status">{message}</p>}
    <p className="small muted">The Add button inserts intros first, outros last, and program clips after your selection. Layers start alongside the selected clip. Drag onto a track to choose your own timing. Recordings stay with this episode. Save a clip to the reusable library to use it in other episodes.</p>
  </section>;
}
