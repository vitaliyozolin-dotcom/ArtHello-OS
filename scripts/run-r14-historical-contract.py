#!/usr/bin/env python3
"""Run frozen R14 comparisons alongside explicit current-source checks.

This is hosted verification only. It cannot authorize a release or substitute
the source checked by the unchanged protected R14 controller.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASELINE = "d44137d8342b7eacec510f9f70ffeba6c3bf4f3a"
PINS_PATH = "deploy/v52/recovery-r14/source-pins.json"
PINS_SHA256 = "6101c7ed105a02e6a91bd1e646da715dbff1217a1cd4585cceea9f2ec1f212cb"
WORKFLOW = ".github/workflows/verify-arthello-r14.yml"
WORKFLOW_SHA256 = "694c8f04b8375334bb45daece08f6235cd1326360cec7df9cadc21e97c710a38"
ARCHIVED_PATHS = (
    "deploy/v52/Dockerfile",
    "deploy/v52/overrides/db/index.ts",
    "deploy/v52/overrides/db/schema.ts",
    "deploy/v52/overrides/lib/tochka-autosync.ts",
    "scripts/test/tochka-account-identity.test.mjs",
)
# These changed inputs must pass their current contract before historical files
# are substituted in a private fixture. Unlisted frozen helper drift is refused.
CURRENT_PINS = {
    "deploy/v52/Dockerfile": "90f0f3b76e02b14163038711a49c24fc08bc5bb4e1622e53ae773c16e92d3930",
    "deploy/school-source-manifest.json": "90f99d4822846d687a7a4955748f15e5283812bd4c43eddc877dd3c22caff266",
    "scripts/verify-school-source.mjs": "9a2b5d18ef74d5e87840ec4c4c7754bcd9e7f22b7c69cd05d96f5012d17862d5",
    "scripts/test/tochka-account-identity.test.mjs": "f1857eea31cc55372a69d35c29784dc0c1e6a87667c53297fe4f6f8c61e1f3e4",
}
COMMANDS = (
    "ruby deploy/v52/recovery-r14/check-contract.rb",
    "python3 -I -B .github/scripts/test-r14-contract.py",
    "python3 -I -B .github/scripts/test-r14-history-gate.py",
    "python3 -I -B .github/scripts/test-r14-backup-adoption.py",
    "python3 -I -B .github/scripts/test-r14-backup-controller.py",
    "python3 -I -B .github/scripts/test-r14-continuation-adapters.py",
    "python3 -I -B .github/scripts/test-r14-live-baseline.py",
    "python3 -I -B .github/scripts/test-run-r14-live-browser.py",
    "node --test scripts/test/retire-r13-browser.test.mjs",
    "node --check deploy/browser/retire-r13-browser.mjs",
)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def git(root, *args):
    return subprocess.run(["git", "-C", str(root), *args], check=True,
                          capture_output=True, timeout=60).stdout


def require(value, code):
    if not value:
        raise ValueError(code)


def extract_current(root, target):
    # The existing bounded archive extractor is itself pinned by frozen R14.
    helper = root / "scripts/run-frozen-release-contract.py"
    require(digest(helper.read_bytes()) ==
            "f6e3e21abb92ac45558c756ed7b14ed4ce3b1be4a489379238aa7e5c97f4d28d",
            "ARCHIVE_EXTRACTOR_DRIFT")
    spec = importlib.util.spec_from_file_location("frozen_archive", helper)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    head = git(root, "rev-parse", "HEAD").decode().strip()
    require(not os.environ.get("CHECKED_SOURCE_SHA") or
            os.environ["CHECKED_SOURCE_SHA"] == head, "CHECKED_SOURCE_MOVED")
    module.extract_archive(git(root, "archive", "--format=tar", head), target)
    # Current protected controller is included unchanged; only the hosted
    # verification workflow below receives its historical comparison input.
    module.extract_archive(git(root, "archive", "--format=tar", head,
                               ".github/workflows"), target, workflows_only=True)
    return head


def check_current(target):
    target = Path(target)
    for name, expected in CURRENT_PINS.items():
        require(digest((target / name).read_bytes()) == expected,
                "CURRENT_SOURCE_DRIFT:" + name)
    pins_raw = (target / PINS_PATH).read_bytes()
    require(digest(pins_raw) == PINS_SHA256, "FROZEN_R14_PINS_DRIFT")
    pins = json.loads(pins_raw)
    for name, expected in pins["sourceFiles"].items():
        if name not in ARCHIVED_PATHS:
            require(digest((target / name).read_bytes()) == expected,
                    "CURRENT_PROTOCOL_DRIFT:" + name)
    return pins


def overlay_historical(root, target, pins):
    for name, expected in [(name, pins["sourceFiles"][name]) for name in ARCHIVED_PATHS] + [
            (WORKFLOW, WORKFLOW_SHA256)]:
        raw = git(root, "show", BASELINE + ":" + name)
        require(digest(raw) == expected, "ARCHIVED_SOURCE_DRIFT:" + name)
        file = Path(target) / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(raw)


def run(root=ROOT):
    with tempfile.TemporaryDirectory(prefix="arthello-r14-historical-") as temporary:
        target = Path(temporary)
        head = extract_current(root, target)
        pins = check_current(target)
        for command in [
                ["node", "scripts/verify-school-source.mjs"],
                ["node", "--test", "scripts/test/tochka-account-identity.test.mjs"]]:
            subprocess.run(command, cwd=target, check=True, timeout=120)
        overlay_historical(root, target, pins)
        require(git(root, "rev-parse", "HEAD").decode().strip() == head,
                "CHECKED_SOURCE_MOVED")
        print(f"R14_HISTORICAL_COMPARISON current_code={head} archived_inputs={BASELINE} "
              "production_acceptance=not_run", flush=True)
        for command in COMMANDS:
            subprocess.run(command.split(), cwd=target, check=True, timeout=120)
    return 0


if __name__ == "__main__":
    require(len(sys.argv) == 1, "ARGUMENTS_NOT_ALLOWED")
    sys.exit(run())
