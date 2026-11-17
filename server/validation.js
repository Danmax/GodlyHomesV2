import { z } from 'zod';
import { clipRoles } from '../shared/podcast-editing.js';
import { episodeDuration } from '../shared/timeline.js';

const trackId = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);

const segment = z.object({
  id: z.uuid(), assetId: z.uuid(), name: z.string().trim().min(1).max(200),
  start: z.number().min(0).max(7200), end: z.number().positive().max(7200),
  gain: z.number().min(0).max(2), fadeIn: z.number().min(0).max(5), fadeOut: z.number().min(0).max(5),
  role: z.enum(clipRoles).optional().default('segment'),
  position: z.number().min(0).max(7200).optional(), trackId: trackId.optional(),
}).refine(s => s.end - s.start >= 0.05 - 1e-8, 'Each segment must be at least 0.05 seconds.');
export const arrangementSchema = z.object({
  autoLevel: z.boolean().optional().default(false),
  introDraft: z.object({ show: z.string().max(200), host: z.string().max(200), topic: z.string().max(500), tone: z.enum(['warm', 'upbeat', 'reflective']), script: z.string().max(1200), voice: z.enum(['marin', 'cedar', 'coral', 'sage']) }).optional(),
  segments: z.array(segment).max(200),
  tracks: z.array(z.object({ id: trackId, name: z.string().trim().min(1).max(80),
    kind: z.enum(['voice', 'music', 'effects']), color: z.enum(['sage', 'blue', 'gold', 'rose', 'purple']),
    gain: z.number().min(0).max(2), muted: z.boolean(), solo: z.boolean() })).min(1).max(16).optional(),
  music: z.object({ assetId: z.uuid().nullable(), volume: z.number().min(0).max(1), duck: z.boolean() }),
}).superRefine((arrangement, context) => {
  const invalid = message => context.addIssue({ code: 'custom', message });
  if (new Set(arrangement.segments.map(clip => clip.id)).size !== arrangement.segments.length) invalid('Each clip must have a unique ID.');
  if (arrangement.tracks) {
    const ids = new Set(arrangement.tracks.map(track => track.id));
    if (ids.size !== arrangement.tracks.length) invalid('Each track must have a unique ID.');
    if (arrangement.segments.some(clip => clip.position === undefined || !ids.has(clip.trackId))) invalid('Every timeline clip needs a position and an existing track.');
  } else if (arrangement.segments.some(clip => clip.position !== undefined || clip.trackId !== undefined)) invalid('Timeline clips need tracks.');
  if (episodeDuration(arrangement) > 7200) invalid('Episodes are limited to two hours.');
});
export const episodeSchema = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000),
  number: z.number().int().min(1).max(100000),
  seriesId: z.uuid().nullable().optional().default(null),
  arrangement: arrangementSchema,
});
export async function validateAssets(arrangement, userId, query) {
  const ids = [...new Set([...arrangement.segments.map(s => s.assetId), arrangement.music.assetId].filter(Boolean))];
  for (const id of ids) {
    const [asset] = await query('SELECT duration FROM assets WHERE id = ? AND user_id = ?', [id, userId]);
    if (!asset) throw Object.assign(new Error('An audio source is unavailable.'), { status: 400 });
    if (arrangement.segments.some(s => s.assetId === id && s.end > asset.duration + 0.02)) {
      throw Object.assign(new Error('A segment extends beyond its audio source.'), { status: 400 });
    }
  }
  if (episodeDuration(arrangement) > 7200) {
    throw Object.assign(new Error('Episodes are limited to two hours in this release.'), { status: 400 });
  }
}
