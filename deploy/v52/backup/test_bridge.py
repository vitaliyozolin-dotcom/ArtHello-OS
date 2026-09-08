import concurrent.futures
import datetime as dt
import importlib.util
import json
import io
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location("bridge", Path(__file__).with_name("bridge.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class Command:
    def __init__(self):
        self.started = 0
        self.failed = False
        self.active = False
        self.schedule = True
        self.throw = False

    def __call__(self, *args):
        if self.throw:
            raise RuntimeError("private host path and credentials")
        if args == ("start", "--no-block", bridge.SERVICE):
            self.started += 1
            return ""
        if args[0] != "show" or args[1] not in (bridge.SERVICE, bridge.TIMER):
            raise AssertionError(args)
        if args[1] == bridge.TIMER:
            return f"LoadState=loaded\nActiveState={'active' if self.schedule else 'inactive'}\nUnitFileState={'enabled' if self.schedule else 'disabled'}\nNextElapseUSecRealtime=Tue 2026-09-08 00:15:00 UTC\nLastTriggerUSec=Mon 2026-09-07 00:15:00 UTC"
        return f"LoadState=loaded\nActiveState={'active' if self.active else 'failed' if self.failed else 'inactive'}\nResult={'exit-code' if self.failed else 'success'}\nExecMainExitTimestamp=Mon 2026-09-07 00:16:00 UTC"


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.command = Command()
        self.clock = 10
        self.control = bridge.BackupControl(self.root, self.command, lambda: self.clock)

    def tearDown(self):
        self.directory.cleanup()

    def copy(self, suffix="abcdefabcdef"):
        folder = self.root / ("arthello-v52-20260907T000000Z-" + suffix)
        folder.mkdir()
        (folder / "database.sqlite").write_bytes(b"example")
        (folder / "manifest.json").write_text(json.dumps({"format": "arthello-v52-sqlite-backup-v1", "backupId": folder.name, "bytes": 7, "completedAt": "2026-09-07T00:00:00+00:00", "sha256": "a" * 64, "restoreVerified": True, "integrityCheck": "ok", "inventory": {"rows": {"private": 47}}, "source": "/private/source"}))
        return folder

    def test_only_safe_completed_metadata_is_exposed(self):
        self.copy()
        result = self.control.status()
        self.assertEqual(result["history"][0]["status"], "verified_at_creation")
        self.assertNotIn("private", json.dumps(result))
        self.assertEqual(result["schedule"]["nextAt"], "2026-09-08T00:15:00+00:00")

    def test_corrupt_partial_and_symlink_are_not_reported_as_success(self):
        folder = self.copy()
        (folder / "database.sqlite").write_bytes(b"bad size")
        fake = self.root / "arthello-v52-20260907T000000Z-aaaaaaaaaaaa"
        fake.symlink_to(folder, target_is_directory=True)
        (self.root / ".incomplete-123").mkdir()
        result = self.control.status()
        self.assertEqual(result["history"], [])
        self.assertEqual(result["unreadableCopies"], 2)

    def test_non_object_manifests_are_omitted_without_breaking_status(self):
        folder = self.copy()
        for value in [[], None, 3, "text", True]:
            (folder / "manifest.json").write_text(json.dumps(value))
            result = self.control.status()
            self.assertEqual(result["history"], [])
            self.assertEqual(result["unreadableCopies"], 1)

    def test_concurrent_manual_requests_enqueue_one_fixed_service(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(lambda _: self.control.create()[0], range(20)))
        self.assertEqual(results.count(202), 1)
        self.assertEqual(results.count(409), 19)
        self.assertEqual(self.command.started, 1)
        self.assertEqual(self.control.status()["state"], "running")

    def test_timer_running_also_blocks_manual(self):
        self.command.active = True
        self.assertEqual(self.control.create()[0], 409)
        self.assertEqual(self.command.started, 0)

    def test_failed_service_keeps_old_success_and_disabled_schedule_visible(self):
        self.copy()
        self.command.failed = True
        self.command.schedule = False
        result = self.control.status()
        self.assertEqual(result["state"], "failed")
        self.assertEqual(len(result["history"]), 1)
        self.assertFalse(result["schedule"]["enabled"])

    def test_acceptance_is_not_completion(self):
        self.assertEqual(self.control.create()[0], 202)
        self.assertEqual(self.control.status()["history"], [])
        self.clock += 6
        self.command.failed = True
        self.assertEqual(self.control.status()["state"], "failed")

    def test_missing_installation_and_command_failure_propagate(self):
        self.command.throw = True
        with self.assertRaises(RuntimeError):
            self.control.create()
        self.assertIsNone(self.control.accepted_at)

    def http(self, method="GET", path="/status", headers="Host: backup.internal\r\nContent-Length: 0\r\n"):
        class Connection:
            def __init__(self, request):
                self.input = io.BytesIO(request)
                self.output = b""
            def makefile(self, *_args):
                return self.input
            def sendall(self, value):
                self.output += value
        connection = Connection(f"{method} {path} HTTP/1.0\r\n{headers}\r\n".encode())
        bridge.Handler(connection, ("local", 0), SimpleNamespace(control=self.control))
        return connection.output.decode()

    def test_http_handler_redacts_raw_errors(self):
        self.command.throw = True
        result = self.http()
        self.assertIn(" 503 ", result)
        self.assertNotIn("credentials", result)
        self.assertNotIn("private host", result)

    def test_http_rejects_host_path_query_and_body(self):
        for request in [
            {"path": "/status?path=/etc/passwd"},
            {"path": "/create?unit=other.service", "method": "POST"},
            {"headers": "Host: evil.example\r\n"},
            {"method": "POST", "path": "/create", "headers": "Host: backup.internal\r\nContent-Length: 1\r\n"},
            {"method": "POST", "path": "/restore"},
        ]:
            self.assertIn(" 403 ", self.http(**request))
        self.assertEqual(self.command.started, 0)

    def test_http_accepts_create_but_not_completion(self):
        result = self.http(method="POST", path="/create")
        self.assertIn(" 202 ", result)
        self.assertIn('"state": "running"', result)
        self.assertNotIn('"status": "verified"', result)
        self.assertEqual(self.command.started, 1)


if __name__ == "__main__":
    unittest.main()
