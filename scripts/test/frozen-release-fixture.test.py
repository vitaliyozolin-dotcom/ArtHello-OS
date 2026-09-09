import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("fixture", Path(__file__).resolve().parents[1] / "run-frozen-release-contract.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

class FixtureTests(unittest.TestCase):
    def repository(self, root):
        def git(*args):
            return subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True).stdout.decode().strip()
        git("init", "-q")
        git("config", "user.email", "synthetic@example.invalid")
        git("config", "user.name", "Synthetic Test")
        (root / ".github/workflows").mkdir(parents=True)
        (root / ".github/workflows/retired.yml").write_text("name: archived\n")
        (root / ".github/workflows/quality.yml").write_text("name: historical\n")
        (root / "current.py").write_text("old code\n")
        (root / "removed.py").write_text("must stay removed\n")
        git("add", ".")
        git("commit", "-qm", "baseline")
        baseline = git("rev-parse", "HEAD")
        (root / ".github/workflows/retired.yml").unlink()
        (root / ".github/workflows/quality.yml").write_text("name: active\n")
        (root / "current.py").write_text("current code\n")
        (root / "removed.py").unlink()
        git("add", "-A")
        git("commit", "-qm", "current")
        return git, baseline

    def test_current_code_and_deletions_with_archived_inputs_leave_checkout_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"; root.mkdir()
            target = Path(directory) / "fixture"; target.mkdir()
            git, baseline = self.repository(root)
            before = git("status", "--porcelain")
            with patch.dict(os.environ, {"CHECKED_SOURCE_SHA": git("rev-parse", "HEAD")}):
                head = fixture.prepare_fixture(root, target, baseline)
            self.assertEqual(head, git("rev-parse", "HEAD"))
            self.assertEqual((target / "current.py").read_text(), "current code\n")
            self.assertFalse((target / "removed.py").exists())
            self.assertEqual((target / ".github/workflows/retired.yml").read_text(), "name: archived\n")
            self.assertEqual((target / ".github/workflows/quality.yml").read_text(), "name: historical\n")
            self.assertEqual((root / ".github/workflows/quality.yml").read_text(), "name: active\n")
            self.assertFalse((root / ".github/workflows/retired.yml").exists())
            self.assertEqual(git("status", "--porcelain"), before)

    def test_moved_source_stops_before_materialization(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"; root.mkdir()
            target = Path(directory) / "fixture"; target.mkdir()
            _, baseline = self.repository(root)
            with patch.dict(os.environ, {"CHECKED_SOURCE_SHA": "a" * 40}):
                with self.assertRaisesRegex(ValueError, "moved"):
                    fixture.prepare_fixture(root, target, baseline)
            self.assertEqual(list(target.iterdir()), [])

    def archive(self, name, kind=tarfile.REGTYPE):
        raw = io.BytesIO()
        with tarfile.open(fileobj=raw, mode="w") as archive:
            member = tarfile.TarInfo(name); member.type = kind
            if kind == tarfile.REGTYPE:
                member.size = 1
                archive.addfile(member, io.BytesIO(b"x"))
            else:
                member.linkname = "/tmp/outside"
                archive.addfile(member)
        return raw.getvalue()

    def test_unsafe_members_and_nonworkflow_baseline_are_refused(self):
        for name, kind in [("../escape", tarfile.REGTYPE), ("/escape", tarfile.REGTYPE),
                           ("linked", tarfile.SYMTYPE), ("linked", tarfile.LNKTYPE)]:
            with self.subTest(name=name, kind=kind), tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(ValueError):
                    fixture.extract_archive(self.archive(name, kind), directory)
                self.assertEqual(list(Path(directory).iterdir()), [])
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "unexpected archived source"):
                fixture.extract_archive(self.archive("current.py"), directory, workflows_only=True)

    def test_baseline_cannot_replace_current_code_and_existing_output_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            fixture.extract_archive(self.archive("current.py"), target)
            with self.assertRaises(FileExistsError):
                fixture.extract_archive(self.archive("current.py"), target)
            self.assertEqual((target / "current.py").read_text(), "x")

    def test_cli_accepts_only_named_existing_suites(self):
        result = subprocess.run(["python3", "-I", str(Path(fixture.__file__)), "deploy"],
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid choice", result.stderr)

if __name__ == "__main__":
    unittest.main()
