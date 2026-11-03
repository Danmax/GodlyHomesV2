import { useCallback, useEffect, useRef, useState, useId } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, FileText, Home, Image, Mail, Plus, Save, Settings, ShoppingBag, Trash2, Upload } from 'lucide-react';
import { api } from './api.js';
import { useSiteContent } from './SiteContent.jsx';
import { documentFields } from './admin-fields.js';
import CommerceAdmin from './CommerceAdmin.jsx';

const sections = [
  { id: 'about', label: 'About page', icon: FileText, document: 'about', href: '/about' },
  { id: 'home', label: 'Homepage', icon: Home, document: 'home', href: '/' },
  { id: 'library', label: 'Resources', icon: BookOpen, kind: 'resource', href: '/resources' },
  { id: 'products', label: 'Store items', icon: ShoppingBag, kind: 'product', href: '/store' },
  { id: 'stripe', label: 'Stripe catalog', icon: ShoppingBag, href: '/store' },
  { id: 'orders', label: 'Orders', icon: ShoppingBag, href: '/store' },
  { id: 'site', label: 'Site settings', icon: Settings, document: 'site', href: '/' },
  { id: 'resources', label: 'Resources page', icon: FileText, document: 'resources', href: '/resources' },
  { id: 'store', label: 'Store page', icon: FileText, document: 'store', href: '/store' },
  { id: 'newsletter', label: 'Email signup', icon: Mail, document: 'newsletter', href: '/#join' },
];
const slugify = value => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 160);
const emptyEntry = kind => ({ slug: '', status: 'draft', sortOrder: 0, version: 1, data: kind === 'resource'
  ? { title: '', description: '', category: 'Faith', type: 'Guide', minutes: 3, introduction: '', scripture: '', steps: [], prompts: [] }
  : { title: '', description: '', kind: 'digital', priceCents: null, currency: 'USD', imageUrl: '', imageAlt: '', checkoutUrl: '' } });

export default function AdminPanel({ onDirtyChange }) {
  const [active, setActive] = useState('about'), [documents, setDocuments] = useState(null), [error, setError] = useState('');
  const dirty = useRef(false), setDirty = useCallback(value => { dirty.current = value; onDirtyChange?.(value); }, [onDirtyChange]);
  useEffect(() => {
    api('/api/admin/documents').then(setDocuments).catch(error => setError(error.message));
    const warn = event => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const section = sections.find(item => item.id === active);
  const select = id => {
    if (id === active) return;
    if (dirty.current && !confirm('Discard the changes you haven’t saved?')) return;
    setDirty(false); setActive(id);
  };
  return <>
    <div className="row between admin-heading"><div><p className="eyebrow">Your website, in your hands</p><h1>Website Admin</h1><p className="muted">Manage your pages, resources, and items for sale.</p></div><a className="btn" href={section.href} target="_blank" rel="noopener noreferrer">View website <ArrowUpRight size={15} /></a></div>
    {error && <p className="message error" role="alert">{error}</p>}
    <div className="admin-layout"><nav className="admin-nav" aria-label="Website administration">{sections.map(item => <button key={item.id} aria-current={active === item.id ? 'page' : undefined} onClick={() => select(item.id)}><item.icon size={17} />{item.label}</button>)}</nav><section className="admin-content">
      {['stripe', 'orders'].includes(section.id) ? <CommerceAdmin key={section.id} ordersOnly={section.id === 'orders'} /> : section.kind ? <EntriesManager key={section.id} kind={section.kind} onDirty={setDirty} /> : documents ? <DocumentEditor key={section.id} document={documents.find(d => d.key === section.document)} title={section.label} onDirty={setDirty} onSaved={result => setDocuments(list => list.map(item => item.key === result.key ? { ...item, ...result } : item))} /> : <p role="status">Loading page settings…</p>}
    </section></div>
  </>;
}

function TextField({ label, value, onChange, multiline = false, type = 'text', ...props }) {
  const id = useId();
  return <div className="admin-text-field"><label htmlFor={id}>{label}</label>{multiline ? <textarea id={id} className="field" rows={4} value={value} onChange={e => onChange(e.target.value)} {...props} /> : <input id={id} className="field" type={type} value={value} onChange={e => onChange(e.target.value)} {...props} />}</div>;
}

function ImageField({ label, value, onChange, onBusy }) {
  const id = useId(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const upload = async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    setError(''); setBusy(true); onBusy(true);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB.');
      const data = new FormData(); data.append('image', file);
      const image = await api('/api/admin/images', { method: 'POST', body: data }); onChange(image.url);
    } catch (error) { setError(error.message); }
    finally { setBusy(false); onBusy(false); }
  };
  return <div className="admin-image-field"><TextField label={label} value={value} onChange={onChange} /><label className="btn" htmlFor={id}><Upload size={14} />{busy ? 'Uploading…' : 'Upload image'}</label><input id={id} className="admin-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} disabled={busy} aria-label={`Upload ${label.toLowerCase()}`} /><p className="small muted">PNG, JPEG, or WebP up to 5 MB. Save the form to use this image.</p>{value && <img className="admin-image-preview" src={value} alt="Selected image preview" />}{error && <p className="message error" role="alert">{error}</p>}</div>;
}

function Repeater({ type, label, value, onChange }) {
  const max = { navigation: 6, values: 8, paragraphs: 10, steps: 20, prompts: 30 }[type];
  const blank = { navigation: { label: '', href: '/' }, values: { title: '', body: '' }, paragraphs: '', steps: ['', ''], prompts: '' }[type];
  const update = (index, next) => onChange(value.map((item, i) => i === index ? next : item));
  return <section className="admin-repeater"><h3>{label}</h3>{value.map((item, index) => <div className="admin-repeat-item" key={index}>
    {type === 'navigation' ? <><TextField label={`Navigation ${index + 1} label`} value={item.label} onChange={label => update(index, { ...item, label })} /><TextField label={`Navigation ${index + 1} address`} value={item.href} onChange={href => update(index, { ...item, href })} /></>
      : type === 'values' ? <><TextField label={`Value ${index + 1} title`} value={item.title} onChange={title => update(index, { ...item, title })} /><TextField label={`Value ${index + 1} description`} multiline value={item.body} onChange={body => update(index, { ...item, body })} /></>
        : type === 'steps' ? <><TextField label={`Step ${index + 1} heading`} value={item[0]} onChange={title => update(index, [title, item[1]])} /><TextField label={`Step ${index + 1} text`} multiline value={item[1]} onChange={body => update(index, [item[0], body])} /></>
          : <TextField label={`${type === 'paragraphs' ? 'Mission paragraph' : 'Reflection prompt'} ${index + 1}`} multiline={type === 'paragraphs'} value={item} onChange={next => update(index, next)} />}
    <button type="button" className="btn icon danger" aria-label={`Remove ${label.toLowerCase()} ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
  </div>)}<button type="button" className="btn" disabled={value.length >= max} onClick={() => onChange([...value, structuredClone(blank)])}><Plus size={14} />Add {type === 'navigation' ? 'link' : type === 'values' ? 'value' : type === 'paragraphs' ? 'paragraph' : type === 'steps' ? 'step' : 'prompt'}</button></section>;
}

function DocumentEditor({ document, title, onDirty, onSaved }) {
  const { refresh } = useSiteContent();
  const [data, setData] = useState(() => structuredClone(document.data)), [version, setVersion] = useState(document.version);
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const change = (key, value) => { setData(previous => ({ ...previous, [key]: value })); onDirty(true); setSaved(false); };
  const save = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api(`/api/admin/documents/${document.key}`, { method: 'PUT', body: { data, version } });
      setVersion(result.version); onSaved(result); onDirty(false); setSaved(true); await refresh();
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  return <form className="card admin-form" onSubmit={save}><div className="row between"><h2>{title}</h2><span className="badge">Live page settings</span></div><p className="small muted">Changes appear on the website when you save. Text is displayed as written; line breaks are supported.</p>{error && <p className="message error" role="alert">{error}</p>}{saved && <p className="message" role="status">Saved. Your changes are live.</p>}<fieldset disabled={busy} className="fields">
    {documentFields[document.key].map(([key, label, type]) => type === 'image' ? <ImageField key={key} label={label} value={data[key]} onChange={value => change(key, value)} onBusy={setUploading} />
      : type === 'checkbox' ? <label className="row" key={key}><input type="checkbox" checked={data[key]} onChange={e => change(key, e.target.checked)} />{label}</label>
        : ['navigation', 'values', 'paragraphs'].includes(type) ? <Repeater key={key} type={type} label={label} value={data[key]} onChange={value => change(key, value)} />
          : <TextField key={key} label={label} value={data[key]} multiline={type === 'textarea'} type={type === 'email' ? 'email' : 'text'} onChange={value => change(key, value)} required />)}
  </fieldset><div className="admin-save-bar"><button className="btn primary" disabled={busy || uploading}><Save size={15} />{busy ? 'Saving…' : 'Save and publish'}</button></div></form>;
}

function EntriesManager({ kind, onDirty }) {
  const { refresh } = useSiteContent();
  const [items, setItems] = useState([]), [selected, setSelected] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState('');
  const load = useCallback(async () => { try { setItems(await api(`/api/admin/entries/${kind}`)); } catch (error) { setError(error.message); } finally { setLoading(false); } }, [kind]);
  useEffect(() => { load(); }, [load]);
  const back = () => { if (!confirm('Return to the list? Any changes you haven’t saved will be discarded.')) return; onDirty(false); setSelected(null); };
  const saved = async item => { onDirty(false); setSelected(item); setMessage(`${kind === 'resource' ? 'Resource' : 'Store item'} saved. ${item.status === 'published' ? 'It is live on the website.' : 'It remains a private draft.'}`); await load(); await refresh(); };
  const remove = async item => {
    if (!confirm(`Permanently delete “${item.data.title}”? This removes it from the website and cannot be undone.`)) return;
    try { await api(`/api/admin/entries/${kind}/${item.id}`, { method: 'DELETE', body: { version: item.version } }); onDirty(false); setSelected(null); setMessage('Item deleted.'); await load(); await refresh(); }
    catch (error) { setError(error.message); }
  };
  return <>{error && <p className="message error" role="alert">{error}</p>}{message && <p className="message" role="status">{message}</p>}{selected ? <><button className="btn ghost" onClick={back}><ArrowLeft size={15} />Back to {kind === 'resource' ? 'resources' : 'store items'}</button><EntryEditor key={selected.id || 'new'} kind={kind} entry={selected} onDirty={onDirty} onSaved={saved} onDelete={remove} /></> : <><div className="row between"><div><h2>{kind === 'resource' ? 'Resources' : 'Store items'}</h2><p className="small muted">{kind === 'resource' ? 'Create guides, reflections, and downloadable worksheets.' : 'Manage digital resources and physical products.'}</p></div><button className="btn accent" onClick={() => { setSelected(emptyEntry(kind)); setMessage(''); }}><Plus size={15} />{kind === 'resource' ? 'New resource' : 'New store item'}</button></div>{loading ? <p role="status">Loading items…</p> : <div className="admin-entry-list">{items.map(item => <button className="card admin-entry-card" key={item.id} onClick={() => { setSelected(item); setMessage(''); }}><div><strong>{item.data.title}</strong><p className="small muted">/{kind === 'resource' ? 'resources' : 'store'}/{item.slug}</p></div><span className={`badge ${item.status === 'draft' ? 'draft' : ''}`}>{item.status === 'published' ? 'Published' : 'Draft'}</span></button>)}{!items.length && <div className="card empty"><h3>Start with your first {kind === 'resource' ? 'resource' : 'store item'}.</h3><p className="small muted">New items can stay private until you’re ready to publish.</p></div>}</div>}</>}</>;
}

function StripeProductFields({ product, onChange }) {
  const [rates, setRates] = useState([]), [error, setError] = useState('');
  useEffect(() => {
    if (product.kind === 'physical') api('/api/admin/commerce/shipping-rates').then(result => { setRates(result.items); if (result.hasMore) setError('Showing the first 100 rates. Enter another rate ID manually if needed.'); }).catch(error => setError(error.message));
  }, [product.kind]);
  return <section className="fields"><h3>Stripe Checkout</h3><code className="small commerce-code">{product.stripePriceId}</code><p className="small">{product.stripeLivemode ? 'Live price' : 'Test price — sandbox payments only'}. Sync pricing in Stripe catalog after changing it in Stripe. Your team handles delivery and marks paid orders fulfilled in Orders.</p>{product.kind === 'physical' && <><TextField label="Shipping countries (two-letter codes, separated by commas)" value={(product.shippingCountries || []).join(', ')} onChange={value => onChange('shippingCountries', value.toUpperCase().split(',').map(code => code.trim()))} placeholder="For example: US, CA" /><p className="small muted">Use only countries you ship to. Configure an active shipping rate in Stripe for this item’s currency. A rate of zero is an explicit free-shipping choice.</p><TextField label="Stripe shipping rate IDs (separated by commas)" value={(product.shippingRates || []).join(', ')} onChange={value => onChange('shippingRates', value.split(',').map(id => id.trim()))} placeholder="shr_…" />{rates.length > 0 && <div><p className="small">Available rates:</p>{rates.filter(rate => rate.currency === product.currency).map(rate => <p className="small" key={rate.id}>{rate.name} — {new Intl.NumberFormat('en-US', { style: 'currency', currency: rate.currency }).format(rate.amount / 100)} <code>{rate.id}</code></p>)}</div>}{error && <p className="small message" role="status">{error}</p>}</>}</section>;
}

function EntryEditor({ kind, entry, onDirty, onSaved, onDelete }) {
  const [form, setForm] = useState(() => structuredClone(entry)), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState('');
  const edit = (key, value) => { setForm(previous => ({ ...previous, [key]: value })); onDirty(true); };
  const data = (key, value) => {
    setForm(previous => ({ ...previous, slug: key === 'title' && !previous.id && (!previous.slug || previous.slug === slugify(previous.data.title)) ? slugify(value) : previous.slug, data: { ...previous.data, [key]: value } })); onDirty(true);
  };
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await api(`/api/admin/entries/${kind}${form.id ? `/${form.id}` : ''}`, { method: form.id ? 'PUT' : 'POST', body: form }); setForm(result); await onSaved(result); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  return <form className="card admin-form" onSubmit={submit}><div className="row between"><h2>{entry.id ? 'Edit' : 'New'} {kind === 'resource' ? 'resource' : 'store item'}</h2>{form.id && form.status === 'published' && <a className="text-link" href={`/${kind === 'resource' ? 'resources' : 'store'}/${form.slug}`} target="_blank" rel="noopener noreferrer">View item <ArrowUpRight size={14} /></a>}</div>{error && <p className="message error" role="alert">{error}</p>}<fieldset disabled={busy} className="fields">
    <TextField label="Title" value={form.data.title} onChange={value => data('title', value)} required maxLength={250} />
    <TextField label="Address slug" value={form.slug} onChange={value => edit('slug', value)} required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
    <p className="small muted">Use lowercase letters and hyphens. Changing a published address affects existing links.</p>
    <TextField label="Description" value={form.data.description} onChange={value => data('description', value)} multiline required />
    <div className="admin-field-grid"><label>Visibility<select aria-label="Visibility" className="field" value={form.status} onChange={e => edit('status', e.target.value)}><option value="draft">Draft — only admins can see it</option><option value="published">Published — visible on the website</option></select></label><TextField label="Display order" type="number" value={form.sortOrder} min={-10000} max={10000} onChange={value => edit('sortOrder', Number(value))} /></div>
    {kind === 'resource' ? <><div className="admin-field-grid"><TextField label="Category" value={form.data.category} onChange={value => data('category', value)} required /><TextField label="Resource type" value={form.data.type} onChange={value => data('type', value)} required /></div><TextField label="Reading time (minutes)" type="number" value={form.data.minutes} min={1} max={120} onChange={value => data('minutes', Number(value))} required /><TextField label="Introduction" value={form.data.introduction} onChange={value => data('introduction', value)} multiline required /><TextField label="Scripture reference (optional)" value={form.data.scripture || ''} onChange={value => data('scripture', value)} /><Repeater type="steps" label="Guide steps" value={form.data.steps} onChange={value => data('steps', value)} /><Repeater type="prompts" label="Worksheet prompts" value={form.data.prompts} onChange={value => data('prompts', value)} /></>
      : <><div className="admin-field-grid"><label>Item type<select aria-label="Item type" className="field" value={form.data.kind} onChange={e => data('kind', e.target.value)}><option value="digital">Digital resource</option><option value="physical">Physical product</option></select></label><label>Currency<select aria-label="Currency" className="field" disabled={Boolean(form.data.stripePriceId)} value={form.data.currency} onChange={e => data('currency', e.target.value)}>{['USD', 'CAD', 'EUR', 'GBP', 'AUD'].map(value => <option key={value}>{value}</option>)}</select></label></div><TextField label="Price (optional)" readOnly={Boolean(form.data.stripePriceId)} type="number" min={0} max={999999.99} step="0.01" value={form.data.priceCents === null ? '' : form.data.priceCents / 100} onChange={value => data('priceCents', value === '' ? null : Math.round(Number(value) * 100))} /><ImageField label="Product image address" value={form.data.imageUrl} onChange={value => data('imageUrl', value)} onBusy={setUploading} /><TextField label="Image description" value={form.data.imageAlt} onChange={value => data('imageAlt', value)} />{form.data.stripePriceId ? <StripeProductFields product={form.data} onChange={data} /> : <><TextField label="Checkout link (optional)" type="url" value={form.data.checkoutUrl} onChange={value => data('checkoutUrl', value)} placeholder="https://…" /><p className="small muted">Use an HTTPS checkout link, or import your product from Stripe catalog to track orders here.</p></>}</>}
  </fieldset><p className="small muted admin-publish-note">Saving a published item updates the website immediately. Drafts stay private.</p><div className="row between admin-save-bar"><button className="btn primary" disabled={busy || uploading}><Save size={15} />{busy ? 'Saving…' : kind === 'resource' ? 'Save resource' : 'Save store item'}</button>{form.id && <button type="button" className="btn danger" disabled={busy} onClick={() => onDelete(form)}><Trash2 size={15} />Delete {kind === 'resource' ? 'resource' : 'store item'}</button>}</div></form>;
}
