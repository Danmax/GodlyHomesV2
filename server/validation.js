import { z } from 'zod';

const segment = z.object({
  id: z.uuid(), assetId: z.uuid(), name: z.string().trim().min(1).max(200),
  start: z.number().min(0).max(7200), end: z.number().positive().max(7200),
  gain: z.number().min(0).max(2), fadeIn: z.number().min(0).max(5), fadeOut: z.number().min(0).max(5),
}).refine(s => s.end - s.start >= 0.05, 'Each segment must be at least 0.05 seconds.');
export const arrangementSchema = z.object({
  segments: z.array(segment).max(200),
  music: z.object({ assetId: z.uuid().nullable(), volume: z.number().min(0).max(1), duck: z.boolean() }),
});
export const episodeSchema = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000),
  number: z.number().int().min(1).max(100000),
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
  if (arrangement.segments.reduce((n, s) => n + s.end - s.start, 0) > 7200) {
    throw Object.assign(new Error('Episodes are limited to two hours in this release.'), { status: 400 });
  }
}
