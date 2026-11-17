import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, GripVertical, Headphones, Magnet, Music2, Pause, Play, Plus, Scissors, Search, SkipBack, Trash2, Volume2, ZoomIn } from 'lucide-react';
import { clipDuration, clipEnd, episodeDuration, roundTime, splitClip, toTimeline, trackAudible, trimClip } from '../shared/timeline.js';
import { roleLabels } from '../shared/podcast-editing.js';
import { formatTime } from '../shared/audio-time.js';
import { createTimelinePlayback } from './timeline-playback.js';

const peaksCache = new Map();
let peakQueue = Promise.resolve();
function audioPeaks(asset) {
  const key = `${asset.id}:${asset.url}`;
  if (peaksCache.has(key)) return peaksCache.get(key);
  const task = peakQueue.then(async () => {
    if (!asset.bytes || asset.bytes > 20 * 1024 * 1024 || asset.duration > 600) return null;
    let context;
    try {
      const response = await fetch(asset.url);
      if (!response.ok) return null;
      const data = await response.arrayBuffer();
      context = new AudioContext();
      const buffer = await context.decodeAudioData(data), samples = buffer.getChannelData(0), size = Math.ceil(samples.length / 600);
      const values = Array.from({ length: 600 }, (_, index) => {
        let peak = 0;
        for (let sample = index * size; sample < Math.min(samples.length, (index + 1) * size); sample += 8) peak = Math.max(peak, Math.abs(samples[sample]));
        return peak;
      });
      const maximum = Math.max(.01, ...values);
      return values.map(value => value / maximum);
    } catch { return null; } finally { await context?.close(); }
  });
  peaksCache.set(key, task); peakQueue = task.catch(() => {});
  if (peaksCache.size > 100) peaksCache.delete(peaksCache.keys().next().value);
  return task;
}

const ClipWaveform = memo(function ClipWaveform({ clip, asset }) {
  const ref = useRef(), [peaks, setPeaks] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!asset) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect(); audioPeaks(asset).then(values => { if (alive) setPeaks(values); });
    });
    observer.observe(ref.current);
    return () => { alive = false; observer.disconnect(); };
  }, [asset?.id, asset?.url]);
  return <div ref={ref} className="timeline-wave" aria-hidden="true">{peaks ? <svg viewBox={`${clip.start / asset.duration * 600} 0 ${clipDuration(clip) / asset.duration * 600} 40`} preserveAspectRatio="none">{peaks.map((peak, i) => <line key={i} x1={i} x2={i} y1={20 - Math.max(.5, peak * 19)} y2={20 + Math.max(.5, peak * 19)} stroke="currentColor" strokeWidth=".65" />)}</svg> : <span className="timeline-source-line" />}</div>;
});

function stackClips(clips) {
  const ends = [], rows = new Map();
  for (const clip of [...clips].sort((a, b) => a.position - b.position)) {
    let row = ends.findIndex(end => end <= clip.position + .001);
    if (row === -1) row = ends.length;
    ends[row] = clipEnd(clip); rows.set(clip.id, row);
  }
  return { rows, height: Math.max(90, ends.length * 70 + 16) };
}

export default function TimelineEditor({ arrangement: source, assets, episodeAssets = assets, library = { folders: [], clips: [] }, selected, onSelect, onChange, onAdd, onImport, disabled }) {
  const arrangement = useMemo(() => toTimeline(source), [source]);
  const [playhead, setPlayhead] = useState(0), [playing, setPlaying] = useState(false), [error, setError] = useState('');
  const [zoom, setZoom] = useState('auto'), [viewport, setViewport] = useState(900), [snap, setSnap] = useState(true), [gesture, setGesture] = useState(null);
  const [search, setSearch] = useState('');
  const [sourceScope, setSourceScope] = useState('episode'), [sourceFolder, setSourceFolder] = useState('all');
  const sourceEntries = (sourceScope === 'episode'
    ? episodeAssets.map(asset => ({ key: asset.id, asset, name: asset.name, duration: asset.duration, role: asset.category === 'music' ? 'music-layer' : 'segment' }))
    : library.clips.filter(item => sourceFolder === 'all' || (sourceFolder === 'unfiled' ? !item.folderId : item.folderId === sourceFolder))
      .map(item => ({ key: item.id, asset: item.asset, name: item.name, duration: item.end - item.start, role: item.role, template: item })))
    .filter(item => item.name.toLowerCase().includes(search.toLowerCase()));
  const scroll = useRef(), playback = useRef(), drag = useRef(), latest = useRef();
  const duration = episodeDuration(arrangement), span = Math.min(7200, Math.max(60, duration + 10));
  const fitScale = Math.max(.04, Math.min(96, (viewport - 172) / span));
  const scale = zoom === 'auto' ? Math.max(viewport < 600 ? 12 : 4, fitScale) : zoom ?? fitScale;
  const width = Math.max(viewport - 172, span * scale), ticks = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200].find(step => step * scale >= 65) || 1800;
  const clip = arrangement.segments.find(item => item.id === selected);
  latest.current = { arrangement, onChange, disabled };
  const stop = () => { playback.current?.stop(); playback.current = null; setPlaying(false); };
  useEffect(() => {
    const observer = new ResizeObserver(entries => setViewport(entries[0].contentRect.width));
    observer.observe(scroll.current); return () => observer.disconnect();
  }, []);
  useEffect(() => { stop(); }, [source, disabled]);
  useEffect(() => {
    if (!playing || !scroll.current) return;
    const pane = scroll.current, left = playhead * scale, visibleWidth = pane.clientWidth - 172;
    if (left < pane.scrollLeft || left > pane.scrollLeft + visibleWidth - 30) pane.scrollLeft = Math.max(0, left - visibleWidth / 4);
  }, [playing, playhead, scale]);
  useEffect(() => {
    const sourcePlay = event => { if (event.target.tagName === 'AUDIO') stop(); };
    document.addEventListener('play', sourcePlay, true);
    return () => document.removeEventListener('play', sourcePlay, true);
  }, []);
  useEffect(() => () => { playback.current?.stop(); }, []);
  const seek = value => { if (!Number.isFinite(value)) return; stop(); setPlayhead(roundTime(Math.max(0, Math.min(7200, value)))); };
  const play = () => {
    if (playing) return stop();
    setError('');
    try {
      document.querySelectorAll('audio').forEach(audio => audio.pause());
      playback.current = createTimelinePlayback(arrangement, assets, { onTime: setPlayhead, onEnd: () => setPlaying(false), onError: message => { setError(message); setPlaying(false); } });
      setPlaying(true); playback.current.play(playhead >= duration ? 0 : playhead);
    } catch { setError('Timeline playback is unavailable in this browser. Render the episode to hear the mix.'); }
  };
  const updateClip = next => onChange({ ...arrangement, segments: arrangement.segments.map(item => item.id === next.id ? next : item) });
  const remove = () => { if (!clip) return; onChange({ ...arrangement, segments: arrangement.segments.filter(item => item.id !== clip.id) }); onSelect(null); };
  const split = () => {
    if (!clip) return;
    try {
      const clips = splitClip(clip, clip.start + playhead - clip.position, crypto.randomUUID());
      onChange({ ...arrangement, segments: arrangement.segments.flatMap(item => item.id === clip.id ? clips : [item]) }); setError('');
    } catch (error) { setError(error.message); }
  };
  const canSplit = clip && playhead >= clip.position + .05 && playhead <= clipEnd(clip) - .05 && arrangement.segments.length < 200;
  const duplicate = () => {
    if (!clip || arrangement.segments.length >= 200 || clipEnd(clip) + clipDuration(clip) > 7200) return;
    const copy = { ...clip, id: crypto.randomUUID(), name: `${clip.name.slice(0, 192)} (copy)`, position: roundTime(clipEnd(clip)) };
    onChange({ ...arrangement, segments: [...arrangement.segments, copy] }); onSelect(copy.id);
  };
  const updateTrack = (track, changes) => onChange({ ...arrangement, tracks: arrangement.tracks.map(item => item.id === track.id ? { ...item, ...changes } : item) });
  const snapTime = (time, moving) => {
    const bounded = Math.max(0, time);
    if (!snap) return roundTime(bounded);
    const targets = [0, playhead, ...arrangement.segments.filter(item => item.id !== moving.id).flatMap(item => [item.position, clipEnd(item)])];
    let best = Math.round(bounded * 10) / 10, distance = 8 / scale;
    for (const target of targets) if (Math.abs(target - bounded) < distance) { best = target; distance = Math.abs(target - bounded); }
    return roundTime(best);
  };
  const beginGesture = (event, moving, edge) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); stop(); onSelect(moving.id); event.currentTarget.focus();
    const lane = event.currentTarget.closest('[data-lane]');
    drag.current = { original: moving, next: moving, edge, x: event.clientX, contentX: event.clientX - lane.getBoundingClientRect().left, moved: false };
    setGesture({ clip: moving, id: moving.id });
    event.currentTarget.closest('.timeline-editor').setPointerCapture(event.pointerId);
  };
  const moveGesture = event => {
    const state = drag.current;
    if (!state || disabled) return;
    if (Math.abs(event.clientX - state.x) < 3 && !state.moved) return;
    state.moved = true;
    const lane = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-lane]');
    const originalLane = scroll.current.querySelector(`[data-track="${state.original.trackId}"]`);
    const reference = lane || originalLane;
    const delta = (event.clientX - reference.getBoundingClientRect().left - state.contentX) / scale;
    let next;
    if (state.edge) {
      const boundary = state.edge === 'start' ? state.original.position : clipEnd(state.original);
      const shift = snapTime(boundary + delta, state.original) - boundary;
      next = trimClip(state.original, state.edge, shift, assets.find(item => item.id === state.original.assetId)?.duration || state.original.end);
    } else {
      let position = snapTime(state.original.position + delta, state.original);
      const endSnap = snapTime(position + clipDuration(state.original), state.original) - clipDuration(state.original);
      if (snap && Math.abs(endSnap - position) * scale < 6 && endSnap >= 0) position = endSnap;
      next = { ...state.original, position: roundTime(Math.max(0, Math.min(7200 - clipDuration(state.original), position))), trackId: lane?.dataset.track || state.original.trackId };
    }
    state.next = next; setGesture({ clip: next, id: next.id });
  };
  const endGesture = (event, cancel = false) => {
    const state = drag.current; if (!state) return;
    drag.current = null; setGesture(null);
    if (!cancel && state.moved && !latest.current.disabled) {
      const current = latest.current.arrangement;
      latest.current.onChange({ ...current, segments: current.segments.map(item => item.id === state.next.id ? state.next : item) });
    }
  };
  const drop = async (event, track) => {
    event.preventDefault(); if (disabled) return;
    try {
      const at = Math.max(0, (event.clientX - event.currentTarget.getBoundingClientRect().left) / scale);
      const placement = { at: snap ? Math.round(at * 10) / 10 : at, trackId: track.id };
      if (event.dataTransfer.files.length) {
        await onImport([...event.dataTransfer.files], { ...placement, kind: track.kind });
        setError('');
        return;
      }
      const data = JSON.parse(event.dataTransfer.getData('application/x-godly-audio'));
      const saved = data.libraryClipId ? library.clips.find(item => item.id === data.libraryClipId) : null;
      if (data.libraryClipId && !saved) throw new Error('This saved clip is unavailable. Refresh the clip library.');
      const asset = saved?.asset || episodeAssets.find(item => item.id === data.assetId);
      if (!asset) return;
      await onAdd(asset, saved?.role || (data.role === 'music-bed' || data.role === 'library' ? (track.kind === 'music' ? 'music' : 'segment') : data.role), { ...placement, ...(saved ? { template: saved } : {}) });
      setError('');
    } catch (error) { setError(error.message || 'Choose audio from your library to place on a track.'); }
  };
  const timelineClips = arrangement.segments.map(item => gesture?.id === item.id ? gesture.clip : item);
  return <section className="timeline-editor" aria-label="Multitrack audio editor" onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={event => endGesture(event, true)} onLostPointerCapture={event => endGesture(event, true)} onKeyDown={event => {
    if (event.target.closest('input,select,textarea,audio') || disabled) return;
    if (event.code === 'Space') { event.preventDefault(); if (duration) play(); }
    if (event.key.toLowerCase() === 's' && canSplit) { event.preventDefault(); split(); }
    if ((event.key === 'Delete' || event.key === 'Backspace') && clip) { event.preventDefault(); remove(); }
    if (event.key === 'Escape') { drag.current = null; setGesture(null); stop(); }
  }}>
    <div className="timeline-heading"><div><p className="eyebrow">Production desk</p><h2>Your story, in layers.</h2><p className="small muted">Drag clips or audio files onto tracks. Pull either edge to trim. Layer your whole episode here.</p></div><span className="timeline-count"><Headphones size={16} />{arrangement.tracks.length} tracks · {arrangement.segments.length} clips</span></div>
    <div className="timeline-source-navigation"><div className="timeline-source-switch" role="group" aria-label="Timeline audio sources"><button aria-pressed={sourceScope === 'episode'} onClick={() => { setSourceScope('episode'); setSearch(''); }}>Episode audio <span>{episodeAssets.length}</span></button><button aria-pressed={sourceScope === 'library'} onClick={() => { setSourceScope('library'); setSearch(''); }}>Saved library <span>{library.clips.length}</span></button></div>
      {sourceScope === 'library' && <label>Folder<select aria-label="Timeline library folder" value={sourceFolder} onChange={event => setSourceFolder(event.target.value)}><option value="all">All folders</option><option value="unfiled">Unfiled</option>{library.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>}
    </div>
    <div className="timeline-source-tray"><label className="timeline-source-search"><Search size={14} /><input aria-label="Search timeline audio" placeholder="Find audio…" value={search} onChange={event => setSearch(event.target.value)} /></label><div className="timeline-sources">{sourceEntries.map(entry => <div className="timeline-source" key={entry.key} draggable={!disabled} onDragStart={event => {
      event.dataTransfer.setData('application/x-godly-audio', JSON.stringify({ assetId: entry.asset.id, role: entry.role, ...(entry.template ? { libraryClipId: entry.template.id } : {}) })); event.dataTransfer.effectAllowed = 'copy';
    }}><GripVertical size={13} /><Music2 size={14} /><span title={entry.name}>{entry.name}<small>{formatTime(entry.duration)} · {entry.template ? roleLabels[entry.role] : entry.asset.category === 'music' ? 'Music' : 'Recording'}</small></span><button aria-label={`Add ${entry.name} at playhead`} title="Add at playhead" disabled={disabled || arrangement.segments.length >= 200} onClick={async () => { try { await onAdd(entry.asset, entry.role, { at: playhead, ...(entry.template ? { template: entry.template } : {}), trackId: clip?.trackId || (entry.asset.category === 'music' || entry.role === 'music' ? 'music' : 'program') }); setError(''); } catch (error) { setError(error.message); } }}><Plus size={14} /></button></div>)}</div>{!sourceEntries.length && <span className="small muted">{search ? 'No matching audio.' : sourceScope === 'episode' ? 'Record or upload audio for this episode.' : 'Save an episode clip to a library folder to reuse it here.'}</span>}</div>
    <div className="timeline-toolbar"><div className="row"><button className="btn icon" aria-label="Back to beginning" onClick={() => seek(0)}><SkipBack size={16} /></button><button className="btn primary" aria-label={playing ? 'Pause timeline' : 'Play timeline'} disabled={disabled || !duration} onClick={play}>{playing ? <Pause size={16} /> : <Play size={16} />}{playing ? 'Pause' : 'Play mix'}</button><output className="timeline-time" aria-label="Timeline time">{formatTime(playhead)}<span> / {formatTime(duration)}</span></output></div><div className="row"><button className="btn icon" title="Split selected clip at playhead (S)" aria-label="Split at playhead" disabled={disabled || !canSplit} onClick={split}><Scissors size={16} /></button><button className="btn icon" title="Duplicate selected clip" aria-label="Duplicate clip" disabled={disabled || !clip || arrangement.segments.length >= 200 || clipEnd(clip) + clipDuration(clip) > 7200} onClick={duplicate}><Copy size={16} /></button><button className="btn icon danger" title="Delete selected clip" aria-label="Delete selected clip" disabled={disabled || !clip} onClick={remove}><Trash2 size={16} /></button><span className="timeline-toolbar-divider" /><button className={`btn icon ${snap ? 'snap-active' : ''}`} title="Snap to clip edges and playhead" aria-label="Snap to clips" aria-pressed={snap} onClick={() => setSnap(!snap)}><Magnet size={16} /></button><label className="timeline-zoom"><ZoomIn size={15} /><span className="sr-only">Timeline zoom</span><select aria-label="Timeline zoom" value={zoom ?? 'fit'} onChange={event => setZoom(event.target.value === 'auto' ? 'auto' : event.target.value === 'fit' ? null : Number(event.target.value))}><option value="auto">Auto</option><option value="fit">Fit</option>{[.25, .5, 1, 2, 4, 8, 16, 32, 64, 128].map(value => <option key={value} value={value}>{value} px/s</option>)}</select></label></div></div>
    <div className="timeline-scroll" ref={scroll} tabIndex="0" aria-label="Audio tracks; scroll horizontally to navigate">
      <div className="timeline-surface" style={{ width: width + 172 }}>
        <div className="timeline-ruler-row"><div className="timeline-track-label timeline-ruler-label">TRACKS <span>TIME →</span></div><div className="timeline-ruler" style={{ width }} onClick={event => seek((event.clientX - event.currentTarget.getBoundingClientRect().left) / scale)}>{Array.from({ length: Math.floor(width / scale / ticks) + 1 }, (_, i) => <span key={i} style={{ left: i * ticks * scale }}>{formatTime(i * ticks)}</span>)}</div></div>
        {arrangement.tracks.map((track, index) => {
          const clips = timelineClips.filter(item => item.trackId === track.id), stacked = stackClips(clips), audible = trackAudible(track, arrangement.tracks);
          return <div className={`timeline-track color-${track.color} ${audible ? '' : 'track-muted'}`} key={track.id} style={{ minHeight: stacked.height }}>
            <div className="timeline-track-label"><div className="timeline-track-title"><span className="timeline-track-number">{String(index + 1).padStart(2, '0')}</span><input aria-label={`Track name ${index + 1}`} maxLength={80} value={track.name} disabled={disabled} onChange={event => updateTrack(track, { name: event.target.value })} /></div><div className="timeline-track-controls"><button title="Mute track" aria-label={`Mute ${track.name}`} aria-pressed={track.muted} disabled={disabled} onClick={() => updateTrack(track, { muted: !track.muted })}>M</button><button title="Solo track" aria-label={`Solo ${track.name}`} aria-pressed={track.solo} disabled={disabled} onClick={() => updateTrack(track, { solo: !track.solo })}>S</button><label title={`Track volume ${Math.round(track.gain * 100)}%`}><Volume2 size={12} /><input aria-label={`${track.name} volume`} type="range" min="0" max="2" step=".05" value={track.gain} disabled={disabled} onChange={event => updateTrack(track, { gain: Number(event.target.value) })} /></label>{!clips.length && arrangement.tracks.length > 1 && <button title="Remove empty track" aria-label={`Remove ${track.name} track`} disabled={disabled} onClick={() => onChange({ ...arrangement, tracks: arrangement.tracks.filter(item => item.id !== track.id) })}>×</button>}</div></div>
            <div className="timeline-lane" data-lane="true" data-track={track.id} style={{ width, minHeight: stacked.height, backgroundSize: `${ticks * scale}px 100%` }} onDragOver={event => { if (!disabled && (event.dataTransfer.types.includes('application/x-godly-audio') || event.dataTransfer.types.includes('Files'))) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }} onDrop={event => drop(event, track)} onClick={event => { if (event.target === event.currentTarget) seek((event.clientX - event.currentTarget.getBoundingClientRect().left) / scale); }}>
              {!clips.length && <span className="timeline-empty-track">Drop {track.kind === 'effects' ? 'FX or action cues' : track.kind === 'music' ? 'music' : 'audio'} here</span>}
              {clips.map(item => <div key={item.id} role="button" tabIndex={0} aria-label={`Clip ${item.name}`} aria-pressed={item.id === selected} className={`timeline-clip ${item.id === selected ? 'is-selected' : ''} ${gesture?.id === item.id ? 'is-dragging' : ''}`} style={{ left: item.position * scale, width: Math.max(3, clipDuration(item) * scale), top: 8 + stacked.rows.get(item.id) * 70 }} onPointerDown={event => beginGesture(event, item)} onClick={event => { event.stopPropagation(); onSelect(item.id); }} onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); onSelect(item.id); }
                if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && !disabled) {
                  event.preventDefault(); event.stopPropagation(); onSelect(item.id);
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') updateClip({ ...item, position: roundTime(Math.max(0, Math.min(7200 - clipDuration(item), item.position + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : .1)))) });
                  else { const target = arrangement.tracks[index + (event.key === 'ArrowUp' ? -1 : 1)]; if (target) updateClip({ ...item, trackId: target.id }); }
                }
              }}><span className="timeline-clip-caption"><strong>{item.name}</strong><small>{roleLabels[item.role] || 'Segment'}</small></span><ClipWaveform clip={item} asset={assets.find(asset => asset.id === item.assetId)} /><span className="timeline-trim-handle trim-left" role="button" tabIndex={0} aria-label={`Trim start of ${item.name}`} onPointerDown={event => beginGesture(event, item, 'start')} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key) && !disabled) { event.preventDefault(); event.stopPropagation(); updateClip(trimClip(item, 'start', event.key === 'ArrowLeft' ? -.1 : .1, assets.find(asset => asset.id === item.assetId)?.duration || item.end)); } }} /><span className="timeline-trim-handle trim-right" role="button" tabIndex={0} aria-label={`Trim end of ${item.name}`} onPointerDown={event => beginGesture(event, item, 'end')} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key) && !disabled) { event.preventDefault(); event.stopPropagation(); updateClip(trimClip(item, 'end', event.key === 'ArrowLeft' ? -.1 : .1, assets.find(asset => asset.id === item.assetId)?.duration || item.end)); } }} /></div>)}
              <div className="timeline-playhead" style={{ left: Math.min(width, playhead * scale) }} aria-hidden="true" />
            </div>
          </div>;
        })}
        {arrangement.music.assetId && <div className="timeline-track color-gold timeline-bed"><div className="timeline-track-label"><strong>Looping music bed</strong><span className="small muted">{Math.round(arrangement.music.volume * 100)}% · {arrangement.music.duck ? 'Voice ducking' : 'Constant volume'}</span></div><div className="timeline-lane" style={{ width }}><div className="timeline-bed-clip" style={{ width: duration * scale }}>{assets.find(asset => asset.id === arrangement.music.assetId)?.name || 'Background music'} · loops to fit</div></div></div>}
      </div>
    </div>
    <div className="timeline-footer"><label className="timeline-seek">Playhead<input aria-label="Timeline playhead (seconds)" className="field" type="number" min="0" max="7200" step=".01" value={roundTime(playhead)} onChange={event => seek(Number(event.target.value))} /><span className="small muted">sec</span></label><button className="btn ghost" disabled={disabled || arrangement.tracks.length >= 16} onClick={() => onChange({ ...arrangement, tracks: [...arrangement.tracks, { id: crypto.randomUUID(), name: `Audio ${arrangement.tracks.length + 1}`, kind: 'voice', color: ['sage', 'blue', 'gold', 'rose', 'purple'][arrangement.tracks.length % 5], gain: 1, muted: false, solo: false }] })}><Plus size={14} />Add track</button><span className="small muted timeline-shortcuts">Space: play/pause · S: split · Arrows: move clip · Delete: remove</span></div>
    {error && <p className="message error" role="alert">{error}</p>}
    <div className="timeline-rundown"><span className="eyebrow">Episode rundown</span>{arrangement.segments.length ? [...arrangement.segments].sort((a, b) => a.position - b.position).map(item => <button className={`rundown-clip ${item.id === selected ? 'active' : ''}`} key={item.id} onClick={() => { onSelect(item.id); seek(item.position); const left = item.position * scale; scroll.current.scrollLeft = Math.max(0, left - 80); }}><small>{formatTime(item.position)} · {roleLabels[item.role] || 'Segment'}</small><strong>{item.name}</strong></button>) : <p className="small muted">Add an intro, segments, transitions, music, FX, narration, announcements, promos, and a closing outro from the audio library.</p>}</div>
    <p className="timeline-preview-note small muted">Live preview includes timing, layers, volume, fades, and approximate music ducking. Render the episode for the final normalized MP3. Waveforms load for sources under 20 MB and 10 minutes; longer sources still play and edit.</p>
  </section>;
}
