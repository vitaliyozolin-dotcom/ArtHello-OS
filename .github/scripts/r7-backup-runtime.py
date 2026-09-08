#!/usr/bin/env python3
"""Create only fresh release-owned backup resources as the ordinary gateway user."""
import argparse
import datetime
import hashlib
import json
import os
import re
import secrets
import stat
import subprocess
import sys
import time

SOURCE_VOLUME = 'arthello-direct-v44-data'
SOURCE_RELATIVE = 'd1/miniflare-D1DatabaseObject/5a499c55f63d6b9f725547d510cf454e288954b6f3c2d5024eb1443f29c97730.sqlite'
LABEL = 'io.arthello.r7.'
DIRECTORIES = {'backups': '/var/backups/arthello-v52', 'control': '/var/lib/arthello-v52-backup-control',
               'activation': '/var/lib/arthello-v52-tochka-activation'}


class Refused(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


class Docker:
    def run(self, args, timeout=30):
        try:
            result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=timeout, check=False)
        except subprocess.TimeoutExpired:
            raise Refused('DOCKER_TIMEOUT') from None
        except OSError:
            raise Refused('DOCKER_UNAVAILABLE') from None
        require(len(result.stdout) + len(result.stderr) <= 1048576, 'DOCKER_OUTPUT_LIMIT')
        return result

    def command(self, args, timeout=30):
        result = self.run(args, timeout)
        require(result.returncode == 0, 'DOCKER_COMMAND_FAILED')
        return result.stdout.strip()

    def inspect(self, kind, name, missing=False):
        result = self.run([kind, 'inspect', name])
        if result.returncode:
            # Daemon errors, permission errors and malformed output are not absence.
            pattern = r'(?:Error(?: response from daemon)?: )?No such (?:container|volume|image): ' + re.escape(name)
            volume_pattern = r'Error response from daemon: get ' + re.escape(name) + r': no such volume'
            absent = re.fullmatch(pattern, result.stderr.strip()) or (kind == 'volume' and re.fullmatch(volume_pattern, result.stderr.strip()))
            if missing and absent and result.stdout.strip() in ('', '[]'):
                return None
            raise Refused('RESOURCE_INSPECT_FAILED')
        try:
            values = json.loads(result.stdout)
        except ValueError:
            raise Refused('RESOURCE_INSPECT_INVALID') from None
        require(isinstance(values, list) and len(values) == 1 and isinstance(values[0], dict), 'RESOURCE_INSPECT_INVALID')
        return values[0]


class StateFile:
    def __init__(self, path):
        require(os.path.isabs(path) and os.path.basename(path) == 'backup-runtime-state.json', 'STATE_PATH_INVALID')
        parts = os.path.dirname(path).split('/')[1:]
        require(parts and all(part not in ('', '.', '..') for part in parts), 'STATE_PATH_INVALID')
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        try:
            for part in parts:
                next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
                os.close(fd)
                fd = next_fd
            info = os.fstat(fd)
            require(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700, 'STATE_DIRECTORY_UNTRUSTED')
            self.fd = fd
            fd = None
        finally:
            if fd is not None:
                os.close(fd)
        self.name = os.path.basename(path)
        self.identity = None

    def close(self):
        os.close(self.fd)

    def load(self):
        try:
            fd = os.open(self.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=self.fd)
        except FileNotFoundError:
            return None
        try:
            before = os.fstat(fd)
            require(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid()
                    and stat.S_IMODE(before.st_mode) == 0o600 and before.st_nlink == 1
                    and before.st_size <= 65536, 'STATE_FILE_UNTRUSTED')
            raw = os.read(fd, 65537)
            after = os.fstat(fd)
            require((before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns, before.st_size)
                    == (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns, len(raw)), 'STATE_CHANGED')
            current = os.stat(self.name, dir_fd=self.fd, follow_symlinks=False)
            require((current.st_dev, current.st_ino) == (after.st_dev, after.st_ino), 'STATE_CHANGED')
            self.identity = (after.st_dev, after.st_ino)
            try:
                return json.loads(raw)
            except (ValueError, UnicodeError):
                raise Refused('STATE_INVALID') from None
        finally:
            os.close(fd)

    def write(self, value):
        raw = (json.dumps(value, sort_keys=True) + '\n').encode()
        require(len(raw) <= 65536, 'STATE_SIZE_LIMIT')
        temporary = '.backup-runtime-' + secrets.token_hex(16)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=self.fd)
        try:
            os.fchmod(fd, 0o600)
            offset = 0
            while offset < len(raw):
                written = os.write(fd, raw[offset:])
                require(written > 0, 'STATE_SHORT_WRITE')
                offset += written
            os.fsync(fd)
            if self.identity is None:
                # Atomic no-replace creation; a pre-existing file is never adopted.
                os.link(temporary, self.name, src_dir_fd=self.fd, dst_dir_fd=self.fd, follow_symlinks=False)
                os.unlink(temporary, dir_fd=self.fd)
            else:
                current = os.stat(self.name, dir_fd=self.fd, follow_symlinks=False)
                require((current.st_dev, current.st_ino) == self.identity and current.st_uid == os.geteuid()
                        and stat.S_ISREG(current.st_mode) and stat.S_IMODE(current.st_mode) == 0o600
                        and current.st_nlink == 1, 'STATE_REPLACED')
                os.replace(temporary, self.name, src_dir_fd=self.fd, dst_dir_fd=self.fd)
            current = os.stat(self.name, dir_fd=self.fd, follow_symlinks=False)
            self.identity = (current.st_dev, current.st_ino)
            os.fsync(self.fd)
        finally:
            os.close(fd)
            try:
                os.unlink(temporary, dir_fd=self.fd)
            except FileNotFoundError:
                pass


class Runtime:
    def __init__(self, args, docker, state_file, clock=time.monotonic, pause=time.sleep):
        require(re.fullmatch(r'sha256:[0-9a-f]{64}', args.image_id or ''), 'IMAGE_ID_INVALID')
        require(re.fullmatch(r'[0-9a-f]{40}', args.release_sha or '') and re.fullmatch(r'[0-9a-f]{40}', args.tree_sha or ''), 'RELEASE_ID_INVALID')
        require(re.fullmatch(r'[1-9][0-9]{0,19}', args.run_id or '') and re.fullmatch(r'[1-9][0-9]{0,5}', args.attempt or ''), 'RUN_ID_INVALID')
        require(args.source_relative == SOURCE_RELATIVE, 'SOURCE_PATH_INVALID')
        self.args, self.docker, self.state_file, self.clock, self.pause = args, docker, state_file, clock, pause
        suffix = args.run_id + '-' + args.attempt
        self.names = {'worker': 'arthello-v52-backup-worker-' + suffix,
                      'seed': 'arthello-v52-activation-seed-' + suffix,
                      **{role: 'arthello-v52-' + prefix + '-' + suffix for role, prefix in
                         [('backups', 'backups'), ('control', 'backup-control'), ('activation', 'tochka-activation')]}}
        self.identity = {'releaseSha': args.release_sha, 'treeSha': args.tree_sha, 'imageId': args.image_id,
                         'runId': args.run_id, 'attempt': args.attempt, 'sourceVolume': SOURCE_VOLUME,
                         'sourceRelativeSha256': hashlib.sha256(SOURCE_RELATIVE.encode()).hexdigest()}
        self.state = None
        self.image = None

    def labels(self, role):
        return {LABEL + key: value for key, value in {
            'scope': 'backup-runtime-v1', 'run': self.args.run_id, 'attempt': self.args.attempt,
            'release': self.args.release_sha, 'tree': self.args.tree_sha, 'image': self.args.image_id,
            'role': role, 'instance': self.state['instance'],
        }.items()}

    def verify_labels(self, metadata, role, container=False):
        actual = metadata.get('Config', {}).get('Labels') if container else metadata.get('Labels')
        require(isinstance(actual, dict) and {k: v for k, v in actual.items() if k.startswith(LABEL)} == self.labels(role), 'RESOURCE_OWNERSHIP_MISMATCH')

    def mounts(self, role):
        if role == 'seed':
            return [(self.names['activation'], DIRECTORIES['activation'], False, False)]
        return [(SOURCE_VOLUME, '/data', True, True),
                (self.names['backups'], DIRECTORIES['backups'], False, False),
                (self.names['control'], DIRECTORIES['control'], False, False)]

    def create_args(self, role):
        uid = '1002' if role == 'seed' else '1000'
        args = ['container', 'create', '--name', self.names[role], '--user', uid + ':1000', '--network', 'none',
                '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--pids-limit', '64',
                '--memory', '256m', '--cpus', '0.5', '--restart', 'no', '--tmpfs', '/tmp:rw,uid=' + uid + ',gid=1000,mode=0700']
        for key, value in self.labels(role).items():
            args += ['--label', key + '=' + value]
        for name, destination, readonly, nocopy in self.mounts(role):
            args += ['--mount', 'type=volume,source=' + name + ',target=' + destination
                     + (',readonly' if readonly else '') + (',volume-nocopy' if nocopy else '')]
        if role == 'worker':
            args += ['--env', 'ARTHELLO_BACKUP_SOURCE_RELATIVE=' + SOURCE_RELATIVE]
        args += ['--entrypoint', 'python3', self.args.image_id, '-I', '/opt/arthello-backup/'
                 + ('activation-volume.py' if role == 'seed' else 'worker.py')]
        if role == 'seed':
            args += ['check-empty', '--directory', DIRECTORIES['activation']]
        return args

    def verify_volume(self, metadata, role, previous=None):
        self.verify_labels(metadata, role)
        require(metadata.get('Name') == self.names[role] and metadata.get('Driver') == 'local'
                and not metadata.get('Options') and metadata.get('Scope') == 'local'
                and isinstance(metadata.get('CreatedAt'), str) and metadata['CreatedAt'], 'VOLUME_CONFIG_MISMATCH')
        if previous:
            require(metadata['CreatedAt'] == previous['createdAt'], 'VOLUME_IDENTITY_CHANGED')
        return {'kind': 'volume', 'role': role, 'name': self.names[role], 'createdAt': metadata['CreatedAt']}

    def verify_container(self, metadata, role, expected_id=None):
        self.verify_labels(metadata, role, True)
        config, host = metadata.get('Config', {}), metadata.get('HostConfig', {})
        require(re.fullmatch(r'[0-9a-f]{64}', metadata.get('Id', '')) and (not expected_id or metadata['Id'] == expected_id), 'CONTAINER_IDENTITY_CHANGED')
        uid = '1002' if role == 'seed' else '1000'
        expected_cmd = ['-I', '/opt/arthello-backup/' + ('activation-volume.py' if role == 'seed' else 'worker.py')]
        if role == 'seed':
            expected_cmd += ['check-empty', '--directory', DIRECTORIES['activation']]
        require(metadata.get('Name') == '/' + self.names[role] and metadata.get('Image') == self.args.image_id
                and config.get('Image') == self.args.image_id and config.get('User') == uid + ':1000'
                and config.get('Entrypoint') == ['python3'] and config.get('Cmd') == expected_cmd, 'CONTAINER_CONFIG_MISMATCH')
        expected_env = dict(item.split('=', 1) for item in self.image.get('Config', {}).get('Env', []))
        if role == 'worker':
            expected_env['ARTHELLO_BACKUP_SOURCE_RELATIVE'] = SOURCE_RELATIVE
        actual_env = config.get('Env', [])
        require(all(isinstance(item, str) and '=' in item for item in actual_env)
                and len({item.split('=', 1)[0] for item in actual_env}) == len(actual_env)
                and dict(item.split('=', 1) for item in actual_env) == expected_env, 'CONTAINER_ENV_MISMATCH')
        require(host.get('NetworkMode') == 'none' and host.get('ReadonlyRootfs') is True
                and host.get('CapDrop') == ['ALL'] and not host.get('CapAdd') and not host.get('Privileged')
                and host.get('SecurityOpt') == ['no-new-privileges:true'] and host.get('PidsLimit') == 64
                and host.get('Memory') == 268435456 and host.get('NanoCpus') == 500000000
                and host.get('Tmpfs') == {'/tmp': 'rw,uid=' + uid + ',gid=1000,mode=0700'}
                and host.get('RestartPolicy', {}).get('Name') in (('no',) if role == 'seed' else ('no', 'unless-stopped')),
                'CONTAINER_ISOLATION_MISMATCH')
        require(not any(host.get(field) for field in ['Binds', 'VolumesFrom', 'Devices', 'DeviceRequests', 'PortBindings', 'PublishAllPorts', 'ExtraHosts', 'GroupAdd'])
                and host.get('PidMode', '') != 'host' and host.get('IpcMode', '') != 'host'
                and set(metadata.get('NetworkSettings', {}).get('Networks', {})) == {'none'}, 'CONTAINER_EXTERNAL_ACCESS')
        mounts = metadata.get('Mounts', [])
        tmpfs_mounts = [m for m in mounts if m.get('Type') == 'tmpfs']
        require(len(tmpfs_mounts) <= 1 and all(m.get('Destination') == '/tmp' and m.get('RW') is True
                and m.get('Source') in (None, '') and m.get('Name') in (None, '') for m in tmpfs_mounts), 'CONTAINER_TMPFS_MISMATCH')
        actual_mounts = sorted((m.get('Type'), m.get('Name'), m.get('Destination'), m.get('RW')) for m in mounts if m.get('Type') != 'tmpfs')
        require(actual_mounts == sorted(('volume', name, destination, not readonly) for name, destination, readonly, _ in self.mounts(role)), 'CONTAINER_MOUNT_MISMATCH')
        configured_mounts = sorted((m.get('Type'), m.get('Source'), m.get('Target'), bool(m.get('ReadOnly')), bool(m.get('VolumeOptions', {}).get('NoCopy'))) for m in host.get('Mounts', []))
        require(configured_mounts == sorted(('volume', name, destination, readonly, nocopy) for name, destination, readonly, nocopy in self.mounts(role)), 'CONTAINER_MOUNT_CONFIG_MISMATCH')
        return {'kind': 'container', 'role': role, 'name': self.names[role], 'id': metadata['Id']}

    def persist(self):
        self.state_file.write(self.state)

    def create(self, kind, role):
        self.state['pending'] = {'kind': kind, 'role': role, 'name': self.names[role]}
        self.persist()
        if kind == 'volume':
            args = ['volume', 'create', '--driver', 'local']
            for key, value in self.labels(role).items():
                args += ['--label', key + '=' + value]
            output = self.docker.command(args + [self.names[role]])
            require(output == self.names[role], 'VOLUME_CREATE_ID_INVALID')
            record = self.verify_volume(self.docker.inspect(kind, self.names[role]), role)
        else:
            output = self.docker.command(self.create_args(role))
            require(re.fullmatch(r'[0-9a-f]{64}', output), 'CONTAINER_CREATE_ID_INVALID')
            metadata = self.docker.inspect(kind, self.names[role])
            record = self.verify_container(metadata, role, output)
            require(metadata.get('HostConfig', {}).get('RestartPolicy', {}).get('Name') == 'no'
                    and metadata.get('State', {}).get('Running') is False, 'CONTAINER_NOT_FRESH')
        self.state['resources'].append(record)
        self.state['pending'] = None
        self.persist()
        return record

    def load_image(self):
        self.image = self.docker.inspect('image', self.args.image_id)
        require(self.image.get('Id') == self.args.image_id, 'IMAGE_IDENTITY_MISMATCH')

    def prepare(self):
        require(self.state_file.load() is None, 'STATE_ALREADY_EXISTS')
        self.load_image()
        source = self.docker.inspect('volume', SOURCE_VOLUME)
        require(source.get('Name') == SOURCE_VOLUME and source.get('Driver') == 'local' and not source.get('Options'), 'SOURCE_VOLUME_UNTRUSTED')
        for role, name in self.names.items():
            require(self.docker.inspect('container' if role in ('worker', 'seed') else 'volume', name, True) is None, 'RESOURCE_ALREADY_EXISTS')
        self.state = {'schemaVersion': 1, 'identity': self.identity, 'instance': secrets.token_hex(32), 'resources': [], 'pending': None, 'state': 'preparing'}
        self.persist()
        for role in DIRECTORIES:
            self.create('volume', role)
        seed = self.create('container', 'seed')
        raw = self.docker.command(['container', 'start', '--attach', seed['id']], timeout=45)
        try:
            result = json.loads(raw)
        except ValueError:
            raise Refused('ACTIVATION_SEED_RECEIPT_INVALID') from None
        require(isinstance(result, dict) and result.get('schemaVersion') == 1 and result.get('state') == 'empty-verified'
                and result.get('executionUid') == 1002 and result.get('executionGid') == 1000
                and result.get('directoryMode') == '0750' and result.get('markerPresent') is False, 'ACTIVATION_SEED_NOT_EMPTY')
        self.verify_container(self.docker.inspect('container', seed['name']), 'seed', seed['id'])
        self.docker.command(['container', 'rm', seed['id']])
        seed['removed'] = True
        self.persist()
        worker = self.create('container', 'worker')
        self.docker.command(['container', 'start', worker['id']])
        deadline = self.clock() + 960
        while True:
            require(self.clock() < deadline, 'INITIAL_BACKUP_DEADLINE')
            current = self.docker.inspect('container', worker['name'])
            self.verify_container(current, 'worker', worker['id'])
            require(current.get('State', {}).get('Running') is True, 'BACKUP_WORKER_NOT_RUNNING')
            probe = self.docker.run(['container', 'exec', worker['id'], 'python3', '-I', '/opt/arthello-backup/probe.py', '--require-initial-verified'], timeout=20)
            if probe.returncode == 0:
                try:
                    receipt = json.loads(probe.stdout)
                except ValueError:
                    raise Refused('BACKUP_PROBE_RECEIPT_INVALID') from None
                require(isinstance(receipt, dict) and receipt.get('schemaVersion') == 1 and receipt.get('state') == 'verified'
                        and receipt.get('initialVerified') is True
                        and isinstance(receipt.get('initialBackupId'), str) and re.fullmatch(r'[A-Za-z0-9._:-]{1,160}', receipt['initialBackupId'])
                        and isinstance(receipt.get('lastVerifiedBackupId'), str) and re.fullmatch(r'[A-Za-z0-9._:-]{1,160}', receipt['lastVerifiedBackupId'])
                        and type(receipt.get('historyCount')) is int
                        and receipt['historyCount'] >= 1 and isinstance(receipt.get('nextAt'), str), 'BACKUP_PROBE_NOT_VERIFIED')
                try:
                    next_at = datetime.datetime.fromisoformat(receipt['nextAt'].replace('Z', '+00:00'))
                    require(next_at.tzinfo is not None, 'BACKUP_SCHEDULE_INVALID')
                except (TypeError, ValueError):
                    raise Refused('BACKUP_SCHEDULE_INVALID') from None
                break
            require(probe.returncode == 1, 'BACKUP_PROBE_FAILED')
            self.pause(2)
        self.docker.command(['container', 'update', '--restart', 'unless-stopped', worker['id']])
        current = self.docker.inspect('container', worker['name'])
        self.verify_container(current, 'worker', worker['id'])
        require(current.get('HostConfig', {}).get('RestartPolicy', {}).get('Name') == 'unless-stopped', 'BACKUP_RESTART_NOT_ENABLED')
        self.state['state'] = 'verified'
        self.state['probe'] = {key: receipt[key] for key in ('initialBackupId', 'lastVerifiedBackupId', 'nextAt', 'historyCount')}
        self.persist()
        return {'schemaVersion': 1, 'state': 'verified', **self.identity,
                'worker': {'name': worker['name'], 'id': worker['id']},
                'volumes': {role: {'name': self.names[role], 'labels': self.labels(role)} for role in DIRECTORIES},
                'backup': self.state['probe']}

    def cleanup(self):
        self.state = self.state_file.load()
        if self.state is None:
            return {'schemaVersion': 1, 'state': 'no-owned-state', 'removed': 0}
        require(isinstance(self.state, dict) and self.state.get('schemaVersion') == 1
                and self.state.get('identity') == self.identity
                and re.fullmatch(r'[0-9a-f]{64}', self.state.get('instance', '')), 'STATE_IDENTITY_MISMATCH')
        self.load_image()
        pending = self.state.get('pending')
        if pending:
            require(pending.get('role') in self.names and pending.get('name') == self.names[pending['role']]
                    and pending.get('kind') == ('container' if pending['role'] in ('worker', 'seed') else 'volume'), 'STATE_PENDING_INVALID')
            require(self.docker.inspect(pending['kind'], pending['name'], True) is None, 'OWNERSHIP_AMBIGUOUS')
        resources = self.state.get('resources')
        require(isinstance(resources, list) and len(resources) <= 5 and all(isinstance(record, dict) for record in resources), 'STATE_RESOURCES_INVALID')
        active = [record for record in resources if not record.get('removed')]
        allowed_ids = {record.get('id') for record in active if record.get('kind') == 'container'}
        present = []
        seen = set()
        for record in active:
            role, kind, name = record.get('role'), record.get('kind'), record.get('name')
            require(role in self.names and role not in seen and name == self.names[role]
                    and kind == ('container' if role in ('worker', 'seed') else 'volume'), 'STATE_RESOURCE_INVALID')
            if kind == 'container':
                require(isinstance(record.get('id'), str) and re.fullmatch(r'[0-9a-f]{64}', record['id']), 'STATE_CONTAINER_ID_INVALID')
            seen.add(role)
            current = self.docker.inspect(kind, name, True)
            if current is None:
                continue
            if kind == 'container':
                self.verify_container(current, role, record.get('id'))
            else:
                self.verify_volume(current, role, record)
                consumers = self.docker.command(['container', 'ls', '--all', '--quiet', '--no-trunc', '--filter', 'volume=' + name]).splitlines()
                require(all(re.fullmatch(r'[0-9a-f]{64}', item) and item in allowed_ids for item in consumers), 'VOLUME_HAS_FOREIGN_CONSUMER')
            present.append(record)
        removed = 0
        for record in sorted(present, key=lambda item: 0 if item['kind'] == 'container' else 1):
            if record['kind'] == 'container':
                self.verify_container(self.docker.inspect('container', record['name']), record['role'], record['id'])
                self.docker.command(['container', 'stop', '--time', '20', record['id']], timeout=30)
                self.docker.command(['container', 'rm', record['id']])
            else:
                self.verify_volume(self.docker.inspect('volume', record['name']), record['role'], record)
                require(not self.docker.command(['container', 'ls', '--all', '--quiet', '--no-trunc', '--filter', 'volume=' + record['name']]), 'VOLUME_HAS_CONSUMER')
                self.docker.command(['volume', 'rm', record['name']])
            record['removed'] = True
            removed += 1
            self.persist()
        self.state['state'] = 'cleaned'
        self.state['pending'] = None
        self.persist()
        return {'schemaVersion': 1, 'state': 'cleaned', 'removed': removed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('prepare', 'cleanup'))
    for argument in ('image-id', 'release-sha', 'tree-sha', 'run-id', 'attempt', 'source-relative', 'state-file'):
        parser.add_argument('--' + argument, required=True)
    args = parser.parse_args()
    state_file = None
    try:
        state_file = StateFile(args.state_file)
        runtime = Runtime(args, Docker(), state_file)
        print(json.dumps(getattr(runtime, args.command)(), sort_keys=True))
        return 0
    except Refused as error:
        print(json.dumps({'state': 'refused', 'code': str(error)}, sort_keys=True), file=sys.stderr)
    except (OSError, ValueError, KeyError, TypeError):
        print(json.dumps({'state': 'refused', 'code': 'LOCAL_PRECONDITION_FAILED'}, sort_keys=True), file=sys.stderr)
    finally:
        if state_file is not None:
            state_file.close()
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
