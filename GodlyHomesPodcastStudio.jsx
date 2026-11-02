import { useState, useEffect, useRef, useMemo } from "react";
import {
  Mic, Square, Play, Pause, Plus, Trash2, ChevronUp, ChevronDown, Scissors, Upload,
  Music, LogOut, ArrowLeft, Download, Check, Copy, Radio, Library as LibraryIcon, Lock,
} from "lucide-react";

/* =========================================================
   Godly Homes Podcast Studio — MVP prototype
   - Mock sign-in (swap for Clerk/Supabase)
   - Record takes as segments (MediaRecorder + Web Audio)
   - Sound library (built-in synthesized sounds + uploads)
   - Segment editor: trim, split, fade, volume, reorder
   - Music bed with automatic ducking under voice
   - Client-side render (OfflineAudioContext) + loudness
     normalization, WAV export, RSS <item> generation
   In production, rendering moves to an FFmpeg job and audio
   chunks upload to S3/R2 as they are recorded.
   ========================================================= */

const T = {
  linen: "#F4EDE3", cream: "#FBF7F1", taupe: "#A6927F", taupeSoft: "#E6DACB",
  sage: "#76866B", sageDeep: "#55644C", sageSoft: "#DFE5D6",
  blush: "#B9705A", blushSoft: "#F1DCD2", charcoal: "#2F2B27", ink: "#5A534C",
};

const Styles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
    .gh { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: ${T.charcoal}; background: ${T.cream}; }
    .serif { font-family: 'Cormorant Garamond', Georgia, serif; }
    .arch { border-radius: 999px 999px 18px 18px; }
    .gh button:focus-visible, .gh input:focus-visible, .gh select:focus-visible, .gh textarea:focus-visible {
      outline: 2px solid ${T.sage}; outline-offset: 2px;
    }
    .gh button:disabled { opacity: .45; cursor: not-allowed; }
    .rng { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 99px; background: ${T.taupeSoft}; cursor: pointer; }
    .rng::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: ${T.cream}; border: 3px solid ${T.sageDeep}; }
    .rng::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: ${T.cream}; border: 3px solid ${T.sageDeep}; }
    .field { background: ${T.cream}; border: 1px solid ${T.taupeSoft}; border-radius: 14px; padding: 12px 14px; width: 100%; outline: none; }
    .field:focus { border-color: ${T.sage}; }
    @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(185,112,90,.45); } 50% { box-shadow: 0 0 0 14px rgba(185,112,90,0); } }
    .recording { animation: pulse 1.6s ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce) { .recording { animation: none; } }
  `}</style>
);

/* ---------- helpers ---------- */
let _id = 0;
const uid = () => `id${Date.now().toString(36)}${(_id++).toString(36)}`;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fmtTenths = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const segLen = (s) => Math.max(0, s.end - s.start);
const epLen = (ep) => ep.segments.reduce((a, s) => a + segLen(s), 0);
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let sharedCtx = null;
function getCtx() {
  if (!sharedCtx) sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (sharedCtx.state === "suspended") sharedCtx.resume();
  return sharedCtx;
}

async function decodeBlob(blob) {
  const arr = await blob.arrayBuffer();
  return await getCtx().decodeAudioData(arr);
}

const makeSegment = (buffer, name, kind) => ({
  id: uid(), name, kind, buffer, start: 0, end: buffer.duration, fadeIn: 0, fadeOut: 0, gain: 1,
});

/* ---------- built-in sound library (synthesized, no downloads) ---------- */
async function synth(duration, build) {
  const sr = 44100;
  const ctx = new OfflineAudioContext(1, Math.ceil(sr * duration), sr);
  build(ctx);
  return ctx.startRendering();
}
function note(ctx, freq, t, dur, vol, type = "sine") {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.05);
}
function pad(ctx, freqs, t, dur, vol) {
  freqs.forEach((f) => {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = "triangle"; o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 1.2);
    g.gain.linearRampToValueAtTime(vol, t + dur - 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.4);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.5);
  });
}
async function buildLibrary() {
  const intro = await synth(4, (c) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { note(c, f, i * 0.25, 2.8, 0.22); note(c, f * 2, i * 0.25, 1.2, 0.05, "triangle"); });
  });
  const outro = await synth(4.5, (c) => {
    [1046.5, 783.99, 659.25, 523.25].forEach((f, i) => note(c, f, i * 0.3, 3, 0.22));
  });
  const bell = await synth(2.5, (c) => { note(c, 880, 0, 2.3, 0.25); note(c, 1760, 0, 1.4, 0.08); note(c, 2640, 0, 0.8, 0.04); });
  const bed = await synth(16, (c) => {
    [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]]
      .forEach((ch, i) => pad(c, ch, i * 4, 4, 0.07));
  });
  return [
    { id: "lib-intro", name: "Gentle intro chime", kind: "sound", buffer: intro, builtIn: true },
    { id: "lib-bell", name: "Transition bell", kind: "sound", buffer: bell, builtIn: true },
    { id: "lib-outro", name: "Soft outro", kind: "sound", buffer: outro, builtIn: true },
    { id: "lib-bed", name: "Morning hymn pad (loops)", kind: "music", buffer: bed, builtIn: true },
  ];
}

/* ---------- render: stitch, fades, ducking, loudness ---------- */
function scheduler(param) {
  let last = -1;
  return {
    set(v, t) { if (t > last) { param.setValueAtTime(v, t); last = t; } },
    ramp(v, t) { if (t > last) { param.linearRampToValueAtTime(v, t); last = t; } },
  };
}

async function renderEpisode(ep, assets) {
  const total = epLen(ep);
  if (total <= 0) return null;
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sr) + 1, sr);
  const master = ctx.createGain(); master.connect(ctx.destination);

  let t = 0; const voice = [];
  for (const s of ep.segments) {
    const dur = segLen(s); if (dur <= 0) continue;
    const src = ctx.createBufferSource(); src.buffer = s.buffer;
    const g = ctx.createGain(); src.connect(g).connect(master);
    const fi = Math.min(s.fadeIn, dur / 2), fo = Math.min(s.fadeOut, dur / 2);
    g.gain.setValueAtTime(fi > 0 ? 0 : s.gain, t);
    if (fi > 0) g.gain.linearRampToValueAtTime(s.gain, t + fi);
    if (fo > 0) { g.gain.setValueAtTime(s.gain, t + dur - fo); g.gain.linearRampToValueAtTime(0, t + dur); }
    src.start(t, s.start, dur);
    if (s.kind === "voice") voice.push([t, t + dur]);
    t += dur;
  }

  const bed = assets.find((a) => a.id === ep.music.assetId);
  if (bed) {
    const src = ctx.createBufferSource(); src.buffer = bed.buffer; src.loop = true;
    const duck = ctx.createGain(); const fade = ctx.createGain();
    src.connect(duck).connect(fade).connect(master);
    const base = ep.music.volume, low = ep.music.duck ? base * 0.22 : base;
    const merged = [];
    voice.forEach((r) => {
      const prev = merged[merged.length - 1];
      if (prev && r[0] - prev[1] < 1) prev[1] = r[1]; else merged.push([...r]);
    });
    const s = scheduler(duck.gain);
    s.set(base, 0);
    merged.forEach(([a, b]) => {
      s.set(base, Math.max(0.001, a - 0.5)); s.ramp(low, Math.max(0.002, a));
      s.set(low, b); s.ramp(base, b + 0.8);
    });
    fade.gain.setValueAtTime(1, Math.max(0, total - 3));
    fade.gain.linearRampToValueAtTime(0, total);
    src.start(0); src.stop(total);
  }

  const out = await ctx.startRendering();
  // Loudness: approximate −16 LUFS with an RMS target, capped to avoid clipping.
  let sum = 0, peak = 0, n = 0;
  for (let c = 0; c < out.numberOfChannels; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const v = d[i]; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
    n += d.length;
  }
  const rms = Math.sqrt(sum / n);
  if (rms > 0) {
    const g = Math.min(0.13 / rms, 0.95 / peak);
    for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; }
  }
  return out;
}

function encodeWav(buf) {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length;
  const dv = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); dv.setUint32(4, 36 + len * ch * 2, true); w(8, "WAVE"); w(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true);
  dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, len * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, data[c][i])); dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
  }
  return new Blob([dv], { type: "audio/wav" });
}

/* ---------- shared player ---------- */
function usePlayer() {
  const [state, setState] = useState(null); // { id, offset, duration, started }
  const [, tick] = useState(0);
  const srcRef = useRef(null);
  useEffect(() => {
    if (!state) return;
    let raf; const loop = () => { tick((x) => x + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state]);
  const stop = () => { try { srcRef.current && srcRef.current.stop(); } catch (e) {} srcRef.current = null; setState(null); };
  const play = (id, buffer, offset = 0, duration = buffer.duration - offset) => {
    stop();
    const ctx = getCtx(); const src = ctx.createBufferSource();
    src.buffer = buffer; src.connect(ctx.destination); src.start(0, offset, duration);
    src.onended = () => { if (srcRef.current === src) { srcRef.current = null; setState(null); } };
    srcRef.current = src;
    setState({ id, offset, duration, started: ctx.currentTime });
  };
  const position = state && sharedCtx ? Math.min(state.duration, sharedCtx.currentTime - state.started) : 0;
  return { state, playingId: state ? state.id : null, play, stop, position };
}

/* ---------- waveform ---------- */
function computePeaks(buffer, n) {
  const d = buffer.getChannelData(0); const block = Math.max(1, Math.floor(d.length / n));
  const stride = Math.max(1, Math.floor(block / 64)); const peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0; const s = i * block;
    for (let j = 0; j < block; j += stride) { const v = Math.abs(d[s + j] || 0); if (v > m) m = v; }
    peaks[i] = m;
  }
  const max = Math.max(...peaks, 0.001);
  return peaks.map((p) => p / max);
}

function Waveform({ buffer, start, end, cursor, playhead, onSeek, height = 128 }) {
  const ref = useRef(null);
  const peaks = useMemo(() => computePeaks(buffer, 400), [buffer]);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1; const W = cv.clientWidth * dpr, H = height * dpr;
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d"); g.clearRect(0, 0, W, H);
    const dur = buffer.duration, bw = W / peaks.length;
    peaks.forEach((p, i) => {
      const t = (i / peaks.length) * dur; const h = Math.max(2 * dpr, p * H * 0.9);
      g.fillStyle = t >= start && t <= end ? T.sageDeep : T.taupeSoft;
      g.fillRect(i * bw, (H - h) / 2, Math.max(1, bw - 1 * dpr), h);
    });
    const line = (time, color, w) => { const x = (time / dur) * W; g.fillStyle = color; g.fillRect(x - w / 2, 0, w, H); };
    if (cursor != null) line(cursor, T.blush, 2 * dpr);
    if (playhead != null) line(playhead, T.charcoal, 2 * dpr);
  }, [peaks, start, end, cursor, playhead, buffer, height]);
  return (
    <canvas ref={ref} style={{ width: "100%", height, cursor: "crosshair", display: "block" }}
      onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onSeek && onSeek(((e.clientX - r.left) / r.width) * buffer.duration); }}
      aria-label="Waveform. Click to place the cursor." role="img" />
  );
}

/* ---------- UI atoms ---------- */
const Btn = ({ kind = "primary", className = "", style, ...p }) => {
  const k = {
    primary: { background: T.sageDeep, color: T.cream },
    accent: { background: T.blush, color: T.cream },
    ghost: { background: T.linen, color: T.charcoal },
    outline: { background: "transparent", color: T.charcoal, border: `1.5px solid ${T.charcoal}` },
  }[kind];
  return <button {...p} className={`rounded-full px-5 h-11 inline-flex items-center justify-center gap-2 text-sm font-semibold transition-transform hover:scale-105 ${className}`} style={{ ...k, ...style }} />;
};
const IconBtn = ({ label, children, ...p }) => (
  <button {...p} aria-label={label} title={label} className="w-9 h-9 rounded-full inline-flex items-center justify-center transition-colors hover:bg-white">{children}</button>
);
const Card = ({ children, className = "", style }) => (
  <div className={`rounded-3xl p-6 ${className}`} style={{ background: T.cream, border: `1px solid ${T.taupeSoft}`, ...style }}>{children}</div>
);
const Chip = ({ children, tone = "sage" }) => {
  const m = { sage: [T.sageSoft, T.sageDeep], blush: [T.blushSoft, T.blush], taupe: [T.taupeSoft, T.ink] }[tone];
  return <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: m[0], color: m[1] }}>{children}</span>;
};
const Logo = ({ small }) => (
  <span className="flex items-center gap-2">
    <span className="arch w-7 h-9 flex items-end justify-center pb-1" style={{ background: T.sage }}>
      <span className="w-2 h-2 rounded-full" style={{ background: T.cream }} />
    </span>
    <span className={`serif font-semibold ${small ? "text-xl" : "text-2xl"}`}>Godly Homes <span style={{ color: T.sageDeep }}>Studio</span></span>
  </span>
);

/* ---------- Sign in ---------- */
function SignIn({ onSignIn }) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState("");
  const go = () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("Enter your email address, like name@example.com.");
    if (pw.length < 1) return setErr("Enter your password.");
    onSignIn({ email });
  };
  return (
    <div className="min-h-screen flex items-center justify-center px-5" style={{ background: `linear-gradient(180deg, ${T.cream}, ${T.linen})` }}>
      <div className="w-full max-w-md">
        <div className="flex justify-center"><Logo /></div>
        <Card className="mt-8 p-8">
          <h1 className="serif text-3xl font-semibold">Sign in to the studio</h1>
          <p className="mt-2 text-sm" style={{ color: T.ink }}>Record, edit, and publish episodes of the Godly Homes podcast.</p>
          <label className="block mt-6 text-sm font-semibold">Email
            <input className="field mt-2 font-normal" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && go()} />
          </label>
          <label className="block mt-4 text-sm font-semibold">Password
            <input className="field mt-2 font-normal" type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && go()} />
          </label>
          {err && <p className="mt-3 text-sm" style={{ color: T.blush }} role="alert">{err}</p>}
          <Btn className="w-full mt-6 h-12" onClick={go}><Lock size={16} /> Sign in</Btn>
          <p className="mt-4 text-xs text-center" style={{ color: T.ink }}>Prototype: any email and password signs you in.</p>
        </Card>
      </div>
    </div>
  );
}

/* ---------- Episodes list ---------- */
function EpisodesView({ episodes, onOpen, onCreate }) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="serif text-4xl font-semibold">Episodes</h1>
          <p className="mt-1" style={{ color: T.ink }}>{episodes.filter((e) => e.status === "Draft").length} drafts, {episodes.filter((e) => e.status === "Published").length} published</p>
        </div>
        <Btn kind="accent" onClick={onCreate}><Plus size={16} /> New episode</Btn>
      </div>
      <div className="mt-8 space-y-3">
        {episodes.map((ep) => {
          const len = ep.legacy ? ep.durationSec : epLen(ep);
          return (
            <button key={ep.id} onClick={() => !ep.legacy && onOpen(ep.id)} disabled={ep.legacy}
              className="w-full text-left rounded-3xl p-5 flex items-center gap-5 transition-colors"
              style={{ background: T.cream, border: `1px solid ${T.taupeSoft}`, opacity: 1, cursor: ep.legacy ? "default" : "pointer" }}>
              <span className="arch w-12 h-16 shrink-0 flex items-end justify-center pb-2" style={{ background: ep.status === "Published" ? T.sageSoft : T.blushSoft }}>
                <Radio size={16} style={{ color: ep.status === "Published" ? T.sageDeep : T.blush }} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block serif text-xl font-semibold truncate">{ep.title}</span>
                <span className="block text-sm mt-0.5" style={{ color: T.ink }}>
                  {ep.legacy ? "Imported from your feed" : `${ep.segments.length} segment${ep.segments.length === 1 ? "" : "s"}`}, {fmt(len)}
                </span>
              </span>
              <Chip tone={ep.status === "Published" ? "sage" : "blush"}>{ep.status}</Chip>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Recorder ---------- */
function Recorder({ onTake }) {
  const [devices, setDevices] = useState([]); const [deviceId, setDeviceId] = useState("");
  const [status, setStatus] = useState("idle"); const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0); const [error, setError] = useState("");
  const r = useRef({});

  const listDevices = async () => {
    try { const d = await navigator.mediaDevices.enumerateDevices(); setDevices(d.filter((x) => x.kind === "audioinput")); } catch (e) {}
  };
  useEffect(() => { listDevices(); return () => cleanup(); }, []); // eslint-disable-line

  const cleanup = () => {
    const c = r.current;
    cancelAnimationFrame(c.raf); clearInterval(c.timer);
    if (c.stream) c.stream.getTracks().forEach((t) => t.stop());
    r.current = {};
  };

  const start = async () => {
    setError("");
    let stream;
    try {
      const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: false };
      stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...base, deviceId: { exact: deviceId } } : base });
    } catch (e) {
      setError("Microphone access was blocked. Allow microphone access for this page in your browser, or import an audio file instead.");
      return;
    }
    listDevices();
    const ctx = getCtx(); const an = ctx.createAnalyser(); an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    const meter = () => { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; setLevel(Math.min(1, Math.sqrt(s / buf.length) * 4)); r.current.raf = requestAnimationFrame(meter); };

    const rec = new MediaRecorder(stream); const chunks = [];
    // In production, each 1s chunk is uploaded to storage here so a crash loses almost nothing.
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      setStatus("processing");
      try { onTake(await decodeBlob(new Blob(chunks, { type: rec.mimeType }))); }
      catch (e) { setError("The recording couldn’t be processed. Try recording again or import a file."); }
      setStatus("idle");
    };
    const t0 = Date.now();
    r.current = { stream, rec, timer: setInterval(() => setElapsed((Date.now() - t0) / 1000), 200) };
    r.current.raf = requestAnimationFrame(meter);
    rec.start(1000); setElapsed(0); setStatus("recording");
  };

  const stop = () => { const { rec } = r.current; if (rec && rec.state !== "inactive") rec.stop(); cleanup(); setLevel(0); };

  return (
    <Card className="p-8">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <h2 className="serif text-2xl font-semibold">Record a take</h2>
        <select className="field sm:w-64 text-sm" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={status !== "idle"} aria-label="Microphone">
          <option value="">Default microphone</option>
          {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
        </select>
      </div>

      <div className="mt-10 flex flex-col items-center">
        <button onClick={status === "recording" ? stop : start} disabled={status === "processing"}
          aria-label={status === "recording" ? "Stop recording" : "Start recording"}
          className={`w-28 h-28 rounded-full flex items-center justify-center transition-transform hover:scale-105 ${status === "recording" ? "recording" : ""}`}
          style={{ background: status === "recording" ? T.blush : T.sageDeep, color: T.cream }}>
          {status === "recording" ? <Square size={34} fill={T.cream} /> : <Mic size={40} />}
        </button>
        <p className="serif text-4xl font-semibold mt-6 tabular-nums">{fmtTenths(elapsed)}</p>
        <p className="text-sm mt-1" style={{ color: T.ink }}>
          {status === "recording" ? "Recording. Press stop when you finish this segment." : status === "processing" ? "Saving take…" : "Each take becomes its own segment you can edit."}
        </p>
        <div className="w-full max-w-sm h-2 rounded-full mt-6 overflow-hidden" style={{ background: T.taupeSoft }} aria-label="Input level">
          <div className="h-full rounded-full" style={{ width: `${level * 100}%`, background: level > 0.85 ? T.blush : T.sage, transition: "width .06s linear" }} />
        </div>
      </div>
      {error && <p className="mt-6 text-sm text-center" style={{ color: T.blush }} role="alert">{error}</p>}
    </Card>
  );
}

/* ---------- Segment editor ---------- */
function SegmentEditor({ seg, onChange, onSplit, player }) {
  const [cursor, setCursor] = useState(null);
  const dur = seg.buffer.duration;
  const playing = player.playingId === seg.id;
  const playhead = playing ? player.state.offset + player.position : null;
  const set = (k) => (e) => onChange({ ...seg, [k]: +e.target.value });
  const canSplit = cursor != null && cursor > seg.start + 0.1 && cursor < seg.end - 0.1;

  const togglePlay = () => {
    if (playing) return player.stop();
    const from = cursor != null && cursor >= seg.start && cursor < seg.end ? cursor : seg.start;
    player.play(seg.id, seg.buffer, from, seg.end - from);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <input className="field flex-1 min-w-0 serif text-xl font-semibold" value={seg.name} onChange={(e) => onChange({ ...seg, name: e.target.value })} aria-label="Segment name" />
        <Chip tone={seg.kind === "voice" ? "sage" : "taupe"}>{seg.kind === "voice" ? "Voice" : "Sound"}</Chip>
      </div>

      <div className="mt-5 rounded-2xl p-3" style={{ background: T.linen }}>
        <Waveform buffer={seg.buffer} start={seg.start} end={seg.end} cursor={cursor} playhead={playhead} onSeek={setCursor} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Btn onClick={togglePlay}>{playing ? <Pause size={16} /> : <Play size={16} />} {playing ? "Pause" : cursor != null ? "Play from cursor" : "Play"}</Btn>
        <Btn kind="ghost" onClick={() => { onSplit(cursor); setCursor(null); }} disabled={!canSplit}><Scissors size={16} /> Split at cursor</Btn>
        <span className="text-sm tabular-nums" style={{ color: T.ink }}>
          {cursor != null ? `Cursor ${fmtTenths(cursor)}` : "Click the waveform to place a cursor"}
        </span>
      </div>
      <p className="mt-3 text-xs" style={{ color: T.ink }}>To remove a mistake, split before and after it, then delete the middle segment.</p>

      <div className="mt-6 grid sm:grid-cols-2 gap-x-8 gap-y-5 text-sm">
        <label className="block"><span className="flex justify-between font-semibold">Trim start <span className="tabular-nums font-normal">{fmtTenths(seg.start)}</span></span>
          <input type="range" className="rng mt-3" min="0" max={Math.max(0, seg.end - 0.1)} step="0.01" value={seg.start} onChange={set("start")} /></label>
        <label className="block"><span className="flex justify-between font-semibold">Trim end <span className="tabular-nums font-normal">{fmtTenths(seg.end)}</span></span>
          <input type="range" className="rng mt-3" min={Math.min(dur, seg.start + 0.1)} max={dur} step="0.01" value={seg.end} onChange={set("end")} /></label>
        <label className="block"><span className="flex justify-between font-semibold">Fade in <span className="font-normal">{seg.fadeIn.toFixed(1)}s</span></span>
          <input type="range" className="rng mt-3" min="0" max="5" step="0.1" value={seg.fadeIn} onChange={set("fadeIn")} /></label>
        <label className="block"><span className="flex justify-between font-semibold">Fade out <span className="font-normal">{seg.fadeOut.toFixed(1)}s</span></span>
          <input type="range" className="rng mt-3" min="0" max="5" step="0.1" value={seg.fadeOut} onChange={set("fadeOut")} /></label>
        <label className="block sm:col-span-2"><span className="flex justify-between font-semibold">Volume <span className="font-normal">{Math.round(seg.gain * 100)}%</span></span>
          <input type="range" className="rng mt-3" min="0" max="2" step="0.05" value={seg.gain} onChange={set("gain")} /></label>
      </div>
    </Card>
  );
}

/* ---------- Episode workspace ---------- */
function EpisodeStudio({ ep, update, assets, player, onBack }) {
  const [tab, setTab] = useState(ep.segments.length ? "edit" : "record");
  const [selected, setSelected] = useState(ep.segments[0] ? ep.segments[0].id : null);
  const [preview, setPreview] = useState("idle");
  const fileRef = useRef(null);

  const addSegment = (seg) => { update((e) => ({ ...e, segments: [...e.segments, seg] })); setSelected(seg.id); };
  const takeCount = ep.segments.filter((s) => s.kind === "voice").length;

  const onTake = (buf, name) => addSegment(makeSegment(buf, name || `Take ${takeCount + 1}`, "voice"));
  const importFile = async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { onTake(await decodeBlob(f), f.name.replace(/\.[^.]+$/, "")); } catch (err) { alert("That file couldn’t be read as audio. Try an MP3, WAV, or M4A file."); }
  };

  const move = (i, d) => update((e) => { const s = [...e.segments]; const j = i + d; if (j < 0 || j >= s.length) return e; [s[i], s[j]] = [s[j], s[i]]; return { ...e, segments: s }; });
  const remove = (id) => { update((e) => ({ ...e, segments: e.segments.filter((s) => s.id !== id) })); if (selected === id) setSelected(null); if (player.playingId === id) player.stop(); };
  const changeSeg = (seg) => update((e) => ({ ...e, segments: e.segments.map((s) => (s.id === seg.id ? seg : s)) }));
  const split = (seg, at) => update((e) => {
    const a = { ...seg, end: at, fadeOut: 0 }; const b = { ...seg, id: uid(), start: at, fadeIn: 0, name: `${seg.name} (2)` };
    const i = e.segments.findIndex((s) => s.id === seg.id); const s = [...e.segments]; s.splice(i, 1, a, b);
    return { ...e, segments: s };
  });

  const previewEpisode = async () => {
    if (player.playingId === "episode") return player.stop();
    setPreview("rendering");
    const buf = await renderEpisode(ep, assets);
    setPreview("idle");
    if (buf) player.play("episode", buf);
  };

  const sel = ep.segments.find((s) => s.id === selected);
  const total = epLen(ep);
  const tabs = [["record", "Record"], ["edit", "Arrange & edit"], ["publish", "Publish"]];

  return (
    <div>
      <button onClick={onBack} className="text-sm font-semibold inline-flex items-center gap-2" style={{ color: T.ink }}><ArrowLeft size={16} /> All episodes</button>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="serif text-4xl font-semibold truncate">{ep.title || "Untitled episode"}</h1>
          <p className="mt-1" style={{ color: T.ink }}>{ep.segments.length} segments, {fmt(total)} total <span className="ml-2"><Chip tone={ep.status === "Published" ? "sage" : "blush"}>{ep.status}</Chip></span></p>
        </div>
        <div className="flex gap-1 p-1 rounded-full" style={{ background: T.linen }} role="tablist">
          {tabs.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className="rounded-full px-5 h-10 text-sm font-semibold transition-colors"
              style={{ background: tab === k ? T.charcoal : "transparent", color: tab === k ? T.cream : T.charcoal }}>{l}</button>
          ))}
        </div>
      </div>

      {tab === "record" && (
        <div className="mt-8 grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8"><Recorder onTake={(b) => onTake(b)} /></div>
          <div className="lg:col-span-4 space-y-6">
            <Card>
              <h3 className="font-semibold">Already have audio?</h3>
              <p className="text-sm mt-1" style={{ color: T.ink }}>Import an interview or a take recorded on your phone.</p>
              <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={importFile} />
              <Btn kind="ghost" className="mt-4" onClick={() => fileRef.current.click()}><Upload size={16} /> Import audio file</Btn>
            </Card>
            <Card>
              <h3 className="font-semibold">Takes in this episode</h3>
              {takeCount === 0 ? <p className="text-sm mt-2" style={{ color: T.ink }}>Your first take will appear here.</p> : (
                <ul className="mt-3 space-y-2 text-sm">
                  {ep.segments.filter((s) => s.kind === "voice").map((s) => (
                    <li key={s.id} className="flex justify-between"><span className="truncate">{s.name}</span><span className="tabular-nums" style={{ color: T.ink }}>{fmt(segLen(s))}</span></li>
                  ))}
                </ul>
              )}
              {takeCount > 0 && <Btn className="mt-5 w-full" onClick={() => setTab("edit")}>Arrange & edit</Btn>}
            </Card>
          </div>
        </div>
      )}

      {tab === "edit" && (
        <div className="mt-8 grid lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-5 space-y-6">
            <Card>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Running order</h3>
                <span className="text-sm tabular-nums" style={{ color: T.ink }}>{fmt(total)}</span>
              </div>
              {ep.segments.length === 0 ? (
                <div className="mt-4 text-sm" style={{ color: T.ink }}>
                  No segments yet. Record a take or add a sound from your library.
                  <div className="mt-4"><Btn onClick={() => setTab("record")}><Mic size={16} /> Record a take</Btn></div>
                </div>
              ) : (
                <ol className="mt-4 space-y-2">
                  {ep.segments.map((s, i) => (
                    <li key={s.id} className="rounded-2xl pl-4 pr-2 py-2 flex items-center gap-2 cursor-pointer"
                      onClick={() => setSelected(s.id)}
                      style={{ background: s.id === selected ? T.sageSoft : T.linen, outline: s.id === selected ? `1.5px solid ${T.sage}` : "none" }}>
                      <span className="w-2 h-8 rounded-full shrink-0" style={{ background: s.kind === "voice" ? T.sageDeep : T.taupe }} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold truncate">{s.name}</span>
                        <span className="block text-xs tabular-nums" style={{ color: T.ink }}>{fmtTenths(segLen(s))}</span>
                      </span>
                      <span className="flex" onClick={(e) => e.stopPropagation()}>
                        <IconBtn label={player.playingId === s.id ? "Pause" : "Play segment"} onClick={() => player.playingId === s.id ? player.stop() : player.play(s.id, s.buffer, s.start, segLen(s))}>
                          {player.playingId === s.id ? <Pause size={15} /> : <Play size={15} />}
                        </IconBtn>
                        <IconBtn label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ChevronUp size={16} /></IconBtn>
                        <IconBtn label="Move down" onClick={() => move(i, 1)} disabled={i === ep.segments.length - 1}><ChevronDown size={16} /></IconBtn>
                        <IconBtn label="Delete segment" onClick={() => remove(s.id)}><Trash2 size={15} /></IconBtn>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card>
              <h3 className="font-semibold">Add from library</h3>
              <div className="mt-3 space-y-2">
                {assets.length === 0 && <p className="text-sm" style={{ color: T.ink }}>Preparing sounds…</p>}
                {assets.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-sm">
                    <IconBtn label={`Preview ${a.name}`} onClick={() => player.playingId === a.id ? player.stop() : player.play(a.id, a.buffer, 0, Math.min(a.buffer.duration, 8))}>
                      {player.playingId === a.id ? <Pause size={15} /> : <Play size={15} />}
                    </IconBtn>
                    <span className="flex-1 truncate">{a.name}</span>
                    <button className="text-sm font-semibold underline underline-offset-4" style={{ color: T.sageDeep }}
                      onClick={() => addSegment(makeSegment(a.buffer, a.name, "sound"))}>Add</button>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h3 className="font-semibold flex items-center gap-2"><Music size={16} /> Background music</h3>
              <select className="field mt-3 text-sm" value={ep.music.assetId} onChange={(e) => update((x) => ({ ...x, music: { ...x.music, assetId: e.target.value } }))} aria-label="Music bed">
                <option value="">No background music</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {ep.music.assetId && (
                <div className="mt-4 space-y-4 text-sm">
                  <label className="block"><span className="flex justify-between font-semibold">Music volume <span className="font-normal">{Math.round(ep.music.volume * 100)}%</span></span>
                    <input type="range" className="rng mt-3" min="0" max="1" step="0.05" value={ep.music.volume} onChange={(e) => update((x) => ({ ...x, music: { ...x.music, volume: +e.target.value } }))} /></label>
                  <label className="flex items-center gap-3 font-semibold">
                    <input type="checkbox" checked={ep.music.duck} onChange={(e) => update((x) => ({ ...x, music: { ...x.music, duck: e.target.checked } }))} className="w-4 h-4" style={{ accentColor: T.sageDeep }} />
                    Lower music while someone is speaking
                  </label>
                </div>
              )}
            </Card>
          </div>

          <div className="lg:col-span-7 space-y-6">
            <Card className="flex flex-wrap items-center gap-4" style={{ background: T.sageDeep, color: T.cream, border: "none" }}>
              <button onClick={previewEpisode} disabled={!ep.segments.length || preview === "rendering"} aria-label="Preview full episode"
                className="w-14 h-14 rounded-full flex items-center justify-center transition-transform hover:scale-105" style={{ background: T.cream, color: T.sageDeep }}>
                {player.playingId === "episode" ? <Pause size={22} /> : <Play size={22} className="ml-1" />}
              </button>
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{preview === "rendering" ? "Preparing preview…" : "Preview the full episode"}</p>
                <p className="text-sm" style={{ opacity: .8 }}>Includes trims, fades, music, and volume leveling.</p>
                {player.playingId === "episode" && (
                  <div className="h-1.5 rounded-full mt-3 overflow-hidden" style={{ background: "rgba(251,247,241,.25)" }}>
                    <div className="h-full" style={{ width: `${(player.position / player.state.duration) * 100}%`, background: T.cream }} />
                  </div>
                )}
              </div>
            </Card>
            {sel ? (
              <SegmentEditor key={sel.id} seg={sel} onChange={changeSeg} onSplit={(at) => split(sel, at)} player={player} />
            ) : (
              <Card className="text-center py-16"><p style={{ color: T.ink }}>Select a segment in the running order to edit it.</p></Card>
            )}
          </div>
        </div>
      )}

      {tab === "publish" && <PublishTab ep={ep} update={update} assets={assets} />}
    </div>
  );
}

/* ---------- Publish ---------- */
function PublishTab({ ep, update, assets }) {
  const [state, setState] = useState("idle"); const [err, setErr] = useState(""); const [copied, setCopied] = useState(false);
  const set = (k) => (e) => update((x) => ({ ...x, [k]: k === "number" ? +e.target.value : e.target.value }));

  const publish = async () => {
    setErr("");
    if (!ep.title.trim()) return setErr("Add an episode title before publishing.");
    if (!ep.segments.length) return setErr("Add at least one segment before publishing.");
    setState("rendering");
    const buf = await renderEpisode(ep, assets);
    const blob = encodeWav(buf);
    update((x) => {
      if (x.audioUrl) URL.revokeObjectURL(x.audioUrl);
      return { ...x, status: "Published", audioUrl: URL.createObjectURL(blob), bytes: blob.size, durationSec: buf.duration, publishedAt: new Date() };
    });
    setState("done");
  };

  const slug = (ep.title || "episode").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const rss = ep.publishedAt ? `<item>
  <title>${xml(ep.title)}</title>
  <description><![CDATA[${ep.description}]]></description>
  <enclosure url="https://media.godlyhomes.com/episodes/${slug}.mp3" length="${ep.bytes}" type="audio/mpeg"/>
  <guid isPermaLink="false">${ep.id}</guid>
  <pubDate>${ep.publishedAt.toUTCString()}</pubDate>
  <itunes:duration>${Math.round(ep.durationSec)}</itunes:duration>
  <itunes:episode>${ep.number}</itunes:episode>
  <itunes:explicit>false</itunes:explicit>
</item>` : "";

  return (
    <div className="mt-8 grid lg:grid-cols-12 gap-6 items-start">
      <Card className="lg:col-span-7 p-8">
        <h2 className="serif text-2xl font-semibold">Episode details</h2>
        <label className="block mt-6 text-sm font-semibold">Title
          <input className="field mt-2 font-normal" value={ep.title} onChange={set("title")} /></label>
        <label className="block mt-4 text-sm font-semibold">Episode number
          <input className="field mt-2 font-normal" type="number" min="1" value={ep.number} onChange={set("number")} /></label>
        <label className="block mt-4 text-sm font-semibold">Description and show notes
          <textarea className="field mt-2 font-normal" rows="6" value={ep.description} onChange={set("description")}
            placeholder="What will listeners take away? Include scripture references and links mentioned." /></label>
        {err && <p className="mt-4 text-sm" style={{ color: T.blush }} role="alert">{err}</p>}
        <Btn kind="accent" className="mt-6 h-12 px-7" onClick={publish} disabled={state === "rendering"}>
          <Radio size={16} /> {state === "rendering" ? "Publishing…" : ep.status === "Published" ? "Update episode" : "Publish episode"}
        </Btn>
      </Card>

      <div className="lg:col-span-5 space-y-6">
        {ep.audioUrl ? (
          <>
            <Card style={{ background: T.sageSoft, border: "none" }}>
              <p className="font-semibold flex items-center gap-2" style={{ color: T.sageDeep }}><Check size={18} /> Published {ep.publishedAt.toLocaleString()}</p>
              <audio controls src={ep.audioUrl} className="w-full mt-4" />
              <a href={ep.audioUrl} download={`${slug}.wav`} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4"><Download size={15} /> Download audio</a>
            </Card>
            <Card>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">RSS feed entry</h3>
                <button className="text-sm font-semibold inline-flex items-center gap-1" style={{ color: T.sageDeep }}
                  onClick={() => { navigator.clipboard && navigator.clipboard.writeText(rss); setCopied(true); setTimeout(() => setCopied(false), 1600); }}>
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="mt-3 text-xs rounded-2xl p-4 overflow-x-auto" style={{ background: T.linen }}>{rss}</pre>
            </Card>
          </>
        ) : (
          <Card>
            <h3 className="font-semibold">When you publish</h3>
            <p className="text-sm mt-2 leading-relaxed" style={{ color: T.ink }}>
              The studio stitches your segments, applies fades and music, levels the volume for podcast apps, and adds the episode to your RSS feed for Apple Podcasts and Spotify.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ---------- Library ---------- */
function LibraryView({ assets, setAssets, player }) {
  const ref = useRef(null);
  const upload = async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const buffer = await decodeBlob(f);
      setAssets((a) => [...a, { id: uid(), name: f.name.replace(/\.[^.]+$/, ""), kind: buffer.duration >= 15 ? "music" : "sound", buffer }]);
    } catch (err) { alert("That file couldn’t be read as audio. Try an MP3, WAV, or M4A file."); }
  };
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="serif text-4xl font-semibold">Library</h1>
          <p className="mt-1" style={{ color: T.ink }}>Intros, outros, transitions, and music you reuse across episodes.</p>
        </div>
        <input ref={ref} type="file" accept="audio/*" className="hidden" onChange={upload} />
        <Btn kind="accent" onClick={() => ref.current.click()}><Upload size={16} /> Upload sound</Btn>
      </div>
      <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {assets.map((a) => (
          <Card key={a.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="serif text-xl font-semibold truncate">{a.name}</p>
                <p className="text-sm mt-1" style={{ color: T.ink }}>{fmt(a.buffer.duration)}{a.builtIn ? ", included" : ""}</p>
              </div>
              <Chip tone={a.kind === "music" ? "blush" : "taupe"}>{a.kind === "music" ? "Music" : "Sound"}</Chip>
            </div>
            <div className="mt-4 rounded-2xl p-2" style={{ background: T.linen }}>
              <Waveform buffer={a.buffer} start={0} end={a.buffer.duration} height={56}
                playhead={player.playingId === a.id ? player.position : null} />
            </div>
            <div className="mt-4 flex items-center justify-between">
              <Btn kind="ghost" onClick={() => player.playingId === a.id ? player.stop() : player.play(a.id, a.buffer)}>
                {player.playingId === a.id ? <Pause size={15} /> : <Play size={15} />} {player.playingId === a.id ? "Pause" : "Play"}
              </Btn>
              {!a.builtIn && <IconBtn label="Delete sound" onClick={() => setAssets((x) => x.filter((y) => y.id !== a.id))}><Trash2 size={15} /></IconBtn>}
            </div>
          </Card>
        ))}
        {assets.length === 0 && <p style={{ color: T.ink }}>Preparing sounds…</p>}
      </div>
    </div>
  );
}

/* ---------- App ---------- */
const SEED = [
  { id: "legacy48", legacy: true, title: "When the house is loud and your heart is tired", status: "Published", durationSec: 1920, segments: [] },
  { id: "legacy47", legacy: true, title: "Building a family prayer rhythm that lasts", status: "Published", durationSec: 2280, segments: [] },
];
const newEpisode = (n) => ({
  id: uid(), title: `Episode ${n}`, description: "", number: n, status: "Draft", segments: [],
  music: { assetId: "", volume: 0.35, duck: true }, audioUrl: null, publishedAt: null, durationSec: 0, bytes: 0,
});

export default function GodlyHomesPodcastStudio() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState({ page: "episodes" });
  const [episodes, setEpisodes] = useState(SEED);
  const [assets, setAssets] = useState([]);
  const player = usePlayer();

  useEffect(() => { buildLibrary().then((a) => setAssets((cur) => [...a, ...cur])); }, []);

  const go = (v) => { player.stop(); setView(v); };
  const create = () => {
    const n = 49 + episodes.filter((e) => !e.legacy).length;
    const ep = newEpisode(n);
    setEpisodes((e) => [ep, ...e]); go({ page: "episode", id: ep.id });
  };
  const update = (id) => (fn) => setEpisodes((list) => list.map((e) => (e.id === id ? fn(e) : e)));
  const ep = view.page === "episode" ? episodes.find((e) => e.id === view.id) : null;

  if (!user) return <div className="gh"><Styles /><SignIn onSignIn={setUser} /></div>;

  const navItem = (page, label, Icon) => (
    <button onClick={() => go({ page })} className="rounded-full px-4 h-10 inline-flex items-center gap-2 text-sm font-semibold transition-colors"
      style={{ background: view.page === page || (page === "episodes" && view.page === "episode") ? T.sageSoft : "transparent", color: T.charcoal }}>
      <Icon size={16} /> {label}
    </button>
  );

  return (
    <div className="gh min-h-screen" style={{ background: `linear-gradient(180deg, ${T.cream}, ${T.linen})` }}>
      <Styles />
      <header className="sticky top-0 z-20 backdrop-blur" style={{ background: "rgba(251,247,241,.9)", borderBottom: `1px solid ${T.taupeSoft}` }}>
        <div className="max-w-7xl mx-auto px-5 lg:px-8 h-16 flex items-center gap-4">
          <Logo small />
          <nav className="ml-6 hidden sm:flex gap-1">
            {navItem("episodes", "Episodes", Radio)}
            {navItem("library", "Library", LibraryIcon)}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden md:inline" style={{ color: T.ink }}>{user.email}</span>
            <IconBtn label="Sign out" onClick={() => { player.stop(); setUser(null); }}><LogOut size={16} /></IconBtn>
          </div>
        </div>
        <nav className="sm:hidden flex gap-1 px-5 pb-3">
          {navItem("episodes", "Episodes", Radio)}
          {navItem("library", "Library", LibraryIcon)}
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-5 lg:px-8 py-10 lg:py-14">
        {view.page === "episodes" && <EpisodesView episodes={episodes} onOpen={(id) => go({ page: "episode", id })} onCreate={create} />}
        {view.page === "library" && <LibraryView assets={assets} setAssets={setAssets} player={player} />}
        {ep && <EpisodeStudio key={ep.id} ep={ep} update={update(ep.id)} assets={assets} player={player} onBack={() => go({ page: "episodes" })} />}
      </main>
    </div>
  );
}
