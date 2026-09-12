INSERT IGNORE INTO categories (name,slug,description,sort_order,status) VALUES
('Cartões de visita','cartoes-de-visita','Cartões de visita e materiais de apresentação.',10,'active'),
('Panfletos e flyers','panfletos-e-flyers','Panfletos, flyers e materiais promocionais.',20,'active'),
('Adesivos e rótulos','adesivos-e-rotulos','Adesivos, etiquetas e rótulos personalizados.',30,'active'),
('Banners e lonas','banners-e-lonas','Banners, faixas e materiais em lona.',40,'active'),
('Papelaria','papelaria','Papelaria comercial e institucional.',50,'active'),
('Brindes','brindes','Brindes e itens promocionais.',60,'active'),
('Embalagens','embalagens','Embalagens e materiais personalizados.',70,'active'),
('Comunicação visual','comunicacao-visual','Materiais para sinalização e comunicação visual.',80,'active');

INSERT IGNORE INTO content_blocks (block_key,block_type,title,content_json,status) VALUES
('topbar','text','Atendimento','{"text":"Frete para todo o Brasil • Produção acompanhada do início ao fim"}','active'),
('hero','hero','Impressos que conectam, qualidade que representa.','{"eyebrow":"Gráfica online inteligente","body":"Configure seu produto, baixe o gabarito e envie a arte agora ou depois da compra.","primaryLabel":"Ver produtos","primaryUrl":"#produtos","secondaryLabel":"Como funciona","secondaryUrl":"#como-funciona"}','active'),
('trust','features','Benefícios','{"items":[{"title":"Compra segura","text":"Ambiente protegido"},{"title":"Qualidade","text":"Impressão profissional"},{"title":"Produção ágil","text":"Prazos transparentes"},{"title":"Personalização","text":"Arte agora ou depois"},{"title":"Atendimento","text":"Suporte humano"}]}','active'),
('templates','promo','Gabaritos profissionais e envio de arte sem complicação.','{"body":"Baixe o arquivo correto antes da compra, produza sua arte e envie no momento mais conveniente.","ctaLabel":"Escolher produto","ctaUrl":"#produtos"}','active'),
('footer','text','Central Prints','{"body":"Gráfica online com configuração inteligente, gabaritos profissionais e acompanhamento do pedido."}','active');
