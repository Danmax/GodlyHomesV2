import { useEffect, useState } from 'react';
import SiteLayout, { usePageMeta } from './SiteLayout.jsx';
import { api } from './api.js';

export default function CheckoutPage() {
  const [order, setOrder] = useState(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [waiting, setWaiting] = useState(true);
  usePageMeta('Order confirmation', 'Check your Godly Homes order status.');
  useEffect(() => {
    let stopped = false, timer, polls = 0;
    const params = new URLSearchParams(location.search), id = params.get('order'), token = params.get('token');
    const load = async () => {
      try {
        if (!id || !token) throw new Error('Open the order confirmation link from checkout to check your payment.');
        const result = await api(`/api/store/orders/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`);
        if (stopped) return;
        setOrder(result); setError('');
        if (result.paymentStatus === 'pending' && ++polls < 15) timer = setTimeout(load, 2500); else setWaiting(false);
      } catch (error) { if (!stopped) { setError(error.message); setWaiting(false); } }
    };
    setWaiting(true); load(); return () => { stopped = true; clearTimeout(timer); };
  }, [attempt]);
  const paid = order?.paymentStatus === 'paid';
  return <SiteLayout><section className="site-container content-section"><div className="card fields"><p className="eyebrow">Godly Homes Store</p><h1>{paid ? 'Thank you for your order.' : order?.paymentStatus === 'pending' ? 'Confirming your payment.' : order ? 'Payment was not completed.' : 'Checking your order.'}</h1>{error && <p className="message error" role="alert">{error}</p>}{order && <><h2>{order.item.title}</h2><p>{new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currency }).format(order.amountTotal / 100)}</p>{order.testMode && <p className="badge">Test order — no live payment</p>}<p role="status">{paid ? order.fulfillmentStatus === 'fulfilled' ? 'Your order has been marked fulfilled.' : order.item.kind === 'digital' ? 'Your payment is confirmed. Our team will send your digital resource to the email provided at checkout.' : 'Your payment is confirmed. Our team will prepare your order for shipping.' : order.paymentStatus === 'pending' ? 'We’re waiting for confirmation from Stripe. Some payment methods take longer. Return to this link to check again.' : 'This checkout is expired or the payment failed. Contact us if your bank shows a charge before starting another checkout.'}</p><code className="small commerce-code">Order reference: {order.id}</code></>}{waiting && <p role="status">Checking payment status…</p>}{!waiting && !paid && <button className="btn" onClick={() => setAttempt(value => value + 1)}>Check again</button>}<a className="text-link" href="/store">Back to Store</a></div></section></SiteLayout>;
}
