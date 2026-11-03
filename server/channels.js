import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rows, json } from './db.js';
import { imageUrl, safeHref } from './website-validation.js';

const route = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = z.string().trim().min(1).max(200);
export const channelSlug = z.string().min(3).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens for the address.');
export const channelData = z.object({ title: text, description: z.string().trim().min(1).max(4000), coverUrl: imageUrl, coverAlt: text,
  authorName: text, authorBio: z.string().trim().min(1).max(4000), authorImageUrl: imageUrl, authorLink: z.union([z.literal(''), safeHref]),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Choose a six-digit color.'),
});
export const seriesData = z.object({ title: text, description: z.string().trim().min(1).max(4000), coverUrl: imageUrl, coverAlt: text });
export const channelSummary = item => item?.channel_slug ? { ...json(item.channel_data), slug: item.channel_slug } : null;
export const seriesSummary = item => item?.series_slug ? { ...json(item.series_data), id: item.series_id, slug: item.series_slug } : null;
const mapSeries = item => ({ id: item.id, slug: item.slug, data: json(item.data), version: item.version });

export const channelRoutes = express.Router();
channelRoutes.get('/', route(async (req, res) => {
  const [channel] = await rows('SELECT * FROM podcast_channels WHERE user_id = ?', [req.user.id]);
  const series = await rows('SELECT * FROM podcast_series WHERE user_id = ? ORDER BY updated_at DESC', [req.user.id]);
  res.json({ channel: channel ? { slug: channel.slug, data: json(channel.data), isPublic: Boolean(channel.is_public), version: channel.version } : null, series: series.map(mapSeries) });
}));
channelRoutes.put('/', route(async (req, res) => {
  const input = z.object({ slug: channelSlug, data: channelData, isPublic: z.boolean(), version: z.number().int().min(0) }).parse(req.body);
  try {
    if (input.version === 0) await rows('INSERT INTO podcast_channels (user_id, slug, data, is_public) VALUES (?, ?, ?, ?)', [req.user.id, input.slug, JSON.stringify(input.data), input.isPublic]);
    else {
      const result = await rows('UPDATE podcast_channels SET slug = ?, data = ?, is_public = ?, version = version + 1 WHERE user_id = ? AND version = ?', [input.slug, JSON.stringify(input.data), input.isPublic, req.user.id, input.version]);
      if (!result.affectedRows) throw fail('Your channel changed in another tab. Reload before saving.', 409);
    }
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') throw fail('That channel address is already in use, or your channel was created in another tab. Reload and choose another address.', 409); throw error; }
  res.json({ slug: input.slug, data: input.data, isPublic: input.isPublic, version: input.version + 1 });
}));
channelRoutes.post('/series', route(async (req, res) => {
  const input = z.object({ slug: channelSlug, data: seriesData }).parse(req.body), id = randomUUID();
  if (!(await rows('SELECT user_id FROM podcast_channels WHERE user_id = ?', [req.user.id])).length) throw fail('Save your channel before creating a series.');
  try { await rows('INSERT INTO podcast_series (id, user_id, slug, data) VALUES (?, ?, ?, ?)', [id, req.user.id, input.slug, JSON.stringify(input.data)]); }
  catch (error) { if (error.code === 'ER_DUP_ENTRY') throw fail('That series address is already in use in your channel.', 409); throw error; }
  res.status(201).json({ id, ...input, version: 1 });
}));
channelRoutes.put('/series/:id', route(async (req, res) => {
  const id = z.uuid().parse(req.params.id), input = z.object({ slug: channelSlug, data: seriesData, version: z.number().int().positive() }).parse(req.body);
  try {
    const result = await rows('UPDATE podcast_series SET slug = ?, data = ?, version = version + 1 WHERE id = ? AND user_id = ? AND version = ?', [input.slug, JSON.stringify(input.data), id, req.user.id, input.version]);
    if (!result.affectedRows) throw fail('Series not found or changed. Reload before saving.', 409);
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') throw fail('That series address is already in use in your channel.', 409); throw error; }
  res.json({ id, ...input, version: input.version + 1 });
}));

export async function checkSeriesOwner(seriesId, userId, query = rows) {
  if (seriesId && !(await query('SELECT id FROM podcast_series WHERE id = ? AND user_id = ?', [seriesId, userId])).length) throw fail('Choose a series from your own channel.');
}

export const publicChannels = express.Router();
publicChannels.get('/', route(async (_req, res) => {
  const channels = await rows('SELECT slug, data FROM podcast_channels WHERE is_public = TRUE ORDER BY slug');
  res.json(channels.map(channel => ({ slug: channel.slug, ...json(channel.data) })));
}));
publicChannels.get('/:slug', route(async (req, res) => {
  const [channel] = await rows('SELECT user_id, slug, data FROM podcast_channels WHERE slug = ? AND is_public = TRUE', [channelSlug.parse(req.params.slug)]);
  if (!channel) throw fail('Channel not found.', 404);
  const series = await rows(`SELECT s.* FROM podcast_series s WHERE s.user_id = ? AND EXISTS
    (SELECT 1 FROM publications p JOIN episodes e ON e.id = p.episode_id WHERE p.series_id = s.id AND e.user_id = s.user_id) ORDER BY s.updated_at DESC`, [channel.user_id]);
  res.json({ slug: channel.slug, ...json(channel.data), series: series.map(item => ({ id: item.id, slug: item.slug, ...json(item.data) })) });
}));
