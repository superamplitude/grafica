SET @db := DATABASE();
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='proofs' AND COLUMN_NAME='staff_note')=0,
  'ALTER TABLE proofs ADD COLUMN staff_note TEXT NULL AFTER status',
  'SELECT 1'
);
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
