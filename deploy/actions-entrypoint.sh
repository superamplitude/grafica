#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
LOCK_FILE="/var/lock/central-prints-actions-deploy.lock"
ORIGINAL="${SSH_ORIGINAL_COMMAND:-}"

log(){ printf '[central-prints-actions] %s\n' "$*"; }
fail(){ printf '[central-prints-actions][ERRO] %s\n' "$*" >&2; exit 126; }

[ "$(id -u)" -eq 0 ] || fail "Este entrypoint deve executar como root."
[ -d "$APP_DIR/.git" ] || fail "Repositorio nao encontrado em $APP_DIR"
command -v flock >/dev/null 2>&1 || fail "flock nao encontrado."

case "$ORIGINAL" in
  central-prints-deploy)
    log "Deploy autorizado."
    exec flock -n "$LOCK_FILE" /bin/bash "$APP_DIR/deploy/update-vps.sh"
    ;;
  central-prints-diagnostics)
    log "Diagnostico somente leitura."
    cd "$APP_DIR"
    printf 'HEAD='; git -c safe.directory="$APP_DIR" rev-parse --short HEAD || true
    printf 'BRANCH='; git -c safe.directory="$APP_DIR" branch --show-current || true
    printf 'NODE='; node --version || true
    printf 'NPM='; npm --version || true
    printf '\n--- PM2 ---\n'
    pm2 status || true
    printf '\n--- LISTEN ---\n'
    ss -ltnp 2>/dev/null | grep -E ':(3005|3210)\b' || true
    printf '\n--- HEALTH 3005 ---\n'
    curl -sS -i --max-time 5 http://127.0.0.1:3005/api/health || true
    printf '\n--- READY 3005 ---\n'
    curl -sS -i --max-time 5 http://127.0.0.1:3005/api/ready || true
    printf '\n--- PM2 LOGS (last 120 lines) ---\n'
    pm2 logs central-prints --lines 120 --nostream || true
    printf '\n--- PREFLIGHT LOGS (last 120 lines) ---\n'
    pm2 logs central-prints-preflight --lines 120 --nostream || true
    ;;
  *)
    fail "Comando remoto negado. Permitidos: central-prints-deploy, central-prints-diagnostics"
    ;;
esac
