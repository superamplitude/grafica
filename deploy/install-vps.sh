#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
REPO="https://github.com/superamplitude/grafica.git"

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root." >&2
  exit 1
fi

mkdir -p "$(dirname "$APP_DIR")"

if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin main
  git reset --hard origin/main
elif [ -z "$(ls -A "$APP_DIR" 2>/dev/null || true)" ]; then
  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
else
  echo "ERRO: $APP_DIR existe e não está vazio. Nada foi sobrescrito." >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERRO: Node.js 20+ ainda não está instalado." >&2
  exit 3
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERRO: Node.js 20+ é obrigatório. Atual: $(node -v)" >&2
  exit 4
fi

npm ci --omit=dev || npm install --omit=dev

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "Criado .env. Configure banco, R2 e JWT antes de produção."
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

printf '\nCentral Prints instalada em: %s\n' "$APP_DIR"
printf 'Aplicação local: http://127.0.0.1:3210\n'
printf 'Health check: http://127.0.0.1:3210/api/health\n'
printf 'Próximo passo: configurar .env e reverse proxy do domínio.\n'
