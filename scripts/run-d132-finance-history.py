#!/usr/bin/env python3
"""Verify the exact D132 delta, then run frozen R14-R17 checks at D131."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import Callable, Iterable, Mapping


ROOT = Path(__file__).resolve().parents[1]
BASELINE = "545db4b56eb6789e9c2e7d10584089525339f055"

EXPECTED_CHANGES = {
    ".github/scripts/test-d132-finance-history.py",
    ".github/workflows/verify-arthello-r14.yml",
    "CURRENT_STATE.md",
    "DATA_COVERAGE.md",
    "DECISIONS.md",
    "deploy/school-source-manifest.json",
    "deploy/v52/src/app/api/finance-actions/route.ts",
    "deploy/v52/src/app/api/finance/route.ts",
    "deploy/v52/src/app/components/ArtHelloShell.tsx",
    "deploy/v52/src/app/components/FinanceArticlesWorkspace.tsx",
    "deploy/v52/src/app/components/FinanceWorkspace.tsx",
    "deploy/v52/src/app/components/IntegrationWorkspace.tsx",
    "deploy/v52/src/app/components/OwnerDashboard.tsx",
    "deploy/v52/src/db/index.ts",
    "deploy/v52/src/lib/finance-auto-allocation.ts",
    "deploy/v52/src/lib/finance-branch-scope.ts",
    "deploy/v52/src/tests/dashboard-personalization.test.mjs",
    "deploy/v52/src/tests/empty-data-mode.test.mjs",
    "deploy/v52/src/tests/finance-articles-api.test.mjs",
    "deploy/v52/src/tests/finance-auto-allocation.test.mjs",
    "deploy/v52/src/tests/finance-branch-integration.test.mjs",
    "deploy/v52/src/tests/finance-branch-scope.test.mjs",
    "deploy/v52/src/tests/sixth-wave-finance-sales-design.test.mjs",
    "deploy/v52/src/tests/tochka-finance-bank-visibility-v3.test.mjs",
    "deploy/v52/src/tests/tochka-owner-connection.test.mjs",
    "docs/PROJECT_PASSPORT_PRODUCTION_RU.md",
    "docs/acceptance/2026-09-10-d132-finance-branch-rules.md",
    "scripts/run-d132-finance-history.py",
    "scripts/test/tochka-account-identity.test.mjs",
}

# Populated below with SHA-256 values for every D132 artifact except this runner
# and its workflow caller. The workflow pins this runner, avoiding a hash cycle.
PINNED_CURRENT_FILES = {
    ".github/scripts/test-d132-finance-history.py": "0cf435f4464ec6697a8a944dc6d85d7eb780f43bfd11d86bfc9621e9e78a3065",
    "CURRENT_STATE.md": "ac4c2395a1f07bb453f73c5d452e7a150d1f4f80304b88428b857dc91741668e",
    "DATA_COVERAGE.md": "96407e2abeed967750336b7683283a7f51203a20a36150e464c80ead3588ed91",
    "DECISIONS.md": "3f9d2c831f55595f898151edec10a9b0a8cf6a3911af5a75884ab3032f878826",
    "deploy/school-source-manifest.json": "7f266a7d699a0c9775d63eae698217574d271747d80e4044ea426ba44d914e3d",
    "deploy/v52/src/app/api/finance-actions/route.ts": "58cb6f3c6ea75bcd09db2ae052426594d50ef3f2f1c683d8729a65c6591e5028",
    "deploy/v52/src/app/api/finance/route.ts": "e3f995ebc270c011ea243f3212e6903fb866ddcdecf613761d5fd007ce61568c",
    "deploy/v52/src/app/components/ArtHelloShell.tsx": "06f1d8eef7fd9c83165d579a2390a7f035bd53d31a34683fc84d32099a37d0a5",
    "deploy/v52/src/app/components/FinanceArticlesWorkspace.tsx": "91d417be01854a3f085807e5ac84d99dd62bb878128950d1aa97ac3643506072",
    "deploy/v52/src/app/components/FinanceWorkspace.tsx": "68102fc0ba29c60c8d55978507b7cadf97f0431ace7b83c9614203ad9873acbd",
    "deploy/v52/src/app/components/IntegrationWorkspace.tsx": "0a206754f70fcd4a1c62cbd343b58f050fe7ee24203a8cc166b20ef0f73cc9cc",
    "deploy/v52/src/app/components/OwnerDashboard.tsx": "75cde5fe4c8958848430585f01dadef69cf22210d58c27a75e478541884f4688",
    "deploy/v52/src/db/index.ts": "67c3916ca9a28120b45299ae6a1e58b67d2a6f43fbd21b2a8a4e1aeaa093f0b5",
    "deploy/v52/src/lib/finance-auto-allocation.ts": "0e85619d6631ac046eced2adc702c273ccbfb4b248c568df6ad805d5ab371783",
    "deploy/v52/src/lib/finance-branch-scope.ts": "a756cc86a45947ed0e6e1cceebf9e114cad7607531940de7a958874549640b20",
    "deploy/v52/src/tests/dashboard-personalization.test.mjs": "39f3415e8f4e11b9aec5f7d07826aff0c2237e533be7aa984a51166a219353e4",
    "deploy/v52/src/tests/empty-data-mode.test.mjs": "533484befc862b4c42f584cced28014ea56d000f846edc1cdbecd608dc14b566",
    "deploy/v52/src/tests/finance-articles-api.test.mjs": "9f59cc8ed4b9242685cc15569b8841a8df46d0ebf540fa2482fcccf65577785e",  # gitleaks:allow
    "deploy/v52/src/tests/finance-auto-allocation.test.mjs": "2bf072da18dbc72037bac1a1276c3571fc434abbe0a4436176edc132ff3cf25a",
    "deploy/v52/src/tests/finance-branch-integration.test.mjs": "4dd2800a08d8edde1442fb0a3e5dcb37ad26d2cb4c72cf94608a1be2105abd7a",
    "deploy/v52/src/tests/finance-branch-scope.test.mjs": "b41160c9496fe816b8d2ea822e5fe59187dc84ab4fffeb4dd4c02b1352616597",
    "deploy/v52/src/tests/sixth-wave-finance-sales-design.test.mjs": "f5f2b62c827357d3405803cb73016b63cf9533b2b6798691eaf481b0e7a1799c",
    "deploy/v52/src/tests/tochka-finance-bank-visibility-v3.test.mjs": "b0144ba0de4885ebc8db1a98bf310038733e42d41a522af33af9c36eafeb148c",
    "deploy/v52/src/tests/tochka-owner-connection.test.mjs": "0057e4e127273602b2760d522bf50a2ed945511436f8e395162b3acbd9c6bfcf",
    "docs/PROJECT_PASSPORT_PRODUCTION_RU.md": "5dceeb7574a6d685fcb0f616ff85196ad0609f2a8b3fd195bf81afdd7f0ac0bd",
    "docs/acceptance/2026-09-10-d132-finance-branch-rules.md": "25d7b31daf84f67c45fdbfaf08d8f28875b96ba235ee9ff9896c86689e3bd60b",
    "scripts/test/tochka-account-identity.test.mjs": "3065d68a563d0cec968d0382251c8d6200aa0be7348d6fa4944b481ca7b3e75f",
}


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def verify_snapshot(
    head: str,
    parent: str,
    changed: Iterable[str],
    read: Callable[[str], bytes],
    pins: Mapping[str, str],
) -> None:
    if len(head) != 40 or any(ch not in "0123456789abcdef" for ch in head):
        raise ValueError("INVALID_HEAD")
    if parent != BASELINE:
        raise ValueError("BASELINE_MOVED")
    if set(changed) != EXPECTED_CHANGES:
        raise ValueError("CHANGE_SCOPE_DRIFT")
    if set(pins) != set(PINNED_CURRENT_FILES):
        raise ValueError("PIN_SCOPE_DRIFT")
    for path, expected in pins.items():
        if digest(read(path)) != expected:
            raise ValueError(f"CURRENT_SOURCE_DRIFT:{path}")


def historical_commands(suite: str) -> list[list[str]]:
    commands = {
        "r14": [["python3", "-I", "-B", "scripts/run-accepted-r16-history.py", "r14"]],
        "r15": [["python3", "-I", "-B", "scripts/run-accepted-r16-history.py", "r15"]],
        "r16": [
            ["python3", "-I", "-B", "scripts/test/accepted-r16-history.test.py"],
            ["python3", "-I", "-B", "scripts/run-accepted-r16-history.py", "r16"],
        ],
        "r17": [
            ["ruby", "deploy/v52/recovery-r17/check-contract.rb"],
            *[
                ["python3", "-I", "-B", path]
                for path in (
                    ".github/scripts/test-r17-artifact-download.py",
                    ".github/scripts/test-r17-contract.py",
                    ".github/scripts/test-r17-history-gate.py",
                    ".github/scripts/test-r17-backup-adoption.py",
                    ".github/scripts/test-r17-backup-controller.py",
                    ".github/scripts/test-r17-continuation-adapters.py",
                    ".github/scripts/test-r17-live-baseline.py",
                    ".github/scripts/test-run-r17-live-browser.py",
                    ".github/scripts/test-run-finance-ci-browser.py",
                    ".github/scripts/test-r17-digest-scan.py",
                )
            ],
            ["node", "--test", "scripts/test/retire-r16-browser.test.mjs"],
            ["node", "--check", "deploy/browser/retire-r16-browser.mjs"],
        ],
    }
    try:
        return commands[suite]
    except KeyError as exc:
        raise ValueError(f"UNKNOWN_SUITE:{suite}") from exc


def git(*args: str, cwd: Path = ROOT) -> str:
    return subprocess.check_output(["git", *args], cwd=cwd, text=True).strip()


def main(suite: str) -> None:
    commands = historical_commands(suite)
    head = git("rev-parse", "HEAD")
    if os.environ.get("CHECKED_SOURCE_SHA") != head:
        raise ValueError("CHECKED_SOURCE_SHA_MISMATCH")
    ancestor = subprocess.run(
        ["git", "merge-base", "--is-ancestor", BASELINE, head],
        cwd=ROOT,
        check=False,
    )
    parent = BASELINE if ancestor.returncode == 0 else ""
    changed = git("diff", "--name-only", f"{BASELINE}..{head}").splitlines()

    def read(path: str) -> bytes:
        return subprocess.check_output(["git", "show", f"{head}:{path}"], cwd=ROOT)

    verify_snapshot(head, parent, changed, read, PINNED_CURRENT_FILES)

    with tempfile.TemporaryDirectory(prefix="d129-history-") as temp:
        checkout = Path(temp) / "baseline"
        subprocess.run(
            ["git", "clone", "--shared", "--no-checkout", str(ROOT), str(checkout)],
            check=True,
        )
        subprocess.run(["git", "checkout", "--detach", BASELINE], cwd=checkout, check=True)
        if git("rev-parse", "HEAD", cwd=checkout) != BASELINE:
            raise ValueError("HISTORICAL_CHECKOUT_DRIFT")
        env = {**os.environ, "CHECKED_SOURCE_SHA": BASELINE}
        for command in commands:
            subprocess.run(command, cwd=checkout, env=env, check=True)

    if git("rev-parse", "HEAD") != head:
        raise ValueError("CURRENT_HEAD_MUTATED")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: run-d132-finance-history.py <r14|r15|r16|r17>")
    try:
        main(sys.argv[1])
    except (ValueError, subprocess.CalledProcessError) as exc:
        raise SystemExit(str(exc)) from exc
