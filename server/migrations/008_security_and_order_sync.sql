CREATE TABLE IF NOT EXISTS upload_gate (id TINYINT PRIMARY KEY) ENGINE=InnoDB;
INSERT IGNORE INTO upload_gate (id) VALUES (1);

CREATE TABLE IF NOT EXISTS upload_reservations (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  kind VARCHAR(10) NOT NULL,
  bytes BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  INDEX (user_id), INDEX (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS image_uploads (
  filename VARCHAR(80) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  bytes BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (user_id)
) ENGINE=InnoDB;

ALTER TABLE store_orders
  ADD COLUMN stripe_payment_intent_id VARCHAR(255) NULL,
  ADD COLUMN amount_refunded BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN refund_status VARCHAR(30) NOT NULL DEFAULT 'none',
  ADD COLUMN dispute_status VARCHAR(40) NOT NULL DEFAULT 'none',
  ADD COLUMN payment_checked_at DATETIME NULL,
  ALGORITHM=INSTANT;

CREATE INDEX store_orders_payment_intent ON store_orders (stripe_payment_intent_id);
