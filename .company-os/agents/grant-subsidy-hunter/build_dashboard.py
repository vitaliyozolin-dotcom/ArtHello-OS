#!/usr/bin/env python3
"""Build the Company OS Grant Hunter dashboard from discovery output.

The build is deliberately privacy-preserving: project keys are mapped to
anonymized portfolio profiles and no legal identifiers or person-level data are
written to the public/static artifact.
"""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

STATUS_LABELS = {
    "CONFIRMED_OPEN": "Подтверждён приём",
    "VERIFY_DEADLINE": "Проверить дедлайн",
    "DATA_REQUIRED": "Нужны данные",
    "WATCH": "Наблюдение",
    "ARCHIVED": "Архив",
    "SOURCE_UNAVAILABLE": "Источник недоступен",
}
DECISION_LABELS = {
    "APPLY": "Рекомендовано",
    "WATCH": "Наблюдение",
    "REJECT": "Не подходит",
    "EVIDENCE_PENDING": "Требует проверки",
}


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def select_override(title: str, overrides: list[dict[str, Any]]) -> dict[str, Any] | None:
    lowered = title.casefold()
    for override in overrides:
        needle = str(override.get("match_title_contains", "")).casefold().strip()
        if needle and needle in lowered:
            return override
    return None


def anonymize_scopes(
    raw_scopes: list[str],
    profile_by_key: dict[str, dict[str, Any]],
) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for scope in raw_scopes:
        profile = profile_by_key.get(scope)
        if not profile:
            continue
        result.append(
            {
                "id": profile["id"],
                "name": profile["display_name"],
                "subtitle": profile["subtitle"],
            }
        )
    return result


def priority_for(score: float, operational_status: str) -> str:
    if operational_status == "ARCHIVED":
        return "archived"
    if operational_status == "CONFIRMED_OPEN" and score >= 75:
        return "critical"
    if score >= 80:
        return "high"
    if score >= 65:
        return "medium"
    return "low"


def safe_url(value: Any) -> str:
    url = str(value or "").strip()
    return url if url.startswith(("https://", "http://")) else ""


def build_opportunity(
    candidate: dict[str, Any],
    profile_by_key: dict[str, dict[str, Any]],
    overrides: list[dict[str, Any]],
    as_of: date,
) -> dict[str, Any]:
    title = str(candidate.get("title") or "Без названия")
    override = select_override(title, overrides) or {}
    score = float(candidate.get("discovery_score") or 0)
    operational_status = str(override.get("operational_status") or "VERIFY_DEADLINE")
    decision = str(override.get("decision") or "EVIDENCE_PENDING")
    deadline = override.get("deadline")
    days_left: int | None = None
    if deadline:
        try:
            days_left = (date.fromisoformat(str(deadline)) - as_of).days
        except ValueError:
            deadline = None
    if days_left is not None and days_left < 0:
        operational_status = "ARCHIVED"
        decision = "REJECT"

    scopes = anonymize_scopes(
        [str(item) for item in candidate.get("matched_scopes", [])],
        profile_by_key,
    )
    missing_profile_data: list[str] = []
    for scope in scopes:
        profile = next(
            (item for item in profile_by_key.values() if item["id"] == scope["id"]),
            None,
        )
        if profile:
            missing_profile_data.extend(profile.get("missing", []))

    return {
        "id": str(candidate.get("fingerprint") or "unknown"),
        "title": title,
        "official_url": safe_url(candidate.get("url")),
        "source_id": str(candidate.get("source_id") or "unknown"),
        "source_name": str(candidate.get("source_name") or "Неизвестный источник"),
        "score": round(score, 1),
        "priority": priority_for(score, operational_status),
        "operational_status": operational_status,
        "operational_status_label": STATUS_LABELS.get(operational_status, operational_status),
        "decision": decision,
        "decision_label": DECISION_LABELS.get(decision, decision),
        "deadline": deadline,
        "days_left": days_left,
        "deadline_confidence": str(override.get("deadline_confidence") or "unknown"),
        "portfolios": scopes,
        "matched_terms": [str(item) for item in candidate.get("matched_support_terms", [])],
        "is_new": bool(candidate.get("is_new")),
        "eligibility_note": str(
            override.get("eligibility_note")
            or "Для решения нужны официальный документ программы, подтверждённый дедлайн и проверенный профиль заявителя."
        ),
        "verification_note": str(
            override.get("verification_note")
            or candidate.get("evidence_note")
            or "Автоматическая находка; применимость не подтверждена."
        ),
        "missing_profile_data": sorted(set(missing_profile_data))[:8],
        "data_mode": "anonymized_precheck",
        "can_apply": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidates", type=Path, required=True)
    parser.add_argument("--profiles", type=Path, required=True)
    parser.add_argument("--overrides", type=Path, required=True)
    parser.add_argument("--ui-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    scan = read_json(args.candidates)
    profile_doc = read_json(args.profiles)
    override_doc = read_json(args.overrides)
    profiles = list(profile_doc.get("profiles", []))
    profile_by_key = {str(item["portfolio_key"]): item for item in profiles}
    overrides = list(override_doc.get("overrides", []))
    generated_at = datetime.now(timezone.utc)
    as_of = generated_at.date()

    opportunities = [
        build_opportunity(item, profile_by_key, overrides, as_of)
        for item in scan.get("candidates", [])
    ]
    opportunities.sort(
        key=lambda item: (
            item["operational_status"] == "ARCHIVED",
            -float(item["score"]),
            item["title"],
        )
    )

    source_health = []
    for source in scan.get("source_health", []):
        status = str(source.get("status") or "UNKNOWN")
        source_health.append(
            {
                "id": str(source.get("source_id") or "unknown"),
                "name": str(source.get("source_name") or "Неизвестный источник"),
                "status": status,
                "status_label": {
                    "OK": "Работает",
                    "PARTIAL": "Частично",
                    "FAILED": "Недоступен",
                }.get(status, "Неизвестно"),
                "pages_scanned": int(source.get("pages_scanned") or 0),
                "links_seen": int(source.get("links_seen") or 0),
                "candidates_found": int(source.get("candidates_found") or 0),
                "error": str(source.get("error") or ""),
            }
        )

    working_sources = sum(item["status"] in {"OK", "PARTIAL"} for item in source_health)
    active = [item for item in opportunities if item["operational_status"] != "ARCHIVED"]
    confirmed_open = [item for item in active if item["operational_status"] == "CONFIRMED_OPEN"]
    high_priority = [item for item in active if item["priority"] in {"critical", "high"}]
    data_required = [
        item
        for item in active
        if item["operational_status"] in {"DATA_REQUIRED", "VERIFY_DEADLINE"}
    ]

    payload = {
        "meta": {
            "product": "Company OS",
            "module": "Гранты и субсидии",
            "environment": "production",
            "data_mode": "anonymized",
            "read_only": True,
            "generated_at": generated_at.isoformat(),
            "scan_generated_at": scan.get("generated_at"),
            "scan_mode": scan.get("mode"),
            "notice": "Боевой поиск работает на публичных источниках. Профили заявителей обезличены, поэтому APPLY и подача заблокированы до подключения проверенных данных."
        },
        "summary": {
            "opportunities": len(active),
            "confirmed_open": len(confirmed_open),
            "high_priority": len(high_priority),
            "data_required": len(data_required),
            "archived": len(opportunities) - len(active),
            "sources_total": len(source_health),
            "sources_working": working_sources,
            "source_coverage_percent": round(
                working_sources / len(source_health) * 100 if source_health else 0
            )
        },
        "opportunities": opportunities,
        "profiles": profiles,
        "source_health": source_health,
        "scan_summary": scan.get("summary", {})
    }

    args.output.mkdir(parents=True, exist_ok=True)
    for filename in ("index.html", "styles.css", "app.js"):
        shutil.copy2(args.ui_dir / filename, args.output / filename)
    (args.output / ".nojekyll").write_text("", encoding="utf-8")
    (args.output / "data.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "opportunities": len(active),
                "confirmed_open": len(confirmed_open),
                "archived": len(opportunities) - len(active),
                "sources_working": working_sources,
                "output": str(args.output)
            },
            ensure_ascii=False
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
