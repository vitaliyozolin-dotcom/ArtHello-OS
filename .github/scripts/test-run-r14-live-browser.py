import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("wrapper", Path(__file__).with_name("run-r14-live-browser.py"))
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)


def evidence(phase="after"):
    context = {"releaseSha": "a" * 40, "sourceTree": "b" * 40, "runId": "123", "runAttempt": "1",
               "candidateContainerId": "c" * 64, "candidateName": "arthello-direct-123-1", "imageId": "sha256:" + "d" * 64,
               "browserSourceSha": "a" * 40, "browserFingerprint": "e" * 64, "previousContainerId": "f" * 64,
               "rollbackVolume": "arthello-rollback-123-1", "originalRouteSha256": "1" * 64, "publicRouteSha256": "2" * 64}
    record = {"context": context, "contextSha256": "3" * 64, "latestAttempt": "2",
              "phase": "public-started" if phase == "after" else "maintenance-started"}
    environment = {"RELEASE_SHA": "a" * 40, "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "2", "BROWSER_PHASE": phase,
                   "BROWSER_SOURCE_SHA": "a" * 40, "BROWSER_FINGERPRINT": "e" * 64, "ARTHELLO_E2E_PASSWORD": "private-fixture"}
    marker = {"schemaVersion": 1, "state": "activation-started", "releaseSha": "a" * 40, "runId": "123", "runAttempt": "2",
              "candidateContainerId": "c" * 64, "previousContainerId": "f" * 64, "rollbackVolume": "arthello-rollback-123-1",
              "originalRouteSha256": "1" * 64, "candidateRouteSha256": "2" * 64,
              "diagnosticDirectory": str(Path.home() / ".config/arthello/release-state/public-audit/arthello-deploy-123-2")}
    return environment, record, marker if phase == "after" else None


def observed(context, *, different_id=False, paused=False):
    return {"Id": "9" * 64 if different_id else context["candidateContainerId"], "Name": "/" + context["candidateName"],
            "Image": context["imageId"], "State": {"Running": True, "Paused": paused, "Restarting": False},
            "Config": {"Labels": {"arthello.release.sha": context["releaseSha"], "arthello.release.tree": context["sourceTree"]}}}


class WrapperTests(unittest.TestCase):
    def test_both_phases_bind_the_frozen_call_to_verified_context_before_and_after(self):
        for phase in ("candidate", "after"):
            env, record, marker = evidence(phase)
            calls = []
            def browser(child):
                calls.append("browser")
                self.assertEqual(child["BROWSER_CANDIDATE_ID"], record["context"]["candidateContainerId"])
                self.assertEqual(child["RELEASE_SHA"], env["RELEASE_SHA"])
                self.assertEqual(child["OBSERVED_LIVE_ARTHELLO_SHA"], env["RELEASE_SHA"])
                self.assertEqual(child["D080_CANDIDATE_CONTEXT_SHA256"], record["contextSha256"])
                return 0
            wrapper.execute(env, lambda: (record, marker), lambda context: calls.append("identity"), browser)
            self.assertEqual(calls, ["identity", "browser", "identity"])

    def test_same_source_substituted_container_and_paused_runtime_block_in_both_phases(self):
        for phase in ("candidate", "after"):
            for position in ("before", "after"):
                for change in ("other_id", "paused"):
                    env, record, marker = evidence(phase)
                    runtime_calls = 0
                    browser_calls = []
                    def runtime(context):
                        nonlocal runtime_calls
                        runtime_calls += 1
                        changed = runtime_calls == (1 if position == "before" else 2)
                        app = observed(context, different_id=changed and change == "other_id", paused=changed and change == "paused")
                        def read(arguments):
                            if arguments[:2] == ["container", "ls"]:
                                return app["Id"] + "\n"
                            self.assertEqual(arguments, ["container", "inspect", context["candidateContainerId"]])
                            return json.dumps([app])
                        wrapper.observe(context, read)
                    with self.subTest(phase=phase, position=position, change=change), self.assertRaises(ValueError):
                        wrapper.execute(env, lambda: (record, marker), runtime, lambda child: browser_calls.append(child) or 0)
                    self.assertEqual(len(browser_calls), 0 if position == "before" else 1)

    def test_changed_state_or_failed_browser_cannot_complete(self):
        env, record, marker = evidence()
        snapshots = iter([(record, marker), ({**record, "latestAttempt": "3"}, marker)])
        with self.assertRaises(ValueError):
            wrapper.execute(env, lambda: next(snapshots), lambda context: None, lambda child: 0)
        with self.assertRaises(ValueError):
            wrapper.execute(env, lambda: (record, marker), lambda context: None, lambda child: 1)

    def test_candidate_resume_uses_current_attempt_without_rebinding_retained_resources(self):
        env, record, marker = evidence("candidate")
        record["latestAttempt"] = "1"
        self.assertEqual(wrapper.validate_snapshot(record, marker, env)["candidateName"], "arthello-direct-123-1")
        wrapper.validate_snapshot(record, marker, {**env, "GITHUB_RUN_ATTEMPT": "1"})
        record["latestAttempt"] = "3"
        with self.assertRaises(ValueError):
            wrapper.validate_snapshot(record, marker, env)
        env, record, marker = evidence("after")
        record["latestAttempt"] = "1"
        with self.assertRaises(ValueError):
            wrapper.validate_snapshot(record, marker, env)

    def test_foreign_source_and_stale_or_missing_public_boundary_are_rejected(self):
        env, record, marker = evidence()
        for wrong in (None, {**marker, "runAttempt": "1"}, {**marker, "candidateContainerId": "9" * 64},
                      {**marker, "candidateRouteSha256": "9" * 64}):
            with self.subTest(marker=wrong), self.assertRaises(ValueError):
                wrapper.validate_snapshot(record, wrong, env)
        for changed in ({**env, "RELEASE_SHA": "f" * 40}, {**env, "BROWSER_SOURCE_SHA": "f" * 40},
                        {**env, "BROWSER_CANDIDATE_ID": "9" * 64}, {**env, "BROWSER_PHASE": "before"}):
            with self.subTest(environment=changed), self.assertRaises(ValueError):
                wrapper.validate_snapshot(record, marker, changed)

    def test_snapshot_uses_canonical_home_state_and_rejects_duplicate_marker_keys(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(Path, "home", return_value=Path(temporary)):
            env, record, marker = evidence()
            root = Path(temporary) / ".config/arthello/release-state"
            root.mkdir(parents=True, mode=0o700)
            path = root / ("candidate-acceptance-" + env["RELEASE_SHA"] + ".json")
            marker_path = root / ("activation-" + env["RELEASE_SHA"] + ".json")
            for target, value in ((path, record), (marker_path, marker)):
                target.write_text(json.dumps(value))
                target.chmod(0o600)
            called = []
            state = SimpleNamespace(load_state=lambda supplied: called.append(supplied) or record)
            self.assertEqual(wrapper.load_snapshot(env, state), (record, marker))
            self.assertEqual(called, [path])
            marker_path.write_text('{"runAttempt":"99",' + json.dumps(marker)[1:])
            with self.assertRaises(ValueError):
                wrapper.load_snapshot(env, state)
            root.chmod(0o755)
            with self.assertRaises(ValueError):
                wrapper.load_snapshot(env, state)

    def test_candidate_cannot_run_across_any_existing_public_marker(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(Path, "home", return_value=Path(temporary)):
            env, record, _ = evidence("candidate")
            root = Path(temporary) / ".config/arthello/release-state"
            root.mkdir(parents=True, mode=0o700)
            path = root / ("candidate-acceptance-" + env["RELEASE_SHA"] + ".json")
            path.write_text(json.dumps(record))
            path.chmod(0o600)
            state = SimpleNamespace(load_state=lambda supplied: record)
            self.assertEqual(wrapper.load_snapshot(env, state), (record, None))
            marker = root / ("activation-" + env["RELEASE_SHA"] + ".json")
            marker.write_text("malformed marker")
            with self.assertRaises(ValueError):
                wrapper.load_snapshot(env, state)
            marker.unlink()
            marker.symlink_to(root / "absent")
            with self.assertRaises(ValueError):
                wrapper.load_snapshot(env, state)

    def test_frozen_child_executes_in_the_checked_checkout_and_inherits_nonce_stdin(self):
        env, _, _ = evidence("candidate")
        with patch.object(wrapper.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
            self.assertEqual(wrapper.run_frozen(env), 0)
        run.assert_called_once_with(["bash", str(wrapper.HERE / "run-r10-live-browser.sh")],
                                    env=env, cwd=wrapper.HERE.parent.parent, check=False)


if __name__ == "__main__":
    unittest.main()
