import nodemailer from 'nodemailer';
import { z } from 'zod';
import { createGmailMailer } from './gmail.js';
import { config } from './config.js';

export function createMailer(env = process.env, transportFactory = nodemailer.createTransport, request = fetch) {
  const provider = env.MAIL_PROVIDER || (env.GMAIL_CLIENT_ID ? 'gmail' : 'smtp');
  if (provider === 'gmail') return createGmailMailer(env, request);
  if (provider !== 'smtp') throw new Error('MAIL_PROVIDER must be gmail or smtp.');
  const ready = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'].every(key => Boolean(env[key]));
  if (!ready) return { ready: false, send: async () => { throw new Error('Account email is not configured.'); }, verify: async () => { throw new Error('Configure SMTP_HOST, SMTP_USER, SMTP_PASSWORD and MAIL_FROM.'); } };
  const from = z.email().max(254).parse(env.MAIL_FROM);
  const port = Number(env.SMTP_PORT || 465);
  if (![465, 587].includes(port)) throw new Error('SMTP_PORT must be 465 (TLS) or 587 (STARTTLS).');
  const transport = transportFactory({
    host: env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    disableFileAccess: true, disableUrlAccess: true,
  });
  return {
    ready: true, provider: 'smtp',
    verify: () => transport.verify(),
    send: async ({ to, subject, text }) => {
      const result = await transport.sendMail({ from: { name: 'Godly Homes', address: from }, to, subject, text });
      if (!result.accepted?.length) throw new Error('The email server did not accept the recipient.');
    },
  };
}

export function accountMessage(purpose, token) {
  const url = new URL('/account', config.origin);
  // Fragments stay out of HTTP request logs and referrer headers.
  url.hash = new URLSearchParams({ action: purpose, token }).toString();
  if (purpose === 'verify') return {
    subject: 'Verify your Godly Homes email',
    text: `Welcome to Godly Homes!\n\nConfirm your email address to finish creating your account:\n${url.href}\n\nThis link expires in 24 hours and works once. If you did not create an account, you can ignore this email.`,
  };
  return {
    subject: 'Reset your Godly Homes password',
    text: `We received a request to reset your password.\n\nChoose a new password:\n${url.href}\n\nThis link expires in 30 minutes and works once. If you did not request it, ignore this email; your password will stay the same.`,
  };
}

// Called while holding the user's row lock. Failed delivery leaves the welcome
// pending, so the server's periodic sweep can retry it after an SMTP outage.
export async function sendWelcome(user, mailer, query) {
  if (user.welcome_sent_at || !user.email_verified_at) return;
  await mailer.send({ to: user.email, subject: 'Welcome to Godly Homes', text: `Your email is verified. Welcome to Godly Homes!\n\nWe are glad you are here. Explore encouragement, podcasts, and resources for your home:\n${config.origin}/\n\nManage your account at ${config.origin}/studio.\n\nWith love,\nThe Godly Homes team` });
  await query('UPDATE users SET welcome_sent_at = UTC_TIMESTAMP() WHERE id = ?', [user.id]);
}
