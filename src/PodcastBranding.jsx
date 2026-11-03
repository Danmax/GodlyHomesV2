import { useSiteContent } from './SiteContent.jsx';

export default function PodcastBranding() {
  const { documents: { podcast } } = useSiteContent();
  return <section className="podcast-branding" aria-label="Podcast branding and author spotlight">
    <div className="podcast-show-brand">{podcast.coverUrl && <img className="podcast-cover" src={podcast.coverUrl} alt={podcast.coverAlt} loading="lazy" />}<div><h3>{podcast.title}</h3><p className="small muted">{podcast.description}</p></div></div>
    {podcast.spotlightEnabled && podcast.authorName && <aside className="card author-spotlight"><p className="eyebrow">Author spotlight</p><div className="podcast-author">{podcast.authorImageUrl && <img src={podcast.authorImageUrl} alt={podcast.authorName} loading="lazy" />}<div><h3>{podcast.authorName}</h3><p className="small muted copy-text">{podcast.authorBio}</p>{podcast.authorLink && <a className="text-link" href={podcast.authorLink} target={podcast.authorLink.startsWith('https:') ? '_blank' : undefined} rel="noopener noreferrer">Meet the author ↗</a>}</div></div></aside>}
  </section>;
}
