#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace


MODULE_PATH = Path(__file__).with_name("quality.py")
SPEC = importlib.util.spec_from_file_location("grant_hunter_quality", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Cannot load quality.py")
quality = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = quality
SPEC.loader.exec_module(quality)


def candidate(title: str, source_id: str = "lenobl", url: str = "https://official.test/x"):
    return SimpleNamespace(
        title=title,
        source_id=source_id,
        source_name="Official",
        url=url,
        discovery_score=50.0,
        matched_scopes=[],
        matched_support_terms=[],
        evidence_note="",
    )


class QualityTests(unittest.TestCase):
    def test_accreditation_is_rejected(self) -> None:
        self.assertIsNone(quality.qualify(candidate("Аккредитация СМИ")))

    def test_non_financial_contest_is_rejected(self) -> None:
        self.assertIsNone(
            quality.qualify(
                candidate("Конкурс социальной антикоррупционной рекламы")
            )
        )

    def test_personal_svo_grant_is_rejected(self) -> None:
        year = datetime.now(timezone.utc).year
        self.assertIsNone(
            quality.qualify(
                candidate(
                    f"Открыт конкурс грантов {year} для участников СВО на развитие бизнеса"
                )
            )
        )

    def test_current_science_grant_maps_to_aeic(self) -> None:
        year = datetime.now(timezone.utc).year
        result = quality.qualify(
            candidate(
                f"Объявлен конкурс грантов {year} на научно-образовательные проекты",
                source_id="spb_science",
            )
        )
        self.assertIsNotNone(result)
        self.assertIn("AEIC", result.matched_scopes)

    def test_agro_grant_maps_to_agroos(self) -> None:
        year = datetime.now(timezone.utc).year
        result = quality.qualify(
            candidate(
                f"Объявлен отбор получателей гранта «Агромотиватор» {year}",
                source_id="lenobl",
            )
        )
        self.assertIsNotNone(result)
        self.assertIn("AgroOS", result.matched_scopes)

    def test_old_regulation_is_rejected(self) -> None:
        self.assertIsNone(
            quality.qualify(
                candidate(
                    "Постановление 2013 года об утверждении порядка предоставления субсидии на газификацию"
                )
            )
        )

    def test_generic_current_sme_financing_maps_to_portfolio(self) -> None:
        year = datetime.now(timezone.utc).year
        result = quality.qualify(
            candidate(
                f"Открыт прием заявок {year} на льготные микрозаймы для субъектов МСП",
                source_id="msp",
            )
        )
        self.assertIsNotNone(result)
        self.assertEqual(result.matched_scopes, ["Portfolio"])

    def test_duplicate_document_variants_are_collapsed(self) -> None:
        year = datetime.now(timezone.utc).year
        title = f"Объявлен конкурс субсидий {year} для научных проектов"
        first = candidate(title, source_id="spb_science", url="https://x.test/a.pdf")
        second = candidate(title, source_id="spb_science", url="https://x.test/b.pdf")
        result = quality.filter_candidates([first, second])
        self.assertEqual(len(result), 1)


if __name__ == "__main__":
    unittest.main()
