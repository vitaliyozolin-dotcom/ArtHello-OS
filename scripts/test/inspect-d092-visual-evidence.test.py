import contextlib
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("inspection", Path(__file__).resolve().parents[1] / "inspect-d092-visual-evidence.py")
inspection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspection)
CHECKED_SHA = "a" * 40
NOW = datetime(2026, 9, 9, tzinfo=timezone.utc)


def trigger():
    env = {"GITHUB_REPOSITORY": inspection.REPOSITORY, "GITHUB_ACTOR": inspection.OWNER,
           "GITHUB_TRIGGERING_ACTOR": inspection.OWNER, "GITHUB_EVENT_NAME": "push",
           "GITHUB_REF": "refs/heads/main", "GITHUB_RUN_ATTEMPT": "1",
           "RUNNER_ENVIRONMENT": "github-hosted", "GITHUB_SHA": CHECKED_SHA}
    event = {"repository": {"id": inspection.REPOSITORY_ID, "full_name": inspection.REPOSITORY, "fork": False},
             "sender": {"login": inspection.OWNER}, "ref": "refs/heads/main", "after": CHECKED_SHA,
             "head_commit": {"id": CHECKED_SHA, "message": inspection.PREFIX + " — receipt recovery"}}
    return env, event


def metadata():
    repository = {"id": inspection.REPOSITORY_ID, "full_name": inspection.REPOSITORY}
    run = {"id": inspection.RUN_ID, "head_sha": inspection.SOURCE_SHA, "head_branch": "main", "run_attempt": 1,
           "event": "push", "status": "completed", "conclusion": "failure",
           "path": ".github/workflows/verify-content-tasks-visual.yml",
           "repository": repository.copy(), "head_repository": repository.copy(),
           "actor": {"login": inspection.OWNER}, "triggering_actor": {"login": inspection.OWNER}}
    artifact = {"id": inspection.ARTIFACT_ID, "name": inspection.ARTIFACT_NAME,
                "size_in_bytes": inspection.ARTIFACT_BYTES, "digest": inspection.ARTIFACT_DIGEST,
                "expired": False, "expires_at": "2026-09-23T09:11:30Z",
                "workflow_run": {"id": inspection.RUN_ID, "head_sha": inspection.SOURCE_SHA, "head_branch": "main",
                                 "repository_id": inspection.REPOSITORY_ID, "head_repository_id": inspection.REPOSITORY_ID}}
    return run, {"total_count": 1, "artifacts": [artifact]}, {
        "ref": "refs/heads/main", "object": {"type": "commit", "sha": CHECKED_SHA}}


class InspectionTests(unittest.TestCase):
    def test_exact_source_artifact_and_frozen_reader_are_accepted(self):
        env, event = trigger()
        inspection.validate_trigger(env, event, CHECKED_SHA)
        inspection.validate_metadata(*metadata(), CHECKED_SHA, NOW)
        self.assertEqual(hashlib.sha256(inspection.READER.read_bytes()).hexdigest(), inspection.READER_SHA256)

    def test_runtime_trigger_rejects_pr_fork_other_owner_branch_prefix_and_retry(self):
        for key, value in {"GITHUB_REPOSITORY": "other/ArtHello-OS", "GITHUB_ACTOR": "other",
                           "GITHUB_TRIGGERING_ACTOR": "other", "GITHUB_EVENT_NAME": "pull_request",
                           "GITHUB_REF": "refs/heads/topic", "GITHUB_RUN_ATTEMPT": "2",
                           "RUNNER_ENVIRONMENT": "self-hosted", "GITHUB_SHA": "b" * 40}.items():
            env, event = trigger()
            env[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                inspection.validate_trigger(env, event, CHECKED_SHA)
        for section, key, value in (("repository", "fork", True), ("repository", "id", 42),
                                    ("repository", "full_name", "other/ArtHello-OS"),
                                    ("sender", "login", "other"), ("head_commit", "id", "b" * 40),
                                    ("head_commit", "message", "D092: unrelated"),
                                    ("head_commit", "message", inspection.PREFIX.lower())):
            env, event = trigger()
            event[section][key] = value
            with self.subTest(section=section, key=key), self.assertRaises(ValueError):
                inspection.validate_trigger(env, event, CHECKED_SHA)

    def test_producing_run_and_main_mismatches_are_rejected(self):
        for key, value in {"id": 42, "head_sha": CHECKED_SHA, "head_branch": "topic", "run_attempt": 2,
                           "event": "workflow_dispatch", "status": "in_progress", "conclusion": "success",
                           "path": ".github/workflows/other.yml"}.items():
            run, artifacts, main = metadata()
            run[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                inspection.validate_metadata(run, artifacts, main, CHECKED_SHA, NOW)
        for section, key, value in (("repository", "id", 42), ("head_repository", "full_name", "other/repo"),
                                    ("actor", "login", "other"), ("triggering_actor", "login", "other")):
            run, artifacts, main = metadata()
            run[section][key] = value
            with self.assertRaises(ValueError):
                inspection.validate_metadata(run, artifacts, main, CHECKED_SHA, NOW)
        for key, value in (("sha", "b" * 40), ("type", "tag")):
            run, artifacts, main = metadata()
            main["object"][key] = value
            with self.assertRaises(ValueError):
                inspection.validate_metadata(run, artifacts, main, CHECKED_SHA, NOW)

    def test_artifact_identity_digest_expiration_and_run_link_mismatches_are_rejected(self):
        for key, value in {"id": 42, "name": "other", "size_in_bytes": 389415, "digest": "sha256:" + "0" * 64,
                           "expired": True, "expires_at": "2026-09-08T00:00:00Z"}.items():
            run, artifacts, main = metadata()
            artifacts["artifacts"][0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                inspection.validate_metadata(run, artifacts, main, CHECKED_SHA, NOW)
        for key, value in {"id": 42, "head_sha": CHECKED_SHA, "head_branch": "topic",
                           "repository_id": 42, "head_repository_id": 42}.items():
            run, artifacts, main = metadata()
            artifacts["artifacts"][0]["workflow_run"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                inspection.validate_metadata(run, artifacts, main, CHECKED_SHA, NOW)
        for patch in ({"total_count": 2}, {"total_count": True}, {"artifacts": []}):
            run, artifacts, main = metadata()
            with self.assertRaises(ValueError):
                inspection.validate_metadata(run, {**artifacts, **patch}, main, CHECKED_SHA, NOW)

    def run_guard(self, env, event, metadata_values):
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as temporary, \
             mock.patch.dict(inspection.os.environ, {**env, "GITHUB_EVENT_PATH": "/synthetic-event", "RUNNER_TEMP": temporary}, clear=True), \
             mock.patch.object(inspection.Path, "read_text", return_value=json.dumps(event)), \
             mock.patch.object(inspection, "command_output", return_value=CHECKED_SHA.encode()), \
             mock.patch.object(inspection, "gh_json", side_effect=metadata_values) as fetch, \
             mock.patch.object(inspection, "download_artifact", side_effect=RuntimeError("unprinted remote response")) as download, \
             contextlib.redirect_stdout(output):
            result = inspection.main()
        self.assertEqual(result, 1)
        self.assertNotIn("unprinted remote response", output.getvalue())
        return [json.loads(line) for line in output.getvalue().splitlines()], fetch, download

    def test_refusal_happens_before_binary_download_and_pr_before_metadata_read(self):
        env, event = trigger()
        env["GITHUB_EVENT_NAME"] = "pull_request"
        rows, fetch, download = self.run_guard(env, event, metadata())
        fetch.assert_not_called()
        download.assert_not_called()
        self.assertEqual(rows[-1]["stage"], "trigger_validation")
        for mismatch in ("main", "digest", "expired", "producer"):
            values = copy.deepcopy(metadata())
            if mismatch == "main": values[2]["object"]["sha"] = "b" * 40
            if mismatch == "digest": values[1]["artifacts"][0]["digest"] = "sha256:" + "0" * 64
            if mismatch == "expired": values[1]["artifacts"][0]["expired"] = True
            if mismatch == "producer": values[0]["conclusion"] = "success"
            rows, fetch, download = self.run_guard(*trigger(), values)
            self.assertEqual(fetch.call_count, 3)
            download.assert_not_called()
            self.assertEqual(rows[-1]["stage"], "metadata_validation")

    def test_validated_metadata_allows_one_get_and_download_error_is_bounded(self):
        values = copy.deepcopy(metadata())
        # Keep this synthetic orchestration fixture unexpired regardless of test date.
        values[1]["artifacts"][0]["expires_at"] = "2999-01-01T00:00:00Z"
        rows, fetch, download = self.run_guard(*trigger(), values)
        self.assertEqual(fetch.call_count, 3)
        download.assert_called_once()
        self.assertEqual(rows[0]["kind"], "d092-existing-artifact-metadata")
        self.assertEqual(rows[0]["result"], "pass")
        self.assertEqual(rows[1]["stage"], "archive_download")


if __name__ == "__main__":
    unittest.main()
