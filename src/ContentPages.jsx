import { useState } from 'react';
import { ArrowRight, BookOpen, Heart, Home, Users, Leaf, Search, ArrowLeft, ShoppingBag, Mail, Mic, ArrowUpRight } from 'lucide-react';
import SiteLayout, { usePageMeta } from './SiteLayout.jsx';
import { NewsletterSection } from './PublicPodcast.jsx';
import { ContentStatus, useSiteContent } from './SiteContent.jsx';
import { api } from './api.js';

function PageIntro({ eyebrow, title, children }) {
  return <section className="page-intro"><div className="site-container"><p className="eyebrow">{eyebrow}</p><h1 className="copy-text">{title}</h1><p className="page-lead copy-text">{children}</p></div></section>;
}
function PendingContent() { return <SiteLayout><div className="site-container content-section"><ContentStatus /></div></SiteLayout>; }

export function AboutPage() {
  const { documents: { about, site }, loading, error } = useSiteContent();
  usePageMeta('About', about.description);
  if (loading || error) return <PendingContent />;
  return <SiteLayout>
    <section className="about-hero site-container"><div><p className="eyebrow">{about.eyebrow}</p><h1 className="copy-text">{about.title}</h1><p className="page-lead copy-text">{about.description}</p><a className="btn primary" href="/resources">Explore reflexions <ArrowRight size={16} /></a></div><div className="about-illustration" aria-hidden="true"><div className="about-arch"><Home size={62} strokeWidth={1} /><span className="serif copy-text">{about.illustrationText}</span><Leaf size={36} strokeWidth={1} /></div><span className="illustration-caption">{about.illustrationCaption}</span></div></section>
    <section className="section-linen"><div className="site-container mission-grid"><div><p className="eyebrow">{about.missionLabel}</p><h2 className="copy-text">{about.missionTitle}</h2></div><div className="prose">{about.missionParagraphs.map((paragraph, index) => <p className="copy-text" key={index}>{paragraph}</p>)}</div></div></section>
    <section className="site-container content-section"><p className="eyebrow">What guides us</p><h2>{about.valuesTitle}</h2><div className="values-grid">{about.values.map((value, index) => {
      const Icon = [BookOpen, Heart, Users][index % 3];
      return <article className="card value-card" key={index}><span className="value-icon"><Icon size={25} strokeWidth={1.5} /></span><h3>{value.title}</h3><p className="copy-text">{value.body}</p></article>;
    })}</div></section>
    <section className="site-container content-section about-connect"><div><p className="eyebrow">There’s a place for you here</p><h2>{about.connectTitle}</h2><p className="page-lead copy-text">{about.connectText}</p><div className="row"><a className="btn primary" href="/resources">Explore reflexions <ArrowRight size={15} /></a><a className="btn" href="/#podcast"><Mic size={15} />Listen to the podcast</a></div></div><div className="card"><Mail size={24} color="#76866b" /><h3>{about.contactTitle}</h3><p className="copy-text">{about.contactText}</p><a className="text-link" href={`mailto:${site.email}`}>{site.email} <ArrowRight size={14} /></a></div></section>
  </SiteLayout>;
}

export function ResourceCard({ resource }) {
  return <article className="resource-card"><a href={resource.externalUrl} target="_blank" rel="noopener noreferrer" className="resource-link-image" aria-label={`Open ${resource.title} in a new tab`}><img src={resource.imageUrl} alt={resource.imageAlt} loading="lazy" /></a><div className="resource-card-body"><p className="eyebrow">{resource.type}</p><h2><a href={resource.externalUrl} target="_blank" rel="noopener noreferrer">{resource.title}</a></h2><p>{resource.description}</p><a className="text-link" href={resource.externalUrl} target="_blank" rel="noopener noreferrer">Open resource <ArrowUpRight size={15} /></a></div></article>;
}

export function ResourcesPage() {
  const { documents, resources, loading, error } = useSiteContent();
  usePageMeta('Reflexions', documents.resources.description);
  const [query, setQuery] = useState('');
  const filtered = resources.filter(r => `${r.title} ${r.description} ${r.type}`.toLowerCase().includes(query.trim().toLowerCase()));
  if (loading || error) return <PendingContent />;
  return <SiteLayout><PageIntro eyebrow="Godly Homes reflexions" title={documents.resources.title}>{documents.resources.description}</PageIntro>
    <section className="site-container resource-library"><div className="resource-toolbar"><label className="resource-search"><Search size={17} /><span className="sr-only">Search reflexions</span><input type="search" placeholder="Find a reflexion…" value={query} onChange={e => setQuery(e.target.value)} /></label></div><p className="small muted" role="status">{filtered.length} {filtered.length === 1 ? 'reflexion' : 'reflexions'} to explore</p>
      {filtered.length ? <div className="resource-grid">{filtered.map(resource => <ResourceCard key={resource.slug} resource={resource} />)}</div> : <div className="card empty"><Search size={28} style={{ margin: '0 auto 20px', color: '#76866b' }} /><h2>{resources.length ? 'No reflexions found.' : 'Reflexions are on the way.'}</h2><p className="muted">{resources.length ? 'Try a different word.' : 'Check back soon for meaningful resources for your home.'}</p>{resources.length > 0 && <button className="btn" onClick={() => setQuery('')}>Show all reflexions</button>}</div>}
      <div className="library-note"><Leaf size={24} strokeWidth={1.4} /><p>These links open resources selected to encourage your faith, family, and home.</p></div>
    </section><NewsletterSection />
  </SiteLayout>;
}

export function ResourcePage() { return <NotFoundPage />; }

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
  return <SiteLayout><PageIntro eyebrow="A little detour" title="This page isn’t here.">Let’s help you find your way to something useful.</PageIntro><div className="site-container not-found-actions"><a className="btn primary" href="/">Back home</a><a className="btn" href="/resources">Explore reflexions</a></div></SiteLayout>;
}
