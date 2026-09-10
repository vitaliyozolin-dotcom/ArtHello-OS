"""Verify the held R14 application and sealed accepted-R12 backup adoption."""
import argparse
import hashlib
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from types import ModuleType
import urllib.request

HERE = Path(__file__).resolve().parent


def checked_module(name, filename, expected):
    path = Path(__file__).with_name(filename)
    source = path.read_bytes()
    if hashlib.sha256(source).hexdigest() != expected:
        raise RuntimeError('R14_ADAPTER_DEPENDENCY_DRIFT')
    value = ModuleType(name)
    value.__file__ = str(path)
    exec(compile(source, str(path), 'exec'), value.__dict__)
    return value

state = checked_module('r14_candidate_state', 'r16-candidate-state.py', 'de2a02f4b567935cc6ec1e627b6b53a3d948eb5ac7f03aeb92927b85d9c06600')
adoption = state.adoption
backup = adoption.r7
controller = checked_module('r14_backup_controller', 'r16-backup-controller.py', '50d0747430330922fd02396b08b388feabab38076e68dc3abc41fa6384766444')


def require(value):
    if not value:
        raise ValueError('Candidate continuation boundary mismatch')


def command(args, *, input=None, maximum=1048576):
    result = subprocess.run(args, input=input, capture_output=True, text=True, timeout=20,
                            env={'PATH': os.environ.get('PATH', '')})
    require(result.returncode == 0 and len(result.stdout) + len(result.stderr) <= maximum)
    return result.stdout


class Docker(backup.Docker):
    # Preserve the frozen strict distinction between absence and daemon failure.
    # Every real Docker operation here is read-only and uses a bounded environment.
    def run(self, args, timeout=30):
        result = subprocess.run(['docker', *args], capture_output=True, text=True,
                                timeout=min(timeout, 20), check=False,
                                env={'PATH': os.environ.get('PATH', '')})
        require(len(result.stdout) + len(result.stderr) <= 1048576)
        return result


def raw_private(path, maximum=1048576):
    path = state.absolute(str(path))
    require(path.resolve() == path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
                and info.st_uid == os.geteuid() and info.st_nlink == 1 and info.st_size <= maximum)
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            body = stream.read(maximum + 1)
        require(len(body) == info.st_size)
        return body
    finally:
        os.close(fd)


def mount(metadata, target):
    values = [item for item in metadata.get('Mounts', []) if item.get('Destination') == target]
    require(len(values) == 1)
    return values[0]


def validate_candidate(metadata, context, *, network, secret_dir, expected_entrypoint):
    config, host = metadata.get('Config', {}), metadata.get('HostConfig', {})
    require(metadata.get('Id') == context['candidateContainerId']
            and metadata.get('Name') == '/' + context['candidateName']
            and metadata.get('Image') == context['imageId']
            and config.get('Image') == context['imageId']
            and config.get('User') == 'node'
            and config.get('Cmd') == ['node', 'production/runtime-server.mjs']
            and config.get('Entrypoint') == expected_entrypoint)
    require(config.get('Labels', {}).get('arthello.release.sha') == context['releaseSha'])
    require(metadata.get('State', {}).get('Running') is True
            and metadata['State'].get('Paused') is False)
    require(host.get('ReadonlyRootfs') is True and not host.get('Privileged')
            and not host.get('CapAdd') and not host.get('PortBindings')
            and not host.get('PublishAllPorts') and host.get('NetworkMode') not in ('host', 'none')
            and host.get('PidMode', '') != 'host'
            and host.get('NetworkMode') == network
            and set(metadata.get('NetworkSettings', {}).get('Networks', {})) == {network}
            and host.get('Tmpfs') == {'/tmp': '', '/app/node_modules/.mf': 'rw,uid=1000,gid=1000,mode=0700'})
    env = config.get('Env', [])
    require(all(isinstance(item, str) and '=' in item for item in env))
    require(len({item.split('=', 1)[0] for item in env}) == len(env))
    env = dict(item.split('=', 1) for item in env)
    for key, expected in [('RELEASE_SHA', context['releaseSha']), ('TOCHKA_AUTOSYNC_ENABLED', '1'),
                          ('TOCHKA_AUTOSYNC_ACTIVATION_ID', context['bankActivationId']),
                          ('CENTRAL_ACCESS_SECRET_FILE', '/run/secrets/central-access-secret'),
                          ('INTEGRATION_CREDENTIALS_KEY_FILE', '/run/secrets/integration-credentials-key'),
                          ('ARTHELLO_BOOTSTRAP_PASSWORD_FILE', '/run/secrets/bootstrap-password'),
                          ('ARTHELLO_PUBLIC_ORIGIN', 'https://arthello-188-225-38-55.sslip.io'),
                          ('SCHOOL_PUBLIC_ORIGIN', 'https://school-188-225-38-55.sslip.io'),
                          ('SCHOOL_DIARY_SYNC_URL', 'https://school-188-225-38-55.sslip.io'),
                          ('SCHOOL_DIARY_ALLOWED_ORIGINS', 'https://school-188-225-38-55.sslip.io'),
                          ('NODE_ENV', 'production'), ('PORT', '8081'), ('ARTHELLO_D1_PATH', '/data/d1')]:
        require(env.get(key) == expected)
    require(not any(key in env for key in ('CENTRAL_ACCESS_SECRET', 'INTEGRATION_CREDENTIALS_KEY',
                                           'ARTHELLO_BOOTSTRAP_PASSWORD', 'OPENAI_API_KEY')))
    for target, name, writable in [('/data', context['dataVolume'], True),
                                   ('/var/lib/arthello-v52-backup-control', context['backupControlVolume'], False),
                                   ('/var/lib/arthello-v52-tochka-activation', context['bankActivationVolume'], False)]:
        item = mount(metadata, target)
        require(item.get('Type') == 'volume' and item.get('Name') == name and item.get('RW') is writable)
    secrets = {'central-access-secret', 'integration-credentials-key', 'bootstrap-password'}
    if 'OPENAI_API_KEY_FILE' in env:
        require(env['OPENAI_API_KEY_FILE'] == '/run/secrets/openai-api-key')
        secrets.add('openai-api-key')
    targets = {'/data', '/var/lib/arthello-v52-backup-control', '/var/lib/arthello-v52-tochka-activation'}
    for name in secrets:
        target = '/run/secrets/' + name
        item = mount(metadata, target)
        require(item.get('Type') == 'bind' and item.get('RW') is False
                and item.get('Source') == str(Path(secret_dir) / name))
        targets.add(target)
    # Engine inspection may report tmpfs separately in HostConfig only.
    for item in metadata.get('Mounts', []):
        if item.get('Type') == 'tmpfs':
            require(item.get('Destination') in ('/tmp', '/app/node_modules/.mf'))
            targets.add(item['Destination'])
    require(len(metadata.get('Mounts', [])) == len(targets)
            and {item.get('Destination') for item in metadata['Mounts']} == targets)



BANK_EMPTY = r"""
const fs = require('node:fs');
const root = '/var/lib/arthello-v52-tochka-activation';
const directory = fs.lstatSync(root);
if (!directory.isDirectory() || directory.uid !== 1002 || directory.gid !== 1000 ||
    (directory.mode & 0o777) !== 0o750) process.exit(1);
const names = fs.readdirSync(root);
if (names.length !== 1 || names[0] !== '.activation-volume-v2.seed') process.exit(1);
const seed = root + '/.activation-volume-v2.seed';
const info = fs.lstatSync(seed);
if (!info.isFile() || info.nlink !== 1 || info.uid !== 1002 || info.gid !== 1000 ||
    (info.mode & 0o777) !== 0o440 || fs.readFileSync(seed, 'utf8') !== 'ARTHELLO_TOCHKA_ACTIVATION_VOLUME_V2\n') process.exit(1);
"""


def verify_backup(context, docker):
    state.validate_adoption(context)
    own_path, accepted_path = state.adoption_paths(context)
    saved = accepted = None
    directory_fd = None
    try:
        saved = backup.StateFile(str(own_path))
        fcntl.flock(saved.fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        accepted = backup.StateFile(str(accepted_path))
        directory_fd = adoption.private_directory(own_path.parent.parent)
        subject = adoption.Adoption(state.adoption_args(context), docker, saved, accepted,
                                    adoption.DurableBoundary(directory_fd, context['releaseSha']))
        value = subject.load()
        require(value['phase'] == 'sealed' and value['sealed'] is True
                and adoption.digest(value) == context['backupAdoptionStateSha256'])
        result = subject.verify()  # Verification only: no seal, restore, cleanup or writes.
        require(adoption.digest(saved.load()) == context['backupAdoptionStateSha256'])
        state.validate_adoption(context)
        return result
    finally:
        for store in (saved, accepted):
            if store is not None:
                store.close()
        if directory_fd is not None:
            os.close(directory_fd)


def fingerprint(docker, identity):
    snapshot = docker.inspect('image', identity)
    require(snapshot.get('Id') == identity)
    canonical = command(['jq', '-cS', '-f', str(HERE.parent.parent / 'deploy/v52/maintenance/image-runtime-fingerprint.jq')],
                        input=json.dumps([snapshot]), maximum=65536)
    return snapshot, hashlib.sha256(canonical.encode()).hexdigest()


def verify(path, *, release, tree, run, attempt, durable_root, hold=False, docker=None, probe=True):
    record = state.load_state(path) if hold else state.resume_check(path, release, run, attempt)
    context = record['context']
    require(record['phase'] in ('maintenance-started', 'candidate-verified')
            and context['releaseSha'] == release and context['sourceTree'] == tree and context['runId'] == run
            and int(context['runAttempt']) <= int(attempt) and int(record['latestAttempt']) <= int(attempt))
    require(context['dataVolume'] == backup.SOURCE_VOLUME)
    require(state.absolute(str(path)).parent == Path.home() / '.config/arthello/release-state')
    for field, basename in [('originalRouteFile', 'external-routes.before.caddy'),
                            ('maintenanceRouteFile', 'external-routes.maintenance.caddy'),
                            ('publicRouteFile', 'external-routes.candidate.caddy'), ('gateNonceFile', 'candidate-gate.nonce')]:
        require(Path(context[field]).name == basename)
    work = state.absolute(context['workDirectory'])
    require(work.resolve() == work and work.parent == Path(durable_root).resolve()
            and work.parent == Path(path).parent / 'candidate-work'
            and work.name == 'arthello-deploy-' + run + '-' + context['runAttempt'])
    root_info = work.parent.stat()
    require(root_info.st_uid == os.geteuid() and stat.S_IMODE(root_info.st_mode) == 0o700)
    require(Path(context['schoolRepairReceiptFile']) == work / 'school-repair-receipt.json')
    info = work.stat()
    require(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700)
    public_state = Path(path).with_name('activation-' + release + '.json')
    require(not public_state.exists() and not public_state.is_symlink())
    for field, digest_field in [('originalRouteFile', 'originalRouteSha256'), ('maintenanceRouteFile', 'maintenanceRouteSha256'),
                                 ('publicRouteFile', 'publicRouteSha256')]:
        require(hashlib.sha256(raw_private(context[field])).hexdigest() == context[digest_field])
    require(re.fullmatch(rb'[a-f0-9]{64}\n?', raw_private(context['gateNonceFile'], 65)) is not None)
    docker = docker or Docker()
    image, computed = fingerprint(docker, context['imageId'])
    require(computed == context['runtimeFingerprint'] and image.get('Config', {}).get('User') == 'node')
    labels = image.get('Config', {}).get('Labels', {})
    require(labels.get('org.opencontainers.image.revision') == release
            and labels.get('org.opencontainers.image.source-tree') == tree)
    browser, computed = fingerprint(docker, context['browserImageId'])
    require(computed == context['browserFingerprint'] and browser.get('Config', {}).get('User') == '1000:1000')
    labels = browser.get('Config', {}).get('Labels', {})
    require(labels.get('org.opencontainers.image.revision') == release and labels.get('org.arthello.role') == 'e2e-browser')
    gateway = docker.inspect('container', 'stroios-caddy-1')
    gateway_evidence = state.validate_gateway(context)
    require(gateway.get('Id') == gateway_evidence['gatewayId'] and gateway.get('Image') == gateway_evidence['gatewayImageId'])
    networks = gateway.get('NetworkSettings', {}).get('Networks', {})
    require(gateway.get('State', {}).get('Running') is True and len(networks) == 1)
    validate_candidate(docker.inspect('container', context['candidateContainerId']), context,
                       network=next(iter(networks)), secret_dir=Path(path).parent.parent,
                       expected_entrypoint=image.get('Config', {}).get('Entrypoint'))
    require(docker.command(['ps', '--no-trunc', '--filter', 'name=^/arthello-direct-', '--format', '{{.ID}}']).splitlines()
            == [context['candidateContainerId']])
    previous = docker.inspect('container', context['previousContainerId'])
    require(previous.get('Id') == adoption.LIVE_APP_ID and previous.get('Image') == adoption.LIVE_IMAGE
            and previous.get('Config', {}).get('Labels', {}).get('arthello.release.sha') == adoption.LIVE_SHA
            and previous.get('Name') == '/' + context['previousName'] and previous.get('State', {}).get('Running') is False
            and previous['State'].get('Paused') is False and previous.get('HostConfig', {}).get('RestartPolicy', {}).get('Name') == 'no')
    require(mount(previous, '/data').get('Name') == context['dataVolume'])
    volume = docker.inspect('volume', context['rollbackVolume'])
    labels = volume.get('Labels', {})
    require(volume.get('Name') == context['rollbackVolume'] and volume.get('Driver') == 'local' and not volume.get('Options')
            and labels.get('arthello.release.sha') == release and labels.get('arthello.release.run') == run
            and labels.get('arthello.rollback.source-container') == context['previousContainerId']
            and labels.get('arthello.rollback.data-volume') == context['dataVolume'])
    verify_backup(context, docker)
    docker.command(['container', 'exec', context['candidateContainerId'], 'node', '-e', BANK_EMPTY])
    require(not docker.command(['ps', '-aq', '--filter', 'name=^/arthello-v52-activation-writer-' + context['runId'] + '-' + context['runAttempt'] + '$']))
    actual_route = command(['docker', 'container', 'exec', 'stroios-caddy-1', 'cat', '/data/external-routes.caddy'])
    require(hashlib.sha256(actual_route.encode()).hexdigest() == context['maintenanceRouteSha256'])
    command(['python3', '-I', str(HERE / 'd083-maintenance-route.py'), 'verify-gateway',
             '--input', context['originalRouteFile'], '--main-config', str(work / 'Caddyfile.before'),
             '--gateway-env-evidence', context['gatewayEvidenceFile']])
    if probe:
        command(['python3', '-I', str(HERE / 'd083-maintenance-route.py'), 'probe', '--nonce-file', context['gateNonceFile']])
    controller.canonical_consumers(state.adoption_args(context), docker, 'candidate')
    request = urllib.request.Request('https://api.github.com/repos/vitaliyozolin-dotcom/ArtHello-OS/git/ref/heads/main',
                                     headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read(65537)
    require(len(raw) <= 65536 and json.loads(raw)['object']['sha'] == release)
    return record


def repair_maintenance(path, **identity):
    # Only the already-installed exact maintenance route may be reloaded.
    # All runtime/state/source/bank checks precede this bounded route-only action.
    verify(path, **identity, hold=True, probe=False)
    command(['docker', 'container', 'exec', 'stroios-caddy-1', 'caddy', 'validate',
             '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])
    command(['docker', 'container', 'exec', 'stroios-caddy-1', 'caddy', 'reload',
             '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])
    return verify(path, **identity, hold=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state', required=True)
    parser.add_argument('--release', required=True)
    parser.add_argument('--tree', required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--attempt', required=True)
    parser.add_argument('--durable-root', required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--hold-check', action='store_true')
    mode.add_argument('--verify-maintenance', action='store_true')
    mode.add_argument('--repair-maintenance', action='store_true')
    args = parser.parse_args()
    try:
        identity = dict(release=args.release, tree=args.tree, run=args.run, attempt=args.attempt, durable_root=args.durable_root)
        if args.repair_maintenance:
            repair_maintenance(args.state, **identity)
        else:
            verify(args.state, **identity, hold=args.hold_check or args.verify_maintenance)
    except Exception:
        raise SystemExit('ARTHELLO_D080_RESUME_RUNTIME=BLOCKED')
    print('ARTHELLO_D080_CANDIDATE_MAINTENANCE_HELD=1' if args.hold_check or args.repair_maintenance else
          'ARTHELLO_D080_MAINTENANCE_RUNTIME=VERIFIED' if args.verify_maintenance else 'ARTHELLO_D080_RESUME_RUNTIME=VERIFIED')


if __name__ == '__main__':
    main()
