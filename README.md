# Central Prints / Gráfica Bela Stock

Aplicação gráfica independente em Node.js para `grafica.belastock.com.br`.

## Arquitetura

- Node.js 20+
- Fastify
- MySQL/MariaDB
- Cloudflare R2 para imagens, gabaritos, mockups, artes e provas
- Nginx como reverse proxy
- PM2 para processo de produção
- GitHub como fonte oficial do código

## Diretório de produção

`/home/belastock-grafica/htdocs/grafica.belastock.com.br`

## Princípios

- Portal público e Super Admin independentes do WordPress.
- Migração controlada do conteúdo legado WordPress/WooCommerce.
- Arquivos pesados fora do VPS, no Cloudflare R2.
- Artes e arquivos privados com acesso assinado.
- Deploy versionado e rollback.

## Estado

Base Node inicial para reconstrução da Central Prints 3.x.
