import { z } from 'zod';

const short = z.string().trim().min(1).max(250);
const copy = z.string().trim().min(1).max(12000);
export const safeHref = z.string().max(2000).refine(value => {
  if (value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}, 'Use a website path starting with / or a full HTTPS address.');
export const imageUrl = z.union([z.literal(''), safeHref]);
export const documentSchemas = {
  site: z.object({ name: short, tagline: short, email: z.email().max(254), logoUrl: imageUrl, logoAlt: short, footerText: copy, navigation: z.array(z.object({ label: z.string().trim().min(1).max(30), href: safeHref })).min(1).max(6) }),
  home: z.object({ title: short, description: copy, primaryLabel: short, primaryHref: safeHref, secondaryLabel: short, secondaryHref: safeHref, announcementEnabled: z.boolean(), announcementText: short, announcementLabel: short, announcementHref: safeHref, podcastTitle: short, podcastDescription: copy }),
  about: z.object({ eyebrow: short, title: short, description: copy, illustrationText: short, illustrationCaption: short, missionLabel: short, missionTitle: short, missionParagraphs: z.array(copy).min(1).max(10), valuesTitle: short, values: z.array(z.object({ title: short, body: copy })).min(1).max(8), connectTitle: short, connectText: copy, contactTitle: short, contactText: copy }),
  resources: z.object({ title: short, description: copy }),
  store: z.object({ title: short, description: copy, emptyTitle: short, emptyText: copy }),
  newsletter: z.object({ title: short, description: copy, buttonLabel: short }),
};
export const resourceSchema = z.object({
  title: short, type: z.string().trim().min(1).max(40), description: z.string().trim().min(1).max(1000),
  imageUrl: imageUrl.refine(value => value !== '', 'Add an image.'), imageAlt: z.string().trim().min(1).max(250),
  externalUrl: safeHref.refine(value => value.startsWith('https://'), 'Use a full HTTPS link to the external resource.'),
});
export const productSchema = z.object({
  title: short, description: copy, kind: z.enum(['digital', 'physical']), priceCents: z.number().int().min(0).max(99999999).nullable(),
  currency: z.enum(['USD', 'CAD', 'EUR', 'GBP', 'AUD']), imageUrl, imageAlt: z.string().max(250), checkoutUrl: z.union([z.literal(''), safeHref.refine(value => value.startsWith('https://'), 'Checkout must use HTTPS.')]),
  stripePriceId: z.union([z.literal(''), z.string().regex(/^price_[A-Za-z0-9]+$/).max(255)]).optional().default(''),
  stripeProductId: z.string().max(255).optional().default(''),
  stripeLivemode: z.boolean().nullable().optional().default(null),
  shippingCountries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(100).optional().default([]),
  shippingRates: z.array(z.string().regex(/^shr_[A-Za-z0-9]+$/).max(255)).max(5).optional().default([]),
}).refine(data => !data.stripePriceId || !data.checkoutUrl, 'Choose Stripe Checkout or an external checkout link, not both.');
export const entrySchema = kind => z.object({ slug: z.string().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens for the address.'), status: z.enum(['draft', 'published']), sortOrder: z.number().int().min(-10000).max(10000), data: kind === 'resource' ? resourceSchema : productSchema }).refine(entry => {
  if (kind !== 'product' || entry.status !== 'published' || !entry.data.stripePriceId || entry.data.kind !== 'physical') return true;
  return entry.data.shippingCountries.length > 0 && entry.data.shippingRates.length > 0;
}, 'Add shipping countries and Stripe shipping rates before publishing a physical product.');
export const versionSchema = z.number().int().positive();
