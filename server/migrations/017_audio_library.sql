ALTER TABLE assets ADD COLUMN episode_id CHAR(36) NULL,
  ADD CONSTRAINT assets_episode_fk FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE SET NULL,
  ADD INDEX assets_episode_owner (user_id, episode_id);

UPDATE assets a SET episode_id = (
  SELECT e.id FROM episodes e WHERE e.user_id = a.user_id AND (
    JSON_SEARCH(e.arrangement, 'one', a.id, NULL, '$.segments[*].assetId') IS NOT NULL
    OR JSON_UNQUOTE(JSON_EXTRACT(e.arrangement, '$.music.assetId')) = a.id
  ) ORDER BY e.created_at, e.id LIMIT 1
);

CREATE TABLE audio_library_folders (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE audio_library_clips (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  folder_id CHAR(36) NULL,
  asset_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  edit JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES audio_library_folders(id),
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  INDEX (user_id, folder_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO audio_library_folders (id, user_id, name)
  SELECT UUID(), user_id, 'Previous library' FROM assets WHERE episode_id IS NULL GROUP BY user_id;

INSERT INTO audio_library_clips (id, user_id, folder_id, asset_id, name, edit)
  SELECT UUID(), a.user_id, f.id, a.id, a.filename,
    JSON_OBJECT('role', IF(a.category = 'music', 'music', 'segment'), 'start', 0, 'end', a.duration,
      'gain', IF(a.category = 'music', 0.2, 1), 'fadeIn', 0, 'fadeOut', 0)
  FROM assets a JOIN audio_library_folders f ON f.user_id = a.user_id AND f.name = 'Previous library'
  WHERE a.episode_id IS NULL;
