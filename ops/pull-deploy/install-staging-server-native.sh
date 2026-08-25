#!/usr/bin/env bash
set -Eeuo pipefail

REPO_SSH="git@github.com:vitaliyozolin-dotcom/ArtHello-OS.git"
BRANCH="develop"
BOOTSTRAP_DIR="/srv/arthello-staging-bootstrap"
SSH_KEY="/root/.ssh/arthello_repo_ed25519"

[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
[ -r "$SSH_KEY" ] || { echo "Missing $SSH_KEY"; exit 1; }
command -v git >/dev/null
command -v docker >/dev/null
command -v systemctl >/dev/null

export GIT_SSH_COMMAND="ssh -i $SSH_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
rm -rf "$BOOTSTRAP_DIR"
git clone --depth 1 --branch "$BRANCH" "$REPO_SSH" "$BOOTSTRAP_DIR"

install -m 0750 "$BOOTSTRAP_DIR/ops/pull-deploy/arthello-staging-pull.sh" /usr/local/sbin/arthello-staging-pull

cat > /etc/systemd/system/arthello-staging-pull.service <<'EOF'
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

cat > /etc/systemd/system/arthello-staging-pull.timer <<'EOF'
[Unit]
Description=Check ArtHello develop branch every minute

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
systemctl --no-pager --full status arthello-staging-pull.timer
journalctl -u arthello-staging-pull.service -n 120 --no-pager
