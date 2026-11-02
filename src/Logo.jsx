import logo from './assets/godly-homes-logo.png';

export default function Logo({ footer = false }) {
  return <a className={`site-logo${footer ? ' site-logo-footer' : ''}`} href="/" aria-label="Godly Homes home">
    <img src={logo} alt="Godly Homes — Family, Motherhood, Ministry" width="2172" height="724" />
  </a>;
}
