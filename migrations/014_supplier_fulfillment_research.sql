-- Homologacao inicial de fornecedores para operacao de revenda.
-- Confirmado = evidencia operacional suficiente para o campo indicado.
-- Unknown = exige confirmacao comercial/contratual antes de automacao.

UPDATE suppliers
SET fulfillment_direct=1,
    direct_shipping_mode='confirmed',
    notes=CONCAT('Revenda grafica. Entrega porta a porta disponivel; envio ao cliente confirmado pelo operador Central Prints. Embalagem neutra/white label deve ser validada na conta contratada.')
WHERE slug='zap-grafica';

UPDATE suppliers
SET fulfillment_direct=1,
    direct_shipping_mode='confirmed',
    neutral_packaging=1,
    white_label_status='confirmed',
    notes='Programa oficial de revendedores informa envio direto ao endereco do cliente, embalagem discreta sem marca de origem e valores de compra ocultos do cliente final. Integracao permanece manual/assistida ate API oficial ser homologada.'
WHERE slug='atual-card';

UPDATE suppliers
SET fulfillment_direct=0,
    direct_shipping_mode='unknown',
    neutral_packaging=0,
    white_label_status='unknown',
    notes='Programa oficial de revendedores e entrega nacional confirmados. Dropshipping ao cliente final sem identificacao da GIV ainda precisa de confirmacao comercial antes da ativacao.'
WHERE slug='giv-online';

INSERT INTO suppliers
(name,slug,website_url,login_url,catalog_url,price_table_url,integration_url,catalog_source_type,fulfillment_direct,direct_shipping_mode,neutral_packaging,white_label_status,integration_type,is_primary,sync_mode,status,notes)
VALUES
('Gráfica Express','grafica-express','https://www.graficaexpress.com.br/','https://www.graficaexpress.com.br/cliente/','https://www.graficaexpress.com.br/produtos','https://www.graficaexpress.com.br/tabela-de-precos',NULL,'assisted',0,'unknown',0,'unknown','assisted',0,'manual','inactive','Site oficial de revenda com Correios, transportadora e retirada. Entrega direta ao cliente final com embalagem sem marca precisa de confirmacao comercial. Sem API publica homologada.'),
('Paulista Cartões','paulista-cartoes','https://www.paulistacartoes.com.br/','https://www.paulistacartoes.com.br/','https://www.paulistacartoes.com.br/',NULL,NULL,'assisted',1,'confirmed',0,'unknown','assisted',0,'manual','inactive','Operacao voltada a revendedores. Documentacao oficial informa entrega diretamente no endereco selecionado via Total Express e modalidades porta a porta. Embalagem neutra/white label e API precisam de confirmacao comercial.')
ON DUPLICATE KEY UPDATE
  website_url=VALUES(website_url),
  login_url=VALUES(login_url),
  catalog_url=VALUES(catalog_url),
  price_table_url=VALUES(price_table_url),
  catalog_source_type=VALUES(catalog_source_type),
  fulfillment_direct=VALUES(fulfillment_direct),
  direct_shipping_mode=VALUES(direct_shipping_mode),
  neutral_packaging=VALUES(neutral_packaging),
  white_label_status=VALUES(white_label_status),
  integration_type=VALUES(integration_type),
  sync_mode=VALUES(sync_mode),
  notes=VALUES(notes),
  updated_at=NOW();
