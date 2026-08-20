#!/bin/sh
set -eu

umask 077
mkdir -p /backups

while true; do
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="/backups/arthello-${stamp}.dump"
  pg_dump --format=custom --no-owner --no-privileges --file="$target" "$DATABASE_URL"
  sha256sum "$target" > "${target}.sha256"
  find /backups -type f \( -name 'arthello-*.dump' -o -name 'arthello-*.dump.sha256' \) -mtime +14 -delete
  sleep 86400
done
