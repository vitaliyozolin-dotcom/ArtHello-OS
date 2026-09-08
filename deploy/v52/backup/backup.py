#!/usr/bin/env python3
"""Host-side ArtHello v52 SQLite online backup. Never writes to the source DB."""

import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import stat
import sys
import tempfile
import time
import uuid

FORMAT = "arthello-v52-sqlite-backup-v1"
REQUIRED_TABLES = {"app_users", "entities", "system_runtime_state"}
RETENTION_DAYS = 14
NAME = re.compile(r"arthello-v52-\d{8}T\d{6}Z-[a-f0-9]{12}\Z")


class BackupError(Exception):
    pass


def safe_path(value, *, directory=False, private=False):
    path = Path(value)
    if not path.is_absolute() or path != path.resolve(strict=True):
        raise BackupError("Path must be absolute, canonical and contain no symlinks")
    info = path.stat()
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        raise BackupError("Expected a regular file/directory")
    if private and (info.st_uid != os.geteuid() or info.st_mode & 0o077):
        raise BackupError("Backup directory must belong to the operator and have mode 0700")
    return path


def fsync(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def readonly(path):
    # immutable=1 is intentionally forbidden: it ignores a live WAL.
    db = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=5)
    db.execute("PRAGMA query_only=ON")
    db.execute("PRAGMA trusted_schema=OFF")
    return db


def online_copy(source, destination, deadline):
    if destination.exists():
        raise BackupError("Destination must not exist")

    def progress(_status, _remaining, _total):
        if time.monotonic() >= deadline:
            raise BackupError("Backup exceeded its deadline")

    with contextlib.closing(readonly(source)) as src:
        with contextlib.closing(sqlite3.connect(destination)) as dst:
            src.backup(dst, pages=256, progress=progress, sleep=0.1)
            # Publish a standalone DB: readers must never need a detached WAL.
            if dst.execute("PRAGMA journal_mode=DELETE").fetchone()[0] != "delete":
                raise BackupError("Cannot create a standalone backup")
    os.chmod(destination, 0o600)
    fsync(destination)


def inventory(path):
    with contextlib.closing(readonly(path)) as db:
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise BackupError("SQLite integrity check failed")
        tables = [row[0] for row in db.execute(
            "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name"
        )]
        if not REQUIRED_TABLES.issubset(tables):
            raise BackupError("Source is not the expected ArtHello application database")
        counts = {}
        for table in tables:
            quoted = '"' + table.replace('"', '""') + '"'
            counts[table] = db.execute("SELECT count(*) FROM " + quoted).fetchone()[0]
        # Logical digest includes schema, indexes, triggers, sequences and data.
        # iterdump is used only for hashing, never executed as a restore script.
        logical = hashlib.sha256()
        for line in db.iterdump():
            logical.update(line.encode("utf-8"))
            logical.update(b"\n")
        return {"rows": counts, "logicalSha256": logical.hexdigest()}


def file_digest(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, sort_keys=True, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())


@contextlib.contextmanager
def locked(root):
    fd = os.open(root / ".backup.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise BackupError("Unsafe backup lock")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise BackupError("Another backup or restore verification is running") from exc
        yield
    finally:
        os.close(fd)


def prune(root, now, keep):
    cutoff = now - dt.timedelta(days=RETENTION_DAYS)
    removed = 0
    for item in root.iterdir():
        if item == keep or not NAME.fullmatch(item.name) or item.is_symlink() or not item.is_dir():
            continue
        if {p.name for p in item.iterdir()} != {"database.sqlite", "manifest.json"}:
            continue
        # Delete only complete backups in this tool's format, never arbitrary files.
        try:
            safe_path(item, directory=True, private=True)
            safe_path(item / "database.sqlite")
            safe_path(item / "manifest.json")
            manifest = json.loads((item / "manifest.json").read_text())
            completed = dt.datetime.fromisoformat(manifest["completedAt"])
            if manifest["format"] != FORMAT or manifest["backupId"] != item.name:
                continue
            if completed.tzinfo is None or completed >= cutoff:
                continue
        except (OSError, KeyError, ValueError, BackupError):
            continue
        (item / "database.sqlite").unlink()
        (item / "manifest.json").unlink()
        item.rmdir()
        removed += 1
    fsync(root)
    return removed


def run_backup(source, root, *, timeout=900):
    source = safe_path(source)
    root = safe_path(root, directory=True, private=True)
    if source.is_relative_to(root) or root.is_relative_to(source.parent):
        raise BackupError("Backup storage must be separate from the source database directory")
    with locked(root):
        started = dt.datetime.now(dt.timezone.utc)
        started_clock = time.monotonic()
        deadline = started_clock + timeout
        backup_id = "arthello-v52-" + started.strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:12]
        stage = Path(tempfile.mkdtemp(prefix=".incomplete-", dir=root))
        try:
            database = stage / "database.sqlite"
            online_copy(source, database, deadline)
            snapshot = inventory(database)
            drill_started = time.monotonic()
            restored = stage / "restore-verification.sqlite"
            online_copy(database, restored, deadline)
            if inventory(restored) != snapshot:
                raise BackupError("Restore verification does not match the backup")
            restored.unlink()
            completed = dt.datetime.now(dt.timezone.utc)
            manifest = {
                "format": FORMAT,
                "backupId": backup_id,
                "startedAt": started.isoformat(),
                "completedAt": completed.isoformat(),
                "sqliteVersion": sqlite3.sqlite_version,
                "sha256": file_digest(database),
                "bytes": database.stat().st_size,
                "inventory": snapshot,
                "integrityCheck": "ok",
                "restoreVerified": True,
                "restoreDurationSeconds": round(time.monotonic() - drill_started, 3),
                "durationSeconds": round(time.monotonic() - started_clock, 3),
                "retentionDays": RETENTION_DAYS,
            }
            write_json(stage / "manifest.json", manifest)
            fsync(stage)
            target = root / backup_id
            os.rename(stage, target)
            fsync(root)
            removed = prune(root, completed, target)
            return {"status": "verified", "backupId": backup_id,
                    "bytes": manifest["bytes"], "removedExpired": removed}
        finally:
            if stage.exists():
                shutil.rmtree(stage)


def verify_backup(directory, *, timeout=900):
    directory = safe_path(directory, directory=True, private=True)
    root = safe_path(directory.parent, directory=True, private=True)
    if not NAME.fullmatch(directory.name):
        raise BackupError("Invalid backup ID")
    with locked(root):
        manifest_path = safe_path(directory / "manifest.json")
        database = safe_path(directory / "database.sqlite")
        manifest = json.loads(manifest_path.read_text())
        if manifest["format"] != FORMAT or manifest["backupId"] != directory.name:
            raise BackupError("Invalid backup manifest")
        if file_digest(database) != manifest["sha256"]:
            raise BackupError("Backup checksum mismatch")
        with tempfile.TemporaryDirectory(prefix=".restore-drill-", dir=root) as temporary:
            destination = Path(temporary) / "restored.sqlite"
            online_copy(database, destination, time.monotonic() + timeout)
            if inventory(destination) != manifest["inventory"]:
                raise BackupError("Restored database does not match the manifest")
        return {"status": "verified", "backupId": directory.name, "restoreVerified": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="/etc/arthello-v52-backup.json")
    parser.add_argument("--verify", metavar="BACKUP_DIRECTORY")
    args = parser.parse_args()
    os.umask(0o077)

    def expired(_signum, _frame):
        raise BackupError("Backup/verification exceeded 900 seconds")

    signal.signal(signal.SIGALRM, expired)
    signal.alarm(900)
    try:
        if args.verify:
            result = verify_backup(args.verify)
        else:
            config_path = safe_path(args.config)
            config_info = config_path.stat()
            if config_info.st_uid != os.geteuid() or config_info.st_mode & 0o077:
                raise BackupError("Config must belong to the operator and have mode 0600")
            config = json.loads(config_path.read_text())
            if set(config) != {"source", "backupDirectory"}:
                raise BackupError("Unexpected backup configuration")
            result = run_backup(config["source"], config["backupDirectory"])
        print(json.dumps(result, sort_keys=True))
    except (BackupError, OSError, sqlite3.Error, ValueError, KeyError) as exc:
        # Do not include DB contents, credentials, row values or SQL in logs.
        error = {"status": "failed", "errorType": type(exc).__name__}
        if isinstance(exc, BackupError):
            error["reason"] = str(exc)
        print(json.dumps(error), file=sys.stderr)
        return 1
    finally:
        signal.alarm(0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
