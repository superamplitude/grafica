# Central Prints Node — Finalização controlada

Este pacote porta para a arquitetura Node/Fastify os requisitos de finalização do projeto mestre histórico sem reintroduzir WordPress/WooCommerce como dependência.

## Princípios

- O código Node atual, o banco real, os testes e a VPS prevalecem sobre documentação antiga quando houver divergência.
- Nenhum dado comercial é inventado para completar catálogo.
- Saneamento só reutiliza informação já existente e registra antes/depois.
- Catálogo piloto só aceita 5 ou 10 produtos completos e revalida tudo no momento da execução.
- Rollback preserva edição humana posterior: um campo só é revertido se ainda contém exatamente o valor aplicado pela execução.
- Pagamento, entrega, e-mail e mobile exigem atestação de teste real; o sistema não os marca como verificados por inferência.
- Publicação massiva, exclusão, pagamento, reembolso, troca automática de fornecedor e envio automático ao fornecedor permanecem fora deste fluxo.
- Cloudflare/R2 externo não é configurado por esta entrega. O aplicativo apenas usa o contrato de armazenamento já existente e falha de forma segura quando o storage não está pronto.

## Slider principal

- até 6 campanhas de hero;
- imagem desktop e mobile separadas;
- dois CTAs;
- período, ordem e autoplay configuráveis;
- setas, indicadores, teclado, gesto touch e preferência de movimento reduzido;
- imagem administrada como mídia pública `site/banners`.

## Central de Finalização

O Super Admin recebe uma área dedicada com:

- checklist ponderado de prontidão;
- falhas críticas separadas de backlog;
- métricas de catálogo e fornecedores;
- validações explícitas do ambiente real;
- relatório TXT;
- CSV de pendências;
- simulação e execução de saneamento conservador;
- simulação e publicação de catálogo piloto;
- histórico de runs e rollback seguro.

## Critério de produto completo no modelo Node

A arquitetura atual não possui uma tabela paralela de “famílias”; produto, categoria e variante são o modelo canônico. Para evitar lógica duplicada, a prontidão usa:

- imagem principal pública;
- variante ativa, disponível e com preço público;
- categoria comercial válida;
- descrição suficiente;
- gabarito ativo quando o produto exige arte;
- fornecedor aprovado quando qualquer variante declara produção terceirizada/híbrida;
- status publicável.

## Estado de promoção

A aplicação só pode ser considerada pronta para promoção comercial quando os itens críticos do checklist estiverem aprovados e a homologação real do ambiente definitivo tiver sido concluída. CI verde comprova código e schema; não substitui teste real de pagamento, entrega, e-mail, mobile ou operação na VPS.
