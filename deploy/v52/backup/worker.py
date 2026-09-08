#!/usr/bin/env python3
"""Unprivileged, fixed-operation backup worker; never writes to the source mount."""
import contextlib
import datetime as dt
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
import uuid

sys.dont_write_bytecode = True

def sibling(name):
    spec = importlib.util.spec_from_file_location("arthello_" + name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


backup = sibling("backup")
bridge = sibling("bridge")
DATA = Path("/data")
ROOT = Path("/var/backups/arthello-v52")
CONTROL = Path("/var/lib/arthello-v52-backup-control")
ACTIVATION = "/var/lib/arthello-v52-tochka-activation"
SOCKET = CONTROL / "control.sock"
STATE = ".worker-state.json"
CONFIG = ".worker-config.json"
UTC = dt.timezone.utc
RETRY_SECONDS = 300
STATE_KEYS = {"schemaVersion", "sourceRelative", "state", "initialBackupId", "initialVerifiedAt", "lastVerifiedBackupId", "lastDueSlot", "lastScheduledAt", "lastAttemptAt", "nextRetryAt", "lastFailure", "activeAttempt"}


class Refused(Exception):
    """Only fixed safe reason codes may leave this process."""


def stamp(value):
    if not isinstance(value, str) or len(value) > 40:
        raise Refused("invalid_timestamp")
    try:
        parsed = dt.datetime.fromisoformat(value)
    except ValueError as exc:
        raise Refused("invalid_timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != dt.timedelta(0):
        raise Refused("invalid_timestamp")
    return parsed.astimezone(UTC)


def due_slot(now):
    target = now.astimezone(UTC).replace(hour=0, minute=15, second=0, microsecond=0)
    return target if now >= target else target - dt.timedelta(days=1)


def regular(path, uid, gid, mode, maximum):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != uid or info.st_gid != gid or stat.S_IMODE(info.st_mode) != mode or info.st_size > maximum:
        raise Refused("unsafe_worker_file")
    return info


def read_private(path):
    regular(path, os.geteuid(), os.getegid(), 0o600, 16384)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "r") as stream:
        return json.load(stream)


def atomic_json(path, value):
    if os.path.lexists(path):
        regular(path, os.geteuid(), os.getegid(), 0o600, 16384)
    fd, temporary = tempfile.mkstemp(prefix=".worker-stage-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(value, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        backup.fsync(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def mount_flags(text):
    result = {}
    for line in text.splitlines():
        fields = line.split(" - ", 1)[0].split()
        if len(fields) < 6:
            raise Refused("invalid_mount_inventory")
        target = re.sub(r"\\([0-7]{3})", lambda match: chr(int(match.group(1), 8)), fields[4])
        if target in result:
            raise Refused("ambiguous_mount_inventory")
        result[target] = set(fields[5].split(","))
    return result


def validate_layout(relative, *, data=DATA, root=ROOT, control=CONTROL, mounts=None, required_uid=1000, required_gid=1000):
    if os.geteuid() != required_uid or os.getegid() != required_gid:
        raise Refused("worker_uid_gid_mismatch")
    if not isinstance(relative, str) or not re.fullmatch(r"d1/[A-Za-z0-9_./-]{1,500}\.sqlite", relative) or any(part in ("", ".", "..") for part in relative.split("/")):
        raise Refused("invalid_source_relative_path")
    source = backup.safe_path(data / relative)
    source_info = source.stat()
    if not source.is_relative_to(data) or source_info.st_uid != required_uid:
        raise Refused("source_owner_mismatch")
    if source_info.st_mode & 0o002:
        raise Refused("source_world_writable")
    flags = mount_flags(Path("/proc/self/mountinfo").read_text()) if mounts is None else mounts
    if "ro" not in flags.get(str(data), set()) or "ro" not in flags.get("/", set()):
        raise Refused("source_or_root_not_readonly")
    if ACTIVATION in flags:
        raise Refused("activation_mount_forbidden")
    for path, mode, seed in ((root, 0o700, "ARTHELLO_BACKUP_STORAGE_V1\n"), (control, 0o750, "ARTHELLO_BACKUP_CONTROL_V1\n")):
        if path != path.resolve(strict=True):
            raise Refused("unsafe_worker_directory")
        info = path.stat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != required_uid or info.st_gid != required_gid or stat.S_IMODE(info.st_mode) != mode or "rw" not in flags.get(str(path), set()):
            raise Refused("worker_volume_ownership_or_mount")
        regular(path / ".layout", required_uid, required_gid, 0o444, 128)
        if (path / ".layout").read_text() != seed:
            raise Refused("worker_volume_seed_mismatch")
    for suffix in ("-wal", "-shm"):
        path = Path(str(source) + suffix)
        if os.path.lexists(path):
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != required_uid or info.st_nlink != 1 or info.st_mode & 0o002:
                raise Refused("unsafe_source_companion")
    return source


@contextlib.contextmanager
def singleton(root):
    path = root / ".worker.lock"
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.geteuid() or info.st_gid != os.getegid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise Refused("unsafe_worker_lock")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise Refused("worker_already_running") from exc
        yield
    finally:
        os.close(fd)


def run_cli(config):
    result = subprocess.run([sys.executable, "-I", str(Path(__file__).with_name("backup.py")), "--config", str(config)], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=910, check=False, env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"})
    if result.returncode != 0 or len(result.stdout) > 4096 or len(result.stderr) > 4096:
        raise Refused("backup_process_failed")
    value = json.loads(result.stdout)
    if not isinstance(value, dict) or value.get("status") != "verified" or not backup.NAME.fullmatch(value.get("backupId", "")):
        raise Refused("backup_result_invalid")
    return value["backupId"]


class Control:
    def __init__(self, source, relative, *, root=ROOT, clock=lambda: dt.datetime.now(UTC), monotonic=time.monotonic, runner=run_cli):
        self.source, self.relative, self.root = source, relative, root
        self.clock, self.monotonic, self.runner = clock, monotonic, runner
        self.lock = threading.RLock()
        self.active = False
        self.thread = None
        self.stopped = False
        self.fatal = False
        self.cooldown_until = 0
        self.state_path = root / STATE
        self.config_path = root / CONFIG
        self.state = self.load()
        atomic_json(self.config_path, {"source": str(source), "backupDirectory": str(root)})
        if self.state["state"] == "running":
            self.state.update(state="failed", activeAttempt=None, lastFailure="interrupted", nextRetryAt=self.clock().isoformat())
            self.save()
        if self.state["lastVerifiedBackupId"] and not self.manifest_valid(self.state["lastVerifiedBackupId"]):
            self.state.update(initialVerifiedAt=None, lastVerifiedBackupId=None, state="failed", lastFailure="saved_copy_unavailable", nextRetryAt=self.clock().isoformat())
            self.save()

    def load(self):
        if not os.path.lexists(self.state_path):
            value = {key: None for key in STATE_KEYS}
            value.update(schemaVersion=1, sourceRelative=self.relative, state="idle")
            return value
        value = read_private(self.state_path)
        if not isinstance(value, dict) or set(value) != STATE_KEYS or value["schemaVersion"] != 1 or value["sourceRelative"] != self.relative or value["state"] not in ("idle", "running", "failed"):
            raise Refused("worker_state_invalid")
        for key in ("initialVerifiedAt", "lastDueSlot", "lastScheduledAt", "lastAttemptAt", "nextRetryAt"):
            if value[key] is not None:
                stamp(value[key])
        for key in ("initialBackupId", "lastVerifiedBackupId"):
            if value[key] is not None and (not isinstance(value[key], str) or not backup.NAME.fullmatch(value[key])):
                raise Refused("worker_state_invalid")
        if value["initialVerifiedAt"] and not all(value[key] for key in ("initialBackupId", "lastVerifiedBackupId", "lastDueSlot")):
            raise Refused("worker_state_invalid")
        if value["lastDueSlot"] and stamp(value["lastDueSlot"]) != due_slot(stamp(value["lastDueSlot"])):
            raise Refused("worker_state_invalid")
        if value["lastFailure"] not in (None, "interrupted", "saved_copy_unavailable", "backup_failed"):
            raise Refused("worker_state_invalid")
        if value["state"] == "running":
            attempt = value["activeAttempt"]
            if not isinstance(attempt, dict) or set(attempt) != {"id", "trigger", "startedAt", "dueSlot"} or not re.fullmatch(r"[a-f0-9]{32}", attempt.get("id", "")) or attempt.get("trigger") not in ("initial", "manual", "scheduled"):
                raise Refused("worker_state_invalid")
            stamp(attempt["startedAt"])
            stamp(attempt["dueSlot"])
        elif value["activeAttempt"] is not None:
            raise Refused("worker_state_invalid")
        return value

    def save(self):
        atomic_json(self.state_path, self.state)

    def manifest_valid(self, identifier, *, verify_checksum=False):
        if not identifier or not backup.NAME.fullmatch(identifier):
            return False
        try:
            directory = backup.safe_path(self.root / identifier, directory=True, private=True)
            for name in ("database.sqlite", "manifest.json"):
                regular(directory / name, os.geteuid(), os.getegid(), 0o600, 1_000_000 if name == "manifest.json" else 2**63)
            record = json.loads((directory / "manifest.json").read_text())
            if not isinstance(record, dict) or record.get("format") != backup.FORMAT or record.get("backupId") != identifier or record.get("restoreVerified") is not True or record.get("integrityCheck") != "ok" or type(record.get("bytes")) is not int or record["bytes"] != (directory / "database.sqlite").stat().st_size or not re.fullmatch(r"[a-f0-9]{64}", record.get("sha256", "")):
                return False
            stamp(record["completedAt"])
            return not verify_checksum or backup.file_digest(directory / "database.sqlite") == record["sha256"]
        except (OSError, ValueError, KeyError, TypeError, Refused, backup.BackupError):
            return False

    def status(self):
        with self.lock:
            if self.fatal or self.stopped:
                raise Refused("worker_unavailable")
            records, skipped = bridge.history(self.root)
            verified = self.state["initialVerifiedAt"] is not None and self.manifest_valid(self.state["lastVerifiedBackupId"])
            now = self.clock()
            last_slot = stamp(self.state["lastDueSlot"]) if self.state["lastDueSlot"] else None
            next_at = (last_slot + dt.timedelta(days=1)) if last_slot else due_slot(now)
            if self.state["nextRetryAt"] and next_at <= now:
                next_at = max(next_at, stamp(self.state["nextRetryAt"]))
            return {"state": self.state["state"], "lastAttemptAt": self.state["lastAttemptAt"], "schedule": {"enabled": verified, "nextAt": next_at.isoformat() if verified else None, "lastTriggeredAt": self.state["lastScheduledAt"]}, "retentionDays": 14, "history": records, "unreadableCopies": skipped, "scope": "arthello_database", "storage": "same_server", "initialVerified": verified, "initialBackupId": self.state["initialBackupId"], "lastVerifiedBackupId": self.state["lastVerifiedBackupId"]}

    def admit(self, trigger):
        # Caller holds lock. Durable running state precedes process creation.
        now = self.clock()
        attempt = {"id": uuid.uuid4().hex, "trigger": trigger, "startedAt": now.isoformat(), "dueSlot": due_slot(now).isoformat()}
        self.state.update(state="running", activeAttempt=attempt, lastAttemptAt=now.isoformat(), lastFailure=None, nextRetryAt=None)
        if trigger == "scheduled":
            self.state["lastScheduledAt"] = now.isoformat()
        try:
            self.save()
        except Exception as exc:
            self.fatal = True
            raise Refused("worker_state_persistence_failed") from exc
        self.active = True
        self.cooldown_until = self.monotonic() + 5
        self.thread = threading.Thread(target=self.execute, args=(attempt,), daemon=True)
        try:
            self.thread.start()
        except Exception as exc:
            self.fatal = True
            self.active = False
            raise Refused("backup_start_failed") from exc

    def create(self):
        with self.lock:
            if self.fatal or self.stopped:
                raise Refused("worker_unavailable")
            if self.active or self.monotonic() < self.cooldown_until:
                return 409, {"error": "Резервная копия уже создаётся", "state": "running"}
            self.admit("manual" if self.state["initialVerifiedAt"] else "initial")
            return 202, {"state": "running", "message": "Создание копии запущено"}

    def execute(self, attempt):
        identifier = None
        try:
            before = {record["id"] for record in bridge.history(self.root)[0]}
            identifier = self.runner(self.config_path)
            if identifier in before or not self.manifest_valid(identifier, verify_checksum=True):
                raise Refused("backup_manifest_not_verified")
        except Exception:
            identifier = None
        with self.lock:
            now = self.clock()
            self.state.update(state="idle" if identifier else "failed", activeAttempt=None, lastAttemptAt=now.isoformat(), lastFailure=None if identifier else "backup_failed", nextRetryAt=None if identifier else (now + dt.timedelta(seconds=RETRY_SECONDS)).isoformat())
            if identifier:
                self.state["lastVerifiedBackupId"] = identifier
                if not self.state["initialVerifiedAt"]:
                    self.state["initialVerifiedAt"] = now.isoformat()
                    self.state["initialBackupId"] = identifier
                previous = stamp(self.state["lastDueSlot"]) if self.state["lastDueSlot"] else stamp(attempt["dueSlot"])
                self.state["lastDueSlot"] = max(previous, stamp(attempt["dueSlot"])).isoformat()
            try:
                self.save()
            except Exception:
                self.fatal = True
            self.active = False
            print("ARTHELLO_BACKUP_ATTEMPT=" + ("VERIFIED" if identifier and not self.fatal else "FAILED"), flush=True)

    def tick(self):
        with self.lock:
            if self.stopped or self.fatal or self.active:
                return
            now = self.clock()
            if self.state["nextRetryAt"] and now < stamp(self.state["nextRetryAt"]):
                return
            if not self.state["initialVerifiedAt"]:
                self.admit("initial")
            elif self.state["lastDueSlot"] is None or stamp(self.state["lastDueSlot"]) < due_slot(now):
                self.admit("scheduled")


def main():
    os.umask(0o077)
    relative = os.environ.get("ARTHELLO_BACKUP_SOURCE_RELATIVE", "")
    source = validate_layout(relative)
    stop = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stop.set())
    with singleton(ROOT):
        control = Control(source, relative)
        if os.path.lexists(SOCKET):
            info = SOCKET.lstat()
            if not stat.S_ISSOCK(info.st_mode) or info.st_uid != 1000 or info.st_gid != 1000:
                raise Refused("unsafe_control_socket")
            SOCKET.unlink()
        with bridge.Server(str(SOCKET), bridge.Handler) as server:
            SOCKET.chmod(0o660)
            server.control = control
            server.timeout = 0.5
            print("ARTHELLO_BACKUP_WORKER=READY", flush=True)
            while not stop.is_set() and not control.fatal:
                control.tick()
                server.handle_request()
            control.stopped = True
        # Finish a short in-flight backup; if PID 1 exits before completion,
        # Docker terminates its children; restart records the interrupted attempt.
        if control.thread:
            control.thread.join(timeout=2)
        SOCKET.unlink(missing_ok=True)
        if control.fatal:
            raise Refused("worker_state_persistence_failed")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        reason = str(exc) if isinstance(exc, Refused) else "worker_start_or_runtime_failed"
        print(json.dumps({"state": "failed", "reason": reason}), file=sys.stderr)
        sys.exit(1)
