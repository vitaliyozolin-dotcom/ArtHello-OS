"""D065: reviewed bundle transport using only existing deployment-user rights.

No privilege transition or environment-controlled paths. The controller takes
the existing shared School lock before state/network mutations; transport checks
that capability read-only before creating its own private staging directory.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import stat
import subprocess
import sys
import tempfile

FILES = {'manifest.json', 'repair.py', 'relay.mjs', 'healthcheck.mjs'}
LOCK_PATH = Path('/var/lock/school-1-11-production.lock')
ENVIRONMENTS = {
    'RELEASE_SHA': r'[a-f0-9]{40}',
    'RELEASE_RUN_ID': r'[1-9][0-9]{0,19}',
    'RELEASE_ATTEMPT': r'[1-9][0-9]{0,2}',
    'EXPECTED_REPAIR_CONFIG_SHA256': r'[a-f0-9]{64}',
    'EXPECTED_REPAIR_BUNDLE_SHA256': r'[a-f0-9]{64}',
}


def validated_environment():
    result = {}
    for name, pattern in ENVIRONMENTS.items():
        value = os.environ.get(name, '')
        if not re.fullmatch(pattern, value):
            raise ValueError('Invalid protected repair identity')
        result[name] = value
    return result


def decode_bundle(raw, expected_digest):
    if not 0 < len(raw) <= 1_048_576 or hashlib.sha256(raw).hexdigest() != expected_digest:
        raise ValueError('Repair bundle transport digest mismatch')
    envelope = json.loads(raw)
    if set(envelope) != {'schemaVersion', 'files'} or envelope['schemaVersion'] != 1:
        raise ValueError('Invalid repair bundle envelope')
    files = envelope['files']
    if not isinstance(files, dict) or set(files) != FILES:
        raise ValueError('Only exact School relay bundle files are allowed')
    decoded = {}
    for name, encoded in files.items():
        data = base64.b64decode(encoded, validate=True)
        if not 0 < len(data) <= 262_144:
            raise ValueError('Invalid repair bundle file size')
        decoded[name] = data
    return decoded


def checked_shared_lock(uid):
    fd = os.open(LOCK_PATH, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info, current = os.fstat(fd), LOCK_PATH.lstat()
        if not (stat.S_ISREG(info.st_mode) and info.st_uid in (0, uid) and
                info.st_nlink == 1 and not stat.S_IMODE(info.st_mode) & 0o022 and
                (info.st_dev, info.st_ino) == (current.st_dev, current.st_ino)):
            raise ValueError('Existing School lock is unsafe')
    finally:
        os.close(fd)


def checked_home(home, uid):
    if any(char in str(home) for char in (',', '\n', '\r', '\0')) or not home.is_absolute() or home == Path('/') or home.resolve() != home:
        raise ValueError('Deployment home must be canonical')
    for ancestor in [*reversed(home.parents), home]:
        info = ancestor.lstat()
        if not (stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and
                info.st_uid in (0, uid) and not stat.S_IMODE(info.st_mode) & 0o022):
            raise ValueError('Deployment home ancestry is unsafe')
    if home.lstat().st_uid != uid:
        raise ValueError('Deployment home has a different owner')
    return home


def checked_private(path, uid):
    info = path.lstat()
    if not (stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and
            info.st_uid == uid and stat.S_IMODE(info.st_mode) == 0o700):
        raise ValueError('Deployment state must be private and caller-owned')


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def main():
    uid = os.geteuid()
    if not 0 < uid < 2**31 or os.getuid() != uid or os.getgid() != os.getegid():
        raise ValueError('Ordinary deployment-user execution required')
    protected = validated_environment()
    checked_shared_lock(uid)
    home = checked_home(Path(pwd.getpwuid(uid).pw_dir), uid)
    root = home / '.arthello-school-sso-relay'
    if root.exists() or root.is_symlink():
        checked_private(root, uid)
    raw = sys.stdin.buffer.read(1_048_577)
    decoded = decode_bundle(raw, protected['EXPECTED_REPAIR_BUNDLE_SHA256'])
    os.umask(0o077)
    try:
        root.mkdir(mode=0o700)
        sync_directory(home)
    except FileExistsError:
        pass
    checked_private(root, uid)
    work = Path(tempfile.mkdtemp(prefix='.incoming-', dir=root))
    checked_private(work, uid)
    try:
        for name, data in decoded.items():
            target = work / name
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        sync_directory(work)
        environment = dict(os.environ, **protected, REPAIR_BUNDLE_DIR=str(work))
        environment.pop('R3_BOOTSTRAP_BASE64', None)
        result = subprocess.run([sys.executable, '-I', str(work / 'repair.py')], env=environment,
                                stdin=subprocess.DEVNULL, timeout=600)
        if result.returncode:
            raise SystemExit(result.returncode)
    finally:
        # Only this invocation's unpredictable own incoming directory is removed.
        checked_private(work, uid)
        shutil.rmtree(work)
        sync_directory(root)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError):
        raise SystemExit('SCHOOL_R3_BOOTSTRAP=BLOCKED: deployment identity, existing shared lock, private state or bundle invalid')
