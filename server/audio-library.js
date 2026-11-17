import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rows, transaction, json } from './db.js';
import { clipRoles } from '../shared/podcast-editing.js';

const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const name = max => z.string().trim().min(1).max(max).refine(value => !/[\u0000-\u001f]/.test(value), 'Use a name without control characters.');
export const libraryClipSchema = z.object({ assetId: z.uuid(), name: name(200), folderId: z.uuid().nullable().default(null),
  role: z.enum(clipRoles), start: z.number().min(0).max(7200), end: z.number().positive().max(7200),
  gain: z.number().min(0).max(2), fadeIn: z.number().min(0).max(5), fadeOut: z.number().min(0).max(5),
}).refine(clip => clip.end - clip.start >= .05 - 1e-8, 'Keep at least 0.05 seconds of audio.');

export const mapAudioAsset = asset => ({ id: asset.id, name: asset.filename, episodeId: asset.episode_id || null,
  category: asset.category || 'recording', duration: asset.duration, bytes: Number(asset.bytes), url: `/api/assets/${asset.id}/audio` });

async function ownedFolder(id, userId, query) {
  if (!id) return;
  const [folder] = await query('SELECT id FROM audio_library_folders WHERE id = ? AND user_id = ? FOR UPDATE', [id, userId]);
  if (!folder) throw fail('Library folder not found.', 404);
}

export function audioLibrary() {
  const router = Router();
  router.get('/', route(async (req, res) => {
    const [folders, items] = await Promise.all([
      rows('SELECT id, name FROM audio_library_folders WHERE user_id = ? ORDER BY name, id', [req.user.id]),
      rows(`SELECT c.id AS clip_id, c.folder_id, c.name AS clip_name, c.edit, a.*
        FROM audio_library_clips c JOIN assets a ON a.id = c.asset_id AND a.user_id = c.user_id
        WHERE c.user_id = ? ORDER BY c.name, c.id`, [req.user.id]),
    ]);
    const clips = items.map(item => ({ ...json(item.edit), id: item.clip_id, folderId: item.folder_id,
      name: item.clip_name, assetId: item.id, asset: mapAudioAsset(item) }));
    res.json({ folders: folders.map(folder => ({ ...folder, count: clips.filter(clip => clip.folderId === folder.id).length })), clips });
  }));
  const folderInput = z.object({ name: name(80) });
  router.post('/folders', route(async (req, res) => {
    const input = folderInput.parse(req.body), id = randomUUID();
    try { await rows('INSERT INTO audio_library_folders (id, user_id, name) VALUES (?, ?, ?)', [id, req.user.id, input.name]); }
    catch (error) { if (error.code === 'ER_DUP_ENTRY') throw fail('A folder with this name already exists.', 409); throw error; }
    res.status(201).json({ id, name: input.name, count: 0 });
  }));
  router.patch('/folders/:id', route(async (req, res) => {
    const id = z.uuid().parse(req.params.id), input = folderInput.parse(req.body);
    try {
      const result = await rows('UPDATE audio_library_folders SET name = ? WHERE id = ? AND user_id = ?', [input.name, id, req.user.id]);
      if (!result.affectedRows) throw fail('Library folder not found.', 404);
    } catch (error) { if (error.code === 'ER_DUP_ENTRY') throw fail('A folder with this name already exists.', 409); throw error; }
    res.json({ id, name: input.name });
  }));
  router.delete('/folders/:id', route(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    await transaction(async connection => {
      const query = (sql, values) => rows(sql, values, connection);
      await ownedFolder(id, req.user.id, query);
      const [used] = await query('SELECT id FROM audio_library_clips WHERE folder_id = ? AND user_id = ? LIMIT 1', [id, req.user.id]);
      if (used) throw fail('Move or remove the clips before deleting this folder.', 409);
      await query('DELETE FROM audio_library_folders WHERE id = ? AND user_id = ?', [id, req.user.id]);
    });
    res.json({ ok: true });
  }));
  router.post('/clips', route(async (req, res) => {
    const input = libraryClipSchema.parse(req.body), id = randomUUID();
    await transaction(async connection => {
      const query = (sql, values) => rows(sql, values, connection);
      const [asset] = await query('SELECT duration FROM assets WHERE id = ? AND user_id = ?', [input.assetId, req.user.id]);
      if (!asset) throw fail('Audio source not found.', 404);
      if (input.end > asset.duration + .02) throw fail('The clip extends beyond its recording.');
      await ownedFolder(input.folderId, req.user.id, query);
      const { assetId, folderId, name, ...edit } = input;
      await query('INSERT INTO audio_library_clips (id, user_id, folder_id, asset_id, name, edit) VALUES (?, ?, ?, ?, ?, ?)', [id, req.user.id, folderId, assetId, name, JSON.stringify(edit)]);
    });
    res.status(201).json({ id, ...input });
  }));
  router.patch('/clips/:id', route(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = z.object({ name: name(200).optional(), folderId: z.uuid().nullable().optional() })
      .refine(value => value.name !== undefined || value.folderId !== undefined, 'Choose a name or folder.').parse(req.body);
    await transaction(async connection => {
      const query = (sql, values) => rows(sql, values, connection);
      // Lock folders before clips consistently with folder deletion.
      if (input.folderId) await ownedFolder(input.folderId, req.user.id, query);
      const [clip] = await query('SELECT name, folder_id FROM audio_library_clips WHERE id = ? AND user_id = ? FOR UPDATE', [id, req.user.id]);
      if (!clip) throw fail('Library clip not found.', 404);
      await query('UPDATE audio_library_clips SET name = ?, folder_id = ? WHERE id = ? AND user_id = ?',
        [input.name ?? clip.name, input.folderId === undefined ? clip.folder_id : input.folderId, id, req.user.id]);
    });
    res.json({ ok: true });
  }));
  router.delete('/clips/:id', route(async (req, res) => {
    const result = await rows('DELETE FROM audio_library_clips WHERE id = ? AND user_id = ?', [z.uuid().parse(req.params.id), req.user.id]);
    if (!result.affectedRows) throw fail('Library clip not found.', 404);
    res.json({ ok: true });
  }));
  return router;
}
