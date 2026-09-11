#!/usr/bin/env python3
"""Adopt the fixed R12 backup service for a release after accepted R17, preserving the fixed R13 reader as history."""
import hashlib
import argparse
import datetime
import fcntl
import json
import os
import re
import secrets
import stat
import sys
import time
from pathlib import Path
from types import ModuleType, SimpleNamespace

FROZEN_R7_SHA256 = 'e48ed0252697b8c382e51826c458f709d1ea80b410630afb8d40b98a739a4306'
path = Path(__file__).with_name('r7-backup-runtime.py')
frozen_source = path.read_bytes()
if hashlib.sha256(frozen_source).hexdigest() != FROZEN_R7_SHA256:
    raise RuntimeError('FROZEN_BACKUP_HELPER_DRIFT')
r7 = ModuleType('r14_frozen_r7')
r7.__file__ = str(path)
exec(compile(frozen_source, str(path), 'exec'), r7.__dict__)

ACCEPTED_SHA = '77f26ec9bcba7233f39d5e8cb9f59c276bc8c1ed'
ACCEPTED_TREE = 'ac3fcaac06acf33bf9ee32e438d0c040adb38fd7'
ACCEPTED_IMAGE = 'sha256:5a39c36001cb79abe6d0bc8d691275b58cdec5456e7d13d95fc717eba6702284'
ACCEPTED_RUN = '34326582961'
ACCEPTED_WORKER_ID = '570d3fb2f96dfa7a08d0a98fbeda0d208f08c0805efcc444bc958fbabf515052'
ACCEPTED_APP_ID = '956bc25a8e4eab6a2e14021100abd7adac42130c20e53321aeafaa01f12a6614'
LIVE_SHA = 'ff8559254faaedade63a9ee7567a45686d08c13a'
LIVE_TREE = '6aeb7e6879b786a434d12f026f765bcaf9acb5a4'
LIVE_IMAGE = 'sha256:34402014063a05c81754716f46b3f9059297f1d21d37da7e5f00b1eb8f7fdd46'
LIVE_RUN = '34495273615'
LIVE_APP_ID = '9909bd54d31244627477bd60c3b8e7cc6cd84758902943e54eb555206c4a1142'
HISTORICAL_SHA = '4a0713b4a7d87f132e49836fe0ce9ca9258bc1ec'
HISTORICAL_TREE = 'ac0ec2a2845eee6254ba7cf8c0e0b83d0e5848de'
HISTORICAL_IMAGE = 'sha256:0f15a32c9dff9cd7278a1449bd66f282abc514f0392edfd57262ed25ef247a6f'
HISTORICAL_RUN = '34445017241'
HISTORICAL_APP_ID = '3b81e98433e7d948d899fcfc1a9e94ee15faa3ef17cb1d1d4d1cb5c371ff67c7'
OLDER_SHA = 'f5fa3e46e3510e6fc98ae4455f4b499c0ba30695'
OLDER_TREE = '3f49b1b7c0e3ed6dfdaaafbccc071386c9b5edde'
OLDER_IMAGE = 'sha256:99b77401c79bb439d3ecbc06d6895b22aae311b3264c27be7dcdf9fabb4b3554'
OLDER_RUN = '34340461537'
OLDER_APP_ID = '6356740984e0c7ad1ad6a30da8bd8f5c6c0b8c268d11f35d09e5984e76c2f76e'
require = r7.require


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def ids(value):
    rows = value.splitlines()
    require(all(re.fullmatch(r'[a-f0-9]{64}', row) for row in rows)
            and len(rows) == len(set(rows)), 'CONSUMER_INVENTORY_INVALID')
    return set(rows)


class OwnedState:
    """The frozen creator/cleanup sees only new activation/seed ownership."""
    def __init__(self, parent):
        self.parent = parent

    def load(self):
        return self.parent.state['owned']

    def write(self, value):
        self.parent.state['owned'] = value
        self.parent.persist()


class Adoption:
    def __init__(self, args, docker, state, accepted, boundary):
        self.args, self.docker, self.store, self.accepted_store, self.boundary = args, docker, state, accepted, boundary
        self.clock, self.pause = time.monotonic, time.sleep
        require(args.release_sha != ACCEPTED_SHA and args.image_id != ACCEPTED_IMAGE
                and args.tree_sha != ACCEPTED_TREE and args.run_id != ACCEPTED_RUN
                and args.release_sha != LIVE_SHA and args.image_id != LIVE_IMAGE
                and args.tree_sha != LIVE_TREE and args.run_id != LIVE_RUN
                and args.release_sha != HISTORICAL_SHA and args.image_id != HISTORICAL_IMAGE
                and args.tree_sha != HISTORICAL_TREE and args.run_id != HISTORICAL_RUN
                and args.release_sha != OLDER_SHA and args.image_id != OLDER_IMAGE
                and args.tree_sha != OLDER_TREE and args.run_id != OLDER_RUN, 'FRESH_RELEASE_REQUIRED')
        self.owned = r7.Runtime(args, docker, OwnedState(self))
        old_args = SimpleNamespace(image_id=ACCEPTED_IMAGE, release_sha=ACCEPTED_SHA, tree_sha=ACCEPTED_TREE,
                                   run_id=ACCEPTED_RUN, attempt='1', source_relative=r7.SOURCE_RELATIVE)
        self.old = r7.Runtime(old_args, docker, accepted)
        self.state = None

    def persist(self):
        self.store.write(self.state)

    def pre_auth(self):
        # The production boundary is a fixed durable file check, never a CLI flag.
        require(not self.boundary() and not (self.state and self.state['sealed']), 'AUTH_OR_PUBLIC_BOUNDARY')

    def no_duplicates(self):
        inventory = set()
        filters = ['name=^/arthello-v52-backup-worker-', 'label=' + r7.LABEL + 'role=worker']
        filters += ['volume=' + name for name in [r7.SOURCE_VOLUME, self.old.names['backups'], self.old.names['control']]]
        for selector in filters:
            observed = ids(self.docker.command(['container', 'ls', '--all', '--quiet', '--no-trunc', '--filter', selector]))
            if selector.startswith(('name=', 'label=')):
                require(observed == {ACCEPTED_WORKER_ID}, 'DUPLICATE_BACKUP_WORKER')
            inventory.update(observed)
        for identity in inventory:
            metadata = self.docker.inspect('container', identity)
            require(metadata.get('Id') == identity, 'CONSUMER_IDENTITY_CHANGED')
            config = metadata.get('Config', {})
            labels = config.get('Labels') or {}
            is_worker = (metadata.get('Name', '').startswith('/arthello-v52-backup-worker-')
                         or labels.get(r7.LABEL + 'role') == 'worker'
                         or config.get('Cmd') == ['-I', '/opt/arthello-backup/worker.py'])
            require(not is_worker or identity == ACCEPTED_WORKER_ID, 'DUPLICATE_BACKUP_WORKER')
            protected = {self.old.names['backups'], self.old.names['control']}
            mounted = {item.get('Name') for item in metadata.get('Mounts', [])}
            if mounted & protected and identity != ACCEPTED_WORKER_ID:
                accepted_app = (identity == ACCEPTED_APP_ID and metadata.get('Image') == ACCEPTED_IMAGE
                                and metadata.get('Name') == '/arthello-direct-' + ACCEPTED_RUN + '-1')
                accepted_app = accepted_app or (identity == LIVE_APP_ID
                    and metadata.get('Image') == LIVE_IMAGE
                    and metadata.get('Name') == '/arthello-direct-' + LIVE_RUN + '-1'
                    and labels.get('arthello.release.sha') == LIVE_SHA)
                historical_app = any(identity == row[0]
                    and metadata.get('Image') == row[1]
                    and metadata.get('Name') == '/arthello-direct-' + row[2] + '-1'
                    and labels.get('arthello.release.sha') == row[3]
                    and metadata.get('State', {}).get('Running') is False
                    and metadata.get('State', {}).get('Paused') is False
                    and metadata.get('State', {}).get('Restarting') is False
                    for row in ((HISTORICAL_APP_ID,HISTORICAL_IMAGE,HISTORICAL_RUN,HISTORICAL_SHA),
                                (OLDER_APP_ID,OLDER_IMAGE,OLDER_RUN,OLDER_SHA)))
                new_app = (metadata.get('Name') == '/arthello-direct-' + self.args.run_id + '-' + self.args.attempt
                           and metadata.get('Image') == self.args.image_id
                           and labels.get('arthello.release.sha') == self.args.release_sha)
                require(accepted_app or historical_app or new_app, 'FOREIGN_BACKUP_CONSUMER')
                control = self.old.names['control']
                protected_mounts = [item for item in metadata.get('Mounts', []) if item.get('Name') in protected]
                require(len(protected_mounts) == 1
                        and protected_mounts[0].get('Type') == 'volume'
                        and protected_mounts[0].get('Name') == control
                        and protected_mounts[0].get('Destination') == r7.DIRECTORIES['control']
                        and protected_mounts[0].get('RW') is False, 'APP_BACKUP_MOUNT_FORBIDDEN')
                configured = [item for item in metadata.get('HostConfig', {}).get('Mounts', []) if item.get('Source') in protected]
                require(len(configured) == 1 and configured[0].get('Type') == 'volume'
                        and configured[0].get('Source') == control and configured[0].get('Target') == r7.DIRECTORIES['control']
                        and configured[0].get('ReadOnly') is True
                        and configured[0].get('VolumeOptions', {}).get('NoCopy') is True, 'APP_BACKUP_MOUNT_FORBIDDEN')

    def accepted(self):
        value = self.accepted_store.load()
        require(isinstance(value, dict) and value.get('schemaVersion') == 1
                and value.get('identity') == self.old.identity and value.get('state') == 'verified'
                and value.get('pending') is None and re.fullmatch(r'[a-f0-9]{64}', value.get('instance', '')),
                'ACCEPTED_STATE_INVALID')
        if self.state:
            require(digest(value) == self.state['acceptedStateSha256'], 'ACCEPTED_STATE_CHANGED')
        self.old.state = value
        self.old.load_image()
        records = value.get('resources')
        require(isinstance(records, list) and len(records) == 5, 'ACCEPTED_RESOURCES_INVALID')
        roles = [record.get('role') for record in records if isinstance(record, dict)]
        require(len(roles) == len(records) and len(set(roles)) == len(roles)
                and set(roles) == {'worker', 'backups', 'control', 'activation', 'seed'}, 'ACCEPTED_RESOURCES_INVALID')
        for record in records:
            role = record['role']
            require(record.get('name') == self.old.names[role], 'ACCEPTED_RESOURCE_NAME')
            if role == 'seed':
                require(record.get('removed') is True and record.get('kind') == 'container'
                        and re.fullmatch(r'[a-f0-9]{64}', record.get('id', ''))
                        and self.docker.inspect('container', record['name'], True) is None, 'ACCEPTED_SEED_AMBIGUOUS')
                continue
            require(not record.get('removed'), 'ACCEPTED_RESOURCE_REMOVED')
            if role == 'worker':
                require(record.get('kind') == 'container' and record.get('id') == ACCEPTED_WORKER_ID, 'ACCEPTED_WORKER_ID')
                worker = self.docker.inspect('container', ACCEPTED_WORKER_ID)
                self.old.verify_container(worker, 'worker', ACCEPTED_WORKER_ID)
                require(worker.get('State', {}).get('Paused') is False
                        and worker.get('State', {}).get('Restarting', False) is False
                        and worker.get('State', {}).get('Dead', False) is False
                        and type(worker.get('State', {}).get('Running')) is bool, 'WORKER_RUNTIME_UNSAFE')
                policy = worker['HostConfig']['RestartPolicy']
                require(policy.get('MaximumRetryCount') == 0, 'WORKER_RESTART_POLICY')
            else:
                require(record.get('kind') == 'volume', 'ACCEPTED_VOLUME_KIND')
                self.old.verify_volume(self.docker.inspect('volume', record['name']), role, record)
        self.no_duplicates()
        return value, worker

    def running(self):
        _, worker = self.accepted()
        expected = self.state['recordedRestart'] if self.state else {'Name': 'unless-stopped', 'MaximumRetryCount': 0}
        require(worker['State']['Running'] is True and worker['HostConfig']['RestartPolicy'] == expected,
                'BACKUP_WORKER_NOT_RUNNING')

    def health(self, wait=False):
        deadline = self.clock() + 60
        while True:
            result = self.docker.run(['container', 'exec', ACCEPTED_WORKER_ID, 'python3', '-I',
                                     '/opt/arthello-backup/probe.py', '--require-initial-verified'], timeout=20)
            if result.returncode == 0:
                break
            require(wait and result.returncode == 1 and self.clock() < deadline, 'BACKUP_PROBE_NOT_READY')
            _, worker = self.accepted()
            require(worker['State']['Running'] is True, 'BACKUP_WORKER_STOPPED_DURING_PROBE')
            self.pause(2)
        value = json.loads(result.stdout)
        original = self.old.state.get('probe', {})
        require(value.get('schemaVersion') == 1 and value.get('state') == 'verified'
                and value.get('initialVerified') is True
                and isinstance(original.get('initialBackupId'), str)
                and value.get('initialBackupId') == original['initialBackupId']
                and isinstance(value.get('lastVerifiedBackupId'), str)
                and re.fullmatch(r'[A-Za-z0-9._:-]{1,160}', value['lastVerifiedBackupId'])
                and type(value.get('historyCount')) is int
                and value['historyCount'] >= max(1, original.get('historyCount', 1),
                     self.state['backupAtAdoption']['historyCount'] if self.state else 1), 'BACKUP_HEALTH_UNVERIFIED')
        next_at = datetime.datetime.fromisoformat(value['nextAt'].replace('Z', '+00:00'))
        require(next_at.tzinfo is not None, 'BACKUP_SCHEDULE_INVALID')
        self.running()
        return {key: value[key] for key in ('initialBackupId', 'lastVerifiedBackupId', 'historyCount', 'nextAt')}

    def load(self):
        self.state = self.store.load()
        require(isinstance(self.state, dict) and self.state.get('schemaVersion') == 14
                and self.state.get('identity') == self.owned.identity
                and type(self.state.get('sealed')) is bool
                and self.state.get('phase') in ('preparing', 'adopted', 'quiescing', 'quiesced', 'restoring', 'sealed', 'cleaned')
                and re.fullmatch(r'[a-f0-9]{64}', self.state.get('acceptedStateSha256', '')),
                'ADOPTION_STATE_INVALID')
        require(self.state.get('recordedRestart') == {'Name': 'unless-stopped', 'MaximumRetryCount': 0}
                and self.state.get('adopted', {}).get('workerId') == ACCEPTED_WORKER_ID
                and self.state['adopted'].get('volumes') == {role: self.old.names[role] for role in ('backups', 'control', 'activation')},
                'ADOPTED_IDENTITY_INVALID')
        owned = self.state.get('owned')
        require(isinstance(owned, dict) and owned.get('identity') == self.owned.identity
                and owned.get('schemaVersion') == 1 and re.fullmatch(r'[a-f0-9]{64}', owned.get('instance', '')),
                'OWNED_IDENTITY_INVALID')
        resources = owned.get('resources')
        require(isinstance(resources, list) and len(resources) <= 2, 'OWNED_SCOPE_INVALID')
        roles = []
        for record in resources + ([owned['pending']] if owned.get('pending') else []):
            require(isinstance(record, dict) and record.get('role') in ('activation', 'seed'), 'OWNED_SCOPE_INVALID')
            role = record['role']
            require(record.get('name') == self.owned.names[role]
                    and record.get('kind') == ('container' if role == 'seed' else 'volume'), 'OWNED_SCOPE_INVALID')
            roles.append(role)
        require(len(roles) == len(set(roles)), 'OWNED_SCOPE_INVALID')
        self.owned.state = owned
        self.owned.load_image()
        return self.state

    def receipt(self, backup=None):
        return {'schemaVersion': 14, 'state': self.state['phase'], 'releaseSha': self.args.release_sha,
                'worker': {'id': ACCEPTED_WORKER_ID, 'name': self.old.names['worker'], 'ownership': 'adopted'},
                'volumes': {**{role: {'name': self.old.names[role], 'ownership': 'adopted'} for role in ('backups', 'control')},
                            'activation': {'name': self.owned.names['activation'], 'ownership': 'owned'}},
                'backup': backup or self.state['backupAtAdoption']}

    def prepare(self):
        require(self.store.load() is None, 'STATE_ALREADY_EXISTS')
        self.pre_auth()
        self.owned.load_image()
        config = self.owned.image.get('Config', {})
        require(config.get('User') == 'node'
                and config.get('Labels', {}).get('org.opencontainers.image.revision') == self.args.release_sha
                and config.get('Labels', {}).get('org.opencontainers.image.source-tree') == self.args.tree_sha, 'CANDIDATE_IMAGE_MISMATCH')
        accepted, worker = self.accepted()
        require(worker['State']['Running'] is True
                and worker['HostConfig']['RestartPolicy'] == {'Name': 'unless-stopped', 'MaximumRetryCount': 0}, 'ACCEPTED_WORKER_NOT_HEALTHY')
        backup = self.health()
        for role, name in self.owned.names.items():
            require(self.docker.inspect('container' if role in ('seed', 'worker') else 'volume', name, True) is None,
                    'FRESH_RESOURCE_ALREADY_EXISTS')
        self.state = {'schemaVersion': 14, 'identity': self.owned.identity, 'phase': 'preparing', 'sealed': False,
                      'acceptedStateSha256': digest(accepted), 'recordedRestart': dict(worker['HostConfig']['RestartPolicy']),
                      'adopted': {'workerId': ACCEPTED_WORKER_ID,
                                  'volumes': {role: self.old.names[role] for role in ('backups', 'control', 'activation')}},
                      'backupAtAdoption': backup,
                      'owned': {'schemaVersion': 1, 'identity': self.owned.identity, 'instance': secrets.token_hex(32),
                                'resources': [], 'pending': None, 'state': 'preparing'}}
        self.persist()
        self.owned.state = self.state['owned']
        self.owned.create('volume', 'activation')
        seed = self.owned.create('container', 'seed')
        result = json.loads(self.docker.command(['container', 'start', '--attach', seed['id']], timeout=45))
        require(result.get('schemaVersion') == 1 and result.get('state') == 'empty-verified'
                and result.get('executionUid') == 1002 and result.get('executionGid') == 1000
                and result.get('directoryMode') == '0750' and result.get('markerPresent') is False, 'ACTIVATION_SEED_NOT_EMPTY')
        self.owned.verify_container(self.docker.inspect('container', seed['id']), 'seed', seed['id'])
        self.docker.command(['container', 'rm', seed['id']])
        seed['removed'] = True
        self.state['owned']['state'] = 'verified'
        self.state['phase'] = 'adopted'
        self.persist()
        return self.verify()

    def verify(self):
        self.load()
        _, worker = self.accepted()
        require(self.state['phase'] in ('adopted', 'sealed') and worker['State']['Running'] is True
                and worker['HostConfig']['RestartPolicy'] == self.state['recordedRestart'], 'ADOPTED_WORKER_NOT_RUNNING')
        require(self.state['owned'].get('pending') is None, 'OWNED_OPERATION_PENDING')
        activation = [r for r in self.state['owned']['resources'] if r['role'] == 'activation' and not r.get('removed')]
        require(len(activation) == 1, 'ACTIVATION_NOT_OWNED')
        self.owned.verify_volume(self.docker.inspect('volume', self.owned.names['activation']), 'activation', activation[0])
        backup = self.health()
        self.running()
        return self.receipt(backup)

    def quiesce(self):
        self.load()
        self.pre_auth()
        require(self.state['phase'] in ('adopted', 'quiescing', 'quiesced'), 'QUIESCE_PHASE_INVALID')
        _, worker = self.accepted()
        if self.state['phase'] == 'adopted':
            require(worker['State']['Running'] is True and worker['HostConfig']['RestartPolicy'] == self.state['recordedRestart'], 'WORKER_DRIFT')
            self.health()
            self.state['phase'] = 'quiescing'
            self.persist()  # Durable intent precedes both restart and stop mutations.
        self.pre_auth()
        self.accepted()
        self.docker.command(['container', 'update', '--restart=no', ACCEPTED_WORKER_ID])
        self.accepted()
        self.docker.command(['container', 'stop', '--time', '20', ACCEPTED_WORKER_ID], timeout=30)
        _, worker = self.accepted()
        require(worker['State']['Running'] is False and worker['HostConfig']['RestartPolicy']['Name'] == 'no', 'WORKER_NOT_QUIESCED')
        self.state['phase'] = 'quiesced'
        self.persist()
        return self.receipt()

    def verify_copyback(self):
        self.load()
        self.pre_auth()
        require(self.state['phase'] == 'quiesced', 'COPYBACK_PHASE_INVALID')
        _, worker = self.accepted()
        require(worker['State']['Running'] is False and worker['HostConfig']['RestartPolicy']['Name'] == 'no', 'WORKER_NOT_QUIESCED')
        consumers = ids(self.docker.command(['container', 'ls', '--all', '--quiet', '--no-trunc', '--filter', 'volume=' + r7.SOURCE_VOLUME]))
        for identity in consumers:
            current = self.docker.inspect('container', identity)
            require(current.get('Id') == identity and current.get('State', {}).get('Running') is False
                    and current.get('State', {}).get('Paused') is False
                    and current.get('State', {}).get('Restarting', False) is False
                    and current.get('HostConfig', {}).get('RestartPolicy') == {'Name': 'no', 'MaximumRetryCount': 0},
                    'CANONICAL_CONSUMER_ACTIVE')
        self.pre_auth()
        return {'schemaVersion': 14, 'state': 'quiesced', 'canonicalReaders': 'none', 'databaseMutation': False}

    def restore(self):
        self.load()
        require(self.state['phase'] in ('adopted', 'quiescing', 'quiesced', 'restoring'), 'RESTORE_PHASE_INVALID')
        _, worker = self.accepted()
        if self.state['phase'] == 'adopted':
            return self.verify()
        self.state['phase'] = 'restoring'
        self.persist()
        # Recovery may restore this read-only backup service even if a later auth
        # marker exists; it never restores a DB or removes any adopted resource.
        self.docker.command(['container', 'update', '--restart=' + self.state['recordedRestart']['Name'], ACCEPTED_WORKER_ID])
        _, worker = self.accepted()
        if not worker['State']['Running']:
            self.docker.command(['container', 'start', ACCEPTED_WORKER_ID])
        _, worker = self.accepted()
        require(worker['State']['Running'] is True and worker['HostConfig']['RestartPolicy'] == self.state['recordedRestart'], 'WORKER_RESTORE_FAILED')
        backup = self.health(wait=True)
        self.running()
        self.state['phase'] = 'adopted'
        self.persist()
        return self.receipt(backup)

    def seal(self):
        result = self.verify()
        self.state['sealed'] = True
        self.state['phase'] = 'sealed'
        self.persist()  # Required before controller exposes candidate authentication.
        result['state'] = 'sealed'
        return result

    def cleanup(self):
        self.load()
        self.pre_auth()
        if self.state['phase'] in ('quiescing', 'quiesced', 'restoring'):
            self.restore()
            self.load()
        require(self.state['phase'] in ('preparing', 'adopted', 'cleaned'), 'CLEANUP_PHASE_INVALID')
        _, worker = self.accepted()
        require(worker['State']['Running'] is True and worker['HostConfig']['RestartPolicy'] == self.state['recordedRestart'], 'BACKUP_NOT_RESTORED')
        self.health()
        self.pre_auth()
        # load() restricted owned roles to activation/seed before this frozen
        # cleanup. Accepted R12 worker/history/control/activation never enter it.
        result = self.owned.cleanup()
        self.state['phase'] = 'cleaned'
        self.persist()
        self.accepted()
        self.health()
        return {'schemaVersion': 14, 'state': 'cleaned', 'ownedRemoved': result['removed'], 'adoptedRemoved': 0}


class DurableBoundary:
    def __init__(self, directory_fd, release):
        self.fd, self.names = directory_fd, ('candidate-acceptance-' + release + '.json', 'activation-' + release + '.json')

    def __call__(self):
        for name in self.names:
            try:
                os.stat(name, dir_fd=self.fd, follow_symlinks=False)
                return True  # Even a malformed file or symlink closes restoration.
            except FileNotFoundError:
                pass
        return False


def private_directory(path):
    require(path.is_absolute() and all(p not in ('', '.', '..') for p in path.parts[1:]), 'STATE_PATH_INVALID')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in path.parts[1:]:
            new_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd)
            fd = new_fd
            info = os.fstat(fd)
            require(info.st_uid in (0, os.geteuid()) and not stat.S_IMODE(info.st_mode) & 0o022, 'STATE_ANCESTOR_UNTRUSTED')
        info = os.fstat(fd)
        require(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700, 'STATE_DIRECTORY_UNTRUSTED')
        return fd
    except BaseException:
        os.close(fd)
        raise


def protected_context(args, environment, uid):
    current = environment.get('GITHUB_RUN_ATTEMPT', '')
    require(uid != 0 and environment.get('GITHUB_REPOSITORY') == 'vitaliyozolin-dotcom/ArtHello-OS'
            and environment.get('GITHUB_ACTOR') == 'vitaliyozolin-dotcom'
            and environment.get('GITHUB_TRIGGERING_ACTOR') == 'vitaliyozolin-dotcom'
            and environment.get('GITHUB_EVENT_NAME') == 'workflow_run'
            and environment.get('RELEASE_SHA') == args.release_sha
            and environment.get('GITHUB_RUN_ID') == args.run_id
            and re.fullmatch(r'[1-9][0-9]{0,2}', current)
            and re.fullmatch(r'[1-9][0-9]{0,2}', args.attempt)
            and 1 <= int(args.attempt) <= int(current) <= 50
            and (args.command != 'prepare' or args.attempt == current), 'PROTECTED_RELEASE_CONTEXT_REQUIRED')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('prepare', 'verify', 'quiesce', 'verify-copyback', 'restore', 'seal', 'cleanup'))
    for name in ('image-id', 'release-sha', 'tree-sha', 'run-id', 'attempt'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    args.source_relative = r7.SOURCE_RELATIVE
    state = accepted = None
    directory_fd = None
    try:
        protected_context(args, os.environ, os.geteuid())
        # Validate fresh identifiers before deriving filesystem paths.
        r7.Runtime(args, None, None)
        require(args.run_id != ACCEPTED_RUN and args.release_sha != ACCEPTED_SHA, 'FRESH_RELEASE_REQUIRED')
        root = Path.home() / '.config/arthello/release-state'
        directory_fd = private_directory(root)
        own_name = 'backup-adoption-r14-' + args.run_id + '-' + args.attempt
        if args.command == 'prepare':
            os.mkdir(own_name, 0o700, dir_fd=directory_fd)
            os.fsync(directory_fd)
        own = root / own_name / 'backup-runtime-state.json'
        accepted_path = root / ('backup-runtime-' + ACCEPTED_RUN + '-1') / 'backup-runtime-state.json'
        accepted = r7.StateFile(str(accepted_path))
        state = r7.StateFile(str(own))
        fcntl.flock(state.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        subject = Adoption(args, r7.Docker(), state, accepted, DurableBoundary(directory_fd, args.release_sha))
        print(json.dumps(getattr(subject, args.command.replace('-', '_'))(), sort_keys=True))
        return 0
    except r7.Refused as error:
        print(json.dumps({'state': 'refused', 'code': str(error)}), file=sys.stderr)
    except (OSError, ValueError, KeyError, TypeError):
        print(json.dumps({'state': 'refused', 'code': 'LOCAL_PRECONDITION_FAILED'}), file=sys.stderr)
    finally:
        for store in (state, accepted):
            if store is not None:
                store.close()
        if directory_fd is not None:
            os.close(directory_fd)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
