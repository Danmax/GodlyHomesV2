import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { rows, json } from './db.js';
import { config } from './config.js';
import { requireStaff } from './auth.js';
import { documentSchemas, entrySchema, resourceSchema, versionSchema } from './website-validation.js';
import { guardedUpload, imageUploadLimit } from './upload-budget.js';

const route = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const kindOf = value => { if (!['resource', 'product'].includes(value)) throw fail('Content type not found.', 404); return value; };
const mapEntry = row => ({ id: row.id, slug: row.slug, status: row.status, data: json(row.data), version: row.version, sortOrder: row.sort_order, updatedAt: row.updated_at });

export async function publicWebsite() {
  const [documents, entries] = await Promise.all([
    rows('SELECT document_key, data FROM website_documents'),
    rows("SELECT kind, id, slug, data FROM website_entries WHERE status = 'published' ORDER BY sort_order, created_at"),
  ]);
  return { documents: Object.fromEntries(documents.map(d => [d.document_key, json(d.data)])),
    // Only fully-configured external links are public. Legacy guides remain in
    // Website Admin as drafts until their destination and image are supplied.
    resources: entries.filter(e => e.kind === 'resource').flatMap(e => {
      const parsed = resourceSchema.safeParse(json(e.data));
      return parsed.success ? [{ ...parsed.data, id: e.id, slug: e.slug }] : [];
    }),
    products: entries.filter(e => e.kind === 'product').map(e => ({ ...json(e.data), id: e.id, slug: e.slug })) };
}

export const websiteAdmin = express.Router();
websiteAdmin.use(requireStaff);
websiteAdmin.use('/entries/:kind', (req, res, next) => {
  if (req.user.role === 'junior_admin' && req.params.kind === 'product') return res.status(403).json({ error: 'Store management requires full administrator access.' });
  next();
});
websiteAdmin.get('/documents', route(async (_req, res) => {
  res.json((await rows('SELECT * FROM website_documents ORDER BY document_key')).map(d => ({ key: d.document_key, data: json(d.data), version: d.version, updatedAt: d.updated_at })));
}));
websiteAdmin.put('/documents/:key', route(async (req, res) => {
  const schema = documentSchemas[req.params.key];
  if (!Object.hasOwn(documentSchemas, req.params.key)) throw fail('Page settings not found.', 404);
  const data = schema.parse(req.body.data), version = versionSchema.parse(req.body.version);
  const result = await rows('UPDATE website_documents SET data = ?, version = version + 1, updated_by = ? WHERE document_key = ? AND version = ?', [JSON.stringify(data), req.user.id, req.params.key, version]);
  if (!result.affectedRows) throw fail('These settings changed in another tab. Reload before saving again.', 409);
  res.json({ key: req.params.key, data, version: version + 1 });
}));
websiteAdmin.get('/entries/:kind', route(async (req, res) => {
  const kind = kindOf(req.params.kind);
  res.json((await rows('SELECT * FROM website_entries WHERE kind = ? ORDER BY sort_order, created_at', [kind])).map(mapEntry));
}));
websiteAdmin.post('/entries/:kind', route(async (req, res) => {
  const kind = kindOf(req.params.kind), input = entrySchema(kind).parse(req.body), id = randomUUID();
  try { await rows('INSERT INTO website_entries (id, kind, slug, status, data, sort_order, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, kind, input.slug, input.status, JSON.stringify(input.data), input.sortOrder, req.user.id]); }
  catch (error) { if (error.code === 'ER_DUP_ENTRY') throw fail('That address is already in use. Choose another address slug.', 409); throw error; }
  res.status(201).json({ id, ...input, version: 1 });
}));
websiteAdmin.put('/entries/:kind/:id', route(async (req, res) => {
  const kind = kindOf(req.params.kind), input = entrySchema(kind).parse(req.body), version = versionSchema.parse(req.body.version);
  let result;
  try { result = await rows('UPDATE website_entries SET slug = ?, status = ?, data = ?, sort_order = ?, version = version + 1, updated_by = ? WHERE id = ? AND kind = ? AND version = ?', [input.slug, input.status, JSON.stringify(input.data), input.sortOrder, req.user.id, req.params.id, kind, version]); }
  catch (error) { if (error.code === 'ER_DUP_ENTRY') throw fail('That address is already in use. Choose another address slug.', 409); throw error; }
  if (!result.affectedRows) throw fail('This item changed or was deleted in another tab. Reload before saving again.', 409);
  res.json({ id: req.params.id, ...input, version: version + 1 });
}));
websiteAdmin.delete('/entries/:kind/:id', route(async (req, res) => {
  const result = await rows('DELETE FROM website_entries WHERE id = ? AND kind = ? AND version = ?', [req.params.id, kindOf(req.params.kind), versionSchema.parse(req.body.version)]);
  if (!result.affectedRows) throw fail('This item changed or was deleted. Reload before deleting again.', 409);
  res.json({ ok: true });
}));

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } }).single('image');
export const imageRoutes = express.Router();
imageRoutes.post('/images', imageUploadLimit(), guardedUpload('image', imageUpload, async (req, res) => {
  const file = req.file;
  if (!file) throw fail('Choose an image to upload.');
  const data = file.buffer;
  const extension = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff ? 'jpg'
      : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null;
  if (!extension) throw fail('Choose a PNG, JPEG, or WebP image. SVG and other formats are not supported.');
  if (config.remoteMediaOrigin && config.remoteMediaOrigin !== config.origin && req.hostname !== new URL(config.remoteMediaOrigin).hostname) {
    const form = new FormData(); form.append('image', new Blob([data]), `image.${extension}`);
    const response = await fetch(new URL('/api/channel/images', config.remoteMediaOrigin), { method: 'POST', headers: { Cookie: req.headers.cookie, Origin: config.remoteMediaOrigin, 'X-CSRF-Token': req.csrf }, body: form, redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw fail('The image could not be saved to the hosted website. Please try again.', 503);
    const image = await response.json(); return { url: new URL(image.url, config.remoteMediaOrigin).href };
  }
  const directory = path.join(config.mediaDir, 'images'); await mkdir(directory, { recursive: true });
  const filename = `${randomUUID()}.${extension}`;
  await writeFile(path.join(directory, filename), data, { flag: 'wx', mode: 0o644 });
  try { await rows('INSERT INTO image_uploads (filename, user_id, bytes) VALUES (?, ?, ?)', [filename, req.user.id, data.length]); }
  catch (error) { await unlink(path.join(directory, filename)).catch(() => {}); throw error; }
  return { url: `/images/${filename}` };
}));
websiteAdmin.use(imageRoutes);

export function publicImage(req, res, next) {
  if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(req.params.file)) return res.sendStatus(404);
  res.set('Cache-Control', 'public, max-age=31536000, immutable').set('Cross-Origin-Resource-Policy', 'cross-origin').sendFile(path.join(config.mediaDir, 'images', req.params.file), error => { if (error) next(error); });
}
