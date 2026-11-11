import { createMailer } from './email.js';

try {
  await createMailer().verify();
  console.log('SMTP connection and authentication succeeded. No email was sent.');
} catch (error) {
  console.error('SMTP check failed:', error.code || (error.message.startsWith('Configure ') ? error.message : 'Check the SMTP settings and Google app password.'));
  process.exitCode = 1;
}
