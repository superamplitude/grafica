SET @db := DATABASE();

ALTER TABLE product_templates
  MODIFY COLUMN media_id BIGINT UNSIGNED NULL,
  MODIFY COLUMN template_type ENUM('pdf','svg','eps','cdr','ai','psd','indd','canva','other') NOT NULL;

SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_templates' AND COLUMN_NAME='external_url')=0,'ALTER TABLE product_templates ADD COLUMN external_url VARCHAR(1000) NULL AFTER media_id','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_templates' AND COLUMN_NAME='version_label')=0,'ALTER TABLE product_templates ADD COLUMN version_label VARCHAR(120) NULL AFTER template_type','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_templates' AND COLUMN_NAME='brand_neutral')=0,'ALTER TABLE product_templates ADD COLUMN brand_neutral TINYINT(1) NOT NULL DEFAULT 0 AFTER bleed_mm','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_templates' AND COLUMN_NAME='verified_at')=0,'ALTER TABLE product_templates ADD COLUMN verified_at DATETIME NULL AFTER brand_neutral','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_templates' AND COLUMN_NAME='verified_by_user_id')=0,'ALTER TABLE product_templates ADD COLUMN verified_by_user_id BIGINT UNSIGNED NULL AFTER verified_at','SELECT 1'); PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS media_asset_reviews (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  media_id BIGINT UNSIGNED NOT NULL,
  usage_type ENUM('product','hero','template','other') NOT NULL DEFAULT 'other',
  photo_type ENUM('real','render','illustration','not_applicable','unknown') NOT NULL DEFAULT 'unknown',
  supplier_branding ENUM('clear','found','unknown') NOT NULL DEFAULT 'unknown',
  price_text ENUM('clear','found','unknown') NOT NULL DEFAULT 'unknown',
  license_status ENUM('owned','licensed','reference_only','unknown') NOT NULL DEFAULT 'unknown',
  review_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  notes TEXT NULL,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_media_asset_review_media (media_id),
  KEY idx_media_asset_review_status (usage_type,review_status),
  CONSTRAINT fk_media_asset_review_media FOREIGN KEY (media_id) REFERENCES media_objects(id) ON DELETE CASCADE,
  CONSTRAINT fk_media_asset_review_user FOREIGN KEY (reviewed_by_user_id) REFERENCES staff_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS commerce_integrations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  integration_type ENUM('payment','shipping') NOT NULL,
  provider_code VARCHAR(80) NOT NULL,
  display_name VARCHAR(190) NOT NULL,
  integration_mode ENUM('manual','api','redirect','aggregator') NOT NULL DEFAULT 'manual',
  adapter_status ENUM('planned','implemented','verified') NOT NULL DEFAULT 'planned',
  status ENUM('inactive','testing','active','blocked') NOT NULL DEFAULT 'inactive',
  capabilities_json JSON NULL,
  config_json JSON NULL,
  secret_env_json JSON NULL,
  notes TEXT NULL,
  verified_at DATETIME NULL,
  verified_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_commerce_provider (integration_type,provider_code),
  KEY idx_commerce_status (integration_type,status,adapter_status),
  CONSTRAINT fk_commerce_verified_user FOREIGN KEY (verified_by_user_id) REFERENCES staff_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO commerce_integrations (integration_type,provider_code,display_name,integration_mode,adapter_status,status,capabilities_json,secret_env_json,notes) VALUES
('payment','mercado_pago','Mercado Pago','api','planned','inactive',JSON_ARRAY('pix','credit_card','boleto'),JSON_ARRAY('MERCADO_PAGO_ACCESS_TOKEN','MERCADO_PAGO_WEBHOOK_SECRET'),'Conector cadastrado para implementação/homologação. Não é exposto ao checkout enquanto não estiver verificado.'),
('payment','pagarme','Pagar.me','api','planned','inactive',JSON_ARRAY('pix','credit_card','boleto'),JSON_ARRAY('PAGARME_SECRET_KEY','PAGARME_WEBHOOK_SECRET'),'Conector cadastrado para implementação/homologação. Não é exposto ao checkout enquanto não estiver verificado.'),
('payment','asaas','Asaas','api','planned','inactive',JSON_ARRAY('pix','credit_card','boleto'),JSON_ARRAY('ASAAS_API_KEY','ASAAS_WEBHOOK_SECRET'),'Conector cadastrado para implementação/homologação. Não é exposto ao checkout enquanto não estiver verificado.'),
('payment','efi','Efí Bank','api','planned','inactive',JSON_ARRAY('pix','credit_card','boleto'),JSON_ARRAY('EFI_CLIENT_ID','EFI_CLIENT_SECRET','EFI_PIX_CERT_PATH'),'Conector cadastrado para implementação/homologação. Não é exposto ao checkout enquanto não estiver verificado.'),
('shipping','melhor_envio','Melhor Envio','aggregator','planned','inactive',JSON_ARRAY('quote','label','tracking'),JSON_ARRAY('MELHOR_ENVIO_TOKEN'),'Agregador logístico cadastrado para implementação/homologação.'),
('shipping','correios','Correios','api','planned','inactive',JSON_ARRAY('quote','tracking'),JSON_ARRAY('CORREIOS_USER','CORREIOS_ACCESS_TOKEN','CORREIOS_CONTRACT'),'Integração direta cadastrada para implementação futura.'),
('shipping','jadlog','Jadlog','api','planned','inactive',JSON_ARRAY('quote','tracking'),JSON_ARRAY('JADLOG_TOKEN'),'Integração direta cadastrada para implementação futura.'),
('shipping','loggi','Loggi','api','planned','inactive',JSON_ARRAY('quote','tracking'),JSON_ARRAY('LOGGI_API_KEY'),'Integração direta cadastrada para implementação futura.'),
('shipping','azul_cargo','Azul Cargo Express','api','planned','inactive',JSON_ARRAY('quote','tracking'),JSON_ARRAY('AZUL_CARGO_CREDENTIALS'),'Integração direta cadastrada para implementação futura.'),
('shipping','local_pickup','Retirada local','manual','implemented','inactive',JSON_ARRAY('pickup'),JSON_ARRAY(),'Habilitar somente quando endereço, horários e regras de retirada estiverem confirmados.'),
('shipping','supplier_delivery','Entrega do fornecedor','manual','implemented','inactive',JSON_ARRAY('manual_quote','tracking'),JSON_ARRAY(),'Uso interno para produção terceirizada; o fornecedor não deve ser exposto ao cliente.')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),integration_mode=VALUES(integration_mode),adapter_status=VALUES(adapter_status),capabilities_json=VALUES(capabilities_json),secret_env_json=VALUES(secret_env_json),notes=VALUES(notes);
