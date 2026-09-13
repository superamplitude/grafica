#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
TMP_CHECKER="$(mktemp)"
cleanup(){ rm -f "$TMP_CHECKER"; }
trap cleanup EXIT

fail(){ echo "[ERRO] $*" >&2; exit 1; }
git_safe(){ git -c safe.directory="$APP_DIR" "$@"; }

[ "$(id -u)" -eq 0 ] || fail "Execute como root."
for cmd in git curl python3 flock systemctl; do command -v "$cmd" >/dev/null 2>&1 || fail "Comando obrigatorio ausente: $cmd"; done
[ -d "$APP_DIR/.git" ] || fail "Repositorio nao encontrado em $APP_DIR"
cd "$APP_DIR"

printf '\n[1/4] Atualizando referencia origin/main\n'
git_safe fetch origin main
TARGET="$(git_safe rev-parse origin/main)"
printf 'TARGET=%s\n' "$TARGET"

printf '\n[2/4] Executando deploy somente se o CI deste commit estiver aprovado\n'
git_safe show origin/main:deploy/autodeploy-check.sh > "$TMP_CHECKER"
chmod 700 "$TMP_CHECKER"
bash "$TMP_CHECKER"

CURRENT="$(git_safe rev-parse HEAD)"
git_safe fetch --quiet origin main
TARGET="$(git_safe rev-parse origin/main)"
if [ "$CURRENT" != "$TARGET" ]; then
  fail "A VPS permaneceu em ${CURRENT:0:12}; o alvo ${TARGET:0:12} ainda nao foi implantado. Verifique o CI e execute este bootstrap novamente."
fi

printf '\n[3/4] Preparando layout R2 sem ativar requisito antes da prova real\n'
if [ -f "$APP_DIR/.env" ] && [ -f "$APP_DIR/deploy/prepare-r2-layout.sh" ]; then
  bash "$APP_DIR/deploy/prepare-r2-layout.sh"
else
  echo '[AVISO] .env ou prepare-r2-layout.sh ausente; etapa R2 adiada sem bloquear o autodeploy.'
fi

printf '\n[4/4] Instalando verificacao automatica GitHub CI -> VPS\n'
bash "$APP_DIR/deploy/install-vps-autodeploy.sh"

printf '\n============================================================\n'
printf ' CENTRAL PRINTS - FLUXO CONTINUO ATIVO\n'
printf '============================================================\n'
printf 'COMMIT=%s\n' "$(git_safe rev-parse --short HEAD)"
printf 'AUTODEPLOY_TIMER=%s\n' "$(systemctl is-active central-prints-autodeploy.timer 2>/dev/null || true)"
printf 'RELEASE=https://grafica.belastock.com.br/api/release\n'
printf 'REGRA=main + CI success -> deploy com rollback\n'
printf 'R2_LAYOUT=grafica (publico) + grafica-private (privado)\n'
printf '============================================================\n'
