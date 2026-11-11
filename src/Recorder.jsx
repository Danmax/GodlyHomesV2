import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Pause, Play, Download } from 'lucide-react';
import { createRecovery, saveChunk, removeRecovery } from './recovery.js';
import { uploadAudio } from './api.js';
import { formatTime } from '../shared/audio-time.js';

export { formatTime } from '../shared/audio-time.js';
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export default function Recorder({ userId, episodeId, onAsset, onBusy, onRecovery }) {
  const [devices, setDevices] = useState([]), [device, setDevice] = useState('');
  const [status, setStatus] = useState('idle'), [elapsed, setElapsed] = useState(0), [level, setLevel] = useState(0);
  const [error, setError] = useState(''), [backup, setBackup] = useState(''), [rescue, setRescue] = useState(null);
  const ref = useRef({}), mounted = useRef(true), elapsedRef = useRef(0);
  const active = ['recording', 'paused', 'saving'].includes(status);
  const listDevices = async () => {
    try { setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput')); } catch { /* Permission is requested on record. */ }
  };
  useEffect(() => {
    mounted.current = true; listDevices();
    return () => {
      mounted.current = false;
      const current = ref.current;
      if (current.rec && current.rec.state !== 'inactive') current.rec.stop();
      current.stream?.getTracks().forEach(t => t.stop());
      if (current.ctx && current.ctx.state !== 'closed') current.ctx.close().catch(() => {});
      clearInterval(current.timer); cancelAnimationFrame(current.raf);
    };
  }, []);
  useEffect(() => { onBusy(active); return () => onBusy(false); }, [active, onBusy]);

  const start = async () => {
    setError(''); setBackup(''); setStatus('saving'); setRescue(null);
    let stream, ctx;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('This browser cannot record audio. Use a current Chrome, Edge, Firefox or Safari browser over HTTPS, or import audio.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: device ? { exact: device } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
      await listDevices();
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      const session = { id: crypto.randomUUID(), userId, episodeId, mime: rec.mimeType, createdAt: Date.now() };
      await createRecovery(session); // Do not record until local recovery storage is available.
      const current = { stream, rec, session, chunks: [], sequence: 0, writes: Promise.resolve(), writeError: null };
      ctx = new AudioContext(); current.ctx = ctx;
      const analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const values = new Float32Array(analyser.fftSize);
      const meter = () => {
        analyser.getFloatTimeDomainData(values);
        if (mounted.current) setLevel(Math.min(1, Math.sqrt(values.reduce((n, v) => n + v * v, 0) / values.length) * 5));
        current.raf = requestAnimationFrame(meter);
      };
      rec.ondataavailable = event => {
        if (!event.data.size) return;
        current.chunks.push(event.data);
        const sequence = current.sequence++;
        current.writes = current.writes.then(() => saveChunk(session.id, sequence, event.data)).catch(error => {
          current.writeError = error;
          if (mounted.current) setError('Local backup storage is full or unavailable. Stop and download your recording now.');
        });
      };
      rec.onerror = () => { if (mounted.current) setError('Recording was interrupted. Stop to save the captured audio.'); };
      rec.onstop = async () => {
        cancelAnimationFrame(current.raf); clearInterval(current.timer); stream.getTracks().forEach(t => t.stop());
        if (ctx.state !== 'closed') ctx.close().catch(() => {});
        if (mounted.current) { setStatus('saving'); setLevel(0); }
        await current.writes;
        const blob = new Blob(current.chunks, { type: rec.mimeType });
        if (!mounted.current) return; // IndexedDB chunks remain available after navigation or reload.
        setRescue(blob);
        if (!blob.size) { setError('No audio was captured. Please try again.'); await removeRecovery(session.id); setStatus('idle'); return; }
        try {
          setBackup('Uploading your take…');
          const extension = rec.mimeType.includes('mp4') ? 'm4a' : rec.mimeType.includes('ogg') ? 'ogg' : 'webm';
          const asset = await uploadAudio(blob, `Take ${new Date(session.createdAt).toISOString().replace(/[:.]/g, '-')}.${extension}`);
          await createRecovery({ ...session, assetId: asset.id });
          await onAsset(asset); // Keep recovery until both upload and arrangement are saved.
          await removeRecovery(session.id); setBackup('Take saved to your episode.'); setRescue(null);
        } catch (error) { setError(`${error.message} Your take is available below and in Recover recordings.`); }
        finally { setStatus('idle'); onRecovery(); }
      };
      ref.current = current; elapsedRef.current = 0; setElapsed(0);
      current.timer = setInterval(() => {
        if (rec.state === 'recording') { elapsedRef.current++; setElapsed(elapsedRef.current); }
        if (elapsedRef.current >= 7200 && rec.state !== 'inactive') rec.stop();
      }, 1000);
      current.raf = requestAnimationFrame(meter);
      rec.start(1000); setStatus('recording'); setBackup('Backing up on this device while you record.');
    } catch (error) {
      stream?.getTracks().forEach(t => t.stop());
      if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
      setStatus('idle'); setError(error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access in your browser or import an audio file.' : error.message);
    }
  };
  const togglePause = () => {
    if (status === 'paused') { ref.current.rec.resume(); setStatus('recording'); }
    else { ref.current.rec.pause(); setStatus('paused'); }
  };
  return <section className="card">
    <div className="row between"><h2>Record a take</h2><span className="badge draft">Solo audio</span></div>
    <label>Microphone<select className="field" value={device} onChange={e => setDevice(e.target.value)} disabled={active}><option value="">Default microphone</option>{devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}</select></label>
    <div className="record-center">
      <button className={`record-button ${['recording', 'paused'].includes(status) ? 'active' : ''}`} aria-label={active ? 'Stop recording' : 'Start recording'} disabled={status === 'saving'} onClick={() => active ? ref.current.rec?.stop() : start()}>{active ? <Square size={32} fill="currentColor" /> : <Mic size={38} />}</button>
      <div className="record-clock" aria-live="off">{formatTime(elapsed)}</div>
      <p className="muted small">{status === 'recording' ? 'Recording. Take your time.' : status === 'paused' ? 'Paused. Resume when you’re ready.' : status === 'saving' ? 'Preparing or saving audio…' : 'A little quiet. A meaningful conversation.'}</p>
      {['recording', 'paused'].includes(status) && <button className="btn" onClick={togglePause}>{status === 'paused' ? <Play size={14} /> : <Pause size={14} />}{status === 'paused' ? 'Resume' : 'Pause'}</button>}
      <div className="meter" role="meter" aria-label="Microphone input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}><div style={{ width: `${level * 100}%` }} /></div>
    </div>
    {backup && <p className="small muted" role="status">{backup}</p>}
    {error && <p className="message error" role="alert">{error}</p>}
    {rescue && <button className="btn" onClick={() => downloadBlob(rescue, `godly-homes-recording.${rescue.type.includes('mp4') ? 'm4a' : rescue.type.includes('ogg') ? 'ogg' : 'webm'}`)}><Download size={15} />Download recording backup</button>}
  </section>;
}
