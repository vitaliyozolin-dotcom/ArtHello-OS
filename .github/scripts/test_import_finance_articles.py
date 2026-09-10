import importlib.util
import json
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("import-finance-articles.py")
SPEC = importlib.util.spec_from_file_location("finance_article_import", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def article(name="Статья A", report="cashflow", direction="Списание", group="operating"):
    return {"name": name, "report": report, "direction": direction, "group": group}


class FakeClient:
    def __init__(self, articles=None):
        self.value = {"schema": 1, "revision": 1 if articles else 0, "articles": list(articles or [])}
        self.backups = 0
        self.created = 0
        self.approved = 0

    def catalog(self):
        return json.loads(json.dumps(self.value))

    def create_verified_backup(self):
        self.backups += 1
        return "verified-backup"

    def create_article(self, target, revision):
        if revision != self.value["revision"]:
            raise AssertionError("stale revision")
        self.created += 1
        self.value["revision"] += 1
        self.value["articles"].append({"id": f"created-{self.created}", "status": "draft", **target})
        return self.catalog()

    def approve_article(self, article_id, revision):
        if revision != self.value["revision"]:
            raise AssertionError("stale revision")
        self.approved += 1
        match = next(item for item in self.value["articles"] if item["id"] == article_id)
        if match["status"] != "draft":
            raise AssertionError("not draft")
        match["status"] = "active"
        self.value["revision"] += 1
        return self.catalog()

    def logout(self):
        pass


class CatalogImportTests(unittest.TestCase):
    def test_approved_catalog_is_complete_and_unique(self):
        path = Path(__file__).parents[2] / "docs/finance/article-catalog-2026-09-11.json"
        raw = path.read_text(encoding="utf-8")
        self.assertFalse(MODULE.contains_forbidden_personal_marker(raw))
        desired = MODULE.validate_catalog_document(json.loads(raw))
        self.assertEqual(len(desired), 148)
        self.assertEqual(len({MODULE.article_identity(item) for item in desired}), 148)
        self.assertTrue({
            ("cashflow", "Оплата управленческих услуг", "Поступление"),
            ("pnl", "Выручка от управленческих услуг", "Поступление"),
            ("cashflow", "Оплата организации праздников", "Поступление"),
            ("pnl", "Выручка от организации праздников", "Поступление"),
        }.issubset({(item["report"], item["name"], item["direction"]) for item in desired}))
        self.assertRegex(MODULE.catalog_digest(desired), r"^[a-f0-9]{64}$")

    def test_import_stages_drafts_then_approves_and_is_idempotent(self):
        desired = [article(), article("Статья Б", "pnl")]
        client = FakeClient()
        result = MODULE.apply_catalog(client, desired, True)
        self.assertEqual((result["articlesToCreate"], result["activeVerified"]), (2, 2))
        self.assertEqual((client.backups, client.created, client.approved), (1, 2, 2))
        second = MODULE.apply_catalog(client, desired, True)
        self.assertEqual((second["alreadyActive"], second["articlesToCreate"], second["applied"]), (2, 0, False))
        self.assertEqual((client.backups, client.created, client.approved), (1, 2, 2))

    def test_matching_draft_resumes_without_duplicate(self):
        client = FakeClient([{"id": "draft-a", "status": "draft", **article()}])
        result = MODULE.apply_catalog(client, [article()], True)
        self.assertEqual((result["draftsToApprove"], client.created, client.approved), (1, 0, 1))

    def test_conflict_or_archive_refuses_before_backup(self):
        for stored in (
            {"id": "a", "status": "active", **article(group="financing")},
            {"id": "a", "status": "archived", **article()},
        ):
            client = FakeClient([stored])
            with self.assertRaises(MODULE.ImportRefused):
                MODULE.apply_catalog(client, [article()], True)
            self.assertEqual(client.backups, 0)

    def test_dry_run_has_no_side_effects(self):
        client = FakeClient()
        result = MODULE.apply_catalog(client, [article()], False)
        self.assertEqual((result["articlesToCreate"], result["applied"]), (1, False))
        self.assertEqual((client.backups, client.created, client.approved), (0, 0, 0))


if __name__ == "__main__":
    unittest.main()
