SET @db := DATABASE();

SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND COLUMN_NAME='pricing_review_status')=0,
  'ALTER TABLE product_variants ADD COLUMN pricing_review_status ENUM(''published'',''review'',''blocked'') NOT NULL DEFAULT ''published'' AFTER availability','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND COLUMN_NAME='pricing_review_reason')=0,
  'ALTER TABLE product_variants ADD COLUMN pricing_review_reason VARCHAR(190) NULL AFTER pricing_review_status','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='product_variants' AND INDEX_NAME='idx_variant_pricing_review')=0,
  'ALTER TABLE product_variants ADD KEY idx_variant_pricing_review (pricing_review_status,availability,public_price)','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Política comercial corrigida: 35% e 18% são markup sobre o custo, não margem real sobre a venda.
UPDATE pricing_rules
   SET status='inactive'
 WHERE scope_type='global' AND scope_value='*' AND commercial_table IN ('public','reseller');
INSERT INTO pricing_rules (commercial_table,scope_type,scope_value,calculation_method,calculation_value,minimum_margin,rounding_rule,priority,status)
VALUES
('public','global','*','markup_percentage',35,10,'ending_90',10,'active'),
('reseller','global','*','markup_percentage',18,8,'ending_90',10,'active');

-- Recalcula a base atual preservando a regra de final .90.
UPDATE product_variants
   SET public_price = CASE
       WHEN supplier_cost+additional_cost<=0 THEN public_price
       WHEN FLOOR((supplier_cost+additional_cost)*1.35)+0.90 < (supplier_cost+additional_cost)*1.35
         THEN FLOOR((supplier_cost+additional_cost)*1.35)+1.90
       ELSE FLOOR((supplier_cost+additional_cost)*1.35)+0.90 END,
       reseller_price = CASE
       WHEN supplier_cost+additional_cost<=0 THEN reseller_price
       WHEN FLOOR((supplier_cost+additional_cost)*1.18)+0.90 < (supplier_cost+additional_cost)*1.18
         THEN FLOOR((supplier_cost+additional_cost)*1.18)+1.90
       ELSE FLOOR((supplier_cost+additional_cost)*1.18)+0.90 END,
       price = CASE
       WHEN supplier_cost+additional_cost<=0 THEN price
       WHEN FLOOR((supplier_cost+additional_cost)*1.35)+0.90 < (supplier_cost+additional_cost)*1.35
         THEN FLOOR((supplier_cost+additional_cost)*1.35)+1.90
       ELSE FLOOR((supplier_cost+additional_cost)*1.35)+0.90 END
 WHERE status='active';

-- Custos extremos não são apagados nem corrigidos por chute: ficam bloqueados do catálogo até revisão humana.
UPDATE product_variants
   SET pricing_review_status='review',pricing_review_reason='supplier_cost_over_100k',availability='unavailable'
 WHERE supplier_cost+additional_cost>=100000;
UPDATE product_variants
   SET pricing_review_status='review',pricing_review_reason='missing_or_invalid_cost',availability='unavailable'
 WHERE supplier_cost+additional_cost<=0 AND status='active';
UPDATE product_variants
   SET pricing_review_status='published',pricing_review_reason=NULL
 WHERE supplier_cost+additional_cost>0 AND supplier_cost+additional_cost<100000 AND pricing_review_status<>'blocked';

-- Famílias principais inspiradas na navegação de grandes gráficas, sem copiar identidade ou conteúdo.
INSERT INTO categories (name,slug,description,status,sort_order) VALUES
('Papelaria e impressos','papelaria-e-impressos','Cartões, folders, flyers, papelaria e impressos comerciais.','active',10),
('Adesivos e rótulos','adesivos-e-rotulos-menu','Adesivos, etiquetas, lacres, rótulos e vinis.','active',20),
('Comunicação visual','comunicacao-visual-menu','Banners, lonas, placas, displays, faixas e sinalização.','active',30),
('Embalagens e sacolas','embalagens-e-sacolas','Caixas, sacolas, envelopes de envio e materiais de embalagem.','active',40),
('Brindes e personalizados','brindes-e-personalizados','Canecas, vestuário, ímãs, bottons e itens personalizados.','active',50),
('Eleições 2026','eleicoes-2026-menu','Materiais gráficos para campanhas eleitorais.','active',60)
ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),status='active',sort_order=VALUES(sort_order);

SET @p_papel := (SELECT id FROM categories WHERE slug='papelaria-e-impressos' LIMIT 1);
SET @p_adesivo := (SELECT id FROM categories WHERE slug='adesivos-e-rotulos-menu' LIMIT 1);
SET @p_visual := (SELECT id FROM categories WHERE slug='comunicacao-visual-menu' LIMIT 1);
SET @p_emb := (SELECT id FROM categories WHERE slug='embalagens-e-sacolas' LIMIT 1);
SET @p_brinde := (SELECT id FROM categories WHERE slug='brindes-e-personalizados' LIMIT 1);
SET @p_eleicao := (SELECT id FROM categories WHERE slug='eleicoes-2026-menu' LIMIT 1);

UPDATE categories SET parent_id=@p_eleicao
 WHERE parent_id IS NULL AND id<>@p_eleicao AND (UPPER(name) LIKE '%ELEIÇ%' OR UPPER(name) LIKE '%ELEIC%');
UPDATE categories SET parent_id=@p_adesivo
 WHERE parent_id IS NULL AND id<>@p_adesivo AND (UPPER(name) LIKE '%ADESIV%' OR UPPER(name) LIKE '%RÓTUL%' OR UPPER(name) LIKE '%ROTUL%' OR UPPER(name) LIKE '%ETIQUET%' OR UPPER(name) LIKE '%VINIL%' OR UPPER(name) LIKE '%LACRE%');
UPDATE categories SET parent_id=@p_visual
 WHERE parent_id IS NULL AND id<>@p_visual AND (UPPER(name) LIKE '%BANNER%' OR UPPER(name) LIKE '%LONA%' OR UPPER(name) LIKE '%PLACA%' OR UPPER(name) LIKE '%FAIXA%' OR UPPER(name) LIKE '%DISPLAY%' OR UPPER(name) LIKE '%TOTEM%' OR UPPER(name) LIKE '%WIND%' OR UPPER(name) LIKE '%BANDEIR%');
UPDATE categories SET parent_id=@p_emb
 WHERE parent_id IS NULL AND id<>@p_emb AND (UPPER(name) LIKE '%SACOLA%' OR UPPER(name) LIKE '%SACO%' OR UPPER(name) LIKE '%CAIXA%' OR UPPER(name) LIKE '%EMBALAG%' OR UPPER(name) LIKE '%DELIVERY%');
UPDATE categories SET parent_id=@p_brinde
 WHERE parent_id IS NULL AND id<>@p_brinde AND (UPPER(name) LIKE '%CANECA%' OR UPPER(name) LIKE '%COPO%' OR UPPER(name) LIKE '%TAÇA%' OR UPPER(name) LIKE '%TACA%' OR UPPER(name) LIKE '%CAMISE%' OR UPPER(name) LIKE '%BRINDE%' OR UPPER(name) LIKE '%AZULEJO%' OR UPPER(name) LIKE '%BARALHO%' OR UPPER(name) LIKE '%BOTTON%' OR UPPER(name) LIKE '%ÍMÃ%' OR UPPER(name) LIKE '%IMA %' OR UPPER(name) LIKE '%CHAVEIRO%');
UPDATE categories SET parent_id=@p_papel
 WHERE parent_id IS NULL AND id NOT IN (@p_papel,@p_adesivo,@p_visual,@p_emb,@p_brinde,@p_eleicao)
   AND (UPPER(name) LIKE '%CART%' OR UPPER(name) LIKE '%FLYER%' OR UPPER(name) LIKE '%PANFLE%' OR UPPER(name) LIKE '%FOLHET%' OR UPPER(name) LIKE '%FOLDER%' OR UPPER(name) LIKE '%PASTA%' OR UPPER(name) LIKE '%PAPEL%' OR UPPER(name) LIKE '%ENVELOPE%' OR UPPER(name) LIKE '%BLOCO%' OR UPPER(name) LIKE '%RECEITU%' OR UPPER(name) LIKE '%TALÃO%' OR UPPER(name) LIKE '%TALAO%' OR UPPER(name) LIKE '%CADERN%' OR UPPER(name) LIKE '%AGENDA%' OR UPPER(name) LIKE '%CALEND%' OR UPPER(name) LIKE '%CARDÁPIO%' OR UPPER(name) LIKE '%CARDAPIO%' OR UPPER(name) LIKE '%CATÁLOG%' OR UPPER(name) LIKE '%CATALOG%' OR UPPER(name) LIKE '%POSTAL%' OR UPPER(name) LIKE '%CERTIFIC%');

UPDATE products p
   SET base_price=COALESCE((SELECT MIN(v.public_price) FROM product_variants v WHERE v.product_id=p.id AND v.status='active' AND v.availability='available' AND v.pricing_review_status='published' AND v.public_price>0),0);

INSERT INTO content_blocks (block_key,block_type,title,content_json,status) VALUES
('site_identity','site_identity','Identidade da loja',JSON_OBJECT('brandName','Central Prints','logoUrl',''),'active'),
('site_contact','contact','Contato',JSON_OBJECT('phone','','whatsapp','','email','','address','','city','','state','','zip',''),'active'),
('delivery_notice','notice','Entrega',JSON_OBJECT('enabled',true,'text','Frete para todo o Brasil • Produção acompanhada do início ao fim'),'active'),
('faq','faq','Perguntas frequentes',JSON_OBJECT('items',JSON_ARRAY()),'active'),
('home_blocks','blocks','Blocos da página inicial',JSON_OBJECT('items',JSON_ARRAY()),'active')
ON DUPLICATE KEY UPDATE block_key=VALUES(block_key);
