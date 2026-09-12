#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
DOMAIN="grafica.belastock.com.br"
APP_PORT_DEFAULT="3005"
APP_PORT="$APP_PORT_DEFAULT"
BACKUP_ROOT="/home/belastock-grafica/backups"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/site_deploy_$STAMP"

log(){ printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
fail(){ echo "[ERRO] $*" >&2; exit 1; }
git_safe(){ git -c safe.directory="$APP_DIR" "$@"; }

[ "$(id -u)" -eq 0 ] || fail "Execute como root."
for cmd in git node npm pm2 curl; do command -v "$cmd" >/dev/null 2>&1 || fail "Comando obrigatorio ausente: $cmd"; done
[ -d "$APP_DIR/.git" ] || fail "Repositorio nao encontrado em $APP_DIR"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cd "$APP_DIR"

PREVIOUS="$(git_safe rev-parse HEAD)"
PREVIOUS_HAS_PREFLIGHT=0
if [ -f ecosystem.config.cjs ] && grep -q "central-prints-preflight" ecosystem.config.cjs; then
  PREVIOUS_HAS_PREFLIGHT=1
fi
printf '%s\n' "$PREVIOUS" > "$BACKUP_DIR/git-head.before.txt"
printf '%s\n' "$PREVIOUS_HAS_PREFLIGHT" > "$BACKUP_DIR/preflight.before.txt"
[ -f .env ] && cp -a .env "$BACKUP_DIR/env.before" && chmod 600 "$BACKUP_DIR/env.before" || true
printf '%s\n' "$PREVIOUS" > .last-good-commit

rollback(){
  local rc=$?
  trap - ERR
  echo "[ROLLBACK] Falha detectada; restaurando commit $PREVIOUS" >&2
  git_safe reset --hard "$PREVIOUS" || true
  if [ -f package-lock.json ]; then npm ci --omit=dev || true; else npm install --omit=dev || true; fi
  pm2 startOrReload ecosystem.config.cjs --update-env || true
  if [ "$PREVIOUS_HAS_PREFLIGHT" -eq 0 ]; then
    pm2 delete central-prints-preflight >/dev/null 2>&1 || true
  fi
  pm2 save || true
  echo "[ROLLBACK] Aplicacao restaurada. Evidencias em $BACKUP_DIR" >&2
  exit "$rc"
}
trap rollback ERR

log "Sincronizando site com origin/main"
git_safe fetch origin main
git_safe reset --hard origin/main
NEW_HEAD="$(git_safe rev-parse HEAD)"
printf '%s\n' "$NEW_HEAD" > "$BACKUP_DIR/git-head.after.txt"

log "Instalando dependencias reproduziveis"
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

APP_PORT="$(node --input-type=module -e "import 'dotenv/config'; const p=Number(process.env.PORT||${APP_PORT_DEFAULT}); if(!Number.isInteger(p)||p<1||p>65535) process.exit(2); process.stdout.write(String(p));")"
printf '%s\n' "$APP_PORT" > "$BACKUP_DIR/app-port.txt"
log "Porta local detectada: $APP_PORT"

log "Executando verificacao de codigo antes de alterar o banco"
npm run verify

log "Aplicando migracoes idempotentes e validando schema"
npm run migrate
npm run schema:verify

log "Reiniciando Central Prints na porta local $APP_PORT"
pm2 startOrReload ecosystem.config.cjs --update-env

HEALTH="000"; READY="000"; ROOT="000"; CATALOG="000"
for _ in $(seq 1 25); do
  HEALTH="$(curl -sS --max-time 5 -o "$BACKUP_DIR/health.json" -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/health" || true)"
  READY="$(curl -sS --max-time 5 -o "$BACKUP_DIR/ready.json" -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/ready" || true)"
  ROOT="$(curl -sS --max-time 5 -o "$BACKUP_DIR/home.html" -w '%{http_code}' "http://127.0.0.1:$APP_PORT/" || true)"
  CATALOG="$(curl -sS --max-time 5 -o "$BACKUP_DIR/catalogo.html" -w '%{http_code}' "http://127.0.0.1:$APP_PORT/catalogo.html" || true)"
  [ "$HEALTH" = "200" ] && [ "$READY" = "200" ] && [ "$ROOT" = "200" ] && [ "$CATALOG" = "200" ] && break
  sleep 1
done

echo "LOCAL_PORT=$APP_PORT"
echo "LOCAL_HEALTH_HTTP=$HEALTH"
echo "LOCAL_READY_HTTP=$READY"
echo "LOCAL_HOME_HTTP=$ROOT"
echo "LOCAL_CATALOG_HTTP=$CATALOG"
[ "$HEALTH" = "200" ] || fail "Health local falhou na porta $APP_PORT: $HEALTH"
[ "$READY" = "200" ] || fail "Readiness local falhou na porta $APP_PORT: $READY"
[ "$ROOT" = "200" ] || fail "Home local falhou na porta $APP_PORT: $ROOT"
[ "$CATALOG" = "200" ] || fail "Catalogo local falhou na porta $APP_PORT: $CATALOG"

grep -qi 'Central Prints' "$BACKUP_DIR/home.html" || fail "Home respondeu 200 sem identidade Central Prints."
grep -qi 'Catálogo Central Prints' "$BACKUP_DIR/catalogo.html" || fail "Catalogo respondeu 200 sem o conteudo esperado."

log "Validando HTTPS de origem e publico"
ORIGIN="$(curl -ksS --resolve "$DOMAIN:443:127.0.0.1" --max-time 15 -o "$BACKUP_DIR/origin.html" -w '%{http_code}' "https://$DOMAIN/?deploy=$STAMP" || true)"
PUBLIC="$(curl -kLsS --max-redirs 5 --max-time 20 -o "$BACKUP_DIR/public.html" -w '%{http_code}' "https://$DOMAIN/?deploy=$STAMP" || true)"
PUBLIC_CATALOG="$(curl -kLsS --max-redirs 5 --max-time 20 -o "$BACKUP_DIR/public-catalog.html" -w '%{http_code}' "https://$DOMAIN/catalogo.html?deploy=$STAMP" || true)"

echo "ORIGIN_HTTP=$ORIGIN"
echo "PUBLIC_HTTP=$PUBLIC"
echo "PUBLIC_CATALOG_HTTP=$PUBLIC_CATALOG"
[ "$ORIGIN" = "200" ] || fail "Origem HTTPS falhou: $ORIGIN"
[ "$PUBLIC" = "200" ] || fail "Home publica falhou: $PUBLIC"
[ "$PUBLIC_CATALOG" = "200" ] || fail "Catalogo publico falhou: $PUBLIC_CATALOG"

grep -qi 'Central Prints' "$BACKUP_DIR/public.html" || fail "Home publica sem identidade esperada."
grep -qi 'Catálogo Central Prints' "$BACKUP_DIR/public-catalog.html" || fail "Catalogo publico sem conteudo esperado."

pm2 save
trap - ERR

log "Deploy do site concluido"
echo "============================================================"
echo " CENTRAL PRINTS SITE DEPLOYED"
echo "============================================================"
echo "COMMIT=$(git_safe rev-parse --short HEAD)"
echo "LOCAL_PORT=$APP_PORT"
echo "HOME=https://$DOMAIN/"
echo "CATALOGO=https://$DOMAIN/catalogo.html"
echo "ADMIN=https://$DOMAIN/admin/"
echo "EDITOR=https://$DOMAIN/admin/catalogo.html"
echo "PEDIDOS=https://$DOMAIN/admin/pedidos.html"
echo "PREPRESS=https://$DOMAIN/admin/prepress.html"
echo "HEALTH_HTTP=$HEALTH"
echo "READY_HTTP=$READY"
echo "PUBLIC_HTTP=$PUBLIC"
echo "PUBLIC_CATALOG_HTTP=$PUBLIC_CATALOG"
echo "BACKUP_DIR=$BACKUP_DIR"
echo "============================================================"
