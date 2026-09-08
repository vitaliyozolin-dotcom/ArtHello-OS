#!/usr/bin/env python3
"""Fixed-command Unix HTTP bridge for the existing verified backup service."""
import datetime as dt
import http.server
import json
import os
from pathlib import Path
import re
import socketserver
import stat
import subprocess
import threading
import time

ROOT = Path("/var/backups/arthello-v52")
SOCKET = "/var/lib/arthello-v52-backup-control/control.sock"
SERVICE = "arthello-v52-backup.service"
TIMER = "arthello-v52-backup.timer"
NAME = re.compile(r"arthello-v52-\d{8}T\d{6}Z-[a-f0-9]{12}\Z")
ACTIVE = {"active", "activating", "reloading", "deactivating"}


def systemctl(*arguments):
    # Never shell=True; all command/unit arguments are constants owned by code.
    result = subprocess.run(["/usr/bin/systemctl", *arguments], capture_output=True,
                            text=True, timeout=4, check=True,
                            env={"PATH": "/usr/bin:/bin", "LC_ALL": "C", "TZ": "UTC"})
    if len(result.stdout) > 32768:
        raise ValueError("Oversized system state")
    return result.stdout


def show(unit, command):
    text = command("show", unit, "--property=LoadState,ActiveState,SubState,Result,ExecMainStatus,ExecMainExitTimestamp,UnitFileState,NextElapseUSecRealtime,LastTriggerUSec")
    value = dict(line.split("=", 1) for line in text.splitlines() if "=" in line)
    if value.get("LoadState") != "loaded":
        raise ValueError("Backup service is not installed")
    return value


def iso_timestamp(value):
    if not isinstance(value, str) or len(value) > 80:
        return None
    try:
        stamp = dt.datetime.fromisoformat(value)
        return stamp.isoformat() if stamp.tzinfo else None
    except ValueError:
        try:
            stamp = dt.datetime.strptime(value, "%a %Y-%m-%d %H:%M:%S %Z")
            return stamp.replace(tzinfo=dt.timezone.utc).isoformat() if value.endswith(" UTC") else None
        except ValueError:
            return None


def history(root):
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Backup storage is not installed")
    result = []
    skipped = 0
    for directory in sorted(root.iterdir(), reverse=True):
        if not NAME.fullmatch(directory.name):
            continue
        try:
            if directory.is_symlink() or not directory.is_dir():
                raise ValueError("Unsafe backup")
            manifest = directory / "manifest.json"
            database = directory / "database.sqlite"
            if manifest.is_symlink() or database.is_symlink():
                raise ValueError("Unsafe backup")
            if not stat.S_ISREG(manifest.stat().st_mode) or manifest.stat().st_size > 1_000_000:
                raise ValueError("Invalid manifest")
            value = json.loads(manifest.read_text())
            if not isinstance(value, dict):
                raise ValueError("Invalid manifest object")
            if (value.get("format") != "arthello-v52-sqlite-backup-v1" or value.get("backupId") != directory.name
                    or value.get("integrityCheck") != "ok" or value.get("restoreVerified") is not True
                    or type(value.get("bytes")) is not int or not stat.S_ISREG(database.stat().st_mode)
                    or database.stat().st_size != value["bytes"] or not iso_timestamp(value.get("completedAt"))
                    or not re.fullmatch(r"[a-f0-9]{64}", value.get("sha256", ""))):
                raise ValueError("Incomplete backup")
            # The manifest records the completed SQLite restore drill, not a
            # new checksum/restore verification performed by this status read.
            result.append({"id": directory.name, "completedAt": iso_timestamp(value["completedAt"]),
                           "bytes": value["bytes"], "status": "verified_at_creation"})
        except (OSError, ValueError, TypeError):
            skipped += 1
        if len(result) >= 50:
            break
    return result, skipped


class BackupControl:
    def __init__(self, root=ROOT, command=systemctl, clock=time.monotonic):
        self.root, self.command, self.clock = root, command, clock
        self.lock = threading.Lock()
        self.accepted_at = None

    def status(self):
        service = show(SERVICE, self.command)
        timer = show(TIMER, self.command)
        records, skipped = history(self.root)
        pending = self.accepted_at is not None and self.clock() - self.accepted_at < 5
        running = service.get("ActiveState") in ACTIVE or pending
        failed = service.get("Result") not in (None, "", "success") or service.get("ActiveState") == "failed"
        return {"state": "running" if running else "failed" if failed else "idle",
                "lastAttemptAt": iso_timestamp(service.get("ExecMainExitTimestamp")),
                "schedule": {"enabled": timer.get("ActiveState") == "active" and timer.get("UnitFileState") == "enabled",
                             "nextAt": iso_timestamp(timer.get("NextElapseUSecRealtime")),
                             "lastTriggeredAt": iso_timestamp(timer.get("LastTriggerUSec"))},
                "retentionDays": 14, "history": records, "unreadableCopies": skipped,
                "scope": "arthello_database", "storage": "same_server"}

    def create(self):
        with self.lock:
            service = show(SERVICE, self.command)
            pending = self.accepted_at is not None and self.clock() - self.accepted_at < 5
            if service.get("ActiveState") in ACTIVE or pending:
                return 409, {"error": "Резервная копия уже создаётся", "state": "running"}
            self.command("start", "--no-block", SERVICE)
            self.accepted_at = self.clock()
            return 202, {"state": "running", "message": "Создание копии запущено"}


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "ArtHelloBackup"
    sys_version = ""

    def log_message(self, *_args):
        pass

    def respond(self, status, payload):
        encoded = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(encoded)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def handle_command(self):
        if self.headers.get("Host") != "backup.internal" or self.headers.get("Transfer-Encoding") or self.headers.get("Content-Length", "0") != "0":
            return self.respond(403, {"error": "Действие не разрешено"})
        try:
            if self.command == "GET" and self.path == "/status":
                return self.respond(200, self.server.control.status())
            if self.command == "POST" and self.path == "/create":
                return self.respond(*self.server.control.create())
            return self.respond(403, {"error": "Действие не разрешено"})
        except Exception:
            # No command outputs, database content, paths or raw exceptions.
            return self.respond(503, {"error": "Сервис резервных копий временно недоступен"})

    do_GET = handle_command
    do_POST = handle_command


class Server(socketserver.UnixStreamServer):
    # Requests are tiny and serialized; a slow systemctl has a 4-second limit.
    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(5)
        return connection, address


def main():
    if os.path.lexists(SOCKET):
        if not stat.S_ISSOCK(os.lstat(SOCKET).st_mode):
            raise SystemExit("Unsafe socket path")
        os.unlink(SOCKET)
    os.umask(0o007)
    with Server(SOCKET, Handler) as server:
        os.chmod(SOCKET, 0o660)
        server.control = BackupControl()
        print("ARTHELLO_BACKUP_BRIDGE=READY", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
