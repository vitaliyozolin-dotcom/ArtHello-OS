#!/usr/bin/env python3
"""Behavioral tests against disposable SQLite DBs. No production access."""
import contextlib
import datetime as dt
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest

spec = importlib.util.spec_from_file_location("backup", Path(__file__).with_name("backup.py"))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.live = self.root / "live"
        self.live.mkdir()
        self.destination = self.root / "backups"
        self.destination.mkdir(mode=0o700)
        self.source = self.live / "application.sqlite"
        self.db = sqlite3.connect(self.source)
        self.addCleanup(self.db.close)
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA wal_autocheckpoint=0;
            CREATE TABLE app_users (id INTEGER PRIMARY KEY, login TEXT);
            CREATE TABLE entities (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE system_runtime_state (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER);
            INSERT INTO accounts VALUES (1, 1000), (2, 1000);
            INSERT INTO app_users VALUES (1, 'fixture-owner');
            INSERT INTO entities VALUES (1, 'fixture');
        """)

    def run_backup(self):
        result = backup.run_backup(self.source, self.destination)
        self.assertEqual(result["status"], "verified")
        return self.destination / result["backupId"]

    def test_committed_wal_survives_backup_and_actual_restore_without_live_source(self):
        self.db.execute("INSERT INTO entities VALUES (2, 'committed-in-wal')")
        self.db.commit()
        self.assertGreater(Path(str(self.source) + "-wal").stat().st_size, 0)
        self.db.execute("INSERT INTO entities VALUES (3, 'not-committed')")
        directory = self.run_backup()
        with contextlib.closing(sqlite3.connect(directory / "database.sqlite")) as restored:
            self.assertEqual(restored.execute("SELECT id FROM entities ORDER BY id").fetchall(), [(1,), (2,)])
        self.db.rollback()
        self.db.close()
        self.source.unlink()
        self.assertTrue(backup.verify_backup(directory)["restoreVerified"])
        self.assertEqual({x.name for x in directory.iterdir()}, {"database.sqlite", "manifest.json"})
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual((directory / "database.sqlite").stat().st_mode & 0o777, 0o600)
        self.assertEqual((directory / "manifest.json").stat().st_mode & 0o777, 0o600)

    def test_live_concurrent_transfers_produce_consistent_snapshot(self):
        ready = threading.Event()
        stop = threading.Event()
        errors = []

        def writer():
            try:
                with contextlib.closing(sqlite3.connect(self.source)) as db:
                    for n in range(10000):
                        if stop.is_set():
                            break
                        db.execute("BEGIN IMMEDIATE")
                        db.execute("UPDATE accounts SET balance=balance-1 WHERE id=1")
                        db.execute("UPDATE accounts SET balance=balance+1 WHERE id=2")
                        db.commit()
                        ready.set()
                        time.sleep(0.001)
            except Exception as exc:
                errors.append(exc)

        thread = threading.Thread(target=writer)
        thread.start()
        try:
            self.assertTrue(ready.wait(3))
            directory = self.run_backup()
        finally:
            stop.set()
            thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        with contextlib.closing(sqlite3.connect(directory / "database.sqlite")) as restored:
            self.assertEqual(restored.execute("SELECT sum(balance) FROM accounts").fetchone()[0], 2000)
            self.assertLess(restored.execute("SELECT balance FROM accounts WHERE id=1").fetchone()[0], 1000)

    def test_source_readonly_connection_refuses_writes(self):
        with contextlib.closing(backup.readonly(self.source)) as db:
            with self.assertRaises(sqlite3.OperationalError):
                db.execute("DELETE FROM entities")
        self.assertEqual(self.db.execute("SELECT count(*) FROM entities").fetchone()[0], 1)

    def test_exclusive_lock_prevents_overlapping_manual_and_timer_backups(self):
        with backup.locked(self.destination):
            with self.assertRaisesRegex(backup.BackupError, "Another backup"):
                self.run_backup()
        self.assertFalse(list(self.destination.glob("arthello-v52-*")))
        self.run_backup()

    def test_corrupt_source_never_publishes_or_prunes_good_backup(self):
        good = self.run_backup()
        manifest_path = good / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["completedAt"] = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=20)).isoformat()
        manifest_path.write_text(json.dumps(manifest))
        self.db.close()
        self.source.write_bytes(b"corrupt database")
        with self.assertRaises(sqlite3.DatabaseError):
            self.run_backup()
        self.assertTrue(good.exists())
        self.assertFalse(list(self.destination.glob(".incomplete-*")))
        self.assertEqual(len(list(self.destination.glob("arthello-v52-*"))), 1)

    def test_retention_only_removes_completed_tool_backups_older_than_14_days(self):
        old = self.run_backup()
        recent = self.run_backup()
        now = dt.datetime.now(dt.timezone.utc)
        for directory, age in [(old, 15), (recent, 13)]:
            manifest_path = directory / "manifest.json"
            manifest = json.loads(manifest_path.read_text())
            manifest["completedAt"] = (now - dt.timedelta(days=age)).isoformat()
            manifest_path.write_text(json.dumps(manifest))
        unrelated = self.destination / "operator-important-file"
        unrelated.write_text("keep")
        incomplete = self.destination / ".incomplete-interrupted"
        incomplete.mkdir()
        latest = self.run_backup()
        self.assertFalse(old.exists())
        self.assertTrue(recent.exists())
        self.assertTrue(latest.exists())
        self.assertTrue(unrelated.exists())
        self.assertTrue(incomplete.exists())

    def test_restore_rejects_tampering(self):
        directory = self.run_backup()
        with contextlib.closing(sqlite3.connect(directory / "database.sqlite")) as db:
            db.execute("DELETE FROM entities")
            db.commit()
        with self.assertRaisesRegex(backup.BackupError, "checksum mismatch"):
            backup.verify_backup(directory)

    def test_symlinks_and_public_backup_directories_are_rejected(self):
        alias = self.root / "alias.sqlite"
        alias.symlink_to(self.source)
        with self.assertRaises(backup.BackupError):
            backup.run_backup(alias, self.destination)
        self.destination.chmod(0o755)
        with self.assertRaises(backup.BackupError):
            self.run_backup()

    def test_unrelated_sqlite_database_is_rejected(self):
        other = self.live / "other.sqlite"
        with contextlib.closing(sqlite3.connect(other)) as db:
            db.execute("CREATE TABLE x (id INTEGER)")
        with self.assertRaisesRegex(backup.BackupError, "not the expected"):
            backup.run_backup(other, self.destination)
        self.assertFalse(list(self.destination.glob("arthello-v52-*")))

    def test_operator_cli_runs_backup_then_restore_and_rejects_open_config_permissions(self):
        config = self.root / "config.json"
        config.write_text(json.dumps({"source": str(self.source), "backupDirectory": str(self.destination)}))
        config.chmod(0o600)
        command = [sys.executable, str(Path(__file__).with_name("backup.py"))]
        result = subprocess.run(command + ["--config", str(config)], capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        backup_id = json.loads(result.stdout)["backupId"]
        restored = subprocess.run(command + ["--verify", str(self.destination / backup_id)],
                                  capture_output=True, text=True, timeout=5)
        self.assertEqual(restored.returncode, 0, restored.stderr)
        self.assertTrue(json.loads(restored.stdout)["restoreVerified"])
        config.chmod(0o644)
        denied = subprocess.run(command + ["--config", str(config)], capture_output=True, text=True, timeout=5)
        self.assertEqual(denied.returncode, 1)
        self.assertEqual(json.loads(denied.stderr)["status"], "failed")
        self.assertNotIn("fixture-owner", denied.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
