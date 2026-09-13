#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
REPO="superamplitude/grafica"
LOCK_FILE="/var/lock/central-prints-actions-deploy.lock"
STATE_DIR="/var/lib/central-prints-autodeploy"
LOG_PREFIX="[central-prints-autodeploy]"

log(){ printf '%s %s\n' "$LOG_PREFIX" "$*"; }
fail(){ printf '%s [ERRO] %s\n' "$LOG_PREFIX" "$*" >&2; exit 1; }
git_safe(){ git -c safe.directory="$APP_DIR" "$@"; }

[ "$(id -u)" -eq 0 ] || fail "Execute como root."
for cmd in git curl python3 flock mktemp; do command -v "$cmd" >/dev/null 2>&1 || fail "Comando ausente: $cmd"; done
[ -d "$APP_DIR/.git" ] || fail "Repositorio ausente: $APP_DIR"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
cd "$APP_DIR"

LOCAL_SHA="$(git_safe rev-parse HEAD)"
if ! git_safe fetch --quiet origin main; then
  log "git fetch falhou; nenhuma alteracao aplicada."
  exit 0
fi
REMOTE_SHA="$(git_safe rev-parse origin/main)"

printf '%s\n' "$LOCAL_SHA" > "$STATE_DIR/local-sha"
printf '%s\n' "$REMOTE_SHA" > "$STATE_DIR/remote-sha"
date -u +%FT%TZ > "$STATE_DIR/last-check-at"

if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  log "VPS ja esta no commit ${LOCAL_SHA:0:12}."
  exit 0
fi

CI_FILE="$(mktemp)"
SCRIPT_FILE="$(mktemp)"
cleanup(){ rm -f "$CI_FILE" "$SCRIPT_FILE"; }
trap cleanup EXIT

API="https://api.github.com/repos/$REPO/actions/runs?head_sha=$REMOTE_SHA&event=push&per_page=20"
if ! curl -fsSL --connect-timeout 10 --max-time 30 -H 'Accept: application/vnd.github+json' -H 'User-Agent: central-prints-vps-autodeploy' "$API" -o "$CI_FILE"; then
  log "Nao foi possivel confirmar CI do commit ${REMOTE_SHA:0:12}; deploy bloqueado."
  exit 0
fi

set +e
python3 - "$CI_FILE" "$REMOTE_SHA" <<'PY'
import json,sys
path,sha=sys.argv[1:3]
try:
    data=json.load(open(path,encoding='utf-8'))
except Exception:
    raise SystemExit(4)
runs=[r for r in data.get('workflow_runs',[]) if r.get('name')=='Central Prints CI' and r.get('head_sha')==sha and r.get('event')=='push']
if any(r.get('status')=='completed' and r.get('conclusion')=='success' for r in runs):
    raise SystemExit(0)
if any(r.get('status')=='completed' and r.get('conclusion') not in (None,'success') for r in runs):
    raise SystemExit(3)
raise SystemExit(2)
PY
CI_RC=$?
set -e
case "$CI_RC" in
  0) log "CI aprovado para ${REMOTE_SHA:0:12}; deploy autorizado." ;;
  2) log "CI ainda nao concluiu para ${REMOTE_SHA:0:12}; aguardando proximo ciclo."; exit 0 ;;
  3) log "CI falhou para ${REMOTE_SHA:0:12}; deploy bloqueado."; printf '%s\n' "$REMOTE_SHA" > "$STATE_DIR/blocked-sha"; exit 0 ;;
  *) log "Resposta CI invalida; deploy bloqueado."; exit 0 ;;
esac

if ! git_safe show origin/main:deploy/update-vps.sh > "$SCRIPT_FILE"; then
  fail "Nao foi possivel obter deploy/update-vps.sh do commit aprovado."
fi
chmod 700 "$SCRIPT_FILE"
printf '%s\n' "$REMOTE_SHA" > "$STATE_DIR/deploy-target-sha"
date -u +%FT%TZ > "$STATE_DIR/deploy-started-at"

set +e
flock -n "$LOCK_FILE" /bin/bash "$SCRIPT_FILE"
DEPLOY_RC=$?
set -e
if [ "$DEPLOY_RC" -eq 0 ]; then
  printf '%s\n' "$REMOTE_SHA" > "$STATE_DIR/last-success-sha"
  date -u +%FT%TZ > "$STATE_DIR/last-success-at"
  rm -f "$STATE_DIR/last-failure-sha" "$STATE_DIR/last-failure-at" "$STATE_DIR/blocked-sha"
  log "Deploy concluido: ${REMOTE_SHA:0:12}."
  exit 0
fi

if [ "$DEPLOY_RC" -eq 1 ] && flock -n "$LOCK_FILE" true 2>/dev/null; then
  :
fi
printf '%s\n' "$REMOTE_SHA" > "$STATE_DIR/last-failure-sha"
date -u +%FT%TZ > "$STATE_DIR/last-failure-at"
fail "Deploy falhou para ${REMOTE_SHA:0:12} (rc=$DEPLOY_RC); rollback do deploy oficial foi acionado."
