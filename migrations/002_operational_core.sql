SET @db := DATABASE();

SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='suppliers' AND COLUMN_NAME='login_url')=0,'ALTER TABLE suppliers ADD COLUMN login_url VARCHAR(500) NULL AFTER website_url','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='suppliers' AND COLUMN_NAME='price_table_url')=0,'ALTER TABLE suppliers ADD COLUMN price_table_url VARCHAR(500) NULL AFTER catalog_url','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='suppliers' AND COLUMN_NAME='integration_url')=0,'ALTER TABLE suppliers ADD COLUMN integration_url VARCHAR(500) NULL AFTER price_table_url','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='suppliers' AND COLUMN_NAME='catalog_source_type')=0,'ALTER TABLE suppliers ADD COLUMN catalog_source_type VARCHAR(40) NULL AFTER integration_type','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='suppliers' AND COLUMN_NAME='direct_shipping_mode')=0,'ALTER TABLE suppliers ADD COLUMN direct_shipping_mode ENUM(''unknown'',''confirmed'',''unsupported'') NOT NULL DEFAULT ''unknown'' AFTER fulfillment_direct','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='suppliers' AND COLUMN_NAME='white_label_status')=0,'ALTER TABLE suppliers ADD COLUMN white_label_status ENUM(''unknown'',''confirmed'',''unsupported'') NOT NULL DEFAULT ''unknown'' AFTER neutral_packaging','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='suppliers' AND COLUMN_NAME='sync_mode')=0,'ALTER TABLE suppliers ADD COLUMN sync_mode ENUM(''manual'',''assisted'',''api'') NOT NULL DEFAULT ''manual'' AFTER is_primary','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='suppliers' AND COLUMN_NAME='last_sync_at')=0,'ALTER TABLE suppliers ADD COLUMN last_sync_at DATETIME NULL AFTER sync_mode','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='products' AND COLUMN_NAME='featured')=0,'ALTER TABLE products ADD COLUMN featured TINYINT(1) NOT NULL DEFAULT 0 AFTER status','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='products' AND COLUMN_NAME='sort_order')=0,'ALTER TABLE products ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER featured','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND COLUMN_NAME='external_code')=0,'ALTER TABLE product_variants ADD COLUMN external_code VARCHAR(120) NULL AFTER sku','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND COLUMN_NAME='supplier_cost')=0,'ALTER TABLE product_variants ADD COLUMN supplier_cost DECIMAL(14,4) NOT NULL DEFAULT 0 AFTER price','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND COLUMN_NAME='additional_cost')=0,'ALTER TABLE product_variants ADD COLUMN additional_cost DECIMAL(14,4) NOT NULL DEFAULT 0 AFTER supplier_cost','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND COLUMN_NAME='public_price')=0,'ALTER TABLE product_variants ADD COLUMN public_price DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER additional_cost','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND COLUMN_NAME='reseller_price')=0,'ALTER TABLE product_variants ADD COLUMN reseller_price DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER public_price','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND COLUMN_NAME='quantity')=0,'ALTER TABLE product_variants ADD COLUMN quantity DECIMAL(14,3) NOT NULL DEFAULT 1 AFTER reseller_price','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND COLUMN_NAME='size_label')=0,'ALTER TABLE product_variants ADD COLUMN size_label VARCHAR(120) NULL AFTER quantity','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND COLUMN_NAME='print_configuration')=0,'ALTER TABLE product_variants ADD COLUMN print_configuration VARCHAR(40) NULL AFTER size_label','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND COLUMN_NAME='production_days')=0,'ALTER TABLE product_variants ADD COLUMN production_days INT UNSIGNED NULL AFTER print_configuration','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND COLUMN_NAME='availability')=0,'ALTER TABLE product_variants ADD COLUMN availability ENUM(''available'',''unavailable'',''on_request'') NOT NULL DEFAULT ''available'' AFTER production_days','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND INDEX_NAME='uq_variant_external_code')=0,'ALTER TABLE product_variants ADD UNIQUE KEY uq_variant_external_code (external_code)','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS product_media (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  media_id BIGINT UNSIGNED NOT NULL,
  role ENUM('cover','gallery','mockup','technical') NOT NULL DEFAULT 'gallery',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_media_role (product_id, media_id, role),
  KEY idx_product_media_order (product_id, role, sort_order),
  CONSTRAINT fk_product_media_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_product_media_media FOREIGN KEY (media_id) REFERENCES media_objects(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pricing_rules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  commercial_table ENUM('public','reseller') NOT NULL DEFAULT 'public',
  scope_type ENUM('variant','product','category','supplier','global') NOT NULL DEFAULT 'global',
  scope_value VARCHAR(190) NOT NULL DEFAULT '*',
  calculation_method ENUM('markup_percentage','real_margin_percentage','fixed_addition','multiplier','manual_price') NOT NULL,
  calculation_value DECIMAL(14,4) NOT NULL DEFAULT 0,
  minimum_margin DECIMAL(8,4) NOT NULL DEFAULT 0,
  rounding_rule ENUM('ending_99','ending_90','next_integer','multiple_5','none') NOT NULL DEFAULT 'ending_90',
  priority INT NOT NULL DEFAULT 100,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_pricing_resolution (commercial_table, scope_type, scope_value, status, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS price_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  variant_id BIGINT UNSIGNED NOT NULL,
  commercial_table ENUM('public','reseller') NOT NULL,
  previous_price DECIMAL(14,2) NULL,
  new_price DECIMAL(14,2) NOT NULL,
  real_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
  margin_percent DECIMAL(8,4) NULL,
  rule_id BIGINT UNSIGNED NULL,
  actor_type VARCHAR(40) NOT NULL DEFAULT 'system',
  actor_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_price_history_variant (variant_id, created_at),
  CONSTRAINT fk_price_history_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
  CONSTRAINT fk_price_history_rule FOREIGN KEY (rule_id) REFERENCES pricing_rules(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('super_admin','admin','operations','prepress','support') NOT NULL DEFAULT 'support',
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS revoked_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  jti CHAR(36) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_revoked_expiry (expires_at),
  CONSTRAINT fk_revoked_user FOREIGN KEY (user_id) REFERENCES staff_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  from_status VARCHAR(60) NULL,
  to_status VARCHAR(60) NULL,
  actor_type VARCHAR(40) NOT NULL DEFAULT 'system',
  actor_id BIGINT UNSIGNED NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_order_events (order_id, created_at),
  CONSTRAINT fk_order_event_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS artwork_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  artwork_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  actor_type VARCHAR(40) NOT NULL DEFAULT 'system',
  actor_id BIGINT UNSIGNED NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_artwork_events (artwork_id, created_at),
  CONSTRAINT fk_artwork_event_artwork FOREIGN KEY (artwork_id) REFERENCES artworks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS production_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  production_job_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  from_status VARCHAR(60) NULL,
  to_status VARCHAR(60) NULL,
  actor_type VARCHAR(40) NOT NULL DEFAULT 'system',
  actor_id BIGINT UNSIGNED NULL,
  payload_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_production_events (production_job_id, created_at),
  CONSTRAINT fk_production_event_job FOREIGN KEY (production_job_id) REFERENCES production_jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_actions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dedupe_key VARCHAR(190) NULL,
  action_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NULL,
  entity_id BIGINT UNSIGNED NULL,
  risk_level ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status ENUM('proposed','approved','rejected','executing','executed','failed','rolled_back') NOT NULL DEFAULT 'proposed',
  payload_json JSON NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  proposed_by VARCHAR(80) NOT NULL DEFAULT 'ai',
  approved_by_user_id BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  executed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ai_dedupe (dedupe_key),
  KEY idx_ai_status_risk (status, risk_level, created_at),
  CONSTRAINT fk_ai_approved_user FOREIGN KEY (approved_by_user_id) REFERENCES staff_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_blocks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  block_key VARCHAR(190) NOT NULL UNIQUE,
  block_type VARCHAR(60) NOT NULL DEFAULT 'text',
  title VARCHAR(255) NULL,
  content_json JSON NULL,
  status ENUM('draft','active','archived') NOT NULL DEFAULT 'active',
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_content_updated_user FOREIGN KEY (updated_by_user_id) REFERENCES staff_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS banners (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  placement VARCHAR(80) NOT NULL DEFAULT 'home-hero',
  desktop_media_id BIGINT UNSIGNED NULL,
  mobile_media_id BIGINT UNSIGNED NULL,
  eyebrow VARCHAR(190) NULL,
  title VARCHAR(500) NULL,
  body TEXT NULL,
  cta_label VARCHAR(120) NULL,
  cta_url VARCHAR(500) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  status ENUM('draft','active','paused','archived') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_banner_desktop_media FOREIGN KEY (desktop_media_id) REFERENCES media_objects(id) ON DELETE SET NULL,
  CONSTRAINT fk_banner_mobile_media FOREIGN KEY (mobile_media_id) REFERENCES media_objects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS legacy_import_map (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_system VARCHAR(40) NOT NULL,
  source_type VARCHAR(80) NOT NULL,
  source_id VARCHAR(190) NOT NULL,
  target_type VARCHAR(80) NOT NULL,
  target_id BIGINT UNSIGNED NOT NULL,
  source_hash CHAR(64) NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_legacy_source (source_system, source_type, source_id),
  KEY idx_legacy_target (target_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
