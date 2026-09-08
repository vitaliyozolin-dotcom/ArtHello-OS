#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ "$EUID" -ne 0 || "$#" -ne 0 ]]; then
  printf 'Usage (root): bash install-bridge.sh\n' >&2
  exit 2
fi
package_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
test -f /etc/arthello-v52-backup.json
test -d /var/backups/arthello-v52
test "$(systemctl show arthello-v52-backup.service --property=LoadState --value)" = loaded
test "$(systemctl show arthello-v52-backup.timer --property=LoadState --value)" = loaded
getent group arthello-backup-control >/dev/null || groupadd --system arthello-backup-control
systemd-analyze verify "$package_dir/arthello-v52-backup-bridge.service"
install -m 0644 "$package_dir/bridge.py" /usr/local/lib/arthello-v52-backup/bridge.py
install -m 0644 "$package_dir/arthello-v52-backup-bridge.service" /etc/systemd/system/arthello-v52-backup-bridge.service
systemctl daemon-reload
systemctl enable --now arthello-v52-backup-bridge.service
systemctl restart arthello-v52-backup-bridge.service
# Deployment adds this group numerically to the non-root app container; it
# mounts only this socket directory read-only, never /run or the backup files.
getent group arthello-backup-control | cut -d: -f3
