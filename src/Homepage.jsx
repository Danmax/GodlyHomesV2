import { PodcastSection, NewsletterSection } from "./PublicPodcast.jsx";
import { useState } from "react";
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
const NAV = ["Our approach", "Podcast", "Resources", "Studio"];
const NAV_LINKS = { "Our approach": "#approach", Podcast: "#podcast", Resources: "#resources", Studio: "/studio" };

const PILLARS = [
  { icon: BookOpen, title: "Scripture for ordinary days", body: "Small moments to reflect, pray, and begin again.", more: "Start with the quiet beginning below: read Psalm 23 and pray for each member of your household.", tint: T.sageSoft },
  { icon: Home, title: "Gentle home rhythms", body: "Simple, practical steps for a calmer household.", more: "Try the home reset below. Choose one surface, one load of laundry, and one meal. There’s grace for the rest.", tint: T.blushSoft },
  { icon: Mic, title: "The Godly Homes podcast", body: "Encouragement about faith, family, and the home you’re building.", more: "Listen on this page as episodes are published, or add our RSS feed to your podcast app.", tint: T.taupeSoft },
  { icon: Users, title: "Stay connected", body: "Keep up with new conversations and resources.", more: "Join the updates list below, or reach out to hello@godlyhomes.com to connect with our team.", tint: T.sageSoft },
];

/* ---------- Sections ---------- */
function Announcement() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="text-sm" style={{ background: T.sageDeep, color: T.cream }}>
      <div className="max-w-7xl mx-auto px-5 py-2 flex items-center justify-center gap-3 relative">
        <Heart size={14} />
        <p className="text-center">
          A little encouragement for the home you’re building.{" "}
          <a href="#podcast" className="underline underline-offset-4 font-semibold">Explore the podcast</a>
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
            <a key={l} href={NAV_LINKS[l]} className="transition-colors hover:text-black">{l}</a>
          ))}
        </nav>

        <div className="ml-auto hidden md:flex items-center gap-3">
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
            {NAV.map((l) => <a key={l} href={NAV_LINKS[l]} onClick={() => setMenu(false)} className="py-3 text-base" style={{ borderBottom: `1px solid ${T.taupeSoft}` }}>{l}</a>)}
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
              Faith, family, and ordinary days
            </span>
            <span>Rooted in scripture</span>
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
    <section id="approach" className="py-24 lg:py-32">
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

function Podcast() { return <PodcastSection />; }

function Resources() {
  const items = [
    ["A quiet beginning", "Set aside five minutes before the day gets busy. Read Psalm 23, write one sentence of gratitude, and pray for each member of your household by name."],
    ["A gentle home reset", "Choose one surface to clear, start one load of laundry, and decide what’s for dinner. Invite children to help with one task they can finish. Small, steady steps count."],
    ["A family prayer rhythm", "Choose a moment you already share: breakfast, the school run, or bedtime. Let each person name one thing they’re thankful for and one person to pray for."],
  ];
  return <section id="resources" className="py-24 px-5 lg:px-8"><div className="max-w-7xl mx-auto"><p className="eyebrow">Small steps, steady grace</p><h2 className="serif text-5xl font-semibold">A little help for today.</h2><div className="grid md:grid-cols-3 gap-6 mt-10">{items.map(([title, body]) => <article className="card" key={title}><h3 className="serif text-3xl">{title}</h3><p className="mt-4 leading-relaxed" style={{color:T.ink}}>{body}</p></article>)}</div></div></section>;
}

function Newsletter() { return <NewsletterSection />; }

function Footer() { return <footer className="px-5 py-12" style={{background:T.charcoal,color:T.cream}}><div className="max-w-7xl mx-auto flex flex-wrap gap-8 items-center justify-between"><div><p className="serif text-3xl">Godly Homes</p><p className="text-sm mt-2">Peace for the home you’re building.</p></div><nav className="flex flex-wrap gap-6 text-sm" aria-label="Footer"><a href="#podcast">Podcast</a><a href="#resources">Resources</a><a href="mailto:hello@godlyhomes.com">Contact</a><a href="/studio">Studio sign in</a></nav><p className="text-xs w-full" style={{opacity:.65}}>© {new Date().getFullYear()} Godly Homes</p></div></footer>; }

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
