from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
CHECKER = HERE.parent / "reconcile-tochka-snapshot.py"
SYNC_AT = "2026-09-05T13:20:00.000Z"

GENERIC_PROTECTED = (
    "production_auth_credentials",
    "app_users",
    "user_system_access",
    "entities",
    "finance_accruals",
    "finance_budgets",
    "finance_forecast_items",
    "finance_payroll_summary",
    "finance_corrections",
    "finance_reconciliation_issues",
    "client_accruals",
    "client_bonuses",
    "client_lifecycles",
    "accounting_documents",
    "accounting_document_links",
    "accounting_completeness_checks",
    "accounting_exports",
    "accounting_integrations",
    "system_runtime_state",
    "integration_log_entries",
    "audit_events",
)


def create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE integration_sync_runs (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT NOT NULL,
          status TEXT NOT NULL,
          received_count INTEGER NOT NULL,
          accepted_count INTEGER NOT NULL,
          rejected_count INTEGER NOT NULL,
          error_count INTEGER NOT NULL,
          conflict_count INTEGER NOT NULL,
          checkpoint TEXT NOT NULL,
          dry_run INTEGER NOT NULL
        );
        CREATE TABLE bank_accounts (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          legal_entity_id TEXT NOT NULL,
          provider_account_id TEXT NOT NULL,
          currency TEXT NOT NULL,
          balance_minor INTEGER,
          balance_as_of TEXT NOT NULL,
          synced_at TEXT NOT NULL
        );
        CREATE TABLE bank_statement_imports (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          legal_entity_id TEXT NOT NULL,
          provider_statement_id TEXT NOT NULL,
          provider_account_id TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          status TEXT NOT NULL,
          start_balance_minor INTEGER NOT NULL,
          end_balance_minor INTEGER NOT NULL,
          currency TEXT NOT NULL,
          transaction_count INTEGER NOT NULL,
          fetched_at TEXT NOT NULL
        );
        CREATE TABLE bank_transactions (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          legal_entity_id TEXT NOT NULL,
          provider_account_id TEXT NOT NULL,
          provider_statement_id TEXT NOT NULL,
          provider_transaction_id TEXT NOT NULL,
          operation_date TEXT NOT NULL,
          direction TEXT NOT NULL,
          amount_minor INTEGER NOT NULL,
          currency TEXT NOT NULL,
          status TEXT NOT NULL,
          financial_operation_id TEXT NOT NULL,
          imported_at TEXT NOT NULL
        );
        CREATE TABLE financial_operations (
          id TEXT PRIMARY KEY,
          operation_date TEXT NOT NULL,
          direction TEXT NOT NULL,
          amount_minor INTEGER NOT NULL,
          legal_entity_id TEXT NOT NULL,
          bank_operation_ref TEXT NOT NULL,
          operation_kind TEXT NOT NULL,
          source_system TEXT NOT NULL,
          cashflow_article TEXT,
          pnl_article TEXT,
          accrual_period TEXT,
          counterparty_label TEXT,
          management_purpose TEXT
        );
        CREATE TABLE integration_connections (
          id TEXT PRIMARY KEY,
          system TEXT NOT NULL,
          category TEXT NOT NULL,
          target_module TEXT NOT NULL,
          owner_entity_id TEXT NOT NULL,
          source_of_truth TEXT NOT NULL,
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          auth_status TEXT NOT NULL,
          credential_expires_at TEXT NOT NULL DEFAULT '',
          last_success_at TEXT NOT NULL DEFAULT '',
          next_sync_at TEXT NOT NULL DEFAULT '',
          received_count INTEGER NOT NULL DEFAULT 0,
          accepted_count INTEGER NOT NULL DEFAULT 0,
          rejected_count INTEGER NOT NULL DEFAULT 0,
          error_count INTEGER NOT NULL DEFAULT 0,
          conflict_count INTEGER NOT NULL DEFAULT 0,
          impact TEXT NOT NULL,
          adapter_version TEXT NOT NULL,
          verified_transfer INTEGER NOT NULL DEFAULT 0,
          is_enabled INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        """
    )
    for table in GENERIC_PROTECTED:
        connection.execute(f'CREATE TABLE "{table}" (id TEXT PRIMARY KEY, value TEXT)')


def seed_baseline(connection: sqlite3.Connection) -> None:
    connection.executemany(
        "INSERT INTO integration_connections VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            (
                "INT-T-D1",
                "ArtHello OS D1",
                "Внутренняя платформа",
                "Все модули",
                "ROLE:OWNER",
                "ArtHello OS D1",
                "Binding · read/write",
                "Работает",
                "Сервисная привязка активна",
                "",
                "2026-08-31T00:00:00.000Z",
                "Постоянно",
                0, 0, 0, 0, 0,
                "Критичное: без D1 недоступны рабочие записи",
                "d1-core@1",
                1,
                1,
                "2026-08-31 00:00:00",
            ),
            (
                "INT-T-TOCHKA",
                "Банк Точка",
                "Банк",
                "Финансы",
                "ROLE:OWNER",
                "Официальный интерфейс Банка Точка",
                "Только чтение · счета, остатки, выписки и проведённые операции",
                "Работает",
                "Ключ принят · счета, выписки и операции загружены",
                "",
                "2026-08-31T00:00:00.000Z",
                "2026-09-01T00:00:00.000Z",
                0, 0, 0, 0, 0,
                "Критичное: без синхронизации новые банковские операции не попадут в реестр финансов",
                "bank-tochka-readonly@2",
                1,
                1,
                "2026-08-31 00:00:00",
            ),
        ),
    )
    for index in range(1, 5):
        connection.execute(
            "INSERT INTO bank_accounts VALUES (?,?,?,?,?,?,?,?)",
            (
                f"A{index}",
                "INT-T-TOCHKA",
                "ORG",
                f"ACC{index}",
                "RUB",
                index * 1000,
                "2026-08-31",
                "2026-08-31T00:00:00.000Z",
            ),
        )
    connection.execute(
        "INSERT INTO financial_operations "
        "(id,operation_date,direction,amount_minor,legal_entity_id,bank_operation_ref,operation_kind,source_system) "
        "VALUES ('OLD','2026-08-31','Поступление',1,'ORG','','MANUAL','MANUAL')"
    )
    for table in GENERIC_PROTECTED:
        connection.execute(f'INSERT INTO "{table}" VALUES (?,?)', (f"OLD-{table}", "kept"))
    connection.execute(
        "INSERT INTO integration_sync_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            "OLD-RUN",
            "INT-T-TOCHKA",
            "2026-08-31T10:00:00.000Z",
            "2026-08-31T10:00:00.000Z",
            "Успешно",
            4,
            4,
            0,
            0,
            0,
            "accounts:4;statements:0;transactions:0",
            0,
        ),
    )


def seed_import(connection: sqlite3.Connection) -> None:
    specs = {
        "ACC1": (1000, 1500, [("Поступление", 500)]),
        "ACC2": (2000, 1800, [("Списание", 200)]),
        "ACC3": (3000, 3600, [("Поступление", 700), ("Списание", 100)]),
        "ACC4": (4000, 3900, [("Поступление", 300), ("Списание", 400)]),
    }
    transaction_index = 0
    for account_id, (start_balance, end_balance, transactions) in specs.items():
        statement_id = f"STMT-{account_id}"
        connection.execute(
            "UPDATE bank_accounts SET balance_minor=?,balance_as_of='2026-09-05',synced_at=? "
            "WHERE connection_id='INT-T-TOCHKA' AND provider_account_id=?",
            (end_balance, SYNC_AT, account_id),
        )
        connection.execute(
            "INSERT INTO bank_statement_imports VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                statement_id,
                "INT-T-TOCHKA",
                "ORG",
                statement_id,
                account_id,
                "2026-09-01",
                "2026-09-05",
                "Ready",
                start_balance,
                end_balance,
                "RUB",
                len(transactions),
                SYNC_AT,
            ),
        )
        for direction, amount in transactions:
            transaction_index += 1
            transaction_id = f"TX{transaction_index}"
            operation_id = f"FIN{transaction_index}"
            connection.execute(
                "INSERT INTO bank_transactions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    transaction_id,
                    "INT-T-TOCHKA",
                    "ORG",
                    account_id,
                    statement_id,
                    transaction_id,
                    "2026-09-02",
                    direction,
                    amount,
                    "RUB",
                    "Booked",
                    operation_id,
                    SYNC_AT,
                ),
            )
            connection.execute(
                "INSERT INTO financial_operations "
                "(id,operation_date,direction,amount_minor,legal_entity_id,bank_operation_ref,operation_kind,source_system) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (
                    operation_id,
                    "2026-09-02",
                    direction,
                    amount,
                    "ORG",
                    transaction_id,
                    "BANK_STATEMENT",
                    "BANK_TOCHKA_API",
                ),
            )
    connection.execute(
        "INSERT INTO integration_sync_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            "RUN1",
            "INT-T-TOCHKA",
            SYNC_AT,
            SYNC_AT,
            "Успешно",
            14,
            14,
            0,
            0,
            0,
            "accounts:4;statements:4;transactions:6",
            0,
        ),
    )


class CheckerFixture:
    def __init__(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.before = root / "before.sqlite"
        self.after = root / "after.sqlite"
        for path in (self.before, self.after):
            with sqlite3.connect(path) as connection:
                create_schema(connection)
                seed_baseline(connection)
        with sqlite3.connect(self.after) as connection:
            seed_import(connection)

    def close(self) -> None:
        self.temp.cleanup()

    def run(self, *extra: str) -> tuple[subprocess.CompletedProcess[str], dict[str, object]]:
        process = subprocess.run(
            [
                sys.executable,
                str(CHECKER),
                "--before-db",
                str(self.before),
                "--after-db",
                str(self.after),
                "--min-sync-at",
                "2026-09-05T13:00:00Z",
                "--expected-source-transaction-count",
                "6",
                *extra,
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        lines = process.stdout.splitlines()
        if len(lines) != 1:
            raise AssertionError(f"expected exactly one stdout line, received {len(lines)}")
        return process, json.loads(lines[0])


class ReconcileTochkaSnapshotTest(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = CheckerFixture()

    def tearDown(self) -> None:
        self.fixture.close()

    def test_clean_import_passes_all_checks_and_emits_aggregates_only(self) -> None:
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 0)
        self.assertEqual(process.stderr, "")
        self.assertEqual(result["status"], "ok")
        self.assertTrue(all(result["checks"].values()))
        self.assertEqual(result["amounts_minor"]["bank_receipts"], 1500)
        self.assertEqual(result["amounts_minor"]["bank_outflows"], 700)
        self.assertEqual(result["amounts_minor"]["receipt_difference"], 0)
        self.assertEqual(result["amounts_minor"]["outflow_difference"], 0)
        self.assertNotIn("ACC1", process.stdout)
        self.assertNotIn("ORG", process.stdout)
        self.assertNotIn("TX1", process.stdout)

    def test_catalog_wide_canonical_refresh_is_allowed(self) -> None:
        # The production action refreshes every known catalog row, not only the
        # Tochka row. It may canonicalize old metadata and always advances the
        # catalog row timestamp.
        with sqlite3.connect(self.fixture.before) as connection:
            connection.execute(
                "UPDATE integration_connections SET system='Legacy D1 label' "
                "WHERE id='INT-T-D1'"
            )
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute(
                "UPDATE integration_connections SET updated_at='2026-09-05 13:20:00'"
            )
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 0)
        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["checks"]["baseline_row_contents_preserved"])
        self.assertEqual(result["counts"]["changed_baseline_rows"], 0)

    def test_catalog_refresh_requires_canonical_ownership(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute(
                "UPDATE integration_connections SET owner_entity_id='ROLE:ATTACKER',"
                "updated_at='2026-09-05 13:20:00' WHERE id='INT-T-D1'"
            )
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["checks"]["baseline_row_contents_preserved"])
        self.assertEqual(result["counts"]["changed_baseline_rows"], 1)

    def test_deleted_baseline_financial_row_is_detected_by_primary_key(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute("DELETE FROM financial_operations WHERE id='OLD'")
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["checks"]["baseline_primary_keys_preserved"])
        self.assertEqual(result["counts"]["missing_baseline_rows"], 1)

    def test_same_key_owner_credential_corruption_is_rejected(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute(
                "UPDATE production_auth_credentials SET value='CORRUPTED' "
                "WHERE id='OLD-production_auth_credentials'"
            )
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertTrue(result["checks"]["baseline_primary_keys_preserved"])
        self.assertFalse(result["checks"]["baseline_row_contents_preserved"])
        self.assertEqual(result["counts"]["changed_baseline_rows"], 1)
        self.assertNotIn("CORRUPTED", process.stdout)

    def test_same_key_baseline_financial_corruption_is_rejected(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute("UPDATE financial_operations SET amount_minor=999 WHERE id='OLD'")
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertTrue(result["checks"]["baseline_primary_keys_preserved"])
        self.assertFalse(result["checks"]["baseline_row_contents_preserved"])
        self.assertEqual(result["counts"]["changed_baseline_rows"], 1)

    def test_unexpected_owner_credential_row_is_rejected(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute(
                "INSERT INTO production_auth_credentials VALUES ('BACKDOOR', 'new')"
            )
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["checks"]["protected_table_growth_scoped"])
        self.assertEqual(result["counts"]["unexpected_new_protected_rows"], 1)
        self.assertNotIn("BACKDOOR", process.stdout)

    def test_unrelated_new_financial_operation_is_rejected(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute(
                "INSERT INTO financial_operations "
                "(id,operation_date,direction,amount_minor,legal_entity_id,bank_operation_ref,"
                "operation_kind,source_system) VALUES "
                "('UNRELATED','2026-09-02','Поступление',10,'ORG','','MANUAL','MANUAL')"
            )
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["checks"]["protected_table_growth_scoped"])
        self.assertEqual(result["counts"]["unexpected_new_protected_rows"], 1)

    def test_tochka_account_identity_is_immutable_during_balance_refresh(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute(
                "UPDATE bank_accounts SET legal_entity_id='OTHER' WHERE provider_account_id='ACC1'"
            )
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["checks"]["baseline_row_contents_preserved"])
        self.assertEqual(result["counts"]["changed_baseline_rows"], 1)

    def test_registry_amount_mismatch_fails_row_and_gross_checks(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute("UPDATE financial_operations SET amount_minor=501 WHERE id='FIN1'")
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["checks"]["bank_registry_one_to_one"])
        self.assertFalse(result["checks"]["gross_receipts"])
        self.assertEqual(result["amounts_minor"]["receipt_difference"], 1)

    def test_stale_successful_sync_is_rejected(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute(
                "UPDATE integration_sync_runs SET started_at='2026-09-03T12:00:00.000Z',"
                "finished_at='2026-09-03T12:00:00.000Z' WHERE id='RUN1'"
            )
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["checks"]["latest_sync"])

    def test_idempotent_rerun_may_keep_an_older_statement_reference(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute(
                "INSERT INTO bank_statement_imports VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    "OLDER-STMT-ACC1",
                    "INT-T-TOCHKA",
                    "ORG",
                    "OLDER-STMT-ACC1",
                    "ACC1",
                    "2026-09-01",
                    "2026-09-05",
                    "Ready",
                    1000,
                    1500,
                    "RUB",
                    1,
                    "2026-09-05T12:00:00.000Z",
                ),
            )
            connection.execute(
                "UPDATE bank_transactions SET provider_statement_id='OLDER-STMT-ACC1' WHERE id='TX1'"
            )
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 0)
        self.assertEqual(result["status"], "ok")

    def test_global_transaction_count_cannot_hide_per_account_mismatch(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute("UPDATE bank_statement_imports SET transaction_count=2 WHERE id='STMT-ACC1'")
            connection.execute("UPDATE bank_statement_imports SET transaction_count=0 WHERE id='STMT-ACC2'")
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["checks"]["transaction_counts"])

    def test_transaction_reference_to_wrong_window_is_rejected(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute(
                "INSERT INTO bank_statement_imports VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    "AUG-STMT-ACC1",
                    "INT-T-TOCHKA",
                    "ORG",
                    "AUG-STMT-ACC1",
                    "ACC1",
                    "2026-08-01",
                    "2026-08-31",
                    "Ready",
                    0,
                    1000,
                    "RUB",
                    1,
                    "2026-08-31T12:00:00.000Z",
                ),
            )
            connection.execute(
                "UPDATE bank_transactions SET provider_statement_id='AUG-STMT-ACC1' WHERE id='TX1'"
            )
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["checks"]["transaction_shape"])

    def test_extra_statement_at_current_run_timestamp_is_rejected(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute(
                "INSERT INTO bank_statement_imports VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    "EXTRA-STMT-ACC1",
                    "INT-T-TOCHKA",
                    "ORG",
                    "EXTRA-STMT-ACC1",
                    "ACC1",
                    "2026-09-01",
                    "2026-09-05",
                    "Ready",
                    1000,
                    1500,
                    "RUB",
                    1,
                    SYNC_AT,
                ),
            )
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["checks"]["latest_statements"])

    def test_malformed_extra_tochka_registry_row_is_not_hidden(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute(
                "INSERT INTO financial_operations "
                "(id,operation_date,direction,amount_minor,legal_entity_id,bank_operation_ref,operation_kind,source_system) "
                "VALUES ('EXTRA','2026-09-02','Поступление',10,'ORG','EXTRA','MANUAL','BANK_TOCHKA_API')"
            )
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["checks"]["bank_registry_one_to_one"])
        self.assertFalse(result["checks"]["gross_receipts"])

    def test_ineligible_pending_transaction_cannot_keep_financial_link(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute("UPDATE bank_transactions SET status='Pending' WHERE id='TX1'")
            connection.execute("UPDATE financial_operations SET source_system='MANUAL' WHERE id='FIN1'")
            connection.execute(
                "UPDATE bank_statement_imports SET end_balance_minor=1000 WHERE id='STMT-ACC1'"
            )
            connection.execute(
                "UPDATE bank_accounts SET balance_minor=1000 WHERE provider_account_id='ACC1'"
            )
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["checks"]["transaction_shape"])

    def test_pending_transaction_cannot_be_excluded_from_reconciliation(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute(
                "UPDATE bank_transactions SET status='Pending',financial_operation_id='' "
                "WHERE id='TX1'"
            )
            connection.execute("DELETE FROM financial_operations WHERE id='FIN1'")
            connection.execute(
                "UPDATE bank_statement_imports SET end_balance_minor=1000 WHERE id='STMT-ACC1'"
            )
            connection.execute(
                "UPDATE bank_accounts SET balance_minor=1000 WHERE provider_account_id='ACC1'"
            )
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["checks"]["transaction_shape"])
        self.assertEqual(result["counts"]["pending_or_other_transactions"], 1)

    def test_non_rub_account_cannot_be_excluded_from_reconciliation(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute(
                "UPDATE bank_accounts SET currency='USD' WHERE provider_account_id='ACC4'"
            )
            connection.execute(
                "UPDATE bank_statement_imports SET currency='USD' WHERE provider_account_id='ACC4'"
            )
            connection.execute(
                "UPDATE bank_transactions SET currency='USD',financial_operation_id='' "
                "WHERE provider_account_id='ACC4'"
            )
            connection.execute("DELETE FROM financial_operations WHERE id IN ('FIN5','FIN6')")
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["checks"]["account_set"])

    def test_account_balance_snapshot_must_match_latest_statement(self) -> None:
        with sqlite3.connect(self.fixture.after) as connection:
            connection.execute(
                "UPDATE bank_accounts SET balance_minor=1499 WHERE provider_account_id='ACC1'"
            )
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["checks"]["latest_statements"])

    def test_latest_run_must_not_already_exist_in_baseline(self) -> None:
        with sqlite3.connect(self.fixture.before) as connection:
            connection.execute(
                "INSERT INTO integration_sync_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    "RUN1",
                    "INT-T-TOCHKA",
                    SYNC_AT,
                    SYNC_AT,
                    "Успешно",
                    14,
                    14,
                    0,
                    0,
                    0,
                    "accounts:4;statements:4;transactions:6",
                    0,
                ),
            )
        process, result = self.fixture.run()
        self.assertEqual(process.returncode, 1)
        self.assertFalse(result["checks"]["latest_sync"])


if __name__ == "__main__":
    unittest.main()
