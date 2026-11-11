import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, LogOut, ArrowLeft, Plus, Radio, Upload, ArrowUp, ArrowDown, Trash2, Scissors, Check, Download, RefreshCw, Save, Headphones } from 'lucide-react';
import { api, uploadAudio } from './api.js';
import Recorder, { downloadBlob, formatTime } from './Recorder.jsx';
import { recoveries, recoveryBlob, removeRecovery } from './recovery.js';
import Logo from './Logo.jsx';
import AdminPanel from './AdminPanel.jsx';
import ClipEditor from './ClipEditor.jsx';
import ClipLibrary from './ClipLibrary.jsx';
import EpisodeAssistant from './EpisodeAssistant.jsx';
import Login from './AccountAccess.jsx';
import { PodcasterRequest } from './UserAdmin.jsx';
import ChannelManager from './ChannelManager.jsx';

export function Brand() { return <div className="studio-brand"><Logo /><span className="badge">Studio</span></div>; }
const length = ep => ep.arrangement.segments.reduce((n, s) => n + s.end - s.start, 0);
const clone = value => structuredClone(value);


function ChangePassword({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState(''), [newPassword, setNewPassword] = useState(''), [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try { await api('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword, confirmPassword } }); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setSaved(true); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  return <section className="card password-card"><div className="row between"><div><h2>Change password</h2><p className="small muted">Use at least 12 characters. Changing it signs out your other devices.</p></div><button className="btn ghost" type="button" onClick={onClose}>Close</button></div><form className="fields" onSubmit={submit}><label>Current password<input className="field" aria-label="Current password" type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required /></label><label>New password<input className="field" aria-label="New password" type="password" autoComplete="new-password" minLength="12" maxLength="200" value={newPassword} onChange={e => setNewPassword(e.target.value)} required /></label><label>Confirm new password<input className="field" aria-label="Confirm new password" type="password" autoComplete="new-password" minLength="12" maxLength="200" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required /></label>{error && <p className="message error" role="alert">{error}</p>}{saved && <p className="message" role="status">Password changed. Your other devices have been signed out.</p>}<button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></form></section>;
}

export default function Studio() {
  const [auth, setAuth] = useState(undefined), [episodes, setEpisodes] = useState([]), [assets, setAssets] = useState([]);
  const [area, setArea] = useState(location.pathname === '/admin' ? 'website' : 'podcasts');
  const adminDirty = useRef(false), setAdminDirty = useCallback(value => { adminDirty.current = value; }, []);
  const [draft, setDraft] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [recording, setRecording] = useState(false);
  const [dirty, setDirty] = useState(false), [saveState, setSaveState] = useState('Saved'), [recovery, setRecovery] = useState([]), [history, setHistory] = useState([]);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const current = useRef(null), saveQueue = useRef(Promise.resolve()), dirtyRef = useRef(false), savingCount = useRef(0), deletingId = useRef(null);
  const setRecordingStable = useCallback(value => setRecording(value), []);
  const refreshRecovery = useCallback(async () => { if (auth?.user) { try { setRecovery(await recoveries(auth.user.id)); } catch { setError('This browser cannot open recording recovery storage. Imported audio remains available.'); } } }, [auth]);
  const load = async () => {
    if (auth?.user.role === 'member') return;
    const [eps, sources] = await Promise.all([api('/api/episodes'), api('/api/assets')]);
    setEpisodes(eps); setAssets(sources);
  };
  useEffect(() => { api('/api/auth/me').then(setAuth).catch(error => { setAuth(null); if (error.status !== 401) setError(error.message); }); }, []);
  useEffect(() => { if (auth) { load().catch(e => setError(e.message)); refreshRecovery(); } }, [auth]);
  useEffect(() => {
    const warn = event => { if (recording || dirtyRef.current || savingCount.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [recording]);

  const select = ep => {
    if (recording) return setError('Stop the recording before leaving this episode.');
    if (dirtyRef.current || savingCount.current) return setError('Save your current changes before switching episodes.');
    current.current = ep ? clone(ep) : null; setDraft(current.current); setHistory([]); setSaveState('Saved'); setError('');
  };
  const change = next => {
    const previous = current.current;
    if (!previous || deletingId.current === previous.id) return;
    const value = typeof next === 'function' ? next(clone(previous)) : next;
    setHistory(h => [...h.slice(-29), clone(previous)]);
    current.current = value; setDraft(value); dirtyRef.current = true; setDirty(true); setSaveState('Unsaved changes');
  };
  const save = useCallback(() => {
    savingCount.current++;
    const task = saveQueue.current.catch(() => {}).then(async () => {
      if (!current.current || !dirtyRef.current || deletingId.current === current.current.id) return current.current;
      const snapshot = clone(current.current); setSaveState('Saving…');
      try {
        const result = await api(`/api/episodes/${snapshot.id}`, { method: 'PUT', body: { version: snapshot.version, title: snapshot.title, description: snapshot.description, number: snapshot.number, seriesId: snapshot.seriesId || null, arrangement: snapshot.arrangement } });
        if (current.current?.id === result.id) {
          const unchanged = JSON.stringify(current.current) === JSON.stringify(snapshot);
          current.current = unchanged ? { ...result, publication: snapshot.publication } : { ...current.current, version: result.version };
          setDraft(current.current); dirtyRef.current = !unchanged; setDirty(!unchanged); setSaveState(unchanged ? 'Saved just now' : 'Unsaved changes');
        }
        setEpisodes(list => list.map(e => e.id === result.id ? { ...result, publication: e.publication } : e));
        return result;
      } catch (error) { setSaveState('Could not save'); setError(error.message); throw error; }
    });
    saveQueue.current = task;
    task.finally(() => savingCount.current--).catch(() => {});
    return task;
  }, []);
  useEffect(() => {
    if (!dirty || !draft) return;
    const timer = setTimeout(() => save().catch(() => {}), 1200);
    return () => clearTimeout(timer);
  }, [draft, dirty, save]);
  const action = async fn => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const changeArea = next => {
    if (next === area || busy || recording) return;
    if (dirtyRef.current || savingCount.current) return setError('Wait for your podcast changes to finish saving before switching sections.');
    if (adminDirty.current && !confirm('Discard the website changes you haven’t saved?')) return;
    adminDirty.current = false; setArea(next); setError('');
  };
  const deleteEpisode = ep => {
    if (busy || recording) return;
    if (!confirm(`Delete “${ep.title}”?\n\nThis permanently removes the episode, its edits and render history from the studio, website, and RSS feed. Original audio files stay in your library.\n\nThis cannot be undone.`)) return;
    action(async () => {
      deletingId.current = ep.id;
      try {
        await saveQueue.current.catch(() => {});
        await api(`/api/episodes/${ep.id}`, { method: 'DELETE' });
        setError('');
        setEpisodes(list => list.filter(item => item.id !== ep.id));
        if (current.current?.id === ep.id) {
          current.current = null; setDraft(null); dirtyRef.current = false;
          setDirty(false); setHistory([]); setSaveState('Saved');
        }
      } finally { deletingId.current = null; }
    });
  };
  const addAsset = async (asset, { libraryOnly = false } = {}) => {
    setAssets(list => [asset, ...list.filter(a => a.id !== asset.id)]);
    if (libraryOnly) return;
    change(ep => ({ ...ep, arrangement: { ...ep.arrangement, segments: [...ep.arrangement.segments, { id: crypto.randomUUID(), assetId: asset.id, name: asset.name.startsWith("Take ") ? `Take ${ep.arrangement.segments.length + 1}` : asset.name, start: 0, end: asset.duration, gain: 1, fadeIn: 0, fadeOut: 0 }] } }));
    await save();
  };
  const restore = session => action(async () => {
    if (dirtyRef.current) await save();
    const latest = await api('/api/episodes');
    const ep = latest.find(e => e.id === session.episodeId);
    if (!ep) throw new Error('The original episode is unavailable. Download the recording backup instead.');
    if (session.assetId && ep.arrangement.segments.some(s => s.assetId === session.assetId)) {
      await removeRecovery(session.id); await refreshRecovery(); return;
    }
    const blob = await recoveryBlob(session);
    if (!blob.size) throw new Error('No audio chunks were captured. You can remove this empty recovery.');
    const asset = (session.assetId ? (await api('/api/assets')).find(a => a.id === session.assetId) : null) || await uploadAudio(blob, `Recovered take.${session.mime.includes('mp4') ? 'm4a' : session.mime.includes('ogg') ? 'ogg' : 'webm'}`);
    current.current = clone(ep); setDraft(current.current);
    await addAsset(asset); await removeRecovery(session.id); await refreshRecovery();
  });
  if (auth === undefined) return <main className="studio"><div className="studio-main"><p role="status">Opening your studio…</p></div></main>;
  if (!auth) return <div className="studio">{error && <p className="message error" role="alert">{error}</p>}<Login onLogin={setAuth} /></div>;
  if (auth.user.role === 'member') return <div className="login-shell"><Brand /><section className="card"><h1>Your account</h1><p className="muted">Signed in as {auth.user.email}</p><p>Welcome to the Godly Homes community.</p><div className="account-actions"><a className="btn primary" href="/">Explore Godly Homes</a><button className="btn" onClick={() => setPasswordOpen(open => !open)}>Change password</button><button className="btn ghost" onClick={() => action(async () => { await api('/api/auth/logout', { method: 'POST' }); setAuth(null); })}>Sign out</button></div>{error && <p className="message error" role="alert">{error}</p>}</section><PodcasterRequest />{passwordOpen && <ChangePassword onClose={() => setPasswordOpen(false)} />}</div>;
  return <div className="studio"><header className="studio-header"><div className="studio-header-inner"><Brand />{['admin', 'junior_admin'].includes(auth.user.role) && <nav className="account-nav" aria-label="Account area"><button className={`btn ${area === 'podcasts' ? 'primary' : ''}`} aria-current={area === 'podcasts' ? 'page' : undefined} disabled={busy || recording} onClick={() => changeArea('podcasts')}>Podcasts</button><button className={`btn ${area === 'website' ? 'primary' : ''}`} aria-current={area === 'website' ? 'page' : undefined} disabled={busy || recording} onClick={() => changeArea('website')}>Website Admin</button></nav>}{!['admin', 'junior_admin'].includes(auth.user.role) && <button className={`btn ${area === 'podcasts' ? 'primary' : ''}`} disabled={busy || recording} onClick={() => changeArea('podcasts')}>Podcasts</button>}<button className={`btn ${area === 'channel' ? 'primary' : ''}`} aria-current={area === 'channel' ? 'page' : undefined} disabled={busy || recording} onClick={() => changeArea('channel')}>My channel</button><div className="header-spacer" /><span className="user-email small muted">{auth.user.email}</span><button className="btn ghost" type="button" disabled={busy || recording} onClick={() => setPasswordOpen(open => !open)}>Password</button><button className="btn icon" aria-label="Sign out" disabled={busy || recording || dirty} onClick={() => { if (adminDirty.current && !confirm('Discard the website changes you haven’t saved and sign out?')) return; action(async () => { await api('/api/auth/logout', { method: 'POST' }); setAuth(null); current.current = null; setDraft(null); setEpisodes([]); setAssets([]); adminDirty.current = false; }) }}><LogOut size={17} /></button></div></header><main className="studio-main">
    {error && <div className="message error" role="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    {passwordOpen && <ChangePassword onClose={() => setPasswordOpen(false)} />}
    {area === 'channel' ? <ChannelManager onDirty={setAdminDirty} /> : area === 'website' ? ['admin', 'junior_admin'].includes(auth.user.role) ? <AdminPanel currentUser={auth.user} onDirtyChange={setAdminDirty} /> : <div className="card"><h1>Website Admin</h1><p>Your account has podcast access. Website administrator access is required to edit the website.</p><button className="btn" onClick={() => changeArea('podcasts')}>Back to podcasts</button></div> : <>
    {recovery.length > 0 && !recording && <section className="card" style={{ marginBottom: 24 }}><h2>Recover recordings</h2><p className="small muted">These takes are backed up on this device. Restore one to its original episode or download a copy.</p>{recovery.map(s => <div className="row between" style={{ marginTop: 12 }} key={s.id}><span className="small">{new Date(s.createdAt).toLocaleString()}</span><div className="row"><button className="btn" disabled={busy} onClick={() => restore(s)}><RefreshCw size={14} />Restore</button><button className="btn icon" aria-label="Download recovery" onClick={() => action(async () => downloadBlob(await recoveryBlob(s), `recording-backup.${s.mime.includes('mp4') ? 'm4a' : s.mime.includes('ogg') ? 'ogg' : 'webm'}`))}><Download size={15} /></button><button className="btn icon danger" aria-label="Discard recovery" onClick={() => { if (confirm('Permanently remove this local backup? Download it first if you need a copy.')) action(async () => { await removeRecovery(s.id); await refreshRecovery(); }); }}><Trash2 size={15} /></button></div></div>)}</section>}
    {!draft ? <><div className="row between"><div><p className="eyebrow">Godly Homes Podcast</p><h1>Your voice has a home.</h1><p className="muted">A little preparation. A good conversation. Something worth sharing.</p></div><button className="btn accent" disabled={busy} onClick={() => action(async () => { const ep = await api('/api/episodes', { method: 'POST' }); setEpisodes(list => [ep, ...list]); select(ep); })}><Plus size={17} />New episode</button></div><div className="cards">{episodes.length ? episodes.map(ep => <article className="card episode-card" key={ep.id}><button className="episode-open" disabled={busy} onClick={() => select(ep)}><span className="episode-icon"><Radio size={22} /></span><div style={{ flex: 1 }}><h2>{ep.title}</h2><span className="muted small">{ep.arrangement.segments.length} segments · {formatTime(length(ep))} · {new Date(ep.updatedAt).toLocaleDateString()}</span></div></button><span className={`badge ${ep.publication ? '' : 'draft'}`}>{ep.adminHidden ? 'Hidden by admin' : ep.publication ? 'Published' : 'Draft'}</span><button className="btn icon danger" aria-label={`Delete episode ${ep.title}`} title="Delete episode" disabled={busy} onClick={() => deleteEpisode(ep)}><Trash2 size={17} /></button></article>) : <div className="card empty"><Mic size={32} style={{ margin: '0 auto 20px', color: '#76866b' }} /><h2>Your first episode starts here.</h2><p className="muted small">Create an episode, check your microphone, and record your first take.</p></div>}</div></> : <>
      <button className="btn ghost" disabled={recording || busy || dirty} onClick={() => select(null)}><ArrowLeft size={15} />All episodes</button>
      <div className="row between" style={{ marginTop: 18 }}><div><p className="eyebrow">Your recording suite</p><h1>{draft.title}</h1><p className="small muted">{draft.arrangement.segments.length} segments · {formatTime(length(draft))} · <span role="status">{saveState}</span></p></div><div className="row"><button className="btn danger" disabled={busy || recording} onClick={() => deleteEpisode(draft)}><Trash2 size={15} />Delete episode</button><button className="btn" disabled={!history.length || recording || busy} onClick={() => { const previous = history[history.length - 1]; setHistory(h => h.slice(0, -1)); current.current = { ...previous, version: current.current.version }; setDraft(current.current); dirtyRef.current = true; setDirty(true); setSaveState('Unsaved changes'); }}>Undo</button><button className="btn" disabled={!dirty || busy || recording} onClick={() => action(save)}><Save size={15} />Save changes</button></div></div>
      {draft.adminHidden && <p className="message" role="status">An administrator has hidden this episode. It remains private when you publish updates until an administrator restores visibility.</p>}
      <Workspace key={draft.id} draft={draft} assets={assets} change={change} save={save} busy={busy} action={action} addAsset={addAsset} onProcessingChange={setBusy} onAssetRenamed={asset => setAssets(list => list.map(item => item.id === asset.id ? asset : item))} recording={recording} setRecording={setRecordingStable} userId={auth.user.id} onRecovery={refreshRecovery} onPublished={async publication => { current.current = { ...current.current, publication }; setDraft(current.current); await load(); }} />
    </>}
    </>}
  </main></div>;
}

function Workspace({ draft, assets, change, save, busy, action, addAsset, onProcessingChange, onAssetRenamed, recording, setRecording, userId, onRecovery, onPublished }) {
  const [tab, setTab] = useState('record'), [selected, updateSelected] = useState(null);
  const selectedRef = useRef(null);
  const setSelected = value => { selectedRef.current = value; updateSelected(value); };
  const file = useRef(), musicFile = useRef();
  const segment = draft.arrangement.segments.find(s => s.id === selected);
  const importAudio = event => {
    const f = event.target.files?.[0]; event.target.value = ''; if (!f) return;
    action(async () => { await addAsset(await uploadAudio(f, f.name)); });
  };
  const editSegments = fn => change(ep => ({ ...ep, arrangement: { ...ep.arrangement, segments: fn(ep.arrangement.segments) } }));
  const music = value => change(ep => ({ ...ep, arrangement: { ...ep.arrangement, music: { ...ep.arrangement.music, ...value } } }));
  const addLibraryClip = (asset, role) => {
    if (role === 'music') { music({ assetId: asset.id, volume: .12, duck: true }); return; }
    const clip = { id: crypto.randomUUID(), assetId: asset.id, name: asset.name, role, start: 0, end: role === 'transition' ? Math.min(5, asset.duration) : asset.duration, gain: 1, fadeIn: role === 'transition' ? .5 : 0, fadeOut: role === 'transition' ? .5 : 0 };
    editSegments(list => { if (list.length >= 200) throw new Error('Episodes can contain up to 200 clips. Remove a clip before adding another.'); const next = [...list]; const anchor = selectedRef.current; const position = role === 'intro' ? 0 : role === 'closing' ? list.length : anchor ? list.findIndex(item => item.id === anchor) + 1 : list.findIndex(item => item.role === 'closing'); next.splice(position < 0 ? next.length : position, 0, clip); return next; });
    setSelected(clip.id);
  };
  return <>
    <div className="tabs" role="tablist" aria-label="Episode workflow" style={{ marginTop: 22 }}>{[['record', '1. Record'], ['edit', '2. Arrange & edit'], ['publish', '3. Review & publish']].map(([id, title]) => <button key={id} role="tab" aria-selected={tab === id} disabled={recording || busy} onClick={() => setTab(id)}>{title}</button>)}</div>
    {tab === 'record' && <div className="workspace"><div className="stack"><Recorder userId={userId} episodeId={draft.id} onAsset={addAsset} onBusy={setRecording} onRecovery={onRecovery} /><div className="card row between"><div><h3 style={{ marginBottom: 5 }}>Already have a recording?</h3><p className="small muted" style={{ marginBottom: 0 }}>Import audio up to 512 MB and two hours.</p></div><input ref={file} type="file" accept="audio/*" hidden onChange={importAudio} /><button className="btn" disabled={busy || recording} onClick={() => file.current.click()}><Upload size={15} />Import audio</button></div></div><div className="stack"><section className="card" style={{ background: '#e9eddf' }}><p className="eyebrow">Before you begin</p><h2>Make a little room<br />for your voice.</h2><ol className="steps"><li><span className="step-num">1</span><div><strong>Find a quiet corner</strong><br /><span className="muted">Use headphones and place your microphone a hand’s width away.</span></div></li><li><span className="step-num">2</span><div><strong>Make a short test take</strong><br /><span className="muted">Record a few words, stop, and listen in Arrange & edit.</span></div></li><li><span className="step-num">3</span><div><strong>Record in comfortable sections</strong><br /><span className="muted">Pause whenever you need. You can trim and reorder takes later.</span></div></li></ol></section><section className="card"><h2>Your takes</h2><p className="muted small">{draft.arrangement.segments.length ? `${draft.arrangement.segments.length} segments ready to arrange.` : 'Each saved take will appear here.'}</p>{draft.arrangement.segments.map(s => <p key={s.id} className="row small"><Check size={14} color="#55644c" />{s.name} <span className="muted">{formatTime(s.end - s.start)}</span></p>)}<button className="btn" disabled={!draft.arrangement.segments.length || recording} onClick={() => setTab('edit')}>Arrange your episode →</button></section></div></div>}
    {tab === 'edit' && <div className="workspace"><section className="card"><div className="row between"><h2>Make it your own.</h2><span className="badge">{formatTime(length(draft))}</span></div><p className="small muted">Select a segment to trim or split it. Your original recordings stay intact.</p>{!draft.arrangement.segments.length && <p className="message">Record or import a take to begin.</p>}{draft.arrangement.segments.map((s, index) => <div className={`segment ${s.id === selected ? 'selected' : ''}`} key={s.id}><div className="segment-head"><button className="segment-name" onClick={() => setSelected(s.id)}><strong>{s.name}</strong><span className="badge">{s.role || 'segment'}</span><span className="muted small">{formatTime(s.end - s.start)} · {Math.round(s.gain * 100)}%</span></button><div className="segment-controls">{[-1, 1].map(direction => <button className="btn icon" key={direction} aria-label={direction === -1 ? 'Move segment up' : 'Move segment down'} disabled={index + direction < 0 || index + direction >= draft.arrangement.segments.length} onClick={() => editSegments(list => { const result = [...list]; [result[index], result[index + direction]] = [result[index + direction], result[index]]; return result; })}>{direction === -1 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}</button>)}<button className="btn icon danger" aria-label="Delete segment" onClick={() => editSegments(list => list.filter(item => item.id !== s.id))}><Trash2 size={14} /></button></div></div></div>)}<section style={{ marginTop: 30 }}><h3>Music underneath</h3><label>Music source<select className="field" value={draft.arrangement.music.assetId || ''} onChange={e => music({ assetId: e.target.value || null })}><option value="">No background music</option>{assets.filter(a => a.category === 'music').map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label><p className="small muted" style={{ marginTop: 8 }}>Use music you have permission to publish. It loops to fit your episode.</p><input ref={musicFile} type="file" accept="audio/*" hidden onChange={event => { const f = event.target.files?.[0]; event.target.value = ''; if (f) action(async () => { const a = await uploadAudio(f, f.name, 'music'); await addAsset(a, { libraryOnly: true }); music({ assetId: a.id }); await save(); }); }} /><button className="btn" disabled={busy} onClick={() => musicFile.current.click()}><Upload size={14} />Upload music</button>{draft.arrangement.music.assetId && <div className="edit-grid"><label>Music volume: {Math.round(draft.arrangement.music.volume * 100)}%<input type="range" min="0" max="1" step="0.01" value={draft.arrangement.music.volume} onChange={e => music({ volume: +e.target.value })} /></label><label className="row"><input type="checkbox" checked={draft.arrangement.music.duck} onChange={e => music({ duck: e.target.checked })} />Lower under voice</label></div>}</section></section><div className="stack">{segment ? <ClipEditor key={segment.id} segment={segment} disabled={busy} onBusy={onProcessingChange} maxClips={201 - draft.arrangement.segments.length} asset={assets.find(a => a.id === segment.assetId)} onCut={clips => { if (draft.arrangement.segments.length - 1 + clips.length > 200) throw new Error('Episodes can contain up to 200 clips. Try a longer minimum pause.'); editSegments(list => list.flatMap(item => item.id === segment.id ? clips : [item])); setSelected(clips[0]?.id || null); }} onChange={value => editSegments(list => list.map(s => s.id === value.id ? value : s))} onSplit={at => editSegments(list => list.flatMap(s => s.id === segment.id ? [{ ...s, end: at, fadeOut: 0 }, { ...s, id: crypto.randomUUID(), name: `${s.name} (2)`, start: at, fadeIn: 0 }] : [s]))} /> : <section className="card empty"><Scissors size={28} style={{ margin: '0 auto 20px', color: '#76866b' }} /><h2>Every take has potential.</h2><p className="small muted">Select a segment to listen and refine it.</p></section>}<ClipLibrary assets={assets} onAdd={addLibraryClip} onUpload={async (asset, role) => { await addAsset(asset, { libraryOnly: true }); if (role !== 'library') { addLibraryClip(asset, role); await save(); } }} onRename={onAssetRenamed} onBusy={onProcessingChange} disabled={busy} /><EpisodeAssistant draft={draft} onSaveScript={introDraft => change(ep => ({ ...ep, arrangement: { ...ep.arrangement, introDraft } }))} onMix={arrangement => change(ep => ({ ...ep, arrangement }))} onGenerated={asset => addAsset(asset, { libraryOnly: true })} onAdd={addLibraryClip} onBusy={onProcessingChange} disabled={busy} /><button className="btn primary" onClick={() => setTab('publish')} disabled={busy || !draft.arrangement.segments.length}>Review & publish →</button></div></div>}
    {tab === 'publish' && <Publish draft={draft} change={change} save={save} busy={busy} action={action} onPublished={onPublished} />}
  </>;
}

function Publish({ draft, change, save, busy, action, onPublished }) {
  const [series, setSeries] = useState([]), [seriesError, setSeriesError] = useState('');
  useEffect(() => { api('/api/channel').then(result => setSeries(result.series)).catch(error => setSeriesError(error.message)); }, []);
  const [jobs, setJobs] = useState([]), [error, setError] = useState(''), [reviewed, setReviewed] = useState(false);
  const reload = () => api(`/api/episodes/${draft.id}/jobs`).then(setJobs).catch(e => setError(e.message));
  useEffect(() => { reload(); const timer = setInterval(reload, 3000); return () => clearInterval(timer); }, [draft.id]);
  const job = jobs.find(j => j.revision === draft.version), ready = job?.state === 'ready';
  useEffect(() => setReviewed(false), [job?.id, draft.version]);
  return <div className="workspace"><section className="card"><p className="eyebrow">Give your episode a home</p><h2>The finishing touches.</h2><div className="fields"><label>Podcast series<select className="field" aria-label="Podcast series" value={draft.seriesId || ''} onChange={e => change(ep => ({ ...ep, seriesId: e.target.value || null }))}><option value="">Standalone episode</option>{series.map(item => <option key={item.id} value={item.id}>{item.data.title}</option>)}</select></label>{seriesError && <p className="message error" role="alert">{seriesError}</p>}<p className="small muted">Create and manage your series in My channel. Changing a published episode’s series takes effect when you render and publish it again.</p><label>Episode title<input className="field" maxLength={200} required value={draft.title} onChange={e => change(ep => ({ ...ep, title: e.target.value }))} /></label><label>Episode number<input className="field" type="number" min="1" max="100000" value={draft.number} onChange={e => change(ep => ({ ...ep, number: +e.target.value }))} /></label><label>Description & show notes<textarea className="field" rows="8" maxLength={20000} value={draft.description} onChange={e => change(ep => ({ ...ep, description: e.target.value }))} placeholder="What will listeners take away? Add scripture references and links mentioned." /></label></div><button className="btn primary" style={{ marginTop: 24 }} disabled={busy || !draft.arrangement.segments.length || ['queued', 'running'].includes(job?.state)} onClick={() => action(async () => { await save(); await api(`/api/episodes/${draft.id}/render`, { method: 'POST' }); await reload(); })}><Headphones size={16} />{job?.state === 'queued' ? 'Waiting for audio worker…' : job?.state === 'running' ? 'Rendering your episode…' : job?.state === 'failed' ? 'Retry audio render' : 'Render episode audio'}</button><p className="small muted" style={{ marginTop: 14 }}>Your draft stays private while the server mixes and prepares an MP3. You can leave and return to check progress.</p>{(error || job?.error) && <p className="message error" role="alert">{error || job.error}</p>}</section><div className="stack"><section className="card" style={{ background: '#e9eddf' }}><p className="eyebrow">Listen before you share</p><h2>{ready ? 'Ready for your ears.' : 'One more listen.'}</h2>{ready ? <><audio controls src={job.url} /><a className="btn" style={{ marginTop: 14 }} href={job.url} download="godly-homes-episode.mp3"><Download size={14} />Download MP3</a><label className="row" style={{ marginTop: 22 }}><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I’ve reviewed this audio and its details.</label><button className="btn accent" style={{ marginTop: 20 }} disabled={!reviewed || busy} onClick={() => action(async () => { await save(); await api(`/api/episodes/${draft.id}/publish`, { method: 'POST', body: { jobId: job.id } }); await onPublished({ episode_id: draft.id, job_id: job.id }); })}><Radio size={15} />{draft.publication ? 'Update published episode' : 'Publish episode'}</button></> : <p className="small muted">Render your saved draft, listen to the result, and publish when you’re happy with it.</p>}</section>{draft.publication && <section className="card"><span className="badge">{draft.adminHidden ? 'Hidden by admin' : 'Published'}</span><h2 style={{ marginTop: 18 }}>{draft.adminHidden ? 'Your publication is hidden.' : 'Your episode is published.'}</h2><p className="small muted">Draft edits stay private until you render, review, and publish again.</p><div className="row"><a className="btn" href={`/podcast/${draft.id}`}>View episode</a><a className="btn" href="/podcast/feed.xml">RSS feed</a><button className="btn danger" disabled={busy} onClick={() => { if (confirm('Remove this episode from the public website and RSS feed?')) action(async () => { await api(`/api/episodes/${draft.id}/unpublish`, { method: 'POST' }); await onPublished(null); }); }}>Unpublish</button></div></section>}</div></div>;
}
