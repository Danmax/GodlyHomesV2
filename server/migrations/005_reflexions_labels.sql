-- Keep an edited homepage intact, while changing its original Resources
-- call-to-action to the new Reflexions terminology.
UPDATE website_documents
SET data = JSON_SET(data, '$.secondaryLabel', 'Explore reflexions'), version = version + 1
WHERE document_key = 'home'
  AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.secondaryHref')) = '/resources'
  AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.secondaryLabel')) = 'Explore resources';
