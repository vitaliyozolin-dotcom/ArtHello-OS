#!/usr/bin/env python3
"""Actual state and adoption logic with synthetic metadata; no Docker/network."""
import copy
from contextlib import redirect_stdout
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m = load('r14_controller_test', 'r14-backup-controller.py')
fixture = load('r14_adoption_fixtures', 'test-r14-backup-adoption.py')
REFUSED = (m.r7.Refused, fixture.r7.Refused, OSError, ValueError, KeyError, TypeError)


def private(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_text(json.dumps(value))
    path.chmod(0o600)


class ReadOnlyFake:
    def __init__(self, backend):
        self.backend, self.calls = backend, []

    def inspect(self, kind, name, missing=False):
        self.calls.append(('inspect', kind, name, missing))
        return self.backend.inspect(kind, name, missing)

    def command(self, args, timeout=30):
        self.calls.append(('command', list(args)))
        if args[:6] != ['container', 'ls', '--all', '--quiet', '--no-trunc', '--filter']:
            raise AssertionError('Unexpected read-only command')
        return self.backend.command(args, timeout)

    def run(self, args, timeout=30):
        self.calls.append(('run', list(args)))
        if args != ['container', 'exec', m.adoption.ACCEPTED_WORKER_ID, 'python3', '-I',
                    '/opt/arthello-backup/probe.py', '--require-initial-verified']:
            raise AssertionError('Unexpected probe command')
        return SimpleNamespace(returncode=0, stdout=json.dumps(self.backend.health), stderr='')


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path.home())
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.root = self.home / '.config/arthello/release-state'
        parent = self.home
        for name in ('.config', 'arthello', 'release-state'):
            parent /= name
            parent.mkdir(mode=0o700)
        self.home_patch = patch.object(m.Path, 'home', return_value=self.home)
        self.home_patch.start()
        self.addCleanup(self.home_patch.stop)
        self.f = fixture.Fixture()
        self.f.setUp()
        self.args = fixture.arguments()
        self.args.command, self.args.phase = 'consumers', 'live'
        self.own = self.root / ('backup-adoption-r14-' + self.args.run_id + '-1') / 'backup-runtime-state.json'
        self.accepted = self.root / ('backup-runtime-' + m.adoption.ACCEPTED_RUN + '-1') / 'backup-runtime-state.json'
        private(self.accepted, self.f.accepted.load())
        self.docker = ReadOnlyFake(self.f.docker)
        self.old = self.app(old=True)
        self.f.docker.objects['container', self.old['Name'][1:]] = self.old
        self.new = None

    def app(self, old=False):
        args = fixture.arguments(old)
        if old:
            args = SimpleNamespace(run_id=m.adoption.LIVE_RUN, image_id=m.adoption.LIVE_IMAGE,
                                   release_sha=m.adoption.LIVE_SHA)
        name = 'arthello-direct-' + args.run_id + '-1'
        control = self.f.old.names['control']
        return {'Id': m.adoption.LIVE_APP_ID if old else '9' * 64, 'Name': '/' + name,
                'Image': args.image_id, 'Config': {'Labels': {'arthello.release.sha': args.release_sha}},
                'State': {'Running': True, 'Paused': False, 'Restarting': False, 'Dead': False},
                'Mounts': [{'Type': 'volume', 'Name': m.r7.SOURCE_VOLUME, 'Destination': '/data', 'RW': True},
                           {'Type': 'volume', 'Name': control, 'Destination': m.r7.DIRECTORIES['control'], 'RW': False}],
                'HostConfig': {'RestartPolicy': {'Name': 'unless-stopped', 'MaximumRetryCount': 0},
                               'Mounts': [{'Type': 'volume', 'Source': control, 'Target': m.r7.DIRECTORIES['control'],
                                           'ReadOnly': True, 'VolumeOptions': {'NoCopy': True}}]}}

    def prepare(self, sealed=False):
        self.f.prepare()
        if sealed:
            self.f.subject.seal()
        private(self.own, self.f.state.load())
        self.f.docker.commands.clear()
        self.docker.calls.clear()

    def set_phase(self, phase):
        self.args.phase = phase
        self.old['State'].update(Running=phase in ('live', 'live-paused'), Paused=phase == 'live-paused')
        self.old['HostConfig']['RestartPolicy']['Name'] = 'unless-stopped' if self.old['State']['Running'] else 'no'
        if self.new:
            self.f.docker.objects.pop(('container', self.new['Name'][1:]), None)
            self.new = None
        if phase.startswith('candidate'):
            self.new = self.app()
            self.new['State']['Paused'] = phase == 'candidate-paused'
            self.f.docker.objects['container', self.new['Name'][1:]] = self.new

    def read(self, path):
        return json.loads(path.read_text())

    def live_context(self):
        context = {'releaseSha': m.adoption.LIVE_SHA, 'sourceTree': m.adoption.LIVE_TREE,
                   'runId': m.adoption.LIVE_RUN, 'runAttempt': '1',
                   'candidateContainerId': m.adoption.LIVE_APP_ID,
                   'candidateName': 'arthello-direct-' + m.adoption.LIVE_RUN + '-1',
                   'imageId': m.adoption.LIVE_IMAGE, 'dataVolume': m.r7.SOURCE_VOLUME,
                   'previousContainerId': m.adoption.ACCEPTED_APP_ID,
                   'previousName': 'arthello-direct-' + m.adoption.ACCEPTED_RUN + '-1'}
        self.live_historical = {'schemaVersion': 1, 'phase': 'public-started', 'context': context,
                               'contextSha256': hashlib.sha256((json.dumps(context, sort_keys=True, separators=(',', ':')) + '\n').encode()).hexdigest()}
        self.live_historical_path = self.root / ('candidate-acceptance-' + m.adoption.LIVE_SHA + '.json')
        private(self.live_historical_path, self.live_historical)
        live_patch = patch.object(m, 'LIVE_CONTEXT_SHA256', self.live_historical['contextSha256'])
        live_patch.start()
        self.addCleanup(live_patch.stop)

    def predecessor(self):
        """Synthetic accepted context exercises the fixed-digest mechanism, not live evidence."""
        ControllerTests.live_context(self)
        key = m.adoption.ACCEPTED_RUN + '-1'
        work = self.root / 'candidate-work' / ('arthello-deploy-' + key)
        previous_id, previous_name = '6' * 64, 'arthello-direct-30000000001-1'
        context = {'releaseSha': m.adoption.ACCEPTED_SHA, 'sourceTree': m.adoption.ACCEPTED_TREE,
                   'runId': m.adoption.ACCEPTED_RUN, 'runAttempt': '1',
                   'candidateContainerId': m.adoption.ACCEPTED_APP_ID, 'candidateName': 'arthello-direct-' + key,
                   'imageId': m.adoption.ACCEPTED_IMAGE, 'dataVolume': m.r7.SOURCE_VOLUME,
                   'backupWorker': 'arthello-v52-backup-worker-' + key,
                   'backupVolume': 'arthello-v52-backups-' + key,
                   'backupControlVolume': 'arthello-v52-backup-control-' + key,
                   'bankActivationVolume': 'arthello-v52-tochka-activation-' + key,
                   'backupRuntimeStateFile': str(self.accepted), 'workDirectory': str(work),
                   'previousContainerId': previous_id, 'previousName': previous_name}
        for field, name in [('originalRouteFile', 'external-routes.before.caddy'),
                            ('maintenanceRouteFile', 'external-routes.maintenance.caddy'),
                            ('publicRouteFile', 'external-routes.candidate.caddy'), ('gateNonceFile', 'candidate-gate.nonce'),
                            ('gatewayEvidenceFile', 'gateway-evidence.json'), ('schoolRepairReceiptFile', 'school-repair-receipt.json')]:
            context[field] = str(work / name)
        self.historical_path = self.root / ('candidate-acceptance-' + m.adoption.ACCEPTED_SHA + '.json')
        self.historical = {'schemaVersion': 1, 'phase': 'public-started', 'context': context,
                           'contextSha256': hashlib.sha256((json.dumps(context, sort_keys=True, separators=(',', ':')) + '\n').encode()).hexdigest()}
        private(self.historical_path, self.historical)
        digest_patch = patch.object(m, 'ACCEPTED_CONTEXT_SHA256', self.historical['contextSha256'])
        digest_patch.start()
        self.addCleanup(digest_patch.stop)
        previous = self.app(old=True)
        previous.update(Id=previous_id, Name='/' + previous_name, Image='sha256:' + '6' * 64)
        previous['Config']['Labels']['arthello.release.sha'] = m.PREDECESSOR_SOURCE
        previous['State'].update(Running=False, Paused=False)
        previous['HostConfig']['RestartPolicy']['Name'] = 'no'
        previous['Mounts'] = previous['Mounts'][:1]
        previous['HostConfig']['Mounts'] = []
        self.f.docker.objects['container', previous_name] = previous
        self.f.docker.objects['image', previous['Image']] = {
            'Id': previous['Image'], 'Config': {'Labels': {'org.opencontainers.image.revision': m.PREDECESSOR_SOURCE}}}
        return previous

    def test_preprepare_boundary_opens_only_with_trusted_fixed_parent(self):
        self.assertEqual(m.boundary_result(self.args, self.docker), {'state': 'open'})
        self.assertEqual(self.docker.calls, [])
        self.root.chmod(0o755)
        self.assertEqual(m.boundary_result(self.args, self.docker), {'state': 'preserve'})

    def test_any_auth_or_public_presence_preserves_even_symlink_or_malformed(self):
        for prefix in ('candidate-acceptance-', 'activation-'):
            path = self.root / (prefix + self.args.release_sha + '.json')
            path.symlink_to(self.root / 'missing')
            self.assertEqual(m.boundary_result(self.args, self.docker), {'state': 'preserve'})
            path.unlink()
            path.write_text('not json')
            self.assertEqual(m.boundary_result(self.args, self.docker), {'state': 'preserve'})
            path.unlink()

    def test_present_empty_own_directory_is_ambiguous(self):
        self.own.parent.mkdir(mode=0o700)
        self.assertEqual(m.boundary_result(self.args, self.docker), {'state': 'preserve'})
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)

    def test_adopted_and_quiesced_boundaries_open_without_writes(self):
        self.prepare()
        before = self.own.read_bytes(), self.accepted.read_bytes()
        self.assertEqual(m.boundary_result(self.args, self.docker), {'state': 'open'})
        self.set_phase('stopped')
        self.f.subject.quiesce()
        private(self.own, self.f.state.load())
        quiesced = self.own.read_bytes()
        self.assertEqual(m.boundary_result(self.args, self.docker), {'state': 'open'})
        self.assertEqual(self.own.read_bytes(), quiesced)
        self.assertEqual(self.accepted.read_bytes(), before[1])

    def test_phase_sealed_or_boolean_true_preserves_without_docker(self):
        self.prepare()
        original = self.read(self.own)
        for change in ({'phase': 'sealed'}, {'sealed': True}, {'phase': 'sealed', 'sealed': True}):
            private(self.own, dict(original, **change))
            self.docker.calls.clear()
            self.assertEqual(m.boundary_result(self.args, self.docker), {'state': 'preserve'})
            self.assertEqual(self.docker.calls, [])

    def test_invalid_record_private_mode_symlink_and_lock_all_preserve(self):
        self.prepare()
        original = self.own.read_bytes()
        self.own.write_text('{')
        self.assertEqual(m.boundary_result(self.args, self.docker), {'state': 'preserve'})
        self.own.write_bytes(original)
        self.own.chmod(0o644)
        self.assertEqual(m.boundary_result(self.args, self.docker), {'state': 'preserve'})
        self.own.chmod(0o600)
        target = self.own.with_name('moved.json')
        self.own.rename(target)
        self.own.symlink_to(target)
        self.assertEqual(m.boundary_result(self.args, self.docker), {'state': 'preserve'})
        self.own.unlink()
        target.rename(self.own)
        directory = os.open(self.own.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            fcntl.flock(directory, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(m.boundary_result(self.args, self.docker), {'state': 'preserve'})
            with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        finally:
            os.close(directory)

    def test_invalid_unsealed_identity_owned_phase_or_health_preserves(self):
        self.prepare()
        original = self.read(self.own)
        variants = []
        for section, key, value in [('identity', 'runId', '42'), ('owned', 'state', 'unknown'),
                                    ('backupAtAdoption', 'historyCount', False)]:
            changed = copy.deepcopy(original)
            changed[section][key] = value
            variants.append(changed)
        variants.append(dict(original, phase='unknown'))
        for changed in variants:
            private(self.own, changed)
            self.assertEqual(m.boundary_result(self.args, self.docker), {'state': 'preserve'})

    def test_boundary_rechecks_marker_after_reads(self):
        self.prepare()
        inspect = self.docker.inspect
        def create_marker(*args, **kwargs):
            result = inspect(*args, **kwargs)
            (self.root / ('candidate-acceptance-' + self.args.release_sha + '.json')).write_text('boundary')
            return result
        with patch.object(self.docker, 'inspect', create_marker):
            self.assertEqual(m.boundary_result(self.args, self.docker), {'state': 'preserve'})

    def test_all_five_phases_require_exact_consumers_and_preserve_state(self):
        self.prepare()
        before = self.own.read_bytes(), self.accepted.read_bytes()
        for phase in m.PHASES[:-1]:
            self.set_phase(phase)
            result = m.consumers(self.args, self.docker)
            self.assertEqual(result, {'state': 'verified', 'phase': phase,
                                     'canonicalConsumers': 3 if phase.startswith('candidate') else 2})
        self.assertEqual((self.own.read_bytes(), self.accepted.read_bytes()), before)
        self.assertTrue(all(c[:2] == ['container', 'ls'] for c in self.f.docker.commands))

    def test_consumers_before_prepare_uses_real_accepted_state_and_probe(self):
        self.assertEqual(m.consumers(self.args, self.docker)['canonicalConsumers'], 2)
        self.assertFalse(self.own.exists())
        self.assertTrue(any(call[0] == 'run' and call[1][2] == m.adoption.ACCEPTED_WORKER_ID for call in self.docker.calls))

    def test_unknown_running_or_stopped_readonly_canonical_reader_is_refused(self):
        self.prepare()
        for running in (False, True):
            self.f.docker.objects['container', 'unknown'] = {
                'Id': '8' * 64, 'Name': '/unknown', 'Config': {}, 'State': {'Running': running, 'Paused': False},
                'Mounts': [{'Type': 'volume', 'Name': m.r7.SOURCE_VOLUME, 'Destination': '/data', 'RW': False}]}
            with self.subTest(running=running), self.assertRaises(REFUSED): m.consumers(self.args, self.docker)

    def test_unexpected_candidate_is_refused_in_live_and_stopped_phases(self):
        self.prepare()
        self.set_phase('candidate')
        for phase in ('live', 'stopped'):
            self.args.phase = phase
            self.old['State']['Running'] = phase == 'live'
            self.old['HostConfig']['RestartPolicy']['Name'] = 'unless-stopped' if phase == 'live' else 'no'
            with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)

    def test_fixed_old_and_derived_new_identity_drift_is_refused(self):
        self.prepare()
        self.set_phase('candidate')
        for item in (self.old, self.new):
            for key, value in [('Id', '7' * 64 if item is self.old else 'invalid'), ('Name', '/other'), ('Image', 'sha256:' + '7' * 64)]:
                original = item[key]
                item[key] = value
                with self.subTest(item=item is self.old, key=key), self.assertRaises(REFUSED):
                    m.consumers(self.args, self.docker)
                item[key] = original
            labels = item['Config']['Labels']
            original = labels['arthello.release.sha']
            labels['arthello.release.sha'] = '7' * 40
            with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
            labels['arthello.release.sha'] = original

    def test_app_mount_alias_duplicate_readonly_and_wrong_destination_are_refused(self):
        self.prepare()
        original = copy.deepcopy(self.old['Mounts'])
        variants = []
        for change in ({'RW': False}, {'Destination': '/other'}, {'Type': 'bind'}):
            value = copy.deepcopy(original)
            value[0].update(change)
            variants.append(value)
        variants.append(original + [dict(original[0])])
        variants.append(original + [{'Type': 'bind', 'Destination': '/data', 'Source': '/other', 'RW': True}])
        for mounts in variants:
            self.old['Mounts'] = mounts
            with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)

    def test_history_or_writable_control_mount_is_refused(self):
        self.prepare()
        self.old['Mounts'][1]['RW'] = True
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        self.old['Mounts'][1]['RW'] = False
        self.old['Mounts'].append({'Type': 'volume', 'Name': self.f.old.names['backups'], 'Destination': '/history', 'RW': False})
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)

    def test_phase_running_paused_and_stopped_restart_are_exact(self):
        self.prepare()
        self.old['State']['Paused'] = True
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        self.set_phase('candidate-paused')
        self.new['State']['Paused'] = False
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        self.new['State']['Paused'] = True
        self.old['HostConfig']['RestartPolicy']['Name'] = 'unless-stopped'
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)

    def test_unhealthy_stopped_or_duplicate_accepted_worker_is_refused(self):
        self.prepare()
        worker = self.f.worker()
        worker['State']['Running'] = False
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        worker['State']['Running'] = True
        self.f.docker.health['initialVerified'] = False
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        self.f.docker.health['initialVerified'] = True
        self.f.docker.extra_workers = ['8' * 64]
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)

    def test_original_attempt_is_not_replaced_by_current_attempt(self):
        self.prepare()
        self.args.attempt = '2'
        # A missing attempt-2 adoption cannot masquerade as the original candidate.
        self.set_phase('candidate')
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        self.args.attempt = '1'
        self.assertEqual(m.consumers(self.args, self.docker)['canonicalConsumers'], 3)

    def test_sealed_digest_is_exact_and_normal_history_growth_does_not_rewrite(self):
        self.prepare(sealed=True)
        before = self.own.read_bytes(), self.accepted.read_bytes()
        self.f.docker.health.update(historyCount=10, lastVerifiedBackupId='new-synthetic')
        result = m.sealed_digest(self.args, self.docker)
        self.assertEqual(result, {'state': 'sealed', 'backupAdoptionStateSha256': m.adoption.digest(self.read(self.own))})
        with_newline = hashlib.sha256((json.dumps(self.read(self.own), sort_keys=True, separators=(',', ':')) + '\n').encode()).hexdigest()
        self.assertNotEqual(result['backupAdoptionStateSha256'], with_newline)
        self.assertEqual((self.own.read_bytes(), self.accepted.read_bytes()), before)

    def test_digest_requires_sealed_complete_ownership_and_healthy_service(self):
        self.prepare()
        with self.assertRaises(REFUSED): m.sealed_digest(self.args, self.docker)
        self.f.subject.seal()
        private(self.own, self.f.state.load())
        saved = self.read(self.own)
        changed = copy.deepcopy(saved)
        changed['owned']['pending'] = {'kind': 'volume', 'role': 'activation', 'name': self.f.subject.owned.names['activation']}
        private(self.own, changed)
        with self.assertRaises(REFUSED): m.sealed_digest(self.args, self.docker)
        private(self.own, saved)
        self.f.worker()['State']['Running'] = False
        with self.assertRaises(REFUSED): m.sealed_digest(self.args, self.docker)

    def test_accepted_state_change_blocks_consumers_and_digest(self):
        self.prepare(sealed=True)
        changed = self.read(self.accepted)
        changed['probe']['historyCount'] += 1
        private(self.accepted, changed)
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        with self.assertRaises(REFUSED): m.sealed_digest(self.args, self.docker)

    def test_state_mutation_during_successful_probe_is_refused(self):
        self.prepare(sealed=True)
        original = self.read(self.own)
        probe = self.docker.run
        def changed_probe(*args, **kwargs):
            result = probe(*args, **kwargs)
            changed = copy.deepcopy(original)
            changed['backupAtAdoption']['historyCount'] += 1
            private(self.own, changed)
            return result
        for action in (m.consumers, m.sealed_digest):
            private(self.own, original)
            with patch.object(self.docker, 'run', changed_probe), self.assertRaises(REFUSED): action(self.args, self.docker)

    def test_copyback_requires_actual_quiescence_without_health_probe_or_writes(self):
        self.args.phase = 'copyback'
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        self.prepare()
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        self.set_phase('copyback')
        self.f.subject.quiesce()
        private(self.own, self.f.state.load())
        before = self.own.read_bytes(), self.accepted.read_bytes(), copy.deepcopy(self.f.docker.objects)
        self.docker.calls.clear()
        self.f.docker.commands.clear()
        self.assertEqual(m.consumers(self.args, self.docker),
                         {'state': 'verified', 'phase': 'copyback', 'canonicalConsumers': 2})
        self.assertFalse(any(call[0] == 'run' for call in self.docker.calls))
        self.assertEqual((self.own.read_bytes(), self.accepted.read_bytes(), self.f.docker.objects), before)
        self.assertTrue(all(call[:2] == ['container', 'ls'] for call in self.f.docker.commands))

    def test_copyback_denies_stopped_unknown_reader_allowed_by_frozen_helper(self):
        self.prepare()
        self.set_phase('copyback')
        self.f.subject.quiesce()
        private(self.own, self.f.state.load())
        self.f.docker.objects['container', 'unknown'] = {
            'Id': '8' * 64, 'Name': '/unknown', 'Config': {},
            'State': {'Running': False, 'Paused': False},
            'HostConfig': {'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}},
            'Mounts': [{'Type': 'volume', 'Name': m.r7.SOURCE_VOLUME, 'Destination': '/data', 'RW': False}]}
        self.assertEqual(self.f.subject.verify_copyback()['canonicalReaders'], 'none')
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)

    def test_copyback_denies_durable_boundary_seal_or_worker_restart(self):
        self.prepare()
        self.set_phase('copyback')
        self.f.subject.quiesce()
        private(self.own, self.f.state.load())
        marker = self.root / ('candidate-acceptance-' + self.args.release_sha + '.json')
        marker.symlink_to(self.root / 'missing')
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        marker.unlink()
        value = self.read(self.own)
        private(self.own, dict(value, sealed=True))
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        private(self.own, value)
        self.f.worker()['HostConfig']['RestartPolicy']['Name'] = 'unless-stopped'
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)

    def test_copyback_rechecks_worker_after_canonical_inspections(self):
        self.prepare()
        self.set_phase('copyback')
        self.f.subject.quiesce()
        private(self.own, self.f.state.load())
        canonical = m.canonical_consumers
        def restart_during_checks(*args, **kwargs):
            result = canonical(*args, **kwargs)
            self.f.worker()['State']['Running'] = True
            return result
        self.docker.calls.clear()
        with patch.object(m, 'canonical_consumers', restart_during_checks), self.assertRaises(REFUSED):
            m.consumers(self.args, self.docker)
        self.assertFalse(any(call[0] == 'run' for call in self.docker.calls))

    def test_exact_inventory_proves_absence_without_historical_file(self):
        self.prepare()
        with patch.object(m, 'historical_predecessor', side_effect=AssertionError('not needed')):
            self.assertEqual(m.consumers(self.args, self.docker)['canonicalConsumers'], 2)
            self.set_phase('candidate')
            self.assertEqual(m.canonical_consumers(self.args, self.docker, 'candidate'),
                             {m.adoption.LIVE_APP_ID, m.adoption.ACCEPTED_WORKER_ID, self.new['Id']})

    def test_only_receipt_bound_stopped_predecessor_is_allowed_in_all_phases(self):
        self.prepare()
        previous = self.predecessor()
        original = self.historical_path.read_bytes(), copy.deepcopy(previous)
        for phase in m.PHASES[:-1]:
            self.set_phase(phase)
            result = m.consumers(self.args, self.docker)
            self.assertEqual(result['canonicalConsumers'], 4 if phase.startswith('candidate') else 3)
        self.set_phase('copyback')
        self.f.subject.quiesce()
        private(self.own, self.f.state.load())
        self.assertEqual(m.consumers(self.args, self.docker)['canonicalConsumers'], 3)
        self.assertEqual((self.historical_path.read_bytes(), previous), original)

    def retained_r12(self):
        value = self.app(old=True)
        value.update(Id=m.adoption.ACCEPTED_APP_ID,
                     Name='/arthello-direct-' + m.adoption.ACCEPTED_RUN + '-1', Image=m.adoption.ACCEPTED_IMAGE)
        value['Config']['Labels']['arthello.release.sha'] = m.adoption.ACCEPTED_SHA
        value['State'].update(Running=False, Paused=False)
        value['HostConfig']['RestartPolicy']['Name'] = 'no'
        self.f.docker.objects['container', value['Name'][1:]] = value
        return value

    def test_two_receipt_bound_ancestors_are_preserved_in_every_phase(self):
        self.prepare()
        earlier = self.predecessor()
        retired = self.retained_r12()
        before = copy.deepcopy([earlier, retired]), self.historical_path.read_bytes(), self.live_historical_path.read_bytes()
        for phase in m.PHASES[:-1]:
            self.set_phase(phase)
            self.assertEqual(m.consumers(self.args, self.docker)['canonicalConsumers'],
                             5 if phase.startswith('candidate') else 4)
        self.set_phase('copyback')
        self.f.subject.quiesce()
        private(self.own, self.f.state.load())
        self.assertEqual(m.consumers(self.args, self.docker)['canonicalConsumers'], 4)
        self.assertEqual((copy.deepcopy([earlier, retired]), self.historical_path.read_bytes(),
                          self.live_historical_path.read_bytes()), before)

    def test_r13_receipt_and_retained_r12_identity_are_required_for_chain(self):
        self.prepare()
        self.predecessor()
        retired = self.retained_r12()
        saved = copy.deepcopy(self.live_historical)
        for changed in (dict(saved, phase='candidate-verified'), dict(saved, contextSha256='0' * 64)):
            private(self.live_historical_path, changed)
            with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        private(self.live_historical_path, saved)
        self.live_historical_path.chmod(0o644)
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        self.live_historical_path.chmod(0o600)
        for changed in ({'Running': True}, {'Paused': True}, {'Restarting': True}):
            previous = copy.deepcopy(retired['State'])
            retired['State'].update(changed)
            with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
            retired['State'] = previous
        retired['Mounts'][1]['RW'] = True
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)

    def test_third_ancestor_or_unbound_consumer_never_extends_chain(self):
        self.prepare()
        earlier = self.predecessor()
        self.retained_r12()
        unknown = copy.deepcopy(earlier)
        unknown.update(Id='5' * 64, Name='/arthello-direct-unbound-third')
        self.f.docker.objects['container', unknown['Name'][1:]] = unknown
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)

    def test_historical_context_digest_phase_and_root_are_mandatory(self):
        self.prepare()
        self.predecessor()
        original = copy.deepcopy(self.historical)
        changed = copy.deepcopy(original)
        changed['context']['previousContainerId'] = '7' * 64
        private(self.historical_path, changed)
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        private(self.historical_path, dict(original, phase='candidate-verified'))
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        changed = copy.deepcopy(original)
        changed['context']['workDirectory'] = '/other/candidate-work/arthello-deploy-' + m.adoption.ACCEPTED_RUN + '-1'
        changed['contextSha256'] = hashlib.sha256((json.dumps(changed['context'], sort_keys=True, separators=(',', ':')) + '\n').encode()).hexdigest()
        private(self.historical_path, changed)
        with patch.object(m, 'ACCEPTED_CONTEXT_SHA256', changed['contextSha256']), self.assertRaises(REFUSED):
            m.consumers(self.args, self.docker)

    def test_historical_private_file_and_lookup_errors_do_not_prove_absence(self):
        self.prepare()
        previous = self.predecessor()
        self.historical_path.chmod(0o644)
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        self.historical_path.chmod(0o600)
        inspect = self.docker.inspect
        def failed_lookup(kind, name, missing=False):
            if name == previous['Name'][1:]:
                raise m.r7.Refused('DAEMON_FAILURE')
            return inspect(kind, name, missing)
        with patch.object(self.docker, 'inspect', failed_lookup), self.assertRaises(REFUSED):
            m.consumers(self.args, self.docker)
        self.f.docker.objects.pop(('container', previous['Name'][1:]))
        self.assertIsNone(m.historical_predecessor(self.docker))

    def test_predecessor_identity_source_running_pause_and_restart_drift_are_refused(self):
        self.prepare()
        previous = self.predecessor()
        original = copy.deepcopy(previous)
        for key, value in [('Id', '7' * 64), ('Name', '/other'), ('Image', m.adoption.ACCEPTED_IMAGE)]:
            previous[key] = value
            with self.subTest(key=key), self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
            previous[key] = original[key]
        for change in ({'Running': True}, {'Paused': True}, {'Restarting': True}, {'Dead': True}):
            previous['State'].update(change)
            with self.subTest(change=change), self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
            previous['State'] = copy.deepcopy(original['State'])
        previous['HostConfig']['RestartPolicy']['Name'] = 'unless-stopped'
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        previous['HostConfig'] = copy.deepcopy(original['HostConfig'])
        previous['Config']['Labels']['arthello.release.sha'] = '7' * 40
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        previous['Config'] = copy.deepcopy(original['Config'])
        self.f.docker.objects['image', previous['Image']]['Config']['Labels']['org.opencontainers.image.revision'] = '7' * 40
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)

    def test_predecessor_canonical_and_backup_mounts_are_checked(self):
        self.prepare()
        previous = self.predecessor()
        previous['Mounts'][0]['RW'] = False
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        previous['Mounts'][0]['RW'] = True
        for mount in ({'Type': 'volume', 'Name': self.f.old.names['control'], 'Destination': m.r7.DIRECTORIES['control'], 'RW': False},
                      {'Type': 'volume', 'Name': 'arthello-v52-backups-30000000001-1', 'Destination': '/old', 'RW': False},
                      {'Type': 'bind', 'Source': '/something', 'Destination': '/history', 'RW': False}):
            previous['Mounts'].append(mount)
            with self.subTest(mount=mount), self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
            previous['Mounts'].pop()

    def test_another_matching_old_source_container_is_still_unknown(self):
        self.prepare()
        previous = self.predecessor()
        unknown = copy.deepcopy(previous)
        unknown.update(Id='7' * 64, Name='/arthello-direct-unbound')
        self.f.docker.objects['container', 'arthello-direct-unbound'] = unknown
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)
        self.f.docker.objects.pop(('container', previous['Name'][1:]))
        with self.assertRaises(REFUSED): m.consumers(self.args, self.docker)


class InterfaceTests(unittest.TestCase):
    def test_production_historical_pin_matches_accepted_receipt(self):
        self.assertEqual(m.ACCEPTED_CONTEXT_SHA256, '631487a8b31e3efb8b6956dab77ac9a0c476166f1050ca586df88f35a9b375a4')
        self.assertEqual(m.PREDECESSOR_SOURCE, '6596f69390ad539577ec2640e8ef40c7e12c22dc')

    def test_actual_protected_context_rejects_wrong_actor_uid_event_and_attempt(self):
        args = fixture.arguments()
        args.command = 'boundary'
        env = {'GITHUB_RUN_ATTEMPT': '3', 'GITHUB_REPOSITORY': 'vitaliyozolin-dotcom/ArtHello-OS',
               'GITHUB_ACTOR': 'vitaliyozolin-dotcom', 'GITHUB_TRIGGERING_ACTOR': 'vitaliyozolin-dotcom',
               'GITHUB_EVENT_NAME': 'workflow_run', 'RELEASE_SHA': args.release_sha, 'GITHUB_RUN_ID': args.run_id}
        m.adoption.protected_context(args, env, 1000)
        for change in ({'GITHUB_ACTOR': 'other'}, {'GITHUB_TRIGGERING_ACTOR': 'other'},
                       {'GITHUB_EVENT_NAME': 'push'}, {'GITHUB_RUN_ATTEMPT': '0'}, {'GITHUB_RUN_ID': '42'}):
            with self.assertRaises(REFUSED): m.adoption.protected_context(args, dict(env, **change), 1000)
        with self.assertRaises(REFUSED): m.adoption.protected_context(args, env, 0)
        args.attempt = '4'
        with self.assertRaises(REFUSED): m.adoption.protected_context(args, env, 1000)

    def test_cli_failure_is_bounded_and_boundary_preserves(self):
        args = fixture.arguments()
        flags = [value for name in ('image_id', 'release_sha', 'tree_sha', 'run_id', 'attempt')
                 for value in ('--' + name.replace('_', '-'), getattr(args, name))]
        for command in ('boundary', 'digest', 'consumers'):
            output = io.StringIO()
            with patch.object(m, 'execute', side_effect=RuntimeError('DO_NOT_EXPOSE')), redirect_stdout(output):
                result = m.main([command, *flags, *(['--phase', 'live'] if command == 'consumers' else [])])
            self.assertEqual(result, 1)
            self.assertEqual(json.loads(output.getvalue()), {'state': 'preserve' if command == 'boundary' else 'refused',
                                                             'code': 'R14_CONTROLLER_CHECK_FAILED'})

    def test_execute_enforces_protection_before_files_or_docker(self):
        args = fixture.arguments()
        args.command, args.phase = 'boundary', None
        with patch.dict(os.environ, {}, clear=True), patch.object(m, 'Docker') as docker, \
             patch.object(m.adoption, 'private_directory') as directory, self.assertRaises(REFUSED):
            m.execute(args)
        docker.assert_not_called()
        directory.assert_not_called()

    def test_production_docker_allowlist_rejects_all_mutations_and_other_exec(self):
        docker = m.Docker()
        for args in (['container', 'stop', 'x'], ['container', 'start', 'x'], ['volume', 'rm', 'x'],
                     ['container', 'create', 'x'], ['container', 'update', 'x'],
                     ['container', 'exec', 'x', 'sh'], ['ps', '-aq']):
            with patch.object(m.subprocess, 'run') as process, self.assertRaises(REFUSED): docker.run(args)
            process.assert_not_called()
        result = subprocess.CompletedProcess([], 1, stdout='[]', stderr='Error: No such container: seed')
        with patch.object(m.subprocess, 'run', return_value=result) as process:
            self.assertIsNone(docker.inspect('container', 'seed', True))
            self.assertEqual(process.call_args.kwargs['env'], {'PATH': os.environ.get('PATH', '')})
            self.assertEqual(process.call_args.kwargs['timeout'], 20)

    def test_state_write_is_impossible(self):
        with self.assertRaises(REFUSED): m.AbsentState().write({})
        with self.assertRaises(REFUSED): m.ReadOnlyState.__new__(m.ReadOnlyState).write({})

    def test_dependency_drift_is_rejected_before_execution(self):
        with patch.object(Path, 'read_bytes', return_value=b'raise AssertionError("UNVERIFIED")'), self.assertRaisesRegex(RuntimeError, 'DEPENDENCY_DRIFT'):
            m.checked_module()


if __name__ == '__main__':
    unittest.main()
