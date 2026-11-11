ALTER TABLE assets ADD COLUMN category ENUM('recording','music') NOT NULL DEFAULT 'recording';

UPDATE assets a JOIN episodes e ON e.user_id = a.user_id
  AND JSON_UNQUOTE(JSON_EXTRACT(e.arrangement, '$.music.assetId')) = a.id
SET a.category = 'music';

UPDATE assets a JOIN episodes e ON e.user_id = a.user_id
  JOIN render_jobs j ON j.episode_id = e.id
  AND JSON_UNQUOTE(JSON_EXTRACT(j.snapshot, '$.arrangement.music.assetId')) = a.id
SET a.category = 'music';
