#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
DOMAIN="grafica.belastock.com.br"
VHOST="/etc/nginx/sites-enabled/grafica.belastock.com.br.conf"
APP_PORT="3005"
BACKUP_ROOT="/home/belastock-grafica/backups"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/runtime_fix_$STAMP"
NGINX_ERROR_LOG="/home/belastock-grafica/logs/nginx/error.log"

log(){ printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
fail(){ echo "[ERRO] $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Execute como root."
[ -d "$APP_DIR/.git" ] || fail "Repositorio nao encontrado em $APP_DIR"
[ -f "$VHOST" ] || fail "Vhost nao encontrado: $VHOST"

mkdir -p "$BACKUP_DIR"
cp -a "$VHOST" "$BACKUP_DIR/vhost.before.conf"
cp -a "$APP_DIR/.env" "$BACKUP_DIR/env.before" 2>/dev/null || true

cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
git fetch origin main
git reset --hard origin/main

log "Alinhando aplicacao ao App Port do CloudPanel ($APP_PORT)"
[ -f .env ] || cp .env.example .env
python3 - "$APP_PORT" <<'PY'
from pathlib import Path
import sys
port=sys.argv[1]
p=Path('.env')
lines=p.read_text().splitlines()
vals={'HOST':'127.0.0.1','PORT':port,'NODE_ENV':'production'}
seen=set(); out=[]
for line in lines:
    if '=' in line and not line.lstrip().startswith('#'):
        k=line.split('=',1)[0]
        if k in vals:
            out.append(f'{k}={vals[k]}'); seen.add(k); continue
    out.append(line)
for k,v in vals.items():
    if k not in seen: out.append(f'{k}={v}')
p.write_text('\n'.join(out)+'\n')
PY
chmod 600 .env

log "Restaurando contrato de proxy do CloudPanel"
python3 - "$VHOST" "$APP_PORT" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); port=sys.argv[2]; text=p.read_text()
canonical=f'proxy_pass http://127.0.0.1:{port}/;'
legacy='proxy_pass http://127.0.0.1:3210/;'
if canonical in text:
    print(f'[OK] vhost ja aponta para {port}')
elif text.count(legacy)==1:
    p.write_text(text.replace(legacy,canonical,1))
    print(f'[OK] revertido proxy 3210 -> {port}')
else:
    matches=[line.strip() for line in text.splitlines() if 'proxy_pass' in line]
    raise SystemExit(f'PROXY_ALVO_INESPERADO: {matches}')
PY

nginx -t
systemctl reload nginx

log "Validando codigo"
npm run check

log "Sincronizando dependencias"
if git ls-files --error-unmatch package-lock.json >/dev/null 2>&1; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

log "Validando inicializacao Fastify"
npm run smoke

log "Reiniciando PM2 limpo"
pm2 delete central-prints >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs --update-env
pm2 save

log "Validando backend local na porta $APP_PORT"
OK=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$APP_PORT/api/health" >/tmp/central-prints-health.json 2>/dev/null; then
    OK=1; break
  fi
  sleep 1
done

if [ "$OK" -ne 1 ]; then
  pm2 status || true
  pm2 logs central-prints --lines 160 --nostream || true
  ss -lntp | grep -E ":$APP_PORT|:3210" || true
  fail "Backend nao abriu a porta $APP_PORT."
fi

ROOT_HTTP="$(curl -sS --max-time 10 -o /tmp/central-prints-local-root.html -w '%{http_code}' "http://127.0.0.1:$APP_PORT/" || true)"
echo "LOCAL_ROOT_HTTP=$ROOT_HTTP"
cat /tmp/central-prints-health.json; echo
ss -lntp | grep ":$APP_PORT" || true
[ "$ROOT_HTTP" = "200" ] || fail "Raiz local retornou $ROOT_HTTP"

log "Validando configuracao efetiva do Nginx"
nginx -T 2>/dev/null | grep -n -B 5 -A 35 "server_name[[:space:]].*$DOMAIN" | head -n 120 || true

log "Validando origem HTTPS"
ORIGIN="$(curl -ksS --resolve "$DOMAIN:443:127.0.0.1" --max-time 20 -o /tmp/central-prints-origin.html -w '%{http_code}' "https://$DOMAIN/?fix=$STAMP" || true)"
echo "ORIGIN_HTTP=$ORIGIN"

if [ "$ORIGIN" != "200" ]; then
  echo
  echo "================ EVIDENCIA NGINX ================"
  tail -n 160 "$NGINX_ERROR_LOG" 2>/dev/null || true
  echo "================ EVIDENCIA PM2 =================="
  pm2 status || true
  pm2 logs central-prints --lines 120 --nostream || true
  echo "================ PROCESSOS/PORTAS ==============="
  ps -ef | grep '[n]ginx' || true
  ss -lntp | grep -E ":$APP_PORT|:80|:443" || true
  echo "================ SEGURANCA SO ===================="
  command -v getenforce >/dev/null 2>&1 && getenforce || true
  command -v aa-status >/dev/null 2>&1 && aa-status 2>/dev/null | head -n 80 || true
  fail "Origem HTTPS retornou $ORIGIN. Evidencias acima; nenhuma correcao especulativa aplicada."
fi

log "Validando acesso publico HTTPS"
PUBLIC="$(curl -kLsS --max-redirs 5 --max-time 25 -o /tmp/central-prints-public.html -w '%{http_code}' "https://$DOMAIN/?fix=$STAMP" || true)"
echo "PUBLIC_HTTP=$PUBLIC"
[ "$PUBLIC" = "200" ] || fail "Publico HTTPS retornou $PUBLIC"

READY="$(curl -sS --max-time 8 -o /tmp/central-prints-ready.json -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/ready" || true)"
echo "READY_HTTP=$READY"
cat /tmp/central-prints-ready.json 2>/dev/null || true; echo

echo
echo "============================================================"
echo " CENTRAL PRINTS NODE ONLINE"
echo "============================================================"
echo "APP_DIR:       $APP_DIR"
echo "APP_PORT:      $APP_PORT (CloudPanel)"
echo "LOCAL_HEALTH:  http://127.0.0.1:$APP_PORT/api/health"
echo "PUBLIC_URL:    https://$DOMAIN"
echo "ORIGIN_HTTP:   $ORIGIN"
echo "PUBLIC_HTTP:   $PUBLIC"
echo "READY_HTTP:    $READY (503 ate o banco ser configurado e migrado e esperado)"
echo "BACKUP:        $BACKUP_DIR"
echo "============================================================"
