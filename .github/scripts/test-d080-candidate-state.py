import copy
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('state', Path(__file__).with_name('d080-candidate-state.py'))
state = importlib.util.module_from_spec(spec)
spec.loader.exec_module(state)


class CandidateStateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.work = self.root / 'arthello-deploy-123-1'
        self.work.mkdir(mode=0o700)
        self.clock = dt.datetime.now(dt.timezone.utc)
        context = {field: 'a' * 40 for field in state.SHA40}
        context.update({field: 'b' * 64 for field in state.SHA64})
        context.update(runId='123', runAttempt='1', candidateContainerId='c' * 64,
                       candidateName='arthello-direct-123-1', previousName='arthello-direct-previous',
                       imageId='sha256:' + 'c' * 64, browserImageId='sha256:' + 'd' * 64,
                       dataVolume='arthello-data', rollbackVolume='arthello-rollback-123-1',
                       backupWorker='arthello-v52-backup-worker-123-1', backupVolume='arthello-v52-backups-123-1',
                       backupControlVolume='arthello-v52-backup-control-123-1',
                       bankActivationVolume='arthello-v52-tochka-activation-123-1',
                       originalRouteSha256='1' * 64, maintenanceRouteSha256='2' * 64, publicRouteSha256='3' * 64,
                       workDirectory=str(self.work), schoolRepairReceiptFile=str(self.root / 'school-repair.json'),
                       backupRuntimeStateFile=str(self.root / 'backup-runtime.json'))
        context.update({field: str(self.work / field) for field in state.WORK_FILES})
        self.context = context
        self.path = self.root / ('candidate-acceptance-' + context['releaseSha'] + '.json')
        repair = dict(schemaVersion=2, state='verified', repairConfigSha256=context['schoolRepairConfigSha256'],
                      activatedAtUtc=(self.clock - dt.timedelta(minutes=5)).isoformat(), executionUid=1000,
                      stateDirectorySha256='4' * 64)
        state.atomic(Path(context['schoolRepairReceiptFile']), repair)
        context['schoolRepairReceiptSha256'] = state.digest(repair)
        self.receipt = dict(schemaVersion=3, intendedCandidateArtHelloSha=context['releaseSha'],
                            observedLiveSchoolSha=context['schoolSha'], observedLiveArtHelloSha=context['releaseSha'],
                            observedSchoolRepairConfigSha256=repair['repairConfigSha256'],
                            observedSchoolRepairExecutionUid=1000, observedSchoolRepairStateDirectorySha256='4' * 64,
                            arthelloOrigin='https://arthello-188-225-38-55.sslip.io',
                            schoolOrigin='https://school-188-225-38-55.sslip.io',
                            method='natural-browser-navigation', sessionInjected=False, callbackUrlConstructed=False,
                            verifiedSteps=['open_education_in_authenticated_arthello', 'click_diary_entry',
                                           'follow_natural_sso_redirects', 'authenticated_school_diary_visible'],
                            result='pass', evidenceReference='https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/123/attempts/1',
                            observedAtUtc=self.clock.isoformat())

    def tearDown(self):
        self.temp.cleanup()

    def begin(self):
        result = state.begin(self.path, copy.deepcopy(self.context))
        self.clock = dt.datetime.now(dt.timezone.utc)
        self.receipt.update(observedAtUtc=self.clock.isoformat(), acceptancePhase='candidate-maintenance',
                            candidateContainerId=self.context['candidateContainerId'], candidateContextSha256=result['contextSha256'])
        return result

    def test_begin_private_durable_and_no_replay(self):
        result = self.begin()
        self.assertEqual(result['phase'], 'maintenance-started')
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(state.load_state(self.path), result)
        with self.assertRaises(ValueError):
            self.begin()

    def test_partial_or_cross_invocation_context_rejected(self):
        for field, value in [('candidateName', 'arthello-direct-123-2'), ('browserSourceSha', '9' * 40),
                             ('dataVolume', 'unsafe;command'), ('gateNonceFile', '/tmp/foreign'),
                             ('runId', '0'), ('publicRouteSha256', self.context['maintenanceRouteSha256'])]:
            with self.subTest(field=field):
                context = dict(self.context, **{field: value})
                with self.assertRaises(ValueError):
                    state.begin(self.path, context)
                self.assertFalse(self.path.exists())
        context = dict(self.context)
        del context['imageId']
        with self.assertRaises(ValueError):
            state.begin(self.path, context)

    def test_state_and_evidence_symlinks_rejected(self):
        target = self.root / 'unrelated'
        target.write_text('unrelated')
        self.path.symlink_to(target)
        with self.assertRaises(ValueError):
            self.begin()
        with self.assertRaises((OSError, ValueError)):
            state.read_private(self.path)
        self.assertEqual(target.read_text(), 'unrelated')

    def test_incomplete_repair_cannot_start_maintenance(self):
        repair = state.read_private(self.context['schoolRepairReceiptFile'])
        for field, value in [('executionUid', None), ('executionUid', True), ('stateDirectorySha256', ''),
                             ('activatedAtUtc', (self.clock + dt.timedelta(days=1)).isoformat())]:
            with self.subTest(field=field, value=value):
                changed = dict(repair, **{field: value})
                state.atomic(Path(self.context['schoolRepairReceiptFile']), changed, replace=True)
                context = dict(self.context, schoolRepairReceiptSha256=state.digest(changed))
                with self.assertRaises((ValueError, KeyError)):
                    state.begin(self.path, context)
                self.assertFalse(self.path.exists())

    def test_insecure_mode_and_hardlink_rejected(self):
        self.begin()
        self.path.chmod(0o644)
        with self.assertRaises(ValueError):
            state.load_state(self.path)
        self.path.chmod(0o600)
        os.link(self.path, self.root / 'second-link')
        with self.assertRaises(ValueError):
            state.load_state(self.path)

    def test_context_tampering_rejected(self):
        result = self.begin()
        result['context']['candidateContainerId'] = '9' * 64
        self.path.write_bytes(state.canonical(result))
        with self.assertRaises(ValueError):
            state.load_state(self.path)

    def test_no_public_without_actual_verified_receipt(self):
        self.begin()
        with self.assertRaises(ValueError):
            state.advance(self.path, self.receipt, '1', public=True, clock=self.clock)
        self.assertEqual(state.load_state(self.path)['phase'], 'maintenance-started')

    def test_blocked_old_source_wrong_run_and_injected_session_rejected(self):
        self.begin()
        for field, value in [('result', 'blocked'), ('observedLiveArtHelloSha', '9' * 40),
                             ('evidenceReference', self.receipt['evidenceReference'].replace('/123/', '/124/')),
                             ('sessionInjected', True), ('callbackUrlConstructed', True),
                             ('verifiedSteps', []), ('observedSchoolRepairExecutionUid', 0),
                             ('acceptancePhase', 'after'), ('candidateContainerId', '9' * 64), ('candidateContextSha256', '9' * 64)]:
            with self.subTest(field=field):
                with self.assertRaises((ValueError, AssertionError)):
                    state.advance(self.path, dict(self.receipt, **{field: value}), '1', clock=self.clock)
                self.assertEqual(state.load_state(self.path)['phase'], 'maintenance-started')

    def test_receipt_expires_and_future_receipt_rejected(self):
        self.begin()
        for minutes in (-46, 1):
            receipt = dict(self.receipt, observedAtUtc=(self.clock + dt.timedelta(minutes=minutes)).isoformat())
            with self.assertRaises((AssertionError, ValueError)):
                state.advance(self.path, receipt, '1', clock=self.clock)

    def test_public_requires_same_receipt_and_rechecks_freshness(self):
        self.begin()
        state.advance(self.path, self.receipt, '1', clock=self.clock)
        changed = dict(self.receipt, observedAtUtc=(self.clock - dt.timedelta(seconds=1)).isoformat())
        with self.assertRaises(ValueError):
            state.advance(self.path, changed, '1', public=True, clock=self.clock)
        with self.assertRaises(AssertionError):
            state.advance(self.path, self.receipt, '1', public=True, clock=self.clock + dt.timedelta(minutes=46))
        self.assertEqual(state.load_state(self.path)['phase'], 'candidate-verified')

    def test_receipt_from_before_boundary_cannot_be_relabelled(self):
        self.begin()
        receipt = dict(self.receipt, observedAtUtc=(self.clock - dt.timedelta(seconds=5)).isoformat())
        with self.assertRaises(ValueError):
            state.advance(self.path, receipt, '1', clock=self.clock)

    def test_fifo_rejected_without_waiting_for_a_writer(self):
        fifo = self.root / 'fifo'
        os.mkfifo(fifo, 0o600)
        with self.assertRaises(ValueError):
            state.read_private(fifo)

    def test_ancestor_symlink_and_replaced_school_repair_rejected(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.work, target_is_directory=True)
        changed = dict(self.context, gateNonceFile=str(alias / 'gateNonceFile'))
        with self.assertRaises(ValueError):
            state.begin(self.path, changed)
        self.begin()
        repair = state.read_private(self.context['schoolRepairReceiptFile'])
        repair['executionUid'] = 1001
        state.atomic(Path(self.context['schoolRepairReceiptFile']), repair, replace=True)
        with self.assertRaises(ValueError):
            state.advance(self.path, self.receipt, '1', clock=self.clock)
        with self.assertRaises(ValueError):
            state.resume_check(self.path, self.context['releaseSha'], '123', '2')

    def test_concurrent_transition_is_rejected_and_public_cannot_rewind(self):
        self.begin()
        state.advance(self.path, self.receipt, '1', clock=self.clock)
        with state.state_lock(self.path):
            with self.assertRaises(BlockingIOError):
                state.advance(self.path, self.receipt, '1', clock=self.clock)
            state._advance_locked(self.path, self.receipt, '1', True, self.clock)
        with self.assertRaises(ValueError):
            state.advance(self.path, self.receipt, '1', clock=self.clock)
        self.assertEqual(state.load_state(self.path)['phase'], 'public-started')

    def test_public_is_irreversible_and_resume_forbidden(self):
        self.begin()
        state.advance(self.path, self.receipt, '1', clock=self.clock)
        state.advance(self.path, self.receipt, '1', public=True, clock=self.clock)
        with self.assertRaises(ValueError):
            state.advance(self.path, self.receipt, '1', clock=self.clock)
        with self.assertRaises(ValueError):
            state.resume_check(self.path, self.context['releaseSha'], '123', '2')

    def test_resume_requires_same_release_run_later_attempt(self):
        self.begin()
        for release, run, attempt in [(self.context['releaseSha'], '123', '1'), ('9' * 40, '123', '2'),
                                      (self.context['releaseSha'], '124', '2')]:
            with self.assertRaises(ValueError):
                state.resume_check(self.path, release, run, attempt)
        self.assertEqual(state.resume_check(self.path, self.context['releaseSha'], '123', '2')['phase'], 'maintenance-started')
        resumed = dict(self.receipt, evidenceReference=self.receipt['evidenceReference'].replace('/attempts/1', '/attempts/2'))
        state.advance(self.path, resumed, '2', clock=self.clock)
        with self.assertRaises(ValueError):
            state.advance(self.path, self.receipt, '1', clock=self.clock)
        state.advance(self.path, resumed, '2', public=True, clock=self.clock)


if __name__ == '__main__':
    unittest.main()
