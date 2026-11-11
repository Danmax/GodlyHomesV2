ALTER TABLE account_tokens ADD COLUMN sent_at DATETIME NULL;
UPDATE account_tokens SET sent_at = created_at;
ALTER TABLE users
  ADD COLUMN welcome_lease_token CHAR(36) NULL,
  ADD COLUMN welcome_lease_until DATETIME NULL,
  ADD COLUMN welcome_retry_at DATETIME NULL,
  ADD COLUMN welcome_attempts INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE subscribers
  ADD COLUMN resend_lease_token CHAR(36) NULL,
  ADD COLUMN resend_lease_until DATETIME NULL;
ALTER TABLE subscribers
  ADD COLUMN confirmed_at DATETIME NULL,
  ADD COLUMN confirmation_token_hash CHAR(64) NULL,
  ADD COLUMN confirmation_requested_at DATETIME NULL,
  ADD COLUMN confirmation_expires_at DATETIME NULL,
  ADD COLUMN confirmation_sent_at DATETIME NULL;
UPDATE subscribers SET confirmed_at = consent_at;
CREATE UNIQUE INDEX subscribers_confirmation_token ON subscribers (confirmation_token_hash);
