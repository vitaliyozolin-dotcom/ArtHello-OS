#!/usr/bin/env python3
"""Behavioral local fixtures; never Docker, production, credentials or network."""
import copy
import importlib.util
import json
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('r14', Path(__file__).with_name('r16-backup-adoption.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
r7 = m.r7


class MemoryState:
    def __init__(self, value=None):
        self.value = copy.deepcopy(value)
        self.writes = []

    def load(self):
        return copy.deepcopy(self.value)

    def write(self, value):
        self.value = copy.deepcopy(value)
        self.writes.append(copy.deepcopy(value))


def arguments(old=False):
    return SimpleNamespace(image_id=m.ACCEPTED_IMAGE if old else 'sha256:' + 'a' * 64,
                           release_sha=m.ACCEPTED_SHA if old else 'b' * 40,
                           tree_sha=m.ACCEPTED_TREE if old else 'c' * 40,
                           run_id=m.ACCEPTED_RUN if old else '40000000001', attempt='1',
                           source_relative=r7.SOURCE_RELATIVE)


def metadata(runtime, role, identity, running=False):
    uid = '1002' if role == 'seed' else '1000'
    mounts = runtime.mounts(role)
    env = list(runtime.image['Config']['Env'])
    if role == 'worker':
        env.append('ARTHELLO_BACKUP_SOURCE_RELATIVE=' + r7.SOURCE_RELATIVE)
    return {'Id': identity, 'Name': '/' + runtime.names[role], 'Image': runtime.args.image_id,
            'State': {'Running': running, 'Paused': False},
            'Config': {'Image': runtime.args.image_id, 'User': uid + ':1000', 'Entrypoint': ['python3'],
                       'Cmd': ['-I', '/opt/arthello-backup/' + ('activation-volume.py' if role == 'seed' else 'worker.py')]
                       + (['check-empty', '--directory', r7.DIRECTORIES['activation']] if role == 'seed' else []),
                       'Env': env, 'Labels': runtime.labels(role)},
            'HostConfig': {'NetworkMode': 'none', 'ReadonlyRootfs': True, 'CapDrop': ['ALL'],
                           'SecurityOpt': ['no-new-privileges:true'], 'PidsLimit': 64,
                           'Memory': 268435456, 'NanoCpus': 500000000,
                           'Tmpfs': {'/tmp': 'rw,uid=' + uid + ',gid=1000,mode=0700'},
                           'RestartPolicy': {'Name': 'unless-stopped' if running else 'no', 'MaximumRetryCount': 0},
                           'Mounts': [{'Type': 'volume', 'Source': n, 'Target': p, 'ReadOnly': ro,
                                       'VolumeOptions': {'NoCopy': nc}} for n, p, ro, nc in mounts]},
            'NetworkSettings': {'Networks': {'none': {}}},
            'Mounts': [{'Type': 'volume', 'Name': n, 'Destination': p, 'RW': not ro} for n, p, ro, nc in mounts]}


class FakeDocker:
    def __init__(self):
        self.objects, self.commands = {}, []
        self.runtime = None
        self.extra_workers, self.extra_readers = [], []
        self.health = {'schemaVersion': 1, 'state': 'verified', 'initialVerified': True,
                       'initialBackupId': 'initial-synthetic', 'lastVerifiedBackupId': 'latest-synthetic',
                       'historyCount': 4, 'nextAt': '2026-09-10T00:15:00+00:00'}
        self.fail_on = None

    def inspect(self, kind, name, missing=False):
        for (k, n), obj in self.objects.items():
            if kind == k and (name == n or name == obj.get('Id')):
                return copy.deepcopy(obj)
        if missing:
            return None
        raise r7.Refused('RESOURCE_INSPECT_FAILED')

    def command(self, args, timeout=30):
        self.commands.append(list(args))
        if self.fail_on and self.fail_on(args):
            raise r7.Refused('DOCKER_COMMAND_FAILED')
        if args[:2] == ['volume', 'create']:
            name = args[-1]
            labels = dict(args[i + 1].split('=', 1) for i, a in enumerate(args) if a == '--label')
            self.objects['volume', name] = {'Name': name, 'Driver': 'local', 'Options': {}, 'Scope': 'local',
                                           'CreatedAt': '2026-09-09T12:00:00Z', 'Labels': labels}
            return name
        if args[:2] == ['container', 'create']:
            self.objects['container', self.runtime.names['seed']] = metadata(self.runtime, 'seed', 'd' * 64)
            # The fake accepts only the exact isolated seed command emitted by the frozen source.
            if args != self.runtime.create_args('seed'):
                raise AssertionError('unexpected create command')
            return 'd' * 64
        if args[:2] == ['container', 'start'] and '--attach' in args:
            return json.dumps({'schemaVersion': 1, 'state': 'empty-verified', 'executionUid': 1002,
                               'executionGid': 1000, 'directoryMode': '0750', 'markerPresent': False})
        if args[:2] == ['container', 'exec']:
            return json.dumps(self.health)
        if args[:2] == ['container', 'ls']:
            filt = args[args.index('--filter') + 1]
            if filt.startswith('name=') or filt.startswith('label='):
                return '\n'.join([m.ACCEPTED_WORKER_ID, *self.extra_workers])
            if filt == 'volume=' + r7.SOURCE_VOLUME:
                ids = [obj['Id'] for (kind, name), obj in self.objects.items()
                       if kind == 'container' and any(v.get('Name') == r7.SOURCE_VOLUME for v in obj.get('Mounts', []))]
                return '\n'.join([*ids, *self.extra_readers])
            name = filt.removeprefix('volume=')
            return '\n'.join(obj['Id'] for (kind, key), obj in self.objects.items()
                             if kind == 'container' and any(v.get('Name') == name for v in obj.get('Mounts', [])))
        if args[:2] in (['container', 'update'], ['container', 'stop'], ['container', 'start'], ['container', 'rm']):
            obj = self.inspect('container', args[-1])
            key = ('container', obj['Name'].removeprefix('/'))
            if args[1] == 'update':
                obj['HostConfig']['RestartPolicy']['Name'] = next(x for x in args if x.startswith('--restart=')).split('=', 1)[1]
            elif args[1] == 'stop':
                obj['State']['Running'] = False
            elif args[1] == 'start':
                obj['State']['Running'] = True
            else:
                del self.objects[key]
                return obj['Id']
            self.objects[key] = obj
            return obj['Id']
        if args[:2] == ['volume', 'rm']:
            del self.objects['volume', args[-1]]
            return args[-1]
        raise AssertionError('Unexpected Docker command: ' + repr(args))

    def run(self, args, timeout=30):
        return SimpleNamespace(returncode=0, stdout=self.command(args, timeout), stderr='')


class Fixture(unittest.TestCase):
    def setUp(self):
        self.docker = FakeDocker()
        self.accepted, self.state = MemoryState(), MemoryState()
        self.old = r7.Runtime(arguments(True), self.docker, self.accepted)
        for args in [arguments(True), arguments()]:
            self.docker.objects['image', args.image_id] = {'Id': args.image_id, 'Config': {'User': 'node', 'Env': ['PATH=/usr/bin'],
                'Labels': {'org.opencontainers.image.revision': args.release_sha, 'org.opencontainers.image.source-tree': args.tree_sha}}}
        self.old.load_image()
        self.old.state = {'schemaVersion': 1, 'identity': self.old.identity, 'instance': 'e' * 64,
                          'resources': [], 'pending': None, 'state': 'verified', 'probe': dict(self.docker.health)}
        for role in ('backups', 'control', 'activation'):
            obj = {'Name': self.old.names[role], 'Driver': 'local', 'Options': {}, 'Scope': 'local',
                   'CreatedAt': '2026-09-09T08:08:00Z', 'Labels': self.old.labels(role)}
            self.docker.objects['volume', self.old.names[role]] = obj
            self.old.state['resources'].append(self.old.verify_volume(obj, role))
        worker = metadata(self.old, 'worker', m.ACCEPTED_WORKER_ID, True)
        self.docker.objects['container', self.old.names['worker']] = worker
        self.old.state['resources'].append(self.old.verify_container(worker, 'worker', m.ACCEPTED_WORKER_ID))
        self.old.state['resources'].append({'kind': 'container', 'role': 'seed', 'name': self.old.names['seed'],
                                           'id': '1' * 64, 'removed': True})
        self.accepted.value = copy.deepcopy(self.old.state)
        self.boundary_exists = False
        self.subject = m.Adoption(arguments(), self.docker, self.state, self.accepted, lambda: self.boundary_exists)
        self.preserved = copy.deepcopy(self.docker.objects)

    def prepare(self):
        # The adapter is the real frozen Runtime, not a second seed implementation.
        if hasattr(self.subject, 'owned'):
            self.docker.runtime = self.subject.owned
        return self.subject.prepare()

    def test_adopts_existing_history_and_creates_only_new_activation(self):
        result = self.prepare()
        self.assertEqual(result['state'], 'adopted')
        self.assertEqual(result['worker']['id'], m.ACCEPTED_WORKER_ID)
        self.assertEqual(result['backup']['historyCount'], 4)
        self.assertEqual(self.accepted.writes, [])
        for key, value in self.preserved.items():
            self.assertEqual(self.docker.objects[key], value)
        self.assertEqual([args[:2] for args in self.docker.commands if args[1] == 'create'],
                         [['volume', 'create'], ['container', 'create']])
        self.assertFalse(any(args[:2] == ['volume', 'rm'] for args in self.docker.commands))

    def refused(self, action, code):
        with self.assertRaisesRegex(r7.Refused, '^' + code + '$'):
            action()

    def worker(self):
        return self.docker.objects['container', self.old.names['worker']]

    def reboot(self):
        self.subject = m.Adoption(arguments(), self.docker, self.state, self.accepted, lambda: self.boundary_exists)

    def test_quiesce_proves_no_readers_then_restores_recorded_policy_and_health(self):
        self.prepare()
        self.assertEqual(self.subject.quiesce()['state'], 'quiesced')
        self.assertEqual(self.worker()['HostConfig']['RestartPolicy']['Name'], 'no')
        self.assertFalse(self.worker()['State']['Running'])
        self.assertEqual(self.subject.verify_copyback()['canonicalReaders'], 'none')
        self.reboot()
        self.assertEqual(self.subject.restore()['backup']['historyCount'], 4)
        self.assertTrue(self.worker()['State']['Running'])
        self.assertEqual(self.worker()['HostConfig']['RestartPolicy'], {'Name': 'unless-stopped', 'MaximumRetryCount': 0})
        phases = [s['phase'] for s in self.state.writes]
        self.assertLess(phases.index('quiescing'), phases.index('quiesced'))
        self.assertLess(phases.index('restoring'), len(phases) - 1)
        self.assertEqual(self.accepted.writes, [])

    def test_cleanup_restores_adopted_service_and_removes_only_owned_activation(self):
        self.prepare()
        self.subject.quiesce()
        self.reboot()
        result = self.subject.cleanup()
        self.assertEqual(result, {'schemaVersion': 14, 'state': 'cleaned', 'ownedRemoved': 1, 'adoptedRemoved': 0})
        for key, value in self.preserved.items():
            self.assertEqual(self.docker.objects[key], value)
        self.assertEqual(self.accepted.writes, [])
        self.assertEqual([a[-1] for a in self.docker.commands if a[:2] == ['volume', 'rm']],
                         [self.subject.owned.names['activation']])
        self.assertEqual(self.subject.cleanup()['ownedRemoved'], 0)

    def test_no_copyback_before_quiescence(self):
        self.prepare()
        self.refused(self.subject.verify_copyback, 'COPYBACK_PHASE_INVALID')

    def test_runtime_drift_wrong_worker_id_denies_before_creation(self):
        self.worker()['Id'] = 'f' * 64
        self.refused(self.prepare, 'RESOURCE_INSPECT_FAILED')
        self.assertIsNone(self.state.value)

    def test_accepted_state_identity_drift_denies_before_creation(self):
        self.accepted.value['identity']['releaseSha'] = 'f' * 40
        self.refused(self.prepare, 'ACCEPTED_STATE_INVALID')
        self.assertIsNone(self.state.value)

    def test_missing_historical_seed_record_does_not_match_verified_r7_state(self):
        self.accepted.value['resources'] = [r for r in self.accepted.value['resources'] if r['role'] != 'seed']
        self.refused(self.prepare, 'ACCEPTED_RESOURCES_INVALID')

    def test_accepted_state_hash_change_after_adoption_blocks_stop(self):
        self.prepare()
        self.accepted.value['probe']['historyCount'] += 1
        self.refused(self.subject.quiesce, 'ACCEPTED_STATE_CHANGED')
        self.assertTrue(self.worker()['State']['Running'])

    def test_recreated_history_volume_is_not_adopted(self):
        self.docker.objects['volume', self.old.names['backups']]['CreatedAt'] = 'later'
        self.refused(self.prepare, 'VOLUME_IDENTITY_CHANGED')

    def test_wrong_labels_and_extra_worker_mount_are_denied(self):
        for mutate, error in [
            (lambda: self.worker()['Config']['Labels'].update({r7.LABEL + 'instance': 'f' * 64}), 'RESOURCE_OWNERSHIP_MISMATCH'),
            (lambda: self.worker()['Mounts'].append({'Type': 'bind', 'Name': 'host', 'Destination': '/host', 'RW': True}), 'CONTAINER_MOUNT_MISMATCH'),
        ]:
            with self.subTest(error=error):
                self.setUp()
                mutate()
                self.refused(self.prepare, error)

    def test_paused_restarting_dead_stopped_or_wrong_restart_worker_is_not_adopted(self):
        for state in ({'Paused': True}, {'Restarting': True}, {'Dead': True}, {'Running': False}):
            with self.subTest(state=state):
                self.setUp()
                self.worker()['State'].update(state)
                self.refused(self.prepare, 'ACCEPTED_WORKER_NOT_HEALTHY' if state == {'Running': False} else 'WORKER_RUNTIME_UNSAFE')
        self.setUp()
        self.worker()['HostConfig']['RestartPolicy']['Name'] = 'no'
        self.refused(self.prepare, 'ACCEPTED_WORKER_NOT_HEALTHY')

    def test_duplicate_worker_is_rejected_even_if_stopped(self):
        self.docker.extra_workers = ['f' * 64]
        self.refused(self.prepare, 'DUPLICATE_BACKUP_WORKER')
        self.assertIsNone(self.state.value)

    def test_worker_hidden_under_another_name_on_canonical_mount_is_rejected(self):
        hidden = metadata(self.old, 'worker', 'f' * 64, False)
        hidden['Name'] = '/unexpected-backup'
        hidden['Config']['Labels'] = {}
        self.docker.objects['container', 'unexpected-backup'] = hidden
        self.refused(self.prepare, 'DUPLICATE_BACKUP_WORKER')

    def test_foreign_control_consumer_is_not_treated_as_a_candidate(self):
        foreign = {'Id': 'f' * 64, 'Name': '/foreign', 'Config': {}, 'State': {'Running': False, 'Paused': False},
                   'Mounts': [{'Type': 'volume', 'Name': self.old.names['control']}]}
        self.docker.objects['container', 'foreign'] = foreign
        self.refused(self.prepare, 'FOREIGN_BACKUP_CONSUMER')

    def candidate(self, mount):
        obj = {'Id': 'f' * 64, 'Name': '/arthello-direct-' + arguments().run_id + '-1',
               'Image': arguments().image_id, 'Config': {'Labels': {'arthello.release.sha': arguments().release_sha}},
               'State': {'Running': False, 'Paused': False},
               'Mounts': [mount], 'HostConfig': {'Mounts': [{'Type': 'volume', 'Source': self.old.names['control'],
                    'Target': r7.DIRECTORIES['control'], 'ReadOnly': True, 'VolumeOptions': {'NoCopy': True}}]}}
        self.docker.objects['container', obj['Name'][1:]] = obj
        return obj

    def test_candidate_may_mount_only_exact_readonly_control_without_history(self):
        correct = {'Type': 'volume', 'Name': self.old.names['control'], 'Destination': r7.DIRECTORIES['control'], 'RW': False}
        self.candidate(correct)
        self.assertEqual(self.prepare()['state'], 'adopted')
        for change in ({'RW': True}, {'Destination': '/other'}, {'Type': 'bind'},
                       {'Name': self.old.names['backups'], 'Destination': '/history', 'RW': True}):
            with self.subTest(change=change):
                self.setUp()
                self.candidate({**correct, **change})
                self.refused(self.prepare, 'APP_BACKUP_MOUNT_FORBIDDEN')

    def test_successful_probe_followed_by_stopped_service_does_not_pass(self):
        for operation in ('verify', 'restore', 'cleanup'):
            with self.subTest(operation=operation):
                self.setUp()
                self.prepare()
                if operation == 'restore':
                    self.subject.quiesce()
                original_run = self.docker.run
                def stop_after_probe(args, timeout=30):
                    result = original_run(args, timeout)
                    if args[:2] == ['container', 'exec']:
                        self.worker()['State']['Running'] = False
                    return result
                self.docker.run = stop_after_probe
                self.refused(getattr(self.subject, operation), 'BACKUP_WORKER_NOT_RUNNING')

    def test_initial_verified_and_existing_history_are_required(self):
        for change in ({'initialVerified': False}, {'historyCount': 0}, {'initialBackupId': 'different'}):
            with self.subTest(change=change):
                self.setUp()
                self.docker.health.update(change)
                self.refused(self.prepare, 'BACKUP_HEALTH_UNVERIFIED')

    def test_candidate_image_source_is_checked_before_owned_creation(self):
        self.docker.objects['image', arguments().image_id]['Config']['Labels']['org.opencontainers.image.revision'] = 'f' * 40
        self.refused(self.prepare, 'CANDIDATE_IMAGE_MISMATCH')
        self.assertIsNone(self.state.value)

    def test_duplicate_prepare_does_not_recreate_or_adopt_owned_resources(self):
        self.prepare()
        self.refused(self.prepare, 'STATE_ALREADY_EXISTS')

    def test_unknown_preexisting_activation_is_not_adopted(self):
        self.docker.objects['volume', self.subject.owned.names['activation']] = {'Name': self.subject.owned.names['activation']}
        self.refused(self.prepare, 'FRESH_RESOURCE_ALREADY_EXISTS')

    def test_stop_failure_preserves_intent_and_reloaded_restore_recovers(self):
        self.prepare()
        self.docker.fail_on = lambda args: args[:2] == ['container', 'stop']
        self.refused(self.subject.quiesce, 'DOCKER_COMMAND_FAILED')
        self.assertEqual(self.state.value['phase'], 'quiescing')
        self.assertEqual(self.worker()['HostConfig']['RestartPolicy']['Name'], 'no')
        self.docker.fail_on = None
        self.reboot()
        self.subject.restore()
        self.assertEqual(self.worker()['HostConfig']['RestartPolicy']['Name'], 'unless-stopped')
        self.assertTrue(self.worker()['State']['Running'])

    def test_stop_succeeds_but_command_reply_lost_reloaded_restore_recovers(self):
        self.prepare()
        command = self.docker.command
        def lost_reply(args, timeout=30):
            result = command(args, timeout)
            if args[:2] == ['container', 'stop']:
                raise r7.Refused('DOCKER_TIMEOUT')
            return result
        self.docker.command = lost_reply
        self.refused(self.subject.quiesce, 'DOCKER_TIMEOUT')
        self.assertFalse(self.worker()['State']['Running'])
        self.docker.command = command
        self.reboot()
        self.subject.restore()
        self.assertTrue(self.worker()['State']['Running'])

    def test_restore_start_failure_is_retryable_and_does_not_delete_history(self):
        self.prepare()
        self.subject.quiesce()
        self.docker.fail_on = lambda args: args[:2] == ['container', 'start']
        self.refused(self.subject.restore, 'DOCKER_COMMAND_FAILED')
        self.assertEqual(self.state.value['phase'], 'restoring')
        self.docker.fail_on = None
        self.reboot()
        self.subject.restore()
        self.assertTrue(self.worker()['State']['Running'])
        self.assertEqual(self.accepted.writes, [])

    def test_failed_restored_health_does_not_claim_success(self):
        self.prepare()
        self.subject.quiesce()
        self.docker.health['initialVerified'] = False
        self.refused(self.subject.restore, 'BACKUP_HEALTH_UNVERIFIED')
        self.assertEqual(self.state.value['phase'], 'restoring')
        self.docker.health['initialVerified'] = True
        self.subject.restore()

    def test_restored_service_can_warm_up_without_claiming_early_health(self):
        self.prepare()
        self.subject.quiesce()
        original_run = self.docker.run
        attempts = []
        def warming(args, timeout=30):
            if args[:2] == ['container', 'exec']:
                attempts.append(args)
                if len(attempts) < 3:
                    return SimpleNamespace(returncode=1, stdout='', stderr='')
            return original_run(args, timeout)
        self.docker.run = warming
        self.subject.pause = lambda seconds: None
        self.assertEqual(self.subject.restore()['state'], 'adopted')
        self.assertEqual(len(attempts), 3)

    def test_fresh_canonical_consumer_blocks_copyback_after_worker_stopped(self):
        self.prepare()
        self.subject.quiesce()
        self.docker.objects['container', 'live-candidate'] = {
            'Id': 'f' * 64, 'Name': '/live-candidate', 'Config': {},
            'State': {'Running': True, 'Paused': False},
            'Mounts': [{'Type': 'volume', 'Name': r7.SOURCE_VOLUME}]}
        self.refused(self.subject.verify_copyback, 'CANONICAL_CONSUMER_ACTIVE')

    def test_stopped_canonical_consumer_with_restart_enabled_blocks_copyback(self):
        self.prepare()
        self.subject.quiesce()
        self.docker.objects['container', 'restartable-candidate'] = {
            'Id': 'f' * 64, 'Name': '/restartable-candidate', 'Config': {},
            'State': {'Running': False, 'Paused': False},
            'HostConfig': {'RestartPolicy': {'Name': 'unless-stopped', 'MaximumRetryCount': 0}},
            'Mounts': [{'Type': 'volume', 'Name': r7.SOURCE_VOLUME}]}
        self.refused(self.subject.verify_copyback, 'CANONICAL_CONSUMER_ACTIVE')

    def test_backup_warmup_deadline_leaves_recoverable_intent(self):
        self.prepare()
        self.subject.quiesce()
        times = iter((0, 30, 60))
        self.subject.clock = lambda: next(times)
        self.subject.pause = lambda seconds: None
        self.docker.run = lambda args, timeout=30: SimpleNamespace(returncode=1, stdout='', stderr='')
        self.refused(self.subject.restore, 'BACKUP_PROBE_NOT_READY')
        self.assertEqual(self.state.value['phase'], 'restoring')
        self.assertTrue(self.worker()['State']['Running'])

    def test_external_auth_boundary_denies_copyback_cleanup_and_stop(self):
        self.prepare()
        self.subject.quiesce()
        self.boundary_exists = True
        for action in (self.subject.verify_copyback, self.subject.cleanup, self.subject.quiesce):
            self.refused(action, 'AUTH_OR_PUBLIC_BOUNDARY')
        # Recovering the adopted backup reader is still allowed; this is not DB restore.
        self.subject.restore()
        self.assertTrue(self.worker()['State']['Running'])

    def test_seal_is_durable_and_forbids_destructive_cleanup(self):
        self.prepare()
        self.assertEqual(self.subject.seal()['state'], 'sealed')
        self.reboot()
        for action in (self.subject.verify_copyback, self.subject.cleanup, self.subject.quiesce):
            self.refused(action, 'AUTH_OR_PUBLIC_BOUNDARY')
        self.assertEqual(self.subject.verify()['state'], 'sealed')

    def test_owned_state_cannot_smuggle_adopted_history_into_cleanup(self):
        self.prepare()
        self.state.value['owned']['resources'].append(self.accepted.value['resources'][0])
        self.refused(self.subject.cleanup, 'OWNED_SCOPE_INVALID')
        self.assertFalse(any(a[:2] == ['volume', 'rm'] for a in self.docker.commands))

    def test_owned_activation_with_stopped_consumer_is_preserved(self):
        self.prepare()
        self.docker.objects['container', 'stopped-candidate'] = {
            'Id': 'f' * 64, 'Name': '/stopped-candidate', 'Config': {},
            'State': {'Running': False, 'Paused': False},
            'Mounts': [{'Type': 'volume', 'Name': self.subject.owned.names['activation']}]}
        self.refused(self.subject.cleanup, 'VOLUME_HAS_FOREIGN_CONSUMER')
        self.assertIn(('volume', self.subject.owned.names['activation']), self.docker.objects)

    def test_pending_ambiguous_volume_is_preserved(self):
        self.prepare()
        activation = self.state.value['owned']['resources'][0]
        self.state.value['owned']['resources'] = []
        self.state.value['owned']['pending'] = {k: activation[k] for k in ('kind', 'role', 'name')}
        self.state.value['phase'] = 'preparing'
        self.refused(self.subject.cleanup, 'OWNERSHIP_AMBIGUOUS')

    def test_copyback_requires_current_stopped_identity_not_old_receipt(self):
        self.prepare()
        self.subject.quiesce()
        self.worker()['State']['Running'] = True
        self.refused(self.subject.verify_copyback, 'WORKER_NOT_QUIESCED')


class DurableBoundaryTests(unittest.TestCase):
    def test_frozen_loader_executes_checked_bytes_even_if_dependency_is_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            helper = Path(directory) / 'r16-backup-adoption.py'
            frozen = Path(directory) / 'r7-backup-runtime.py'
            helper.write_bytes(Path(m.__file__).read_bytes())
            frozen.write_bytes(Path(m.__file__).with_name('r7-backup-runtime.py').read_bytes())
            original_read = Path.read_bytes
            def replace_after_read(path):
                raw = original_read(path)
                if path == frozen:
                    path.write_text('raise RuntimeError("UNVERIFIED_BYTES_EXECUTED")\n')
                return raw
            spec = importlib.util.spec_from_file_location('isolated_r14_fixture', helper)
            module = importlib.util.module_from_spec(spec)
            with mock.patch.object(Path, 'read_bytes', replace_after_read):
                spec.loader.exec_module(module)
            self.assertTrue(hasattr(module.r7, 'Runtime'))

    def test_same_run_later_attempt_can_recover_original_resources_but_not_prepare(self):
        args = arguments()
        args.command = 'restore'
        env = {'GITHUB_REPOSITORY': 'vitaliyozolin-dotcom/ArtHello-OS',
               'GITHUB_ACTOR': 'vitaliyozolin-dotcom', 'GITHUB_TRIGGERING_ACTOR': 'vitaliyozolin-dotcom',
               'GITHUB_EVENT_NAME': 'workflow_run', 'RELEASE_SHA': args.release_sha,
               'GITHUB_RUN_ID': args.run_id, 'GITHUB_RUN_ATTEMPT': '2'}
        m.protected_context(args, env, 995)
        args.command = 'prepare'
        with self.assertRaisesRegex(r7.Refused, 'PROTECTED_RELEASE_CONTEXT_REQUIRED'):
            m.protected_context(args, env, 995)
        args.command = 'restore'
        for change, uid in [({'GITHUB_RUN_ID': '50000000001'}, 995), ({'GITHUB_ACTOR': 'outsider'}, 995),
                            ({'GITHUB_EVENT_NAME': 'workflow_dispatch'}, 995), ({}, 0),
                            ({'GITHUB_RUN_ATTEMPT': '0'}, 995)]:
            with self.subTest(change=change, uid=uid), self.assertRaisesRegex(r7.Refused, 'PROTECTED_RELEASE_CONTEXT_REQUIRED'):
                m.protected_context(args, {**env, **change}, uid)

    def test_real_auth_and_public_files_including_symlinks_close_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                boundary = m.DurableBoundary(fd, arguments().release_sha)
                self.assertFalse(boundary())
                candidate = Path(directory) / ('candidate-acceptance-' + arguments().release_sha + '.json')
                candidate.write_text('malformed but present')
                self.assertTrue(boundary())
                candidate.unlink()
                public = Path(directory) / ('activation-' + arguments().release_sha + '.json')
                public.symlink_to('/does-not-exist')
                self.assertTrue(boundary())
            finally:
                os.close(fd)


if __name__ == '__main__':
    unittest.main(verbosity=2)
