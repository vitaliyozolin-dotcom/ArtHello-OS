#!/usr/bin/env bash
set -Eeuo pipefail

SRC_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/arthello-staging-pull.sh"
TARGET_SCRIPT="/usr/local/sbin/arthello-staging-pull"
TOKEN_FILE="/etc/arthello/github-token"
SERVICE="/etc/systemd/system/arthello-staging-pull.service"
TIMER="/etc/systemd/system/arthello-staging-pull.timer"

[ "$(id -u)" -eq 0 ] || { echo 'Run as root' >&2; exit 1; }
[ -f "$SRC_SCRIPT" ] || { echo "Missing $SRC_SCRIPT" >&2; exit 1; }

install -d -m 0700 /etc/arthello
if [ ! -s "$TOKEN_FILE" ]; then
  if [ -t 0 ]; then
    read -rsp 'GitHub fine-grained token (Contents: read for ArtHello-OS): ' token
    printf '\n'
    [ -n "$token" ] || { echo 'Token is empty' >&2; exit 1; }
    umask 077
    printf '%s\n' "$token" > "$TOKEN_FILE"
    unset token
  else
    echo "Missing $TOKEN_FILE; create it first with chmod 600" >&2
    exit 1
  fi
fi
chmod 600 "$TOKEN_FILE"

install -m 0750 "$SRC_SCRIPT" "$TARGET_SCRIPT"

cat > "$SERVICE" <<'EOF'
[Unit]
Description=ArtHello STAGING server-native pull deploy
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/arthello-staging-pull
TimeoutStartSec=25min
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=6
EOF

cat > "$TIMER" <<'EOF'
[Unit]
Description=Check ArtHello develop branch for STAGING changes every minute

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
AccuracySec=5s
Persistent=true
Unit=arthello-staging-pull.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now arthello-staging-pull.timer
systemctl start arthello-staging-pull.service

echo '=== TIMER ==='
systemctl --no-pager status arthello-staging-pull.timer || true
echo '=== LAST DEPLOY ==='
systemctl --no-pager status arthello-staging-pull.service || true
echo '=== LOG ==='
journalctl -u arthello-staging-pull.service -n 80 --no-pager || true
