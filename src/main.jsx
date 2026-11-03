import React from 'react';
import { createRoot } from 'react-dom/client';
import Homepage from './Homepage.jsx';
import Studio from './Studio.jsx';
import { PublicEpisode } from './PublicPodcast.jsx';
import { AboutPage, ResourcesPage, ResourcePage, StorePage, ProductPage, NotFoundPage } from './ContentPages.jsx';
import { SiteContentProvider } from './SiteContent.jsx';
import CheckoutPage from './CheckoutPage.jsx';
import './styles.css';

class ErrorBoundary extends React.Component {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <main className="fatal"><h1>Something interrupted the studio.</h1><p>Saved recordings remain available after reloading.</p><button onClick={() => location.reload()}>Reload</button></main> : this.props.children; }
}
const path = location.pathname.replace(/\/+$/, '') || '/';
const resourceMatch = path.match(/^\/resources\/([^/]+)$/);
const productMatch = path.match(/^\/store\/([^/]+)$/);
const page = path === '/' ? <Homepage />
  : path === '/checkout' ? <CheckoutPage />
  : path === '/about' ? <AboutPage />
    : path === '/resources' ? <ResourcesPage />
      : resourceMatch ? <ResourcePage slug={resourceMatch[1]} />
        : path === '/store' ? <StorePage />
          : productMatch ? <ProductPage slug={productMatch[1]} />
          : ['/studio', '/admin'].includes(path) ? <Studio />
            : path.startsWith('/podcast/') ? <PublicEpisode id={path.split('/')[2]} />
              : <NotFoundPage />;
createRoot(document.getElementById('root')).render(<ErrorBoundary><SiteContentProvider>{page}</SiteContentProvider></ErrorBoundary>);
