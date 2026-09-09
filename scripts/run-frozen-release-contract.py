#!/usr/bin/env python3
"""Run retired release contracts with archived workflow inputs and current code.

The active workflow directory is never changed. All non-workflow files come
from the checked commit. Only historical YAML comparison inputs come from the
accepted R13 commit. These fixtures are never registered or executed as workflows.
"""
import argparse
import io
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile

BASELINE = "f5fa3e46e3510e6fc98ae4455f4b499c0ba30695"
COMMANDS = {
    "r10": "ruby deploy/v52/recovery-r10/check-contract.rb\npython3 -I .github/scripts/test-d083-replay-guard.py\npython3 -I .github/scripts/test-d083-candidate-state.py\npython3 -I .github/scripts/test-d083-resume-candidate.py\npython3 -I .github/scripts/test-d083-public-audit.py\npython3 -I .github/scripts/test-d083-controller-boundary.py\npython3 -I .github/scripts/test-r10-live-browser-acceptance.py\npython3 -I .github/scripts/test-d083-maintenance-route.py\nnode --test scripts/test/retire-r9-browser.test.mjs\nbash -n .github/scripts/run-r10-live-browser.sh\nbash -n .github/scripts/run-d083-hosted-caddy.sh\nbash -n .github/scripts/run-d083-target-caddy.sh\nbash .github/scripts/run-d083-hosted-caddy.sh\n",
    "r11": "ruby deploy/v52/recovery-r11/check-contract.rb\npython3 -I .github/scripts/test-r11-replay-guard.py\nnode --test .github/scripts/test-r11-target-caddy.test.mjs\nbash -n .github/scripts/run-r11-target-caddy.sh\n",
    "r13": "ruby deploy/v52/recovery-r13/check-contract.rb\npython3 -I -B .github/scripts/test-r13-contract.py\npython3 -I -B .github/scripts/test-r13-history-gate.py\npython3 -I -B .github/scripts/test-r13-backup-adoption.py\npython3 -I -B .github/scripts/test-r13-backup-controller.py\npython3 -I -B .github/scripts/test-r13-continuation-adapters.py\npython3 -I -B .github/scripts/test-r13-live-baseline.py\npython3 -I -B .github/scripts/test-run-r13-live-browser.py\nnode --test scripts/test/retire-r12-browser.test.mjs\nnode --check deploy/browser/retire-r12-browser.mjs\n"
}

def git(root, *arguments):
    return subprocess.run(["git", "-C", str(root), *arguments],
                          check=True, capture_output=True, timeout=60).stdout

def extract_archive(raw, target, *, workflows_only=False):
    target = Path(target)
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
        members = archive.getmembers()
        if len(members) > 10000 or sum(m.size for m in members) > 256 * 1024 * 1024:
            raise ValueError("archive exceeds bounded fixture size")
        for member in members:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or ".." in path.parts or "\\" in member.name
                    or not (member.isfile() or member.isdir())
                    or member.size > 32 * 1024 * 1024):
                raise ValueError("unsafe archive member")
            allowed = path.parts[:2] == (".github", "workflows")
            if workflows_only:
                if not allowed and member.name != ".github":
                    raise ValueError("unexpected archived source")
            elif allowed:
                continue
            # Every file is created in the invocation-owned temporary directory.
            destination = target.joinpath(*path.parts)
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                with destination.open("xb") as output:
                    output.write(archive.extractfile(member).read())
                destination.chmod(member.mode & 0o777)

def prepare_fixture(root, target, baseline=BASELINE):
    head = git(root, "rev-parse", "HEAD").decode().strip()
    if not re.fullmatch("[a-f0-9]{40}", head):
        raise ValueError("invalid checked source")
    expected = os.environ.get("CHECKED_SOURCE_SHA")
    if expected and expected != head:
        raise ValueError("checked source moved")
    if git(root, "cat-file", "-t", baseline).strip() != b"commit":
        raise ValueError("missing accepted baseline")
    extract_archive(git(root, "archive", "--format=tar", head), target)
    extract_archive(git(root, "archive", "--format=tar", baseline, ".github/workflows"),
                    target, workflows_only=True)
    return head

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("contract", choices=tuple(COMMANDS))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="arthello-frozen-contract-") as directory:
        head = prepare_fixture(root, directory)
        print(f"FROZEN_CONTRACT current_code={head} workflow_inputs={BASELINE} suite={args.contract}", flush=True)
        result = subprocess.run(["bash", "-e", "-u", "-o", "pipefail", "-c", COMMANDS[args.contract]],
                                cwd=directory, timeout=720)
        return result.returncode

if __name__ == "__main__":
    raise SystemExit(main())
