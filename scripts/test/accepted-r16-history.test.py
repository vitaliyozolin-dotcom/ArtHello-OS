import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('accepted_history', ROOT / 'scripts/run-accepted-r16-history.py')
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)

class HistoryBoundaryTests(unittest.TestCase):
    def read(self, path):
        return (ROOT / path).read_bytes()

    def test_current_reviewed_source_and_frozen_protocol_match(self):
        history.check_current(self.read)

    def test_each_frozen_input_and_each_reviewed_changed_input_is_checked(self):
        import json
        paths = json.loads(self.read(history.PINS))['sourceFiles']
        for path in paths:
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'CURRENT_SOURCE_DRIFT'):
                history.check_current(lambda name: b'unreviewed' if name == path else self.read(name))

    def test_pins_controller_and_workflow_cannot_be_redefined(self):
        for path, reason in [(history.PINS, 'FROZEN_R16_PINS_DRIFT'),
                             ('deploy/v52/recovery-r17/r16-controller.yml', 'FROZEN_CONTROLLER_DRIFT'),
                             (history.WORKFLOW, 'CURRENT_WORKFLOW_DRIFT')]:
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, reason):
                history.check_current(lambda name: self.read(name) + b'\n# unreviewed\n' if name == path else self.read(name))

    def test_arbitrary_suite_is_refused_before_git_or_commands(self):
        with self.assertRaisesRegex(ValueError, 'UNKNOWN_SUITE'):
            history.run('deploy')

    def test_exact_outer_sha_required(self):
        import os
        from unittest.mock import patch
        with patch.dict(os.environ, {'CHECKED_SOURCE_SHA': '0' * 40}):
            with self.assertRaisesRegex(ValueError, 'CHECKED_SOURCE_MOVED'):
                history.run('r16')

    def test_every_prior_command_remains_in_historical_plan(self):
        self.assertEqual(len(history.COMMANDS['r14']), 2)
        self.assertEqual(len(history.COMMANDS['r15']), 2)
        self.assertEqual(len(history.COMMANDS['r16']), 10)
        for commands in history.COMMANDS.values():
            for command in commands:
                self.assertIn(command[0], ['node', 'python3', 'ruby'])
                self.assertNotIn('production_acceptance', command)

if __name__ == '__main__':
    unittest.main()
