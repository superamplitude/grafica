SET @db := DATABASE();
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='artworks' AND COLUMN_NAME='superseded_at')=0,
  'ALTER TABLE artworks ADD COLUMN superseded_at DATETIME NULL AFTER preflight_json',
  'SELECT 1'
);
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='artworks' AND INDEX_NAME='idx_artworks_current_item_side')=0,
  'ALTER TABLE artworks ADD INDEX idx_artworks_current_item_side (order_item_id,side,superseded_at,id)',
  'SELECT 1'
);
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
