import datetime as dt
import importlib.util
from pathlib import Path
import os
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('receipt', HERE / 'r9-live-browser-acceptance.py')
receipt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receipt)


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 9, 8, 21, tzinfo=dt.timezone.utc)
        self.browser = dict(kind='server-natural-sso', result='pass', chromiumSandbox='verified',
                            method='natural-browser-navigation', sessionInjected=False,
                            callbackUrlConstructed=False, employeeAccount='verified',
                            educationAccess='verified', schoolIdentity='verified',
                            deniedApi='verified', deniedModule='finance',
                            observedAtUtc=self.now.isoformat(), verifiedSteps=receipt.STEPS)
        self.repair = dict(schemaVersion=2, state='verified', repairConfigSha256='c' * 64,
                           activatedAtUtc=(self.now - dt.timedelta(hours=1)).isoformat(),
                           executionUid=1000, stateDirectorySha256='d' * 64)
        self.args = dict(release='a' * 40, school='b' * 40, live='a' * 40,
                         config='c' * 64, reference='https://github.com/example/actions/runs/123',
                         now=self.now, phase='candidate', candidate_id='f' * 64, context_hash='1' * 64)

    def test_observed_identities_are_bound_to_real_browser_steps(self):
        record = receipt.build(self.browser, self.repair, **self.args)
        self.assertEqual(record['observedLiveArtHelloSha'], 'a' * 40)
        self.assertEqual(record['intendedCandidateArtHelloSha'], 'a' * 40)
        self.assertEqual(record['observedSchoolRepairExecutionUid'], 1000)
        self.assertEqual(record['acceptancePhase'], 'candidate-maintenance')
        self.assertEqual(record['candidateContainerId'], 'f' * 64)
        self.assertEqual(record['candidateContextSha256'], '1' * 64)

    def test_candidate_receipt_requires_container_and_context_binding(self):
        for patch in [dict(candidate_id=None), dict(context_hash=None), dict(candidate_id='x' * 64)]:
            with self.subTest(patch=patch), self.assertRaises(AssertionError):
                receipt.build(self.browser, self.repair, **{**self.args, **patch})
        after = receipt.build(self.browser, self.repair, **{**self.args, 'phase': 'after'})
        self.assertNotIn('acceptancePhase', after)

    def test_hosted_blocked_injected_or_unverified_results_cannot_make_receipt(self):
        for patch in [dict(kind='hosted-browser-fixture'), dict(result='blocked'),
                      dict(sessionInjected=True), dict(callbackUrlConstructed=True),
                      dict(chromiumSandbox='unknown'), dict(employeeAccount='unknown'),
                      dict(deniedApi='not_applicable'), dict(deniedModule='unknown'),
                      dict(schoolIdentity='unknown'), dict(verifiedSteps=[])]:
            with self.subTest(patch=patch), self.assertRaises((AssertionError, ValueError)):
                receipt.build({**self.browser, **patch}, self.repair, **self.args)

    def test_stale_future_or_before_repair_evidence_fails(self):
        for offset in [-46, 1, -61]:
            browser = {**self.browser, 'observedAtUtc': (self.now + dt.timedelta(minutes=offset)).isoformat()}
            with self.subTest(offset=offset), self.assertRaises(AssertionError):
                receipt.build(browser, self.repair, **self.args)

    def test_candidate_and_after_must_observe_the_actual_candidate(self):
        for phase in ('candidate', 'after'):
            with self.subTest(phase=phase), self.assertRaises(AssertionError):
                receipt.build(self.browser, self.repair, **{**self.args, 'phase': phase, 'live': 'e' * 40})
            receipt.build(self.browser, self.repair, **{**self.args, 'phase': phase})

    def test_old_live_baseline_is_never_a_passing_candidate_receipt(self):
        with self.assertRaises(AssertionError):
            receipt.build(self.browser, self.repair, **{**self.args, 'phase': 'before', 'live': 'e' * 40})
        with self.assertRaises(AssertionError):
            receipt.build({**self.browser, 'result': 'blocked', 'reason': 'education_api_forbidden'}, self.repair, **self.args)

    def test_mismatched_or_privileged_repair_cannot_be_relabelled(self):
        for patch in [dict(state='unknown'), dict(repairConfigSha256='f' * 64), dict(executionUid=0)]:
            with self.subTest(patch=patch), self.assertRaises(AssertionError):
                receipt.build(self.browser, {**self.repair, **patch}, **self.args)

    def test_candidate_receipt_is_private_complete_and_not_overwritable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            work = root / 'arthello-deploy-123-1'
            work.mkdir(mode=0o700)
            target = work / 'r9-acceptance-123-2.json'
            record = receipt.build(self.browser, self.repair, **self.args)
            receipt.write_acceptance(record, str(target), run='123', attempt='2', durable_root=str(root))
            self.assertEqual(receipt.json.loads(target.read_text()), record)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            with self.assertRaises((AssertionError, FileExistsError)):
                receipt.write_acceptance(record, str(target), run='123', attempt='2', durable_root=str(root))

    def test_receipt_refuses_symlink_wrong_attempt_and_public_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            work = root / 'arthello-deploy-123-1'
            work.mkdir(mode=0o700)
            target = work / 'r9-acceptance-123-2.json'
            target.symlink_to(work / 'absent')
            with self.assertRaises(AssertionError):
                receipt.write_acceptance({}, str(target), run='123', attempt='2', durable_root=str(root))
            target.unlink()
            with self.assertRaises(AssertionError):
                receipt.write_acceptance({}, str(target), run='123', attempt='3', durable_root=str(root))
            work.chmod(0o755)
            with self.assertRaises(AssertionError):
                receipt.write_acceptance({}, str(target), run='123', attempt='2', durable_root=str(root))


if __name__ == '__main__':
    unittest.main()
