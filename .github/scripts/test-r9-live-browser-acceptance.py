import datetime as dt
import importlib.util
from pathlib import Path
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
        self.args = dict(release='a' * 40, school='b' * 40, live='e' * 40,
                         config='c' * 64, reference='https://github.com/example/actions/runs/123',
                         now=self.now, phase='before')

    def test_observed_identities_are_bound_to_real_browser_steps(self):
        record = receipt.build(self.browser, self.repair, **self.args)
        self.assertEqual(record['observedLiveArtHelloSha'], 'e' * 40)
        self.assertEqual(record['intendedCandidateArtHelloSha'], 'a' * 40)
        self.assertEqual(record['observedSchoolRepairExecutionUid'], 1000)

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

    def test_after_cutover_must_observe_the_actual_candidate(self):
        with self.assertRaises(AssertionError):
            receipt.build(self.browser, self.repair, **{**self.args, 'phase': 'after'})
        receipt.build(self.browser, self.repair, **{**self.args, 'phase': 'after', 'live': 'a' * 40})

    def test_mismatched_or_privileged_repair_cannot_be_relabelled(self):
        for patch in [dict(state='unknown'), dict(repairConfigSha256='f' * 64), dict(executionUid=0)]:
            with self.subTest(patch=patch), self.assertRaises(AssertionError):
                receipt.build(self.browser, {**self.repair, **patch}, **self.args)


if __name__ == '__main__':
    unittest.main()
