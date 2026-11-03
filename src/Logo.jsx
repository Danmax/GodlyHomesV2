import logo from './assets/godly-homes-logo.png';
import { useSiteContent } from './SiteContent.jsx';

export default function Logo({ footer = false }) {
  const { documents: { site } } = useSiteContent();
  return <a className={`site-logo${footer ? ' site-logo-footer' : ''}`} href="/" aria-label={`${site.name} home`}>
    <img src={site.logoUrl || logo} alt={site.logoAlt} width="2172" height="724" />
  </a>;
}
