import { z } from 'zod';
import { safeHref } from './website-validation.js';
import { digest } from './auth.js';

const copy = max => z.string().trim().max(max);
const block = z.object({ source: z.string().regex(/^(custom|page:(about|resources|store|channels|announcement)|(episode|resource|product):[a-f0-9-]{36})$/),
  title: copy(180).default(''), body: copy(5000).default(''), href: z.union([z.literal(''), safeHref]).default(''), label: copy(80).default('') });
export const campaignSchema = z.object({
  subject: z.string().trim().min(1).max(180).regex(/^[^\r\n]+$/, 'Use a single-line subject.'),
  previewText: copy(200), title: z.string().trim().min(1).max(180), intro: copy(6000), closing: copy(3000),
  theme: z.enum(['sage', 'navy']), address: copy(500), showImages: z.boolean(), blocks: z.array(block).max(12),
}).superRefine((data, ctx) => {
  const keys = data.blocks.filter(item => item.source !== 'custom').map(item => item.source);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: 'Include each site item only once.' });
  if (data.blocks.some(item => item.source === 'custom' && !item.title && !item.body)) ctx.addIssue({ code: 'custom', message: 'Add a heading or message to each custom section.' });
});
export const themes = {
  sage: { name: 'Sage & cream', background: '#f4f0e7', paper: '#fffdf8', primary: '#52634a', ink: '#2c3029', muted: '#687063', accent: '#c7a45a' },
  navy: { name: 'Navy & gold', background: '#edf2f5', paper: '#ffffff', primary: '#002b42', ink: '#102f40', muted: '#60717a', accent: '#d6a32c' },
};
const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/{/g, '&#123;').replace(/}/g, '&#125;');
const lines = value => escape(value).replace(/\n/g, '<br>');
export function absoluteNewsletterLink(value, origin) {
  if (!value) return '';
  safeHref.parse(value);
  const url = new URL(value, origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.origin === origin && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Newsletter links must use HTTPS.');
  return url.href;
}

export function renderNewsletter(snapshot, { test = false } = {}) {
  const { data, brand, sections, origin } = snapshot;
  const theme = themes[data.theme];
  const siteUrl = absoluteNewsletterLink('/', origin);
  const unsubscribe = '{{{RESEND_UNSUBSCRIBE_URL}}}';
  const sectionHtml = sections.map(section => `<tr><td style="padding:28px 36px;border-top:1px solid ${theme.background}">
    ${data.showImages && section.image ? `<img src="${escape(section.image)}" alt="${escape(section.title)}" width="528" style="display:block;width:100%;max-width:528px;height:auto;border-radius:8px;margin-bottom:18px">` : ''}
    <p style="font:11px Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;color:${theme.muted};margin:0 0 10px">${escape(section.category)}</p>
    <h2 style="font:normal 26px Georgia,serif;color:${theme.primary};margin:0 0 14px">${escape(section.title)}</h2>
    ${section.body ? `<p style="font:16px/1.7 Arial,sans-serif;color:${theme.ink};margin:0 0 18px">${lines(section.body)}</p>` : ''}
    ${section.href ? `<a href="${escape(section.href)}" style="display:inline-block;background:${theme.primary};color:#ffffff;padding:12px 20px;text-decoration:none;font:bold 13px Arial,sans-serif;border-radius:5px">${escape(section.label || 'Explore more')} &rarr;</a>` : ''}
  </td></tr>`).join('');
  const footer = test ? 'This is a test preview. Live newsletters include a personal unsubscribe link.' : `<a href="${unsubscribe}" style="color:${theme.muted}">Unsubscribe from newsletter updates</a>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(data.subject)}</title></head><body style="margin:0;padding:0;background:${theme.background}">
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escape(data.previewText)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${theme.background}"><tr><td align="center" style="padding:28px 10px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${theme.paper};border-radius:10px;overflow:hidden">
    <tr><td style="padding:30px 36px;background:${theme.primary};border-bottom:5px solid ${theme.accent}"><a href="${escape(siteUrl)}" style="font:normal 28px Georgia,serif;letter-spacing:2px;color:#ffffff;text-decoration:none">${escape(brand.name)}</a><p style="font:11px Arial,sans-serif;letter-spacing:2px;color:#e5e9df;margin:10px 0 0">FAITH · FAMILY · ENCOURAGEMENT</p></td></tr>
    <tr><td style="padding:36px"><p style="font:11px Arial,sans-serif;letter-spacing:2px;color:${theme.muted};margin:0 0 16px">A NOTE FOR YOUR HOME</p><h1 style="font:normal 36px/1.2 Georgia,serif;color:${theme.primary};margin:0 0 22px">${escape(data.title)}</h1><p style="font:16px/1.8 Arial,sans-serif;color:${theme.ink};margin:0">${lines(data.intro)}</p></td></tr>
    ${sectionHtml}${data.closing ? `<tr><td style="padding:28px 36px;border-top:1px solid ${theme.background};font:16px/1.8 Arial,sans-serif;color:${theme.ink}">${lines(data.closing)}</td></tr>` : ''}
    <tr><td style="padding:28px 36px;background:${theme.background};font:12px/1.8 Arial,sans-serif;color:${theme.muted}"><strong>${escape(brand.name)}</strong><br>${lines(data.address)}${data.address ? '<br>' : ''}<a href="mailto:${escape(brand.email)}" style="color:${theme.muted}">${escape(brand.email)}</a><br>You receive these updates because you joined our newsletter.<br>${footer}</td></tr>
    </table></td></tr></table></body></html>`;
  const plain = value => String(value).replace(/\{\{\{/g, '{ { {').replace(/\}\}\}/g, '} } }');
  const text = [brand.name, data.title, data.intro, ...sections.map(section => [section.category, section.title, section.body, section.href].filter(Boolean).join('\n')), data.closing, data.address, brand.email,
    ].filter(Boolean).map(plain).concat(test ? 'TEST PREVIEW — live newsletters contain a personal unsubscribe link.' : `Unsubscribe: ${unsubscribe}`).join('\n\n');
  if (Buffer.byteLength(html) > 95000) throw Object.assign(new Error('This newsletter is too long. Shorten its text or remove sections before sending.'), { status: 400 });
  return { html, text, hash: digest(html + '\0' + text + '\0' + JSON.stringify(snapshot.delivery || {})) };
}
