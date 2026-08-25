#!/usr/bin/env bash
set -Eeuo pipefail

REPO=${REPO:-vitaliyozolin-dotcom/ArtHello-OS}
RUNNER_NAME=${RUNNER_NAME:-school-38-55}
RUNNER_LABELS=${RUNNER_LABELS:-school-prod}
RUNNER_ROOT=${RUNNER_ROOT:-/opt/actions-runner-school}
TOKEN_FILE=${TOKEN_FILE:-/srv/arthello/shared/github-https/token}
RUNNER_USER=${RUNNER_USER:-root}

if [ "$(id -u)" -ne 0 ]; then
  printf 'Run as root.\n' >&2
  exit 1
fi

command -v curl >/dev/null
command -v tar >/dev/null
command -v docker >/dev/null

docker info >/dev/null
install -d -m 0755 "$RUNNER_ROOT"

api_token=${GITHUB_ADMIN_TOKEN:-}
if [ -z "$api_token" ] && [ -s "$TOKEN_FILE" ]; then
  api_token=$(tr -d '\r\n' < "$TOKEN_FILE")
fi

registration_token=${RUNNER_REGISTRATION_TOKEN:-}
if [ -z "$registration_token" ] && [ -n "$api_token" ]; then
  response=$(curl --fail-with-body --silent --show-error \
    -X POST \
    -H "Authorization: Bearer $api_token" \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' \
    "https://api.github.com/repos/$REPO/actions/runners/registration-token" || true)
  registration_token=$(python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("token", ""))' <<<"$response" 2>/dev/null || true)
fi

if [ -z "$registration_token" ]; then
  cat >&2 <<'EOF'
Could not obtain a runner registration token automatically.
The existing GitHub token probably lacks repository Administration: write permission.
Re-run with RUNNER_REGISTRATION_TOKEN=<one-time token> or GITHUB_ADMIN_TOKEN=<fine-grained token with Administration: write>.
EOF
  exit 42
fi

arch=$(uname -m)
case "$arch" in
  x86_64) asset_arch=x64 ;;
  aarch64|arm64) asset_arch=arm64 ;;
  *) printf 'Unsupported architecture: %s\n' "$arch" >&2; exit 1 ;;
esac

latest=$(curl --fail --silent --show-error https://api.github.com/repos/actions/runner/releases/latest)
version=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"].lstrip("v"))' <<<"$latest")
asset="actions-runner-linux-${asset_arch}-${version}.tar.gz"
url="https://github.com/actions/runner/releases/download/v${version}/${asset}"

tmp=$(mktemp -d /tmp/actions-runner-school.XXXXXX)
trap 'rm -rf "$tmp"' EXIT
curl --fail --silent --show-error --location --output "$tmp/$asset" "$url"

if [ -f "$RUNNER_ROOT/.runner" ]; then
  cd "$RUNNER_ROOT"
  ./svc.sh stop || true
  ./svc.sh uninstall || true
  ./config.sh remove --token "$registration_token" || true
  rm -rf "$RUNNER_ROOT"/* "$RUNNER_ROOT"/.[!.]* "$RUNNER_ROOT"/..?* 2>/dev/null || true
fi

tar -xzf "$tmp/$asset" -C "$RUNNER_ROOT"
cd "$RUNNER_ROOT"

export RUNNER_ALLOW_RUNASROOT=1
./config.sh \
  --unattended \
  --url "https://github.com/$REPO" \
  --token "$registration_token" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --work _work \
  --replace

./svc.sh install "$RUNNER_USER"
./svc.sh start
sleep 3
./svc.sh status

printf 'SCHOOL_RUNNER_INSTALLED=OK\n'
printf 'SCHOOL_RUNNER_NAME=%s\n' "$RUNNER_NAME"
printf 'SCHOOL_RUNNER_LABELS=self-hosted,linux,%s,%s\n' "$asset_arch" "$RUNNER_LABELS"
