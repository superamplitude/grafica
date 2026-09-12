#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
BACKUP_ROOT="/home/belastock-grafica/backups"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/repo_sync_$STAMP"

log(){ printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
fail(){ echo "[ERRO] $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Execute como root."
[ -d "$APP_DIR/.git" ] || fail "Repositorio nao encontrado em $APP_DIR"

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

log "Registrando estado local antes da sincronizacao"
git status --porcelain=v1 > "$BACKUP_DIR/git-status.txt" || true
git diff > "$BACKUP_DIR/tracked-changes.patch" || true
git rev-parse HEAD > "$BACKUP_DIR/head-before.txt" || true

if [ -f package-lock.json ] && ! git ls-files --error-unmatch package-lock.json >/dev/null 2>&1; then
  log "Preservando package-lock.json local nao rastreado"
  cp -a package-lock.json "$BACKUP_DIR/package-lock.local.json"
  rm -f package-lock.json
fi

log "Sincronizando com origin/main"
git fetch origin main
git reset --hard origin/main

CURRENT="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"
[ "$CURRENT" = "$REMOTE" ] || fail "HEAD local nao coincide com origin/main apos reset."

echo "$CURRENT" > "$BACKUP_DIR/head-after.txt"

log "Executando reparo e validacao do runtime"
exec bash deploy/repair-runtime.sh
