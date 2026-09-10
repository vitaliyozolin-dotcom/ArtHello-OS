#!/bin/sh
set -eu

umask 077
backup_dir="${BACKUP_DIR:-/backups}"
interval_seconds="${BACKUP_INTERVAL_SECONDS:-86400}"
retry_seconds="${BACKUP_RETRY_SECONDS:-300}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"

case "$interval_seconds:$retry_seconds:$retention_days" in
  *[!0-9:]* | :* | *::* | *:) echo "backup configuration must contain positive integers" >&2; exit 64 ;;
esac
[ "$interval_seconds" -gt 0 ] && [ "$retry_seconds" -gt 0 ] && [ "$retention_days" -gt 0 ] || {
  echo "backup configuration must contain positive integers" >&2
  exit 64
}

mkdir -p "$backup_dir"

backup_once() {
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="$backup_dir/arthello-${stamp}.dump"
  partial="${target}.partial"
  checksum_partial="${target}.sha256.partial"
  rm -f "$partial" "$checksum_partial"
  trap 'rm -f "$partial" "$checksum_partial"' EXIT HUP INT TERM

  pg_dump --format=custom --no-owner --no-privileges --file="$partial" "$DATABASE_URL"
  pg_restore --list "$partial" >/dev/null
  mv "$partial" "$target"
  (
    cd "$backup_dir"
    sha256sum "${target##*/}" > "${checksum_partial##*/}"
  )
  mv "$checksum_partial" "${target}.sha256"
  trap - EXIT HUP INT TERM

  find "$backup_dir" -type f \( -name 'arthello-*.dump' -o -name 'arthello-*.dump.sha256' \) \
    -mtime "+$retention_days" -delete
  echo "backup verified: ${target##*/}" >&2
}

if [ "${BACKUP_RUN_ONCE:-0}" = "1" ]; then
  backup_once
  exit 0
fi

while true; do
  started_at="$(date +%s)"
  if backup_once; then
    finished_at="$(date +%s)"
    elapsed=$((finished_at - started_at))
    delay=$((interval_seconds - elapsed))
    [ "$delay" -gt 0 ] || delay=1
  else
    echo "backup failed; retry scheduled in ${retry_seconds}s" >&2
    delay="$retry_seconds"
  fi
  sleep "$delay"
done
