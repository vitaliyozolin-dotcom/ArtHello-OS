#!/usr/bin/env python3
"""Read one already-produced synthetic artifact; never run its fixture/browser."""

import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import sys
import zipfile

ARTIFACT_ID = 10096640452
RUN_ID = 34333105787
EXPECTED_BYTES = 389416
EXPECTED_SHA256 = "dd600c987b34a1d92a1270a63926815b2a1715c9efb01400a7d1434748e7de5a"
HARNESS_BLOB = "eee9647d7f0e4799e293613c01eaa4199d80dc06"
VIEWPORTS = [[390, 844], [1440, 900]]
STAGES = {"configuration", "frozen-harness", "browser", "synthetic-authentication", "artifact-inventory", "cleanup"}
STAGES.update(f"{route}-{mode}-{width}x{height}" for route in ("content", "tasks")
              for mode in ("empty", "populated") for width, height in VIEWPORTS)
STAGES.update(f"task-dialog-{width}x{height}" for width, height in VIEWPORTS)
PNGS = {f"pilot-{route}-{mode}-{width}x{height}-{kind}.png"
        for route in ("content", "tasks") for width, height in VIEWPORTS
        for mode, kind in (("empty", "full"), ("empty", "viewport"), ("populated", "full"))}
PNGS.update(f"pilot-workflow-dialog-{width}x{height}.png" for width, height in VIEWPORTS)


def require(condition):
    if not condition:
        raise ValueError("evidence_validation_failed")


def receipt_summary(value):
    expected = {"kind", "result", "stage", "harnessBlob", "routes", "viewports", "pngCount",
                "completedCaptures", "taskNumberAssertion", "savePersistence", "liveAcceptance"}
    require(isinstance(value, dict) and set(value) == expected)
    require(value["kind"] == "synthetic-content-tasks-scoped" and value["result"] == "blocked")
    require(value["stage"] in STAGES and value["harnessBlob"] == HARNESS_BLOB)
    require(value["routes"] == ["content", "tasks"] and value["viewports"] == VIEWPORTS)
    require(value["pngCount"] is None and type(value["completedCaptures"]) is int)
    require(0 <= value["completedCaptures"] <= 10)
    require(value["taskNumberAssertion"] == "not_confirmed")
    require(value["savePersistence"] == "not_tested" and value["liveAcceptance"] == "not_run")
    return {key: value[key] for key in ("result", "stage", "completedCaptures", "taskNumberAssertion")}


def summarize_zip(raw, expected_sha256, expected_bytes):
    require(len(raw) == expected_bytes and hashlib.sha256(raw).hexdigest() == expected_sha256)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        members = [item for item in archive.infolist() if not item.is_dir()]
        require(1 <= len(members) <= 16)
        by_name = {}
        for item in members:
            path = PurePosixPath(item.filename)
            require(not path.is_absolute() and ".." not in path.parts and "\\" not in item.filename)
            require(path.name in PNGS | {"manifest.json", "scoped-result.json"})
            require(path.name not in by_name and not (item.flag_bits & 1))
            by_name[path.name] = item
        receipt = by_name["scoped-result.json"]
        require(0 < receipt.file_size <= 8192)
        summary = receipt_summary(json.loads(archive.read(receipt)))
        return {"kind": "existing-synthetic-visual-evidence", "artifactId": ARTIFACT_ID,
                "runId": RUN_ID, **summary,
                "pngEntries": sum(name in PNGS for name in by_name),
                "captureRecordsMayPrecedeAssertions": True, "screenshotsInspected": False}


def main(arguments):
    try:
        require(len(arguments) == 1)
        archive = Path(arguments[0])
        require(archive.is_file() and not archive.is_symlink() and archive.stat().st_size == EXPECTED_BYTES)
        summary = summarize_zip(archive.read_bytes(), EXPECTED_SHA256, EXPECTED_BYTES)
    except Exception:
        print('{"kind":"existing-synthetic-visual-evidence","result":"blocked","reason":"evidence_validation_failed"}')
        return 1
    print(json.dumps(summary, ensure_ascii=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
