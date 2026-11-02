import { useEffect, useState } from 'react';
import { Menu, X, ArrowUpRight } from 'lucide-react';
import Logo from './Logo.jsx';

const links = [
  ['Home', '/'], ['About', '/about'], ['Resources', '/resources'],
  ['Podcast', '/#podcast'], ['Store', '/store'],
];

export function usePageMeta(title, description) {
  useEffect(() => {
    document.title = `${title} — Godly Homes`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  }, [title, description]);
}

export function Header() {
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

export function Footer() {
  return <footer className="site-footer"><div className="site-container">
    <div className="footer-grid"><div><Logo footer /><p className="footer-tagline">Peace for the home you’re building.</p></div>
      <nav aria-label="Footer navigation"><p className="eyebrow">Explore</p>{links.map(([label, href]) => <a href={href} key={href}>{label}</a>)}</nav>
      <div><p className="eyebrow">A little connection</p><p className="footer-copy">Questions, ideas, or a story to share?<br />We’d love to hear from you.</p><a className="footer-email" href="mailto:hello@godlyhomes.com">hello@godlyhomes.com</a></div>
    </div>
    <div className="footer-bottom"><p>© {new Date().getFullYear()} Godly Homes</p><p>Family · Motherhood · Ministry</p><a href="/studio">Studio sign in</a></div>
  </div></footer>;
}

export default function SiteLayout({ children, announcement }) {
  return <div className="gh public-site"><a className="skip-link" href="#main-content">Skip to content</a>{announcement}<Header /><main id="main-content">{children}</main><Footer /></div>;
}
