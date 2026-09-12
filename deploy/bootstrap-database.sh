#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
ENV_FILE="$APP_DIR/.env"
ADMIN_OUTPUT="/root/central-prints-initial-admin.txt"

fail(){ echo "[ERRO] $*" >&2; exit 1; }
log(){ printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

[ "$(id -u)" -eq 0 ] || fail "Execute como root."
command -v mysql >/dev/null 2>&1 || fail "Cliente mysql nao encontrado."
command -v openssl >/dev/null 2>&1 || fail "openssl nao encontrado."
[ -d "$APP_DIR" ] || fail "Aplicacao nao encontrada."
cd "$APP_DIR"
[ -f "$ENV_FILE" ] || cp .env.example "$ENV_FILE"
chmod 600 "$ENV_FILE"

read_env(){ sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1; }
DB_NAME="$(read_env DB_NAME)"; DB_NAME="${DB_NAME:-central_prints}"
DB_USER="$(read_env DB_USER)"; DB_USER="${DB_USER:-central_prints}"
DB_PASSWORD="$(read_env DB_PASSWORD)"
JWT_SECRET="$(read_env JWT_SECRET)"

[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || fail "DB_NAME invalido."
[[ "$DB_USER" =~ ^[A-Za-z0-9_]+$ ]] || fail "DB_USER invalido."
[ -n "$DB_PASSWORD" ] || DB_PASSWORD="$(openssl rand -hex 24)"
[ -n "$JWT_SECRET" ] || JWT_SECRET="$(openssl rand -hex 48)"

log "Validando acesso administrativo ao MySQL/MariaDB"
mysql -NBe 'SELECT VERSION();' >/tmp/central-prints-db-version || fail "Nao foi possivel acessar o banco como root/socket."
echo "DB_SERVER=$(cat /tmp/central-prints-db-version)"

log "Criando banco e usuario dedicados"
mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL

log "Persistindo segredos somente no .env local"
python3 - "$ENV_FILE" "$DB_NAME" "$DB_USER" "$DB_PASSWORD" "$JWT_SECRET" <<'PY'
from pathlib import Path
import sys
path=Path(sys.argv[1])
vals={'DB_NAME':sys.argv[2],'DB_USER':sys.argv[3],'DB_PASSWORD':sys.argv[4],'JWT_SECRET':sys.argv[5],'DB_REQUIRED':'true'}
lines=path.read_text().splitlines(); seen=set(); out=[]
for line in lines:
    if '=' in line and not line.lstrip().startswith('#'):
        key=line.split('=',1)[0]
        if key in vals:
            out.append(f'{key}={vals[key]}'); seen.add(key); continue
    out.append(line)
for key,value in vals.items():
    if key not in seen: out.append(f'{key}={value}')
path.write_text('\n'.join(out)+'\n')
PY
chmod 600 "$ENV_FILE"

log "Executando migrations versionadas"
npm run migrate

log "Criando Super Admin inicial se necessario"
CP_ADMIN_OUTPUT="$ADMIN_OUTPUT" npm run admin:create

log "Reiniciando aplicacao"
pm2 restart central-prints --update-env
pm2 save

log "Validando readiness"
READY="000"
for _ in $(seq 1 20); do
  READY="$(curl -sS --max-time 5 -o /tmp/central-prints-ready.json -w '%{http_code}' http://127.0.0.1:3005/api/ready || true)"
  [ "$READY" = "200" ] && break
  sleep 1
done
cat /tmp/central-prints-ready.json 2>/dev/null || true; echo
[ "$READY" = "200" ] || { pm2 logs central-prints --lines 120 --nostream || true; fail "Readiness retornou HTTP $READY"; }

log "Banco pronto"
echo "DB_NAME=$DB_NAME"
echo "DB_USER=$DB_USER"
echo "READY_HTTP=$READY"
if [ -f "$ADMIN_OUTPUT" ]; then
  echo "CREDENCIAL_INICIAL=$ADMIN_OUTPUT (modo 600; senha nao impressa)"
fi
