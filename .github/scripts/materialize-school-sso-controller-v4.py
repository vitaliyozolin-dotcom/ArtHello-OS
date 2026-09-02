#!/usr/bin/env python3
from __future__ import annotations

import base64
import gzip
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

TARGET_BRANCH = "ops/fix-school-sso-controller-dockerignore-20260902"
DEPLOY_WORKFLOW = Path(
    ".github/workflows/deploy-school-sso-origin-hotfix-production-20260902.yml"
)
PART_GLOB = ".github/scripts/school-staff-sso-workflow-controller-v3.sh.gz.b64.part-*"
OUTPUT_ROOT = Path("generated-school-sso-controller")


def run(*args: str, capture: bool = False) -> str:
    result = subprocess.run(
        args,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    return result.stdout.strip() if capture else ""


def main() -> None:
    branch = run("git", "branch", "--show-current", capture=True)
    if branch != TARGET_BRANCH:
        raise SystemExit(f"Unexpected branch: {branch}")
    if run("git", "status", "--porcelain", "--untracked-files=all", capture=True):
        raise SystemExit("Working tree is not clean")

    parts = sorted(Path().glob(PART_GLOB))
    if len(parts) != 5:
        raise SystemExit(f"Expected five controller parts, found {len(parts)}")

    encoded = "".join(part.read_text().strip() for part in parts)
    before = gzip.decompress(base64.b64decode(encoded)).decode()
    old = """cat > school-source/.dockerignore <<'EOF'
.git
.next
.openai/*
!.openai/hosting.json
.sites-runtime
.wrangler
.migration
data
dist
node_modules
npm-debug.log*
EOF
"""
    new = """cat > school-source/.dockerignore <<'EOF'
.git
.next
.openai/*
!.openai/hosting.json
.sites-runtime
.wrangler
.migration
data/*
!data/schedules
!data/schedules/**
!data/curricula
!data/curricula/**
dist
node_modules
npm-debug.log*
EOF
"""
    count = before.count(old)
    if count != 1:
        raise SystemExit(f"Expected one unsafe Docker context block, found {count}")
    after = before.replace(old, new, 1)
    if after == before:
        raise SystemExit("Controller was not changed")

    controller_path = Path("/tmp/school-sso-controller-v4.sh")
    controller_path.write_text(after)
    run("bash", "-n", str(controller_path))
    required = (
        "data/*",
        "!data/schedules",
        "!data/schedules/**",
        "!data/curricula",
        "!data/curricula/**",
    )
    lines = after.splitlines()
    for marker in required:
        if lines.count(marker) != 1:
            raise SystemExit(f"Controller marker count is not one: {marker}")
    if "data" in lines:
        raise SystemExit("Standalone data exclusion remains in controller")

    digest = hashlib.sha256(after.encode()).hexdigest()
    repacked = base64.b64encode(gzip.compress(after.encode(), mtime=0)).decode()
    width, remainder = divmod(len(repacked), len(parts))
    cursor = 0
    for index, part in enumerate(parts):
        length = width + (1 if index < remainder else 0)
        chunk = repacked[cursor : cursor + length]
        cursor += length
        if not chunk:
            raise SystemExit(f"Generated empty part: {part}")
        part.write_text(chunk + "\n")
    if cursor != len(repacked):
        raise SystemExit("Controller payload was not split completely")

    reconstructed_encoded = "".join(part.read_text().strip() for part in parts)
    reconstructed = gzip.decompress(base64.b64decode(reconstructed_encoded)).decode()
    if reconstructed != after:
        raise SystemExit("Reconstructed controller differs from source")
    if hashlib.sha256(reconstructed.encode()).hexdigest() != digest:
        raise SystemExit("Reconstructed controller digest mismatch")

    workflow = DEPLOY_WORKFLOW.read_text()
    workflow, digest_count = re.subn(
        r"(?m)^  CONTROLLER_SCRIPT_SHA256: [a-f0-9]{64}$",
        f"  CONTROLLER_SCRIPT_SHA256: {digest}",
        workflow,
    )
    if digest_count != 1:
        raise SystemExit(f"Expected one controller digest pin, found {digest_count}")

    insertion = '''          bash -n "$work/controller.sh"
          bash -n "$work/cutover.sh"
'''
    replacement = '''          bash -n "$work/controller.sh"
          bash -n "$work/cutover.sh"
          grep -Fx 'data/*' "$work/controller.sh" >/dev/null
          grep -Fx '!data/schedules' "$work/controller.sh" >/dev/null
          grep -Fx '!data/schedules/**' "$work/controller.sh" >/dev/null
          grep -Fx '!data/curricula' "$work/controller.sh" >/dev/null
          grep -Fx '!data/curricula/**' "$work/controller.sh" >/dev/null
          ! grep -Fx 'data' "$work/controller.sh" >/dev/null
          printf 'SCHOOL_SSO_CONTROLLER_DOCKER_CONTEXT=PASS\\n'
'''
    insertion_count = workflow.count(insertion)
    if insertion_count != 1:
        raise SystemExit(
            f"Expected one workflow validation insertion point, found {insertion_count}"
        )
    workflow = workflow.replace(insertion, replacement, 1)
    DEPLOY_WORKFLOW.write_text(workflow)

    if f"CONTROLLER_SCRIPT_SHA256: {digest}" not in workflow:
        raise SystemExit("Deployment workflow digest pin was not updated")
    if "SCHOOL_SSO_CONTROLLER_DOCKER_CONTEXT=PASS" not in workflow:
        raise SystemExit("Deployment workflow regression marker is missing")

    if OUTPUT_ROOT.exists():
        shutil.rmtree(OUTPUT_ROOT)
    scripts_dir = OUTPUT_ROOT / "scripts"
    workflows_dir = OUTPUT_ROOT / "workflows"
    scripts_dir.mkdir(parents=True)
    workflows_dir.mkdir(parents=True)
    for part in parts:
        shutil.copy2(part, scripts_dir / part.name)
    shutil.copy2(DEPLOY_WORKFLOW, workflows_dir / DEPLOY_WORKFLOW.name)
    (OUTPUT_ROOT / "controller-v4.sh").write_text(after)
    manifest = {
        "controller_sha256": digest,
        "controller_parts": [part.name for part in parts],
        "deployment_workflow": DEPLOY_WORKFLOW.name,
        "required_markers": list(required),
        "standalone_data_exclusion": False,
    }
    (OUTPUT_ROOT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    )

    print(f"SCHOOL_SSO_CONTROLLER_SHA256={digest}")
    print(f"SCHOOL_SSO_CONTROLLER_PARTS={len(parts)}")
    print("SCHOOL_SSO_CONTROLLER_REPACK=PASS")
    print("SCHOOL_SSO_CONTROLLER_ARTIFACT=READY")


if __name__ == "__main__":
    main()
