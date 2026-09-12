#!/usr/bin/env python3
"""Read-only fixed-R12 backup facts for the R14 shell controller."""
import argparse
from contextlib import contextmanager
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from types import ModuleType


def checked_module():
    path = Path(__file__).with_name('r18-backup-adoption.py')
    source = path.read_bytes()
    if hashlib.sha256(source).hexdigest() != 'b58fd745bb0ee3b8acdfcdbc4441179d5fc01891e0c880f2e57b977150f8cd90':
        raise RuntimeError('R14_ADOPTION_DEPENDENCY_DRIFT')
    module = ModuleType('r14_controller_adoption')
    module.__file__ = str(path)
    exec(compile(source, str(path), 'exec'), module.__dict__)
    return module


def checked_history():
    path = Path(__file__).with_name('r16-backup-controller.py')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != '50d0747430330922fd02396b08b388feabab38076e68dc3abc41fa6384766444':
        raise RuntimeError('FROZEN_R13_CHAIN_DRIFT')
    module = ModuleType('r16_preserved_r13_chain')
    module.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


historical = checked_history()
adoption = checked_module()
r7, require = adoption.r7, adoption.require
PHASES = ('live', 'live-paused', 'stopped', 'candidate', 'candidate-paused', 'copyback')
# Bound by accepted R12's schema-3 natural-browser receipt, run 34326582961/attempt 1.
# This is the D083 compact sorted context digest WITH its trailing newline.
ACCEPTED_CONTEXT_SHA256 = '631487a8b31e3efb8b6956dab77ac9a0c476166f1050ca586df88f35a9b375a4'
PREDECESSOR_SOURCE = '6596f69390ad539577ec2640e8ef40c7e12c22dc'
LIVE_CONTEXT_SHA256 = '5343207eb2f8f7769b1c2a4d9b56222ffe645eb2cfe2b18a7e7db0269b843215'


class Docker(r7.Docker):
    """Fail closed if a reused verifier ever attempts a mutation."""
    def run(self, args, timeout=30):
        inspect = len(args) == 3 and args[0] in ('container', 'volume', 'image') and args[1] == 'inspect'
        inventory = len(args) == 7 and args[:6] == ['container', 'ls', '--all', '--quiet', '--no-trunc', '--filter']
        probe = args == ['container', 'exec', adoption.ACCEPTED_WORKER_ID, 'python3', '-I',
                         '/opt/arthello-backup/probe.py', '--require-initial-verified']
        require(inspect or inventory or probe, 'READ_ONLY_DOCKER_REQUIRED')
        result = subprocess.run(['docker', *args], capture_output=True, text=True,
                                timeout=min(timeout, 20), check=False,
                                env={'PATH': os.environ.get('PATH', '')})
        require(len(result.stdout) + len(result.stderr) <= 1048576, 'DOCKER_OUTPUT_LIMIT')
        return result


class ReadOnlyState(r7.StateFile):
    def write(self, value):
        raise r7.Refused('READ_ONLY_STATE_REQUIRED')


class AbsentState:
    def load(self):
        return None

    def write(self, value):
        raise r7.Refused('READ_ONLY_STATE_REQUIRED')


@contextmanager
def opened(args, docker):
    # This path cannot be selected by a context file or command-line argument.
    root = Path.home() / '.config/arthello/release-state'
    directory = adoption.private_directory(root)
    own = accepted = None
    try:
        boundary = adoption.DurableBoundary(directory, args.release_sha)
        own_name = 'backup-adoption-r14-' + args.run_id + '-' + args.attempt
        try:
            metadata = os.stat(own_name, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            own = AbsentState()
        else:
            require(stat.S_ISDIR(metadata.st_mode), 'ADOPTION_DIRECTORY_INVALID')
            own = ReadOnlyState(str(root / own_name / 'backup-runtime-state.json'))
            require((os.fstat(own.fd).st_dev, os.fstat(own.fd).st_ino) == (metadata.st_dev, metadata.st_ino),
                    'ADOPTION_DIRECTORY_CHANGED')
            fcntl.flock(own.fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
            # A directory left without a record is an ambiguous interrupted prepare.
            require(own.load() is not None, 'ADOPTION_RECORD_MISSING')
        accepted = ReadOnlyState(str(root / ('backup-runtime-' + adoption.ACCEPTED_RUN + '-1') / 'backup-runtime-state.json'))
        subject = adoption.Adoption(args, docker, own, accepted, boundary)
        yield subject, own, boundary
    finally:
        for store in (own, accepted):
            if isinstance(store, ReadOnlyState):
                store.close()
        os.close(directory)


def loaded(subject, sealed=False):
    value = subject.load()  # Actual approved identity/resource validation and image inspection.
    owned = value['owned']
    require(owned.get('state') in ('preparing', 'verified', 'cleaned'), 'OWNED_STATE_INVALID')
    require(owned.get('pending') is None or isinstance(owned['pending'], dict), 'OWNED_PENDING_INVALID')
    for item in owned['resources']:
        require('removed' not in item or type(item['removed']) is bool, 'OWNED_REMOVAL_INVALID')
        if item['role'] == 'seed':
            require(re.fullmatch(r'[a-f0-9]{64}', item.get('id', '')), 'OWNED_SEED_INVALID')
        else:
            require(isinstance(item.get('createdAt'), str) and item['createdAt'], 'OWNED_ACTIVATION_INVALID')
    if value['phase'] != 'preparing':
        records = {item['role']: item for item in owned['resources']}
        require(set(records) == {'activation', 'seed'} and owned.get('pending') is None
                and records['seed'].get('removed') is True, 'OWNED_COMPLETION_INVALID')
        cleaned = value['phase'] == 'cleaned'
        require(owned['state'] == ('cleaned' if cleaned else 'verified')
                and bool(records['activation'].get('removed')) is cleaned, 'OWNED_COMPLETION_INVALID')
    proof = value.get('backupAtAdoption')
    require(isinstance(proof, dict) and set(proof) == {'initialBackupId', 'lastVerifiedBackupId', 'historyCount', 'nextAt'}
            and isinstance(proof['initialBackupId'], str) and proof['initialBackupId']
            and isinstance(proof['lastVerifiedBackupId'], str)
            and re.fullmatch(r'[A-Za-z0-9._:-]{1,160}', proof['lastVerifiedBackupId'])
            and type(proof['historyCount']) is int and proof['historyCount'] >= 1, 'ADOPTION_HEALTH_INVALID')
    require(datetime.datetime.fromisoformat(proof['nextAt'].replace('Z', '+00:00')).tzinfo is not None,
            'ADOPTION_SCHEDULE_INVALID')
    require((value['phase'] == 'sealed') is value['sealed'], 'ADOPTION_SEAL_AMBIGUOUS')
    if sealed:
        require(value['phase'] == 'sealed' and value['sealed'] is True, 'SEALED_ADOPTION_REQUIRED')
    return value


def boundary_result(args, docker):
    try:
        with opened(args, docker) as (subject, own, boundary):
            if boundary():
                return {'state': 'preserve'}
            value = own.load()
            if value is not None:
                if not isinstance(value, dict) or value.get('phase') == 'sealed' or value.get('sealed') is True:
                    return {'state': 'preserve'}
                before = adoption.digest(loaded(subject))
                subject.accepted()  # Read-only; a quiesced worker is allowed at this boundary.
                require(adoption.digest(own.load()) == before, 'ADOPTION_STATE_CHANGED')
            # Recheck the durable markers after all reads. Outer production locks remain mandatory.
            return {'state': 'preserve' if boundary() else 'open'}
    except Exception:
        return {'state': 'preserve'}


def app_metadata(item, *, identity, name, image, release, running, paused):
    require(item.get('Id') == identity and re.fullmatch(r'[a-f0-9]{64}', identity)
            and item.get('Name') == '/' + name and item.get('Image') == image
            and item.get('Config', {}).get('Labels', {}).get('arthello.release.sha') == release,
            'APP_IDENTITY_INVALID')
    state = item.get('State', {})
    require(state.get('Running') is running and state.get('Paused') is paused
            and state.get('Restarting', False) is False and state.get('Dead', False) is False,
            'APP_STATE_INVALID')
    if not running:
        require(item.get('HostConfig', {}).get('RestartPolicy') == {'Name': 'no', 'MaximumRetryCount': 0},
                'STOPPED_APP_RESTART_INVALID')
    mounts = item.get('Mounts', [])
    canonical = [m for m in mounts if m.get('Name') == r7.SOURCE_VOLUME or m.get('Destination') == '/data']
    require(len(canonical) == 1 and canonical[0].get('Type') == 'volume'
            and canonical[0].get('Name') == r7.SOURCE_VOLUME and canonical[0].get('Destination') == '/data'
            and canonical[0].get('RW') is True, 'APP_CANONICAL_MOUNT_INVALID')


def private_json(directory, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=directory)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid()
                and stat.S_IMODE(before.st_mode) == 0o600 and before.st_nlink == 1
                and 0 < before.st_size <= 65536, 'HISTORICAL_STATE_UNTRUSTED')
        raw = os.read(fd, 65537)
        after = os.fstat(fd)
        current = os.stat(name, dir_fd=directory, follow_symlinks=False)
        require((before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns, before.st_size)
                == (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns, len(raw))
                and (current.st_dev, current.st_ino) == (after.st_dev, after.st_ino), 'HISTORICAL_STATE_CHANGED')
        return json.loads(raw)
    finally:
        os.close(fd)


def historical_predecessor(docker):
    root = Path.home() / '.config/arthello/release-state'
    directory = adoption.private_directory(root)
    try:
        saved = private_json(directory, 'candidate-acceptance-' + adoption.ACCEPTED_SHA + '.json')
    finally:
        os.close(directory)
    require(isinstance(saved, dict) and saved.get('schemaVersion') == 1
            and saved.get('phase') == 'public-started', 'ACCEPTED_BOUNDARY_REQUIRED')
    context = saved.get('context')
    require(isinstance(context, dict), 'ACCEPTED_CONTEXT_REQUIRED')
    digest = hashlib.sha256((json.dumps(context, sort_keys=True, separators=(',', ':')) + '\n').encode()).hexdigest()
    require(digest == ACCEPTED_CONTEXT_SHA256 and saved.get('contextSha256') == digest,
            'ACCEPTED_CONTEXT_RECEIPT_MISMATCH')
    old_key = adoption.ACCEPTED_RUN + '-1'
    work = root / 'candidate-work' / ('arthello-deploy-' + old_key)
    expected = {'releaseSha': adoption.ACCEPTED_SHA, 'sourceTree': adoption.ACCEPTED_TREE,
                'runId': adoption.ACCEPTED_RUN, 'runAttempt': '1',
                'candidateContainerId': adoption.ACCEPTED_APP_ID, 'candidateName': 'arthello-direct-' + old_key,
                'imageId': adoption.ACCEPTED_IMAGE, 'dataVolume': r7.SOURCE_VOLUME,
                'backupWorker': 'arthello-v52-backup-worker-' + old_key,
                'backupVolume': 'arthello-v52-backups-' + old_key,
                'backupControlVolume': 'arthello-v52-backup-control-' + old_key,
                'bankActivationVolume': 'arthello-v52-tochka-activation-' + old_key,
                'backupRuntimeStateFile': str(root / ('backup-runtime-' + old_key) / 'backup-runtime-state.json'),
                'workDirectory': str(work)}
    for field, name in [('originalRouteFile', 'external-routes.before.caddy'),
                        ('maintenanceRouteFile', 'external-routes.maintenance.caddy'),
                        ('publicRouteFile', 'external-routes.candidate.caddy'), ('gateNonceFile', 'candidate-gate.nonce'),
                        ('gatewayEvidenceFile', 'gateway-evidence.json'), ('schoolRepairReceiptFile', 'school-repair-receipt.json')]:
        expected[field] = str(work / name)
    require(all(context.get(key) == value for key, value in expected.items()), 'ACCEPTED_CONTEXT_IDENTITY_INVALID')
    identity, name = context.get('previousContainerId'), context.get('previousName')
    require(isinstance(identity, str) and re.fullmatch(r'[a-f0-9]{64}', identity)
            and identity not in (adoption.ACCEPTED_APP_ID, adoption.ACCEPTED_WORKER_ID)
            and isinstance(name, str) and re.fullmatch(r'arthello-direct-[A-Za-z0-9][A-Za-z0-9_.-]{0,120}', name)
            and name != 'arthello-direct-' + old_key, 'PREDECESSOR_CONTEXT_INVALID')
    # Name is read exclusively from the receipt-pinned context; it is never a selector.
    item = docker.inspect('container', name, True)
    if item is None:
        return None
    image = item.get('Image', '')
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', image), 'PREDECESSOR_IMAGE_INVALID')
    app_metadata(item, identity=identity, name=name, image=image, release=PREDECESSOR_SOURCE, running=False, paused=False)
    metadata = docker.inspect('image', image)
    require(metadata.get('Id') == image
            and metadata.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') == PREDECESSOR_SOURCE,
            'PREDECESSOR_IMAGE_SOURCE_INVALID')
    forbidden = ('arthello-v52-backups-', 'arthello-v52-backup-control-')
    destinations = {r7.DIRECTORIES['backups'], r7.DIRECTORIES['control'], '/history'}
    for mount in item.get('Mounts', []):
        require(not str(mount.get('Name', '')).startswith(forbidden)
                and mount.get('Destination') not in destinations, 'PREDECESSOR_BACKUP_MOUNT_FORBIDDEN')
    for mount in item.get('HostConfig', {}).get('Mounts', []):
        require(not str(mount.get('Source', '')).startswith(forbidden)
                and mount.get('Target') not in destinations, 'PREDECESSOR_BACKUP_MOUNT_FORBIDDEN')
    return identity


def retained_live_candidate(docker):
    """Prove Atlas's retained, stopped R17 container through the exact R17 public context."""
    root = Path.home() / '.config/arthello/release-state'
    directory = adoption.private_directory(root)
    try:
        saved = private_json(directory, 'candidate-acceptance-' + adoption.LIVE_SHA + '.json')
    finally:
        os.close(directory)
    require(isinstance(saved, dict) and saved.get('schemaVersion') == 1
            and saved.get('phase') == 'public-started', 'LIVE_BOUNDARY_REQUIRED')
    context = saved.get('context')
    require(isinstance(context, dict), 'LIVE_CONTEXT_REQUIRED')
    digest = hashlib.sha256((json.dumps(context, sort_keys=True, separators=(',', ':')) + '\n').encode()).hexdigest()
    require(digest == LIVE_CONTEXT_SHA256 and saved.get('contextSha256') == digest,
            'LIVE_CONTEXT_RECEIPT_MISMATCH')
    expected = {'releaseSha': adoption.LIVE_SHA, 'sourceTree': adoption.LIVE_TREE,
                'runId': adoption.LIVE_STATE_RUN, 'runAttempt': '1',
                'candidateContainerId': adoption.LIVE_STATE_APP_ID,
                'candidateName': 'arthello-direct-' + adoption.LIVE_STATE_RUN + '-1',
                'imageId': adoption.LIVE_IMAGE, 'dataVolume': r7.SOURCE_VOLUME,
                'previousContainerId': historical.adoption.LIVE_APP_ID,
                'previousName': 'arthello-direct-' + historical.adoption.LIVE_RUN + '-1'}
    require(all(context.get(key) == value for key, value in expected.items()), 'LIVE_CONTEXT_IDENTITY_INVALID')
    retained_name = context['candidateName']
    item = docker.inspect('container', retained_name, True)
    if item is None:
        return None
    app_metadata(item, identity=adoption.LIVE_STATE_APP_ID, name=retained_name,
                 image=adoption.LIVE_IMAGE, release=adoption.LIVE_SHA, running=False, paused=False)
    image = docker.inspect('image', adoption.LIVE_IMAGE)
    require(image.get('Id') == adoption.LIVE_IMAGE
            and image.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') == adoption.LIVE_SHA,
            'PREDECESSOR_IMAGE_SOURCE_INVALID')
    # Atlas recreated the live R17 container without deleting the exact stopped
    # candidate recorded by R17. The frozen chain below separately proves older
    # historical consumers. All mounts are rechecked by the adoption verifier.
    return adoption.LIVE_STATE_APP_ID


def accepted_live_predecessor(docker):
    """Prove the retained R15 predecessor through R17's exact public context."""
    root = Path.home() / '.config/arthello/release-state'
    directory = adoption.private_directory(root)
    try:
        saved = private_json(directory, 'candidate-acceptance-' + adoption.LIVE_SHA + '.json')
    finally:
        os.close(directory)
    require(isinstance(saved, dict) and saved.get('schemaVersion') == 1
            and saved.get('phase') == 'public-started', 'LIVE_BOUNDARY_REQUIRED')
    context = saved.get('context')
    require(isinstance(context, dict), 'LIVE_CONTEXT_REQUIRED')
    digest = hashlib.sha256((json.dumps(context, sort_keys=True, separators=(',', ':')) + '\n').encode()).hexdigest()
    require(digest == LIVE_CONTEXT_SHA256 and saved.get('contextSha256') == digest,
            'LIVE_CONTEXT_RECEIPT_MISMATCH')
    expected = {'releaseSha': adoption.LIVE_SHA, 'sourceTree': adoption.LIVE_TREE,
                'runId': adoption.LIVE_STATE_RUN, 'runAttempt': '1',
                'candidateContainerId': adoption.LIVE_STATE_APP_ID,
                'candidateName': 'arthello-direct-' + adoption.LIVE_STATE_RUN + '-1',
                'imageId': adoption.LIVE_IMAGE, 'dataVolume': r7.SOURCE_VOLUME,
                'previousContainerId': historical.adoption.LIVE_APP_ID,
                'previousName': 'arthello-direct-' + historical.adoption.LIVE_RUN + '-1'}
    require(all(context.get(key) == value for key, value in expected.items()), 'LIVE_CONTEXT_IDENTITY_INVALID')
    item = docker.inspect('container', expected['previousName'], True)
    if item is None:
        return None
    app_metadata(item, identity=historical.adoption.LIVE_APP_ID, name=expected['previousName'],
                 image=historical.adoption.LIVE_IMAGE, release=historical.adoption.LIVE_SHA,
                 running=False, paused=False)
    image = docker.inspect('image', historical.adoption.LIVE_IMAGE)
    require(image.get('Id') == historical.adoption.LIVE_IMAGE
            and image.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') == historical.adoption.LIVE_SHA,
            'PREDECESSOR_IMAGE_SOURCE_INVALID')
    return historical.adoption.LIVE_APP_ID


def canonical_consumers(args, docker, phase):
    """Shared read-only inventory check; caller separately verifies the backup service."""
    require(phase in PHASES, 'CONSUMER_PHASE_INVALID')
    adoption.Adoption(args, None, None, None, None)
    old = docker.inspect('container', adoption.LIVE_APP_ID)
    app_metadata(old, identity=adoption.LIVE_APP_ID, name='arthello-direct-' + adoption.LIVE_RUN + '-1',
                 image=adoption.LIVE_IMAGE, release=adoption.LIVE_SHA,
                 running=phase in ('live', 'live-paused'), paused=phase == 'live-paused')
    expected = {adoption.LIVE_APP_ID, adoption.ACCEPTED_WORKER_ID}
    if phase in ('candidate', 'candidate-paused'):
        name = 'arthello-direct-' + args.run_id + '-' + args.attempt
        new = docker.inspect('container', name)
        identity = new.get('Id', '')
        require(re.fullmatch(r'[a-f0-9]{64}', identity) and identity not in expected, 'CANDIDATE_ID_INVALID')
        app_metadata(new, identity=identity, name=name, image=args.image_id, release=args.release_sha,
                     running=True, paused=phase == 'candidate-paused')
        expected.add(identity)
    actual = adoption.ids(docker.command(['container', 'ls', '--all', '--quiet', '--no-trunc',
                                          '--filter', 'volume=' + r7.SOURCE_VOLUME]))
    if actual == expected:
        # Exact all-container inventory proves no historical canonical consumer remains.
        # No historical evidence is needed to authorize an absent extra consumer.
        return actual
    require(expected < actual, 'EXPECTED_CANONICAL_CONSUMERS_MISSING')
    require(len(actual - expected) <= 5, 'UNPROVEN_CANONICAL_CONSUMER_COUNT_EXCEEDED')
    try:
        previous = retained_live_candidate(docker)
    except Exception:
        raise r7.Refused('RETAINED_R17_PROOF_FAILED') from None
    if previous is not None:
        require(previous in actual and previous not in expected, 'PREDECESSOR_NOT_PROVEN')
        expected.add(previous)
    if actual != expected:
        try:
            previous = accepted_live_predecessor(docker)
        except Exception:
            raise r7.Refused('R17_PREDECESSOR_PROOF_FAILED') from None
        if previous is not None:
            require(previous in actual and previous not in expected, 'PREDECESSOR_NOT_PROVEN')
            expected.add(previous)
    if actual != expected:
        try:
            ancestor = historical.accepted_live_predecessor(docker)
        except Exception:
            raise r7.Refused('R15_PREDECESSOR_PROOF_FAILED') from None
        if ancestor is not None:
            require(ancestor in actual and ancestor not in expected, 'PREDECESSOR_NOT_PROVEN')
            expected.add(ancestor)
    if actual != expected:
        try:
            ancestor = historical.historical.accepted_live_predecessor(docker)
        except Exception:
            raise r7.Refused('R13_PREDECESSOR_PROOF_FAILED') from None
        if ancestor is not None:
            require(ancestor in actual and ancestor not in expected, 'PREDECESSOR_NOT_PROVEN')
            expected.add(ancestor)
    if actual != expected:
        try:
            ancestor = historical.historical.historical_predecessor(docker)
        except Exception:
            raise r7.Refused('R12_PREDECESSOR_PROOF_FAILED') from None
        require(ancestor is not None and ancestor in actual and ancestor not in expected, 'PREDECESSOR_NOT_PROVEN')
        expected.add(ancestor)
    require(actual == expected, 'CANONICAL_CONSUMERS_INVALID')
    return actual


def consumers(args, docker):
    require(args.phase in PHASES, 'CONSUMER_PHASE_INVALID')
    with opened(args, docker) as (subject, own, _):
        before = None
        if own.load() is not None:
            before = adoption.digest(loaded(subject))
        # Prove the complete canonical D1 chain before allowing the inner
        # backup-volume inventory to recognize those exact container IDs.
        # A control-only or otherwise foreign consumer is absent from this set
        # and is still refused by Adoption.no_duplicates().
        actual = canonical_consumers(args, docker, args.phase)
        require(isinstance(actual, set)
                and all(re.fullmatch(r'[a-f0-9]{64}', identity) for identity in actual),
                'CANONICAL_CONSUMERS_INVALID')
        subject.proven_consumers = frozenset(actual)
        if args.phase == 'copyback':
            require(before is not None and subject.state['phase'] == 'quiesced', 'QUIESCED_ADOPTION_REQUIRED')
            subject.verify_copyback()  # Actual pre-auth, stopped-worker and stopped-consumer checks.
        else:
            subject.accepted()
            subject.health()  # Uses the exact accepted worker and rechecks it after the probe.
        if args.phase == 'copyback':
            subject.verify_copyback()  # Recheck worker/consumers after intervening identity reads; no health probe.
        else:
            subject.running()
        if before is not None:
            require(adoption.digest(own.load()) == before, 'ADOPTION_STATE_CHANGED')
        return {'state': 'verified', 'phase': args.phase, 'canonicalConsumers': len(actual)}


def sealed_digest(args, docker):
    with opened(args, docker) as (subject, own, _):
        value = loaded(subject, sealed=True)
        digest = adoption.digest(value)
        subject.verify()
        require(adoption.digest(own.load()) == digest, 'ADOPTION_STATE_CHANGED')
        return {'state': 'sealed', 'backupAdoptionStateSha256': digest}


def execute(args):
    args.source_relative = r7.SOURCE_RELATIVE
    adoption.protected_context(args, os.environ, os.geteuid())
    # Constructor validates all fresh identifiers before any filesystem path is derived.
    adoption.Adoption(args, None, None, None, None)
    docker = Docker()
    if args.command == 'boundary':
        return boundary_result(args, docker)
    if args.command == 'consumers':
        return consumers(args, docker)
    return sealed_digest(args, docker)


def main(arguments=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('boundary', 'consumers', 'digest'))
    for name in ('image-id', 'release-sha', 'tree-sha', 'run-id', 'attempt'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--phase', choices=PHASES)
    args = parser.parse_args(arguments)
    try:
        require((args.command == 'consumers') == (args.phase is not None), 'CONSUMER_PHASE_REQUIRED')
        result = execute(args)
    except Exception as error:
        code = str(error)
        if type(error).__name__ != 'Refused' or not re.fullmatch(r'[A-Z0-9_]{1,64}', code):
            code = 'R14_CONTROLLER_CHECK_FAILED'
        output = json.dumps({'state': 'preserve' if args.command == 'boundary' else 'refused',
                             'code': code}, separators=(',', ':'))
        print(output, file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
