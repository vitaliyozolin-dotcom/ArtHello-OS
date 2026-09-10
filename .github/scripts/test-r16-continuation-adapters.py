"""Behavioral fixtures for the new adapters; no daemon, database or network calls."""
import copy
import datetime as dt
import fcntl
import hashlib
import importlib.util
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
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

resume = load('r14_resume_test', 'r16-resume-candidate.py')
state = resume.state
adoption = state.adoption
public = load('r14_public_test', 'r16-public-audit.py')
activation = load('r14_activation_fixture', 'd063-activation-state.py')
old_tests = load('r14_held_fixture', 'test-d083-resume-candidate.py')
backup_tests = load('r14_backup_fixture', 'test-r16-backup-adoption.py')
controller_tests = load('r14_controller_fixture', 'test-r16-backup-controller.py')
private, json_bytes = old_tests.private, old_tests.json_bytes
REFUSED = (ValueError, adoption.r7.Refused, public.state.adoption.r7.Refused, resume.controller.r7.Refused, resume.controller.historical.r7.Refused, OSError, AssertionError)


class HeldR14(old_tests.HeldCandidate):
    def __init__(self, root):
        super().__init__(root)
        # Preserve the frozen fixture's behavior while using the real canonical home layout.
        (root / 'config').rename(root / '.config')
        old_prefix, new_prefix = str(root / 'config'), str(root / '.config')
        for field in ('secret_dir', 'state_dir', 'durable_root', 'work', 'state_path'):
            setattr(self, field, Path(str(getattr(self, field)).replace(old_prefix, new_prefix, 1)))
        self.context = {key: value.replace(old_prefix, new_prefix, 1) for key, value in self.context.items()}
        for mount in self.candidate['Mounts']:
            if 'Source' in mount:
                mount['Source'] = mount['Source'].replace(old_prefix, new_prefix, 1)
        self.state_path.unlink()  # Discard synthetic D083 state before real R14 begin.
        c = self.context
        original_arguments = backup_tests.arguments
        with patch.object(backup_tests, 'arguments', lambda old=False: original_arguments(True) if old else state.adoption_args(c)):
            self.backup = backup_tests.Fixture()
            self.backup.setUp()
        self.backup.docker.objects['image', c['imageId']] = self.images[c['imageId']]
        self.backup.prepare()
        self.backup.subject.seal()
        old = self.backup.old
        for field, role in [('backupWorker', 'worker'), ('backupVolume', 'backups'), ('backupControlVolume', 'control')]:
            c[field] = old.names[role]
        c['previousContainerId'] = adoption.LIVE_APP_ID
        c['previousName'] = 'arthello-direct-' + adoption.LIVE_RUN + '-1'
        self.previous.update(Id=c['previousContainerId'], Name='/' + c['previousName'], Image=adoption.LIVE_IMAGE,
                             Config={'Labels': {'arthello.release.sha': adoption.LIVE_SHA}})
        self.previous['HostConfig']['RestartPolicy']['MaximumRetryCount'] = 0
        self.rollback['Labels']['arthello.rollback.source-container'] = c['previousContainerId']
        for mount in self.candidate['Mounts']:
            if mount['Destination'] == '/var/lib/arthello-v52-backup-control':
                mount['Name'] = c['backupControlVolume']
        self.candidate['HostConfig']['Mounts'] = [dict(Type='volume', Source=c['backupControlVolume'],
            Target='/var/lib/arthello-v52-backup-control', ReadOnly=True, VolumeOptions={'NoCopy': True})]
        self.own_path, self.accepted_path = state.adoption_paths(c)
        c['backupRuntimeStateFile'] = str(self.own_path)
        self.sealed = self.backup.state.load()
        self.accepted = self.backup.accepted.load()
        private(self.own_path, json_bytes(self.sealed))
        private(self.accepted_path, json_bytes(self.accepted))
        c['backupAdoptionStateSha256'] = adoption.digest(self.sealed)
        self.worker = self.backup.docker.objects['container', old.names['worker']]
        for obj in (self.candidate, self.previous):
            self.backup.docker.objects['container', obj['Name'].removeprefix('/')] = obj
        self.record = state.begin(self.state_path, c)
        self.calls.clear()
        self.backup.docker.commands.clear()

    def inspect(self, kind, name, missing=False):
        self.calls.append(('inspect', kind, name))
        result = self.backup.docker.inspect(kind, name, True)
        if result is not None:
            return result
        if missing:
            return None
        return super().inspect(kind, name)

    def command(self, args, timeout=30):
        if args[:2] == ['container', 'ls']:
            self.calls.append(('docker', args))
            return self.backup.docker.command(args, timeout)
        return super().command(args, timeout)

    def run(self, args, timeout=30):
        self.calls.append(('docker', args))
        if args != ['container', 'exec', adoption.ACCEPTED_WORKER_ID, 'python3', '-I',
                    '/opt/arthello-backup/probe.py', '--require-initial-verified']:
            raise AssertionError('Unexpected process boundary')
        value = dict(self.backup.docker.health, initialVerified=self.backup_ok)
        return SimpleNamespace(returncode=0, stdout=json.dumps(value), stderr='')

    def verify(self, **overrides):
        args = dict(release=self.release, tree=self.tree, run='41', attempt='2',
                    durable_root=str(self.durable_root), docker=self)
        args.update(overrides)
        with patch.object(Path, 'home', return_value=self.root), \
             patch.object(resume, 'command', self.process), patch.object(resume.urllib.request, 'urlopen', self.github), \
             patch.dict(os.environ, {'GH_TOKEN': 'synthetic-github-token'}):
            return resume.verify(self.state_path, **args)

    def repair(self):
        with patch.object(Path, 'home', return_value=self.root), \
             patch.object(resume, 'command', self.process), patch.object(resume.urllib.request, 'urlopen', self.github), \
             patch.object(resume, 'Docker', return_value=self), patch.dict(os.environ, {'GH_TOKEN': 'synthetic-github-token'}):
            return resume.repair_maintenance(self.state_path, release=self.release, tree=self.tree, run='41',
                                            attempt='1', durable_root=str(self.durable_root))

    def receipt(self, attempt='2'):
        c = self.context
        repair = state.read_private(c['schoolRepairReceiptFile'])
        return dict(schemaVersion=3, intendedCandidateArtHelloSha=c['releaseSha'],
                    observedLiveSchoolSha=c['schoolSha'], observedLiveArtHelloSha=c['releaseSha'],
                    observedSchoolRepairConfigSha256=repair['repairConfigSha256'],
                    observedSchoolRepairExecutionUid=repair['executionUid'],
                    observedSchoolRepairStateDirectorySha256=repair['stateDirectorySha256'],
                    arthelloOrigin='https://arthello-188-225-38-55.sslip.io',
                    schoolOrigin='https://school-188-225-38-55.sslip.io',
                    method='natural-browser-navigation', sessionInjected=False, callbackUrlConstructed=False,
                    verifiedSteps=['open_education_in_authenticated_arthello', 'click_diary_entry',
                                   'follow_natural_sso_redirects', 'authenticated_school_diary_visible'], result='pass',
                    evidenceReference='https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/41/attempts/' + attempt,
                    observedAtUtc=dt.datetime.now(dt.timezone.utc).isoformat(), acceptancePhase='candidate-maintenance',
                    candidateContainerId=c['candidateContainerId'], candidateContextSha256=self.record['contextSha256'])


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path.home())
        self.addCleanup(self.temp.cleanup)
        self.f = HeldR14(Path(self.temp.name).resolve())

    def test_split_identity_context_is_valid(self):
        context = dict(self.f.context)
        target = state
        if os.environ.get('R14_TEST_FROZEN') == '1':
            target = old_tests.resume.state
            context.pop('backupAdoptionStateSha256')
        self.assertEqual(target.validate_context(context), context)
        self.assertNotEqual(context['backupControlVolume'].split('-')[-2], context['runId'])

    def test_full_resume_is_readonly_and_uses_exact_accepted_worker(self):
        paths = [self.f.state_path, self.f.own_path, self.f.accepted_path]
        before = [p.read_bytes() for p in paths]
        self.assertEqual(self.f.verify()['context'], self.f.context)
        self.assertEqual(before, [p.read_bytes() for p in paths])
        self.assertEqual(self.f.calls[-1][0], 'current-main')
        probes = [c[1] for c in self.f.calls if c[0] == 'docker' and '/opt/arthello-backup/probe.py' in c[1]]
        self.assertTrue(probes)
        self.assertTrue(all(p[2] == adoption.ACCEPTED_WORKER_ID for p in probes))
        self.assertFalse(any(c[:2] in (['volume', 'create'], ['container', 'create'], ['container', 'update'],
                                     ['container', 'start'], ['container', 'stop'], ['container', 'rm'])
                             for c in self.f.backup.docker.commands))

    def test_live_history_can_grow_without_rewriting_sealed_state(self):
        before = self.f.own_path.read_bytes()
        self.f.backup.docker.health.update(historyCount=5, lastVerifiedBackupId='next-synthetic',
                                          nextAt='2026-09-11T00:15:00+00:00')
        self.assertEqual(self.f.verify()['phase'], 'maintenance-started')
        self.assertEqual(self.f.own_path.read_bytes(), before)

    def test_sealed_record_change_during_probe_is_denied(self):
        original_run = self.f.run
        def changed_run(args, timeout=30):
            result = original_run(args, timeout)
            changed = copy.deepcopy(self.f.sealed)
            changed['backupAtAdoption']['historyCount'] += 1
            private(self.f.own_path, json_bytes(changed))
            return result
        with patch.object(self.f, 'run', changed_run), self.assertRaises(REFUSED):
            self.f.verify()

    def test_resource_attempt_stays_original_during_later_resume(self):
        self.assertEqual(self.f.verify(attempt='3')['context']['runAttempt'], '1')
        with self.assertRaises(REFUSED): self.f.verify(attempt='1')
        with self.assertRaises(REFUSED): self.f.verify(run='42')

    def test_begin_requires_seal_before_auth_boundary(self):
        self.f.state_path.unlink()
        original = self.f.sealed
        for phase, sealed in [('adopted', False), ('adopted', True), ('sealed', False), ('restoring', True)]:
            changed = dict(original, phase=phase, sealed=sealed)
            private(self.f.own_path, json_bytes(changed))
            context = dict(self.f.context, backupAdoptionStateSha256=adoption.digest(changed))
            with self.subTest(phase=phase, sealed=sealed), self.assertRaises(REFUSED):
                state.begin(self.f.state_path, context)
            self.assertFalse(self.f.state_path.exists())

    def test_adoption_digest_uses_exact_no_newline_convention(self):
        self.assertNotEqual(state.digest(self.f.sealed), adoption.digest(self.f.sealed))
        context = dict(self.f.context, backupAdoptionStateSha256=state.digest(self.f.sealed))
        with self.assertRaises(REFUSED): state.validate_adoption(context)

    def test_sealed_state_drift_blocks_resume_and_public_audit(self):
        receipt = self.f.receipt()
        state.advance(self.f.state_path, receipt, '2')
        receipt_path = Path(private(self.f.work / 'actual-acceptance.json', json_bytes(receipt)))
        changed = copy.deepcopy(self.f.sealed)
        changed['backupAtAdoption']['historyCount'] += 1
        private(self.f.own_path, json_bytes(changed))
        with self.assertRaises(REFUSED): self.f.verify()
        with self.assertRaises(REFUSED): public.prepare(self.f.state_path, receipt_path, '2')
        self.assertFalse((self.f.state_dir / 'public-audit').exists())

    def test_pending_owned_operation_is_rejected_even_if_digest_rebound(self):
        changed = copy.deepcopy(self.f.sealed)
        changed['owned']['pending'] = {'kind': 'volume', 'role': 'activation', 'name': self.f.context['bankActivationVolume']}
        private(self.f.own_path, json_bytes(changed))
        context = dict(self.f.context, backupAdoptionStateSha256=adoption.digest(changed))
        with self.assertRaises(REFUSED): state.validate_adoption(context)

    def test_old_state_drift_and_new_worker_substitution_are_denied(self):
        changed = copy.deepcopy(self.f.accepted)
        changed['identity']['runId'] = self.f.context['runId']
        private(self.f.accepted_path, json_bytes(changed))
        with self.assertRaises(REFUSED): self.f.verify()
        private(self.f.accepted_path, json_bytes(self.f.accepted))
        context = dict(self.f.context, backupWorker='arthello-v52-backup-worker-41-1')
        with self.assertRaises(REFUSED): state.validate_context(context)

    def test_foreign_adoption_path_and_old_activation_are_denied(self):
        for changed in [dict(backupRuntimeStateFile=str(self.f.accepted_path)),
                        dict(bankActivationVolume='arthello-v52-tochka-activation-' + adoption.ACCEPTED_RUN + '-1'),
                        dict(previousContainerId='d' * 64)]:
            with self.subTest(changed=changed), self.assertRaises(REFUSED):
                state.validate_context(dict(self.f.context, **changed))

    def test_shared_adoption_lock_denies_concurrent_mutator(self):
        directory = os.open(self.f.own_path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            fcntl.flock(directory, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(REFUSED): self.f.verify()
        finally:
            os.close(directory)

    def test_adoption_symlink_and_insecure_file_are_denied(self):
        self.f.own_path.chmod(0o644)
        with self.assertRaises(REFUSED): self.f.verify()
        self.f.own_path.chmod(0o600)
        target = self.f.own_path.with_name('moved.json')
        self.f.own_path.rename(target)
        self.f.own_path.symlink_to(target)
        with self.assertRaises(REFUSED): self.f.verify()

    def test_stopped_or_unhealthy_accepted_worker_blocks_resume(self):
        self.f.worker['State']['Running'] = False
        with self.assertRaises(REFUSED): self.f.verify()
        self.f.worker['State']['Running'] = True
        self.f.backup_ok = False
        with self.assertRaises(REFUSED): self.f.verify()

    def test_duplicate_worker_or_history_mount_blocks_resume(self):
        self.f.backup.docker.extra_workers = ['7' * 64]
        with self.assertRaises(REFUSED): self.f.verify()
        self.f.backup.docker.extra_workers.clear()
        self.f.candidate['Mounts'].append(dict(Type='volume', Name=self.f.context['backupVolume'], Destination='/history', RW=True))
        with self.assertRaises(REFUSED): self.f.verify()

    def test_unknown_running_or_stopped_readonly_canonical_consumer_is_denied(self):
        extra = dict(Id='7' * 64, Name='/unknown-reader', Config={},
                     State=dict(Running=False, Paused=False),
                     Mounts=[dict(Type='volume', Name=self.f.context['dataVolume'], Destination='/data', RW=False)])
        key = ('container', 'unknown-reader')
        self.f.backup.docker.objects[key] = extra
        for running in (False, True):
            extra['State']['Running'] = running
            self.f.consumers = [self.f.context['candidateContainerId']] + ([extra['Id']] if running else [])
            with self.subTest(running=running), self.assertRaises(REFUSED):
                self.f.verify()
        del self.f.backup.docker.objects[key]
        self.f.consumers = [self.f.context['candidateContainerId']]
        self.assertEqual(self.f.verify()['phase'], 'maintenance-started')

    def test_resume_uses_receipt_bound_historical_predecessor_without_deleting_it(self):
        # The utility fixture supplies synthetic pinned context, never invented live evidence.
        historical = SimpleNamespace(root=self.f.state_dir, accepted=self.f.accepted_path, f=self.f.backup,
                                     app=lambda old=False: copy.deepcopy(self.f.previous), addCleanup=self.addCleanup)
        previous = controller_tests.ControllerTests.predecessor(historical)
        before = copy.deepcopy(previous)
        with patch.object(resume.controller, 'ACCEPTED_CONTEXT_SHA256', historical.historical['contextSha256']), \
                patch.object(resume.controller.historical, 'ACCEPTED_CONTEXT_SHA256', historical.historical['contextSha256']), \
                patch.object(resume.controller.historical, 'LIVE_CONTEXT_SHA256', historical.r13_historical['contextSha256']), \
                patch.object(resume.controller, 'LIVE_CONTEXT_SHA256', historical.live_historical['contextSha256']):
            self.assertEqual(self.f.verify()['phase'], 'maintenance-started')
            self.assertEqual(previous, before)
            previous['State']['Paused'] = True
            with self.assertRaises(REFUSED): self.f.verify()

    def test_resume_requires_canonical_home_state_root(self):
        with patch.object(self.f, 'root', self.f.root / 'another-home'), self.assertRaises(REFUSED):
            self.f.verify()

    def test_candidate_requires_adopted_control_readonly(self):
        target = next(m for m in self.f.candidate['Mounts'] if m.get('Name') == self.f.context['backupControlVolume'])
        target['RW'] = True
        with self.assertRaises(REFUSED): self.f.verify()

    def test_empty_new_activation_and_no_writer_remain_mandatory(self):
        self.f.bank_empty = False
        with self.assertRaises(REFUSED): self.f.verify()
        self.f.bank_empty = True
        self.f.writer = '7' * 64
        with self.assertRaises(REFUSED): self.f.verify()

    def test_previous_application_image_is_exact_accepted_r12(self):
        self.f.previous['Image'] = self.f.context['imageId']
        with self.assertRaises(REFUSED): self.f.verify()

    def test_current_main_and_maintenance_route_remain_mandatory(self):
        self.f.main_sha = '7' * 40
        with self.assertRaises(REFUSED): self.f.verify()
        self.f.main_sha = self.f.release
        self.f.route = 'different route\n'
        with self.assertRaises(REFUSED): self.f.verify()

    def test_public_file_presence_blocks_resume(self):
        path = self.f.state_path.with_name('activation-' + self.f.release + '.json')
        path.symlink_to(self.f.state_dir / 'absent-target')
        with self.assertRaises(REFUSED): self.f.verify()

    def test_public_transition_requires_actual_current_receipt_and_cannot_rewind(self):
        receipt = self.f.receipt()
        with self.assertRaises(REFUSED): state.advance(self.f.state_path, receipt, '2', public=True)
        for change in [dict(sessionInjected=True), dict(observedLiveArtHelloSha=adoption.ACCEPTED_SHA),
                       dict(evidenceReference=receipt['evidenceReference'].replace('/2', '/3'))]:
            with self.subTest(change=change), self.assertRaises(REFUSED):
                state.advance(self.f.state_path, dict(receipt, **change), '2')
        state.advance(self.f.state_path, receipt, '2')
        state.advance(self.f.state_path, receipt, '2', public=True)
        with self.assertRaises(REFUSED): state.advance(self.f.state_path, receipt, '2')
        with self.assertRaises(REFUSED): self.f.verify()
        self.assertEqual(state.load_state(self.f.state_path)['phase'], 'public-started')

    def test_auth_boundary_blocks_copyback_and_owned_cleanup(self):
        directory = os.open(self.f.state_dir, os.O_RDONLY | os.O_DIRECTORY)
        try:
            self.f.backup.subject.boundary = adoption.DurableBoundary(directory, self.f.release)
            for action in ('quiesce', 'verify_copyback', 'cleanup'):
                with self.subTest(action=action), self.assertRaises(backup_tests.r7.Refused):
                    getattr(self.f.backup.subject, action)()
        finally:
            os.close(directory)

    def test_public_audit_preserves_original_resource_attempt_and_current_receipt(self):
        receipt = self.f.receipt('3')
        state.advance(self.f.state_path, receipt, '3')
        path = Path(private(self.f.work / 'actual-acceptance.json', json_bytes(receipt)))
        work = public.prepare(self.f.state_path, path, '3')
        self.assertEqual(work.name, 'arthello-deploy-41-3')
        self.assertEqual(state.read_private(work / 'candidate-context.json')['runAttempt'], '1')
        self.assertEqual(state.read_private(work / 'candidate-acceptance.json'), receipt)
        self.assertEqual(adoption.digest(state.read_private(work / 'backup-adoption.json')), self.f.context['backupAdoptionStateSha256'])
        self.assertEqual(state.load_state(self.f.state_path)['phase'], 'candidate-verified')
        with self.assertRaises(REFUSED): public.prepare(self.f.state_path, path, '3')

    def test_public_audit_matches_frozen_d063_public_boundary(self):
        receipt = self.f.receipt('3')
        state.advance(self.f.state_path, receipt, '3')
        path = Path(private(self.f.work / 'actual-acceptance.json', json_bytes(receipt)))
        work = public.prepare(self.f.state_path, path, '3')
        c = self.f.context
        marker = self.f.state_dir / ('activation-' + self.f.release + '.json')
        record = activation.begin(marker, self.f.release, '41', '3', c['candidateContainerId'],
                                  c['previousContainerId'], c['rollbackVolume'], c['originalRouteSha256'],
                                  c['publicRouteSha256'], str(work))
        self.assertEqual(record['runAttempt'], '3')
        self.assertEqual(record['diagnosticDirectory'], str(work))
        self.assertEqual(record['rollbackVolume'], 'arthello-rollback-41-1')
        with self.assertRaises(REFUSED): self.f.verify()

    def test_public_audit_rejects_wrong_attempt_or_unverified_receipt(self):
        receipt = self.f.receipt('2')
        path = Path(private(self.f.work / 'actual-acceptance.json', json_bytes(receipt)))
        with self.assertRaises(REFUSED): public.prepare(self.f.state_path, path, '2')
        state.advance(self.f.state_path, receipt, '2')
        with self.assertRaises(REFUSED): public.prepare(self.f.state_path, path, '3')
        with self.assertRaises(REFUSED): public.prepare(self.f.state_path, path, '1')

    def test_maintenance_repair_verifies_before_reload_and_rechecks_after(self):
        self.f.probe_ok = False
        self.assertEqual(self.f.repair()['phase'], 'maintenance-started')
        main = [i for i, call in enumerate(self.f.calls) if call[0] == 'current-main']
        reload = [i for i, call in enumerate(self.f.calls) if call[0] == 'process' and 'reload' in call[1]]
        self.assertEqual(len(main), 2)
        self.assertEqual(len(reload), 1)
        self.assertLess(main[0], reload[0])
        self.assertLess(reload[0], main[1])

    def test_failed_adoption_prevents_route_reload(self):
        self.f.worker['State']['Running'] = False
        with self.assertRaises(REFUSED): self.f.repair()
        self.assertFalse(any(c[0] == 'process' and 'reload' in c[1] for c in self.f.calls))


class ProcessBoundaryTests(unittest.TestCase):
    def test_exact_missing_seed_is_accepted_but_daemon_error_is_not(self):
        docker = resume.Docker()
        absent = subprocess.CompletedProcess([], 1, stdout='[]', stderr='Error: No such container: fixed-seed')
        with patch.object(resume.subprocess, 'run', return_value=absent) as call:
            self.assertIsNone(docker.inspect('container', 'fixed-seed', True))
            self.assertEqual(call.call_args.kwargs['env'], {'PATH': os.environ.get('PATH', '')})
        failed = subprocess.CompletedProcess([], 1, stdout='', stderr='Cannot connect to the Docker daemon')
        with patch.object(resume.subprocess, 'run', return_value=failed), self.assertRaises(adoption.r7.Refused):
            docker.inspect('container', 'fixed-seed', True)

    def test_checked_dependency_executes_verified_bytes(self):
        source = b'VALUE = 41\n'
        digest = hashlib.sha256(source).hexdigest()
        with patch.object(Path, 'read_bytes', return_value=source):
            module = state.checked_module('fixture', 'fixture.py', digest)
        self.assertEqual(module.VALUE, 41)
        with patch.object(Path, 'read_bytes', return_value=b'VALUE = 42\n'), self.assertRaises(RuntimeError):
            state.checked_module('fixture', 'fixture.py', digest)


if __name__ == '__main__':
    unittest.main()
