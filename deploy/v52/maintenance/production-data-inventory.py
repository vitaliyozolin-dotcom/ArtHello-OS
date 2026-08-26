#!/usr/bin/env python3
"""Read-only inventory of the ArtHello production D1 snapshot.

The script intentionally prints no contacts, password material, session tokens,
or CSRF values. It exits unless exactly one ArtHello application database is
found beneath the supplied snapshot root.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import unicodedata
from pathlib import Path


TARGET_NAMES = (
    "Виталий Озолин",
    "Наталья Гутаковская",
    "Наталья Дмитриева",
)


def normalized(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    return " ".join(text.replace("ё", "е").split())


def sqlite_files(root: Path) -> list[Path]:
    candidates: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file() or path.name.endswith(("-wal", "-shm")):
            continue
        try:
            if path.read_bytes()[:16] == b"SQLite format 3\x00":
                candidates.append(path)
        except OSError:
            continue
    return candidates


def open_read_only(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def table_names(connection: sqlite3.Connection) -> list[str]:
    rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return [str(row["name"]) for row in rows]


def find_application_database(root: Path) -> tuple[Path, sqlite3.Connection, list[str]]:
    matches: list[tuple[Path, sqlite3.Connection, list[str]]] = []
    for path in sqlite_files(root):
        try:
            connection = open_read_only(path)
            tables = table_names(connection)
            if {"app_users", "system_runtime_state"}.issubset(tables):
                matches.append((path, connection, tables))
            else:
                connection.close()
        except sqlite3.DatabaseError:
            continue
    if len(matches) != 1:
        for _, connection, _ in matches:
            connection.close()
        raise SystemExit(f"Expected exactly one ArtHello D1 database, found {len(matches)}")
    return matches[0]


def selected_rows(connection: sqlite3.Connection, query: str) -> list[dict[str, object]]:
    return [dict(row) for row in connection.execute(query).fetchall()]


def existing_table(connection: sqlite3.Connection, table: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    return row is not None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot_root", type=Path)
    args = parser.parse_args()

    root = args.snapshot_root.resolve()
    path, connection, tables = find_application_database(root)
    try:
        integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
        if integrity.lower() != "ok":
            raise SystemExit(f"SQLite integrity check failed: {integrity}")

        counts = {
            table: int(connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
            for table in tables
        }
        users = selected_rows(
            connection,
            """SELECT id,display_name,role,status,invitation_status,access_version
               FROM app_users ORDER BY display_name,id""",
        )
        employees = selected_rows(
            connection,
            """SELECT h.id,COALESCE(e.display_name,'') AS display_name,
                      h.position_id,h.unit,h.status,h.access_status
               FROM hr_employees h
               LEFT JOIN entities e ON e.id=h.id
               ORDER BY display_name,h.id""",
        )
        employee_entities = selected_rows(
            connection,
            """SELECT id,display_name,status,source_system,data_quality
               FROM entities WHERE entity_type='Сотрудник'
               ORDER BY display_name,id""",
        )
        credentials: list[dict[str, object]] = []
        if existing_table(connection, "production_auth_credentials"):
            credentials = selected_rows(
                connection,
                """SELECT user_id,display_name,role,must_change_password,
                          temporary_password_expires_at,failed_attempts,locked_until
                   FROM production_auth_credentials ORDER BY display_name,user_id""",
            )

        target_counts = {
            target: sum(normalized(row["display_name"]) == normalized(target) for row in users)
            for target in TARGET_NAMES
        }
        unexpected_users = [
            {"id": row["id"], "display_name": row["display_name"], "role": row["role"], "status": row["status"]}
            for row in users
            if normalized(row["display_name"]) not in {normalized(name) for name in TARGET_NAMES}
        ]

        report = {
            "database": str(path.relative_to(root)),
            "integrity": integrity,
            "table_count": len(tables),
            "total_rows": sum(counts.values()),
            "target_match_counts_in_app_users": target_counts,
            "app_users": users,
            "hr_employees": employees,
            "employee_entities": employee_entities,
            "production_auth_credentials": credentials,
            "unexpected_app_users": unexpected_users,
            "nonempty_table_counts": {name: count for name, count in counts.items() if count},
        }
        print("ARTHELLO_PRODUCTION_INVENTORY_BEGIN")
        print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
        print("ARTHELLO_PRODUCTION_INVENTORY_END")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
