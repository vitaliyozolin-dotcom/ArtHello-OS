#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("discovery.py")
SPEC = importlib.util.spec_from_file_location("grant_hunter_discovery", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Cannot load discovery.py")
discovery = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = discovery
SPEC.loader.exec_module(discovery)


class DiscoveryTests(unittest.TestCase):
    def test_clean_url_removes_tracking_and_fragment(self) -> None:
        actual = discovery.clean_url(
            "/grant?utm_source=test&id=7#section",
            "https://fasie.ru/press/",
        )
        self.assertEqual(actual, "https://fasie.ru/grant?id=7")

    def test_official_domain_accepts_www_variant_but_rejects_foreign(self) -> None:
        self.assertTrue(
            discovery.same_official_domain(
                "https://gov.spb.ru/gov/otrasl/c_science/",
                "https://www.gov.spb.ru/",
            )
        )
        self.assertFalse(
            discovery.same_official_domain(
                "https://example.com/grant",
                "https://www.gov.spb.ru/",
            )
        )

    def test_stale_year_is_not_an_active_candidate(self) -> None:
        current_year = datetime.now(timezone.utc).year
        active, _ = discovery.likely_opportunity(
            f"Конкурс грантов {current_year - 1}",
            "https://fasie.ru/archive",
        )
        self.assertFalse(active)

    def test_current_year_candidate_is_detected(self) -> None:
        current_year = datetime.now(timezone.utc).year
        active, terms = discovery.likely_opportunity(
            f"Открыт прием заявок на конкурс грантов {current_year}",
            "https://fasie.ru/press/fund/current",
        )
        self.assertTrue(active)
        self.assertIn("грант", terms)

    def test_previous_fingerprints_are_loaded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "previous.md"
            path.write_text(
                '<!-- grant-hunter:fingerprints=["abc", "def"] -->',
                encoding="utf-8",
            )
            self.assertEqual(
                discovery.load_previous_fingerprints(path),
                {"abc", "def"},
            )

    def test_report_keeps_discovery_status_conservative(self) -> None:
        candidate = discovery.Candidate(
            fingerprint="abc",
            title="Конкурс грантов",
            url="https://fasie.ru/grant",
            source_id="fasie",
            source_name="Фонд содействия инновациям",
            status="EVIDENCE_PENDING",
            discovery_score=85.0,
            matched_scopes=["Invest Flow"],
            matched_support_terms=["грант"],
            is_new=True,
            evidence_note="test",
        )
        health = discovery.SourceHealth(
            source_id="fasie",
            source_name="Фонд содействия инновациям",
            status="OK",
            pages_scanned=1,
            links_seen=10,
            candidates_found=1,
            error=None,
        )
        report = discovery.build_report(
            [candidate],
            [health],
            "delta",
            datetime.now(timezone.utc),
        )
        self.assertIn("EVIDENCE_PENDING", report)
        self.assertIn("grant-hunter:fingerprints=", report)
        self.assertNotIn("`APPLY` |", report)


if __name__ == "__main__":
    unittest.main()
