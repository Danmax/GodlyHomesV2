ALTER TABLE subscribers
  ADD COLUMN resend_contact_id VARCHAR(80) NULL,
  ADD COLUMN resend_segment_id CHAR(36) NULL,
  ADD COLUMN resend_synced_at DATETIME NULL,
  ADD COLUMN resend_sync_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN resend_retry_at DATETIME NULL,
  ADD COLUMN resend_sync_error VARCHAR(80) NULL;
CREATE INDEX subscribers_resend_retry ON subscribers (resend_retry_at, resend_synced_at);
