import { useState, useEffect, useRef } from "react";
import {
  Search, Menu, X, Play, Pause, SkipBack, SkipForward, BookOpen, Home,
  Mic, Users, Instagram, Youtube, Facebook, Mail, Check, Heart, Download,
} from "lucide-react";

/* ---------- Design tokens ---------- */
const T = {
  linen: "#F4EDE3",
  cream: "#FBF7F1",
  taupe: "#A6927F",
  taupeSoft: "#E6DACB",
  sage: "#76866B",
  sageDeep: "#55644C",
  sageSoft: "#DFE5D6",
  blush: "#B9705A",
  blushSoft: "#F1DCD2",
  charcoal: "#2F2B27",
  ink: "#5A534C",
};

const Styles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
    .gh { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: ${T.charcoal}; background: ${T.cream}; }
    .serif { font-family: 'Cormorant Garamond', Georgia, serif; }
    .arch { border-radius: 999px 999px 24px 24px; }
    .lift { transition: transform .35s cubic-bezier(.2,.7,.2,1), box-shadow .35s; }
    .lift:hover { transform: translateY(-4px); box-shadow: 0 18px 40px -22px rgba(85,100,76,.45); }
    .gh a:focus-visible, .gh button:focus-visible, .gh input:focus-visible {
      outline: 2px solid ${T.sage}; outline-offset: 3px; border-radius: 10px;
    }
    .scrub { -webkit-appearance: none; appearance: none; height: 6px; border-radius: 99px; outline: none; cursor: pointer; }
    .scrub::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: ${T.cream}; border: 3px solid ${T.sageDeep}; transition: transform .2s; }
    .scrub::-webkit-slider-thumb:hover { transform: scale(1.2); }
    .scrub::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: ${T.cream}; border: 3px solid ${T.sageDeep}; }
    @keyframes rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
    .rise { animation: rise .9s cubic-bezier(.2,.7,.2,1) both; }
    @keyframes bar { 0%,100% { transform: scaleY(.35); } 50% { transform: scaleY(1); } }
    .eq span { display:inline-block; width:3px; margin-right:2px; height:14px; border-radius:2px; background:${T.sageDeep}; transform-origin: bottom; animation: bar 1s ease-in-out infinite; }
    .eq span:nth-child(2){ animation-delay:.2s } .eq span:nth-child(3){ animation-delay:.4s }
    @media (prefers-reduced-motion: reduce) { .rise, .eq span { animation: none !important; } .lift, .lift:hover { transition: none; transform: none; } }
  `}</style>
);

/* ---------- Illustrated arch scenes (no remote images) ---------- */
const SceneMorning = () => (
  <svg viewBox="0 0 200 280" className="w-full h-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="200" height="280" fill={T.blushSoft} />
    <circle cx="140" cy="95" r="34" fill="#F6E3C9" />
    <path d="M0 190 Q60 150 120 180 T200 170 V280 H0Z" fill={T.sageSoft} />
    <path d="M0 220 Q70 190 140 215 T200 205 V280 H0Z" fill={T.sage} opacity=".75" />
    <rect x="70" y="232" width="60" height="6" rx="3" fill={T.cream} opacity=".7" />
  </svg>
);
const SceneTable = () => (
  <svg viewBox="0 0 200 240" className="w-full h-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="200" height="240" fill={T.sageSoft} />
    <rect x="0" y="160" width="200" height="80" fill={T.taupeSoft} />
    <path d="M70 120 h52 v28 a26 26 0 0 1 -52 0z" fill={T.cream} />
    <path d="M122 128 q16 2 14 14 q-2 10 -14 8" fill="none" stroke={T.cream} strokeWidth="5" />
    <path d="M86 108 q4 -10 0 -18 M100 106 q4 -10 0 -20" stroke={T.taupe} strokeWidth="2.5" fill="none" strokeLinecap="round" />
    <rect x="40" y="168" width="120" height="10" rx="5" fill={T.blush} opacity=".55" />
  </svg>
);
const SceneBranch = () => (
  <svg viewBox="0 0 200 200" className="w-full h-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="200" height="200" fill={T.linen} />
    <path d="M40 180 C70 120 110 90 170 40" stroke={T.sageDeep} strokeWidth="3" fill="none" />
    {[[70,130,-30],[92,108,20],[112,92,-35],[134,72,25],[154,56,-30]].map(([x,y,r],i)=>(
      <ellipse key={i} cx={x} cy={y} rx="16" ry="7" fill={T.sage} transform={`rotate(${r} ${x} ${y})`} />
    ))}
  </svg>
);

/* ---------- Data ---------- */
const NAV = ["Ministry & Motherhood", "Podcast", "Resources", "Journal", "Shop"];

const PILLARS = [
  { icon: BookOpen, title: "Scripture-based motherhood", body: "Short daily readings that meet you between naptime and dinner.", more: "Each reading takes five minutes and ends with one question to carry into your day.", tint: T.sageSoft },
  { icon: Home, title: "Home organization tools", body: "Rhythms, checklists, and planners for a calmer household.", more: "Weekly reset lists, chore charts by age, and a meal planner that fits on the fridge.", tint: T.blushSoft },
  { icon: Mic, title: "Weekly podcast", body: "Honest conversations with mothers, mentors, and pastors' wives.", more: "New episodes every Tuesday, most under 35 minutes — about one school pickup line.", tint: T.taupeSoft },
  { icon: Users, title: "Community connection", body: "Small groups and prayer circles that gather online and nearby.", more: "Join a six-week circle by season of life: new mothers, homeschooling, or teens at home.", tint: T.sageSoft },
];

const EPISODES = [
  { n: 48, title: "When the house is loud and your heart is tired", guest: "with Hannah Okafor", length: 1920 },
  { n: 47, title: "Building a family prayer rhythm that lasts", guest: "with Pastor Ruth & Elijah Moore", length: 2280 },
  { n: 46, title: "Teaching toddlers to serve", guest: "with Leah Brennan", length: 1680 },
];

const RESOURCES = [
  { cat: "Printable", title: "Morning basket checklist", meta: "2 pages", tint: T.blushSoft, Scene: SceneMorning },
  { cat: "Guide", title: "A gentle guide to family devotions", meta: "18 min read", tint: T.sageSoft, Scene: SceneBranch },
  { cat: "Journal", title: "What Proverbs 31 is really asking of us", meta: "7 min read", tint: T.taupeSoft, Scene: SceneTable },
  { cat: "Printable", title: "Weekly home reset planner", meta: "4 pages", tint: T.sageSoft, Scene: SceneBranch },
  { cat: "Guide", title: "Sabbath rest with little ones", meta: "12 min read", tint: T.blushSoft, Scene: SceneMorning },
  { cat: "Journal", title: "Letters to the mother of a newborn", meta: "5 min read", tint: T.taupeSoft, Scene: SceneTable },
];

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/* ---------- Sections ---------- */
function Announcement() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="text-sm" style={{ background: T.sageDeep, color: T.cream }}>
      <div className="max-w-7xl mx-auto px-5 py-2 flex items-center justify-center gap-3 relative">
        <Heart size={14} />
        <p className="text-center">
          The Advent family devotional is here.{" "}
          <a href="#resources" className="underline underline-offset-4 font-semibold">Download it free</a>
        </p>
        <button onClick={() => setOpen(false)} aria-label="Dismiss announcement" className="absolute right-4 opacity-80 hover:opacity-100">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function Header() {
  const [menu, setMenu] = useState(false);
  return (
    <header className="sticky top-0 z-30 backdrop-blur" style={{ background: "rgba(251,247,241,.88)", borderBottom: `1px solid ${T.taupeSoft}` }}>
      <div className="max-w-7xl mx-auto px-5 lg:px-8 h-20 flex items-center gap-6">
        <a href="#" className="flex items-center gap-2 shrink-0">
          <span className="arch w-7 h-9 flex items-end justify-center pb-1" style={{ background: T.sage }}>
            <span className="w-2 h-2 rounded-full" style={{ background: T.cream }} />
          </span>
          <span className="serif text-2xl font-semibold" style={{ letterSpacing: "-.01em" }}>Godly Homes</span>
        </a>

        <nav className="hidden lg:flex items-center gap-7 text-sm font-medium" style={{ color: T.ink }}>
          {NAV.map((l) => (
            <a key={l} href="#" className="transition-colors hover:text-black">{l}</a>
          ))}
        </nav>

        <div className="ml-auto hidden md:flex items-center gap-3">
          <label className="flex items-center gap-2 rounded-full px-4 h-10 w-56 transition-all" style={{ background: T.linen }}>
            <Search size={16} style={{ color: T.taupe }} />
            <input placeholder="Search resources" className="bg-transparent text-sm w-full outline-none" style={{ color: T.charcoal }} aria-label="Search" />
          </label>
          <a href="#join" className="rounded-full px-5 h-10 inline-flex items-center text-sm font-semibold transition-transform hover:scale-105" style={{ background: T.blush, color: T.cream }}>
            Join community
          </a>
        </div>

        <button className="ml-auto md:ml-0 lg:hidden p-2" onClick={() => setMenu(!menu)} aria-label="Toggle menu" aria-expanded={menu}>
          {menu ? <X /> : <Menu />}
        </button>
      </div>

      {menu && (
        <div className="lg:hidden px-5 pb-6" style={{ borderTop: `1px solid ${T.taupeSoft}` }}>
          <nav className="flex flex-col pt-4">
            {NAV.map((l) => <a key={l} href="#" className="py-3 text-base" style={{ borderBottom: `1px solid ${T.taupeSoft}` }}>{l}</a>)}
          </nav>
          <a href="#join" className="mt-5 rounded-full h-12 flex items-center justify-center font-semibold" style={{ background: T.blush, color: T.cream }}>Join community</a>
        </div>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section style={{ background: `linear-gradient(180deg, ${T.cream} 0%, ${T.linen} 100%)` }}>
      <div className="max-w-7xl mx-auto px-5 lg:px-8 pt-16 pb-24 lg:pt-24 lg:pb-32 grid lg:grid-cols-12 gap-14 items-center">
        <div className="lg:col-span-6 rise">
          <h1 className="serif font-semibold leading-none" style={{ fontSize: "clamp(2.9rem, 6vw, 5.2rem)", letterSpacing: "-.02em" }}>
            Peace for the home you’re building.
          </h1>
          <p className="mt-7 text-lg leading-relaxed max-w-xl" style={{ color: T.ink }}>
            Practical help and steady encouragement for Christian mothers raising children to know and serve God — one ordinary, holy day at a time.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <a href="#podcast" className="rounded-full px-7 h-14 inline-flex items-center gap-2 font-semibold transition-transform hover:scale-105" style={{ background: T.sageDeep, color: T.cream }}>
              <Play size={18} fill={T.cream} /> Listen to the podcast
            </a>
            <a href="#resources" className="rounded-full px-7 h-14 inline-flex items-center font-semibold transition-colors" style={{ border: `1.5px solid ${T.charcoal}` }}>
              Explore resources
            </a>
          </div>
          <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm" style={{ color: T.ink }}>
            <span className="flex items-center gap-2">
              <span className="flex -space-x-2">
                {[T.blush, T.sage, T.taupe].map((c, i) => <span key={i} className="w-7 h-7 rounded-full" style={{ background: c, border: `2px solid ${T.linen}` }} />)}
              </span>
              24,000 mothers in community
            </span>
            <span>Rated 4.9 by podcast listeners</span>
          </div>
        </div>

        {/* Arch collage */}
        <div className="lg:col-span-6 relative" style={{ height: 540 }}>
          <div className="arch overflow-hidden absolute left-0 top-6 w-1/2 h-4/5 rise" style={{ animationDelay: ".15s", boxShadow: "0 30px 60px -35px rgba(47,43,39,.5)" }}>
            <SceneMorning />
          </div>
          <div className="arch overflow-hidden absolute right-0 top-0 w-5/12 h-3/5 rise" style={{ animationDelay: ".3s" }}>
            <SceneTable />
          </div>
          <figure className="absolute right-0 bottom-0 w-7/12 rounded-3xl p-7 rise" style={{ background: T.cream, animationDelay: ".45s", boxShadow: "0 24px 50px -30px rgba(47,43,39,.45)" }}>
            <blockquote className="serif italic text-2xl leading-snug" style={{ color: T.charcoal }}>
              “She is clothed with strength and dignity; she can laugh at the days to come.”
            </blockquote>
            <figcaption className="mt-4 text-sm font-semibold" style={{ color: T.sageDeep }}>Proverbs 31:25</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}

function Pillars() {
  const [active, setActive] = useState(null);
  return (
    <section className="py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-5 lg:px-8">
        <div className="max-w-2xl">
          <h2 className="serif text-4xl lg:text-5xl font-semibold leading-tight">Four ways we walk alongside you</h2>
          <p className="mt-4 text-lg" style={{ color: T.ink }}>Pick the one you need this week. Tap a card to see what’s inside.</p>
        </div>
        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {PILLARS.map((p, i) => {
            const Icon = p.icon;
            const on = active === i;
            return (
              <button key={p.title} onClick={() => setActive(on ? null : i)} aria-expanded={on}
                className="lift text-left rounded-3xl p-7 flex flex-col" style={{ background: on ? T.charcoal : p.tint, color: on ? T.cream : T.charcoal, transition: "background .35s, color .35s, transform .35s, box-shadow .35s" }}>
                <span className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: on ? T.sage : T.cream }}>
                  <Icon size={22} style={{ color: on ? T.cream : T.sageDeep }} />
                </span>
                <h3 className="serif text-2xl font-semibold mt-8 leading-tight">{p.title}</h3>
                <p className="mt-3 text-sm leading-relaxed" style={{ opacity: .85 }}>{on ? p.more : p.body}</p>
                <span className="mt-6 text-sm font-semibold underline underline-offset-4">{on ? "Show less" : "See what’s inside"}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Podcast() {
  const [ep, setEp] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(312);
  const timer = useRef(null);
  const cur = EPISODES[ep];

  useEffect(() => {
    if (playing) {
      timer.current = setInterval(() => setPos((p) => (p + 1 >= cur.length ? (setPlaying(false), cur.length) : p + 1)), 1000);
    }
    return () => clearInterval(timer.current);
  }, [playing, cur.length]);

  const pick = (i) => { setEp(i); setPos(0); setPlaying(true); };
  const pct = (pos / cur.length) * 100;

  return (
    <section id="podcast" className="py-24 lg:py-32" style={{ background: T.linen }}>
      <div className="max-w-7xl mx-auto px-5 lg:px-8 grid lg:grid-cols-12 gap-12 items-start">
        <div className="lg:col-span-5">
          <h2 className="serif text-4xl lg:text-5xl font-semibold leading-tight">The Godly Homes podcast</h2>
          <p className="mt-4 text-lg leading-relaxed" style={{ color: T.ink }}>
            New conversations every Tuesday on faith, family, and the quiet work of raising children who love the Lord.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm font-semibold">
            {["Apple Podcasts", "Spotify", "YouTube"].map((s) => (
              <a key={s} href="#" className="rounded-full px-5 h-11 inline-flex items-center transition-colors" style={{ background: T.cream, border: `1px solid ${T.taupeSoft}` }}>{s}</a>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7 rounded-3xl p-6 sm:p-8" style={{ background: T.cream, boxShadow: "0 30px 60px -40px rgba(47,43,39,.5)" }}>
          <div className="flex gap-6 items-center">
            <div className="arch overflow-hidden w-24 h-32 shrink-0"><SceneBranch /></div>
            <div className="min-w-0">
              <p className="text-sm font-semibold flex items-center gap-3" style={{ color: T.sageDeep }}>
                Episode {cur.n}
                {playing && <span className="eq" aria-hidden="true"><span /><span /><span /></span>}
              </p>
              <h3 className="serif text-2xl sm:text-3xl font-semibold leading-tight mt-1">{cur.title}</h3>
              <p className="text-sm mt-1" style={{ color: T.ink }}>{cur.guest}</p>
            </div>
          </div>

          <div className="mt-8">
            <input type="range" min="0" max={cur.length} value={pos} onChange={(e) => setPos(+e.target.value)}
              className="scrub w-full" aria-label="Seek"
              style={{ background: `linear-gradient(90deg, ${T.sageDeep} ${pct}%, ${T.taupeSoft} ${pct}%)` }} />
            <div className="flex justify-between text-xs mt-2 font-medium" style={{ color: T.ink }}>
              <span>{fmt(pos)}</span><span>-{fmt(cur.length - pos)}</span>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-center gap-6">
            <button onClick={() => setPos(Math.max(0, pos - 15))} aria-label="Back 15 seconds" className="p-2 rounded-full transition-colors hover:opacity-70"><SkipBack size={22} /></button>
            <button onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}
              className="w-16 h-16 rounded-full flex items-center justify-center transition-transform hover:scale-105" style={{ background: T.sageDeep, color: T.cream }}>
              {playing ? <Pause size={26} fill={T.cream} /> : <Play size={26} fill={T.cream} className="ml-1" />}
            </button>
            <button onClick={() => setPos(Math.min(cur.length, pos + 30))} aria-label="Forward 30 seconds" className="p-2 rounded-full transition-colors hover:opacity-70"><SkipForward size={22} /></button>
          </div>

          <ul className="mt-8" style={{ borderTop: `1px solid ${T.taupeSoft}` }}>
            {EPISODES.map((e, i) => (
              <li key={e.n} style={{ borderBottom: `1px solid ${T.taupeSoft}` }}>
                <button onClick={() => pick(i)} className="w-full flex items-center gap-4 py-4 text-left group">
                  <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors"
                    style={{ background: i === ep ? T.sageDeep : T.linen, color: i === ep ? T.cream : T.sageDeep }}>
                    <Play size={14} fill="currentColor" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-sm truncate">{e.title}</span>
                    <span className="block text-xs mt-0.5" style={{ color: T.ink }}>Episode {e.n}, {Math.round(e.length / 60)} min</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Resources() {
  const cats = ["All", "Guide", "Printable", "Journal"];
  const [cat, setCat] = useState("All");
  const list = RESOURCES.filter((r) => cat === "All" || r.cat === cat);
  const tagColor = { Guide: T.sageDeep, Printable: T.blush, Journal: T.taupe };

  return (
    <section id="resources" className="py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-5 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="max-w-xl">
            <h2 className="serif text-4xl lg:text-5xl font-semibold leading-tight">From the resource library</h2>
            <p className="mt-4 text-lg" style={{ color: T.ink }}>Our most-loved guides, printables, and journal entries.</p>
          </div>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter resources">
            {cats.map((c) => (
              <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)}
                className="rounded-full px-5 h-10 text-sm font-semibold transition-colors"
                style={{ background: cat === c ? T.charcoal : T.linen, color: cat === c ? T.cream : T.charcoal }}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {list.map(({ cat: c, title, meta, tint, Scene }) => (
            <a key={title} href="#" className="lift group rounded-3xl overflow-hidden flex flex-col" style={{ background: T.cream, border: `1px solid ${T.taupeSoft}` }}>
              <div className="h-52 overflow-hidden" style={{ background: tint }}>
                <div className="w-full h-full transition-transform duration-700 group-hover:scale-105"><Scene /></div>
              </div>
              <div className="p-6 flex flex-col flex-1">
                <span className="self-start rounded-full px-3 py-1 text-xs font-semibold" style={{ background: tint, color: tagColor[c] }}>{c}</span>
                <h3 className="serif text-2xl font-semibold leading-snug mt-4">{title}</h3>
                <p className="mt-auto pt-5 text-sm flex items-center gap-2" style={{ color: T.ink }}>
                  {c === "Printable" ? <Download size={14} /> : <BookOpen size={14} />} {meta}
                </p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function Newsletter() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | error | done
  const submit = () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) return setState("error");
    setState("done");
  };

  return (
    <section id="join" className="px-5 lg:px-8 pb-24 lg:pb-32">
      <div className="max-w-7xl mx-auto rounded-3xl overflow-hidden grid lg:grid-cols-2" style={{ background: T.sageDeep, color: T.cream }}>
        <div className="p-10 sm:p-14 lg:p-16">
          <h2 className="serif text-4xl lg:text-5xl font-semibold leading-tight">Grace-filled motherhood starts here</h2>
          <p className="mt-5 text-lg leading-relaxed" style={{ opacity: .85 }}>
            Get our free starter guide — seven days of scripture, a simple home rhythm, and a prayer for each child — plus one encouraging letter each Sunday.
          </p>

          {state === "done" ? (
            <div className="mt-10 flex items-center gap-3 rounded-2xl p-5" style={{ background: "rgba(251,247,241,.12)" }} role="status">
              <span className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: T.cream, color: T.sageDeep }}><Check size={20} /></span>
              <p>Guide sent. Check <strong>{email}</strong> for your download link.</p>
            </div>
          ) : (
            <div className="mt-10">
              <div className="flex flex-col sm:flex-row gap-3">
                <label className="flex-1 flex items-center gap-3 rounded-full px-5 h-14" style={{ background: T.cream, color: T.charcoal }}>
                  <Mail size={18} style={{ color: T.taupe }} />
                  <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setState("idle"); }}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                    placeholder="Your email address" aria-label="Email address" className="bg-transparent w-full outline-none" />
                </label>
                <button onClick={submit} className="rounded-full px-7 h-14 font-semibold transition-transform hover:scale-105" style={{ background: T.blush, color: T.cream }}>
                  Send my free guide
                </button>
              </div>
              <p className="mt-3 text-sm" style={{ opacity: state === "error" ? 1 : .7, color: state === "error" ? T.blushSoft : T.cream }}>
                {state === "error" ? "Enter an email like name@example.com to receive the guide." : "One email a week. Unsubscribe anytime."}
              </p>
            </div>
          )}
        </div>
        <div className="hidden lg:flex items-end justify-center gap-5 px-12 pt-16" style={{ background: T.sage }}>
          <div className="arch overflow-hidden w-40 h-64"><SceneMorning /></div>
          <div className="arch overflow-hidden w-48 h-80"><SceneTable /></div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const cols = {
    Explore: ["Ministry & Motherhood", "Podcast", "Resources", "Journal", "Shop"],
    Community: ["Join a circle", "Prayer requests", "Events", "Local groups"],
    About: ["Our story", "Statement of faith", "Contact", "Privacy"],
  };
  return (
    <footer style={{ background: T.charcoal, color: T.taupeSoft }}>
      <div className="max-w-7xl mx-auto px-5 lg:px-8 pt-20 pb-10">
        <div className="grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            <span className="serif text-3xl font-semibold" style={{ color: T.cream }}>Godly Homes</span>
            <blockquote className="serif italic text-2xl leading-snug mt-6 max-w-md" style={{ color: T.cream }}>
              “As for me and my house, we will serve the Lord.”
            </blockquote>
            <p className="mt-3 text-sm">Joshua 24:15</p>
            <div className="mt-8 flex gap-3">
              {[Instagram, Youtube, Facebook].map((I, i) => (
                <a key={i} href="#" aria-label="Social link" className="w-11 h-11 rounded-full flex items-center justify-center transition-colors hover:bg-white hover:text-black" style={{ border: `1px solid ${T.ink}` }}>
                  <I size={18} />
                </a>
              ))}
            </div>
          </div>
          {Object.entries(cols).map(([h, links]) => (
            <div key={h} className="lg:col-span-2">
              <h4 className="font-semibold" style={{ color: T.cream }}>{h}</h4>
              <ul className="mt-5 space-y-3 text-sm">
                {links.map((l) => <li key={l}><a href="#" className="transition-colors hover:text-white">{l}</a></li>)}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-16 pt-8 text-sm flex flex-col sm:flex-row justify-between gap-3" style={{ borderTop: `1px solid ${T.ink}` }}>
          <p>© {new Date().getFullYear()} Godly Homes. All rights reserved.</p>
          <p>Made with prayer for families everywhere.</p>
        </div>
      </div>
    </footer>
  );
}

export default function GodlyHomesHomepage() {
  return (
    <div className="gh min-h-screen">
      <Styles />
      <Announcement />
      <Header />
      <main>
        <Hero />
        <Pillars />
        <Podcast />
        <Resources />
        <Newsletter />
      </main>
      <Footer />
    </div>
  );
}
