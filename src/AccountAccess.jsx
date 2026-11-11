import { useEffect, useState } from 'react';
import { api } from './api.js';
import Logo from './Logo.jsx';

export default function AccountAccess({ onLogin = () => { location.href = '/studio'; } }) {
  const [link] = useState(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    const action = params.get('action'), token = params.get('token') || '';
    if (token) history.replaceState(null, '', location.pathname + location.search);
    return { mode: action === 'verify' ? 'verify' : action === 'reset' ? 'reset' : action === 'newsletter' ? 'newsletter' : 'login', token };
  });
  const [mode, setMode] = useState(link.mode), [email, setEmail] = useState('');
  const [password, setPassword] = useState(''), [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [options, setOptions] = useState(null);
  useEffect(() => { api('/api/auth/options').then(setOptions).catch(() => setOptions({ emailEnabled: false })); }, []);
  const changeMode = value => { setMode(value); setPassword(''); setConfirmPassword(''); setError(''); setMessage(''); };
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      if (mode === 'login') { onLogin(await api('/api/auth/login', { method: 'POST', body: { email, password } })); return; }
      const endpoint = { register: 'register', forgot: 'forgot-password', resend: 'resend-verification', verify: 'verify-email', reset: 'reset-password' }[mode];
      const result = await api(mode === 'newsletter' ? '/api/newsletter/confirm' : `/api/auth/${endpoint}`, { method: 'POST', body: { email, password, confirmPassword, token: link.token } });
      setMessage(result.message); setPassword(''); setConfirmPassword('');
      if (['reset', 'verify', 'newsletter'].includes(mode)) setMode('complete');
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  const title = { login: 'Welcome to Godly Homes.', register: 'Create your account.', forgot: 'Reset your password.', resend: 'Verify your email.', verify: 'Confirm your email.', reset: 'Choose a new password.', newsletter: 'Confirm your newsletter signup.', complete: 'You’re all set.' }[mode];
  const needsPassword = ['login', 'verify', 'reset'].includes(mode);
  const newPassword = ['verify', 'reset'].includes(mode);
  const needsEmail = ['login', 'register', 'forgot', 'resend'].includes(mode);
  const emailUnavailable = mode !== 'login' && mode !== 'complete' && mode !== 'newsletter' && options && !options.emailEnabled;
  const label = { login: 'Sign in', register: 'Create account', forgot: 'Send reset email', resend: 'Resend verification', verify: 'Verify my email', reset: 'Save new password', newsletter: 'Confirm newsletter signup' }[mode];
  return <main className="login-shell">
    <Logo />
    <form className="card" onSubmit={submit}>
      <p className="eyebrow">A place to grow together</p><h1>{title}</h1>
      {mode === 'register' && <p className="muted small">We’ll email a link to verify your address and choose your password, followed by a welcome when you confirm.</p>}
      {mode === 'forgot' && <p className="muted small">Enter your account email. The reset link is valid for 30 minutes.</p>}
      {mode === 'newsletter' && <p className="muted small">Confirm below to receive Godly Homes newsletter updates.</p>}
      {mode === 'verify' && <p className="muted small">Choose a password of at least 12 characters to verify your email and finish setting up your Godly Homes account.</p>}
      {mode === 'reset' && <p className="muted small">Use at least 12 characters. Resetting signs out all previous sessions.</p>}
      {emailUnavailable && <p className="message" role="status">Account email is being set up. Please try again later.</p>}
      <div className="fields">
        {needsEmail && <label>Email<input className="field" type="email" autoComplete="username" maxLength={254} required value={email} onChange={e => setEmail(e.target.value)} /></label>}
        {needsPassword && <label>{newPassword ? 'New password' : 'Password'}<input className="field" type="password" autoComplete={newPassword ? 'new-password' : 'current-password'} minLength={newPassword ? 12 : 1} maxLength={200} required value={password} onChange={e => setPassword(e.target.value)} /></label>}
        {newPassword && <label>Confirm password<input className="field" type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label>}
      </div>
      {error && <p className="message error" role="alert">{error}</p>}
      {message && <p className="message" role="status">{message}</p>}
      {mode !== 'complete' && <button className="btn primary" disabled={busy || emailUnavailable || (mode === 'register' && !options?.registrationEnabled)}>{busy ? 'Please wait…' : label}</button>}
      <div className="account-actions">
        {mode !== 'login' && link.mode !== 'newsletter' && <button className="btn ghost" type="button" disabled={busy} onClick={() => changeMode('login')}>Back to sign in</button>}
        {mode === 'login' && <>
          {options?.registrationEnabled && <button className="btn ghost" type="button" disabled={busy} onClick={() => changeMode('register')}>Create an account</button>}
          <button className="btn ghost" type="button" disabled={busy} onClick={() => changeMode('forgot')}>Forgot password?</button>
        </>}
        {['login', 'register', 'forgot'].includes(mode) && <button className="btn ghost" type="button" disabled={busy} onClick={() => changeMode('resend')}>Resend verification</button>}
      </div>
    </form>
    <a className="btn ghost" href="/">← Back to Godly Homes</a>
  </main>;
}
