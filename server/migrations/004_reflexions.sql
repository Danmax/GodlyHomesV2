-- External links replace the earlier on-site guide format. Preserve each
-- original entry for editing, but remove it from public view until it has an
-- image and an HTTPS destination.
UPDATE website_entries
SET status = 'draft', version = version + 1
WHERE kind = 'resource'
  AND JSON_EXTRACT(data, '$.externalUrl') IS NULL;

UPDATE website_documents
SET data = JSON_SET(
  data,
  '$.title', 'Reflexions for the journey.',
  '$.description', 'A collection of meaningful external resources for faith, family, and the home you’re building.'
), version = version + 1
WHERE document_key = 'resources';

UPDATE website_documents
SET data = JSON_SET(data, '$.navigation[2].label', 'Reflexions'), version = version + 1
WHERE document_key = 'site'
  AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.navigation[2].href')) = '/resources'
  AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.navigation[2].label')) = 'Resources';
