SET @db := DATABASE();

SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='banners' AND COLUMN_NAME='secondary_cta_label')=0,'ALTER TABLE banners ADD COLUMN secondary_cta_label VARCHAR(120) NULL AFTER cta_url','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='banners' AND COLUMN_NAME='secondary_cta_url')=0,'ALTER TABLE banners ADD COLUMN secondary_cta_url VARCHAR(500) NULL AFTER secondary_cta_label','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='banners' AND COLUMN_NAME='autoplay_seconds')=0,'ALTER TABLE banners ADD COLUMN autoplay_seconds TINYINT UNSIGNED NOT NULL DEFAULT 7 AFTER secondary_cta_url','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS launch_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_uuid CHAR(36) NOT NULL UNIQUE,
  run_type ENUM('repair','pilot') NOT NULL,
  status ENUM('simulated','executed','rolled_back','failed') NOT NULL DEFAULT 'simulated',
  actor_user_id BIGINT UNSIGNED NULL,
  summary_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  executed_at DATETIME NULL,
  rolled_back_at DATETIME NULL,
  KEY idx_launch_runs_type_status (run_type,status,created_at),
  CONSTRAINT fk_launch_run_actor FOREIGN KEY(actor_user_id) REFERENCES staff_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS launch_changes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT UNSIGNED NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  field_name VARCHAR(120) NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  reason TEXT NULL,
  status ENUM('planned','applied','rolled_back','skipped') NOT NULL DEFAULT 'planned',
  skip_reason VARCHAR(190) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at DATETIME NULL,
  rolled_back_at DATETIME NULL,
  UNIQUE KEY uq_launch_change (run_id,entity_type,entity_id,field_name),
  KEY idx_launch_change_entity (entity_type,entity_id,status),
  CONSTRAINT fk_launch_change_run FOREIGN KEY(run_id) REFERENCES launch_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS launch_attestations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  attestation_key VARCHAR(80) NOT NULL UNIQUE,
  status ENUM('pending','verified','blocked') NOT NULL DEFAULT 'pending',
  note TEXT NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_launch_attestation_user FOREIGN KEY(updated_by_user_id) REFERENCES staff_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO launch_attestations (attestation_key,status,note)
VALUES
('payment','pending','Validar gateway real e pagamento controlado.'),
('shipping','pending','Validar entrega ou retirada no ambiente real.'),
('email','pending','Validar e-mail transacional durante homologacao.'),
('mobile','pending','Validar compra, arte, prova e acompanhamento em dispositivo movel.')
ON DUPLICATE KEY UPDATE attestation_key=VALUES(attestation_key);
