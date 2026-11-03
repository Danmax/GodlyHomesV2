import { useEffect, useState } from 'react';
import { api } from './api.js';

const money = (amount, currency) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);

export default function CommerceAdmin({ ordersOnly = false }) {
  const [status, setStatus] = useState(null), [catalog, setCatalog] = useState([]), [next, setNext] = useState(null);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [kinds, setKinds] = useState({});
  const load = async (after = '') => {
    setBusy(true); setError('');
    try { const result = await api(`/api/admin/commerce/catalog${after ? `?after=${after}` : ''}`); setCatalog(old => after ? [...old, ...result.items] : result.items); setNext(result.next); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  const checkConnection = async () => {
    setBusy(true); setError('');
    try {
      const result = await api('/api/admin/commerce/status'); setStatus(result);
      if (result.connected) await load(); else { setCatalog([]); setNext(null); }
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  useEffect(() => { if (!ordersOnly) checkConnection(); }, [ordersOnly]);
  const importPrice = async item => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api('/api/admin/commerce/import', { method: 'POST', body: { priceId: item.priceId, kind: kinds[item.priceId] || (item.physical ? 'physical' : 'digital') } });
      setMessage(result.created ? `“${item.title}” imported as a draft. Open Store items to review and publish it.` : `“${item.title}” price synced. Website descriptions, visibility, and shipping settings were preserved.`);
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  if (ordersOnly) return <Orders />;
  return <><h2>Stripe connection</h2>{error && <p className="message error" role="alert">{error}</p>}{message && <p className="message" role="status">{message}</p>}{!status && !error && <p role="status">Checking Stripe connection…</p>}
    {status && <div className="card fields"><strong>{status.connected ? status.account?.name || 'Stripe connected' : status.configured ? 'Stripe connection needs attention.' : 'Stripe is not configured yet.'}</strong>{status.connectionError && <p className="message error" role="alert">{status.connectionError.message}</p>}{status.accountWarning && <p className="message" role="status">{status.accountWarning}</p>}<p className="small">Payment confirmation: {status.webhookConfigured ? 'Signing secret configured' : 'Webhook signing secret needed'}. Automatic tax: {status.automaticTax ? 'enabled' : 'off'}.</p>{status.account && <p className="small">Account payments: {status.account.chargesEnabled ? 'enabled' : 'not yet enabled — check Stripe account requirements'}.</p>}<p className="small">Latest confirmed store webhook: {status.lastWebhookAt ? new Date(status.lastWebhookAt).toLocaleString() : 'none received yet'}.</p><details><summary>Connection setup</summary><p className="small">Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Hostinger’s Node.js environment settings. Keep keys on the server. Start with Stripe sandbox keys and matching sandbox prices.</p><p className="small">Create a Stripe webhook for your account using <strong>Snapshot</strong> events at:</p><code className="commerce-code">{status.webhookUrl}</code><ul>{status.events.map(event => <li className="small" key={event}><code>{event}</code></li>)}</ul><p className="small">Save its signing secret in STRIPE_WEBHOOK_SECRET, then restart or redeploy the app. Set STRIPE_AUTOMATIC_TAX=true only after configuring Stripe Tax.</p><a href="https://dashboard.stripe.com/webhooks" className="text-link" target="_blank" rel="noopener noreferrer">Open Stripe webhooks ↗</a></details></div>}
    <div className="row between"><h3>Stripe catalog</h3><button className="btn" disabled={busy} onClick={checkConnection}>{busy ? 'Checking connection…' : 'Refresh connection'}</button></div><p className="small muted">Import an existing fixed, one-time price. New items stay private until published in Store items. Import again to sync pricing; change the product type in Store items. Recurring, variable, and unsupported currency prices are excluded.</p>
    <div className="admin-entry-list">{catalog.map(item => <article className="card fields" key={item.priceId}><div className="row between"><strong>{item.title}</strong><span className="badge">{item.livemode ? 'Live' : 'Test'}</span></div><p>{money(item.priceCents, item.currency)}</p><code className="small commerce-code">{item.priceId}</code><label>Product type<select className="field" aria-label={`Product type for ${item.priceId}`} value={kinds[item.priceId] || (item.physical ? 'physical' : 'digital')} onChange={e => setKinds(old => ({ ...old, [item.priceId]: e.target.value }))}><option value="digital">Digital resource</option><option value="physical">Physical product</option></select></label><button className="btn primary" disabled={busy} onClick={() => importPrice(item)}>Import or sync price</button></article>)}</div>
    {busy && <p role="status">Loading Stripe…</p>}{!catalog.length && status?.connected && !busy && !error && <p className="message">No supported active prices found on this page. Check the product’s prices, account, and mode.</p>}{next && <button className="btn" disabled={busy} onClick={() => load(next)}>Load more prices</button>}<p className="small muted">Your team sends digital resources and ships packages. Payment confirmation does not automatically deliver files or ship products. Manage refunds and disputes in Stripe.</p></>;
}

function Orders() {
  const [orders, setOrders] = useState([]), [page, setPage] = useState(1), [hasMore, setHasMore] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true); setError('');
    try { const result = await api(`/api/admin/commerce/orders?page=${page}`); setOrders(result.items); setHasMore(result.hasMore); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, [page]);
  return <><div className="row between"><h2>Store orders</h2><button className="btn" disabled={busy} onClick={load}>Refresh orders</button></div><p className="small muted">After sending a digital resource or shipping a package, mark the paid order fulfilled. Handle refunds and disputes in Stripe; refund status is not tracked here.</p>{error && <p role="alert" className="message error">{error}</p>}{busy && <p role="status">Loading orders…</p>}<div className="admin-entry-list">{orders.map(order => <Order key={`${order.id}-${order.version}`} order={order} onSaved={load} />)}</div>{!busy && !orders.length && <p className="message">No orders on this page.</p>}<div className="row"><button className="btn" disabled={busy || page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><span className="small">Page {page}</span><button className="btn" disabled={busy || !hasMore} onClick={() => setPage(value => value + 1)}>Next</button></div></>;
}
function Order({ order, onSaved }) {
  const [notes, setNotes] = useState(order.notes), [fulfilled, setFulfilled] = useState(order.fulfillmentStatus === 'fulfilled'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api(`/api/admin/commerce/orders/${order.id}`, { method: 'PATCH', body: { version: order.version, notes, fulfillmentStatus: fulfilled ? 'fulfilled' : 'unfulfilled' } }); await onSaved(); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  const address = order.shipping?.address;
  return <details className="card commerce-order"><summary><strong>{order.item.title}</strong> · {money(order.amountTotal, order.currency)} · {order.paymentStatus} · {order.fulfillmentStatus}{order.testMode ? ' · TEST' : ''}<span className="small muted"> {new Date(order.createdAt).toLocaleString()}</span></summary><div className="fields"><code className="small commerce-code">Order {order.id}</code><p>{order.item.kind === 'physical' ? 'Physical product' : 'Digital resource'} · Quantity {order.item.quantity}</p><p className="copy-text">{order.name || 'Customer details pending'}{order.email ? `\n${order.email}` : ''}</p>{address && <p className="copy-text">{[order.shipping.name, address.line1, address.line2, [address.city, address.state, address.postal_code].filter(Boolean).join(', '), address.country].filter(Boolean).join('\n')}</p>}{order.sessionId && <><code className="small commerce-code">{order.sessionId}</code><a className="text-link" href={`https://dashboard.stripe.com/${order.testMode ? 'test/' : ''}payments`} target="_blank" rel="noopener noreferrer">View payments in Stripe ↗</a></>}<form className="fields" onSubmit={save}><label>Fulfillment notes<textarea className="field" value={notes} onChange={e => setNotes(e.target.value)} maxLength={4000} rows={3} disabled={busy} /></label><label><input type="checkbox" checked={fulfilled} onChange={e => setFulfilled(e.target.checked)} disabled={busy || order.paymentStatus !== 'paid'} /> Resource delivered or package shipped</label>{error && <p role="alert" className="message error">{error}</p>}<button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save fulfillment'}</button></form></div></details>;
}
