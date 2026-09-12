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

git_safe(){ git -c safe.directory="$APP_DIR" "$@"; }

if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git_safe fetch origin main
  git_safe reset --hard origin/main
else
  if [ -d "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null || true)" ]; then
    BACKUP_DIR="$BACKUP_ROOT/grafica_pre_node_$STAMP"
    mkdir -p "$BACKUP_DIR"
    cp -a "$APP_DIR/." "$BACKUP_DIR/"
    echo "Backup do conteudo anterior criado em: $BACKUP_DIR"
    find "$APP_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  else
    mkdir -p "$APP_DIR"
  fi

  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERRO: Node.js 20+ ainda nao esta instalado." >&2
  exit 3
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERRO: Node.js 20+ e obrigatorio. Atual: $(node -v)" >&2
  exit 4
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

[ -f .env ] || { cp .env.example .env; chmod 600 .env; }

exec bash deploy/repair-runtime.sh
