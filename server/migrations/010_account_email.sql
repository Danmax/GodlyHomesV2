ALTER TABLE users MODIFY COLUMN role ENUM('member','publisher','admin') NOT NULL DEFAULT 'publisher';
ALTER TABLE users ADD COLUMN email_verification_required BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN email_verified_at DATETIME NULL, ADD COLUMN welcome_sent_at DATETIME NULL;
UPDATE users SET email_verified_at = created_at, welcome_sent_at = created_at;

CREATE TABLE account_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  purpose ENUM('verify','reset') NOT NULL,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX (user_id, purpose), INDEX (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
