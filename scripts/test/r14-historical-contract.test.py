import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("historical", ROOT / "scripts/run-r14-historical-contract.py")
historical = importlib.util.module_from_spec(spec)
spec.loader.exec_module(historical)


class HistoricalContractTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.target = Path(self.temporary.name)
        historical.extract_current(ROOT, self.target)

    def test_only_reviewed_historical_inputs_are_replaced(self):
        pins = historical.check_current(self.target)
        before = {str(p.relative_to(self.target)): p.read_bytes()
                  for p in self.target.rglob("*") if p.is_file()}
        historical.overlay_historical(ROOT, self.target, pins)
        after = {str(p.relative_to(self.target)): p.read_bytes()
                 for p in self.target.rglob("*") if p.is_file()}
        changed = {p for p in before.keys() | after.keys() if before.get(p) != after.get(p)}
        self.assertTrue(changed.issubset(set(historical.ARCHIVED_PATHS) | {historical.WORKFLOW, historical.CONTROLLER}))
        for path, expected in pins["sourceFiles"].items():
            self.assertEqual(historical.digest(after[path]), expected, path)
        self.assertEqual(historical.digest(after[historical.CONTROLLER]), historical.CONTROLLER_SHA256)
        self.assertTrue(all(after[p] == value for p, value in before.items() if '/src/' in p))

    def test_current_source_changes_are_not_hidden(self):
        (self.target / 'deploy/v52/Dockerfile').write_text('unreviewed\n')
        with self.assertRaisesRegex(ValueError, 'CURRENT_SOURCE_DRIFT'):
            historical.check_current(self.target)

    def test_current_protocol_changes_are_not_hidden(self):
        (self.target / '.github/scripts/r14-backup-adoption.py').write_text('unreviewed\n')
        with self.assertRaisesRegex(ValueError, 'CURRENT_PROTOCOL_DRIFT'):
            historical.check_current(self.target)

    def test_altered_historical_pin_is_rejected(self):
        pins = historical.check_current(self.target)
        pins['sourceFiles'][historical.ARCHIVED_PATHS[0]] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'ARCHIVED_SOURCE_DRIFT'):
            historical.overlay_historical(ROOT, self.target, pins)

    def test_retired_controller_is_restored_only_in_private_fixture(self):
        pins = historical.check_current(self.target)
        (self.target / historical.CONTROLLER).unlink(missing_ok=True)
        historical.overlay_historical(ROOT, self.target, pins)
        self.assertEqual(historical.digest((self.target / historical.CONTROLLER).read_bytes()), historical.CONTROLLER_SHA256)


if __name__ == '__main__':
    unittest.main()
