#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
ENV_FILE="$APP_DIR/.env"
BACKUP_ROOT="/home/belastock-grafica/backups"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/r2_bootstrap_$STAMP"
APP_PORT="3005"

fail(){ echo "[ERRO] $*" >&2; exit 1; }
log(){ printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
read_env(){ sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1; }

[ "$(id -u)" -eq 0 ] || fail "Execute como root."
for cmd in node npm pm2 python3 curl; do command -v "$cmd" >/dev/null 2>&1 || fail "Comando obrigatorio nao encontrado: $cmd"; done
[ -d "$APP_DIR/.git" ] || fail "Repositorio nao encontrado em $APP_DIR"
[ -f "$ENV_FILE" ] || fail ".env nao encontrado; conclua primeiro o bootstrap do banco."

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
cp -a "$ENV_FILE" "$BACKUP_DIR/env.before"
chmod 600 "$ENV_FILE" "$BACKUP_DIR/env.before"
git rev-parse HEAD > "$BACKUP_DIR/git-head.txt"

ACCOUNT_ID="$(read_env R2_ACCOUNT_ID)"
ACCESS_KEY="$(read_env R2_ACCESS_KEY_ID)"
SECRET_KEY="$(read_env R2_SECRET_ACCESS_KEY)"
PUBLIC_BUCKET="$(read_env R2_PUBLIC_BUCKET)"; PUBLIC_BUCKET="${PUBLIC_BUCKET:-central-prints-public}"
PRIVATE_BUCKET="$(read_env R2_PRIVATE_BUCKET)"; PRIVATE_BUCKET="${PRIVATE_BUCKET:-central-prints-private}"
PUBLIC_BASE="$(read_env R2_PUBLIC_BASE_URL)"

if [ -z "$ACCOUNT_ID" ]; then read -r -p "Cloudflare Account ID: " ACCOUNT_ID; fi
if [ -z "$ACCESS_KEY" ]; then read -r -p "R2 Access Key ID: " ACCESS_KEY; fi
if [ -z "$SECRET_KEY" ]; then read -r -s -p "R2 Secret Access Key: " SECRET_KEY; echo; fi
read -r -p "Bucket PUBLICO [$PUBLIC_BUCKET]: " input_public; PUBLIC_BUCKET="${input_public:-$PUBLIC_BUCKET}"
read -r -p "Bucket PRIVADO [$PRIVATE_BUCKET]: " input_private; PRIVATE_BUCKET="${input_private:-$PRIVATE_BUCKET}"
if [ -z "$PUBLIC_BASE" ]; then
  read -r -p "URL publica do bucket (custom domain; Enter para configurar depois): " PUBLIC_BASE
fi

[ -n "$ACCOUNT_ID" ] || fail "R2_ACCOUNT_ID vazio."
[ -n "$ACCESS_KEY" ] || fail "R2_ACCESS_KEY_ID vazio."
[ -n "$SECRET_KEY" ] || fail "R2_SECRET_ACCESS_KEY vazio."
[[ "$PUBLIC_BUCKET" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || fail "Nome do bucket publico invalido."
[[ "$PRIVATE_BUCKET" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || fail "Nome do bucket privado invalido."
[ "$PUBLIC_BUCKET" != "$PRIVATE_BUCKET" ] || fail "Buckets publico e privado precisam ser diferentes."

log "Persistindo credenciais R2 somente no .env local"
python3 - "$ENV_FILE" "$ACCOUNT_ID" "$ACCESS_KEY" "$SECRET_KEY" "$PUBLIC_BUCKET" "$PRIVATE_BUCKET" "$PUBLIC_BASE" <<'PY'
from pathlib import Path
import sys
path=Path(sys.argv[1])
vals={
 'R2_REQUIRED':'false',
 'R2_ACCOUNT_ID':sys.argv[2],
 'R2_ACCESS_KEY_ID':sys.argv[3],
 'R2_SECRET_ACCESS_KEY':sys.argv[4],
 'R2_PUBLIC_BUCKET':sys.argv[5],
 'R2_PRIVATE_BUCKET':sys.argv[6],
 'R2_PUBLIC_BASE_URL':sys.argv[7],
}
lines=path.read_text().splitlines(); seen=set(); out=[]
for line in lines:
    if '=' in line and not line.lstrip().startswith('#'):
        key=line.split('=',1)[0]
        if key in vals:
            out.append(f'{key}={vals[key]}'); seen.add(key); continue
        if key == 'R2_BUCKET':
            continue
    out.append(line)
for key,value in vals.items():
    if key not in seen: out.append(f'{key}={value}')
path.write_text('\n'.join(out)+'\n')
PY
chmod 600 "$ENV_FILE"

log "Criando/validando buckets separados e aplicando CORS"
npm run r2:bootstrap

log "Prova real de armazenamento R2"
npm run r2:verify

log "Tornando R2 requisito de readiness somente apos a prova"
python3 - "$ENV_FILE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); lines=p.read_text().splitlines(); out=[]; found=False
for line in lines:
    if line.startswith('R2_REQUIRED='):
        out.append('R2_REQUIRED=true'); found=True
    else: out.append(line)
if not found: out.append('R2_REQUIRED=true')
p.write_text('\n'.join(out)+'\n')
PY
chmod 600 "$ENV_FILE"

pm2 restart central-prints --update-env
pm2 save

log "Validando aplicacao com banco + auth + R2 obrigatorios"
HEALTH="000"; READY="000"
for _ in $(seq 1 20); do
  HEALTH="$(curl -sS --max-time 5 -o /tmp/central-prints-health-r2.json -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/health" || true)"
  READY="$(curl -sS --max-time 5 -o /tmp/central-prints-ready-r2.json -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/ready" || true)"
  [ "$HEALTH" = "200" ] && [ "$READY" = "200" ] && break
  sleep 1
done
cat /tmp/central-prints-health-r2.json 2>/dev/null || true; echo
cat /tmp/central-prints-ready-r2.json 2>/dev/null || true; echo
[ "$HEALTH" = "200" ] || fail "Health falhou: HTTP $HEALTH"
[ "$READY" = "200" ] || fail "Readiness falhou: HTTP $READY"

PUBLIC="$(curl -kLsS --max-redirs 5 --max-time 20 -o /dev/null -w '%{http_code}' "https://grafica.belastock.com.br/?r2=$STAMP" || true)"
[ "$PUBLIC" = "200" ] || fail "Portal publico retornou HTTP $PUBLIC"

log "R2 pronto"
echo "PUBLIC_BUCKET=$PUBLIC_BUCKET"
echo "PRIVATE_BUCKET=$PRIVATE_BUCKET"
echo "HEALTH_HTTP=$HEALTH"
echo "READY_HTTP=$READY"
echo "PUBLIC_HTTP=$PUBLIC"
if [ -n "$PUBLIC_BASE" ]; then
  echo "PUBLIC_CDN=$PUBLIC_BASE"
else
  echo "PUBLIC_CDN_PENDING=yes"
fi
echo "BACKUP_DIR=$BACKUP_DIR"
