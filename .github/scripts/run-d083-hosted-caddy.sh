#!/usr/bin/env bash
# Hosted verification only. The production runner never downloads this binary.
set -Eeuo pipefail
umask 077
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "$(uname -sm)" = 'Linux x86_64'
test -d "$RUNNER_TEMP" && test ! -L "$RUNNER_TEMP"
work="$(mktemp -d "$RUNNER_TEMP/d083-caddy.XXXXXXXX")"
cleanup() {
  case "$work" in "$RUNNER_TEMP"/d083-caddy.*) rm -rf -- "$work" ;; *) return 1 ;; esac
}
trap cleanup EXIT
archive="$work/caddy.tar.gz"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --max-time 90 --max-filesize 67108864 --output "$archive" \
  https://github.com/caddyserver/caddy/releases/download/v2.8.4/caddy_2.8.4_linux_amd64.tar.gz
# Official caddy-docker v2.8.4, commit fb6e8723745c60fe413a311b484704e8ce3fcfd3,
# 2.8/alpine/Dockerfile, x86_64 checksum (Git blob bcf7cfd9194627bea5987aacfc891bb4b9d3d05f).
printf '%s  %s\n' \
  b8bec15d14fb033562af9f207850027bcbaa1f891edc9efe00d38bf39e1bf9944f8b6b8eba041ddd4c171cd70c905174c704d705be2f23bc678fe1eaf37a2485 \
  "$archive" | sha512sum --check --status
tar -xzf "$archive" -C "$work" caddy
chmod 0500 "$work/caddy"
[[ "$("$work/caddy" version)" == 'v2.8.4 '* ]]
PATH="$work:$PATH" python3 -I .github/scripts/test-d083-maintenance-caddy.py
