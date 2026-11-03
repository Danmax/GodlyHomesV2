CREATE TABLE IF NOT EXISTS store_orders (
  id CHAR(36) PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  item_id CHAR(36) NOT NULL,
  item_snapshot JSON NOT NULL,
  stripe_price_id VARCHAR(255) NOT NULL,
  stripe_session_id VARCHAR(255) NULL UNIQUE,
  livemode BOOLEAN NOT NULL,
  payment_status ENUM('pending','paid','failed','expired') NOT NULL DEFAULT 'pending',
  fulfillment_status ENUM('unfulfilled','fulfilled') NOT NULL DEFAULT 'unfulfilled',
  amount_total BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL,
  customer_email VARCHAR(254) NULL,
  customer_name VARCHAR(255) NULL,
  shipping JSON NULL,
  notes TEXT NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (created_at),
  INDEX (payment_status, fulfillment_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
