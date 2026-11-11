import assert from 'node:assert/strict';

export async function testAccountBrowser(page, origin) {
  const submissions = [];
  await page.route('**/api/auth/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.split('/').at(-1);
    if (endpoint === 'options') return route.fulfill({ json: { emailEnabled: true, registrationEnabled: true } });
    if (route.request().method() === 'POST') {
      submissions.push({ endpoint, body: route.request().postDataJSON() });
      return route.fulfill({ json: { message: endpoint === 'register' ? 'Check your inbox to verify your email.' : 'Your request is complete.' } });
    }
    return route.fulfill({ status: 401, json: { error: 'Sign in to continue.' } });
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`${origin}/account`);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email', { exact: true }).fill('member@example.com');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Check your inbox' }).waitFor();
  assert.equal(submissions[0].endpoint, 'register');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Registration fits a small phone');
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByRole('button', { name: 'Send reset email' }).click();
  await page.getByRole('status').waitFor();
  assert.equal(submissions.at(-1).endpoint, 'forgot-password');
  for (const action of ['verify', 'reset']) {
    await page.goto(`${origin}/about`);
    const before = submissions.length;
    await page.goto(`${origin}/account#action=${action}&token=${'a'.repeat(64)}`);
    await page.getByRole('heading', { name: action === 'verify' ? 'Confirm your email.' : 'Choose a new password.' }).waitFor();
    assert.equal(new URL(page.url()).hash, '', 'Token is removed from the address bar');
    assert.equal(submissions.length, before, 'Opening an email link does not consume it');
    if (['reset', 'verify'].includes(action)) {
      await page.getByLabel('New password', { exact: true }).fill('Another-password-456');
      await page.getByLabel('Confirm password', { exact: true }).fill('Another-password-456');
    }
    await page.getByRole('button', { name: action === 'verify' ? 'Verify my email' : 'Save new password' }).click();
    await page.getByRole('heading', { name: 'You’re all set.' }).waitFor();
    assert.equal(submissions.at(-1).body.token, 'a'.repeat(64));
  }
  console.log('PASS: Account registration, password reset and verification forms, explicit link confirmation, fragment removal, and 320px layout.');
}
