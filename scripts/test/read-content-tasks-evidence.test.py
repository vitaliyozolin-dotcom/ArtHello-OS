import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("evidence", Path(__file__).resolve().parents[1] / "read-content-tasks-evidence.py")
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


def receipt():
    return {"kind": "synthetic-content-tasks-scoped", "result": "blocked",
            "stage": "content-empty-1440x900", "harnessBlob": evidence.HARNESS_BLOB,
            "routes": ["content", "tasks"], "viewports": evidence.VIEWPORTS,
            "pngCount": None, "completedCaptures": 2, "taskNumberAssertion": "not_confirmed",
            "savePersistence": "not_tested", "liveAcceptance": "not_run"}


def archive(entries):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as result:
        for name, content in entries:
            result.writestr(name, content)
    return out.getvalue()


class EvidenceTests(unittest.TestCase):
    def test_existing_receipt_is_summarized_without_claiming_capture_or_visual_pass(self):
        raw = archive([("screens/scoped-result.json", json.dumps(receipt())),
                       ("screens/manifest.json", "{\"synthetic_unselected_field\":\"do not print\"}"),
                       ("screens/pilot-content-empty-390x844-full.png", b"synthetic filename fixture only")])
        result = evidence.summarize_zip(raw, hashlib.sha256(raw).hexdigest(), len(raw))
        self.assertEqual(result["stage"], "content-empty-1440x900")
        self.assertEqual(result["completedCaptures"], 2)
        self.assertEqual(result["pngEntries"], 1)
        self.assertFalse(result["screenshotsInspected"])
        self.assertTrue(result["captureRecordsMayPrecedeAssertions"])
        self.assertNotIn("do not print", json.dumps(result))

    def test_untrusted_receipt_fields_cannot_become_diagnostic_output(self):
        for patch in ({"stage": "arbitrary server response"}, {"completedCaptures": True},
                      {"completedCaptures": 11}, {"result": "pass"}, {"pngCount": 14},
                      {"error": "arbitrary sensitive exception text"}):
            with self.assertRaises((ValueError, TypeError)):
                evidence.receipt_summary({**receipt(), **patch})

    def test_wrong_archive_identity_and_unsafe_or_oversized_members_are_rejected(self):
        good = archive([("scoped-result.json", json.dumps(receipt()))])
        with self.assertRaises(ValueError):
            evidence.summarize_zip(good, "0" * 64, len(good))
        for entries in ([('../scoped-result.json', json.dumps(receipt()))],
                        [('scoped-result.json', json.dumps(receipt())), ('other/scoped-result.json', '{}')],
                        [('scoped-result.json', ' ' * 8193)], [('unexpected.txt', 'private fixture')]):
            raw = archive(entries)
            with self.assertRaises((ValueError, KeyError)):
                evidence.summarize_zip(raw, hashlib.sha256(raw).hexdigest(), len(raw))

    def test_cli_reports_only_fixed_validation_failure(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = evidence.main(["/absent/synthetic-private-marker"])
        self.assertEqual(result, 1)
        self.assertEqual(json.loads(output.getvalue())["reason"], "evidence_validation_failed")
        self.assertNotIn("synthetic-private-marker", output.getvalue())

    def test_optimized_cli_still_rejects_a_different_zip_of_the_pinned_size(self):
        png_name = "pilot-content-empty-390x844-full.png"
        entries = [("scoped-result.json", json.dumps(receipt())), (png_name, b"")]
        padding = evidence.EXPECTED_BYTES - len(archive(entries))
        raw = archive([entries[0], (png_name, b"x" * padding)])
        self.assertEqual(len(raw), evidence.EXPECTED_BYTES)
        with tempfile.TemporaryDirectory() as temporary:
            file = Path(temporary) / "synthetic-private-marker.zip"
            file.write_bytes(raw)
            result = subprocess.run([sys.executable, "-O", evidence.__file__, str(file)],
                                    capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout), {
            "kind": "existing-synthetic-visual-evidence", "result": "blocked",
            "reason": "evidence_validation_failed"})
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
