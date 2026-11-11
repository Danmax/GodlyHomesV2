import { createMailer } from './email.js';

try {
  const mailer = createMailer();
  await mailer.verify();
  console.log(mailer.provider === 'resend'
    ? 'Resend settings are present. API key validity, domain verification and delivery require npm run email:test; no email was sent.'
    : mailer.provider === 'gmail'
    ? 'Google OAuth token refresh succeeded. No email was sent; Gmail API delivery still needs a send test.'
    : 'SMTP connection and authentication succeeded. No email was sent.');
} catch (error) {
  console.error('Email authorization check failed:', error.code || (error.message.startsWith('Configure ') ? error.message : 'Check the email provider settings and sender authorization.'));
  process.exitCode = 1;
}
