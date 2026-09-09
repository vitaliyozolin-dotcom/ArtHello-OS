#!/usr/bin/env python3
"""Recover only the pinned existing D092 receipt on an authorized hosted push."""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

REPOSITORY = "vitaliyozolin-dotcom/ArtHello-OS"
REPOSITORY_ID = 1311964413
OWNER = "vitaliyozolin-dotcom"
PREFIX = "D092: inspect existing visual evidence"
RUN_ID = 34333105787
SOURCE_SHA = "b4c39d5af8ab348882759c48c0f82dbe810a8065"
ARTIFACT_ID = 10096640452
ARTIFACT_NAME = "arthello-synthetic-content-tasks-34333105787-1"
ARTIFACT_BYTES = 389416
ARTIFACT_DIGEST = "sha256:dd600c987b34a1d92a1270a63926815b2a1715c9efb01400a7d1434748e7de5a"
READER = Path(__file__).with_name("read-content-tasks-evidence.py")
READER_SHA256 = "25524d5a6eca6faa7692aec0fd2aabec42ab1dcd2b16042323c43c755b0fa19a"


def require(condition):
    if not condition:
        raise ValueError("inspection_validation_failed")


def validate_trigger(env, event, checkout_sha):
    for key, value in {
        "GITHUB_REPOSITORY": REPOSITORY, "GITHUB_ACTOR": OWNER,
        "GITHUB_TRIGGERING_ACTOR": OWNER, "GITHUB_EVENT_NAME": "push",
        "GITHUB_REF": "refs/heads/main", "GITHUB_RUN_ATTEMPT": "1",
        "RUNNER_ENVIRONMENT": "github-hosted",
    }.items():
        require(env.get(key) == value)
    sha = env.get("GITHUB_SHA", "")
    require(re.fullmatch(r"[a-f0-9]{40}", sha) is not None and checkout_sha == sha)
    require(event["repository"]["full_name"] == REPOSITORY)
    require(event["repository"]["id"] == REPOSITORY_ID and event["repository"]["fork"] is False)
    require(event["sender"]["login"] == OWNER and event["ref"] == "refs/heads/main")
    require(event["after"] == sha and event["head_commit"]["id"] == sha)
    require(isinstance(event["head_commit"]["message"], str))
    require(event["head_commit"]["message"].startswith(PREFIX))


def validate_metadata(run, artifacts, main_ref, checked_sha, now):
    require(main_ref["ref"] == "refs/heads/main" and main_ref["object"]["type"] == "commit")
    require(main_ref["object"]["sha"] == checked_sha)
    for key, value in {
        "id": RUN_ID, "head_sha": SOURCE_SHA, "head_branch": "main", "run_attempt": 1,
        "event": "push", "status": "completed", "conclusion": "failure",
        "path": ".github/workflows/verify-content-tasks-visual.yml",
    }.items():
        require(type(run[key]) is type(value) and run[key] == value)
    for key in ("repository", "head_repository"):
        require(run[key]["full_name"] == REPOSITORY and run[key]["id"] == REPOSITORY_ID)
    for key in ("actor", "triggering_actor"):
        require(run[key]["login"] == OWNER)
    require(type(artifacts["total_count"]) is int and artifacts["total_count"] == 1)
    require(isinstance(artifacts["artifacts"], list) and len(artifacts["artifacts"]) == 1)
    artifact = artifacts["artifacts"][0]
    for key, value in {"id": ARTIFACT_ID, "name": ARTIFACT_NAME,
                       "size_in_bytes": ARTIFACT_BYTES, "digest": ARTIFACT_DIGEST}.items():
        require(type(artifact[key]) is type(value) and artifact[key] == value)
    require(artifact["expired"] is False)
    expiry = datetime.fromisoformat(artifact["expires_at"].replace("Z", "+00:00"))
    require(expiry.utcoffset() is not None and expiry > now)
    for key, value in {"id": RUN_ID, "head_sha": SOURCE_SHA, "head_branch": "main",
                       "repository_id": REPOSITORY_ID, "head_repository_id": REPOSITORY_ID}.items():
        require(type(artifact["workflow_run"][key]) is type(value) and artifact["workflow_run"][key] == value)


def command_output(arguments):
    result = subprocess.run(arguments, capture_output=True, check=True, timeout=30)
    return result.stdout


def gh_json(endpoint):
    return json.loads(command_output(["gh", "api", "--hostname", "github.com", "--method", "GET", endpoint]))


def download_artifact(destination):
    with destination.open("xb") as output:
        subprocess.run(["gh", "api", "--hostname", "github.com", "--method", "GET",
                        f"repos/{REPOSITORY}/actions/artifacts/{ARTIFACT_ID}/zip"],
                       stdout=output, stderr=subprocess.PIPE, check=True, timeout=90)


def main():
    stage = "trigger_validation"
    try:
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
        checkout_sha = command_output(["git", "rev-parse", "HEAD"]).decode("ascii").strip()
        validate_trigger(os.environ, event, checkout_sha)
        stage = "reader_identity"
        require(hashlib.sha256(READER.read_bytes()).hexdigest() == READER_SHA256)
        stage = "metadata_fetch"
        run = gh_json(f"repos/{REPOSITORY}/actions/runs/{RUN_ID}")
        artifacts = gh_json(f"repos/{REPOSITORY}/actions/runs/{RUN_ID}/artifacts?per_page=100")
        main_ref = gh_json(f"repos/{REPOSITORY}/git/ref/heads/main")
        stage = "metadata_validation"
        validate_metadata(run, artifacts, main_ref, checkout_sha, datetime.now(timezone.utc))
        print('{"kind":"d092-existing-artifact-metadata","result":"pass","artifactId":10096640452,"runId":34333105787,"mainMatchesCheckout":true,"producerConclusion":"failure","digestMatchesPin":true,"unexpired":true}', flush=True)
        with tempfile.TemporaryDirectory(prefix="d092-existing-evidence-", dir=os.environ["RUNNER_TEMP"]) as temporary:
            archive = Path(temporary) / "existing.zip"
            stage = "archive_download"
            download_artifact(archive)
            stage = "receipt_validation"
            result = subprocess.run([sys.executable, str(READER), str(archive)],
                                    capture_output=True, check=False, timeout=30)
            # The exact frozen reader emits only its allowlisted receipt or fixed failure.
            sys.stdout.write(result.stdout.decode("ascii"))
            require(result.returncode == 0)
        return 0
    except Exception:
        print(json.dumps({"kind": "d092-existing-evidence-inspection", "result": "blocked",
                          "stage": stage}, separators=(",", ":")))
        return 1


if __name__ == "__main__":
    sys.exit(main())
