#!/usr/bin/env python3
"""Fail-closed, aggregate-only validation of an ArtHello D1 snapshot.

The command deliberately emits no row values, names, identifiers, contacts,
credential envelopes, or authentication metadata.  Its stdout is safe for a
deployment log.  A boolean telling the workflow whether encrypted integration
credentials exist can additionally be written to ``GITHUB_OUTPUT``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
from pathlib import Path


REQUIRED_TABLES = frozenset({"app_users", "system_runtime_state"})
# v2 is the release's db/index.ts constant. v1 is retained for safe continuity
# with an older envelope. Anything else in this namespace fails closed.
SUPPORTED_CREDENTIAL_PREFIXES = (
    "integration_credential:v1:",
    "integration_credential:v2:",
)
CREDENTIAL_NAMESPACE_PREFIX = "integration_credential:v"


def sqlite_files(root: Path) -> list[Path]:
    candidates: list[Path] = []
    for path in root.rglob("*"):
        if path.is_symlink():
            raise SystemExit("Snapshot contains an unsupported symbolic link")
        if not path.is_file() or path.name.endswith(("-wal", "-shm")):
            continue
        try:
            with path.open("rb") as handle:
                if handle.read(16) == b"SQLite format 3\x00":
                    candidates.append(path)
        except OSError:
            continue
    return candidates


def open_read_only(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def table_names(connection: sqlite3.Connection) -> set[str]:
    rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    return {str(row["name"]) for row in rows}


def locate_database(root: Path) -> tuple[Path, sqlite3.Connection, set[str]]:
    matches: list[tuple[Path, sqlite3.Connection, set[str]]] = []
    for path in sqlite_files(root):
        connection: sqlite3.Connection | None = None
        try:
            connection = open_read_only(path)
            tables = table_names(connection)
            if REQUIRED_TABLES.issubset(tables):
                matches.append((path, connection, tables))
            else:
                connection.close()
        except sqlite3.DatabaseError:
            if connection is not None:
                connection.close()
            continue

    if len(matches) != 1:
        for _, connection, _ in matches:
            connection.close()
        raise SystemExit(
            f"Expected exactly one ArtHello application database; found {len(matches)}"
        )
    return matches[0]


def scalar(connection: sqlite3.Connection, query: str, parameters: tuple[object, ...] = ()) -> object:
    row = connection.execute(query, parameters).fetchone()
    if row is None:
        raise SystemExit("Required database validation query returned no result")
    return row[0]


def credential_inventory(connection: sqlite3.Connection) -> tuple[int, str]:
    rows = connection.execute(
        """
        SELECT state_key, state_value
        FROM system_runtime_state
        WHERE substr(state_key, 1, length(?)) = ?
        ORDER BY state_key
        """,
        (CREDENTIAL_NAMESPACE_PREFIX, CREDENTIAL_NAMESPACE_PREFIX),
    ).fetchall()
    digest = hashlib.sha256()
    for row in rows:
        state_key = str(row["state_key"])
        if not state_key.startswith(SUPPORTED_CREDENTIAL_PREFIXES):
            raise SystemExit("Unsupported encrypted credential envelope version")
        for column in (row["state_key"], row["state_value"]):
            if isinstance(column, bytes):
                encoded = column
            else:
                encoded = str(column).encode("utf-8")
            digest.update(len(encoded).to_bytes(8, "big"))
            digest.update(encoded)
    return len(rows), digest.hexdigest()


def append_github_output(
    path: Path,
    encrypted_credentials_present: bool,
    encrypted_credentials_count: int,
    encrypted_credentials_digest: str,
) -> None:
    if path.is_symlink():
        raise SystemExit("Refusing to write deployment output through a symlink")
    resolved = path.resolve()
    with resolved.open("a", encoding="utf-8") as output:
        output.write(
            "encrypted_credentials_present="
            f"{'true' if encrypted_credentials_present else 'false'}\n"
        )
        output.write(f"encrypted_credentials_count={encrypted_credentials_count}\n")
        output.write(f"encrypted_credentials_digest={encrypted_credentials_digest}\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot_root", type=Path)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()

    root = args.snapshot_root.resolve(strict=True)
    if not root.is_dir():
        raise SystemExit("Snapshot root is not a directory")

    _, connection, tables = locate_database(root)
    try:
        integrity = str(scalar(connection, "PRAGMA integrity_check"))
        if integrity.lower() != "ok":
            raise SystemExit("SQLite integrity_check failed")

        foreign_key_violations = int(
            scalar(connection, "SELECT COUNT(*) FROM pragma_foreign_key_check")
        )
        if foreign_key_violations != 0:
            raise SystemExit("SQLite foreign_key_check failed")

        encrypted_credentials, encrypted_credentials_digest = credential_inventory(connection)
        encrypted_credentials_present = encrypted_credentials > 0

        schema_marker_present = int(
            scalar(
                connection,
                "SELECT COUNT(*) FROM system_runtime_state WHERE state_key='core_schema'",
            )
        ) == 1

        report = {
            "applicationDatabases": 1,
            "encryptedCredentialsPresent": encrypted_credentials_present,
            "foreignKeyViolations": 0,
            "integrity": "ok",
            "requiredTablesPresent": True,
            "schemaMarkerPresent": schema_marker_present,
            "tableCount": len(tables),
        }
        print("ARTHELLO_PRODUCTION_INVENTORY=" + json.dumps(report, sort_keys=True))

        if args.github_output is not None:
            append_github_output(
                args.github_output,
                encrypted_credentials_present,
                encrypted_credentials,
                encrypted_credentials_digest,
            )
    finally:
        connection.close()


if __name__ == "__main__":
    os.umask(0o077)
    main()
