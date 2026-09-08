#!/usr/bin/env bash
# Run only on a newly provisioned, externally isolated disposable build VM.
# This script neither buys a VM nor installs itself on an existing server.
set -Eeuo pipefail
set +x
umask 077

if [ "$#" -ne 3 ]; then
  echo 'usage: bootstrap.sh /root/approved-builder.json /root/actions-runner-linux-x64.tar.gz /run/runner-registration-token' >&2
  exit 64
fi
plan="$1"
runner_archive="$2"
registration_file="$3"
test "$(id -u)" -eq 0
test "$(uname -m)" = x86_64
for path in "$plan" "$runner_archive" "$registration_file"; do
  [[ "$path" = /* ]]
  test -f "$path"
  test ! -L "$path"
  test "$(stat -c %u "$path")" = 0
done
test "$(stat -c %a "$plan")" = 600
test "$(stat -c %a "$registration_file")" = 600
test ! -e /opt/arthello-builder
test ! -e /opt/arthello-actions
if id arthello-build >/dev/null 2>&1; then
  echo 'Build account already exists: refuse to reuse a VM.' >&2
  exit 1
fi
test -z "${DOCKER_HOST:-}"
test -z "${DOCKER_CONTEXT:-}"
test -z "${SSH_AUTH_SOCK:-}"
for command in python3 ip sha256sum tar curl jq ruby git docker runuser useradd; do
  command -v "$command" >/dev/null
done
test "$(docker context inspect --format '{{.Endpoints.docker.Host}}')" = unix:///var/run/docker.sock
test -z "$(docker ps -aq)"
test -z "$(docker volume ls -q)"

# Validate the approved cloud resource against the VM before any user or runner
# is created. These references must come from the external provisioning record,
# not from PR code or an unverified 'isolated' label.
python3 -I - "$plan" "$runner_archive" <<'PY'
import hashlib, ipaddress, json, os, pathlib, re, socket, subprocess, sys, tarfile, time
plan = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert plan['schemaVersion'] == 1
assert plan['repository'] == 'vitaliyozolin-dotcom/ArtHello-OS'
assert plan['ephemeral'] is True and plan['productionCapability'] is False
assert plan['runnerLabel'] == 'arthello-build-only-linux-x64'
assert re.fullmatch(r'[a-f0-9]{40}', plan['controllerSha'])
assert re.fullmatch(r'[a-f0-9]{40}', plan['sourceSha'])
assert re.fullmatch(r'[a-f0-9]{40}', plan['sourceTree'])
assert re.fullmatch(r'arthello-build-[a-z0-9-]{5,60}', plan['runnerName'])
assert plan['hostname'] == socket.gethostname()
assert plan['bootId'] == pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip()
assert isinstance(plan['createdAt'], int) and isinstance(plan['expiresAt'], int)
assert plan['createdAt'] <= int(time.time()) < plan['expiresAt'] <= plan['createdAt'] + 4 * 3600
for field in ['providerInstanceId', 'networkPolicyRef', 'externalExpiryRef', 'baseImageRef']:
    assert re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9:._/@-]{2,255}', plan[field])
actual = set()
for interface in json.loads(subprocess.check_output(['ip', '-j', 'address'])):
    for address in interface.get('addr_info', []):
        ip = ipaddress.ip_address(address['local'])
        if not ip.is_loopback and not ip.is_link_local:
            actual.add(str(ip))
assert actual and actual == set(plan['addresses'])
assert not actual.intersection({'188.225.38.55', '188.225.47.207'})
archive = pathlib.Path(sys.argv[2])
assert re.fullmatch(r'[0-9a-f]{64}', plan['runnerArchiveSha256'])
assert hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest() == plan['runnerArchiveSha256']
with tarfile.open(archive) as bundle:
    for member in bundle.getmembers():
        p = pathlib.PurePosixPath(member.name)
        assert not p.is_absolute() and '..' not in p.parts
print('ARTHELLO_BUILD_BOOTSTRAP_PREFLIGHT=VERIFIED')
PY

useradd --create-home --shell /bin/bash --groups docker arthello-build
install -d -o root -g root -m 0755 /opt/arthello-builder
install -m 0644 "$plan" /opt/arthello-builder/ready.json
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
install -o root -g root -m 0755 "$script_dir/check-ready.py" /opt/arthello-builder/check-ready.py
install -d -o arthello-build -g arthello-build -m 0700 /opt/arthello-actions
tar --extract --gzip --file "$runner_archive" --directory /opt/arthello-actions --no-same-owner
chown -R arthello-build:arthello-build /opt/arthello-actions
runner_name="$(jq -er '.runnerName' "$plan")"
registration_token="$(cat "$registration_file")"
[[ "$registration_token" =~ ^[A-Za-z0-9_=-]{10,200}$ ]]
cd /opt/arthello-actions
# A time-limited registration token, not a PAT. It is not placed in YAML or logs.
runuser -u arthello-build -- ./config.sh \
  --unattended --ephemeral --no-default-labels \
  --url https://github.com/vitaliyozolin-dotcom/ArtHello-OS \
  --name "$runner_name" --labels arthello-build-only-linux-x64 \
  --work _work --token "$registration_token"
unset registration_token
rm -- "$registration_file"
echo 'ARTHELLO_BUILD_RUNNER=REGISTERED_EPHEMERAL'
# Exactly one job per VM. No automatic re-registration/reuse loop.
# The external provider must expire/destroy this VM even if this process dies.
set +e
runuser -u arthello-build -- ./run.sh
runner_status=$?
set -e
echo "ARTHELLO_BUILD_RUNNER=FINISHED status=$runner_status"
systemctl poweroff
exit "$runner_status"
