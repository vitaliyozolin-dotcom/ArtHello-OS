#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "$EUID" -ne 0 || "$#" -ne 1 ]]; then
  printf 'Usage (root): bash install.sh /absolute/path/to/active-arthello.sqlite\n' >&2
  exit 2
fi
package_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source_database="$1"
backup_directory=/var/backups/arthello-v52
config_file=/etc/arthello-v52-backup.json

# Preflight validates the exact operator-selected DB and both service files.
# No database autodiscovery and no Docker socket access are used.
python3 - "$package_dir" "$source_database" "$backup_directory" <<'PY'
import importlib.util
import sys
from pathlib import Path

package, source, destination = sys.argv[1:]
spec = importlib.util.spec_from_file_location("backup", Path(package) / "backup.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
source = module.safe_path(source)
if Path(destination).is_relative_to(source.parent):
    raise SystemExit("Backup directory must be outside the live database directory")
if Path(destination).exists():
    module.safe_path(destination, directory=True, private=True)
with module.contextlib.closing(module.readonly(source)) as db:
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")}
    if not module.REQUIRED_TABLES.issubset(tables):
        raise SystemExit("Selected source is not the ArtHello application database")
PY
systemd-analyze verify "$package_dir/arthello-v52-backup.service" "$package_dir/arthello-v52-backup.timer"

install -d -m 0700 "$backup_directory"
install -d -m 0755 /usr/local/lib/arthello-v52-backup
install -m 0644 "$package_dir/backup.py" /usr/local/lib/arthello-v52-backup/backup.py
install -m 0644 "$package_dir/arthello-v52-backup.service" /etc/systemd/system/arthello-v52-backup.service
install -m 0644 "$package_dir/arthello-v52-backup.timer" /etc/systemd/system/arthello-v52-backup.timer
python3 - "$config_file" "$source_database" "$backup_directory" <<'PY'
import json
import os
import sys
import tempfile
from pathlib import Path

target, source, directory = sys.argv[1:]
fd, temporary = tempfile.mkstemp(prefix=".arthello-backup-", dir="/etc")
try:
    with os.fdopen(fd, "w") as handle:
        json.dump({"source": source, "backupDirectory": directory}, handle)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, target)
finally:
    Path(temporary).unlink(missing_ok=True)
PY
systemctl daemon-reload
# Enable the daily schedule only after a real backup and restore verification succeed.
systemctl start arthello-v52-backup.service
systemctl enable --now arthello-v52-backup.timer
systemctl list-timers --all arthello-v52-backup.timer
