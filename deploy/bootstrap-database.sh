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
DB_NAME="$(read_env DB_NAME)"; DB_NAME="${DB_NAME:-centralprints}"
DB_USER="$(read_env DB_USER)"; DB_USER="${DB_USER:-centralprints}"
DB_PASSWORD="$(read_env DB_PASSWORD)"
JWT_SECRET="$(read_env JWT_SECRET)"

[ -n "$DB_PASSWORD" ] || DB_PASSWORD="$(openssl rand -hex 24)"
[ -n "$JWT_SECRET" ] || JWT_SECRET="$(openssl rand -hex 48)"

legacy_db_ok(){
  local name="$1" user="$2"
  MYSQL_PWD="$DB_PASSWORD" mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u "$user" -D "$name" -NBe 'SELECT 1' 2>/dev/null | grep -qx '1'
}

# CloudPanel rejeita nomes com underscore no fluxo db:add. Se este for o antigo
# default ainda nao criado, migra apenas a configuracao para um identificador
# simples compativel. Um banco legado funcional nunca e renomeado automaticamente.
if [[ "$DB_NAME" == *_* || "$DB_USER" == *_* ]]; then
  if legacy_db_ok "$DB_NAME" "$DB_USER"; then
    echo "[INFO] Banco legado com underscore ja existe e esta acessivel; mantendo nomes atuais."
  else
    OLD_DB_NAME="$DB_NAME"; OLD_DB_USER="$DB_USER"
    DB_NAME="${DB_NAME//_/}"
    DB_USER="${DB_USER//_/}"
    [ -n "$DB_NAME" ] || DB_NAME="centralprints"
    [ -n "$DB_USER" ] || DB_USER="centralprints"
    echo "[INFO] Nomes CloudPanel normalizados: ${OLD_DB_NAME}/${OLD_DB_USER} -> ${DB_NAME}/${DB_USER}"
  fi
fi

[[ "$DB_NAME" =~ ^[A-Za-z0-9-]+$ ]] || fail "DB_NAME invalido para CloudPanel. Use apenas letras, numeros e hifen."
[[ "$DB_USER" =~ ^[A-Za-z0-9-]+$ ]] || fail "DB_USER invalido para CloudPanel. Use apenas letras, numeros e hifen."
[ ${#DB_NAME} -le 64 ] || fail "DB_NAME excede 64 caracteres."
[ ${#DB_USER} -le 32 ] || fail "DB_USER excede 32 caracteres."

log "Persistindo configuracao dedicada antes da criacao/recuperacao do banco"
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

# Recuperacao especifica e limitada para o caso em que o banco foi criado
# manualmente com a senha provisoria literal "...". A senha provisoria nunca
# e persistida no .env. O proprio usuario autenticado troca a propria senha,
# sem usar credencial master do servidor e sem tocar em outros bancos.
manual_placeholder_db_ok(){
  MYSQL_PWD='...' mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u "$DB_USER" -D "$DB_NAME" -NBe 'SELECT 1' 2>/dev/null | grep -qx '1'
}

rotate_manual_placeholder_password(){
  local version sql
  version="$(MYSQL_PWD='...' mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u "$DB_USER" -D "$DB_NAME" -NBe 'SELECT VERSION()' 2>/dev/null || true)"
  [ -n "$version" ] || return 1

  # DB_PASSWORD e gerada como hex e, portanto, nao contem aspas ou metacaracteres SQL.
  if [[ "$version" == *MariaDB* ]]; then
    sql="ALTER USER CURRENT_USER() IDENTIFIED BY '$DB_PASSWORD';"
  else
    sql="ALTER USER USER() IDENTIFIED BY '$DB_PASSWORD';"
  fi

  MYSQL_PWD='...' mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u "$DB_USER" -D "$DB_NAME" -e "$sql" >/dev/null 2>&1
}

show_cloudpanel_log(){
  local logfile="$1"
  [ -f "$logfile" ] || return 0
  echo "================ CLOUDPANEL DB:ADD ================"
  python3 - "$logfile" "$DB_PASSWORD" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); secret=sys.argv[2]
text=p.read_text(errors='replace')
if secret:
    text=text.replace(secret,'[REDACTED]')
print(text[-12000:])
PY
  echo "===================================================="
}

backup_existing_db(){
  log "Criando backup CloudPanel antes das migrations"
  DB_BACKUP="$BACKUP_DIR/${DB_NAME}.before.sql.gz"
  if clpctl db:export --databaseName="$DB_NAME" --file="$DB_BACKUP" >"$BACKUP_DIR/clpctl-db-export.log" 2>&1; then
    chmod 600 "$DB_BACKUP" "$BACKUP_DIR/clpctl-db-export.log" 2>/dev/null || true
    echo "DB_BACKUP=$DB_BACKUP"
  else
    chmod 600 "$BACKUP_DIR/clpctl-db-export.log" 2>/dev/null || true
    cat "$BACKUP_DIR/clpctl-db-export.log" >&2 || true
    fail "Banco existente detectado, mas o CloudPanel nao conseguiu exporta-lo. Migrations nao serao executadas sem backup."
  fi
}

log "Verificando se o banco dedicado ja esta acessivel"
if app_db_ok; then
  echo "DB_PREEXISTENTE=sim"
  backup_existing_db
elif manual_placeholder_db_ok; then
  echo "[INFO] Banco manual detectado com credencial provisoria; rotacionando senha sem recriar banco."
  rotate_manual_placeholder_password || fail "Nao foi possivel trocar a senha provisoria do usuario do banco. Nada foi migrado."
  app_db_ok || fail "Senha foi rotacionada, mas a credencial definitiva nao validou. Nada foi migrado."
  echo "DB_PREEXISTENTE=sim-recuperado"
  backup_existing_db
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

  if [ "$ADD_RC" -ne 0 ] || ! app_db_ok; then
    show_cloudpanel_log "$BACKUP_DIR/clpctl-db-add.log"
    clpctl db:add --help >"$BACKUP_DIR/clpctl-db-add-help.log" 2>&1 || true
    chmod 600 "$BACKUP_DIR/clpctl-db-add-help.log" 2>/dev/null || true
    fail "CloudPanel nao criou banco/usuario utilizavel. Evidencia acima; nada foi sobrescrito."
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
