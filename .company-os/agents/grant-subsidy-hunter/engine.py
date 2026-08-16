#!/usr/bin/env python3
"""
Grant & Subsidy Hunter decision engine.

Reads one opportunity JSON file and prints a normalized decision:
APPLY, WATCH, REJECT or EVIDENCE_PENDING.

This module does not discover grants by itself. Discovery adapters must provide
evidence-backed opportunity records that conform to the agent specification.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple


REQUIRED_FIELDS = {
    "id",
    "program_name",
    "operator",
    "source",
    "deadline",
    "award_amount_rub",
    "mandatory_cofinancing_rub",
    "preparation_cost_rub",
    "compliance_cost_rub",
    "probability_of_success",
    "eligibility_confidence",
    "strategic_fit_score",
    "time_to_cash_score",
    "preparation_ease_score",
    "reuse_score",
    "critical_eligibility_checks",
}


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def parse_deadline(value: str) -> date:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).date()


def validate(data: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    missing = sorted(REQUIRED_FIELDS - data.keys())
    if missing:
        errors.append("missing_fields: " + ", ".join(missing))

    source = data.get("source", {})
    if source.get("trust_level") not in {"official_primary", "official_operator"}:
        errors.append("source_not_official")
    if not source.get("url"):
        errors.append("source_url_missing")
    if not source.get("captured_at"):
        errors.append("source_capture_time_missing")

    probability = data.get("probability_of_success")
    if probability is not None and not 0 <= float(probability) <= 1:
        errors.append("probability_of_success_must_be_0_to_1")

    for field in (
        "eligibility_confidence",
        "strategic_fit_score",
        "time_to_cash_score",
        "preparation_ease_score",
        "reuse_score",
    ):
        if field in data and not 0 <= float(data[field]) <= 100:
            errors.append(f"{field}_must_be_0_to_100")

    return errors


def evaluate_checks(checks: List[Dict[str, Any]]) -> Tuple[List[str], List[str]]:
    failed: List[str] = []
    unknown: List[str] = []
    for check in checks:
        name = str(check.get("name", "unnamed_check"))
        status = check.get("status")
        if status is False:
            failed.append(name)
        elif status is None or status == "unknown":
            unknown.append(name)
    return failed, unknown


def calculate(data: Dict[str, Any], as_of: date) -> Dict[str, Any]:
    validation_errors = validate(data)
    if validation_errors:
        return {
            "id": data.get("id"),
            "decision": "EVIDENCE_PENDING",
            "score": 0,
            "validation_errors": validation_errors,
            "next_action": "Complete evidence and required fields before eligibility scoring.",
        }

    deadline = parse_deadline(str(data["deadline"]))
    if deadline < as_of:
        return {
            "id": data["id"],
            "decision": "REJECT",
            "score": 0,
            "reason": "deadline_expired",
            "deadline": deadline.isoformat(),
        }

    failed_checks, unknown_checks = evaluate_checks(data["critical_eligibility_checks"])
    if failed_checks:
        return {
            "id": data["id"],
            "decision": "REJECT",
            "score": 0,
            "reason": "critical_eligibility_failed",
            "failed_checks": failed_checks,
        }

    award = float(data["award_amount_rub"])
    cofinancing = float(data["mandatory_cofinancing_rub"])
    preparation = float(data["preparation_cost_rub"])
    compliance = float(data["compliance_cost_rub"])
    probability = float(data["probability_of_success"])
    cost_of_capital_rate = float(data.get("cofinancing_cost_rate", 0.20))

    expected_value = (
        award * probability
        - preparation
        - compliance
        - cofinancing * cost_of_capital_rate
    )
    expected_value_ratio = expected_value / award if award > 0 else -1
    expected_value_score = clamp(expected_value_ratio * 100)

    score = round(
        float(data["eligibility_confidence"]) * 0.25
        + float(data["strategic_fit_score"]) * 0.20
        + expected_value_score * 0.20
        + probability * 100 * 0.15
        + float(data["time_to_cash_score"]) * 0.10
        + float(data["preparation_ease_score"]) * 0.05
        + float(data["reuse_score"]) * 0.05,
        1,
    )

    days_left = (deadline - as_of).days

    if unknown_checks:
        decision = "EVIDENCE_PENDING"
        next_action = "Resolve critical unknowns: " + ", ".join(unknown_checks)
    elif expected_value <= 0:
        decision = "REJECT"
        next_action = "Do not apply: expected value is non-positive."
    elif score >= 75 and days_left >= 7:
        decision = "APPLY"
        next_action = "Open application workstream and obtain human approval."
    elif score >= 50:
        decision = "WATCH"
        next_action = "Close eligibility/economics gaps or wait for the next round."
    else:
        decision = "REJECT"
        next_action = "Archive with reason and retain learnings."

    return {
        "id": data["id"],
        "program_name": data["program_name"],
        "decision": decision,
        "score": score,
        "deadline": deadline.isoformat(),
        "days_left": days_left,
        "expected_value_rub": round(expected_value, 2),
        "unknown_checks": unknown_checks,
        "next_action": next_action,
        "evidence": {
            "operator": data["operator"],
            "source_url": data["source"]["url"],
            "captured_at": data["source"]["captured_at"],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("opportunity", type=Path)
    parser.add_argument("--as-of", default=date.today().isoformat())
    args = parser.parse_args()

    try:
        payload = json.loads(args.opportunity.read_text(encoding="utf-8"))
        as_of = date.fromisoformat(args.as_of)
        result = calculate(payload, as_of)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False, indent=2))
        return 2

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
