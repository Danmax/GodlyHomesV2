import nodemailer from 'nodemailer';
import { z } from 'zod';

const sendScope = 'https://www.googleapis.com/auth/gmail.send';
const failure = code => Object.assign(new Error('Google email authorization failed. Check the OAuth configuration and mailbox consent.'), { code });

export function createGmailMailer(env, request = fetch) {
  const required = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'MAIL_FROM'];
  const missing = required.filter(key => !env[key]);
  if (missing.length) {
    const unavailable = async () => { throw new Error(`Configure ${missing.join(', ')} for Google OAuth email.`); };
    return { ready: false, provider: 'gmail', verify: unavailable, send: unavailable };
  }
  const from = z.email().max(254).parse(env.MAIL_FROM);
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows', disableFileAccess: true, disableUrlAccess: true });
  let cached, expires = 0, refreshing;
  async function accessToken() {
    if (cached && Date.now() < expires) return cached;
    if (!refreshing) refreshing = (async () => {
      const response = await request('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: env.GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' }),
        signal: AbortSignal.timeout(20000), redirect: 'error',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) throw failure('EMAIL_OAUTH_AUTH');
      if (data.scope && !data.scope.split(' ').includes(sendScope)) throw failure('EMAIL_OAUTH_SCOPE');
      if (!Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0) throw failure('EMAIL_OAUTH_AUTH');
      cached = data.access_token;
      expires = Date.now() + Math.max(0, Number(data.expires_in) - 60) * 1000;
      return cached;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  return {
    ready: true, provider: 'gmail',
    // Validates the refresh grant; a real send is needed to test Gmail delivery.
    verify: () => accessToken().then(() => undefined),
    send: async ({ to, subject, text, html }) => {
      z.email().max(254).parse(to);
      const message = await composer.sendMail({ from: { name: 'Godly Homes', address: from }, to, subject, text, ...(html ? { html } : {}) });
      const raw = message.message.toString('base64url');
      for (let attempt = 0; attempt < 2; attempt++) {
        const token = await accessToken();
        const response = await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw }), signal: AbortSignal.timeout(20000), redirect: 'error',
        });
        // An explicit unauthorized response did not accept the message. Refresh
        // once; timeouts and other responses are not retried to avoid duplicates.
        if (response.status === 401 && attempt === 0) { await response.arrayBuffer(); cached = null; expires = 0; continue; }
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.id) throw failure('EMAIL_GMAIL_SEND');
        return;
      }
    },
  };
}
