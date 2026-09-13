#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/home/belastock-grafica/htdocs/grafica.belastock.com.br"
CHECKER="$APP_DIR/deploy/autodeploy-check.sh"
SERVICE="/etc/systemd/system/central-prints-autodeploy.service"
TIMER="/etc/systemd/system/central-prints-autodeploy.timer"

fail(){ echo "[ERRO] $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail "Execute como root."
[ -f "$CHECKER" ] || fail "Arquivo ausente: $CHECKER"
command -v systemctl >/dev/null 2>&1 || fail "systemd/systemctl nao encontrado."
chmod 700 "$CHECKER"
install -d -o root -g root -m 700 /var/lib/central-prints-autodeploy

cat > "$SERVICE" <<UNIT
[Unit]
Description=Central Prints CI-gated pull autodeploy
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
Group=root
ExecStart=/bin/bash $CHECKER
Environment=NPM_CONFIG_CACHE=/tmp/central-prints-npm-cache
Nice=5
IOSchedulingClass=best-effort
IOSchedulingPriority=6
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=read-only
ProtectSystem=full
ReadWritePaths=/home/belastock-grafica /var/lib/central-prints-autodeploy /var/lock /root/.pm2 /tmp
KillMode=process
TimeoutStartSec=20min
UNIT

cat > "$TIMER" <<'UNIT'
[Unit]
Description=Check Central Prints main after CI and deploy automatically

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
RandomizedDelaySec=20s
Persistent=true
Unit=central-prints-autodeploy.service

[Install]
WantedBy=timers.target
UNIT

chmod 644 "$SERVICE" "$TIMER"
systemctl daemon-reload
systemctl enable --now central-prints-autodeploy.timer

printf '\n============================================================\n'
printf ' CENTRAL PRINTS AUTODEPLOY INSTALADO\n'
printf '============================================================\n'
printf 'Origem: GitHub main -> CI Central Prints -> VPS\n'
printf 'Intervalo: aproximadamente 5 minutos\n'
printf 'Regra: somente commit com CI push concluido em SUCCESS\n'
printf 'Checker versionado: %s\n' "$CHECKER"
printf 'Lock compartilhado: /var/lock/central-prints-actions-deploy.lock\n'
printf 'Timer: '
systemctl is-active central-prints-autodeploy.timer || true
printf 'Habilitado: '
systemctl is-enabled central-prints-autodeploy.timer || true
printf '============================================================\n'

# Primeira verificacao imediata. Falha de deploy nao desinstala o timer.
systemctl start central-prints-autodeploy.service || true
systemctl --no-pager --full status central-prints-autodeploy.service | tail -n 20 || true
