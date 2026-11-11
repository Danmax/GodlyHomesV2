ALTER TABLE subscribers
  ADD COLUMN first_name VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN last_name VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN newsletter_unsubscribed_at DATETIME NULL,
  ADD COLUMN resend_unsubscribed BOOLEAN NULL,
  ADD COLUMN resend_status_checked_at DATETIME NULL;
CREATE TABLE newsletter_campaigns (
  id CHAR(36) PRIMARY KEY,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  state ENUM('draft','preparing','sending','queued','sent','needs_review') NOT NULL DEFAULT 'draft',
  data JSON NOT NULL,
  snapshot JSON NOT NULL,
  content_hash CHAR(64) NOT NULL,
  test_hash CHAR(64) NULL,
  test_to VARCHAR(254) NULL,
  tested_at DATETIME NULL,
  broadcast_id VARCHAR(100) NULL,
  segment_id CHAR(36) NULL,
  operation_token CHAR(36) NULL,
  operation_at DATETIME NULL,
  sent_at DATETIME NULL,
  last_error VARCHAR(80) NULL,
  created_by CHAR(36) NOT NULL,
  updated_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id),
  INDEX (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE subscribers ADD COLUMN resubscribe_pending BOOLEAN NOT NULL DEFAULT FALSE;
