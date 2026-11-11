ALTER TABLE users
  MODIFY COLUMN role ENUM('member','publisher','junior_admin','admin') NOT NULL DEFAULT 'publisher',
  ADD COLUMN access_version INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN disabled_at DATETIME NULL,
  ADD COLUMN podcaster_status ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'none',
  ADD COLUMN podcaster_message VARCHAR(1000) NOT NULL DEFAULT '',
  ADD COLUMN podcaster_feedback VARCHAR(300) NOT NULL DEFAULT '',
  ADD COLUMN podcaster_requested_at DATETIME NULL;
UPDATE users SET podcaster_status = 'approved' WHERE role <> 'member';
CREATE TABLE user_management_gate (id TINYINT PRIMARY KEY) ENGINE=InnoDB;
INSERT INTO user_management_gate (id) VALUES (1);
CREATE TABLE user_access_events (
  id CHAR(36) PRIMARY KEY,
  actor_id CHAR(36) NOT NULL,
  target_id CHAR(36) NOT NULL,
  action VARCHAR(40) NOT NULL,
  details JSON NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (actor_id) REFERENCES users(id),
  FOREIGN KEY (target_id) REFERENCES users(id),
  INDEX (target_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
