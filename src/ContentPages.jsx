import { useState } from 'react';
import { ArrowRight, BookOpen, Heart, Home, Users, Leaf, Search, Download, Printer, ArrowLeft, ShoppingBag, Mail, Mic } from 'lucide-react';
import SiteLayout, { usePageMeta } from './SiteLayout.jsx';
import { NewsletterSection } from './PublicPodcast.jsx';
import { resources, downloadWorksheet } from './resources.js';

const categoryIcons = { Faith: BookOpen, Home, Family: Users };

function PageIntro({ eyebrow, title, children }) {
  return <section className="page-intro"><div className="site-container"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-lead">{children}</p></div></section>;
}

export function AboutPage() {
  usePageMeta('About', 'Get to know Godly Homes: faith, family, motherhood, and practical encouragement for ordinary days.');
  return <SiteLayout>
    <section className="about-hero site-container"><div><p className="eyebrow">Family · Motherhood · Ministry</p><h1>Faith takes root<br />in ordinary places.</h1><p className="page-lead">Around the kitchen table. In a bedtime prayer. In the small ways we care for one another.</p><a className="btn primary" href="/resources">Find encouragement for today <ArrowRight size={16} /></a></div><div className="about-illustration" aria-hidden="true"><div className="about-arch"><Home size={62} strokeWidth={1} /><span className="serif">A home filled<br />with grace.</span><Leaf size={36} strokeWidth={1} /></div><span className="illustration-caption">Rooted in faith. Growing together.</span></div></section>
    <section className="section-linen"><div className="site-container mission-grid"><div><p className="eyebrow">Why Godly Homes</p><h2>A little help for the<br />home you’re building.</h2></div><div className="prose"><p>Godly Homes is a place for Christian mothers and families seeking to bring faith into everyday life. We share practical ideas, thoughtful reflections, and podcast conversations about caring for our homes and the people in them.</p><p>We believe ordinary moments matter. A home doesn’t need to be perfectly organized to be a place of love, welcome, and spiritual growth. Our hope is to offer encouragement you can carry into the life you already have.</p></div></div></section>
    <section className="site-container content-section"><p className="eyebrow">What guides us</p><h2>Steady roots. Gentle rhythms.</h2><div className="values-grid">{[
      [BookOpen, 'Rooted in scripture', 'Making room to read, reflect, and pray, with faith woven into the ordinary parts of family life.'],
      [Heart, 'Grace for real life', 'Encouragement that meets families amid busy mornings, unfinished tasks, and fresh beginnings.'],
      [Users, 'Care for one another', 'Listening well, sharing the work, and making space for connection across the seasons of family life.'],
    ].map(([Icon, title, body]) => <article className="card value-card" key={title}><span className="value-icon"><Icon size={25} strokeWidth={1.5} /></span><h3>{title}</h3><p>{body}</p></article>)}</div></section>
    <section className="site-container content-section about-connect"><div><p className="eyebrow">There’s a place for you here</p><h2>Start with one small thing.</h2><p className="page-lead">Read a reflection, try a simple home rhythm, or listen to a conversation as you go about your day.</p><div className="row"><a className="btn primary" href="/resources">Explore resources <ArrowRight size={15} /></a><a className="btn" href="/#podcast"><Mic size={15} />Listen to the podcast</a></div></div><div className="card"><Mail size={24} color="#76866b" /><h3>We’d love to hear from you.</h3><p>Have a question or an idea for a future conversation?</p><a className="text-link" href="mailto:hello@godlyhomes.com">hello@godlyhomes.com <ArrowRight size={14} /></a></div></section>
  </SiteLayout>;
}

export function ResourceCard({ resource }) {
  const Icon = categoryIcons[resource.category];
  return <article className="resource-card"><a href={`/resources/${resource.slug}`} className={`resource-art resource-art-${resource.category.toLowerCase()}`} aria-label={`Read ${resource.title}`}><span className="resource-art-label">GODLY HOMES</span><Icon size={48} strokeWidth={1} /><span className="serif">{resource.title}</span><span className="resource-art-detail">A LITTLE HELP FOR TODAY</span></a><div className="resource-card-body"><div className="row between"><span className="eyebrow">{resource.category} · {resource.type}</span><span className="small muted">{resource.minutes} min read</span></div><h2><a href={`/resources/${resource.slug}`}>{resource.title}</a></h2><p>{resource.description}</p><a className="text-link" href={`/resources/${resource.slug}`}>Read & reflect <ArrowRight size={15} /></a></div></article>;
}

export function ResourcesPage() {
  usePageMeta('Resources', 'Free faith reflections, family conversation guides, and practical home worksheets from Godly Homes.');
  const [category, setCategory] = useState('All'), [query, setQuery] = useState('');
  const filtered = resources.filter(r => (category === 'All' || r.category === category) && `${r.title} ${r.description} ${r.category} ${r.type}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <SiteLayout><PageIntro eyebrow="The resource library" title="Small steps. Steady grace.">A little encouragement for your faith, your family, and the home you’re building. Free to read, save, and return to.</PageIntro>
    <section className="site-container resource-library"><div className="resource-toolbar"><div className="resource-filters" role="group" aria-label="Filter resources">{['All', 'Faith', 'Home', 'Family'].map(item => <button key={item} className={`btn ${category === item ? 'primary' : ''}`} aria-pressed={category === item} onClick={() => setCategory(item)}>{item === 'All' ? 'All resources' : item}</button>)}</div><label className="resource-search"><Search size={17} /><span className="sr-only">Search resources</span><input type="search" placeholder="Find a little help…" value={query} onChange={e => setQuery(e.target.value)} /></label></div><p className="small muted" role="status">{filtered.length} {filtered.length === 1 ? 'resource' : 'resources'}{category !== 'All' ? ` for ${category.toLowerCase()}` : ' to explore'}</p>
      {filtered.length ? <div className="resource-grid">{filtered.map(resource => <ResourceCard key={resource.slug} resource={resource} />)}</div> : <div className="card empty"><Search size={28} style={{ margin: '0 auto 20px', color: '#76866b' }} /><h2>No resources found.</h2><p className="muted">Try a different word or explore the full library.</p><button className="btn" onClick={() => { setCategory('All'); setQuery(''); }}>Show all resources</button></div>}
      <div className="library-note"><Leaf size={24} strokeWidth={1.4} /><p>Take what serves your family today. Each resource includes a simple text worksheet you can download or a page you can print.</p></div>
    </section><NewsletterSection />
  </SiteLayout>;
}

export function ResourcePage({ slug }) {
  const resource = resources.find(r => r.slug === slug);
  usePageMeta(resource?.title || 'Resource not found', resource?.description || 'Explore the Godly Homes resource library.');
  if (!resource) return <NotFoundPage />;
  return <SiteLayout><article className="resource-detail site-container"><a className="btn ghost no-print" href="/resources"><ArrowLeft size={15} />Back to resources</a><header><p className="eyebrow">{resource.category} · {resource.type} · {resource.minutes} min read</p><h1>{resource.title}</h1><p className="page-lead">{resource.description}</p><div className="row no-print"><button className="btn primary" onClick={() => downloadWorksheet(resource)}><Download size={15} />Download worksheet <span className="download-format">.txt</span></button><button className="btn" onClick={() => window.print()}><Printer size={15} />Print this guide</button></div></header><div className="resource-detail-grid"><div className="prose"><p className="resource-introduction">{resource.introduction}</p>{resource.steps.map(([title, body], i) => <section key={title}><p className="eyebrow">0{i + 1}</p><h2>{title}</h2><p>{body}</p></section>)}</div><aside className="reflection-card"><p className="eyebrow">Pause & reflect</p>{resource.scripture && <p className="scripture-reference"><BookOpen size={18} />Suggested reading: {resource.scripture}</p>}<h2>A little space<br />for your thoughts.</h2>{resource.prompts.map((prompt, i) => <div className="reflection-prompt" key={i}><p>{prompt}</p><div aria-hidden="true" /></div>)}<p className="small muted">For personal and household use.</p></aside></div><section className="related-resources no-print"><p className="eyebrow">Keep exploring</p><h2>A little more encouragement.</h2><div className="resource-grid">{resources.filter(r => r.slug !== slug).slice(0, 3).map(r => <ResourceCard resource={r} key={r.slug} />)}</div></section></article></SiteLayout>;
}

export function StorePage() {
  usePageMeta('Store', 'The Godly Homes store is coming soon. Explore our free resources and join the list for future store updates.');
  return <SiteLayout><PageIntro eyebrow="The Godly Homes store" title="Thoughtful things for ordinary days.">A place for resources that help you bring faith, care, and intention into the life of your home.</PageIntro><section className="site-container store-section"><div className="store-preview" aria-hidden="true"><div className="store-paper"><Leaf size={30} strokeWidth={1} /><span className="eyebrow">GODLY HOMES</span><span className="serif">Room<br />for grace.</span><span className="store-paper-line" /><span className="small">Faith · Family · Home</span></div><span className="store-seal"><Heart size={22} strokeWidth={1.4} /></span></div><div className="store-message"><span className="badge draft"><ShoppingBag size={13} />Coming soon</span><h2>Good things take<br />a little tending.</h2><p>Our store is taking shape. We’ll share what’s available here when it’s ready.</p><p>In the meantime, our free resource library is open. Find a reflection for a quiet moment, a practical home checklist, or a guide to help your family connect.</p><a className="btn primary" href="/resources">Explore free resources <ArrowRight size={16} /></a><p className="store-availability">No products are available for purchase yet.</p></div></section><NewsletterSection /></SiteLayout>;
}

export function NotFoundPage() {
  return <SiteLayout><PageIntro eyebrow="A little detour" title="This page isn’t here.">Let’s help you find your way to something useful.</PageIntro><div className="site-container not-found-actions"><a className="btn primary" href="/">Back home</a><a className="btn" href="/resources">Explore resources</a></div></SiteLayout>;
}
