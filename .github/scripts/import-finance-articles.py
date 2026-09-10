#!/usr/bin/env python3
"""Guarded, resumable import of an approved ArtHello finance article catalog."""

from __future__ import annotations

import hashlib
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol


ALLOWED_REPORTS = {"cashflow", "pnl"}
ALLOWED_DIRECTIONS = {"Поступление", "Списание"}
ALLOWED_GROUPS = {"operating", "investing", "financing", "internal"}
ALLOWED_STATUSES = {"draft", "active", "archived"}
MAX_ARTICLES = 500
FORBIDDEN_PERSONAL_MARKER_HASHES = frozenset({
    "cf9e410c9e5e34f8d1d039be81071fe876cda91f37f3594cbeaef5f91b605da7",
    "55e5e207cf1f9c645db48cac80d445fa41f369a339606023edf1ec46c1dc605a",
    "9b6a3a6bf1ca514db5a34fd8d25b30817ca6a961202f346c8d6a676cea7563d6",
})


class ImportRefused(RuntimeError):
    pass


def normalized_name(value: str) -> str:
    return " ".join(value.strip().casefold().split())


def contains_forbidden_personal_marker(value: str) -> bool:
    normalized = normalized_name(value)
    return any(
        hashlib.sha256(normalized[index:index + 5].encode()).hexdigest() in FORBIDDEN_PERSONAL_MARKER_HASHES
        for index in range(max(0, len(normalized) - 4))
    )


def article_identity(article: dict[str, Any]) -> tuple[str, str]:
    return str(article["report"]), normalized_name(str(article["name"]))


def validate_catalog_document(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ImportRefused("CATALOG_SCHEMA_INVALID")
    source = value.get("source")
    if not isinstance(source, dict) or not re.fullmatch(r"[a-f0-9]{64}", str(source.get("sha256", ""))):
        raise ImportRefused("CATALOG_SOURCE_INVALID")
    if value.get("approvedBy") != "Виталий" or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(value.get("approvedAt", ""))):
        raise ImportRefused("CATALOG_APPROVAL_INVALID")
    raw_articles = value.get("articles")
    if not isinstance(raw_articles, list) or not raw_articles or len(raw_articles) > MAX_ARTICLES:
        raise ImportRefused("CATALOG_SIZE_INVALID")
    keys: set[str] = set()
    identities: set[tuple[str, str]] = set()
    result: list[dict[str, str]] = []
    for raw in raw_articles:
        if not isinstance(raw, dict):
            raise ImportRefused("CATALOG_ARTICLE_INVALID")
        key, name = raw.get("key"), raw.get("name")
        report, direction, group = raw.get("report"), raw.get("direction"), raw.get("group")
        aliases = raw.get("sourceAliases")
        if not isinstance(key, str) or not re.fullmatch(r"[a-z0-9-]{3,80}", key) or key in keys:
            raise ImportRefused("CATALOG_KEY_INVALID")
        if not isinstance(name, str) or not name.strip() or len(name) > 160 or any(ord(char) < 32 for char in name):
            raise ImportRefused("CATALOG_NAME_INVALID")
        if report not in ALLOWED_REPORTS or direction not in ALLOWED_DIRECTIONS or group not in ALLOWED_GROUPS:
            raise ImportRefused("CATALOG_DIMENSION_INVALID")
        if not isinstance(aliases, list) or any(not isinstance(alias, str) or not alias.strip() for alias in aliases):
            raise ImportRefused("CATALOG_ALIAS_INVALID")
        if any(contains_forbidden_personal_marker(alias) for alias in aliases):
            raise ImportRefused("CATALOG_PERSONAL_DATA_INVALID")
        identity = (report, normalized_name(name))
        if identity in identities:
            raise ImportRefused("CATALOG_DUPLICATE_NAME")
        keys.add(key)
        identities.add(identity)
        result.append({"name": " ".join(name.strip().split()), "report": report, "direction": direction, "group": group})
    excluded = value.get("excludedSourceRows")
    if not isinstance(excluded, list) or any(not isinstance(row, dict) or row.get("direction") not in ALLOWED_DIRECTIONS or not row.get("name") or not row.get("reason") for row in excluded):
        raise ImportRefused("CATALOG_EXCLUSIONS_INVALID")
    if any(contains_forbidden_personal_marker(str(row["name"])) for row in excluded):
        raise ImportRefused("CATALOG_PERSONAL_DATA_INVALID")
    mapped_source = {
        (raw["direction"], normalized_name(alias))
        for raw in raw_articles if raw["report"] == "cashflow"
        for alias in raw["sourceAliases"]
    }
    excluded_source = {(row["direction"], normalized_name(row["name"])) for row in excluded}
    if mapped_source & excluded_source or len(mapped_source | excluded_source) != 109:
        raise ImportRefused("CATALOG_SOURCE_COVERAGE_INVALID")
    return result


def catalog_digest(articles: list[dict[str, str]]) -> str:
    canonical = sorted(articles, key=lambda item: (item["report"], normalized_name(item["name"])))
    return hashlib.sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@dataclass(frozen=True)
class ImportPlan:
    already_active: tuple[str, ...]
    approve_drafts: tuple[str, ...]
    create: tuple[str, ...]

    @property
    def changes(self) -> int:
        return len(self.approve_drafts) + len(self.create)


def build_plan(existing: list[dict[str, Any]], desired: list[dict[str, str]]) -> ImportPlan:
    by_identity: dict[tuple[str, str], dict[str, Any]] = {}
    for article in existing:
        if not isinstance(article, dict) or article.get("status") not in ALLOWED_STATUSES:
            raise ImportRefused("PRODUCTION_CATALOG_INVALID")
        identity = article_identity(article)
        if identity in by_identity:
            raise ImportRefused("PRODUCTION_CATALOG_DUPLICATE")
        by_identity[identity] = article
    active: list[str] = []
    drafts: list[str] = []
    create: list[str] = []
    for target in desired:
        current = by_identity.get(article_identity(target))
        if current is None:
            create.append(target["name"])
            continue
        if current.get("direction") != target["direction"] or current.get("group") != target["group"]:
            raise ImportRefused("PRODUCTION_ARTICLE_CONFLICT")
        if current["status"] == "archived":
            raise ImportRefused("PRODUCTION_ARTICLE_ARCHIVED")
        (active if current["status"] == "active" else drafts).append(target["name"])
    return ImportPlan(tuple(active), tuple(drafts), tuple(create))


class CatalogClient(Protocol):
    def catalog(self) -> dict[str, Any]: ...
    def create_verified_backup(self) -> str: ...
    def create_article(self, article: dict[str, str], revision: int) -> dict[str, Any]: ...
    def approve_article(self, article_id: str, revision: int) -> dict[str, Any]: ...
    def logout(self) -> None: ...


def apply_catalog(client: CatalogClient, desired: list[dict[str, str]], apply: bool) -> dict[str, Any]:
    before = client.catalog()
    existing = before.get("articles")
    revision = before.get("revision")
    if not isinstance(existing, list) or not isinstance(revision, int) or revision < 0:
        raise ImportRefused("PRODUCTION_CATALOG_INVALID")
    plan = build_plan(existing, desired)
    result: dict[str, Any] = {
        "desired": len(desired),
        "alreadyActive": len(plan.already_active),
        "draftsToApprove": len(plan.approve_drafts),
        "articlesToCreate": len(plan.create),
        "applied": False,
    }
    if not apply or plan.changes == 0:
        return result
    result["backupId"] = client.create_verified_backup()
    desired_by_identity = {article_identity(article): article for article in desired}
    current = before
    # Stage every missing article as a draft first. A retry resumes from the catalog state.
    for target in desired:
        identity = article_identity(target)
        found = next((item for item in current["articles"] if article_identity(item) == identity), None)
        if found is None:
            current = client.create_article(target, current["revision"])
    # Approval is a separate guarded stage; failures remain resumable and never create duplicates.
    for target in desired:
        identity = article_identity(target)
        found = next((item for item in current["articles"] if article_identity(item) == identity), None)
        if found is None:
            raise ImportRefused("CREATED_ARTICLE_MISSING")
        if found["status"] == "draft":
            current = client.approve_article(str(found["id"]), current["revision"])
        elif found["status"] != "active":
            raise ImportRefused("ARTICLE_NOT_APPROVABLE")
    final = client.catalog()
    final_plan = build_plan(final.get("articles", []), desired)
    if final_plan.changes or len(final_plan.already_active) != len(desired):
        raise ImportRefused("FINAL_CATALOG_INCOMPLETE")
    # Existing unrelated entries are immutable; target drafts may only advance to active.
    final_by_identity = {article_identity(item): item for item in final["articles"]}
    for original in existing:
        final_item = final_by_identity.get(article_identity(original))
        if final_item is None:
            raise ImportRefused("EXISTING_ARTICLE_REMOVED")
        target = desired_by_identity.get(article_identity(original))
        allowed_status = "active" if target and original["status"] == "draft" else original["status"]
        for field in ("id", "name", "report", "direction", "group"):
            if final_item.get(field) != original.get(field):
                raise ImportRefused("EXISTING_ARTICLE_CHANGED")
        if final_item.get("status") != allowed_status:
            raise ImportRefused("EXISTING_ARTICLE_STATUS_CHANGED")
    result.update({"applied": True, "finalRevision": final["revision"], "activeVerified": len(final_plan.already_active)})
    return result


class HttpCatalogClient:
    def __init__(self, origin: str, login: str, password: str, timeout: int = 30):
        parsed = urllib.parse.urlsplit(origin)
        if parsed.scheme != "https" or parsed.hostname != "arthello-188-225-38-55.sslip.io" or parsed.port is not None or parsed.path not in ("", "/"):
            raise ImportRefused("PUBLIC_ORIGIN_INVALID")
        self.origin = origin.rstrip("/")
        self.timeout = timeout
        jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        self.jar = jar
        self._json("POST", "/api/auth/login", {"login": login, "password": password})
        self.csrf = next((cookie.value for cookie in jar if cookie.name == "__Host-arthello_csrf"), "")
        if not self.csrf:
            raise ImportRefused("AUTH_CSRF_MISSING")

    def _json(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        if not path.startswith("/") or "?" in path and not path.startswith("/api/finance?"):
            raise ImportRefused("REQUEST_PATH_INVALID")
        headers = {"accept": "application/json", "origin": self.origin}
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()
            headers.update({"content-type": "application/json", "x-csrf-token": getattr(self, "csrf", "")})
        request = urllib.request.Request(self.origin + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
                if len(raw) > 8 * 1024 * 1024:
                    raise ImportRefused("RESPONSE_TOO_LARGE")
                return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as error:
            error.read(65536)
            raise ImportRefused(f"HTTP_{error.code}") from None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            raise ImportRefused("HTTP_TRANSPORT_FAILED") from None

    def catalog(self) -> dict[str, Any]:
        result = self._json("GET", "/api/finance?period=1900-01")
        catalog = result.get("articleCatalog") if isinstance(result, dict) else None
        if not isinstance(catalog, dict):
            raise ImportRefused("CATALOG_RESPONSE_INVALID")
        return catalog

    def create_verified_backup(self) -> str:
        before = self._json("GET", "/api/settings/backups")
        if not isinstance(before, dict) or before.get("state") == "failed":
            raise ImportRefused("BACKUP_STATUS_INVALID")
        deadline = time.monotonic() + 300
        while before.get("state") == "running" and time.monotonic() < deadline:
            time.sleep(3)
            before = self._json("GET", "/api/settings/backups")
        if before.get("state") != "idle":
            raise ImportRefused("BACKUP_NOT_IDLE")
        prior_ids = {item.get("id") for item in before.get("history", []) if isinstance(item, dict)}
        self._json("POST", "/api/settings/backups", {"action": "create"})
        while time.monotonic() < deadline:
            time.sleep(3)
            status = self._json("GET", "/api/settings/backups")
            if status.get("state") == "failed":
                raise ImportRefused("BACKUP_FAILED")
            if status.get("state") == "idle":
                fresh = [item for item in status.get("history", []) if isinstance(item, dict) and item.get("id") not in prior_ids and item.get("status") == "verified_at_creation"]
                if len(fresh) == 1 and isinstance(fresh[0].get("id"), str):
                    return fresh[0]["id"]
                raise ImportRefused("BACKUP_NOT_VERIFIED")
        raise ImportRefused("BACKUP_TIMEOUT")

    def _catalog_action(self, body: dict[str, Any]) -> dict[str, Any]:
        result = self._json("POST", "/api/finance-actions", body)
        catalog = result.get("catalog") if isinstance(result, dict) else None
        if not isinstance(catalog, dict):
            raise ImportRefused("CATALOG_ACTION_RESPONSE_INVALID")
        return catalog

    def create_article(self, article: dict[str, str], revision: int) -> dict[str, Any]:
        return self._catalog_action({"action": "createArticle", "catalogRevision": revision, **article})

    def approve_article(self, article_id: str, revision: int) -> dict[str, Any]:
        return self._catalog_action({"action": "approveArticle", "catalogRevision": revision, "articleId": article_id})

    def logout(self) -> None:
        try:
            self._json("POST", "/api/auth/logout", {})
        except ImportRefused:
            pass


def main() -> int:
    try:
        if len(sys.argv) != 1:
            raise ImportRefused("ARGUMENTS_NOT_ALLOWED")
        catalog_path = Path(os.environ.get("ARTHELLO_CATALOG_PATH", "docs/finance/article-catalog-2026-09-11.json"))
        desired = validate_catalog_document(json.loads(catalog_path.read_text(encoding="utf-8")))
        apply = os.environ.get("ARTHELLO_IMPORT_APPLY") == "1"
        if not apply:
            print(json.dumps({"status": "validated", "desired": len(desired), "digest": catalog_digest(desired)}, sort_keys=True))
            return 0
        login, password = os.environ.get("ARTHELLO_E2E_LOGIN", ""), os.environ.get("ARTHELLO_E2E_PASSWORD", "")
        if not login or not password:
            raise ImportRefused("CREDENTIALS_REQUIRED")
        client = HttpCatalogClient(os.environ.get("ARTHELLO_PUBLIC_ORIGIN", ""), login, password)
        try:
            result = apply_catalog(client, desired, True)
        finally:
            client.logout()
        result.update({"status": "accepted", "digest": catalog_digest(desired)})
        result.pop("backupId", None)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ImportRefused, OSError, json.JSONDecodeError) as error:
        code = str(error) if isinstance(error, ImportRefused) else "CATALOG_UNAVAILABLE"
        print(json.dumps({"status": "refused", "code": code}, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
