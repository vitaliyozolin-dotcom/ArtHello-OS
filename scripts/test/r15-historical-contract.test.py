import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('historical_r15', ROOT / 'scripts/run-r15-historical-contract.py')
historical = importlib.util.module_from_spec(spec)
spec.loader.exec_module(historical)


class HistoricalR15Tests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.target = Path(self.temporary.name)
        historical.extract_current(ROOT, self.target)

    def test_only_four_reviewed_fixture_inputs_change_and_current_runtime_is_preserved(self):
        pins = historical.check_current(self.target)
        before = {str(p.relative_to(self.target)): p.read_bytes() for p in self.target.rglob('*') if p.is_file()}
        historical.overlay_historical(ROOT, self.target, pins)
        after = {str(p.relative_to(self.target)): p.read_bytes() for p in self.target.rglob('*') if p.is_file()}
        self.assertEqual({p for p in before.keys() | after.keys() if before.get(p) != after.get(p)},
                         set(historical.ARCHIVED_PATHS) | {historical.WORKFLOW, historical.CONTROLLER})
        self.assertTrue(all(after[p] == raw for p, raw in before.items() if '/src/' in p))
        for path, expected in pins['sourceFiles'].items():
            self.assertEqual(historical.digest(after[path]), expected, path)

    def test_current_bank_manifest_and_protocol_drift_are_rejected(self):
        for path in (*historical.CURRENT_PINS, '.github/scripts/r14-backup-adoption.py'):
            with self.subTest(path=path):
                file = self.target / path
                original = file.read_bytes()
                file.write_bytes(b'unreviewed\n')
                with self.assertRaisesRegex(ValueError, 'CURRENT_(SOURCE|PROTOCOL)_DRIFT'):
                    historical.check_current(self.target)
                file.write_bytes(original)

    def test_current_workflow_drift_is_rejected(self):
        file = self.target / historical.WORKFLOW
        file.write_text(file.read_text().replace('persist-credentials: false', 'persist-credentials: true', 1))
        with self.assertRaisesRegex(ValueError, 'CURRENT_WORKFLOW_DRIFT'):
            historical.check_current(self.target)

    def test_old_controller_and_pins_cannot_be_redefined(self):
        for path, reason in [(historical.PINS_PATH, 'FROZEN_R15_PINS_DRIFT'),
                             (historical.ARCHIVED_CONTROLLER, 'FROZEN_R15_CONTROLLER_DRIFT')]:
            file = self.target / path
            original = file.read_bytes()
            file.write_bytes(b'unreviewed\n')
            with self.assertRaisesRegex(ValueError, reason):
                historical.check_current(self.target)
            file.write_bytes(original)

    def test_historical_substitution_requires_original_bytes(self):
        pins = historical.check_current(self.target)
        pins['sourceFiles'][historical.ARCHIVED_PATHS[0]] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'ARCHIVED_SOURCE_DRIFT'):
            historical.overlay_historical(ROOT, self.target, pins)


if __name__ == '__main__':
    unittest.main()
