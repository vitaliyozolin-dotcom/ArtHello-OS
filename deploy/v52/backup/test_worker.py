#!/usr/bin/env python3
"""Behavioral backup worker tests using disposable SQLite files and durable state."""
import concurrent.futures
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


w = load("worker")
p = load("probe")


class Clock:
    now = dt.datetime(2026, 9, 8, 11, 0, tzinfo=dt.timezone.utc)
    seconds = 10

    def advance(self, seconds):
        self.now += dt.timedelta(seconds=seconds)
        self.seconds += seconds


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.data = self.base / "data"
        self.root = self.base / "backups"
        self.control_dir = self.base / "control"
        for path, mode, seed in ((self.data, 0o755, None), (self.root, 0o700, "ARTHELLO_BACKUP_STORAGE_V1\n"), (self.control_dir, 0o750, "ARTHELLO_BACKUP_CONTROL_V1\n")):
            path.mkdir(mode=mode)
            path.chmod(mode)
            if seed:
                (path / ".layout").write_text(seed)
                (path / ".layout").chmod(0o444)
        (self.data / "d1").mkdir()
        self.source = self.data / "d1" / "fixture.sqlite"
        with sqlite3.connect(self.source) as db:
            db.executescript("CREATE TABLE app_users(id TEXT PRIMARY KEY); CREATE TABLE entities(id TEXT PRIMARY KEY, amount INTEGER); CREATE TABLE system_runtime_state(id TEXT PRIMARY KEY); INSERT INTO entities VALUES('fixture',12345);")
        self.clock = Clock()
        self.controllers = []

    def tearDown(self):
        for control in self.controllers:
            if control.thread:
                control.thread.join(timeout=10)
        self.temporary.cleanup()

    def control(self, **kwargs):
        value = w.Control(self.source, "d1/fixture.sqlite", root=self.root, clock=lambda: self.clock.now, monotonic=lambda: self.clock.seconds, **kwargs)
        self.controllers.append(value)
        return value

    def finish(self, control):
        if control.thread:
            control.thread.join(timeout=10)
            self.assertFalse(control.thread.is_alive())

    def initial(self):
        control = self.control()
        control.tick()
        self.finish(control)
        self.assertTrue(p.verified(control.status()))
        return control

    def test_initial_real_cli_restore_precedes_schedule_enable(self):
        entered, proceed = threading.Event(), threading.Event()

        def delayed(config):
            entered.set()
            self.assertTrue(proceed.wait(5))
            return w.run_cli(config)

        control = self.control(runner=delayed)
        control.tick()
        self.assertTrue(entered.wait(2))
        status = control.status()
        self.assertEqual(status["state"], "running")
        self.assertFalse(status["initialVerified"])
        self.assertFalse(status["schedule"]["enabled"])
        self.assertFalse(p.verified(status))
        proceed.set()
        self.finish(control)
        status = control.status()
        self.assertTrue(p.verified(status))
        self.assertEqual(status["schedule"]["nextAt"], "2026-09-09T00:15:00+00:00")
        directory = self.root / status["lastVerifiedBackupId"]
        self.source.unlink()
        self.assertTrue(w.backup.verify_backup(directory)["restoreVerified"])
        with sqlite3.connect(directory / "database.sqlite") as db:
            self.assertEqual(db.execute("SELECT amount FROM entities WHERE id='fixture'").fetchone(), (12345,))

    def test_failed_initial_never_enables_schedule_and_retries_after_backoff(self):
        calls = []

        def fail(config):
            calls.append(config)
            raise RuntimeError("private source details")

        control = self.control(runner=fail)
        control.tick()
        self.finish(control)
        self.assertEqual(control.status()["state"], "failed")
        self.assertFalse(control.status()["schedule"]["enabled"])
        self.assertEqual(control.status()["history"], [])
        self.assertNotIn("private source", json.dumps(control.status()))
        control.tick()
        self.assertEqual(len(calls), 1)
        self.clock.advance(301)
        control.runner = w.run_cli
        control.tick()
        self.finish(control)
        self.assertTrue(p.verified(control.status()))

    def test_concurrent_manual_requests_admit_one_real_backup(self):
        control = self.initial()
        self.clock.advance(6)
        entered, proceed = threading.Event(), threading.Event()

        def delayed(config):
            entered.set()
            self.assertTrue(proceed.wait(5))
            return w.run_cli(config)

        control.runner = delayed
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
            statuses = list(executor.map(lambda _: control.create()[0], range(24)))
        self.assertEqual(statuses.count(202), 1)
        self.assertEqual(statuses.count(409), 23)
        self.assertTrue(entered.is_set())
        self.assertEqual(len(control.status()["history"]), 1)
        control.tick()
        proceed.set()
        self.finish(control)
        self.assertEqual(len(control.status()["history"]), 2)
        self.assertEqual(control.create()[0], 409)

    def test_restart_does_not_repeat_completed_backup_and_catches_up_once(self):
        first = self.initial()
        first_id = first.status()["lastVerifiedBackupId"]
        restarted = self.control()
        restarted.tick()
        self.assertIsNone(restarted.thread)
        self.clock.advance(2 * 86400)
        restarted.tick()
        self.finish(restarted)
        self.assertEqual(len(restarted.status()["history"]), 2)
        self.assertNotEqual(restarted.status()["lastVerifiedBackupId"], first_id)
        self.assertEqual(restarted.state["lastDueSlot"], "2026-09-10T00:15:00+00:00")
        again = self.control()
        again.tick()
        self.assertIsNone(again.thread)
        self.assertEqual(len(again.status()["history"]), 2)

    def test_interrupted_unfinished_initial_is_failed_then_recovered(self):
        control = self.control()
        control.state.update(state="running", activeAttempt={"id": "a" * 32, "trigger": "initial", "startedAt": self.clock.now.isoformat(), "dueSlot": w.due_slot(self.clock.now).isoformat()})
        control.save()
        restarted = self.control()
        self.assertEqual(restarted.state["lastFailure"], "interrupted")
        self.assertFalse(p.verified(restarted.status()))
        restarted.tick()
        self.finish(restarted)
        self.assertTrue(p.verified(restarted.status()))

    def test_last_failure_retains_prior_history_and_daily_schedule(self):
        control = self.initial()
        self.clock.advance(6)
        control.runner = lambda _: (_ for _ in ()).throw(RuntimeError("failure"))
        self.assertEqual(control.create()[0], 202)
        self.finish(control)
        self.assertEqual(control.status()["state"], "failed")
        self.assertTrue(control.status()["schedule"]["enabled"])
        self.assertEqual(len(control.status()["history"]), 1)
        self.assertFalse(p.verified(control.status()))

    def test_existing_manifest_cannot_satisfy_new_attempt(self):
        control = self.initial()
        first = control.status()["lastVerifiedBackupId"]
        self.clock.advance(6)
        control.runner = lambda _: first
        self.assertEqual(control.create()[0], 202)
        self.finish(control)
        self.assertEqual(control.status()["state"], "failed")
        self.assertEqual(control.status()["lastVerifiedBackupId"], first)
        self.assertEqual(len(control.status()["history"]), 1)

    def test_new_manifest_checksum_is_checked_before_acceptance(self):
        def corrupt(config):
            identifier = w.run_cli(config)
            database = self.root / identifier / "database.sqlite"
            data = database.read_bytes()
            database.write_bytes(b"x" + data[1:])
            return identifier

        control = self.control(runner=corrupt)
        control.tick()
        self.finish(control)
        self.assertFalse(control.status()["initialVerified"])
        self.assertEqual(control.status()["state"], "failed")

    def test_invalid_state_or_identity_refuses_without_replacing_config(self):
        control = self.initial()
        original = control.config_path.read_bytes()
        for value in ([], {**control.state, "sourceRelative": "d1/other.sqlite"}, {**control.state, "extra": True}, {**control.state, "lastDueSlot": "2026-09-08T00:16:00+00:00"}):
            w.atomic_json(control.state_path, value)
            with self.assertRaises(w.Refused):
                self.control()
            self.assertEqual(control.config_path.read_bytes(), original)

    def test_state_file_symlink_public_mode_and_duplicate_worker_are_refused(self):
        control = self.initial()
        control.state_path.chmod(0o644)
        with self.assertRaises(w.Refused):
            self.control()
        control.state_path.unlink()
        control.state_path.symlink_to(control.config_path)
        with self.assertRaises(w.Refused):
            self.control()
        with w.singleton(self.root):
            with self.assertRaisesRegex(w.Refused, "already_running"):
                with w.singleton(self.root):
                    self.fail("duplicate singleton admitted")

    def test_state_persistence_failure_never_starts_backup(self):
        control = self.control(runner=lambda _: self.fail("backup must not start"))
        with patch.object(control, "save", side_effect=OSError("disk full")):
            with self.assertRaises(w.Refused):
                control.create()
        self.assertTrue(control.fatal)
        self.assertFalse(control.active)
        with self.assertRaises(w.Refused):
            control.status()

    def test_layout_checks_ro_source_volume_seeds_and_path_boundaries(self):
        mounts = {"/": {"ro"}, str(self.data): {"ro"}, str(self.root): {"rw"}, str(self.control_dir): {"rw"}}

        def check(relative="d1/fixture.sqlite", current_mounts=None):
            return w.validate_layout(relative, data=self.data, root=self.root, control=self.control_dir, mounts=mounts if current_mounts is None else current_mounts, required_uid=os.geteuid(), required_gid=os.getegid())

        self.assertEqual(check(), self.source)
        for relative in ("../fixture.sqlite", "d1/../fixture.sqlite", "/data/d1/fixture.sqlite", "d1//fixture.sqlite"):
            with self.assertRaises(w.Refused):
                check(relative)
        with self.assertRaises(w.Refused):
            check(current_mounts={**mounts, str(self.data): {"rw"}})
        with self.assertRaises(w.Refused):
            check(current_mounts={**mounts, w.ACTIVATION: {"ro"}})
        self.source.chmod(0o666)
        with self.assertRaisesRegex(w.Refused, "world_writable"):
            check()
        self.source.chmod(0o600)
        (self.root / ".layout").chmod(0o644)
        with self.assertRaises(w.Refused):
            check()

    def test_probe_requires_matching_verified_history_and_schedule(self):
        status = self.initial().status()
        self.assertTrue(p.verified(status))
        for mutation in ({"initialVerified": False}, {"history": []}, {"state": "failed"}, {"state": "running"}, {"schedule": {"enabled": False}}, {"lastVerifiedBackupId": "arbitrary"}):
            self.assertFalse(p.verified({**status, **mutation}))


if __name__ == "__main__":
    unittest.main()
