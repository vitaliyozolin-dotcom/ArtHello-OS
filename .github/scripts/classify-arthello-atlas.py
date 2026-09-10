#!/usr/bin/env python3
"""Classify only explicit Atlas school/kindergarten receipts; refuse ambiguity."""

from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class ClassificationRefused(RuntimeError):
    pass


@dataclass(frozen=True)
class AllocationPlan:
    branch_id: str
    cashflow_article: str
    pnl_article: str


def normalized(value: Any) -> str:
    return " ".join(str(value or "").casefold().replace("ё", "е").split())


def plan_operation(operation: dict[str, Any], period: str) -> AllocationPlan | None:
    bank = operation.get("bankDetails")
    if not isinstance(bank, dict):
        return None
    if (
        operation.get("period") != period
        or operation.get("direction") != "Поступление"
        or operation.get("sourceSystem") != "BANK_TOCHKA_API"
        or bank.get("currency") != "RUB"
        or operation.get("cashflowArticle")
        or operation.get("pnlArticle")
        or operation.get("objectEntityId")
        or operation.get("category") not in (None, "", "Не классифицировано")
    ):
        return None
    purpose = normalized(bank.get("description"))
    school = "школ" in purpose
    kindergarten = bool(re.search(r"(?:^|\W)(?:детск\w*\s+сад\w*|детсад\w*|садик\w*|дошкол\w*)", purpose))
    if school == kindergarten:
        return None
    if school:
        return AllocationPlan("BR-ATLAS-SCHOOL", "Оплата школы", "Выручка школы")
    return AllocationPlan("BR-KINDERGARTEN", "Оплата детского сада", "Выручка детского сада")


def classification_payload(operation: dict[str, Any], plan: AllocationPlan, revision: int) -> dict[str, Any]:
    return {
        "action": "classifyOperation",
        "operationId": operation["id"],
        "catalogRevision": revision,
        "expectedUpdatedAt": operation["updatedAt"],
        "cashflowArticle": plan.cashflow_article,
        "pnlArticle": plan.pnl_article,
        "reportClass": "Доходы ОПиУ",
        "accrualPeriod": operation["period"],
        "counterpartyLabel": operation.get("counterpartyLabel", ""),
        "managementPurpose": operation.get("managementPurpose", ""),
        "contractId": operation.get("contractId", ""),
        "documentId": operation.get("documentId", ""),
        "projectEntityId": operation.get("projectEntityId", ""),
        "objectEntityId": plan.branch_id,
        "cfrEntityId": operation.get("cfrEntityId", ""),
    }


def load_importer():
    path = Path(__file__).with_name("import-finance-articles.py")
    spec = importlib.util.spec_from_file_location("finance_article_import_runtime", path)
    if not spec or not spec.loader:
        raise ClassificationRefused("IMPORT_CLIENT_UNAVAILABLE")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def require_arthello_snapshot(snapshot: dict[str, Any], period: str) -> tuple[list[dict[str, Any]], int]:
    accounts = snapshot.get("bankAccounts")
    names = snapshot.get("entityNames")
    catalog = snapshot.get("articleCatalog")
    operations = snapshot.get("operations")
    if not isinstance(accounts, list) or len(accounts) != 4 or not isinstance(names, dict):
        raise ClassificationRefused("ACCOUNT_SCOPE_CHANGED")
    legal_names = {normalized(names.get(account.get("legalEntityId"))) for account in accounts if isinstance(account, dict)}
    if legal_names != {"ооо артхелло"}:
        raise ClassificationRefused("LEGAL_ENTITY_SCOPE_CHANGED")
    if not isinstance(catalog, dict) or not isinstance(catalog.get("revision"), int) or not isinstance(catalog.get("articles"), list):
        raise ClassificationRefused("CATALOG_INVALID")
    required = {
        ("cashflow", "Оплата школы", "Поступление"),
        ("pnl", "Выручка школы", "Поступление"),
        ("cashflow", "Оплата детского сада", "Поступление"),
        ("pnl", "Выручка детского сада", "Поступление"),
    }
    active = {(item.get("report"), item.get("name"), item.get("direction")) for item in catalog["articles"] if isinstance(item, dict) and item.get("status") == "active"}
    if not required.issubset(active):
        raise ClassificationRefused("REQUIRED_ARTICLES_INACTIVE")
    if not isinstance(operations, list):
        raise ClassificationRefused("OPERATIONS_INVALID")
    return operations, catalog["revision"]


def main() -> int:
    client = None
    try:
        if len(sys.argv) != 1:
            raise ClassificationRefused("ARGUMENTS_NOT_ALLOWED")
        period = os.environ.get("ARTHELLO_CLASSIFY_PERIOD", "")
        if not re.fullmatch(r"\d{4}-(?:0[1-9]|1[0-2])", period):
            raise ClassificationRefused("PERIOD_REQUIRED")
        apply = os.environ.get("ARTHELLO_CLASSIFY_APPLY") == "1"
        importer = load_importer()
        login, password = os.environ.get("ARTHELLO_E2E_LOGIN", ""), os.environ.get("ARTHELLO_E2E_PASSWORD", "")
        if not login or not password:
            raise ClassificationRefused("CREDENTIALS_REQUIRED")
        client = importer.HttpCatalogClient(os.environ.get("ARTHELLO_PUBLIC_ORIGIN", ""), login, password)
        snapshot = client._json("GET", f"/api/finance?period={period}")
        if not isinstance(snapshot, dict):
            raise ClassificationRefused("FINANCE_RESPONSE_INVALID")
        operations, revision = require_arthello_snapshot(snapshot, period)
        plans = [(row, plan_operation(row, period)) for row in operations if isinstance(row, dict)]
        planned = [(row, plan) for row, plan in plans if plan is not None]
        by_branch = {
            "atlasKindergarten": sum(plan.branch_id == "BR-KINDERGARTEN" for _, plan in planned),
            "atlasSchool": sum(plan.branch_id == "BR-ATLAS-SCHOOL" for _, plan in planned),
        }
        if apply and planned:
            client.create_verified_backup()
            for row, plan in planned:
                result = client._json("POST", "/api/finance-actions", classification_payload(row, plan, revision))
                updated = result.get("operation") if isinstance(result, dict) else None
                if not isinstance(updated, dict) or updated.get("objectEntityId") != plan.branch_id or updated.get("cashflowArticle") != plan.cashflow_article or updated.get("pnlArticle") != plan.pnl_article:
                    raise ClassificationRefused("CLASSIFICATION_NOT_VERIFIED")
        print(json.dumps({"status": "accepted" if apply else "validated", "period": period, "planned": len(planned), "applied": len(planned) if apply else 0, **by_branch}, sort_keys=True))
        return 0
    except Exception as error:
        safe = str(error) if isinstance(error, ClassificationRefused) else getattr(error, "args", ["CLASSIFICATION_FAILED"])[0]
        if not isinstance(safe, str) or not re.fullmatch(r"[A-Z0-9_]+", safe):
            safe = "CLASSIFICATION_FAILED"
        print(json.dumps({"status": "refused", "code": safe}, sort_keys=True))
        return 2
    finally:
        if client is not None:
            client.logout()


if __name__ == "__main__":
    raise SystemExit(main())
