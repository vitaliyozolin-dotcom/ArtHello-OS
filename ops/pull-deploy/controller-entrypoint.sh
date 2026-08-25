#!/usr/bin/env bash
set -Eeuo pipefail

interval="${ARTHELLO_POLL_INTERVAL:-60}"
case "$interval" in
  ''|*[!0-9]*) interval=60 ;;
esac
if [ "$interval" -lt 30 ]; then interval=30; fi

while true; do
  /usr/local/sbin/arthello-staging-pull || true
  sleep "$interval"
done
