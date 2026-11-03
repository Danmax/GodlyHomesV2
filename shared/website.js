export const defaultDocuments = {
  podcast: {
    title: 'Ministry and Motherhood', description: 'Conversations about faith, family, and building a home with intention.',
    coverUrl: '', coverAlt: 'Ministry and Motherhood podcast artwork',
    authorName: '', authorBio: '', authorImageUrl: '', authorLink: '', spotlightEnabled: false,
  },
  site: {
    name: 'Godly Homes', tagline: 'Peace for the home you’re building.', email: 'hello@godlyhomes.com',
    logoUrl: '', logoAlt: 'Godly Homes — Family, Motherhood, Ministry',
    footerText: 'Questions, ideas, or a story to share?\nWe’d love to hear from you.',
    navigation: [{ label: 'Home', href: '/' }, { label: 'About', href: '/about' }, { label: 'Reflexions', href: '/resources' }, { label: 'Podcast', href: '/#podcast' }, { label: 'Store', href: '/store' }],
  },
  home: {
    title: 'Peace for the home you’re building.',
    description: 'Practical help and steady encouragement for Christian mothers raising children to know and serve God — one ordinary, holy day at a time.',
    primaryLabel: 'Listen to the podcast', primaryHref: '/#podcast', secondaryLabel: 'Explore reflexions', secondaryHref: '/resources',
    announcementEnabled: true, announcementText: 'A little encouragement for the home you’re building.', announcementLabel: 'Explore the podcast', announcementHref: '/#podcast',
    podcastTitle: 'A voice of encouragement\nin your ordinary days.',
    podcastDescription: 'Honest conversations about faith, family, and building a home with intention. Listen here, wherever the day finds you.',
  },
  about: {
    eyebrow: 'Family · Motherhood · Ministry', title: 'Faith takes root\nin ordinary places.',
    description: 'Around the kitchen table. In a bedtime prayer. In the small ways we care for one another.',
    illustrationText: 'A home filled\nwith grace.', illustrationCaption: 'Rooted in faith. Growing together.',
    missionLabel: 'Why Godly Homes', missionTitle: 'A little help for the\nhome you’re building.',
    missionParagraphs: ['Godly Homes is a place for Christian mothers and families seeking to bring faith into everyday life. We share practical ideas, thoughtful reflections, and podcast conversations about caring for our homes and the people in them.', 'We believe ordinary moments matter. A home doesn’t need to be perfectly organized to be a place of love, welcome, and spiritual growth. Our hope is to offer encouragement you can carry into the life you already have.'],
    valuesTitle: 'Steady roots. Gentle rhythms.',
    values: [
      { title: 'Rooted in scripture', body: 'Making room to read, reflect, and pray, with faith woven into the ordinary parts of family life.' },
      { title: 'Grace for real life', body: 'Encouragement that meets families amid busy mornings, unfinished tasks, and fresh beginnings.' },
      { title: 'Care for one another', body: 'Listening well, sharing the work, and making space for connection across the seasons of family life.' },
    ],
    connectTitle: 'Start with one small thing.', connectText: 'Read a reflection, try a simple home rhythm, or listen to a conversation as you go about your day.',
    contactTitle: 'We’d love to hear from you.', contactText: 'Have a question or an idea for a future conversation?',
  },
  resources: { title: 'Reflexions for the journey.', description: 'A collection of meaningful external resources for faith, family, and the home you’re building.' },
  store: {
    title: 'Thoughtful things for ordinary days.', description: 'Digital resources and physical goods for bringing faith, care, and intention into the life of your home.',
    emptyTitle: 'Good things take\na little tending.', emptyText: 'We’re preparing a store for both digital resources and physical products. We’ll share the collection here when it’s ready.',
  },
  newsletter: { title: 'A little encouragement\nfor your home.', description: 'Join our list for news about Godly Homes resources and podcast episodes.', buttonLabel: 'Join the list' },
};
