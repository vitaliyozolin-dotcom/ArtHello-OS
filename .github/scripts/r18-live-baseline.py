#!/usr/bin/env python3
"""Read-only accepted R17 identity checks for a fresh R18 continuation.

This is an identity observation, never a browser or backup acceptance receipt.
Use the live check only before a fresh cutover; retained candidates use their
separately verified durable context instead of pretending R17 is still running.
"""
import json
import os
import stat
import subprocess
import sys

ACCEPTED_SHA = 'ff8559254faaedade63a9ee7567a45686d08c13a'
ACCEPTED_TREE = '6aeb7e6879b786a434d12f026f765bcaf9acb5a4'
ACCEPTED_IMAGE = 'sha256:34402014063a05c81754716f46b3f9059297f1d21d37da7e5f00b1eb8f7fdd46'
ACCEPTED_APP_ID = '9909bd54d31244627477bd60c3b8e7cc6cd84758902943e54eb555206c4a1142'
ACCEPTED_RUN = '34495273615'
ACCEPTED_NAME = '/arthello-direct-34495273615-1'
DATA_VOLUME = "arthello-direct-v44-data"
SCHOOL_SHA = "54242340f2d9b6a9887d69ecc03520ddf9f7982c"
SCHOOL_IMAGE = "sha256:664c2c0c3e628a53ca492953803b420e0c4a44acab35eb250f5f899c10bc93df"
MAXIMUM = 1024 * 1024


def require(condition):
    if not condition:
        raise ValueError("identity_mismatch")


def strict_json(content):
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result)
            result[key] = value
        return result
    return json.loads(content, object_pairs_hook=unique_object)


def validate_live(identities, app, image):
    require(identities == [ACCEPTED_APP_ID])
    require(app["Id"] == ACCEPTED_APP_ID and app["Name"] == ACCEPTED_NAME)
    require(app["Image"] == image["Id"] == ACCEPTED_IMAGE)
    require(app["State"]["Running"] is True and app["State"]["Paused"] is False
            and app["State"]["Restarting"] is False)
    require(app["HostConfig"]["ReadonlyRootfs"] is True)
    labels = app["Config"]["Labels"]
    require(labels["arthello.release.sha"] == ACCEPTED_SHA
            and labels["arthello.release.tree"] == ACCEPTED_TREE
            and labels["arthello.release.run"] == ACCEPTED_RUN)
    for config in (app["Config"], image["Config"]):
        require(config["User"] == "node" and config["Cmd"] == ["node", "production/runtime-server.mjs"])
    require(image["Config"]["Labels"]["org.opencontainers.image.revision"] == ACCEPTED_SHA
            and image["Config"]["Labels"]["org.opencontainers.image.source-tree"] == ACCEPTED_TREE)
    release_env = [value for value in app["Config"]["Env"] if value.partition("=")[0] == "RELEASE_SHA"]
    require(release_env == ["RELEASE_SHA=" + ACCEPTED_SHA])
    mounts = [item for item in app["Mounts"] if item.get("Destination") == "/data"]
    require(len(mounts) == 1 and mounts[0]["Type"] == "volume"
            and mounts[0]["Name"] == DATA_VOLUME and mounts[0]["RW"] is True)
    return {"kind": "r14-accepted-live-baseline", "result": "verified",
            "sourceSha": ACCEPTED_SHA, "imageId": ACCEPTED_IMAGE,
            "containerId": ACCEPTED_APP_ID, "browserAcceptance": "not_run"}


def validate_school(content):
    require(isinstance(content, str) and 0 < len(content.encode("utf-8")) <= 32768)
    observed = []
    for line in content.splitlines():
        try:
            value = strict_json(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and "imageId" in value and "release" in value:
            observed.append(value)
    require(len(observed) == 1)
    require(observed[0]["release"] == SCHOOL_SHA and observed[0]["imageId"] == SCHOOL_IMAGE
            and observed[0]["health"] == "healthy")
    return {"kind": "r14-accepted-school-identity", "result": "verified",
            "sourceSha": SCHOOL_SHA, "imageId": SCHOOL_IMAGE, "browserAcceptance": "not_run"}


def docker_read(arguments):
    result = subprocess.run(["docker", *arguments], capture_output=True, timeout=20,
                            env={"PATH": os.environ.get("PATH", "")})
    require(result.returncode == 0 and 0 < len(result.stdout) <= MAXIMUM)
    return result.stdout.decode("utf-8")


def observe_live(read=docker_read):
    identities = read(["container", "ls", "--quiet", "--no-trunc", "--filter", "name=^/arthello-direct-"]).splitlines()
    require(identities == [ACCEPTED_APP_ID])
    app = strict_json(read(["container", "inspect", ACCEPTED_APP_ID]))
    image = strict_json(read(["image", "inspect", ACCEPTED_IMAGE]))
    require(isinstance(app, list) and len(app) == 1 and isinstance(image, list) and len(image) == 1)
    result = validate_live(identities, app[0], image[0])
    require(read(["container", "ls", "--quiet", "--no-trunc", "--filter", "name=^/arthello-direct-"]).splitlines() == identities)
    final_app = strict_json(read(["container", "inspect", ACCEPTED_APP_ID]))
    require(isinstance(final_app, list) and len(final_app) == 1)
    validate_live(identities, final_app[0], image[0])
    return result


def read_school(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
                and info.st_uid == os.getuid() and info.st_nlink == 1 and 0 < info.st_size <= 32768)
        with os.fdopen(fd, "r", encoding="utf-8") as stream:
            fd = None
            return stream.read(32769)
    finally:
        if fd is not None:
            os.close(fd)


def main(arguments):
    try:
        if arguments == ["live"]:
            result = observe_live()
        else:
            require(len(arguments) == 2 and arguments[0] == "school")
            result = validate_school(read_school(arguments[1]))
    except Exception:
        print('{"kind":"r14-live-identity","result":"blocked","reason":"identity_mismatch"}')
        return 1
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
