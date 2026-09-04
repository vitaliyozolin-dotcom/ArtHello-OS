#!/usr/bin/env python3
"""Read-only reconciliation of a post-import Tochka SQLite snapshot.

The program deliberately emits one JSON object containing aggregates only. It
never emits database paths, account identifiers, statement identifiers,
transaction identifiers, counterparties, descriptions, or raw SQLite errors.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable


DEFAULT_CONNECTION_ID = "INT-T-TOCHKA"
DEFAULT_START_DATE = "2026-09-01"
DEFAULT_END_DATE = "2026-09-04"
DEFAULT_EXPECTED_ACCOUNTS = 4

REQUIRED_COLUMNS = {
    "integration_sync_runs": {
        "id", "connection_id", "started_at", "finished_at", "status",
        "received_count", "accepted_count", "rejected_count", "error_count",
        "conflict_count", "checkpoint", "dry_run",
    },
    "bank_accounts": {
        "id", "connection_id", "legal_entity_id", "provider_account_id",
        "currency", "balance_minor", "balance_as_of", "synced_at",
    },
    "bank_statement_imports": {
        "id", "connection_id", "legal_entity_id", "provider_statement_id",
        "provider_account_id", "start_date", "end_date", "status",
        "start_balance_minor", "end_balance_minor", "currency",
        "transaction_count", "fetched_at",
    },
    "bank_transactions": {
        "id", "connection_id", "legal_entity_id", "provider_account_id",
        "provider_statement_id", "provider_transaction_id", "operation_date",
        "direction", "amount_minor", "currency", "status",
        "financial_operation_id", "imported_at",
    },
    "financial_operations": {
        "id", "operation_date", "direction", "amount_minor",
        "legal_entity_id", "bank_operation_ref", "operation_kind",
        "source_system",
    },
}

# These columns are added by the D-069 production migration. Their presence is
# checked in the live snapshot even though the base Drizzle declaration has not
# yet absorbed the deployment-only additive migration.
D069_COLUMNS = {
    "cashflow_article",
    "pnl_article",
    "accrual_period",
    "counterparty_label",
    "management_purpose",
}

# Financial/business rows that must survive the import. The checker compares
# primary-key membership, not just row counts, so delete-and-reinsert cannot
# masquerade as an additive operation.
PROTECTED_TABLES = (
    "production_auth_credentials",
    "app_users",
    "user_system_access",
    "entities",
    "integration_connections",
    "financial_operations",
    "bank_accounts",
    "bank_statement_imports",
    "bank_transactions",
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
    "integration_sync_runs",
    "integration_log_entries",
    "audit_events",
)

APPEND_ONLY_TABLES = {
    "financial_operations",
    "bank_statement_imports",
    "bank_transactions",
    "integration_sync_runs",
    "integration_log_entries",
    "audit_events",
}

# The Tochka import appends to most protected tables, so every baseline row in
# those tables must remain value-for-value equivalent.
# Only these rows/columns are updated by the production import contract. Rows
# outside the named scope are still compared across every baseline column.
SCOPED_MUTABLE_COLUMNS = {
    # A successful owner login may reset only lockout bookkeeping.
    "production_auth_credentials": {
        "failed_attempts",
        "locked_until",
        "last_login_at",
        "last_authenticated_at",
        "updated_at",
    },
    "integration_connections": {
        "status",
        "auth_status",
        "credential_expires_at",
        "last_success_at",
        "next_sync_at",
        "received_count",
        "accepted_count",
        "rejected_count",
        "error_count",
        "conflict_count",
        "verified_transfer",
        "is_enabled",
        "updated_at",
    },
    "bank_accounts": {
        "masked_account",
        "name",
        "currency",
        "status",
        "balance_minor",
        "balance_as_of",
        "synced_at",
    },
    "bank_statement_imports": {
        "status",
        "start_balance_minor",
        "end_balance_minor",
        "currency",
        "transaction_count",
        "fetched_at",
    },
    "system_runtime_state": {"state_value", "updated_at"},
}

# ``ensureOperatingIntegrationCatalog`` in the pinned production release
# refreshes these catalog-owned fields on every integration action, for every
# known connection. A refresh is legitimate only when the resulting values are
# the release's canonical constants; all other columns remain protected by the
# before/after comparison below.
CATALOG_COLUMNS = (
    "system",
    "category",
    "target_module",
    "owner_entity_id",
    "source_of_truth",
    "mode",
    "impact",
    "adapter_version",
)
CATALOG_REFRESH_COLUMNS = {*CATALOG_COLUMNS, "updated_at"}
PINNED_INTEGRATION_CATALOG = {
    "INT-T-D1": (
        "ArtHello OS D1", "Внутренняя платформа", "Все модули", "ROLE:OWNER",
        "ArtHello OS D1", "Binding · read/write",
        "Критичное: без D1 недоступны рабочие записи", "d1-core@1",
    ),
    "INT-T-ALFACRM": (
        "AlfaCRM", "CRM", "Продажи · Клиенты · Обучение", "ROLE:SALES",
        "AlfaCRM", "API · входящие и исходящие изменения",
        "Высокое: лиды, семьи, договоры и статусы не синхронизируются автоматически",
        "alfacrm@1",
    ),
    "INT-T-FORMS": (
        "Формы сайта", "Маркетинг", "Продажи", "ROLE:MARKETING",
        "Формы сайта ArtHello", "Webhook · входящие заявки",
        "Высокое: заявки сайта не попадают в воронку автоматически", "web-forms@1",
    ),
    "INT-T-PHONE": (
        "Телефония", "Коммуникации", "Продажи", "ROLE:SALES",
        "Выбранный оператор телефонии", "Webhook · звонки и записи контактов",
        "Среднее: звонки приходится фиксировать вручную", "telephony@1",
    ),
    "INT-T-WHATSAPP": (
        "WhatsApp", "Коммуникации", "Продажи · Клиенты", "ROLE:SALES",
        "WhatsApp Business API", "Webhook · обращения и статусы сообщений",
        "Высокое: обращения WhatsApp не создают лиды автоматически", "whatsapp@1",
    ),
    "INT-T-TG": (
        "Telegram", "Коммуникации", "Продажи · Клиенты · Задачи", "ROLE:SALES",
        "Telegram Bot API", "Webhook · обращения и уведомления",
        "Среднее: обращения Telegram остаются вне единой истории", "telegram@1",
    ),
    "INT-T-VK": (
        "VK", "Маркетинг", "Продажи · Контент", "ROLE:MARKETING",
        "VK API · Lead Ads и сообщения", "API / webhook · лиды, сообщения и UTM",
        "Среднее: лиды VK и сообщения не связаны с воронкой", "vk@1",
    ),
    "INT-T-YANDEX": (
        "Яндекс", "Маркетинг", "Продажи · Контент", "ROLE:MARKETING",
        "Яндекс Директ · Метрика · Формы", "API · кампании, формы, расходы и UTM",
        "Среднее: стоимость лида и first-click не подтверждаются Яндексом", "yandex@1",
    ),
    "INT-T-MAIL": (
        "Email и рассылки", "Коммуникации", "Продажи · Клиенты · Контент", "ROLE:MARKETING",
        "Выбранный почтовый сервис", "API · письма, ответы и статусы доставки",
        "Среднее: письма и ответы не входят в историю клиента", "mailing@1",
    ),
    "INT-T-ADS": (
        "Рекламные кабинеты", "Маркетинг", "Продажи · Контент", "ROLE:MARKETING",
        "Рекламные платформы", "API · расходы, кампании и креативы",
        "Среднее: ROMI и стоимость лида не подтверждаются платформами", "ads@1",
    ),
    "INT-T-SOCIAL": (
        "Социальные сети", "Контент", "Контент · Продажи", "ROLE:MARKETING",
        "Социальные платформы", "API · публикации, метрики и переходы",
        "Среднее: контент не связывается с кликами, лидами и выручкой", "social@1",
    ),
    "INT-T-TOCHKA": (
        "Банк Точка", "Банк", "Финансы", "ROLE:OWNER",
        "Официальный интерфейс Банка Точка",
        "Только чтение · счета, остатки, выписки и проведённые операции",
        "Критичное: без синхронизации новые банковские операции не попадут в реестр финансов",
        "bank-tochka-readonly@2",
    ),
    "INT-T-TBANK": (
        "Т‑Банк", "Банк", "Финансы", "ROLE:OWNER",
        "Официальный интерфейс Т‑Банка для бизнеса",
        "Прямое подключение · только чтение счетов и короткой выписки",
        "Критичное: доступ можно проверить, но операции не импортируются и платежи не создаются",
        "tbank-h2h-readonly@1",
    ),
    "INT-T-DIARY": (
        "Электронный дневник", "Образование", "Обучение", "ROLE:METHODIST",
        "ArtHello School 1–11", "API · расписание, оценки и посещаемость",
        "Высокое: учебные данные не синхронизируются с основной системой", "diary@1",
    ),
    "INT-T-EDO": (
        "ЭДО", "Документы", "Бухгалтерия · Юрист", "ROLE:ACCOUNTING",
        "Выбранный оператор ЭДО", "API · документы и подписи",
        "Высокое: подписи и первичные документы подтверждаются вручную", "edo@1",
    ),
    "INT-T-1C": (
        "1С", "Учёт", "Бухгалтерия", "ROLE:ACCOUNTING", "1С",
        "Контролируемый импорт и экспорт",
        "Высокое: данные не передаются в 1С автоматически", "1c@1",
    ),
    "INT-T-ACS": (
        "СКУД", "Безопасность", "Безопасность", "ROLE:SAFETY",
        "Контроллеры СКУД", "API · события доступа",
        "Критичное: события доступа не поступают в систему", "acs@1",
    ),
    "INT-T-CAM": (
        "Камеры", "Безопасность", "Безопасность", "ROLE:SAFETY", "VMS объектов",
        "События без хранения видеопотока",
        "Среднее: события камер не поступают в систему", "cameras@1",
    ),
    "INT-T-OPENAI-IMAGES": (
        "OpenAI Images", "Контент", "Контент · Студия", "ROLE:MARKETING",
        "OpenAI Images API", "API · генерация и редактирование",
        "Среднее: генерация изображений недоступна без отдельного ключа", "openai-images@1",
    ),
}

CHECK_NAMES = (
    "after_integrity",
    "after_foreign_keys",
    "before_integrity",
    "before_foreign_keys",
    "additive_schema",
    "required_schema",
    "baseline_primary_keys_preserved",
    "baseline_row_contents_preserved",
    "protected_table_growth_scoped",
    "latest_sync",
    "account_set",
    "latest_statements",
    "transaction_counts",
    "transaction_shape",
    "per_account_balances",
    "bank_registry_one_to_one",
    "gross_receipts",
    "gross_outflows",
    "real_activity",
)

CHECKPOINT_RE = re.compile(
    r"^accounts:(?P<accounts>\d+);statements:(?P<statements>\d+);"
    r"transactions:(?P<transactions>\d+)$"
)
SAFE_CONNECTION_RE = re.compile(r"^[A-Z0-9][A-Z0-9._:-]{1,79}$")
SAFE_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # pragma: no cover - exact text is intentionally discarded
        raise ValueError("invalid_arguments")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = JsonArgumentParser(add_help=False)
    parser.add_argument("--after-db", required=True)
    parser.add_argument("--before-db", required=True)
    parser.add_argument("--start-date", default=DEFAULT_START_DATE)
    parser.add_argument("--end-date", default=DEFAULT_END_DATE)
    parser.add_argument("--min-sync-at", default="")
    parser.add_argument("--connection-id", default=DEFAULT_CONNECTION_ID)
    parser.add_argument("--expected-accounts", type=int, default=DEFAULT_EXPECTED_ACCOUNTS)
    parser.add_argument("--expected-source-transaction-count", type=int, required=True)
    parser.add_argument("--help", action="store_true")
    args = parser.parse_args(argv)
    if args.help:
        raise ValueError("help_requested")
    return args


def empty_result(start_date: str = DEFAULT_START_DATE, end_date: str = DEFAULT_END_DATE) -> dict[str, Any]:
    return {
        "version": 1,
        "status": "failed",
        "window": {"start_date": start_date, "end_date": end_date},
        "checks": {name: False for name in CHECK_NAMES},
        "counts": {
            "accounts": None,
            "latest_statements": None,
            "statement_transactions": None,
            "stored_transactions": None,
            "booked_rub_transactions": None,
            "booked_non_rub_transactions": None,
            "registry_operations": None,
            "receipt_transactions": None,
            "outflow_transactions": None,
            "pending_or_other_transactions": None,
            "protected_tables": None,
            "baseline_protected_rows": None,
            "post_import_protected_rows": None,
            "missing_baseline_rows": None,
            "changed_baseline_rows": None,
            "unexpected_new_protected_rows": None,
            "foreign_key_violations": None,
            "declared_foreign_keys": None,
        },
        "amounts_minor": {
            "bank_receipts": None,
            "registry_receipts": None,
            "receipt_difference": None,
            "bank_outflows": None,
            "registry_outflows": None,
            "outflow_difference": None,
        },
        "balances": {
            "accounts_checked": None,
            "mismatched_accounts": None,
            "max_absolute_difference_minor": None,
        },
        "sync": {
            "received_count": None,
            "accepted_count": None,
            "rejected_count": None,
            "error_count": None,
            "conflict_count": None,
            "checkpoint_accounts": None,
            "checkpoint_statements": None,
            "checkpoint_transactions": None,
        },
        "failures": [],
        "limitations": [
            "gross_totals_are_reconciled_from_persisted_bank_facts_not_an_independent_raw_provider_total",
            "balance_equations_use_booked_transactions_only",
            "baseline_rows_are_compared_by_sqlite_values_not_transient_write_history",
            "only_contract_scoped_columns_may_change_on_existing_import_rows",
            "sqlite_foreign_key_check_only_covers_declared_constraints_and_is_supplemented_by_logical_reference_checks",
            "a_single_before_after_pair_does_not_prove_two_consecutive_imports_are_idempotent",
        ],
    }


def emit(result: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")


def add_failure(result: dict[str, Any], code: str) -> None:
    failures = result["failures"]
    if code not in failures:
        failures.append(code)


def record(result: dict[str, Any], check: str, passed: bool, failure_code: str) -> bool:
    result["checks"][check] = bool(passed)
    if not passed:
        add_failure(result, failure_code)
    return bool(passed)


def parse_date(value: str) -> date:
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError("invalid_date")
    return parsed


def parse_timestamp(value: str) -> datetime:
    candidate = value.strip()
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    parsed = datetime.fromisoformat(candidate)
    if parsed.tzinfo is None:
        raise ValueError("timestamp_requires_timezone")
    return parsed.astimezone(timezone.utc)


def validate_inputs(args: argparse.Namespace) -> tuple[Path, Path, datetime]:
    start = parse_date(args.start_date)
    end = parse_date(args.end_date)
    if start > end:
        raise ValueError("invalid_date_window")
    if args.expected_accounts <= 0 or args.expected_accounts > 200:
        raise ValueError("invalid_expected_accounts")
    if args.expected_source_transaction_count is not None and args.expected_source_transaction_count < 0:
        raise ValueError("invalid_expected_transaction_count")
    args.connection_id = args.connection_id.strip().upper()
    if not SAFE_CONNECTION_RE.fullmatch(args.connection_id):
        raise ValueError("invalid_connection_id")
    minimum = args.min_sync_at or f"{args.end_date}T00:00:00.000Z"
    min_sync_at = parse_timestamp(minimum)
    after_path = Path(args.after_db).resolve(strict=True)
    before_path = Path(args.before_db).resolve(strict=True)
    if not after_path.is_file() or not before_path.is_file() or after_path == before_path:
        raise ValueError("invalid_snapshot_paths")
    return after_path, before_path, min_sync_at


def sqlite_ro_uri(path: Path) -> str:
    return f"{path.as_uri()}?mode=ro"


def open_snapshots(after_path: Path, before_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(sqlite_ro_uri(after_path), uri=True, timeout=5.0)
    connection.row_factory = sqlite3.Row
    connection.execute("ATTACH DATABASE ? AS baseline", (sqlite_ro_uri(before_path),))
    connection.execute("PRAGMA query_only=ON")
    connection.execute("PRAGMA trusted_schema=OFF")
    connection.execute("BEGIN")
    return connection


def quote_identifier(value: str) -> str:
    if not SAFE_IDENTIFIER_RE.fullmatch(value):
        raise ValueError("unsafe_identifier")
    return f'"{value}"'


def user_tables(connection: sqlite3.Connection, schema: str) -> set[str]:
    schema_sql = quote_identifier(schema)
    return {
        str(row[0])
        for row in connection.execute(
            f"SELECT name FROM {schema_sql}.sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    }


def table_info(connection: sqlite3.Connection, schema: str, table: str) -> list[sqlite3.Row]:
    return list(
        connection.execute(
            f"PRAGMA {quote_identifier(schema)}.table_info({quote_identifier(table)})"
        )
    )


def table_columns(connection: sqlite3.Connection, schema: str, table: str) -> set[str]:
    return {str(row[1]) for row in table_info(connection, schema, table)}


def primary_key_columns(connection: sqlite3.Connection, schema: str, table: str) -> list[str]:
    info = table_info(connection, schema, table)
    return [
        str(row[1])
        for row in sorted((row for row in info if int(row[5]) > 0), key=lambda row: int(row[5]))
    ]


def scalar(connection: sqlite3.Connection, sql: str, bindings: Iterable[Any] = ()) -> int:
    row = connection.execute(sql, tuple(bindings)).fetchone()
    return int(row[0] if row and row[0] is not None else 0)


def value_equality(columns: Iterable[str]) -> str:
    return " AND ".join(
        f"a.{quote_identifier(column)} IS b.{quote_identifier(column)}" for column in columns
    )


def mutable_scope(
    table: str,
    columns: set[str],
    connection_id: str,
    start_date: str,
    end_date: str,
) -> tuple[str, tuple[Any, ...]] | None:
    if table == "production_auth_credentials" and "user_id" in columns:
        return 'b."user_id" IS ?', ("AUTH-OWNER",)
    if table == "bank_accounts" and "connection_id" in columns:
        return 'b."connection_id" IS ?', (connection_id,)
    if table == "bank_statement_imports" and {
        "connection_id", "start_date", "end_date",
    }.issubset(columns):
        return (
            'b."connection_id" IS ? AND b."start_date" IS ? AND b."end_date" IS ?',
            (connection_id, start_date, end_date),
        )
    if table == "system_runtime_state" and "state_key" in columns:
        return 'b."state_key" IS ?', (f"integration_setup:{connection_id}",)
    return None


def integration_connection_content_changes(
    connection: sqlite3.Connection,
    primary_key: list[str],
    connection_id: str,
) -> int:
    """Validate the catalog-wide refresh performed by every integration action."""

    columns = [str(row[1]) for row in table_info(connection, "baseline", "integration_connections")]
    required = {"id", *CATALOG_COLUMNS}
    if primary_key != ["id"] or not required.issubset(columns):
        return 1

    selected = ",".join(quote_identifier(column) for column in columns)
    before_rows = list(connection.execute(f"SELECT {selected} FROM baseline.integration_connections"))
    after_rows = {
        str(row["id"]): row
        for row in connection.execute(f"SELECT {selected} FROM main.integration_connections")
    }
    changed = 0
    import_mutable = SCOPED_MUTABLE_COLUMNS["integration_connections"]
    for before in before_rows:
        row_id = str(before["id"])
        after = after_rows.get(row_id)
        if after is None:
            continue  # Missing rows are reported by the primary-key preservation check.
        mutable: set[str] = set()
        if row_id in PINNED_INTEGRATION_CATALOG:
            mutable.update(CATALOG_REFRESH_COLUMNS)
        if row_id == connection_id:
            mutable.update(import_mutable)
        immutable_changed = any(
            before[column] != after[column] for column in columns if column not in mutable
        )
        canonical = PINNED_INTEGRATION_CATALOG.get(row_id)
        canonical_mismatch = canonical is not None and any(
            after[column] != expected
            for column, expected in zip(CATALOG_COLUMNS, canonical)
        )
        if immutable_changed or canonical_mismatch:
            changed += 1
    return changed


def setup_state_content_changed(
    connection: sqlite3.Connection,
    connection_id: str,
    start_date: str,
    min_sync_at: datetime,
) -> int:
    required = {"state_key", "state_value"}
    if not required.issubset(table_columns(connection, "baseline", "system_runtime_state")):
        return 0
    state_key = f"integration_setup:{connection_id}"
    before = connection.execute(
        "SELECT state_value FROM baseline.system_runtime_state WHERE state_key=?",
        (state_key,),
    ).fetchone()
    after = connection.execute(
        "SELECT state_value FROM main.system_runtime_state WHERE state_key=?",
        (state_key,),
    ).fetchone()
    if before is None or after is None:
        return 0  # Missing rows are reported by the primary-key preservation check.
    try:
        before_value = json.loads(str(before[0]))
        after_value = json.loads(str(after[0]))
    except (TypeError, ValueError):
        return 1
    if not isinstance(before_value, dict) or not isinstance(after_value, dict):
        return 1
    mutable_keys = {"startDate", "credentialGeneration", "updatedAt", "updatedBy"}
    before_stable = {key: value for key, value in before_value.items() if key not in mutable_keys}
    after_stable = {key: value for key, value in after_value.items() if key not in mutable_keys}
    generation = after_value.get("credentialGeneration")
    previous_generation = before_value.get("credentialGeneration")
    generation_ok = isinstance(generation, str) and re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
        generation.strip().lower(),
    )
    try:
        updated_at = parse_timestamp(str(after_value.get("updatedAt", "")))
    except (TypeError, ValueError):
        updated_at_ok = False
    else:
        updated_at_ok = updated_at >= min_sync_at
    updated_by = after_value.get("updatedBy")
    updated_by_ok = (
        isinstance(updated_by, str)
        and bool(updated_by.strip())
        and len(updated_by) <= 256
    )
    return int(
        before_stable != after_stable
        or after_value.get("startDate") != start_date
        or not generation_ok
        or generation == previous_generation
        or not updated_at_ok
        or not updated_by_ok
    )


def owner_auth_state_changed(connection: sqlite3.Connection) -> int:
    columns = table_columns(connection, "main", "production_auth_credentials")
    if "user_id" not in columns:
        return 0
    selected = [column for column in ("failed_attempts", "locked_until") if column in columns]
    if not selected:
        return 0
    row = connection.execute(
        f"SELECT {','.join(quote_identifier(column) for column in selected)} "
        "FROM main.production_auth_credentials WHERE user_id=?",
        ("AUTH-OWNER",),
    ).fetchone()
    if row is None:
        return 0  # Missing rows are reported by the primary-key preservation check.
    values = dict(zip(selected, row))
    try:
        attempts_ok = "failed_attempts" not in values or int(values["failed_attempts"]) == 0
        lock_ok = (
            "locked_until" not in values
            or int(values["locked_until"]) <= int(datetime.now(timezone.utc).timestamp())
        )
    except (TypeError, ValueError, OverflowError):
        return 1
    return int(not attempts_ok or not lock_ok)


def baseline_row_content_changes(
    connection: sqlite3.Connection,
    table: str,
    primary_key: list[str],
    connection_id: str,
    start_date: str,
    end_date: str,
    min_sync_at: datetime,
) -> int:
    if table == "integration_connections":
        return integration_connection_content_changes(connection, primary_key, connection_id)

    quoted = quote_identifier(table)
    columns = [str(row[1]) for row in table_info(connection, "baseline", table)]
    full_equality = value_equality(columns)
    join = value_equality(primary_key)
    scope = mutable_scope(table, set(columns), connection_id, start_date, end_date)
    if scope is None:
        changed = scalar(
            connection,
            f"SELECT COUNT(*) FROM baseline.{quoted} AS b "
            f"JOIN main.{quoted} AS a ON {join} WHERE NOT ({full_equality})",
        )
    else:
        scope_sql, bindings = scope
        mutable = SCOPED_MUTABLE_COLUMNS[table]
        immutable_columns = [column for column in columns if column not in mutable]
        immutable_equality = value_equality(immutable_columns)
        changed = scalar(
            connection,
            f"SELECT COUNT(*) FROM baseline.{quoted} AS b "
            f"JOIN main.{quoted} AS a ON {join} "
            f"WHERE CASE WHEN {scope_sql} THEN NOT ({immutable_equality}) "
            f"ELSE NOT ({full_equality}) END",
            bindings,
        )
    if table == "production_auth_credentials":
        changed += owner_auth_state_changed(connection)
    elif table == "system_runtime_state":
        changed += setup_state_content_changed(connection, connection_id, start_date, min_sync_at)
    return changed


def unexpected_new_rows(
    connection: sqlite3.Connection,
    table: str,
    primary_key: list[str],
    connection_id: str,
    start_date: str,
    end_date: str,
) -> int:
    quoted = quote_identifier(table)
    missing_from_baseline = " AND ".join(
        f"b.{quote_identifier(column)} IS a.{quote_identifier(column)}" for column in primary_key
    )
    new_row = f"NOT EXISTS (SELECT 1 FROM baseline.{quoted} AS b WHERE {missing_from_baseline})"
    if table not in APPEND_ONLY_TABLES:
        return scalar(connection, f"SELECT COUNT(*) FROM main.{quoted} AS a WHERE {new_row}")

    allowed_sql = "1"
    bindings: tuple[Any, ...] = ()
    if table == "financial_operations":
        allowed_sql = (
            "a.source_system='BANK_TOCHKA_API' AND a.operation_date BETWEEN ? AND ? "
            "AND EXISTS (SELECT 1 FROM main.bank_transactions AS t "
            "WHERE t.financial_operation_id=a.id AND t.connection_id=? "
            "AND t.operation_date BETWEEN ? AND ?)"
        )
        bindings = (start_date, end_date, connection_id, start_date, end_date)
    elif table == "bank_statement_imports":
        allowed_sql = (
            "a.connection_id=? AND a.start_date=? AND a.end_date=? "
            "AND EXISTS (SELECT 1 FROM main.bank_accounts AS account "
            "WHERE account.connection_id=a.connection_id "
            "AND account.legal_entity_id=a.legal_entity_id "
            "AND account.provider_account_id=a.provider_account_id)"
        )
        bindings = (connection_id, start_date, end_date)
    elif table == "bank_transactions":
        allowed_sql = (
            "a.connection_id=? AND a.operation_date BETWEEN ? AND ? "
            "AND EXISTS (SELECT 1 FROM main.bank_accounts AS account "
            "WHERE account.connection_id=a.connection_id "
            "AND account.legal_entity_id=a.legal_entity_id "
            "AND account.provider_account_id=a.provider_account_id)"
        )
        bindings = (connection_id, start_date, end_date)
    elif table in {"integration_sync_runs", "integration_log_entries"}:
        columns = table_columns(connection, "main", table)
        if "connection_id" not in columns:
            allowed_sql = "0"
        else:
            allowed_sql = "a.connection_id=?"
            bindings = (connection_id,)
    return scalar(
        connection,
        f"SELECT COUNT(*) FROM main.{quoted} AS a WHERE {new_row} AND NOT ({allowed_sql})",
        bindings,
    )


def check_integrity(connection: sqlite3.Connection, schema: str) -> bool:
    rows = list(connection.execute(f"PRAGMA {quote_identifier(schema)}.integrity_check"))
    return len(rows) == 1 and str(rows[0][0]).lower() == "ok"


def check_foreign_keys(connection: sqlite3.Connection, schema: str) -> int:
    return sum(1 for _ in connection.execute(f"PRAGMA {quote_identifier(schema)}.foreign_key_check"))


def declared_foreign_key_count(connection: sqlite3.Connection, schema: str) -> int:
    return sum(
        len(list(connection.execute(
            f"PRAGMA {quote_identifier(schema)}.foreign_key_list({quote_identifier(table)})"
        )))
        for table in user_tables(connection, schema)
    )


def check_schema_and_baseline(
    connection: sqlite3.Connection,
    result: dict[str, Any],
    connection_id: str,
    start_date: str,
    end_date: str,
    min_sync_at: datetime,
) -> bool:
    main_tables = user_tables(connection, "main")
    baseline_tables = user_tables(connection, "baseline")

    schema_additive = baseline_tables.issubset(main_tables)
    for table in sorted(baseline_tables & main_tables):
        if not table_columns(connection, "baseline", table).issubset(table_columns(connection, "main", table)):
            schema_additive = False
            break
    record(result, "additive_schema", schema_additive, "schema_is_not_additive")

    required_schema = True
    for table, columns in REQUIRED_COLUMNS.items():
        if (
            table not in main_tables
            or table not in baseline_tables
            or not columns.issubset(table_columns(connection, "main", table))
            or not columns.issubset(table_columns(connection, "baseline", table))
        ):
            required_schema = False
    if "financial_operations" not in main_tables or not D069_COLUMNS.issubset(
        table_columns(connection, "main", "financial_operations")
    ):
        required_schema = False
    if any(table not in main_tables or table not in baseline_tables for table in PROTECTED_TABLES):
        required_schema = False
    record(result, "required_schema", required_schema, "required_schema_missing")
    if not required_schema:
        return False

    baseline_total = 0
    post_total = 0
    missing_total = 0
    changed_total = 0
    unexpected_new_total = 0
    pk_contract_ok = True
    content_contract_ok = True
    for table in PROTECTED_TABLES:
        quoted = quote_identifier(table)
        before_count = scalar(connection, f"SELECT COUNT(*) FROM baseline.{quoted}")
        after_count = scalar(connection, f"SELECT COUNT(*) FROM main.{quoted}")
        baseline_total += before_count
        post_total += after_count
        before_pk = primary_key_columns(connection, "baseline", table)
        after_pk = primary_key_columns(connection, "main", table)
        if not before_pk or before_pk != after_pk:
            pk_contract_ok = False
            content_contract_ok = False
            continue
        predicate = " AND ".join(
            f"a.{quote_identifier(column)} IS b.{quote_identifier(column)}" for column in before_pk
        )
        missing_total += scalar(
            connection,
            f"SELECT COUNT(*) FROM baseline.{quoted} AS b "
            f"WHERE NOT EXISTS (SELECT 1 FROM main.{quoted} AS a WHERE {predicate})",
        )
        changed_total += baseline_row_content_changes(
            connection,
            table,
            before_pk,
            connection_id,
            start_date,
            end_date,
            min_sync_at,
        )
        unexpected_new_total += unexpected_new_rows(
            connection,
            table,
            before_pk,
            connection_id,
            start_date,
            end_date,
        )
    result["counts"].update({
        "protected_tables": len(PROTECTED_TABLES),
        "baseline_protected_rows": baseline_total,
        "post_import_protected_rows": post_total,
        "missing_baseline_rows": missing_total,
        "changed_baseline_rows": changed_total,
        "unexpected_new_protected_rows": unexpected_new_total,
    })
    record(
        result,
        "baseline_primary_keys_preserved",
        pk_contract_ok and missing_total == 0 and post_total >= baseline_total,
        "baseline_financial_rows_missing",
    )
    record(
        result,
        "baseline_row_contents_preserved",
        content_contract_ok and changed_total == 0,
        "baseline_protected_rows_changed",
    )
    record(
        result,
        "protected_table_growth_scoped",
        unexpected_new_total == 0,
        "unexpected_protected_rows_added",
    )
    return True


def fetch_accounts(
    connection: sqlite3.Connection,
    connection_id: str,
) -> list[sqlite3.Row]:
    return list(
        connection.execute(
            "SELECT id,legal_entity_id,provider_account_id,currency,synced_at "
            "      ,balance_minor,balance_as_of "
            "FROM bank_accounts WHERE connection_id=? ORDER BY id",
            (connection_id,),
        )
    )


def fetch_latest_statements(
    connection: sqlite3.Connection,
    connection_id: str,
) -> list[sqlite3.Row]:
    return list(
        connection.execute(
            """
            WITH ranked AS (
              SELECT s.*,
                ROW_NUMBER() OVER (
                  PARTITION BY s.legal_entity_id,s.provider_account_id
                  ORDER BY s.fetched_at DESC,s.id DESC
                ) AS row_rank
              FROM bank_statement_imports AS s
              WHERE s.connection_id=?
                AND EXISTS (
                  SELECT 1 FROM bank_accounts AS a
                  WHERE a.connection_id=s.connection_id
                    AND a.legal_entity_id=s.legal_entity_id
                    AND a.provider_account_id=s.provider_account_id
                )
            )
            SELECT id,legal_entity_id,provider_statement_id,provider_account_id,
                   start_date,end_date,status,start_balance_minor,end_balance_minor,
                   currency,transaction_count,fetched_at
            FROM ranked WHERE row_rank=1
            ORDER BY provider_account_id
            """,
            (connection_id,),
        )
    )


def fetch_window_transactions(
    connection: sqlite3.Connection,
    connection_id: str,
    legal_entity_id: str,
    account_ids: list[str],
    start_date: str,
    end_date: str,
) -> list[sqlite3.Row]:
    placeholders = ",".join("?" for _ in account_ids)
    return list(
        connection.execute(
            f"""
            SELECT id,provider_account_id,provider_statement_id,provider_transaction_id,
                   operation_date,direction,amount_minor,currency,status,
                   financial_operation_id
            FROM bank_transactions
            WHERE connection_id=? AND legal_entity_id=?
              AND provider_account_id IN ({placeholders})
              AND operation_date BETWEEN ? AND ?
            ORDER BY id
            """,
            (connection_id, legal_entity_id, *account_ids, start_date, end_date),
        )
    )


def direction_totals(rows: Iterable[sqlite3.Row]) -> dict[str, tuple[int, int]]:
    totals = {"Поступление": [0, 0], "Списание": [0, 0]}
    for row in rows:
        direction = str(row["direction"])
        if direction in totals:
            totals[direction][0] += 1
            totals[direction][1] += int(row["amount_minor"])
    return {key: (value[0], value[1]) for key, value in totals.items()}


def reconcile_financial_facts(
    connection: sqlite3.Connection,
    result: dict[str, Any],
    legal_entity_id: str,
    transactions: list[sqlite3.Row],
    start_date: str,
    end_date: str,
) -> None:
    booked_rub = [
        row for row in transactions
        if str(row["status"]).strip().lower() == "booked" and str(row["currency"]) == "RUB"
    ]
    operations = list(
        connection.execute(
            """
            SELECT id,operation_date,direction,amount_minor,legal_entity_id,
                   bank_operation_ref,operation_kind,source_system
            FROM financial_operations
            WHERE source_system='BANK_TOCHKA_API'
              AND legal_entity_id=?
              AND operation_date BETWEEN ? AND ?
            ORDER BY id
            """,
            (legal_entity_id, start_date, end_date),
        )
    )
    result["counts"]["booked_rub_transactions"] = len(booked_rub)
    result["counts"]["registry_operations"] = len(operations)

    operation_by_id = {str(row["id"]): row for row in operations}
    operation_ids = set(operation_by_id)
    referenced_ids = {str(row["financial_operation_id"]) for row in booked_rub}
    rows_match = len(operation_by_id) == len(operations) and operation_ids == referenced_ids
    if rows_match:
        for transaction in booked_rub:
            operation = operation_by_id.get(str(transaction["financial_operation_id"]))
            if operation is None or any((
                str(operation["bank_operation_ref"]) != str(transaction["provider_transaction_id"]),
                str(operation["operation_date"]) != str(transaction["operation_date"]),
                str(operation["direction"]) != str(transaction["direction"]),
                int(operation["amount_minor"]) != int(transaction["amount_minor"]),
                str(operation["legal_entity_id"]) != legal_entity_id,
                str(operation["operation_kind"]) != "BANK_STATEMENT",
                str(operation["source_system"]) != "BANK_TOCHKA_API",
            )):
                rows_match = False
                break
    record(result, "bank_registry_one_to_one", rows_match, "bank_registry_rows_do_not_match")

    bank_totals = direction_totals(booked_rub)
    registry_totals = direction_totals(operations)
    receipt_count, bank_receipts = bank_totals["Поступление"]
    outflow_count, bank_outflows = bank_totals["Списание"]
    registry_receipt_count, registry_receipts = registry_totals["Поступление"]
    registry_outflow_count, registry_outflows = registry_totals["Списание"]
    result["counts"].update({
        "receipt_transactions": receipt_count,
        "outflow_transactions": outflow_count,
    })
    result["amounts_minor"].update({
        "bank_receipts": bank_receipts,
        "registry_receipts": registry_receipts,
        "receipt_difference": registry_receipts - bank_receipts,
        "bank_outflows": bank_outflows,
        "registry_outflows": registry_outflows,
        "outflow_difference": registry_outflows - bank_outflows,
    })
    record(
        result,
        "gross_receipts",
        receipt_count == registry_receipt_count and bank_receipts == registry_receipts,
        "gross_receipts_do_not_match",
    )
    record(
        result,
        "gross_outflows",
        outflow_count == registry_outflow_count and bank_outflows == registry_outflows,
        "gross_outflows_do_not_match",
    )
    record(
        result,
        "real_activity",
        receipt_count > 0 and outflow_count > 0 and bank_receipts > 0 and bank_outflows > 0,
        "both_real_receipts_and_outflows_are_required",
    )


def reconcile(connection: sqlite3.Connection, args: argparse.Namespace, min_sync_at: datetime) -> dict[str, Any]:
    result = empty_result(args.start_date, args.end_date)

    after_integrity = check_integrity(connection, "main")
    before_integrity = check_integrity(connection, "baseline")
    after_fk = check_foreign_keys(connection, "main")
    before_fk = check_foreign_keys(connection, "baseline")
    result["counts"]["foreign_key_violations"] = after_fk
    result["counts"]["declared_foreign_keys"] = declared_foreign_key_count(connection, "main")
    record(result, "after_integrity", after_integrity, "after_snapshot_integrity_failed")
    record(result, "before_integrity", before_integrity, "before_snapshot_integrity_failed")
    record(result, "after_foreign_keys", after_fk == 0, "after_snapshot_foreign_key_violations")
    record(result, "before_foreign_keys", before_fk == 0, "before_snapshot_foreign_key_violations")

    if not check_schema_and_baseline(
        connection,
        result,
        args.connection_id,
        args.start_date,
        args.end_date,
        min_sync_at,
    ):
        return result

    accounts = fetch_accounts(connection, args.connection_id)
    result["counts"]["accounts"] = len(accounts)
    account_keys = {
        (str(row["legal_entity_id"]), str(row["provider_account_id"])) for row in accounts
    }
    legal_entities = {str(row["legal_entity_id"]) for row in accounts}
    account_set_ok = (
        len(accounts) == args.expected_accounts
        and len(account_keys) == args.expected_accounts
        and len(legal_entities) == 1
        and all(str(row["provider_account_id"]) and str(row["legal_entity_id"]) for row in accounts)
    )
    record(result, "account_set", account_set_ok, "unexpected_account_set")
    if not account_set_ok:
        return result
    legal_entity_id = next(iter(legal_entities))

    latest_run = connection.execute(
        """
        SELECT id,started_at,finished_at,status,received_count,accepted_count,
               rejected_count,error_count,conflict_count,checkpoint,dry_run
        FROM integration_sync_runs
        WHERE connection_id=? AND dry_run=0
        ORDER BY started_at DESC,id DESC
        LIMIT 1
        """,
        (args.connection_id,),
    ).fetchone()

    latest_statements = fetch_latest_statements(connection, args.connection_id)
    result["counts"]["latest_statements"] = len(latest_statements)
    statement_tx_count = sum(max(0, int(row["transaction_count"])) for row in latest_statements)
    result["counts"]["statement_transactions"] = statement_tx_count

    run_ok = latest_run is not None
    checkpoint_counts = {"accounts": -1, "statements": -1, "transactions": -1}
    run_started_at = ""
    if latest_run is not None:
        run_started_at = str(latest_run["started_at"])
        try:
            started_at = parse_timestamp(run_started_at)
            finished_at = parse_timestamp(str(latest_run["finished_at"]))
        except (TypeError, ValueError):
            run_ok = False
        else:
            run_ok = run_ok and started_at >= min_sync_at and finished_at >= started_at
            baseline_latest_run = connection.execute(
                """
                SELECT id,started_at FROM baseline.integration_sync_runs
                WHERE connection_id=? AND dry_run=0
                ORDER BY started_at DESC,id DESC LIMIT 1
                """,
                (args.connection_id,),
            ).fetchone()
            same_run_in_baseline = scalar(
                connection,
                "SELECT COUNT(*) FROM baseline.integration_sync_runs WHERE id=?",
                (str(latest_run["id"]),),
            )
            run_ok = run_ok and same_run_in_baseline == 0
            if baseline_latest_run is not None:
                try:
                    baseline_started_at = parse_timestamp(str(baseline_latest_run["started_at"]))
                except (TypeError, ValueError):
                    run_ok = False
                else:
                    run_ok = run_ok and started_at > baseline_started_at
        match = CHECKPOINT_RE.fullmatch(str(latest_run["checkpoint"]))
        if match:
            checkpoint_counts = {key: int(value) for key, value in match.groupdict().items()}
        else:
            run_ok = False
        run_values = {
            "received_count": int(latest_run["received_count"]),
            "accepted_count": int(latest_run["accepted_count"]),
            "rejected_count": int(latest_run["rejected_count"]),
            "error_count": int(latest_run["error_count"]),
            "conflict_count": int(latest_run["conflict_count"]),
        }
        result["sync"].update(run_values)
        result["sync"].update({
            "checkpoint_accounts": checkpoint_counts["accounts"],
            "checkpoint_statements": checkpoint_counts["statements"],
            "checkpoint_transactions": checkpoint_counts["transactions"],
        })
        expected_received = args.expected_accounts * 2 + statement_tx_count
        run_ok = run_ok and all((
            str(latest_run["status"]) == "Успешно",
            run_values["received_count"] == expected_received,
            run_values["accepted_count"] == expected_received,
            run_values["rejected_count"] == 0,
            run_values["error_count"] == 0,
            run_values["conflict_count"] == 0,
            checkpoint_counts["accounts"] == args.expected_accounts,
            checkpoint_counts["statements"] == args.expected_accounts,
            checkpoint_counts["transactions"] == statement_tx_count,
        ))
        if args.expected_source_transaction_count is not None:
            run_ok = run_ok and checkpoint_counts["transactions"] == args.expected_source_transaction_count
    record(result, "latest_sync", run_ok, "latest_sync_is_not_a_clean_success")

    current_run_statements = list(
        connection.execute(
            """
            SELECT legal_entity_id,provider_account_id
            FROM bank_statement_imports
            WHERE connection_id=? AND fetched_at=?
              AND start_date=? AND end_date=?
            """,
            (args.connection_id, run_started_at, args.start_date, args.end_date),
        )
    )

    account_by_key = {
        (str(row["legal_entity_id"]), str(row["provider_account_id"])): row for row in accounts
    }
    statement_keys = {
        (str(row["legal_entity_id"]), str(row["provider_account_id"])) for row in latest_statements
    }
    statements_ok = (
        len(latest_statements) == args.expected_accounts
        and statement_keys == set(account_by_key)
        and len(current_run_statements) == args.expected_accounts
        and {
            (str(row["legal_entity_id"]), str(row["provider_account_id"]))
            for row in current_run_statements
        } == set(account_by_key)
        and all(
            str(row["start_date"]) == args.start_date
            and str(row["end_date"]) == args.end_date
            and str(row["status"]).strip().lower() in {"ready", "completed"}
            and int(row["transaction_count"]) >= 0
            and str(row["currency"])
                == str(account_by_key[(str(row["legal_entity_id"]), str(row["provider_account_id"]))]["currency"])
            and account_by_key[(str(row["legal_entity_id"]), str(row["provider_account_id"]))]["balance_minor"] is not None
            and int(account_by_key[(str(row["legal_entity_id"]), str(row["provider_account_id"]))]["balance_minor"])
                == int(row["end_balance_minor"])
            and str(account_by_key[(str(row["legal_entity_id"]), str(row["provider_account_id"]))]["balance_as_of"])
                == str(row["end_date"])
            and str(row["fetched_at"]) == run_started_at
            for row in latest_statements
        )
        and all(str(row["synced_at"]) == run_started_at for row in accounts)
    )
    record(result, "latest_statements", statements_ok, "latest_statements_do_not_match_import")

    account_ids = [str(row["provider_account_id"]) for row in accounts]
    transactions = fetch_window_transactions(
        connection,
        args.connection_id,
        legal_entity_id,
        account_ids,
        args.start_date,
        args.end_date,
    )
    result["counts"]["stored_transactions"] = len(transactions)
    expected_transaction_count = args.expected_source_transaction_count
    stored_by_account = {account_id: 0 for account_id in account_ids}
    for row in transactions:
        stored_by_account[str(row["provider_account_id"])] += 1
    declared_by_account = {
        str(row["provider_account_id"]): int(row["transaction_count"])
        for row in latest_statements
    }
    transaction_count_ok = (
        len(transactions) == statement_tx_count == expected_transaction_count
        and len({str(row["provider_transaction_id"]) for row in transactions}) == len(transactions)
        and stored_by_account == declared_by_account
    )
    record(result, "transaction_counts", transaction_count_ok, "transaction_counts_do_not_match")

    statement_refs = {
        (str(row[0]), str(row[1]))
        for row in connection.execute(
            "SELECT provider_account_id,provider_statement_id FROM bank_statement_imports "
            "WHERE connection_id=? AND legal_entity_id=? AND start_date=? AND end_date=?",
            (args.connection_id, legal_entity_id, args.start_date, args.end_date),
        )
    }
    account_currency = {
        str(row["provider_account_id"]): str(row["currency"]) for row in accounts
    }
    booked_non_rub = 0
    transaction_shape_ok = True
    pending_or_other = 0
    for row in transactions:
        status = str(row["status"]).strip().lower()
        currency = str(row["currency"])
        is_booked = status == "booked"
        if not is_booked:
            pending_or_other += 1
        if is_booked and currency != "RUB":
            booked_non_rub += 1
        should_have_registry_operation = is_booked and currency == "RUB"
        transaction_shape_ok = transaction_shape_ok and all((
            status in {"booked", "pending"},
            str(row["direction"]) in {"Поступление", "Списание"},
            int(row["amount_minor"]) > 0,
            bool(re.fullmatch(r"[A-Z]{3}", currency)),
            currency == account_currency.get(str(row["provider_account_id"]), ""),
            (str(row["provider_account_id"]), str(row["provider_statement_id"])) in statement_refs,
            should_have_registry_operation or not str(row["financial_operation_id"]),
        ))
    result["counts"]["pending_or_other_transactions"] = pending_or_other
    result["counts"]["booked_non_rub_transactions"] = booked_non_rub
    record(result, "transaction_shape", transaction_shape_ok, "unsupported_or_malformed_bank_transactions")

    transactions_by_account: dict[str, list[sqlite3.Row]] = {account_id: [] for account_id in account_ids}
    for row in transactions:
        transactions_by_account[str(row["provider_account_id"])].append(row)
    balance_differences: list[int] = []
    for statement in latest_statements:
        account_id = str(statement["provider_account_id"])
        statement_currency = str(statement["currency"])
        receipts = 0
        outflows = 0
        for transaction in transactions_by_account.get(account_id, []):
            if str(transaction["status"]).strip().lower() != "booked":
                continue
            if str(transaction["currency"]) != statement_currency:
                continue
            if str(transaction["direction"]) == "Поступление":
                receipts += int(transaction["amount_minor"])
            elif str(transaction["direction"]) == "Списание":
                outflows += int(transaction["amount_minor"])
        difference = (
            int(statement["start_balance_minor"])
            + receipts
            - outflows
            - int(statement["end_balance_minor"])
        )
        balance_differences.append(difference)
    result["balances"].update({
        "accounts_checked": len(balance_differences),
        "mismatched_accounts": sum(1 for value in balance_differences if value != 0),
        "max_absolute_difference_minor": max((abs(value) for value in balance_differences), default=0),
    })
    record(
        result,
        "per_account_balances",
        len(balance_differences) == args.expected_accounts and all(value == 0 for value in balance_differences),
        "per_account_balance_equation_failed",
    )

    reconcile_financial_facts(
        connection,
        result,
        legal_entity_id,
        transactions,
        args.start_date,
        args.end_date,
    )
    if all(result["checks"].values()) and not result["failures"]:
        result["status"] = "ok"
    return result


def main(argv: list[str]) -> int:
    try:
        args = parse_args(argv)
    except (TypeError, ValueError):
        result = empty_result()
        add_failure(result, "invalid_arguments")
        emit(result)
        return 2

    result = empty_result(args.start_date, args.end_date)
    try:
        after_path, before_path, min_sync_at = validate_inputs(args)
        with open_snapshots(after_path, before_path) as connection:
            result = reconcile(connection, args, min_sync_at)
    except (OSError, sqlite3.Error, TypeError, ValueError):
        add_failure(result, "snapshot_validation_error")
    except Exception:
        add_failure(result, "internal_validation_error")
    emit(result)
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
