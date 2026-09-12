#!/usr/bin/env bash
set -u

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
DOMAIN="grafica.belastock.com.br"

section(){ printf '\n============================================================\n%s\n============================================================\n' "$1"; }

section "CENTRAL PRINTS - DIAGNOSTICO VPS"
echo "DATE=$(date -Is)"
echo "HOST=$(hostname -f 2>/dev/null || hostname)"
echo "USER=$(id -un)"

section "APLICACAO"
cd "$APP_DIR" 2>/dev/null || { echo "ERRO: APP_DIR inexistente: $APP_DIR"; exit 2; }
echo "APP_DIR=$APP_DIR"
echo "GIT_HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo SEM_GIT)"
git status --short --branch 2>/dev/null || true

echo
printf 'Node: '; node -v 2>/dev/null || true
printf 'npm:  '; npm -v 2>/dev/null || true
printf 'PM2:  '; pm2 -v 2>/dev/null || true

section "PM2"
pm2 status 2>/dev/null || true

section "PORTA 3210"
ss -lntp 2>/dev/null | grep ':3210' || true

section "HEALTH LOCAL"
HTTP="$(curl -sS --max-time 10 -o /tmp/central-prints-health.json -w '%{http_code}' http://127.0.0.1:3210/api/health || true)"
echo "HEALTH_HTTP=$HTTP"
cat /tmp/central-prints-health.json 2>/dev/null || true
echo

section "ENV"
if [ -f .env ]; then
  stat -c 'ENV_PERMISSIONS=%a OWNER=%U GROUP=%G PATH=%n' .env 2>/dev/null || ls -l .env
  grep -E '^(NODE_ENV|HOST|PORT|DB_HOST|DB_PORT|DB_NAME|R2_BUCKET|R2_PUBLIC_BASE_URL)=' .env 2>/dev/null | sed -E 's/=(.+)$/=<configurado>/' || true
else
  echo "ENV_AUSENTE"
fi

section "NGINX - ARQUIVOS DO DOMINIO"
find /etc/nginx -maxdepth 3 -type f \( -name "*$DOMAIN*" -o -name '*grafica*belastock*' \) -print 2>/dev/null || true

section "NGINX - SERVER NAME"
nginx -T 2>/dev/null | grep -n -B 8 -A 45 "server_name[[:space:]].*$DOMAIN" | head -n 180 || true

section "NGINX TEST"
nginx -t 2>&1 || true

section "HTTPS PUBLICO"
PUBLIC="$(curl -kLsS --max-redirs 5 --max-time 20 -o /tmp/central-prints-public.html -w '%{http_code}' "https://$DOMAIN/?diag=$(date +%s)" || true)"
echo "PUBLIC_HTTP=$PUBLIC"
printf 'PUBLIC_TITLE='
grep -io '<title>[^<]*</title>' /tmp/central-prints-public.html 2>/dev/null | head -n1 || true

echo
section "FIM DO DIAGNOSTICO"
