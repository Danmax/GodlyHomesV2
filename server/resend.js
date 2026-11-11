import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export function createResendMailer(env, request = fetch) {
  const missing = ['RESEND_API_KEY', 'MAIL_FROM'].filter(key => !env[key]);
  if (missing.length) {
    const unavailable = async () => { throw new Error(`Configure ${missing.join(', ')} for Resend email.`); };
    return { ready: false, provider: 'resend', verify: unavailable, send: unavailable };
  }
  const from = z.email().max(254).parse(env.MAIL_FROM);
  return {
    ready: true, provider: 'resend',
    // A sending-only key cannot use account-management endpoints. A real send
    // is required to validate the key and domain; this checks configuration only.
    verify: async () => undefined,
    send: async ({ to, subject, text, idempotencyKey = randomUUID() }) => {
      z.email().max(254).parse(to);
      const response = await request('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ from: `Godly Homes <${from}>`, to: [to], subject, text }),
        signal: AbortSignal.timeout(20000), redirect: 'error',
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.id !== 'string' || !result.id) {
        const code = response.status === 401 ? 'EMAIL_RESEND_AUTH'
          : response.status === 403 ? 'EMAIL_RESEND_FORBIDDEN'
            : response.status === 429 ? 'EMAIL_RESEND_RATE_LIMIT' : 'EMAIL_RESEND_SEND';
        // Provider response bodies may include email content. Never expose them
        // to clients or logs. The dashboard has full delivery diagnostics.
        throw Object.assign(new Error('Resend could not accept the email. Check the API key, verified domain, and Resend dashboard.'), { code });
      }
      // API acceptance does not prove final delivery to the recipient's inbox.
      return { id: result.id };
    },
  };
}
