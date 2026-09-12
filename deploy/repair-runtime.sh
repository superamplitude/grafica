#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
DOMAIN="grafica.belastock.com.br"
VHOST="/etc/nginx/sites-enabled/grafica.belastock.com.br.conf"
BACKUP_ROOT="/home/belastock-grafica/backups"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/runtime_fix_$STAMP"

log(){ printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
fail(){ echo "[ERRO] $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Execute como root."
[ -d "$APP_DIR/.git" ] || fail "Repositorio nao encontrado em $APP_DIR"
[ -f "$VHOST" ] || fail "Vhost nao encontrado: $VHOST"

mkdir -p "$BACKUP_DIR"
cp -a "$VHOST" "$BACKUP_DIR/vhost.conf"
cp -a "$APP_DIR/.env" "$BACKUP_DIR/env.before" 2>/dev/null || true

cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

git fetch origin main
git reset --hard origin/main

log "Normalizando HOST/PORT no .env"
[ -f .env ] || cp .env.example .env
python3 - <<'PY'
from pathlib import Path
p=Path('.env')
lines=p.read_text().splitlines()
vals={'HOST':'127.0.0.1','PORT':'3210','NODE_ENV':'production'}
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

log "Validando sintaxe Node"
npm run check

log "Garantindo dependencias"
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

log "Reiniciando PM2 limpo"
pm2 delete central-prints >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs --update-env
pm2 save

log "Aguardando porta 3210"
OK=0
for i in $(seq 1 20); do
  if curl -fsS --max-time 3 http://127.0.0.1:3210/api/health >/tmp/central-prints-health.json 2>/dev/null; then OK=1; break; fi
  sleep 1
done

if [ "$OK" -ne 1 ]; then
  echo
  echo "============================================================"
  echo " NODE NAO SUBIU - LOGS PM2"
  echo "============================================================"
  pm2 status || true
  pm2 logs central-prints --lines 120 --nostream || true
  ss -lntp | grep -E ':3210|:3005' || true
  fail "Health local falhou. Nginx NAO foi alterado."
fi

cat /tmp/central-prints-health.json
echo
ss -lntp | grep ':3210' || true

log "Atualizando proxy Nginx somente apos health OK"
python3 - "$VHOST" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); text=p.read_text()
old='proxy_pass http://127.0.0.1:3005/;'
new='proxy_pass http://127.0.0.1:3210/;'
if new in text:
    print('[OK] proxy ja estava em 3210')
elif text.count(old)==1:
    p.write_text(text.replace(old,new,1)); print('[OK] proxy 3005 -> 3210')
else:
    raise SystemExit(f'PROXY_ALVO_INESPERADO old_count={text.count(old)}')
PY

rollback(){
  echo "[ROLLBACK] Restaurando vhost anterior..."
  cp -a "$BACKUP_DIR/vhost.conf" "$VHOST"
  nginx -t && systemctl reload nginx || true
}
trap 'rc=$?; rollback; exit $rc' ERR

nginx -t
systemctl reload nginx

log "Validando origem HTTPS"
ORIGIN="$(curl -ksS --resolve "$DOMAIN:443:127.0.0.1" --max-time 20 -o /tmp/central-prints-origin.html -w '%{http_code}' "https://$DOMAIN/?fix=$STAMP")"
echo "ORIGIN_HTTP=$ORIGIN"
[ "$ORIGIN" = "200" ] || fail "Origem HTTPS retornou $ORIGIN"

log "Validando acesso publico HTTPS"
PUBLIC="$(curl -kLsS --max-redirs 5 --max-time 25 -o /tmp/central-prints-public.html -w '%{http_code}' "https://$DOMAIN/?fix=$STAMP")"
echo "PUBLIC_HTTP=$PUBLIC"
[ "$PUBLIC" = "200" ] || fail "Publico HTTPS retornou $PUBLIC"

trap - ERR

echo
echo "============================================================"
echo " CENTRAL PRINTS NODE ONLINE"
echo "============================================================"
echo "APP_DIR:       $APP_DIR"
echo "LOCAL_HEALTH:  http://127.0.0.1:3210/api/health"
echo "PUBLIC_URL:    https://$DOMAIN"
echo "ORIGIN_HTTP:   $ORIGIN"
echo "PUBLIC_HTTP:   $PUBLIC"
echo "BACKUP:        $BACKUP_DIR"
echo "============================================================"
