ALTER TABLE store_orders
  MODIFY COLUMN fulfillment_status ENUM('unfulfilled','ready','shipped','fulfilled') NOT NULL DEFAULT 'unfulfilled',
  ADD COLUMN tracking_number VARCHAR(200) NOT NULL DEFAULT '',
  ADD COLUMN shipping_carrier VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN shipped_at DATETIME NULL,
  ADD COLUMN delivered_at DATETIME NULL,
  ADD COLUMN shipment_email_sent_at DATETIME NULL,
  ADD COLUMN shipment_email_claimed_at DATETIME NULL;

UPDATE store_orders SET fulfillment_status = 'ready', version = version + 1
WHERE payment_status = 'paid' AND fulfillment_status = 'unfulfilled';
