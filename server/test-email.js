import { z } from 'zod';
import { createMailer } from './email.js';

try {
  const to = z.email().parse(process.env.MAIL_TEST_TO || process.env.ADMIN_EMAIL);
  const mailer = createMailer();
  await mailer.verify();
  await mailer.send({ to, subject: 'Godly Homes email delivery test', text: 'This is a test email from Godly Homes.\n\nYour account-email service accepted this test message for delivery.\n\nWebsite: https://godlyhomes.com\n\nNo password or account settings were changed.\n\nGodly Homes' });
  console.log(`Email provider accepted the test message to ${to}. Confirm receipt in the inbox or spam folder.`);
} catch (error) {
  console.error('Test email failed:', error.code || (error.message.startsWith('Configure ') ? error.message : 'Check MAIL_TEST_TO and the email authorization settings.'));
  process.exitCode = 1;
}
