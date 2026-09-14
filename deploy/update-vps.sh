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

recover_runtime_env(){
  if [ -n "${DB_NAME:-}" ] && [ -n "${DB_USER:-}" ]; then
    log "Ambiente de banco ja disponivel para o deploy."
    return 0
  fi
  local proc cwd comm entry key value
  for proc in /proc/[0-9]*; do
    [ -r "$proc/environ" ] || continue
    cwd="$(readlink -f "$proc/cwd" 2>/dev/null || true)"
    [ "$cwd" = "$APP_DIR" ] || continue
    comm="$(cat "$proc/comm" 2>/dev/null || true)"
    [ "$comm" = "node" ] || continue
    while IFS= read -r -d '' entry; do
      key="${entry%%=*}"
      value="${entry#*=}"
      case "$key" in
        NODE_ENV|APP_NAME|APP_URL|HOST|PORT|DB_REQUIRED|DB_HOST|DB_PORT|DB_NAME|DB_USER|DB_PASSWORD|R2_REQUIRED|R2_ACCOUNT_ID|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|R2_PUBLIC_BUCKET|R2_PRIVATE_BUCKET|R2_PUBLIC_BASE_URL|JWT_SECRET)
          printf -v "$key" '%s' "$value"
          export "$key"
          ;;
      esac
    done < "$proc/environ"
    if [ -n "${DB_NAME:-}" ] && [ -n "${DB_USER:-}" ]; then
      log "Ambiente operacional recuperado do processo Central Prints ativo sem expor credenciais."
      return 0
    fi
  done
  fail "Nao foi possivel recuperar DB_NAME/DB_USER do processo Central Prints ativo. Deploy bloqueado antes de qualquer alteracao."
}

recover_runtime_env

PREVIOUS="$(git_safe rev-parse HEAD)"
PREVIOUS_HAS_PREFLIGHT=0
if [ -f ecosystem.config.cjs ] && grep -q "central-prints-preflight" ecosystem.config.cjs; then PREVIOUS_HAS_PREFLIGHT=1; fi
printf '%s\n' "$PREVIOUS" > "$BACKUP_DIR/git-head.before.txt"
printf '%s\n' "$PREVIOUS_HAS_PREFLIGHT" > "$BACKUP_DIR/preflight.before.txt"
[ -f .env ] && cp -a .env "$BACKUP_DIR/env.before" && chmod 600 "$BACKUP_DIR/env.before" || true
printf '%s\n' "$PREVIOUS" > .last-good-commit

rollback(){
  local rc=$?; trap - ERR
  echo "[ROLLBACK] Falha detectada; restaurando commit $PREVIOUS" >&2
  git_safe reset --hard "$PREVIOUS" || true
  if [ -f package-lock.json ]; then npm ci --omit=dev || true; else npm install --omit=dev || true; fi
  pm2 startOrReload ecosystem.config.cjs --update-env || true
  if [ "$PREVIOUS_HAS_PREFLIGHT" -eq 0 ]; then pm2 delete central-prints-preflight >/dev/null 2>&1 || true; fi
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
if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
APP_PORT="$(node --input-type=module -e "import 'dotenv/config'; const p=Number(process.env.PORT||${APP_PORT_DEFAULT}); if(!Number.isInteger(p)||p<1||p>65535) process.exit(2); process.stdout.write(String(p));")"
printf '%s\n' "$APP_PORT" > "$BACKUP_DIR/app-port.txt"
log "Porta local detectada: $APP_PORT"

log "Executando verificacao de codigo antes de alterar o banco"
npm run verify
log "Aplicando migracoes idempotentes e validando schema"
npm run migrate
npm run schema:verify
log "Registrando referencias externas em quarentena"
npm run reference:import | tee "$BACKUP_DIR/reference-import.json"
if [ -f "ops/catalog-import/2026-09-12/manifest.json" ]; then
  log "Importando catalogo integral com backup e checksum"
  bash deploy/import-bundled-catalog.sh | tee "$BACKUP_DIR/catalog-import.log"
fi
log "Reiniciando Central Prints na porta local $APP_PORT"
pm2 startOrReload ecosystem.config.cjs --update-env

HEALTH="000"; READY="000"; ROOT="000"; CATALOG="000"; SUMMARY="000"; COMPLETE="000"
for _ in $(seq 1 25); do
  HEALTH="$(curl -sS --max-time 5 -o "$BACKUP_DIR/health.json" -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/health" || true)"
  READY="$(curl -sS --max-time 5 -o "$BACKUP_DIR/ready.json" -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/ready" || true)"
  ROOT="$(curl -sS --max-time 5 -o "$BACKUP_DIR/home.html" -w '%{http_code}' "http://127.0.0.1:$APP_PORT/" || true)"
  CATALOG="$(curl -sS --max-time 5 -o "$BACKUP_DIR/catalogo.html" -w '%{http_code}' "http://127.0.0.1:$APP_PORT/catalogo.html" || true)"
  SUMMARY="$(curl -sS --max-time 10 -o "$BACKUP_DIR/catalog-summary.json" -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/v1/catalog/summary" || true)"
  COMPLETE="$(curl -sS --max-time 30 -o "$BACKUP_DIR/catalog-complete.json" -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/v1/catalog/complete" || true)"
  [ "$HEALTH" = "200" ] && [ "$READY" = "200" ] && [ "$ROOT" = "200" ] && [ "$CATALOG" = "200" ] && [ "$SUMMARY" = "200" ] && [ "$COMPLETE" = "200" ] && break
  sleep 1
done

echo "LOCAL_PORT=$APP_PORT"; echo "LOCAL_HEALTH_HTTP=$HEALTH"; echo "LOCAL_READY_HTTP=$READY"; echo "LOCAL_HOME_HTTP=$ROOT"; echo "LOCAL_CATALOG_HTTP=$CATALOG"; echo "LOCAL_SUMMARY_HTTP=$SUMMARY"; echo "LOCAL_COMPLETE_HTTP=$COMPLETE"
[ "$HEALTH" = "200" ] || fail "Health local falhou na porta $APP_PORT: $HEALTH"
[ "$READY" = "200" ] || fail "Readiness local falhou na porta $APP_PORT: $READY"
[ "$ROOT" = "200" ] || fail "Home local falhou na porta $APP_PORT: $ROOT"
[ "$CATALOG" = "200" ] || fail "Catalogo local falhou na porta $APP_PORT: $CATALOG"
[ "$SUMMARY" = "200" ] || fail "Resumo do catalogo falhou: $SUMMARY"
[ "$COMPLETE" = "200" ] || fail "Catalogo completo falhou: $COMPLETE"
grep -qi 'Central Prints' "$BACKUP_DIR/home.html" || fail "Home respondeu 200 sem identidade Central Prints."
grep -qi 'Catálogo Central Prints' "$BACKUP_DIR/catalogo.html" || fail "Catalogo respondeu 200 sem o conteudo esperado."
node --input-type=module - "$BACKUP_DIR/catalog-summary.json" "$BACKUP_DIR/catalog-complete.json" <<'NODE'
import fs from 'node:fs';
const [, , summaryFile, completeFile]=process.argv;
const summary=JSON.parse(fs.readFileSync(summaryFile,'utf8'));
const complete=JSON.parse(fs.readFileSync(completeFile,'utf8'));
if(summary.products!==1075)throw new Error(`SUMMARY_PRODUCTS:${summary.products}`);
if(summary.categories!==140)throw new Error(`SUMMARY_CATEGORIES:${summary.categories}`);
if(summary.variants!==21329)throw new Error(`SUMMARY_VARIANTS:${summary.variants}`);
if(!Array.isArray(complete.items)||complete.items.length!==1075)throw new Error(`COMPLETE_ITEMS:${complete.items?.length}`);
for(const item of complete.items){
  if(!item.short_description||!item.description||!item.image_url||!item.gabaritos_url||!item.product_url)throw new Error(`INCOMPLETE_PRODUCT:${item.slug}`);
}
console.log(JSON.stringify({catalog_summary:summary,complete_items:complete.items.length,all_product_links_present:true}));
NODE

log "Validando HTTPS de origem e publico"
ORIGIN="$(curl -ksS --resolve "$DOMAIN:443:127.0.0.1" --max-time 15 -o "$BACKUP_DIR/origin.html" -w '%{http_code}' "https://$DOMAIN/?deploy=$STAMP" || true)"
PUBLIC="$(curl -kLsS --max-redirs 5 --max-time 20 -o "$BACKUP_DIR/public.html" -w '%{http_code}' "https://$DOMAIN/?deploy=$STAMP" || true)"
PUBLIC_CATALOG="$(curl -kLsS --max-redirs 5 --max-time 20 -o "$BACKUP_DIR/public-catalog.html" -w '%{http_code}' "https://$DOMAIN/catalogo.html?deploy=$STAMP" || true)"
PUBLIC_SUMMARY="$(curl -kLsS --max-redirs 5 --max-time 20 -o "$BACKUP_DIR/public-summary.json" -w '%{http_code}' "https://$DOMAIN/api/v1/catalog/summary?deploy=$STAMP" || true)"
echo "ORIGIN_HTTP=$ORIGIN"; echo "PUBLIC_HTTP=$PUBLIC"; echo "PUBLIC_CATALOG_HTTP=$PUBLIC_CATALOG"; echo "PUBLIC_SUMMARY_HTTP=$PUBLIC_SUMMARY"
[ "$ORIGIN" = "200" ] || fail "Origem HTTPS falhou: $ORIGIN"
[ "$PUBLIC" = "200" ] || fail "Home publica falhou: $PUBLIC"
[ "$PUBLIC_CATALOG" = "200" ] || fail "Catalogo publico falhou: $PUBLIC_CATALOG"
[ "$PUBLIC_SUMMARY" = "200" ] || fail "Resumo publico do catalogo falhou: $PUBLIC_SUMMARY"
grep -qi 'Central Prints' "$BACKUP_DIR/public.html" || fail "Home publica sem identidade esperada."
grep -qi 'Catálogo Central Prints' "$BACKUP_DIR/public-catalog.html" || fail "Catalogo publico sem conteudo esperado."
node --input-type=module - "$BACKUP_DIR/public-summary.json" <<'NODE'
import fs from 'node:fs';
const summary=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(summary.products!==1075||summary.categories!==140||summary.variants!==21329)throw new Error(`PUBLIC_CATALOG_COUNTS:${JSON.stringify(summary)}`);
NODE

log "Persistindo estado PM2 validado"
pm2 save
log "Registrando evidencia atomica da release"
mkdir -p runtime
node - "$NEW_HEAD" "$APP_PORT" "$HEALTH" "$READY" "$PUBLIC" "$PUBLIC_CATALOG" <<'NODE'
const fs=require('node:fs');const path=require('node:path');const [, , commit, port, health, ready, publicHttp, catalog]=process.argv;const dir=path.join(process.cwd(),'runtime');const target=path.join(dir,'deploy-status.json');const tmp=path.join(dir,`.deploy-status-${process.pid}.json`);const payload={commit,deployedAt:new Date().toISOString(),port:Number(port),health:Number(health),ready:Number(ready),public:Number(publicHttp),catalog:Number(catalog)};fs.writeFileSync(tmp,JSON.stringify(payload,null,2)+'\n',{mode:0o644});fs.renameSync(tmp,target);
NODE
chmod 644 runtime/deploy-status.json
cp -a runtime/deploy-status.json "$BACKUP_DIR/deploy-status.json"
[ -f runtime/catalog-status.json ] && cp -a runtime/catalog-status.json "$BACKUP_DIR/catalog-status.json" || true
trap - ERR

log "Deploy do site concluido"
echo "============================================================"
echo " CENTRAL PRINTS SITE DEPLOYED"
echo "============================================================"
echo "COMMIT=$(git_safe rev-parse --short HEAD)"
echo "LOCAL_PORT=$APP_PORT"
echo "HOME=https://$DOMAIN/"
echo "CATALOGO=https://$DOMAIN/catalogo.html"
echo "CATALOGO_COMPLETO=https://$DOMAIN/api/v1/catalog/complete"
echo "ADMIN=https://$DOMAIN/admin/"
echo "EDITOR=https://$DOMAIN/admin/catalogo.html"
echo "IMAGENS=https://$DOMAIN/admin/imagens.html"
echo "GABARITOS=https://$DOMAIN/admin/gabaritos.html"
echo "INTEGRACOES=https://$DOMAIN/admin/integracoes.html"
echo "PEDIDOS=https://$DOMAIN/admin/pedidos.html"
echo "PREPRESS=https://$DOMAIN/admin/prepress.html"
echo "RELEASE=https://$DOMAIN/api/release"
echo "HEALTH_HTTP=$HEALTH"; echo "READY_HTTP=$READY"; echo "PUBLIC_HTTP=$PUBLIC"; echo "PUBLIC_CATALOG_HTTP=$PUBLIC_CATALOG"; echo "PUBLIC_SUMMARY_HTTP=$PUBLIC_SUMMARY"
echo "BACKUP_DIR=$BACKUP_DIR"
echo "============================================================"
