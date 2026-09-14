import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SOURCE = "a" * 40


def load_helper():
    path = ROOT / ".github/scripts/download-v52-artifact-d182.py"
    spec = importlib.util.spec_from_file_location("d182_delivery", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Result:
    stdout = (SOURCE + "\n").encode()


class Tests(unittest.TestCase):
    def setUp(self):
        self.delivery = load_helper()
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.environment = {
            "GITHUB_REPOSITORY": self.delivery.REPOSITORY,
            "EXPECTED_REPOSITORY": self.delivery.REPOSITORY,
            "GITHUB_ACTOR": self.delivery.OWNER,
            "GITHUB_TRIGGERING_ACTOR": self.delivery.OWNER,
            "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_WORKFLOW": "Deploy ArtHello mobile finance branch D182",
            "CUTOVER_CONFIRMATION": "DEPLOY D182 TO PRODUCTION",
            "RELEASE_SHA": SOURCE,
            "CHECKED_SOURCE_SHA": SOURCE,
            "TRIGGER_VERIFY_RUN_ID": "1",
            "GITHUB_RUN_ID": "2",
            "GITHUB_RUN_ATTEMPT": "1",
            "RUNNER_TEMP": self.temporary.name,
        }

    def context(self, environment=None):
        with patch.object(self.delivery.subprocess, "run", return_value=Result()):
            return self.delivery.context(environment or self.environment)

    def test_accepts_only_the_exact_manual_d182_context(self):
        source, run_id, directory = self.context()
        self.assertEqual((source, run_id), (SOURCE, 1))
        self.assertEqual(directory.parent, Path(self.temporary.name))

    def test_rejects_wrong_event_workflow_confirmation_or_actor(self):
        for key, value in (
            ("GITHUB_EVENT_NAME", "workflow_run"),
            ("GITHUB_WORKFLOW", "other"),
            ("CUTOVER_CONFIRMATION", "wrong"),
            ("GITHUB_ACTOR", "other"),
        ):
            with self.subTest(key=key):
                environment = dict(self.environment, **{key: value})
                with self.assertRaisesRegex(self.delivery.Refused, "PROTECTED_CONTEXT"):
                    self.context(environment)


if __name__ == "__main__":
    unittest.main()
