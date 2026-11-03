import { useEffect, useState } from 'react';
import { Menu, X, ArrowUpRight, Heart } from 'lucide-react';
import Logo from './Logo.jsx';
import { useSiteContent } from './SiteContent.jsx';

export function usePageMeta(title, description) {
  const { documents: { site } } = useSiteContent();
  useEffect(() => {
    document.title = `${title} — ${site.name}`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  }, [title, description, site.name]);
}

export function Header() {
  const { documents: { site } } = useSiteContent();
  const links = site.navigation.map(item => [item.label, item.href]);
  const [open, setOpen] = useState(false);
  const current = location.pathname.replace(/\/$/, '') || '/';
  const isCurrent = href => !href.includes('#') && (current === href || (href === '/resources' && current.startsWith('/resources/')));
  return <header className="site-header">
    <div className="site-header-inner">
      <Logo />
      <nav className="desktop-nav" aria-label="Main navigation">
        {links.map(([label, href]) => <a key={href} href={href} aria-current={isCurrent(href) ? 'page' : undefined}>{label}</a>)}
      </nav>
      <a className="btn accent header-join" href="/#join">Stay connected <ArrowUpRight size={14} /></a>
      <button className="mobile-menu-button btn icon" onClick={() => setOpen(value => !value)} aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="mobile-navigation">{open ? <X size={22} /> : <Menu size={22} />}</button>
    </div>
    {open && <nav id="mobile-navigation" className="mobile-navigation" aria-label="Mobile navigation">{links.map(([label, href]) => <a key={href} href={href} aria-current={isCurrent(href) ? 'page' : undefined} onClick={() => setOpen(false)}>{label}<ArrowUpRight size={16} /></a>)}<a href="/#join" onClick={() => setOpen(false)}>Stay connected <ArrowUpRight size={16} /></a></nav>}
  </header>;
}

function Announcement() {
  const { documents: { home } } = useSiteContent();
  const [open, setOpen] = useState(true);
  if (!open || !home.announcementEnabled) return null;
  return <div className="site-announcement" role="region" aria-label="Current announcement"><div className="site-announcement-inner"><Heart size={14} aria-hidden="true" /><p>{home.announcementText} <a href={home.announcementHref}>{home.announcementLabel}</a></p><button type="button" onClick={() => setOpen(false)} aria-label="Dismiss announcement"><X size={16} /></button></div></div>;
}

export function Footer() {
  const { documents: { site } } = useSiteContent();
  const links = site.navigation.map(item => [item.label, item.href]);
  return <footer className="site-footer"><div className="site-container">
    <div className="footer-grid"><div><Logo footer /><p className="footer-tagline">{site.tagline}</p></div>
      <nav aria-label="Footer navigation"><p className="eyebrow">Explore</p>{links.map(([label, href]) => <a href={href} key={href}>{label}</a>)}</nav>
      <div><p className="eyebrow">A little connection</p><p className="footer-copy copy-text">{site.footerText}</p><a className="footer-email" href={`mailto:${site.email}`}>{site.email}</a></div>
    </div>
    <div className="footer-bottom"><p>© {new Date().getFullYear()} {site.name}</p><p>Family · Motherhood · Ministry</p><a href="/admin">Admin & studio sign in</a></div>
  </div></footer>;
}

export default function SiteLayout({ children }) {
  return <div className="gh public-site"><a className="skip-link" href="#main-content">Skip to content</a><Announcement /><Header /><main id="main-content">{children}</main><Footer /></div>;
}
