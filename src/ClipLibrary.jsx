import { useEffect, useRef, useState } from 'react';
import { clipRoles } from '../shared/podcast-editing.js';
import { api, uploadAudio } from './api.js';

export default function ClipLibrary({ assets, onAdd, onUpload, onRename, onBusy, disabled }) {
  const [source, setSource] = useState(''), [role, setRole] = useState('segment'), [name, setName] = useState('');
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const file = useRef(), asset = assets.find(item => item.id === source);
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
        const imported = await uploadAudio(file, file.name);
        await onUpload(imported, role); setSource(imported.id);
      }
      setMessage(`${files.length} ${files.length === 1 ? 'file uploaded' : 'files uploaded'}${role === 'library' ? ' to your library' : ' and added to this episode'}.`);
    });
  };
  return <section className="card fields"><h3>Build your episode</h3><p className="small muted">Upload recordings, intros, transitions, and music, or reuse audio from your library. WAV, MP3, M4A, OGG, FLAC, and WebM, up to 512 MB per file.</p>
    <label>Add as<select className="field" aria-label="Add as" value={role} disabled={working || disabled} onChange={e => setRole(e.target.value)}>{clipRoles.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}<option value="music">Background music</option><option value="library">Library only</option></select></label>
    <input ref={file} type="file" accept="audio/*,.m4a,.flac,.ogg,.wav,.mp3,.webm" multiple hidden onChange={upload} />
    <button className="btn primary" disabled={disabled || working} onClick={() => file.current.click()}>{working ? 'Working with your audio…' : 'Upload audio files'}</button>
    <label>Audio library<select className="field" aria-label="Audio library" disabled={working || disabled} value={source} onChange={e => { setSource(e.target.value); setMessage(''); }}><option value="">Choose a recording or music track</option>{assets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {asset && <><audio controls preload="none" src={asset.url} aria-label="Library recording preview" /><label>Recording name<input className="field" maxLength={200} value={name} disabled={disabled || working} onChange={e => setName(e.target.value)} /></label><button className="btn" disabled={disabled || working || !name.trim() || name.trim() === asset.name} onClick={() => perform(async () => {
      const updated = await api(`/api/studio-tools/assets/${asset.id}`, { method: 'PATCH', body: { name: name.trim() } });
      onRename(updated); setMessage('Recording renamed in your library. Episode clips keep their own names.');
    })}>Rename recording</button></>}
    <button className="btn" disabled={disabled || working || !asset || role === 'library'} onClick={() => perform(async () => { await onAdd(asset, role); })}>{role === 'music' ? 'Use as background music' : 'Add clip to episode'}</button>
    {error && <p className="message error" role="alert">{error}</p>}{message && <p className="message" role="status">{message}</p>}
    <p className="small muted">Intros go first and closings go last. Transitions go after the selected clip. Background music stays underneath the episode. Uploads remain in your library if an episode edit cannot be saved.</p>
  </section>;
}
