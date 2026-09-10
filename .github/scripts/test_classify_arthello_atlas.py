import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("classify-arthello-atlas.py")
SPEC = importlib.util.spec_from_file_location("classify_arthello_atlas", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def operation(description, **overrides):
    value = {
        "id": "op-1", "period": "2026-09", "direction": "Поступление",
        "sourceSystem": "BANK_TOCHKA_API", "cashflowArticle": "",
        "category": "Не классифицировано", "pnlArticle": "",
        "reportClass": "Не включено в ОПиУ", "accrualPeriod": "",
        "objectEntityId": "", "updatedAt": "2026-09-10T00:00:00.000Z",
        "bankDetails": {"currency": "RUB", "description": description},
    }
    value.update(overrides)
    return value


class AtlasClassificationTests(unittest.TestCase):
    def test_explicit_school_and_kindergarten_income_are_planned(self):
        school = MODULE.plan_operation(operation("Оплата обучения в школе Атлас"), "2026-09")
        kindergarten = MODULE.plan_operation(operation("Оплата за детский сад"), "2026-09")
        self.assertEqual((school.branch_id, school.cashflow_article, school.pnl_article),
                         ("BR-ATLAS-SCHOOL", "Оплата школы", "Выручка школы"))
        self.assertEqual((kindergarten.branch_id, kindergarten.cashflow_article, kindergarten.pnl_article),
                         ("BR-KINDERGARTEN", "Оплата детского сада", "Выручка детского сада"))

    def test_ambiguous_or_non_income_rows_are_never_planned(self):
        for row in (
            operation("Оплата Атлас"),
            operation("Оплата садика и школы"),
            operation("Оплата школы", direction="Списание"),
            operation("Оплата школы", sourceSystem="MANUAL"),
            operation("Оплата школы", cashflowArticle="Оплата школы"),
        ):
            self.assertIsNone(MODULE.plan_operation(row, "2026-09"))

    def test_payload_preserves_management_dimensions_and_uses_concurrency_guards(self):
        row = operation("Оплата школы", counterpartyLabel="Клиент", managementPurpose="Комментарий")
        plan = MODULE.plan_operation(row, "2026-09")
        payload = MODULE.classification_payload(row, plan, 288)
        self.assertEqual(payload["action"], "classifyOperation")
        self.assertEqual(payload["catalogRevision"], 288)
        self.assertEqual(payload["expectedUpdatedAt"], row["updatedAt"])
        self.assertEqual(payload["counterpartyLabel"], "Клиент")
        self.assertEqual(payload["managementPurpose"], "Комментарий")
        self.assertEqual(payload["objectEntityId"], "BR-ATLAS-SCHOOL")
        self.assertEqual(payload["reportClass"], "Доходы ОПиУ")
        self.assertEqual(payload["accrualPeriod"], "2026-09")


if __name__ == "__main__":
    unittest.main()
