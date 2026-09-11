#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "run-d132-finance-history.py"
SPEC = importlib.util.spec_from_file_location("d129_finance_history", MODULE_PATH)
history = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(history)


class D132FinanceHistoryTests(unittest.TestCase):
    def test_exact_current_snapshot_is_accepted(self):
        files = {name: b"approved:" + name.encode() for name in history.PINNED_CURRENT_FILES}
        pins = {name: history.digest(raw) for name, raw in files.items()}
        history.verify_snapshot(
            head="b" * 40,
            parent=history.EXPECTED_PARENT,
            changed=history.EXPECTED_CHANGES,
            read=files.__getitem__,
            pins=pins,
        )

    def test_parent_scope_and_content_drift_fail_closed(self):
        files = {name: b"approved:" + name.encode() for name in history.PINNED_CURRENT_FILES}
        pins = {name: history.digest(raw) for name, raw in files.items()}
        cases = [
            ("a" * 40, history.EXPECTED_CHANGES, files, pins, "BASELINE_MOVED"),
            (history.EXPECTED_PARENT, history.EXPECTED_CHANGES | {"other"}, files, pins, "CHANGE_SCOPE_DRIFT"),
            (history.EXPECTED_PARENT, history.EXPECTED_CHANGES, {**files, next(iter(files)): b"changed"}, pins, "CURRENT_SOURCE_DRIFT"),
        ]
        for parent, changed, current, expected, reason in cases:
            with self.subTest(reason=reason), self.assertRaisesRegex(ValueError, reason):
                history.verify_snapshot("b" * 40, parent, changed, current.__getitem__, expected)

    def test_unknown_suite_is_rejected_before_historical_execution(self):
        with self.assertRaisesRegex(ValueError, "UNKNOWN_SUITE"):
            history.historical_commands("r18")


if __name__ == "__main__":
    unittest.main()
