# Matriz de referência — projeto mestre 2.7 × Central Prints Node

| Requisito histórico | Implementação Node | Estado deste pacote |
| --- | --- | --- |
| Slider até 6 campanhas | `banners` + `/api/v1/site/hero` | implementado |
| Imagens desktop/mobile | `desktop_media_id` / `mobile_media_id` + mídia `banner` | implementado |
| Dois CTAs | campos primário + secundário | implementado |
| Autoplay, setas, indicadores, teclado, swipe, reduced motion | `public/assets/portal.js` + `portal-slider.css` | implementado |
| Checklist de prontidão | domínio `launch-readiness` + API launch | implementado |
| Separação crítica/backlog | checklist ponderado | implementado |
| Relatório TXT | `/api/v1/admin/launch/report.txt` | implementado |
| Pendências CSV | `/api/v1/admin/launch/pending.csv` | implementado |
| Saneamento conservador | runs/changes + simulação/execução | implementado sem inventar dados |
| Catálogo piloto 5/10 | simulação + revalidação + execução Super Admin | implementado |
| Snapshot e rollback | `launch_runs` / `launch_changes` | implementado |
| Preservar edição posterior | comparação do valor aplicado antes do rollback | implementado |
| Compra real para promoção estável | atestações explícitas | bloqueado até validação real |
| Pagamento/frete/e-mail/mobile | não inferidos | dependência externa / homologação |
| Família WooCommerce | substituída pelo modelo canônico produto/categoria/variante | não duplicar domínio |
| WordPress/WooCommerce | não portado como runtime | descartado por arquitetura atual |

A matriz não declara produção validada apenas por existência de código. A promoção final continua dependente de deploy na VPS e dos testes reais indicados pelas atestações.
