#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
ENV_FILE="$APP_DIR/.env"
ACCOUNT_ID="${R2_ACCOUNT_ID_OVERRIDE:-}"
PUBLIC_BUCKET="${R2_PUBLIC_BUCKET_OVERRIDE:-grafica}"
PRIVATE_BUCKET="${R2_PRIVATE_BUCKET_OVERRIDE:-grafica-private}"

fail(){ echo "[ERRO] $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail "Execute como root."
[ -f "$ENV_FILE" ] || fail ".env nao encontrado em $ENV_FILE"
command -v python3 >/dev/null 2>&1 || fail "python3 nao encontrado."

STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="/home/belastock-grafica/backups/r2_layout_$STAMP"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cp -a "$ENV_FILE" "$BACKUP_DIR/env.before"
chmod 600 "$BACKUP_DIR/env.before"

python3 - "$ENV_FILE" "$ACCOUNT_ID" "$PUBLIC_BUCKET" "$PRIVATE_BUCKET" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
account_id,public_bucket,private_bucket=sys.argv[2:5]
vals={
  'R2_REQUIRED':'false',
  'R2_PUBLIC_BUCKET':public_bucket,
  'R2_PRIVATE_BUCKET':private_bucket,
}
if account_id:
    vals['R2_ACCOUNT_ID']=account_id
lines=p.read_text().splitlines(); out=[]; seen=set()
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
p.write_text('\n'.join(out)+'\n')
PY
chmod 600 "$ENV_FILE"

printf '\nCENTRAL PRINTS R2 LAYOUT PREPARADO MANUALMENTE\n'
printf 'PUBLIC_BUCKET=%s\n' "$PUBLIC_BUCKET"
printf 'PRIVATE_BUCKET=%s\n' "$PRIVATE_BUCKET"
printf 'R2_ACCOUNT_ID=%s\n' "$([ -n "$ACCOUNT_ID" ] && echo 'fornecido explicitamente' || echo 'preservado sem alteracao')"
printf 'R2_REQUIRED=false (sera ativado apenas apos prova real)\n'
printf 'BACKUP_DIR=%s\n' "$BACKUP_DIR"
printf '\nEste helper nao e executado pelo autodeploy. Cloudflare/R2 permanece sob controle manual.\n'
printf 'Quando credenciais e URL publica estiverem configuradas pelo operador, use:\n'
printf '  bash %s/deploy/bootstrap-r2.sh\n' "$APP_DIR"
