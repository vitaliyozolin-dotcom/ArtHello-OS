#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("production-data-inventory.py")
SPEC = importlib.util.spec_from_file_location("production_data_inventory", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load production inventory module")
INVENTORY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INVENTORY)

EXPECTED_OBJECT_ID = "5a499c55f63d6b9f725547d510cf454e288954b6f3c2d5024eb1443f29c97730"


def create_app_database(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    try:
        connection.executescript(
            """
            PRAGMA foreign_keys = ON;
            CREATE TABLE app_users (id TEXT PRIMARY KEY);
            CREATE TABLE system_runtime_state (
              state_key TEXT PRIMARY KEY,
              state_value TEXT NOT NULL
            );
            INSERT INTO system_runtime_state(state_key, state_value)
            VALUES ('core_schema', 'fixture');
            """
        )
        connection.commit()
    finally:
        connection.close()


class ProductionDataInventoryTest(unittest.TestCase):
    def test_active_path_matches_miniflare_contract(self) -> None:
        self.assertEqual(
            INVENTORY.durable_object_id(
                INVENTORY.D1_DATABASE_OBJECT_UNIQUE_KEY,
                INVENTORY.ACTIVE_D1_DATABASE_ID,
            ),
            EXPECTED_OBJECT_ID,
        )
        self.assertEqual(
            INVENTORY.active_database_relative_path().as_posix(),
            f"d1/miniflare-D1DatabaseObject/{EXPECTED_OBJECT_ID}.sqlite",
        )

    def test_selects_exact_active_database_with_seven_decoys(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            active = root / INVENTORY.active_database_relative_path()
            create_app_database(active)
            for index in range(7):
                create_app_database(root / "historical" / f"copy-{index}.sqlite")

            path, connection, tables, matching = INVENTORY.locate_database(root)
            try:
                self.assertEqual(path, active)
                self.assertEqual(matching, 8)
                self.assertTrue(INVENTORY.REQUIRED_TABLES.issubset(tables))
            finally:
                connection.close()

            completed = subprocess.run(
                [sys.executable, str(SCRIPT), str(root)],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertIn('"activeApplicationDatabases": 1', completed.stdout)
            self.assertIn('"applicationDatabases": 8', completed.stdout)
            self.assertIn('"historicalMatchingDatabases": 7', completed.stdout)

    def test_missing_active_database_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_app_database(root / "historical" / "copy.sqlite")
            with self.assertRaisesRegex(
                SystemExit,
                "Expected active ArtHello application database was not found",
            ):
                INVENTORY.locate_database(root)

    def test_corrupt_active_database_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            active = root / INVENTORY.active_database_relative_path()
            active.parent.mkdir(parents=True, exist_ok=True)
            active.write_bytes(b"SQLite format 3\x00" + b"not-a-database")
            with self.assertRaisesRegex(
                SystemExit,
                "Expected active ArtHello application database was not found",
            ):
                INVENTORY.locate_database(root)

    def test_symlink_active_database_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.sqlite"
            create_app_database(source)
            active = root / INVENTORY.active_database_relative_path()
            active.parent.mkdir(parents=True, exist_ok=True)
            active.symlink_to(source)
            with self.assertRaisesRegex(SystemExit, "unsupported symbolic link"):
                INVENTORY.locate_database(root)


if __name__ == "__main__":
    unittest.main()
