import { useEffect, useState } from 'react';
import { api } from './api.js';

const roles = { member: 'Member', publisher: 'Podcaster', junior_admin: 'Junior admin', admin: 'Full admin' };
export default function UserAdmin({ currentUser }) {
  const [q, setQ] = useState(''), [pending, setPending] = useState(false), [page, setPage] = useState(1);
  const [data, setData] = useState(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const [changes, setChanges] = useState({}), [feedback, setFeedback] = useState({}), [history, setHistory] = useState(null);
  const fullAdmin = currentUser.role === 'admin';
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api(`/api/admin/users?${new URLSearchParams({ q, pending: String(pending), page: String(page) })}`).then(result => { if (!cancelled) { setData(result); setError(''); setChanges({}); } }).catch(error => { if (!cancelled) setError(error.message); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q, pending, page, refresh]);
  const update = async (user, body, question) => {
    if (question && !confirm(question)) return;
    setBusy(true); setError(''); setMessage('');
    try { const result = await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { ...body, version: user.version } }); setMessage(result.message); setRefresh(value => value + 1); setHistory(null); }
    catch (error) { setError(error.message); setRefresh(value => value + 1); } finally { setBusy(false); }
  };
  const showHistory = async user => {
    setError('');
    try { setHistory({ email: user.email, events: await api(`/api/admin/users/${user.id}/history`) }); }
    catch (error) { setError(error.message); }
  };
  return <div className="stack">
    <section className="card"><h2>Users & podcaster approvals</h2><p className="small muted">People create and verify their account first. Review podcaster requests here.{fullAdmin && ' Choose Junior admin to grant content editing, episode moderation, and approval access. Only full admins manage account roles and store/customer data.'}</p>
      <label>Search by email<input className="field" type="search" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /></label>
      <label className="row" style={{ marginTop: 16 }}><input type="checkbox" checked={pending} onChange={e => { setPending(e.target.checked); setPage(1); }} />Pending podcaster requests only</label>
    </section>
    {error && <p className="message error" role="alert">{error}</p>}{message && <p className="message" role="status">{message}</p>}
    {!data ? <p role="status">Loading users…</p> : <>
      <p className="small muted">{data.total} account{data.total === 1 ? '' : 's'}</p>
      {data.users.map(user => <section className="card user-admin-card" key={user.id}>
        <div className="row between"><h3>{user.email}</h3><span className="badge">{user.disabled ? 'Deactivated' : roles[user.role]}</span></div>
        <p className="small muted">{user.verified ? 'Email verified' : 'Email verification pending'} · Joined {new Date(user.createdAt).toLocaleDateString()}</p>
        {user.podcasterStatus === 'pending' && user.role === 'member' && !user.disabled && <div className="fields" style={{ marginTop: 20 }}><h4>Podcaster request</h4><p className="copy-text">{user.podcasterMessage}</p><label>Review note (optional)<textarea className="field" maxLength={300} value={feedback[user.id] || ''} onChange={e => setFeedback(values => ({ ...values, [user.id]: e.target.value }))} /></label><div className="row"><button className="btn primary" disabled={busy || !user.verified} onClick={() => update(user, { action: 'review', approve: true, feedback: feedback[user.id] || '' }, `Approve ${user.email} to create and publish podcasts?`)}>Approve podcaster</button><button className="btn" disabled={busy} onClick={() => update(user, { action: 'review', approve: false, feedback: feedback[user.id] || '' }, `Decline the podcaster request from ${user.email}?`)}>Decline request</button></div></div>}
        {fullAdmin && user.id !== currentUser.id && <fieldset disabled={busy} className="fields" style={{ marginTop: 20 }}><label>Account role<select aria-label="Account role" className="field" value={changes[user.id] || user.role} onChange={e => setChanges(values => ({ ...values, [user.id]: e.target.value }))}>{Object.entries(roles).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label><div className="row user-admin-actions"><button className="btn" disabled={!changes[user.id] || changes[user.id] === user.role || user.disabled || !user.verified} onClick={() => update(user, { action: 'role', role: changes[user.id] }, `Change ${user.email} to ${roles[changes[user.id]]}? Their current sessions will be signed out.`)}>Save role</button><button className={`btn ${user.disabled ? '' : 'danger'}`} onClick={() => update(user, { action: 'status', disabled: !user.disabled }, `${user.disabled ? 'Reactivate' : 'Deactivate'} ${user.email}? Deactivation blocks sign-in and signs out existing sessions. Published episodes are managed separately in Podcast episodes.`)}>{user.disabled ? 'Reactivate account' : 'Deactivate account'}</button><button className="btn" onClick={() => update(user, { action: 'sessions' }, `Sign ${user.email} out of every device?`)}>Sign out all devices</button></div></fieldset>}
        {fullAdmin && <button className="btn ghost" disabled={busy} onClick={() => showHistory(user)}>Access history</button>}
      </section>)}
      {!data.users.length && <p className="message">No matching accounts.</p>}
      <div className="row between"><button className="btn" disabled={page <= 1 || busy} onClick={() => setPage(value => value - 1)}>Previous</button><span className="small">Page {page}</span><button className="btn" disabled={page * 50 >= data.total || busy} onClick={() => setPage(value => value + 1)}>Next</button></div>
    </>}
    {history && <section className="card"><div className="row between"><h3>Access history: {history.email}</h3><button className="btn ghost" onClick={() => setHistory(null)}>Close history</button></div>{history.events.length ? history.events.map((event, index) => <p className="small" key={index}>{new Date(event.at).toLocaleString()} · {event.actorEmail} · {event.action}{event.details.change.role ? ` → ${roles[event.details.change.role]}` : ''}{event.action === 'review' ? event.details.change.approve ? ' → approved' : ' → declined' : ''}{event.action === 'status' ? event.details.change.disabled ? ' → deactivated' : ' → reactivated' : ''}</p>) : <p className="small muted">No access changes recorded.</p>}</section>}
  </div>;
}

export function PodcasterRequest() {
  const [access, setAccess] = useState(null), [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const load = () => api('/api/auth/access').then(setAccess).catch(error => setError(error.message));
  useEffect(() => { load(); }, []);
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/api/auth/access/request', { method: 'POST', body: { message } }); await load(); setMessage(''); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  return <section className="card" style={{ marginTop: 24 }}><h2>Share your voice</h2><p className="small muted">Request access to create a channel and publish podcasts on Godly Homes. After approval, sign in again to open the studio.</p>{error && <p className="message error" role="alert">{error}</p>}{access?.podcasterFeedback && <p className="message">Review note: {access.podcasterFeedback}</p>}{access?.podcasterStatus === 'pending' ? <p className="message" role="status">Your podcaster request is awaiting review.</p> : access && <form className="fields" onSubmit={submit}><label>Tell us about your podcast<textarea className="field" required minLength={10} maxLength={1000} value={message} onChange={e => setMessage(e.target.value)} /></label><button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Request podcaster access'}</button></form>}</section>;
}
