let csrf;
export async function api(url, { method = 'GET', body, ...options } = {}) {
  const headers = {};
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const response = await fetch(url, { method, credentials: 'same-origin', headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status}).`), { status: response.status });
  if (data.csrf) csrf = data.csrf;
  return data;
}
export function uploadAudio(blob, name) {
  const body = new FormData(); body.append('audio', blob, name);
  return api('/api/assets', { method: 'POST', body });
}
