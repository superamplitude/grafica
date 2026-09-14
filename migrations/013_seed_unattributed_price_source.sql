INSERT INTO suppliers
(name, slug, catalog_source_type, fulfillment_direct, direct_shipping_mode, neutral_packaging, white_label_status, integration_type, is_primary, sync_mode, status, notes)
VALUES
('Fonte não identificada — Tabela 12/09/2026','source-table-2026-09-12','assisted',0,'unknown',0,'unknown','assisted',0,'manual','inactive','Fonte técnica interna criada exclusivamente para vincular a tabela de preços de 12/09/2026. A identidade do fornecedor não é comprovada pelo conteúdo do arquivo. Não usar para expedição, integração ou envio automático à produção até homologação explícita.')
ON DUPLICATE KEY UPDATE
name=VALUES(name),status='inactive',notes=VALUES(notes),updated_at=NOW();
