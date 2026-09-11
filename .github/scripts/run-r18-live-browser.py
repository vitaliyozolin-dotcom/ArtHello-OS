#!/usr/bin/env python3
"""Bind both frozen R10 browser phases to verified R14 durable identities."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from types import ModuleType

HERE = Path(__file__).resolve().parent
PINS = {
    "r18-candidate-state.py": "bc6eb268dcce05fa48c5b2681981acf76b42304aa87e197fd17572a3852d0417",
    "run-r10-live-browser.sh": "9715a63c8f1a95168e2a3596641e841eb5f88b6fabef823e9ad78dd05d92e653",
    "r10-live-browser-acceptance.py": "e41949e4a9a48100e3db752e75d27ced4265dc63905e4972a84bc29e85aeb84b",
    "check-school-live-acceptance-r7.py": "6fae34638acd1757cad922c288ede1282f8300a8ecfcbe3547661378445cb884",
}


def require(condition):
    if not condition:
        raise ValueError("browser_identity_mismatch")


def strict_json(content):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result)
            result[key] = value
        return result
    return json.loads(content, object_pairs_hook=unique)


def private_json(path):
    require(path.is_absolute() and path.resolve() == path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
                and info.st_uid == os.geteuid() and info.st_nlink == 1 and 0 < info.st_size <= 65536)
        with os.fdopen(fd, "rb") as stream:
            fd = None
            content = stream.read(65537)
        require(len(content) <= 65536)
        return strict_json(content)
    finally:
        if fd is not None:
            os.close(fd)


def checked_state():
    sources = {}
    for name, digest in PINS.items():
        sources[name] = (HERE / name).read_bytes()
        require(hashlib.sha256(sources[name]).hexdigest() == digest)
    module = ModuleType("r14_verified_candidate")
    module.__file__ = str(HERE / "r18-candidate-state.py")
    exec(compile(sources["r18-candidate-state.py"], module.__file__, "exec"), module.__dict__)
    return module


def load_snapshot(environment, state):
    release = environment["RELEASE_SHA"]
    require(re.fullmatch(r"[a-f0-9]{40}", release) is not None)
    root = Path.home() / ".config/arthello/release-state"
    require(root.resolve() == root)
    info = root.lstat()
    require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == os.geteuid())
    path = root / ("candidate-acceptance-" + release + ".json")
    record = private_json(path)
    require(state.load_state(path) == record)
    activation = root / ("activation-" + release + ".json")
    if environment["BROWSER_PHASE"] == "after":
        marker = private_json(activation)
    else:
        require(not activation.exists() and not activation.is_symlink())
        marker = None
    return record, marker


def validate_snapshot(record, marker, environment):
    phase = environment["BROWSER_PHASE"]
    require(phase in ("candidate", "after"))
    release, run, attempt = (environment[key] for key in ("RELEASE_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"))
    require(re.fullmatch(r"[a-f0-9]{40}", release) is not None)
    require(re.fullmatch(r"[1-9][0-9]*", run) is not None and re.fullmatch(r"[1-9][0-9]*", attempt) is not None)
    context = record["context"]
    require(context["releaseSha"] == release and context["runId"] == run)
    require(re.fullmatch(r"[1-9][0-9]*", context["runAttempt"]) is not None
            and re.fullmatch(r"[1-9][0-9]*", record["latestAttempt"]) is not None)
    resource, latest, current = int(context["runAttempt"]), int(record["latestAttempt"]), int(attempt)
    require(latest >= resource)
    require(re.fullmatch(r"[a-f0-9]{64}", context["candidateContainerId"]) is not None)
    require(context["browserSourceSha"] == environment["BROWSER_SOURCE_SHA"] == release)
    require(context["browserFingerprint"] == environment["BROWSER_FINGERPRINT"])
    for key, expected in (("BROWSER_CANDIDATE_ID", context["candidateContainerId"]),
                          ("D080_CANDIDATE_CONTEXT_SHA256", record["contextSha256"])):
        require(key not in environment or environment[key] == expected)
    if phase == "candidate":
        require(record["phase"] in ("maintenance-started", "candidate-verified") and marker is None)
        require((current == resource and latest == resource) or (current > resource and current >= latest))
    else:
        require(record["phase"] == "public-started" and latest == current)
        expected = {"schemaVersion": 1, "state": "activation-started", "releaseSha": release,
                    "runId": run, "runAttempt": attempt, "candidateContainerId": context["candidateContainerId"],
                    "previousContainerId": context["previousContainerId"], "rollbackVolume": context["rollbackVolume"],
                    "originalRouteSha256": context["originalRouteSha256"], "candidateRouteSha256": context["publicRouteSha256"],
                    "diagnosticDirectory": str(Path.home() / ".config/arthello/release-state/public-audit" / ("arthello-deploy-" + run + "-" + attempt))}
        require(isinstance(marker, dict) and all(marker.get(key) == value for key, value in expected.items()))
    return context


def docker_read(arguments):
    result = subprocess.run(["docker", *arguments], capture_output=True, timeout=20,
                            env={"PATH": os.environ.get("PATH", "")})
    require(result.returncode == 0 and 0 < len(result.stdout) <= 1048576)
    return result.stdout.decode("utf-8")


def observe(context, read=docker_read):
    expected = context["candidateContainerId"]
    require(read(["container", "ls", "--quiet", "--no-trunc", "--filter", "name=^/arthello-direct-"]).splitlines() == [expected])
    inspected = strict_json(read(["container", "inspect", expected]))
    require(isinstance(inspected, list) and len(inspected) == 1)
    app = inspected[0]
    require(app["Id"] == expected and app["Image"] == context["imageId"] and app["Name"] == "/" + context["candidateName"])
    require(app["State"]["Running"] is True and app["State"]["Paused"] is False and app["State"]["Restarting"] is False)
    require(app["Config"]["Labels"]["arthello.release.sha"] == context["releaseSha"]
            and app["Config"]["Labels"]["arthello.release.tree"] == context["sourceTree"])


def run_frozen(environment):
    # Preserve stdin for the candidate nonce and pass credentials only through
    # the existing frozen runner's environment-to-stdin protocol.
    return subprocess.run(["bash", str(HERE / "run-r10-live-browser.sh")], env=environment,
                          cwd=HERE.parent.parent, check=False).returncode


def execute(environment, snapshot, runtime=observe, browser=run_frozen):
    before = snapshot()
    context = validate_snapshot(*before, environment)
    runtime(context)
    child = dict(environment, BROWSER_CANDIDATE_ID=context["candidateContainerId"],
                 OBSERVED_LIVE_ARTHELLO_SHA=context["releaseSha"], D080_CANDIDATE_CONTEXT_SHA256=before[0]["contextSha256"])
    result = browser(child)
    after = snapshot()
    require(after == before)
    validate_snapshot(*after, environment)
    runtime(context)
    require(result == 0)


def main():
    try:
        require(len(sys.argv) == 1)
        state = checked_state()
        execute(dict(os.environ), lambda: load_snapshot(os.environ, state))
    except Exception:
        print("ARTHELLO_R14_BROWSER_IDENTITY=BLOCKED", file=sys.stderr)
        return 1
    print("ARTHELLO_R14_BROWSER_IDENTITY=VERIFIED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
