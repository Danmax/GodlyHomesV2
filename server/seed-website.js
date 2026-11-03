import { randomUUID } from 'node:crypto';
import { defaultDocuments } from '../shared/website.js';
import { resources } from '../shared/resources.js';

export async function initializeWebsite(connection) {
  // This runs only as part of migration 002, never on normal application startup.
  for (const [key, data] of Object.entries(defaultDocuments)) {
    await connection.execute('INSERT IGNORE INTO website_documents (document_key, data) VALUES (?, ?)', [key, JSON.stringify(data)]);
  }
  for (const [index, resource] of resources.entries()) {
    const { slug, ...data } = resource;
    await connection.execute("INSERT IGNORE INTO website_entries (id, kind, slug, status, data, sort_order) VALUES (?, 'resource', ?, 'published', ?, ?)", [randomUUID(), slug, JSON.stringify(data), index]);
  }
}
