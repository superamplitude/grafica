#!/usr/bin/env bash
set -u

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
DOMAIN="grafica.belastock.com.br"
VHOST="/etc/nginx/sites-enabled/grafica.belastock.com.br.conf"
APP_PORT="3005"
NGINX_ERROR_LOG="/home/belastock-grafica/logs/nginx/error.log"

section(){ printf '\n============================================================\n%s\n============================================================\n' "$1"; }
git_safe(){ git -c safe.directory="$APP_DIR" "$@"; }

section "CENTRAL PRINTS - DIAGNOSTICO VPS"
echo "DATE=$(date -Is)"
echo "HOST=$(hostname -f 2>/dev/null || hostname)"
echo "USER=$(id -un)"

section "APLICACAO"
cd "$APP_DIR" 2>/dev/null || { echo "ERRO: APP_DIR inexistente: $APP_DIR"; exit 2; }
echo "APP_DIR=$APP_DIR"
stat -c 'APP_OWNER=%U APP_GROUP=%G' "$APP_DIR" 2>/dev/null || true
echo "GIT_HEAD=$(git_safe rev-parse --short HEAD 2>/dev/null || echo SEM_GIT)"
git_safe status --short --branch 2>/dev/null || true
printf 'Node: '; node -v 2>/dev/null || true
printf 'npm:  '; npm -v 2>/dev/null || true
printf 'PM2:  '; pm2 -v 2>/dev/null || true

section "PM2"
pm2 status 2>/dev/null || true

section "PORTAS"
ss -lntp 2>/dev/null | grep -E ":$APP_PORT|:3210|:80|:443" || true

section "BACKEND LOCAL"
for path in /api/health /api/ready /; do
  code="$(curl -sS --max-time 10 -o /tmp/cp-diag-body -w '%{http_code}' "http://127.0.0.1:$APP_PORT$path" || true)"
  echo "$path HTTP=$code"
  head -c 800 /tmp/cp-diag-body 2>/dev/null || true
  echo
done

section "ENV"
if [ -f .env ]; then
  stat -c 'ENV_PERMISSIONS=%a OWNER=%U GROUP=%G PATH=%n' .env 2>/dev/null || ls -l .env
  grep -E '^(NODE_ENV|HOST|PORT|DB_REQUIRED|DB_HOST|DB_PORT|DB_NAME|R2_BUCKET|R2_PUBLIC_BASE_URL)=' .env 2>/dev/null | sed -E 's/=(.+)$/=<configurado>/' || true
else
  echo "ENV_AUSENTE"
fi

section "NGINX - VHOST"
[ -f "$VHOST" ] && grep -n -E 'server_name|proxy_pass|root |listen ' "$VHOST" || true

section "NGINX - CONFIGURACAO EFETIVA"
nginx -T 2>/dev/null | grep -n -B 8 -A 45 "server_name[[:space:]].*$DOMAIN" | head -n 180 || true

section "NGINX TEST"
nginx -t 2>&1 || true

section "ORIGEM HTTPS"
ORIGIN="$(curl -ksS --resolve "$DOMAIN:443:127.0.0.1" --max-time 20 -o /tmp/cp-origin -w '%{http_code}' "https://$DOMAIN/?diag=$(date +%s)" || true)"
echo "ORIGIN_HTTP=$ORIGIN"
head -c 1000 /tmp/cp-origin 2>/dev/null || true
echo

section "HTTPS PUBLICO"
PUBLIC="$(curl -kLsS --max-redirs 5 --max-time 20 -o /tmp/cp-public -w '%{http_code}' "https://$DOMAIN/?diag=$(date +%s)" || true)"
echo "PUBLIC_HTTP=$PUBLIC"
grep -io '<title>[^<]*</title>' /tmp/cp-public 2>/dev/null | head -n1 || true

section "NGINX ERROR LOG"
tail -n 120 "$NGINX_ERROR_LOG" 2>/dev/null || true

section "PM2 ERROR LOG"
pm2 logs central-prints --lines 80 --nostream 2>/dev/null || true

section "FIM DO DIAGNOSTICO"
