export const documentFields = {
  site: [
    ['name', 'Website name'], ['tagline', 'Tagline'], ['email', 'Contact email', 'email'], ['logoUrl', 'Logo image address', 'image'], ['logoAlt', 'Logo description'], ['footerText', 'Footer message', 'textarea'], ['navigation', 'Navigation links', 'navigation'],
  ],
  home: [
    ['title', 'Homepage headline', 'textarea'], ['description', 'Homepage introduction', 'textarea'], ['primaryLabel', 'Main button text'], ['primaryHref', 'Main button address'], ['secondaryLabel', 'Second button text'], ['secondaryHref', 'Second button address'],
    ['announcementEnabled', 'Show announcement', 'checkbox'], ['announcementText', 'Announcement text'], ['announcementLabel', 'Announcement link text'], ['announcementHref', 'Announcement link address'], ['podcastTitle', 'Podcast section heading', 'textarea'], ['podcastDescription', 'Podcast section introduction', 'textarea'],
  ],
  about: [
    ['eyebrow', 'Intro label'], ['title', 'About headline', 'textarea'], ['description', 'About introduction', 'textarea'], ['illustrationText', 'Illustration text', 'textarea'], ['illustrationCaption', 'Illustration caption'],
    ['missionLabel', 'Mission label'], ['missionTitle', 'Mission heading', 'textarea'], ['missionParagraphs', 'Mission paragraphs', 'paragraphs'], ['valuesTitle', 'Values heading'], ['values', 'Values', 'values'],
    ['connectTitle', 'Closing heading'], ['connectText', 'Closing text', 'textarea'], ['contactTitle', 'Contact card heading'], ['contactText', 'Contact card text', 'textarea'],
  ],
  resources: [['title', 'Resources page headline'], ['description', 'Resources page introduction', 'textarea']],
  store: [['title', 'Store headline'], ['description', 'Store introduction', 'textarea'], ['emptyTitle', 'Empty store heading', 'textarea'], ['emptyText', 'Empty store message', 'textarea']],
  newsletter: [['title', 'Signup heading', 'textarea'], ['description', 'Signup description', 'textarea'], ['buttonLabel', 'Signup button text']],
};
