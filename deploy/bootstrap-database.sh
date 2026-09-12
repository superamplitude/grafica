#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
ENV_FILE="$APP_DIR/.env"
ADMIN_OUTPUT="/root/central-prints-initial-admin.txt"
DOMAIN="grafica.belastock.com.br"
APP_PORT="3005"
BACKUP_ROOT="/home/belastock-grafica/backups"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/db_bootstrap_$STAMP"

fail(){ echo "[ERRO] $*" >&2; exit 1; }
log(){ printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

[ "$(id -u)" -eq 0 ] || fail "Execute como root."
for cmd in clpctl mysql openssl node npm pm2 python3 curl; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Comando obrigatorio nao encontrado: $cmd"
done
[ -d "$APP_DIR/.git" ] || fail "Aplicacao/repositorio nao encontrado em $APP_DIR"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

log "Registrando versao e protegendo configuracao local"
git rev-parse HEAD > "$BACKUP_DIR/git-head.txt"
[ -f "$ENV_FILE" ] || cp .env.example "$ENV_FILE"
cp -a "$ENV_FILE" "$BACKUP_DIR/env.before"
chmod 600 "$ENV_FILE" "$BACKUP_DIR/env.before"

read_env(){ sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1; }
DB_NAME="$(read_env DB_NAME)"; DB_NAME="${DB_NAME:-central_prints}"
DB_USER="$(read_env DB_USER)"; DB_USER="${DB_USER:-central_prints}"
DB_PASSWORD="$(read_env DB_PASSWORD)"
JWT_SECRET="$(read_env JWT_SECRET)"

[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || fail "DB_NAME invalido."
[[ "$DB_USER" =~ ^[A-Za-z0-9_]+$ ]] || fail "DB_USER invalido."
[ ${#DB_NAME} -le 64 ] || fail "DB_NAME excede 64 caracteres."
[ ${#DB_USER} -le 32 ] || fail "DB_USER excede 32 caracteres."
[ -n "$DB_PASSWORD" ] || DB_PASSWORD="$(openssl rand -hex 24)"
[ -n "$JWT_SECRET" ] || JWT_SECRET="$(openssl rand -hex 48)"

log "Persistindo configuracao dedicada antes da criacao do banco"
python3 - "$ENV_FILE" "$DB_NAME" "$DB_USER" "$DB_PASSWORD" "$JWT_SECRET" <<'PY'
from pathlib import Path
import sys
path=Path(sys.argv[1])
vals={
    'DB_HOST':'127.0.0.1',
    'DB_PORT':'3306',
    'DB_NAME':sys.argv[2],
    'DB_USER':sys.argv[3],
    'DB_PASSWORD':sys.argv[4],
    'JWT_SECRET':sys.argv[5],
    'DB_REQUIRED':'true',
    'HOST':'127.0.0.1',
    'PORT':'3005',
    'NODE_ENV':'production'
}
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

app_db_ok(){
  MYSQL_PWD="$DB_PASSWORD" mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u "$DB_USER" -D "$DB_NAME" -NBe 'SELECT 1' 2>/dev/null | grep -qx '1'
}

log "Verificando se o banco dedicado ja esta acessivel"
if app_db_ok; then
  echo "DB_PREEXISTENTE=sim"
  log "Criando backup CloudPanel antes das migrations"
  DB_BACKUP="$BACKUP_DIR/${DB_NAME}.before.sql.gz"
  if clpctl db:export --databaseName="$DB_NAME" --file="$DB_BACKUP" >"$BACKUP_DIR/clpctl-db-export.log" 2>&1; then
    chmod 600 "$DB_BACKUP" "$BACKUP_DIR/clpctl-db-export.log" 2>/dev/null || true
    echo "DB_BACKUP=$DB_BACKUP"
  else
    chmod 600 "$BACKUP_DIR/clpctl-db-export.log" 2>/dev/null || true
    fail "Banco existente detectado, mas o CloudPanel nao conseguiu exporta-lo. Migrations nao serao executadas sem backup."
  fi
else
  echo "DB_PREEXISTENTE=nao-ou-credencial-ainda-nao-criada"
  log "Criando banco e usuario pelo CloudPanel"
  set +e
  clpctl db:add \
    --domainName="$DOMAIN" \
    --databaseName="$DB_NAME" \
    --databaseUserName="$DB_USER" \
    --databaseUserPassword="$DB_PASSWORD" \
    >"$BACKUP_DIR/clpctl-db-add.log" 2>&1
  ADD_RC=$?
  set -e
  chmod 600 "$BACKUP_DIR/clpctl-db-add.log" 2>/dev/null || true

  if [ "$ADD_RC" -ne 0 ]; then
    if ! app_db_ok; then
      echo "[INFO] Saida do CloudPanel salva em $BACKUP_DIR/clpctl-db-add.log"
      fail "CloudPanel nao criou o banco/usuario e a credencial dedicada continua invalida. Nada foi sobrescrito."
    fi
  fi
fi

log "Validando credencial dedicada"
app_db_ok || fail "Usuario dedicado nao conseguiu acessar $DB_NAME via 127.0.0.1:3306."
MYSQL_PWD="$DB_PASSWORD" mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u "$DB_USER" -D "$DB_NAME" -NBe 'SELECT VERSION();' > "$BACKUP_DIR/db-version.txt"
echo "DB_SERVER=$(cat "$BACKUP_DIR/db-version.txt")"

log "Executando migrations versionadas"
npm run migrate

log "Verificando integridade estrutural do schema"
npm run schema:verify

log "Criando Super Admin inicial se necessario"
CP_ADMIN_OUTPUT="$ADMIN_OUTPUT" npm run admin:create

log "Reiniciando aplicacao com o ambiente definitivo"
pm2 restart central-prints --update-env
pm2 save

log "Validando liveness, readiness e HTTPS"
HEALTH="000"; READY="000"; PUBLIC="000"
for _ in $(seq 1 20); do
  HEALTH="$(curl -sS --max-time 5 -o /tmp/central-prints-health.json -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/health" || true)"
  READY="$(curl -sS --max-time 5 -o /tmp/central-prints-ready.json -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/ready" || true)"
  [ "$HEALTH" = "200" ] && [ "$READY" = "200" ] && break
  sleep 1
done

PUBLIC="$(curl -kLsS --max-redirs 5 --max-time 20 -o /tmp/central-prints-public-after-db.html -w '%{http_code}' "https://$DOMAIN/?db=$STAMP" || true)"
cat /tmp/central-prints-health.json 2>/dev/null || true; echo
cat /tmp/central-prints-ready.json 2>/dev/null || true; echo

echo "HEALTH_HTTP=$HEALTH"
echo "READY_HTTP=$READY"
echo "PUBLIC_HTTP=$PUBLIC"

if [ "$HEALTH" != "200" ] || [ "$READY" != "200" ] || [ "$PUBLIC" != "200" ]; then
  pm2 status || true
  pm2 logs central-prints --lines 160 --nostream || true
  fail "Validacao final falhou: health=$HEALTH ready=$READY public=$PUBLIC"
fi

log "Banco e autenticacao prontos"
echo "DB_NAME=$DB_NAME"
echo "DB_USER=$DB_USER"
echo "BACKUP_DIR=$BACKUP_DIR"
if [ -f "$ADMIN_OUTPUT" ]; then
  chmod 600 "$ADMIN_OUTPUT"
  echo "CREDENCIAL_INICIAL=$ADMIN_OUTPUT (modo 600; senha nao impressa)"
fi

echo
echo "============================================================"
echo " CENTRAL PRINTS DATABASE READY"
echo "============================================================"
echo "HEALTH_HTTP=$HEALTH"
echo "READY_HTTP=$READY"
echo "PUBLIC_HTTP=$PUBLIC"
echo "ADMIN_URL=https://$DOMAIN/admin/"
echo "BACKUP_DIR=$BACKUP_DIR"
echo "============================================================"
