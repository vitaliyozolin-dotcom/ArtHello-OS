#!/usr/bin/env python3
"""Bounded parallel runtime for the Grant Hunter discovery adapter."""
from __future__ import annotations

import importlib.util
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, replace
from datetime import datetime, timezone
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("discovery.py")
SPEC = importlib.util.spec_from_file_location("grant_hunter_discovery_runtime_module", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Cannot load discovery.py")
discovery = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = discovery
SPEC.loader.exec_module(discovery)

MAX_WORKERS = 4
discovery.TIMEOUT_SECONDS = 15
SOURCES = tuple(
    replace(source, max_follow_delta=1, max_follow_full=4)
    for source in discovery.SOURCES
)


def main() -> int:
    args = discovery.parse_args()
    previous = discovery.load_previous_fingerprints(args.previous_report)
    all_candidates: list[discovery.Candidate] = []
    health: list[discovery.SourceHealth] = []
    source_order = {source.id: index for index, source in enumerate(SOURCES)}

    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(SOURCES))) as executor:
        futures = {
            executor.submit(discovery.scan_source, source, args.mode, previous): source
            for source in SOURCES
        }
        for future in as_completed(futures):
            source = futures[future]
            try:
                candidates, source_health = future.result()
            except Exception as exc:
                candidates = []
                source_health = discovery.SourceHealth(
                    source_id=source.id,
                    source_name=source.name,
                    status="FAILED",
                    pages_scanned=0,
                    links_seen=0,
                    candidates_found=0,
                    error=f"unhandled:{type(exc).__name__}:{exc}",
                )
            all_candidates.extend(candidates)
            health.append(source_health)

    health.sort(key=lambda item: source_order.get(item.source_id, 999))

    deduplicated: dict[str, discovery.Candidate] = {}
    for candidate in all_candidates:
        existing = deduplicated.get(candidate.url)
        if existing is None or candidate.discovery_score > existing.discovery_score:
            deduplicated[candidate.url] = candidate

    candidates = list(deduplicated.values())
    generated_at = datetime.now(timezone.utc)
    report = discovery.build_report(candidates, health, args.mode, generated_at)
    args.report.write_text(report, encoding="utf-8")

    payload = {
        "generated_at": generated_at.isoformat(),
        "mode": args.mode,
        "runtime": {
            "max_workers": MAX_WORKERS,
            "timeout_seconds": discovery.TIMEOUT_SECONDS,
            "max_follow_delta": 1,
            "max_follow_full": 4,
        },
        "summary": {
            "sources": len(health),
            "sources_failed": sum(item.status == "FAILED" for item in health),
            "sources_partial": sum(item.status == "PARTIAL" for item in health),
            "candidates": len(candidates),
            "new_candidates": sum(item.is_new for item in candidates),
        },
        "candidates": [
            asdict(item)
            for item in sorted(candidates, key=lambda item: -item.discovery_score)
        ],
        "source_health": [asdict(item) for item in health],
    }
    args.json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    if health and all(item.status == "FAILED" for item in health):
        print("All official sources failed", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
