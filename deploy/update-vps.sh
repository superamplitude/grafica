#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
cd "$APP_DIR"

if [ ! -d .git ]; then
  echo "ERRO: diretório não é um clone Git." >&2
  exit 1
fi

PREVIOUS="$(git rev-parse HEAD)"
printf '%s\n' "$PREVIOUS" > .last-good-commit

git fetch origin main
git reset --hard origin/main
npm ci --omit=dev || npm install --omit=dev

node --check src/server.js
pm2 startOrReload ecosystem.config.cjs --update-env
sleep 2

if ! curl -fsS http://127.0.0.1:3210/api/health >/dev/null; then
  echo "Health check falhou. Executando rollback para $PREVIOUS" >&2
  git reset --hard "$PREVIOUS"
  npm ci --omit=dev || npm install --omit=dev
  pm2 startOrReload ecosystem.config.cjs --update-env
  exit 2
fi

pm2 save
echo "Deploy concluído: $(git rev-parse --short HEAD)"
