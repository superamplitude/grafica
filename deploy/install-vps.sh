#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
REPO="https://github.com/superamplitude/grafica.git"
BACKUP_ROOT="/home/belastock-grafica/backups"
STAMP="$(date +%Y%m%d_%H%M%S)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root." >&2
  exit 1
fi

mkdir -p "$(dirname "$APP_DIR")" "$BACKUP_ROOT"

if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin main
  git reset --hard origin/main
else
  if [ -d "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null || true)" ]; then
    BACKUP_DIR="$BACKUP_ROOT/grafica_pre_node_$STAMP"
    mkdir -p "$BACKUP_DIR"
    cp -a "$APP_DIR/." "$BACKUP_DIR/"
    echo "Backup do conteúdo anterior criado em: $BACKUP_DIR"
    find "$APP_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  else
    mkdir -p "$APP_DIR"
  fi

  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
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

if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then
  echo "[NPM] Lockfile encontrado: usando npm ci."
  npm ci --omit=dev
else
  echo "[NPM] Lockfile ainda não existe: usando npm install."
  npm install --omit=dev
fi

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

printf '\nCentral Prints instalada/atualizada em: %s\n' "$APP_DIR"
printf 'Aplicação local: http://127.0.0.1:3210\n'
printf 'Health check: http://127.0.0.1:3210/api/health\n'
printf 'Próximo passo: validar .env e reverse proxy do domínio.\n'
