#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
ENTRYPOINT_SOURCE="$APP_DIR/deploy/actions-entrypoint.sh"
ENTRYPOINT_TARGET="/usr/local/sbin/central-prints-actions-entrypoint"
AUTHORIZED_KEYS="/root/.ssh/authorized_keys"
TAG="central-prints-actions"

fail(){ printf '[ERRO] %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Execute como root."
[ -f "$ENTRYPOINT_SOURCE" ] || fail "Arquivo ausente: $ENTRYPOINT_SOURCE"

PUBLIC_KEY="${1:-}"
if [ -z "$PUBLIC_KEY" ]; then
  cat >&2 <<'EOF'
Uso:
  bash deploy/bootstrap-actions-ssh.sh 'ssh-ed25519 AAAA... central-prints-actions'

Passe SOMENTE a chave publica. Nunca passe a chave privada para este script.
EOF
  exit 2
fi

case "$PUBLIC_KEY" in
  ssh-ed25519\ *|sk-ssh-ed25519@openssh.com\ *) ;;
  *) fail "A chave publica deve ser Ed25519." ;;
esac

install -o root -g root -m 700 "$ENTRYPOINT_SOURCE" "$ENTRYPOINT_TARGET"
install -d -o root -g root -m 700 /root/.ssh
touch "$AUTHORIZED_KEYS"
chmod 600 "$AUTHORIZED_KEYS"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
# Remove apenas entradas antigas deste projeto; preserva todas as demais chaves.
grep -v "$TAG" "$AUTHORIZED_KEYS" > "$TMP" || true
cat "$TMP" > "$AUTHORIZED_KEYS"
printf 'command="%s",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty %s %s\n' \
  "$ENTRYPOINT_TARGET" "$PUBLIC_KEY" "$TAG" >> "$AUTHORIZED_KEYS"
chmod 600 "$AUTHORIZED_KEYS"

printf '\nCENTRAL PRINTS - SSH RESTRITO CONFIGURADO\n'
printf 'Entrypoint: %s\n' "$ENTRYPOINT_TARGET"
printf 'Authorized key tag: %s\n' "$TAG"
printf 'Comandos remotos permitidos:\n'
printf '  central-prints-deploy\n'
printf '  central-prints-diagnostics\n'
printf '\nFingerprint SSH do servidor (confira antes de cadastrar no GitHub):\n'
for key in /etc/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ecdsa_key.pub /etc/ssh/ssh_host_rsa_key.pub; do
  [ -f "$key" ] && ssh-keygen -lf "$key" || true
done
printf '\nCloudflare nao foi alterado.\n'
