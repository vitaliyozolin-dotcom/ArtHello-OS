#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUILDER = ROOT / "build_dashboard.py"


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        ui = root / "ui"
        ui.mkdir()
        for name in ("index.html", "styles.css", "app.js"):
            (ui / name).write_text(name, encoding="utf-8")
        candidates = root / "candidates.json"
        candidates.write_text(
            json.dumps(
                {
                    "generated_at": "2026-08-16T00:00:00Z",
                    "mode": "full",
                    "summary": {},
                    "candidates": [
                        {
                            "fingerprint": "1",
                            "title": "Приказ об отборе получателей гранта Ленинградский агромотиватор",
                            "url": "https://example.gov/program",
                            "source_id": "official",
                            "source_name": "Официальный источник",
                            "status": "EVIDENCE_PENDING",
                            "discovery_score": 92,
                            "matched_scopes": ["AgroOS"],
                            "matched_support_terms": ["грант"],
                            "is_new": True,
                            "evidence_note": "official"
                        }
                    ],
                    "source_health": [
                        {
                            "source_id": "official",
                            "source_name": "Официальный источник",
                            "status": "OK",
                            "pages_scanned": 1,
                            "links_seen": 2,
                            "candidates_found": 1,
                            "error": None
                        }
                    ]
                },
                ensure_ascii=False
            ),
            encoding="utf-8"
        )
        profiles = root / "profiles.json"
        profiles.write_text(
            json.dumps(
                {
                    "profiles": [
                        {
                            "id": "anonymous",
                            "portfolio_key": "AgroOS",
                            "display_name": "Портфель C",
                            "subtitle": "Агротехнологии",
                            "missing": ["ИНН"]
                        }
                    ]
                },
                ensure_ascii=False
            ),
            encoding="utf-8"
        )
        overrides = root / "overrides.json"
        overrides.write_text(
            json.dumps(
                {
                    "overrides": [
                        {
                            "match_title_contains": "Ленинградский агромотиватор",
                            "operational_status": "ARCHIVED",
                            "decision": "REJECT",
                            "deadline": "2026-05-12"
                        }
                    ]
                },
                ensure_ascii=False
            ),
            encoding="utf-8"
        )
        output = root / "site"
        subprocess.run(
            [
                sys.executable,
                str(BUILDER),
                "--candidates",
                str(candidates),
                "--profiles",
                str(profiles),
                "--overrides",
                str(overrides),
                "--ui-dir",
                str(ui),
                "--output",
                str(output)
            ],
            check=True
        )
        data = json.loads((output / "data.json").read_text(encoding="utf-8"))
        item = data["opportunities"][0]
        assert item["operational_status"] == "ARCHIVED"
        assert item["can_apply"] is False
        assert item["portfolios"][0]["name"] == "Портфель C"
        serialized = json.dumps(data, ensure_ascii=False)
        assert "AgroOS project entity" not in serialized
        assert "ИНН" in serialized
        assert data["meta"]["data_mode"] == "anonymized"
        assert data["summary"]["confirmed_open"] == 0
        assert (output / "index.html").exists()
    print("dashboard tests: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
