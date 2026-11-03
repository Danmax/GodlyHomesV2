import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { defaultDocuments } from '../shared/website.js';
import { api } from './api.js';

const Context = createContext(null);
export function SiteContentProvider({ children }) {
  const [content, setContent] = useState({ documents: defaultDocuments, resources: [], products: [] });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const data = await api('/api/public/website');
      setContent({ ...data, documents: { ...defaultDocuments, ...data.documents } }); setError('');
    } catch (error) { setError(error.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return <Context.Provider value={{ ...content, loading, error, refresh }}>{children}</Context.Provider>;
}
export function useSiteContent() { return useContext(Context); }
export function ContentStatus() {
  const { loading, error, refresh } = useSiteContent();
  if (loading) return <p className="message" role="status">Loading website content…</p>;
  if (error) return <div className="message error" role="alert">Content is temporarily unavailable. <button onClick={refresh}>Try again</button></div>;
  return null;
}
