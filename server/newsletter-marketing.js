import { z } from 'zod';

export function createNewsletterMarketing(env = process.env, request = fetch) {
  const segmentId = env.RESEND_NEWSLETTER_SEGMENT_ID || null;
  const key = env.RESEND_CONTACTS_API_KEY;
  const from = env.MAIL_FROM || '';
  if (segmentId) z.uuid().parse(segmentId);
  const ready = Boolean(key && segmentId && z.email().safeParse(from).success);
  async function call(path, method = 'GET', body) {
    if (!ready) throw Object.assign(new Error('Configure the Resend contacts key, newsletter segment, and sender address.'), { status: 503 });
    let response;
    try { response = await request(`https://api.resend.com${path}`, { method, headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000), redirect: 'error' }); }
    catch { throw Object.assign(new Error('Resend could not be reached. Check campaign status before retrying a send.'), { status: 502, code: 'NEWSLETTER_PROVIDER_CONNECTION' }); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error('Resend could not complete this action. Check the API permissions, marketing approval, and Resend dashboard.'), { status: 502, code: `NEWSLETTER_PROVIDER_${response.status}` });
    return data;
  }
  return {
    ready, segmentId, from,
    segment: () => call(`/segments/${segmentId}`),
    members: after => call(`/segments/${segmentId}/contacts?${new URLSearchParams({ limit: '50', ...(after ? { after } : {}) })}`),
    contact: id => call(`/contacts/${encodeURIComponent(id)}`),
    updateContact: (id, body) => call(`/contacts/${encodeURIComponent(id)}`, 'PATCH', body),
    contactSegments: id => call(`/contacts/${encodeURIComponent(id)}/segments`),
    createBroadcast: body => call('/broadcasts', 'POST', { ...body, from: `Godly Homes <${from}>`, segment_id: segmentId, send: false }),
    sendBroadcast: id => call(`/broadcasts/${encodeURIComponent(id)}/send`, 'POST'),
    broadcast: id => call(`/broadcasts/${encodeURIComponent(id)}`),
  };
}
