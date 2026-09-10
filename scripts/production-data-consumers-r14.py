"""D075 read-only proof for the accepted R17 app and its adopted R12 backup reader.

The filename stays stable because R17 deliberately retains the R14 durable-state
schema. Release identity is bound to the actual successful R17 receipts.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from types import ModuleType

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_SOURCE = 'ff8559254faaedade63a9ee7567a45686d08c13a'
EXPECTED_TREE = '6aeb7e6879b786a434d12f026f765bcaf9acb5a4'
ACCEPTED_PINS = {'runId': '34495273615', 'resourceAttempt': '1', 'acceptedAttempt': '1', 'imageId': 'sha256:34402014063a05c81754716f46b3f9059297f1d21d37da7e5f00b1eb8f7fdd46', 'runtimeFingerprint': 'a97c538504d68613ed29d9de1230cf2ab23fc905207d6806d24a35f1d3e79bff', 'candidateContainerId': '9909bd54d31244627477bd60c3b8e7cc6cd84758902943e54eb555206c4a1142', 'contextSha256': '5343207eb2f8f7769b1c2a4d9b56222ffe645eb2cfe2b18a7e7db0269b843215'}


def require(value):
    if not value:
        raise ValueError('READONLY_BLOCKED=accepted_r17_runtime_identity')


def checked_module(name, relative, expected):
    path = ROOT / relative
    source = path.read_bytes()
    require(not path.is_symlink() and hashlib.sha256(source).hexdigest() == expected)
    result = ModuleType(name)
    result.__file__ = str(path)
    exec(compile(source, str(path), 'exec'), result.__dict__)
    return result


boundary = checked_module('d075_r14_boundary', '.github/scripts/r17-resume-candidate.py',
                          'adbf4a18820006503c29511630379cb19fe872ade99d5dc3050f9b083ed790f1')
gateway = checked_module('d075_r14_gateway', '.github/scripts/d083-maintenance-route.py',
                         'f669e1889be6f31ddb88fbdb5316a07bdfa9dcd0cae3cf82ae429e7235363276')
state, controller = boundary.state, boundary.controller
adoption = state.adoption
VOLUME = adoption.r7.SOURCE_VOLUME
FINGERPRINT = ROOT / 'deploy/v52/maintenance/image-runtime-fingerprint.jq'
require(hashlib.sha256(FINGERPRINT.read_bytes()).hexdigest() ==
        '6c39aba7adaf25a48d0882443c56d4741af65cca2785f4fcaedd5e11f132e041')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result


def read_private(path):
    result = json.loads(boundary.raw_private(path, 65536), object_pairs_hook=unique_object)
    require(isinstance(result, dict))
    return result


def accepted_pins():
    patterns = {'runId': r'[1-9][0-9]*', 'resourceAttempt': r'[1-9][0-9]*',
                'acceptedAttempt': r'[1-9][0-9]*', 'imageId': r'sha256:[a-f0-9]{64}',
                'runtimeFingerprint': r'[a-f0-9]{64}', 'candidateContainerId': r'[a-f0-9]{64}',
                'contextSha256': r'[a-f0-9]{64}'}
    require(set(ACCEPTED_PINS) == set(patterns))
    for key, pattern in patterns.items():
        require(isinstance(ACCEPTED_PINS[key], str) and re.fullmatch(pattern, ACCEPTED_PINS[key]))
    require(1 <= int(ACCEPTED_PINS['resourceAttempt']) <= int(ACCEPTED_PINS['acceptedAttempt']) <= 50)
    return dict(ACCEPTED_PINS)


class Docker(controller.Docker):
    """The inherited facade refuses mutations; only two fixed gateway reads are added."""
    def bind_gateway(self, identity):
        require(isinstance(identity, str) and re.fullmatch('[a-f0-9]{64}', identity))
        require(getattr(self, 'gateway_id', identity) == identity)
        self.gateway_id = identity

    def read_gateway_config(self, gateway_id, path):
        require(gateway_id == getattr(self, 'gateway_id', None)
                and path in ('/etc/caddy/Caddyfile', '/data/external-routes.caddy'))
        result = subprocess.run(['docker', 'exec', gateway_id, 'cat', path], capture_output=True,
                                text=True, timeout=10, env={'PATH': os.environ.get('PATH', '')})
        require(result.returncode == 0 and 0 < len(result.stdout.encode()) <= gateway.MAX_CONFIG
                and len(result.stderr.encode()) <= gateway.MAX_CONFIG)
        return result.stdout


def public_state(directory, expected_release, pins):
    path = directory / ('candidate-acceptance-' + expected_release + '.json')
    record = read_private(path)
    require(record == state.load_state(path))
    context = record['context']
    require(record.get('schemaVersion') == 1 and record.get('phase') == 'public-started'
            and record.get('contextSha256') == pins['contextSha256'] == state.digest(context)
            and record.get('latestAttempt') == pins['acceptedAttempt']
            and re.fullmatch('[a-f0-9]{64}', record.get('acceptanceSha256', ''))
            and context['releaseSha'] == expected_release == EXPECTED_SOURCE
            and context['sourceTree'] == EXPECTED_TREE and context['dataVolume'] == VOLUME
            and context['runId'] == pins['runId'] and context['runAttempt'] == pins['resourceAttempt']
            and context['imageId'] == pins['imageId']
            and context['runtimeFingerprint'] == pins['runtimeFingerprint']
            and context['candidateContainerId'] == pins['candidateContainerId'])
    require(Path(context['workDirectory']).parent == directory / 'candidate-work'
            and state.adoption_paths(context)[0].parent.parent == directory)
    active = read_private(directory / ('activation-' + expected_release + '.json'))
    require(active.get('schemaVersion') == 1 and active.get('state') == 'activation-started'
            and active.get('runAttempt') == pins['acceptedAttempt']
            and active.get('candidateRouteSha256') == context['publicRouteSha256']
            and active.get('diagnosticDirectory') == str(directory / 'public-audit' /
                ('arthello-deploy-' + context['runId'] + '-' + pins['acceptedAttempt'])))
    for key in ('releaseSha', 'runId', 'candidateContainerId', 'previousContainerId',
                'rollbackVolume', 'originalRouteSha256'):
        require(active.get(key) == context[key])
    observed = dt.datetime.fromisoformat(active['observedAtUtc'].replace('Z', '+00:00'))
    require(observed.tzinfo is not None and observed <= dt.datetime.now(dt.timezone.utc))
    return record, active


def runtime_metadata(context, directory, docker):
    image, fingerprint = boundary.fingerprint(docker, context['imageId'])
    require(fingerprint == context['runtimeFingerprint']
            and image.get('Config', {}).get('User') == 'node'
            and image['Config'].get('Cmd') == ['node', 'production/runtime-server.mjs'])
    labels = image['Config'].get('Labels', {})
    require(labels.get('org.opencontainers.image.revision') == EXPECTED_SOURCE
            and labels.get('org.opencontainers.image.source-tree') == EXPECTED_TREE)
    evidence = state.validate_gateway(context)
    caddy = docker.inspect('container', 'stroios-caddy-1')
    require(caddy.get('Name') == '/stroios-caddy-1' and caddy.get('Id') == evidence['gatewayId']
            and caddy.get('Image') == evidence['gatewayImageId']
            and caddy.get('State', {}).get('Running') is True
            and caddy['State'].get('Paused') is False and caddy['State'].get('Restarting') is False)
    app = docker.inspect('container', context['candidateContainerId'])
    network = app.get('HostConfig', {}).get('NetworkMode')
    require(isinstance(network, str) and network in caddy.get('NetworkSettings', {}).get('Networks', {}))
    boundary.validate_candidate(app, context, network=network, secret_dir=directory.parent,
                                expected_entrypoint=image['Config'].get('Entrypoint'))
    app_labels = app['Config'].get('Labels', {})
    require(app_labels.get('arthello.release.tree') == context['sourceTree']
            and app_labels.get('arthello.release.run') == context['runId']
            and app['State'].get('Restarting') is False and app['State'].get('Dead', False) is False)
    docker.bind_gateway(evidence['gatewayId'])
    return evidence


def public_gateway(context, evidence, docker):
    main_source = boundary.raw_private(Path(context['workDirectory']) / 'Caddyfile.before').decode('utf-8')
    external_source = boundary.raw_private(context['originalRouteFile']).decode('utf-8')
    def read(arguments):
        if arguments == ['container', 'inspect', evidence['gatewayId']]:
            return json.dumps([docker.inspect('container', evidence['gatewayId'])])
        require(arguments in (['exec', evidence['gatewayId'], 'cat', '/etc/caddy/Caddyfile'],
                              ['exec', evidence['gatewayId'], 'cat', '/data/external-routes.caddy']))
        return docker.read_gateway_config(evidence['gatewayId'], arguments[-1])
    def observe(identity):
        current = gateway.observe_gateway(identity, include_external=True, read=read)
        require(current.pop('externalRoutesSha256') == context['publicRouteSha256'])
        return current
    gateway.verify_gateway_evidence(main_source, external_source, evidence, observe=observe)


def observe(expected_release, state_dir, docker=None):
    require(expected_release == EXPECTED_SOURCE)
    pins = accepted_pins()
    directory = state.absolute(str(state_dir))
    require(directory == Path.home() / '.config/arthello/release-state' and directory.resolve() == directory)
    info = directory.stat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700)
    record, activation = public_state(directory, expected_release, pins)
    context = record['context']
    docker = docker or Docker()
    args = state.adoption_args(context)
    with controller.opened(args, docker) as (subject, own, _):
        value = controller.loaded(subject, sealed=True)
        require(adoption.digest(value) == context['backupAdoptionStateSha256'])
        subject.verify()  # Read-only worker health/identity; never seal/restore/cleanup.
        consumers = controller.canonical_consumers(args, docker, 'candidate')
        evidence = runtime_metadata(context, directory, docker)
        public_gateway(context, evidence, docker)
        # No maintenance/BANK_EMPTY precondition: public V2 activation is expected here.
        require(public_state(directory, expected_release, pins) == (record, activation))
        state.validate_adoption(context)
        require(adoption.digest(own.load()) == context['backupAdoptionStateSha256'])
        require(controller.canonical_consumers(args, docker, 'candidate') == consumers)
        require(runtime_metadata(context, directory, docker) == evidence)
        subject.running()  # Final exact accepted worker running/restart-policy check.
        proof = dict(candidateState=record, activationState=activation,
                     backupAdoptionStateSha256=context['backupAdoptionStateSha256'],
                     canonicalConsumers=sorted(consumers))
        proof_hash = hashlib.sha256(json.dumps(proof, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return dict(liveId=context['candidateContainerId'], imageId=context['imageId'],
                sourceSha=expected_release, backupId=adoption.ACCEPTED_WORKER_ID, proofSha256=proof_hash)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--expected-release', required=True)
    parser.add_argument('--release-state-dir', required=True)
    args = parser.parse_args()
    try:
        result = observe(args.expected_release, args.release_state_dir)
    except Exception:
        raise SystemExit('READONLY_BLOCKED=accepted_r17_runtime_identity') from None
    print(json.dumps(result, separators=(',', ':')))


if __name__ == '__main__':
    main()
