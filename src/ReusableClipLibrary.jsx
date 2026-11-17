import { useEffect, useState } from 'react';
import { FolderOpen, FolderPlus, GripVertical, RefreshCw, Save, Trash2 } from 'lucide-react';
import { api } from './api.js';
import { clipFromSource, libraryClipData } from '../shared/audio-library.js';
import { roleLabels } from '../shared/podcast-editing.js';
import { formatTime } from '../shared/audio-time.js';

export default function ReusableClipLibrary({ library, selectedClip, episodeAssets, onRefresh, onAdd, onBusy, disabled, error: loadError }) {
  const [folder, setFolder] = useState('all'), [saveFolder, setSaveFolder] = useState(''), [newFolder, setNewFolder] = useState('');
  const [choice, setChoice] = useState('selected'), [name, setName] = useState(''), [query, setQuery] = useState(''), [folderName, setFolderName] = useState('');
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const source = episodeAssets.find(asset => asset.id === choice);
  const candidate = choice === 'selected' ? selectedClip : source ? clipFromSource(source, source.category === 'music' ? 'music' : 'segment') : null;
  const activeFolder = library.folders.find(item => item.id === folder);
  const clips = library.clips.filter(item => (folder === 'all' || (folder === 'unfiled' ? !item.folderId : item.folderId === folder)) && item.name.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => { setChoice('selected'); }, [selectedClip?.id]);
  useEffect(() => { setName(candidate?.name || ''); }, [choice, candidate?.name]);
  useEffect(() => { setFolderName(activeFolder?.name || ''); }, [activeFolder?.id, activeFolder?.name]);
  useEffect(() => { if (saveFolder && !library.folders.some(item => item.id === saveFolder)) setSaveFolder(''); }, [saveFolder, library.folders]);
  const perform = async fn => {
    setWorking(true); onBusy?.(true); setError(''); setMessage('');
    try { await fn(); } catch (error) { setError(error.message); }
    finally { setWorking(false); onBusy?.(false); }
  };
  const refresh = async () => { await onRefresh(); };
  return <section className="card reusable-library fields" aria-label="Reusable clip library">
    <div className="row between"><div><p className="eyebrow">Across your episodes</p><h2><FolderOpen size={22} />Reusable clip library</h2></div><button className="btn icon" aria-label="Refresh clip library" disabled={disabled || working} onClick={() => perform(refresh)}><RefreshCw size={15} /></button></div>
    <p className="small muted">Recordings stay with their episode. Save a selected edit or a full recording here to reuse it in another episode. Trim points, role, volume, and fades are included.</p>
    <fieldset className="fields library-save-form" disabled={disabled || working || Boolean(loadError)}><legend>Save audio for reuse</legend>
      <label>Audio to save<select className="field" value={choice} onChange={event => setChoice(event.target.value)}><option value="selected">{selectedClip ? `Selected clip: ${selectedClip.name}` : 'Select a timeline clip, or choose a recording'}</option>{episodeAssets.map(asset => <option key={asset.id} value={asset.id}>Full recording: {asset.name}</option>)}</select></label>
      {candidate && <p className="small muted library-clip-details">{roleLabels[candidate.role || 'segment']} · source {candidate.start.toFixed(2)}–{candidate.end.toFixed(2)} seconds · {Math.round(candidate.gain * 100)}% volume</p>}
      <label>Library clip name<input className="field" maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>Save to folder<select className="field" value={saveFolder} onChange={event => setSaveFolder(event.target.value)}><option value="">Unfiled</option>{library.folders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button className="btn primary" disabled={!candidate || !name.trim()} onClick={() => perform(async () => {
        await api('/api/audio-library/clips', { method: 'POST', body: libraryClipData(candidate, saveFolder, name.trim()) });
        await refresh(); setFolder(saveFolder || 'unfiled'); setQuery('');
        setMessage(`Saved “${name.trim()}” to ${library.folders.find(item => item.id === saveFolder)?.name || 'Unfiled'}. The episode clip stays as arranged.`);
      })}><Save size={15} />Save clip to library</button>
    </fieldset>
    <div className="library-new-folder"><label>New library folder<input className="field" placeholder="Intros, transitions, promos…" maxLength={80} value={newFolder} disabled={disabled || working || Boolean(loadError)} onChange={event => setNewFolder(event.target.value)} /></label><button className="btn" disabled={disabled || working || Boolean(loadError) || !newFolder.trim()} onClick={() => perform(async () => {
      const created = await api('/api/audio-library/folders', { method: 'POST', body: { name: newFolder.trim() } });
      await refresh(); setSaveFolder(created.id); setFolder(created.id); setNewFolder(''); setMessage('Folder created. Save a clip into it below.');
    })}><FolderPlus size={15} />Create folder</button></div>
    <div className="library-folder-nav" aria-label="Library folders"><button aria-pressed={folder === 'all'} onClick={() => setFolder('all')}>All clips <span>{library.clips.length}</span></button><button aria-pressed={folder === 'unfiled'} onClick={() => setFolder('unfiled')}>Unfiled <span>{library.clips.filter(item => !item.folderId).length}</span></button>{library.folders.map(item => <button key={item.id} aria-pressed={folder === item.id} onClick={() => setFolder(item.id)}><FolderOpen size={13} />{item.name} <span>{item.count}</span></button>)}</div>
    {activeFolder && <details className="library-folder-settings"><summary>Manage {activeFolder.name}</summary><div className="fields"><label>Folder name<input className="field" maxLength={80} value={folderName} disabled={disabled || working} onChange={event => setFolderName(event.target.value)} /></label><div className="row"><button className="btn" disabled={disabled || working || !folderName.trim() || folderName.trim() === activeFolder.name} onClick={() => perform(async () => {
      await api(`/api/audio-library/folders/${activeFolder.id}`, { method: 'PATCH', body: { name: folderName.trim() } }); await refresh(); setMessage('Folder renamed.');
    })}>Rename folder</button><button className="btn danger" disabled={disabled || working || activeFolder.count > 0} onClick={() => perform(async () => {
      await api(`/api/audio-library/folders/${activeFolder.id}`, { method: 'DELETE' }); await refresh(); setFolder('all'); setMessage('Empty folder removed.');
    })}>Delete empty folder</button></div>{activeFolder.count > 0 && <p className="small muted">Move or remove the saved clips to empty this folder before deleting it.</p>}</div></details>}
    <label>Search saved clips<input className="field" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find an intro, music cue, promo…" /></label>
    <div className="saved-library-clips">{clips.length ? clips.map(item => <SavedClip key={item.id} clip={item} folders={library.folders} disabled={disabled || working} onAdd={() => perform(async () => { await onAdd(item); setMessage(`Added “${item.name}” to this episode. Its library copy stays unchanged.`); })} onUpdate={value => perform(async () => {
      await api(`/api/audio-library/clips/${item.id}`, { method: 'PATCH', body: value }); await refresh(); setMessage('Library clip updated. Episode copies keep their own edits.');
    })} onRemove={() => {
      if (confirm(`Remove “${item.name}” from the reusable library? Episode copies and the source recording stay intact.`)) perform(async () => { await api(`/api/audio-library/clips/${item.id}`, { method: 'DELETE' }); await refresh(); setMessage('Clip removed from the reusable library. Episode copies stay intact.'); });
    }} />) : <p className="small muted library-empty">{query ? 'No saved clips match your search.' : 'No clips in this folder yet. Save an episode clip above to use it in future episodes.'}</p>}</div>
    {(error || loadError) && <p className="message error" role="alert">{error || loadError}</p>}{message && <p className="message" role="status">{message}</p>}
  </section>;
}

function SavedClip({ clip, folders, disabled, onAdd, onUpdate, onRemove }) {
  const [name, setName] = useState(clip.name);
  useEffect(() => setName(clip.name), [clip.name]);
  return <article className="saved-library-clip"><div className="saved-clip-heading" draggable={!disabled} onDragStart={event => {
    event.dataTransfer.setData('application/x-godly-audio', JSON.stringify({ assetId: clip.assetId, libraryClipId: clip.id, role: clip.role })); event.dataTransfer.effectAllowed = 'copy';
  }}><GripVertical size={17} /><div><h3>{clip.name}</h3><p>{roleLabels[clip.role]} · {formatTime(clip.end - clip.start)} · {folders.find(item => item.id === clip.folderId)?.name || 'Unfiled'}</p></div></div>
    <audio controls preload="none" src={clip.asset.url} aria-label={`Preview saved clip ${clip.name}`} onLoadedMetadata={event => { event.currentTarget.currentTime = clip.start; }} onPlay={event => { const audio = event.currentTarget; if (audio.currentTime < clip.start || audio.currentTime >= clip.end) audio.currentTime = clip.start; }} onTimeUpdate={event => { const audio = event.currentTarget; if (audio.currentTime >= clip.end) { audio.pause(); audio.currentTime = clip.start; } }} />
    <div className="row"><button className="btn primary" disabled={disabled} onClick={onAdd}>Add saved clip to episode</button><button className="btn icon danger" aria-label={`Remove saved clip ${clip.name}`} disabled={disabled} onClick={onRemove}><Trash2 size={15} /></button></div>
    <details><summary>Rename or move</summary><div className="fields"><label>Saved clip name<input className="field" aria-label={`Rename saved clip ${clip.name}`} maxLength={200} value={name} disabled={disabled} onChange={event => setName(event.target.value)} /></label><button className="btn" disabled={disabled || !name.trim() || name.trim() === clip.name} onClick={() => onUpdate({ name: name.trim() })}>Rename saved clip</button><label>Clip folder<select className="field" aria-label={`Folder for ${clip.name}`} value={clip.folderId || ''} disabled={disabled} onChange={event => onUpdate({ folderId: event.target.value || null })}><option value="">Unfiled</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label></div></details>
  </article>;
}
