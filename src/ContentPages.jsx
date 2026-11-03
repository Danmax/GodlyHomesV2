import { useState } from 'react';
import { ArrowRight, BookOpen, Heart, Home, Users, Leaf, Search, Download, Printer, ArrowLeft, ShoppingBag, Mail, Mic, ArrowUpRight } from 'lucide-react';
import SiteLayout, { usePageMeta } from './SiteLayout.jsx';
import { NewsletterSection } from './PublicPodcast.jsx';
import { downloadWorksheet } from './resources.js';
import { ContentStatus, useSiteContent } from './SiteContent.jsx';
import { api } from './api.js';

const categoryIcons = { Faith: BookOpen, Home, Family: Users };
function PageIntro({ eyebrow, title, children }) {
  return <section className="page-intro"><div className="site-container"><p className="eyebrow">{eyebrow}</p><h1 className="copy-text">{title}</h1><p className="page-lead copy-text">{children}</p></div></section>;
}
function PendingContent() { return <SiteLayout><div className="site-container content-section"><ContentStatus /></div></SiteLayout>; }

export function AboutPage() {
  const { documents: { about, site }, loading, error } = useSiteContent();
  usePageMeta('About', about.description);
  if (loading || error) return <PendingContent />;
  return <SiteLayout>
    <section className="about-hero site-container"><div><p className="eyebrow">{about.eyebrow}</p><h1 className="copy-text">{about.title}</h1><p className="page-lead copy-text">{about.description}</p><a className="btn primary" href="/resources">Find encouragement for today <ArrowRight size={16} /></a></div><div className="about-illustration" aria-hidden="true"><div className="about-arch"><Home size={62} strokeWidth={1} /><span className="serif copy-text">{about.illustrationText}</span><Leaf size={36} strokeWidth={1} /></div><span className="illustration-caption">{about.illustrationCaption}</span></div></section>
    <section className="section-linen"><div className="site-container mission-grid"><div><p className="eyebrow">{about.missionLabel}</p><h2 className="copy-text">{about.missionTitle}</h2></div><div className="prose">{about.missionParagraphs.map((paragraph, index) => <p className="copy-text" key={index}>{paragraph}</p>)}</div></div></section>
    <section className="site-container content-section"><p className="eyebrow">What guides us</p><h2>{about.valuesTitle}</h2><div className="values-grid">{about.values.map((value, index) => {
      const Icon = [BookOpen, Heart, Users][index % 3];
      return <article className="card value-card" key={index}><span className="value-icon"><Icon size={25} strokeWidth={1.5} /></span><h3>{value.title}</h3><p className="copy-text">{value.body}</p></article>;
    })}</div></section>
    <section className="site-container content-section about-connect"><div><p className="eyebrow">There’s a place for you here</p><h2>{about.connectTitle}</h2><p className="page-lead copy-text">{about.connectText}</p><div className="row"><a className="btn primary" href="/resources">Explore resources <ArrowRight size={15} /></a><a className="btn" href="/#podcast"><Mic size={15} />Listen to the podcast</a></div></div><div className="card"><Mail size={24} color="#76866b" /><h3>{about.contactTitle}</h3><p className="copy-text">{about.contactText}</p><a className="text-link" href={`mailto:${site.email}`}>{site.email} <ArrowRight size={14} /></a></div></section>
  </SiteLayout>;
}

export function ResourceCard({ resource }) {
  const Icon = categoryIcons[resource.category] || BookOpen;
  return <article className="resource-card"><a href={`/resources/${resource.slug}`} className={`resource-art resource-art-${['Home', 'Family'].includes(resource.category) ? resource.category.toLowerCase() : 'faith'}`} aria-label={`Read ${resource.title}`}><span className="resource-art-label">GODLY HOMES</span><Icon size={48} strokeWidth={1} /><span className="serif">{resource.title}</span><span className="resource-art-detail">A LITTLE HELP FOR TODAY</span></a><div className="resource-card-body"><div className="row between"><span className="eyebrow">{resource.category} · {resource.type}</span><span className="small muted">{resource.minutes} min read</span></div><h2><a href={`/resources/${resource.slug}`}>{resource.title}</a></h2><p>{resource.description}</p><a className="text-link" href={`/resources/${resource.slug}`}>Read & reflect <ArrowRight size={15} /></a></div></article>;
}

export function ResourcesPage() {
  const { documents, resources, loading, error } = useSiteContent();
  usePageMeta('Resources', documents.resources.description);
  const [category, setCategory] = useState('All'), [query, setQuery] = useState('');
  const categories = ['All', ...new Set(resources.map(resource => resource.category))];
  const filtered = resources.filter(r => (category === 'All' || r.category === category) && `${r.title} ${r.description} ${r.category} ${r.type}`.toLowerCase().includes(query.trim().toLowerCase()));
  if (loading || error) return <PendingContent />;
  return <SiteLayout><PageIntro eyebrow="The resource library" title={documents.resources.title}>{documents.resources.description}</PageIntro>
    <section className="site-container resource-library"><div className="resource-toolbar"><div className="resource-filters" role="group" aria-label="Filter resources">{categories.map(item => <button key={item} className={`btn ${category === item ? 'primary' : ''}`} aria-pressed={category === item} onClick={() => setCategory(item)}>{item === 'All' ? 'All resources' : item}</button>)}</div><label className="resource-search"><Search size={17} /><span className="sr-only">Search resources</span><input type="search" placeholder="Find a little help…" value={query} onChange={e => setQuery(e.target.value)} /></label></div><p className="small muted" role="status">{filtered.length} {filtered.length === 1 ? 'resource' : 'resources'}{category !== 'All' ? ` for ${category.toLowerCase()}` : ' to explore'}</p>
      {filtered.length ? <div className="resource-grid">{filtered.map(resource => <ResourceCard key={resource.slug} resource={resource} />)}</div> : <div className="card empty"><Search size={28} style={{ margin: '0 auto 20px', color: '#76866b' }} /><h2>{resources.length ? 'No resources found.' : 'New resources are on the way.'}</h2><p className="muted">{resources.length ? 'Try a different word or explore the full library.' : 'Check back soon for encouragement for your home.'}</p>{resources.length > 0 && <button className="btn" onClick={() => { setCategory('All'); setQuery(''); }}>Show all resources</button>}</div>}
      <div className="library-note"><Leaf size={24} strokeWidth={1.4} /><p>Take what serves your family today. Read online, print a guide, or download its worksheet when one is included.</p></div>
    </section><NewsletterSection />
  </SiteLayout>;
}

export function ResourcePage({ slug }) {
  const { resources, loading, error } = useSiteContent();
  const resource = resources.find(r => r.slug === slug);
  usePageMeta(resource?.title || 'Resources', resource?.description || 'Explore the Godly Homes resource library.');
  if (loading || error) return <PendingContent />;
  if (!resource) return <NotFoundPage />;
  return <SiteLayout><article className="resource-detail site-container"><a className="btn ghost no-print" href="/resources"><ArrowLeft size={15} />Back to resources</a><header><p className="eyebrow">{resource.category} · {resource.type} · {resource.minutes} min read</p><h1>{resource.title}</h1><p className="page-lead">{resource.description}</p><div className="row no-print">{resource.prompts.length > 0 && <button className="btn primary" onClick={() => downloadWorksheet(resource)}><Download size={15} />Download worksheet <span className="download-format">.txt</span></button>}<button className="btn" onClick={() => window.print()}><Printer size={15} />Print this guide</button></div></header><div className="resource-detail-grid"><div className="prose"><p className="resource-introduction copy-text">{resource.introduction}</p>{resource.steps.map(([title, body], i) => <section key={i}><p className="eyebrow">{String(i + 1).padStart(2, '0')}</p><h2>{title}</h2><p className="copy-text">{body}</p></section>)}</div><aside className="reflection-card"><p className="eyebrow">Pause & reflect</p>{resource.scripture && <p className="scripture-reference"><BookOpen size={18} />Suggested reading: {resource.scripture}</p>}<h2>A little space<br />for your thoughts.</h2>{resource.prompts.map((prompt, i) => <div className="reflection-prompt" key={i}><p>{prompt}</p><div aria-hidden="true" /></div>)}<p className="small muted">For personal and household use.</p></aside></div>{resources.length > 1 && <section className="related-resources no-print"><p className="eyebrow">Keep exploring</p><h2>A little more encouragement.</h2><div className="resource-grid">{resources.filter(r => r.slug !== slug).slice(0, 3).map(r => <ResourceCard resource={r} key={r.slug} />)}</div></section>}</article></SiteLayout>;
}

const price = item => item.priceCents === null ? 'Contact for pricing' : new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency }).format(item.priceCents / 100);
function PurchaseLink({ product }) {
  const { documents: { site } } = useSiteContent();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const checkout = async () => {
    setBusy(true); setError('');
    try { const result = await api('/api/store/checkout', { method: 'POST', body: { productId: product.id } }); location.assign(result.url); }
    catch (error) { setError(error.message); setBusy(false); }
  };
  if (product.stripePriceId) return <><button className="btn primary" disabled={busy} onClick={checkout}>{busy ? 'Opening checkout…' : 'Buy now'} <ArrowUpRight size={15} /></button>{error && <p className="message error" role="alert">{error}</p>}</>;
  return product.checkoutUrl ? <a className="btn primary" href={product.checkoutUrl} target="_blank" rel="noopener noreferrer">Buy {product.kind === 'digital' ? 'digital resource' : 'item'} <ArrowUpRight size={15} /></a> : <a className="btn" href={`mailto:${site.email}?subject=${encodeURIComponent(`Question about ${product.title}`)}`}>Ask about this item <Mail size={15} /></a>;
}
function ProductCard({ product }) {
  return <article className="resource-card product-card"><a className="product-art" href={`/store/${product.slug}`} aria-label={`View ${product.title}`}>{product.imageUrl ? <img src={product.imageUrl} alt={product.imageAlt || product.title} loading="lazy" /> : <ShoppingBag size={55} strokeWidth={1} />}</a><div className="resource-card-body"><p className="eyebrow">{product.kind === 'digital' ? 'Digital resource' : 'Physical product'}</p><h2><a href={`/store/${product.slug}`}>{product.title}</a></h2><p>{product.description.slice(0, 180)}{product.description.length > 180 ? '…' : ''}</p><strong className="product-price">{price(product)}</strong><a className="text-link" href={`/store/${product.slug}`}>View item <ArrowRight size={15} /></a></div></article>;
}

export function StorePage() {
  const { documents: { store }, products, loading, error } = useSiteContent();
  const [kind, setKind] = useState('all');
  usePageMeta('Store', store.description);
  if (loading || error) return <PendingContent />;
  const filtered = products.filter(p => kind === 'all' || p.kind === kind);
  return <SiteLayout><PageIntro eyebrow="The Godly Homes store" title={store.title}>{store.description}</PageIntro>{products.length ? <section className="site-container content-section"><div className="resource-filters" role="group" aria-label="Filter store items">{[['all', 'All items'], ['digital', 'Digital resources'], ['physical', 'Physical products']].map(([id, label]) => <button className={`btn ${kind === id ? 'primary' : ''}`} aria-pressed={kind === id} key={id} onClick={() => setKind(id)}>{label}</button>)}</div><div className="resource-grid">{filtered.map(product => <ProductCard key={product.id} product={product} />)}</div>{!filtered.length && <p className="message">No items in this category yet.</p>}</section> : <section className="site-container store-section"><div className="store-preview" aria-hidden="true"><div className="store-paper"><Leaf size={30} strokeWidth={1} /><span className="eyebrow">GODLY HOMES</span><span className="serif">Room<br />for grace.</span><span className="store-paper-line" /><span className="small">Faith · Family · Home</span></div><span className="store-seal"><Heart size={22} strokeWidth={1.4} /></span></div><div className="store-message"><span className="badge draft"><ShoppingBag size={13} />Coming soon</span><h2 className="copy-text">{store.emptyTitle}</h2><p className="copy-text">{store.emptyText}</p><p>In the meantime, our free resource library is open. Find a reflection, a practical home checklist, or a guide to help your family connect.</p><a className="btn primary" href="/resources">Explore free resources <ArrowRight size={16} /></a><p className="store-availability">No products are available for purchase yet.</p></div></section>}<NewsletterSection /></SiteLayout>;
}

export function ProductPage({ slug }) {
  const { products, loading, error } = useSiteContent();
  const product = products.find(item => item.slug === slug);
  usePageMeta(product?.title || 'Store', product?.description || 'Explore the Godly Homes store.');
  if (loading || error) return <PendingContent />;
  if (!product) return <NotFoundPage />;
  return <SiteLayout><section className="site-container product-detail"><a className="btn ghost" href="/store"><ArrowLeft size={15} />Back to store</a><div className="store-section"><div className="product-art product-detail-art">{product.imageUrl ? <img src={product.imageUrl} alt={product.imageAlt || product.title} /> : <ShoppingBag size={72} strokeWidth={1} />}</div><div><p className="eyebrow">{product.kind === 'digital' ? 'Digital resource' : 'Physical product'}</p><h1>{product.title}</h1><p className="product-price">{price(product)}</p><p className="notes">{product.description}</p><PurchaseLink product={product} />{product.stripePriceId && <><p className="small muted">{product.stripeLivemode ? 'Secure checkout with Stripe.' : 'Test checkout — no live payment.'} {product.kind === 'physical' ? 'Shipping and any applicable tax are shown at checkout.' : 'Our team will send your resource to the email provided at checkout.'}</p>{new URLSearchParams(location.search).get('checkout') === 'cancelled' && <p className="message" role="status">You returned from checkout. You can try again when you’re ready.</p>}</>}{product.checkoutUrl && <p className="small muted" style={{ marginTop: 16 }}>Checkout opens with the seller’s payment provider.</p>}</div></div></section></SiteLayout>;
}

export function NotFoundPage() {
  return <SiteLayout><PageIntro eyebrow="A little detour" title="This page isn’t here.">Let’s help you find your way to something useful.</PageIntro><div className="site-container not-found-actions"><a className="btn primary" href="/">Back home</a><a className="btn" href="/resources">Explore resources</a></div></SiteLayout>;
}
