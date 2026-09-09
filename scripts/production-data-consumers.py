"""D075 readonly selection of an accepted R10 app, bound gateway and exact RO backup reader."""
import argparse
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from types import SimpleNamespace


def module(path):
    spec = importlib.util.spec_from_file_location('d075_r10_boundary', path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


boundary = module(Path(__file__).resolve().parents[1] / '.github/scripts/d083-resume-candidate.py')
gateway = module(Path(__file__).resolve().parents[1] / '.github/scripts/d083-maintenance-route.py')
backup = boundary.backup
VOLUME = backup.SOURCE_VOLUME


def require(value):
    if not value:
        raise ValueError('READONLY_BLOCKED=accepted_runtime_identity')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result


def read_private(path):
    raw = boundary.raw_private(path, 65536)
    result = json.loads(raw, object_pairs_hook=unique_object)
    require(isinstance(result, dict))
    return result


def validate_inventory(containers, *, expected_release, candidate_state, activation,
                       backup_state, image, caddy, secret_dir):
    require(isinstance(expected_release, str) and re.fullmatch('[a-f0-9]{40}', expected_release))
    require(all(isinstance(value, dict) for value in (candidate_state, activation, backup_state, image, caddy)))
    context = boundary.state.validate_context(candidate_state.get('context'))
    gateway_evidence = boundary.state.validate_gateway(context)
    require(candidate_state.get('schemaVersion') == 1 and candidate_state.get('phase') == 'public-started'
            and candidate_state.get('contextSha256') == boundary.state.digest(context)
            and re.fullmatch('[a-f0-9]{64}', candidate_state.get('acceptanceSha256', ''))
            and context['releaseSha'] == expected_release and context['dataVolume'] == VOLUME)
    latest = candidate_state.get('latestAttempt')
    require(isinstance(latest, str) and re.fullmatch('[1-9][0-9]*', latest)
            and int(latest) >= int(context['runAttempt']))
    require(activation.get('schemaVersion') == 1 and activation.get('state') == 'activation-started')
    for field in ('releaseSha', 'runId', 'candidateContainerId', 'previousContainerId',
                  'rollbackVolume', 'originalRouteSha256'):
        require(activation.get(field) == context[field])
    require(activation.get('runAttempt') == latest
            and activation.get('candidateRouteSha256') == context['publicRouteSha256'])
    activated = dt.datetime.fromisoformat(activation['observedAtUtc'].replace('Z', '+00:00'))
    require(activated.tzinfo is not None and activated <= dt.datetime.now(dt.timezone.utc))
    require(isinstance(containers, list) and len(containers) == 2
            and len({item.get('Id') for item in containers}) == 2)
    apps = [item for item in containers if item.get('Id') == context['candidateContainerId']]
    require(len(apps) == 1)
    app = apps[0]
    workers = [item for item in containers if item is not app]
    worker = workers[0]
    require(image.get('Id') == context['imageId']
            and image.get('Config', {}).get('User') == 'node'
            and image['Config'].get('Cmd') == ['node', 'production/runtime-server.mjs'])
    labels = image['Config'].get('Labels', {})
    require(labels.get('org.opencontainers.image.revision') == expected_release
            and labels.get('org.opencontainers.image.source-tree') == context['sourceTree'])
    require(caddy.get('Name') == '/stroios-caddy-1' and caddy.get('Id') == gateway_evidence['gatewayId']
            and caddy.get('Image') == gateway_evidence['gatewayImageId']
            and caddy.get('State', {}).get('Running') is True
            and caddy['State'].get('Paused') is False and caddy['State'].get('Restarting') is False)
    network = app.get('HostConfig', {}).get('NetworkMode')
    require(isinstance(network, str) and bool(network)
            and network in caddy.get('NetworkSettings', {}).get('Networks', {}))
    boundary.validate_candidate(app, context, network=network, secret_dir=secret_dir,
                                expected_entrypoint=image['Config'].get('Entrypoint'))
    app_labels = app['Config'].get('Labels', {})
    require(app_labels.get('arthello.release.tree') == context['sourceTree']
            and app_labels.get('arthello.release.run') == context['runId'])
    args = SimpleNamespace(image_id=context['imageId'], release_sha=context['releaseSha'],
                           tree_sha=context['sourceTree'], run_id=context['runId'],
                           attempt=context['runAttempt'], source_relative=backup.SOURCE_RELATIVE)
    runtime = backup.Runtime(args, None, None)
    runtime.state, runtime.image = backup_state, image
    require(backup_state.get('schemaVersion') == 1 and backup_state.get('state') == 'verified'
            and backup_state.get('pending') is None and backup_state.get('identity') == runtime.identity
            and re.fullmatch('[a-f0-9]{64}', backup_state.get('instance', '')))
    resources = backup_state.get('resources', [])
    expected = {('volume', 'backups'), ('volume', 'control'), ('volume', 'activation'),
                ('container', 'seed'), ('container', 'worker')}
    require(len(resources) == 5 and {(item.get('kind'), item.get('role')) for item in resources} == expected)
    for resource in resources:
        role = resource['role']
        require(resource.get('name') == runtime.names[role])
        if role == 'seed':
            require(resource.get('removed') is True)
        if role == 'worker':
            require(resource.get('id') == worker.get('Id'))
    require(runtime.names['worker'] == context['backupWorker']
            and runtime.names['backups'] == context['backupVolume']
            and runtime.names['control'] == context['backupControlVolume']
            and runtime.names['activation'] == context['bankActivationVolume'])
    try:
        runtime.verify_container(worker, 'worker', worker.get('Id'))
    except backup.Refused:
        raise ValueError('READONLY_BLOCKED=accepted_runtime_identity') from None
    require(worker.get('State', {}).get('Running') is True and worker['State'].get('Paused') is False)
    for container, writable in ((app, True), (worker, False)):
        mounts = [item for item in container.get('Mounts', []) if item.get('Name') == VOLUME]
        require(len(mounts) == 1 and mounts[0].get('Destination') == '/data'
                and mounts[0].get('Type') == 'volume' and mounts[0].get('RW') is writable)
    return dict(liveId=app['Id'], imageId=image['Id'], sourceSha=expected_release, backupId=worker['Id'])


class Docker:
    def command(self, arguments):
        # No exec/run/start/stop/update, shell, bank requests or diagnostic DB reads.
        require(arguments[:1] == ['ps'] or arguments[:2] in (['container', 'inspect'], ['image', 'inspect']))
        result = subprocess.run(['docker', *arguments], capture_output=True, text=True,
                                timeout=10, env={'PATH': os.environ.get('PATH', '')})
        require(result.returncode == 0 and len(result.stdout) + len(result.stderr) <= 1048576)
        return result.stdout

    def read_gateway_config(self, gateway_id, path):
        # The caller has already matched this full ID to the accepted gateway.
        # This fixed file read cannot reload Caddy, reach a bank or execute a shell.
        require(isinstance(gateway_id, str) and re.fullmatch('[a-f0-9]{64}', gateway_id))
        require(path in ('/etc/caddy/Caddyfile', '/data/external-routes.caddy'))
        result = subprocess.run(['docker', 'exec', gateway_id, 'cat', path],
                                capture_output=True, text=True, timeout=10,
                                env={'PATH': os.environ.get('PATH', '')})
        require(result.returncode == 0 and 0 < len(result.stdout.encode()) <= gateway.MAX_CONFIG
                and len(result.stderr.encode()) <= gateway.MAX_CONFIG)
        return result.stdout

    def inspect(self, kind, identity):
        values = json.loads(self.command([kind, 'inspect', identity]), object_pairs_hook=unique_object)
        require(isinstance(values, list) and len(values) == 1 and isinstance(values[0], dict))
        return values[0]


def observe(expected_release, state_dir, docker=None):
    require(isinstance(expected_release, str) and re.fullmatch('[a-f0-9]{40}', expected_release))
    directory = boundary.state.absolute(str(state_dir))
    info = directory.stat()
    require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == os.geteuid())
    state_path = directory / ('candidate-acceptance-' + expected_release + '.json')
    candidate = read_private(state_path)
    require(candidate == boundary.state.load_state(state_path))
    context = boundary.state.validate_context(candidate['context'])
    backup_path = directory / ('backup-runtime-' + context['runId'] + '-' + context['runAttempt']) / 'backup-runtime-state.json'
    require(context['backupRuntimeStateFile'] == str(backup_path))
    activation = read_private(directory / ('activation-' + expected_release + '.json'))
    saved = read_private(backup_path)
    docker = docker or Docker()
    ids = docker.command(['ps', '--no-trunc', '--filter', 'volume=' + VOLUME, '--format', '{{.ID}}']).splitlines()
    require(len(ids) == 2 and len(set(ids)) == 2 and all(re.fullmatch('[a-f0-9]{64}', value) for value in ids))
    result = validate_inventory([docker.inspect('container', value) for value in ids], expected_release=expected_release,
                                candidate_state=candidate, activation=activation, backup_state=saved,
                                image=docker.inspect('image', context['imageId']),
                                caddy=docker.inspect('container', 'stroios-caddy-1'), secret_dir=directory.parent)
    evidence = boundary.state.validate_gateway(context)
    main_source = boundary.raw_private(Path(context['workDirectory']) / 'Caddyfile.before').decode('utf-8')
    external_source = boundary.raw_private(context['originalRouteFile']).decode('utf-8')

    def gateway_read(arguments):
        if arguments == ['container', 'inspect', evidence['gatewayId']]:
            return json.dumps([docker.inspect('container', evidence['gatewayId'])])
        require(arguments in (['exec', evidence['gatewayId'], 'cat', '/etc/caddy/Caddyfile'],
                              ['exec', evidence['gatewayId'], 'cat', '/data/external-routes.caddy']))
        return docker.read_gateway_config(evidence['gatewayId'], arguments[-1])

    def current_gateway(identity):
        observed = gateway.observe_gateway(identity, include_external=True, read=gateway_read)
        require(observed.pop('externalRoutesSha256') == context['publicRouteSha256'])
        return observed

    gateway.verify_gateway_evidence(main_source, external_source, evidence,
                                   observe=current_gateway)
    # The same consumers must still be present after the bounded metadata checks.
    require(sorted(docker.command(['ps', '--no-trunc', '--filter', 'volume=' + VOLUME, '--format', '{{.ID}}']).splitlines()) == sorted(ids))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--expected-release', required=True)
    parser.add_argument('--release-state-dir', required=True)
    args = parser.parse_args()
    try:
        result = observe(args.expected_release, args.release_state_dir)
    except Exception:
        raise SystemExit('READONLY_BLOCKED=accepted_runtime_identity')
    print(json.dumps(result, separators=(',', ':')))


if __name__ == '__main__':
    main()
