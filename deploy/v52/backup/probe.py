#!/usr/bin/env python3
"""Read-only fixed Unix socket probe; no filesystem paths or data are returned."""
import argparse
import http.client
import json
import re
import socket
import sys

SOCKET = "/var/lib/arthello-v52-backup-control/control.sock"


class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(SOCKET)


def read_status():
    connection = UnixHTTP("backup.internal", timeout=8)
    try:
        connection.request("GET", "/status", headers={"Host": "backup.internal", "Content-Length": "0"})
        response = connection.getresponse()
        data = response.read(128001)
        if response.status != 200 or len(data) > 128000:
            raise ValueError("unavailable")
        value = json.loads(data)
        if not isinstance(value, dict) or value.get("state") not in ("idle", "running", "failed") or not isinstance(value.get("history"), list) or not isinstance(value.get("schedule"), dict) or value.get("scope") != "arthello_database" or value.get("storage") != "same_server":
            raise ValueError("invalid_status")
        return value
    finally:
        connection.close()


def verified(value):
    identifier = value.get("lastVerifiedBackupId", "")
    return (value.get("initialVerified") is True and value["schedule"].get("enabled") is True
            and value["state"] == "idle" and isinstance(identifier, str)
            and bool(re.fullmatch(r"arthello-v52-\d{8}T\d{6}Z-[a-f0-9]{12}", identifier))
            and any(item.get("id") == identifier and item.get("status") == "verified_at_creation" for item in value["history"] if isinstance(item, dict)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--require-initial-verified", action="store_true")
    modes.add_argument("--status", action="store_true")
    args = parser.parse_args()
    value = read_status()
    if args.require_initial_verified and not verified(value):
        raise ValueError("initial_verification_pending_or_failed")
    if args.status:
        print(json.dumps(value, sort_keys=True))
    else:
        print(json.dumps({"schemaVersion": 1, "state": "verified", "initialVerified": True, "initialBackupId": value.get("initialBackupId"), "lastVerifiedBackupId": value["lastVerifiedBackupId"], "nextAt": value["schedule"].get("nextAt"), "historyCount": len(value["history"])}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print('{"state":"unavailable_or_unverified"}', file=sys.stderr)
        sys.exit(1)
