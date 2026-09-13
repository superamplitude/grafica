SET @db := DATABASE();

SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='products' AND COLUMN_NAME='supplier_catalog_key')=0,'ALTER TABLE products ADD COLUMN supplier_catalog_key VARCHAR(190) NULL AFTER supplier_id','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='products' AND INDEX_NAME='uq_product_supplier_catalog')=0,'ALTER TABLE products ADD UNIQUE KEY uq_product_supplier_catalog (supplier_id,supplier_catalog_key)','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND COLUMN_NAME='source_uid')=0,'ALTER TABLE product_variants ADD COLUMN source_uid VARCHAR(255) NULL AFTER product_id','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND INDEX_NAME='uq_variant_external_code')>0,'ALTER TABLE product_variants DROP INDEX uq_variant_external_code','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND INDEX_NAME='idx_variant_external_code')=0,'ALTER TABLE product_variants ADD KEY idx_variant_external_code (external_code)','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND INDEX_NAME='uq_variant_source_uid')=0,'ALTER TABLE product_variants ADD UNIQUE KEY uq_variant_source_uid (source_uid)','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS supplier_price_imports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_uuid CHAR(36) NOT NULL UNIQUE,
  supplier_id BIGINT UNSIGNED NULL,
  source_name VARCHAR(255) NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  source_format VARCHAR(80) NOT NULL,
  source_report_date DATE NULL,
  source_row_count INT UNSIGNED NOT NULL DEFAULT 0,
  source_category_count INT UNSIGNED NOT NULL DEFAULT 0,
  source_product_count INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('running','completed','failed','rolled_back') NOT NULL DEFAULT 'running',
  actor_user_id BIGINT UNSIGNED NULL,
  summary_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  executed_at DATETIME NULL,
  rolled_back_at DATETIME NULL,
  KEY idx_supplier_price_import_supplier (supplier_id,created_at),
  KEY idx_supplier_price_import_hash (supplier_id,source_sha256),
  KEY idx_supplier_price_import_status (status,created_at),
  CONSTRAINT fk_supplier_price_import_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  CONSTRAINT fk_supplier_price_import_actor FOREIGN KEY (actor_user_id) REFERENCES staff_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_price_import_changes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  entity_type ENUM('category','product','variant') NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  action ENUM('created','updated') NOT NULL,
  before_json JSON NULL,
  after_json JSON NOT NULL,
  rollback_status ENUM('pending','rolled_back') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_supplier_import_change_sequence (run_id,sequence_no),
  KEY idx_supplier_import_change_entity (entity_type,entity_id),
  CONSTRAINT fk_supplier_import_change_run FOREIGN KEY (run_id) REFERENCES supplier_price_imports(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
