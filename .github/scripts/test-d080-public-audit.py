import copy
import importlib.util
from pathlib import Path
import unittest


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


audit = module('audit', 'd080-public-audit.py')
d063 = module('d063', 'd063-activation-state.py')
fixture = module('state_fixture', 'test-d080-candidate-state.py')


class PublicAuditTest(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture.CandidateStateTest()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.fixture.begin()

    def verified(self, attempt):
        f = self.fixture
        receipt = dict(f.receipt, evidenceReference=f.receipt['evidenceReference'].removesuffix('/1') + '/' + attempt)
        path = f.work / ('acceptance-' + attempt + '.json')
        audit.state.atomic(path, receipt)
        audit.state.advance(f.path, receipt, attempt)
        return path, receipt

    def test_attempt_two_and_three_have_truthful_d063_evidence(self):
        for attempt in ('2', '3'):
            path, receipt = self.verified(attempt)
            work = audit.prepare(self.fixture.path, path, attempt)
            self.assertEqual(work.name, 'arthello-deploy-123-' + attempt)
            self.assertEqual(audit.state.read_private(work / 'candidate-acceptance.json'), receipt)
            self.assertEqual(audit.state.read_private(work / 'candidate-context.json'), self.fixture.context)
            c = self.fixture.context
            marker = self.fixture.root / ('d063-attempt-' + attempt + '.json')
            result = d063.begin(marker, c['releaseSha'], c['runId'], attempt, c['candidateContainerId'],
                                c['previousContainerId'], c['rollbackVolume'], c['originalRouteSha256'],
                                c['publicRouteSha256'], str(work))
            self.assertEqual(result['runAttempt'], attempt)
            self.assertEqual(result['diagnosticDirectory'], str(work))
            self.assertEqual(c['runAttempt'], '1')
            self.assertEqual(work.stat().st_mode & 0o777, 0o700)
            with self.assertRaises(FileExistsError):
                audit.prepare(self.fixture.path, path, attempt)

    def test_unverified_wrong_attempt_or_replaced_receipt_is_refused(self):
        f = self.fixture
        path, receipt = self.verified('2')
        for attempt, value in [('1', receipt), ('3', receipt), ('2', dict(receipt, candidateContainerId='f' * 64))]:
            audit.state.atomic(path, value, replace=True)
            with self.subTest(attempt=attempt), self.assertRaises((ValueError, AssertionError)):
                audit.prepare(f.path, path, attempt)

    def test_public_started_or_symlink_directory_is_refused(self):
        f = self.fixture
        path, receipt = self.verified('2')
        root = f.path.parent / 'public-audit'
        root.symlink_to(f.work, target_is_directory=True)
        with self.assertRaises(ValueError):
            audit.prepare(f.path, path, '2')
        root.unlink()
        audit.state.advance(f.path, receipt, '2', public=True)
        with self.assertRaises(ValueError):
            audit.prepare(f.path, path, '2')


if __name__ == '__main__':
    unittest.main()
