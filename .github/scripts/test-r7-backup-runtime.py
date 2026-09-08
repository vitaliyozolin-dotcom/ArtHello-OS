#!/usr/bin/env python3
"""Behavioral Docker adapter/state filesystem tests; no real Docker or production calls."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('r7_runtime', Path(__file__).with_name('r7-backup-runtime.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeDocker:
    def __init__(self):
        self.commands = []
        self.objects = {('image', 'sha256:' + 'a' * 64): {'Id': 'sha256:' + 'a' * 64, 'Config': {'Env': ['PATH=/usr/bin', 'NODE_ENV=production']}}}
        self.objects[('volume', module.SOURCE_VOLUME)] = {'Name': module.SOURCE_VOLUME, 'Driver': 'local', 'Options': None}
        self.probe_code = 0
        self.probe = {'schemaVersion': 1, 'state': 'verified', 'initialVerified': True,
                      'initialBackupId': 'initial', 'lastVerifiedBackupId': 'initial', 'historyCount': 1, 'nextAt': '2026-09-09T00:15:00+00:00'}
        self.counter = 0
        self.corrupt_created = None
        self.crash_after_create = False
        self.foreign_consumers = []
        self.inspect_error = False

    def inspect(self, kind, name, missing=False):
        if self.inspect_error:
            raise module.Refused('RESOURCE_INSPECT_FAILED')
        value = self.objects.get((kind, name))
        if value is None and not missing:
            raise module.Refused('RESOURCE_INSPECT_FAILED')
        return copy.deepcopy(value)

    def locate(self, object_id):
        return next((key for key, value in self.objects.items() if value.get('Id') == object_id), None)

    def run(self, args, timeout=30):
        self.commands.append(list(args))
        if args[:2] == ['container', 'exec']:
            return SimpleNamespace(returncode=self.probe_code, stdout=json.dumps(self.probe), stderr='private simulated diagnostic')
        return SimpleNamespace(returncode=0, stdout=self.command(args, timeout), stderr='')

    def command(self, args, timeout=30):
        self.commands.append(list(args))
        if args[:2] == ['volume', 'create']:
            name = args[-1]
            labels = dict(args[index + 1].split('=', 1) for index, value in enumerate(args) if value == '--label')
            self.counter += 1
            self.objects[('volume', name)] = {'Name': name, 'Labels': labels, 'Driver': 'local', 'Scope': 'local', 'Options': None, 'CreatedAt': f'2026-09-08T12:00:{self.counter:02d}Z'}
            if self.crash_after_create:
                raise module.Refused('DOCKER_COMMAND_FAILED')
            return name
        if args[:2] == ['container', 'create']:
            self.counter += 1
            name, uid = args[args.index('--name') + 1], args[args.index('--user') + 1]
            image_index = args.index('--entrypoint') + 2
            image, command = args[image_index], args[image_index + 1:]
            labels = dict(args[index + 1].split('=', 1) for index, value in enumerate(args) if value == '--label')
            base_env = dict(item.split('=', 1) for item in self.objects[('image', image)]['Config']['Env'])
            for index, value in enumerate(args):
                if value == '--env':
                    key, val = args[index + 1].split('=', 1)
                    base_env[key] = val
            mounts, configured_mounts = [], []
            for index, value in enumerate(args):
                if value != '--mount':
                    continue
                options = dict((entry.split('=', 1) if '=' in entry else (entry, True)) for entry in args[index + 1].split(','))
                mounts.append({'Type': options['type'], 'Name': options['source'], 'Destination': options['target'], 'RW': not options.get('readonly', False)})
                configured_mounts.append({'Type': options['type'], 'Source': options['source'], 'Target': options['target'], 'ReadOnly': bool(options.get('readonly')), 'VolumeOptions': {'NoCopy': bool(options.get('volume-nocopy'))}})
            object_id = f'{self.counter:064x}'
            value = {'Id': object_id, 'Name': '/' + name, 'Image': image,
                     'Config': {'Image': image, 'User': uid, 'Entrypoint': ['python3'], 'Cmd': command,
                                'Labels': labels, 'Env': [key + '=' + val for key, val in base_env.items()]},
                     'HostConfig': {'NetworkMode': args[args.index('--network') + 1], 'ReadonlyRootfs': '--read-only' in args,
                                    'CapDrop': [args[args.index('--cap-drop') + 1]], 'CapAdd': [], 'Privileged': False,
                                    'SecurityOpt': [args[args.index('--security-opt') + 1]], 'PidsLimit': int(args[args.index('--pids-limit') + 1]),
                                    'Memory': 268435456, 'NanoCpus': 500000000,
                                    'Tmpfs': {'/tmp': args[args.index('--tmpfs') + 1].split(':', 1)[1]},
                                    'RestartPolicy': {'Name': 'no'}, 'Mounts': configured_mounts},
                     'NetworkSettings': {'Networks': {'none': {}}}, 'Mounts': mounts, 'State': {'Running': False}}
            if self.corrupt_created:
                self.corrupt_created(value, name)
            self.objects[('container', name)] = value
            return object_id
        if args[:2] == ['container', 'start']:
            key = self.locate(args[-1])
            self.objects[key]['State']['Running'] = True
            if '--attach' in args:
                self.objects[key]['State']['Running'] = False
                return json.dumps({'schemaVersion': 1, 'state': 'empty-verified', 'executionUid': 1002, 'executionGid': 1000, 'directoryMode': '0750', 'markerPresent': False})
            return args[-1]
        if args[:2] == ['container', 'update']:
            self.objects[self.locate(args[-1])]['HostConfig']['RestartPolicy']['Name'] = args[args.index('--restart') + 1]
            return args[-1]
        if args[:2] == ['container', 'stop']:
            self.objects[self.locate(args[-1])]['State']['Running'] = False
            return args[-1]
        if args[:2] == ['container', 'rm']:
            self.objects.pop(self.locate(args[-1]))
            return args[-1]
        if args[:2] == ['container', 'ls']:
            volume = args[-1].removeprefix('volume=')
            owned = [value['Id'] for (kind, _), value in self.objects.items() if kind == 'container' and any(mount.get('Name') == volume for mount in value['Mounts'])]
            return '\n'.join([*owned, *self.foreign_consumers])
        if args[:2] == ['volume', 'rm']:
            self.objects.pop(('volume', args[-1]))
            return args[-1]
        raise AssertionError('unexpected Docker command: ' + repr(args))


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        os.chmod(self.directory.name, 0o700)
        self.state_path = Path(self.directory.name) / 'backup-runtime-state.json'
        self.state = module.StateFile(str(self.state_path))
        self.docker = FakeDocker()
        self.time = 0
        self.args = SimpleNamespace(image_id='sha256:' + 'a' * 64, release_sha='b' * 40, tree_sha='c' * 40,
                                    run_id='1234', attempt='2', source_relative=module.SOURCE_RELATIVE)
        self.runtime = module.Runtime(self.args, self.docker, self.state, clock=lambda: self.time, pause=self.advance)

    def advance(self, seconds):
        self.time += seconds

    def tearDown(self):
        self.state.close()
        self.directory.cleanup()

    def test_prepare_uses_only_narrow_volumes_roles_and_waits_for_verified_backup_before_restart(self):
        receipt = self.runtime.prepare()
        self.assertEqual(receipt['state'], 'verified')
        self.assertEqual(stat.S_IMODE(self.state_path.stat().st_mode), 0o600)
        worker = self.docker.objects[('container', self.runtime.names['worker'])]
        self.assertEqual(worker['Config']['User'], '1000:1000')
        self.assertEqual(worker['HostConfig']['RestartPolicy']['Name'], 'unless-stopped')
        self.assertNotIn(self.runtime.names['activation'], [item['Name'] for item in worker['Mounts']])
        self.assertEqual(next(item for item in worker['Mounts'] if item['Name'] == module.SOURCE_VOLUME)['RW'], False)
        seed_create = next(command for command in self.docker.commands if command[:2] == ['container', 'create'] and self.runtime.names['seed'] in command)
        self.assertIn('1002:1000', seed_create)
        self.assertNotIn('--env', seed_create)
        all_commands = json.dumps(self.docker.commands)
        for forbidden in ('--privileged', '--env-file', 'sudo', 'chown', '/var/run/docker.sock', 'type=bind', 'host:/'):
            self.assertNotIn(forbidden, all_commands)
        self.assertLess(next(i for i, c in enumerate(self.docker.commands) if c[:2] == ['container', 'exec']),
                        next(i for i, c in enumerate(self.docker.commands) if c[:2] == ['container', 'update']))

    def test_preexisting_even_matching_label_resource_is_never_adopted_or_cleaned(self):
        self.docker.objects[('volume', self.runtime.names['backups'])] = {'Name': self.runtime.names['backups'], 'Labels': {module.LABEL + 'scope': 'backup-runtime-v1'}}
        with self.assertRaisesRegex(module.Refused, 'RESOURCE_ALREADY_EXISTS'):
            self.runtime.prepare()
        self.assertFalse(self.state_path.exists())
        self.assertEqual(self.runtime.cleanup()['state'], 'no-owned-state')
        self.assertEqual(self.docker.commands, [])

    def test_explicit_tmpfs_inspect_projection_is_accepted_only_for_exact_private_tmp(self):
        self.docker.corrupt_created = lambda value, name: value['Mounts'].append({'Type': 'tmpfs', 'Destination': '/tmp', 'Source': '', 'RW': True})
        self.assertEqual(self.runtime.prepare()['state'], 'verified')
        self.assertEqual(self.runtime.cleanup()['state'], 'cleaned')

    def test_failed_inspect_does_not_count_as_absence(self):
        self.docker.inspect_error = True
        with self.assertRaisesRegex(module.Refused, 'RESOURCE_INSPECT_FAILED'):
            self.runtime.prepare()
        self.assertFalse(self.state_path.exists())
        self.assertEqual(self.docker.commands, [])

    def test_unknown_creation_window_refuses_cleanup_instead_of_adopting_labels(self):
        self.docker.crash_after_create = True
        with self.assertRaises(module.Refused):
            self.runtime.prepare()
        snapshot = copy.deepcopy(self.docker.objects)
        with self.assertRaisesRegex(module.Refused, 'OWNERSHIP_AMBIGUOUS'):
            self.runtime.cleanup()
        self.assertEqual(self.docker.objects, snapshot)

    def test_source_and_image_args_reject_paths_traversal_tags_unrelated_database(self):
        for field, value in [('source_relative', '../live.sqlite'), ('source_relative', module.SOURCE_RELATIVE.replace('5a499', '4a499')),
                             ('image_id', 'arthello:latest'), ('release_sha', 'main'), ('run_id', '1;echo')]:
            args = copy.deepcopy(self.args)
            setattr(args, field, value)
            with self.assertRaises(module.Refused):
                module.Runtime(args, self.docker, self.state)
        self.assertEqual(self.docker.commands, [])

    def test_wrong_worker_user_read_write_source_or_activation_mount_are_refused_before_worker_start(self):
        changes = [lambda value: value['Config'].update(User='0:0'),
                   lambda value: value['Mounts'][0].update(RW=True),
                   lambda value: value['Mounts'].append({'Type': 'volume', 'Name': 'activation', 'Destination': '/extra', 'RW': True}),
                   lambda value: value['HostConfig'].update(Privileged=True),
                   lambda value: value['Config']['Env'].append('SECRET=not-authorized'),
                   lambda value: value['HostConfig']['Mounts'][0]['VolumeOptions'].update(NoCopy=False),
                   lambda value: value['Mounts'].append({'Type': 'tmpfs', 'Destination': '/elsewhere', 'RW': True}),
                   lambda value: value['Mounts'].append({'Type': 'tmpfs', 'Destination': '/tmp', 'RW': False}),
                   lambda value: value['Mounts'].append({'Type': 'tmpfs', 'Destination': '/tmp', 'Source': '/host', 'RW': True}),
                   lambda value: value['Mounts'].extend([{'Type': 'tmpfs', 'Destination': '/tmp', 'RW': True}] * 2)]
        for change in changes:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                os.chmod(directory, 0o700)
                state = module.StateFile(directory + '/backup-runtime-state.json')
                docker = FakeDocker()
                docker.corrupt_created = lambda value, name: change(value) if 'worker' in name else None
                runtime = module.Runtime(self.args, docker, state)
                try:
                    with self.assertRaises(module.Refused):
                        runtime.prepare()
                    worker_id = docker.objects[('container', runtime.names['worker'])]['Id']
                    self.assertFalse(any(command[:2] == ['container', 'start'] and command[-1] == worker_id for command in docker.commands))
                finally:
                    state.close()

    def test_probe_failure_or_timeout_never_enables_restart(self):
        for pending in (False, True):
            with self.subTest(pending=pending), tempfile.TemporaryDirectory() as directory:
                os.chmod(directory, 0o700)
                state = module.StateFile(directory + '/backup-runtime-state.json')
                docker = FakeDocker()
                docker.probe_code = 1 if pending else 2
                runtime = module.Runtime(self.args, docker, state, clock=lambda: self.time, pause=self.advance)
                try:
                    with self.assertRaisesRegex(module.Refused, 'INITIAL_BACKUP_DEADLINE|BACKUP_PROBE_FAILED'):
                        runtime.prepare()
                    self.assertFalse(any(command[:2] == ['container', 'update'] for command in docker.commands))
                    self.assertEqual(runtime.cleanup()['state'], 'cleaned')
                finally:
                    state.close()

    def test_unverified_probe_json_is_not_success(self):
        self.docker.probe['initialVerified'] = False
        with self.assertRaisesRegex(module.Refused, 'BACKUP_PROBE_NOT_VERIFIED'):
            self.runtime.prepare()
        self.assertFalse(any(command[:2] == ['container', 'update'] for command in self.docker.commands))

    def test_cleanup_only_recorded_id_createdat_and_labels_then_preserves_source(self):
        self.runtime.prepare()
        receipt = self.runtime.cleanup()
        self.assertEqual(receipt, {'schemaVersion': 1, 'state': 'cleaned', 'removed': 4})
        self.assertIn(('volume', module.SOURCE_VOLUME), self.docker.objects)
        self.assertEqual(self.runtime.cleanup()['removed'], 0)
        self.assertFalse(any('--force' in command for command in self.docker.commands))

    def test_foreign_mount_prevents_any_cleanup_mutation(self):
        self.runtime.prepare()
        self.docker.foreign_consumers = ['d' * 64]
        before = copy.deepcopy(self.docker.objects)
        with self.assertRaisesRegex(module.Refused, 'VOLUME_HAS_FOREIGN_CONSUMER'):
            self.runtime.cleanup()
        self.assertEqual(self.docker.objects, before)

    def test_replaced_volume_or_container_identity_is_never_deleted(self):
        self.runtime.prepare()
        volume = self.docker.objects[('volume', self.runtime.names['control'])]
        before = volume['CreatedAt']
        volume['CreatedAt'] = '2027-01-01T00:00:00Z'
        with self.assertRaisesRegex(module.Refused, 'VOLUME_IDENTITY_CHANGED'):
            self.runtime.cleanup()
        volume['CreatedAt'] = before
        self.docker.objects[('container', self.runtime.names['worker'])]['Id'] = 'd' * 64
        with self.assertRaisesRegex(module.Refused, 'CONTAINER_IDENTITY_CHANGED|VOLUME_HAS_FOREIGN_CONSUMER'):
            self.runtime.cleanup()
        self.assertIn(('volume', self.runtime.names['control']), self.docker.objects)

    def test_state_wrong_release_mode_symlink_hardlink_are_rejected(self):
        self.runtime.prepare()
        args = copy.deepcopy(self.args)
        args.release_sha = 'd' * 40
        with self.assertRaisesRegex(module.Refused, 'STATE_IDENTITY_MISMATCH'):
            module.Runtime(args, self.docker, self.state).cleanup()
        os.chmod(self.state_path, 0o644)
        with self.assertRaisesRegex(module.Refused, 'STATE_FILE_UNTRUSTED'):
            self.runtime.cleanup()
        os.chmod(self.state_path, 0o600)
        link = self.state_path.with_name('hardlink')
        os.link(self.state_path, link)
        with self.assertRaisesRegex(module.Refused, 'STATE_FILE_UNTRUSTED'):
            self.runtime.cleanup()
        link.unlink()
        self.state_path.rename(link)
        self.state_path.symlink_to(link)
        with self.assertRaises(OSError):
            self.runtime.cleanup()


class DockerAbsenceTests(unittest.TestCase):
    def test_missing_volume_variants_are_narrow_and_daemon_errors_refuse(self):
        docker = module.Docker()
        for stderr in ['Error: No such volume: exact-name', 'Error response from daemon: get exact-name: no such volume']:
            with patch.object(docker, 'run', return_value=SimpleNamespace(returncode=1, stdout='[]', stderr=stderr)):
                self.assertIsNone(docker.inspect('volume', 'exact-name', True))
        for stderr in ['permission denied', 'Error: No such volume: another-name', 'Cannot connect to Docker daemon']:
            with patch.object(docker, 'run', return_value=SimpleNamespace(returncode=1, stdout='', stderr=stderr)):
                with self.assertRaisesRegex(module.Refused, 'RESOURCE_INSPECT_FAILED'):
                    docker.inspect('volume', 'exact-name', True)


if __name__ == '__main__':
    unittest.main()
