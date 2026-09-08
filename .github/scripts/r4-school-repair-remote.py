"""D066: validated bundle transport plus exact caller-owned lock mode repair.

No privilege transition or environment-controlled paths. The controller takes
the existing shared School lock before state/network mutations; transport checks
that capability read-only before creating its own private staging directory.
"""
import base64
import errno
import fcntl
import datetime
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


EXPECTED_UID = 1000
EXPECTED_GID = 1000
SOURCE_MODE = 0o664
TARGET_MODE = 0o644
STAGE = 'not_started'

class Refused(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise Refused(reason)


def caller_identity():
    uid, gid = os.geteuid(), os.getegid()
    require(uid > 0 and uid == os.getuid() == EXPECTED_UID and
            gid == os.getgid() == EXPECTED_GID, 'confirmed_deployment_identity_required')
    return uid, gid


def validate_metadata(info, uid, gid):
    require(stat.S_ISREG(info.st_mode), 'lock_not_regular')
    require(info.st_uid == uid and info.st_gid == gid, 'lock_owner_or_group_changed')
    require(info.st_nlink == 1, 'lock_link_count_changed')
    require(stat.S_IMODE(info.st_mode) in (SOURCE_MODE, TARGET_MODE), 'lock_mode_outside_reviewed_pair')


def current_locked_metadata(fd, original, uid, gid):
    opened = os.fstat(fd)
    current = LOCK_PATH.lstat()
    validate_metadata(opened, uid, gid)
    validate_metadata(current, uid, gid)
    require((original.st_dev, original.st_ino) == (opened.st_dev, opened.st_ino) ==
            (current.st_dev, current.st_ino), 'lock_inode_changed')
    require(stat.S_IMODE(opened.st_mode) == stat.S_IMODE(current.st_mode), 'lock_mode_changed_during_check')
    return opened


def normalize():
    fd = None
    attempted = False
    stage = 'identity'
    try:
        uid, gid = caller_identity()
        stage = 'initial_metadata'
        original = LOCK_PATH.lstat()
        validate_metadata(original, uid, gid)
        stage = 'open_existing_lock'
        fd = os.open(LOCK_PATH, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
        stage = 'acquire_shared_lock'
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        stage = 'locked_metadata'
        before = current_locked_metadata(fd, original, uid, gid)
        previous = stat.S_IMODE(before.st_mode)
        if previous == SOURCE_MODE:
            stage = 'remove_group_write'
            attempted = True
            os.fchmod(fd, TARGET_MODE)
            # Persist the one metadata change before reporting verified success.
            os.fsync(fd)
        stage = 'verify_metadata'
        after = current_locked_metadata(fd, original, uid, gid)
        require(stat.S_IMODE(after.st_mode) == TARGET_MODE, 'lock_mode_not_verified')
        result = {'schemaVersion': 1, 'decisionId': 'D066', 'state': 'verified',
                  'mode': 'normalized' if attempted else 'verified-existing',
                  'executionUid': uid, 'executionGid': gid,
                  'previousMode': format(previous, '04o'), 'currentMode': '0644',
                  'lockDevice': after.st_dev, 'lockInode': after.st_ino,
                  'modeChangeAttempted': attempted,
                  'verifiedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')}
    except (Refused, OSError) as error:
        if isinstance(error, Refused):
            reason = str(error)
        elif error.errno in (errno.EACCES, errno.EPERM):
            reason = 'permission_denied'
        elif error.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
            reason = 'shared_lock_busy'
        elif error.errno == errno.ENOENT:
            reason = 'lock_missing'
        elif error.errno == errno.ELOOP:
            reason = 'lock_symlink_refused'
        else:
            reason = 'os_operation_failed'
        result = {'schemaVersion': 1, 'decisionId': 'D066', 'state': 'refused',
                  'stage': stage, 'reason': reason, 'modeChangeAttempted': attempted}
    finally:
        if fd is not None:
            # Closing the existing descriptor also releases the advisory lock.
            # No path-based cleanup and no mode rollback on any later failure.
            try:
                os.close(fd)
            except OSError:
                result = {'schemaVersion': 1, 'decisionId': 'D066', 'state': 'refused',
                          'stage': 'close_existing_lock', 'reason': 'descriptor_close_failed',
                          'modeChangeAttempted': attempted}
    return result


def main():
    global STAGE
    STAGE = 'ordinary_identity'
    uid = os.geteuid()
    if not 0 < uid < 2**31 or os.getuid() != uid or os.getgid() != os.getegid():
        raise ValueError('Ordinary deployment-user execution required')
    STAGE = 'protected_environment'
    protected = validated_environment()
    STAGE = 'passwd_home'
    home = checked_home(Path(pwd.getpwuid(uid).pw_dir), uid)
    root = home / '.arthello-school-sso-relay'
    STAGE = 'existing_private_state'
    if root.exists() or root.is_symlink():
        checked_private(root, uid)
    STAGE = 'bounded_reviewed_bundle'
    raw = sys.stdin.buffer.read(1_048_577)
    decoded = decode_bundle(raw, protected['EXPECTED_REPAIR_BUNDLE_SHA256'])
    # All identities, existing-state constraints, and exact transported bytes
    # are validated before the sole permission change on the existing lock.
    STAGE = 'normalize_existing_shared_lock'
    normalization = normalize()
    print(json.dumps(normalization, sort_keys=True, separators=(',', ':')), file=sys.stderr, flush=True)
    if normalization['state'] != 'verified':
        raise ValueError('Existing shared lock normalization refused')
    STAGE = 'strict_existing_shared_lock'
    checked_shared_lock(uid)
    STAGE = 'create_private_staging'
    os.umask(0o077)
    try:
        root.mkdir(mode=0o700)
        sync_directory(home)
    except FileExistsError:
        pass
    checked_private(root, uid)
    work = Path(tempfile.mkdtemp(prefix='.incoming-', dir=root))
    checked_private(work, uid)
    primary_error = None
    primary_stage = None
    try:
        STAGE = 'write_validated_staging_bundle'
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
        environment.pop('R4_BOOTSTRAP_BASE64', None)
        STAGE = 'execute_unchanged_reviewed_r3_controller'
        result = subprocess.run([sys.executable, '-I', str(work / 'repair.py')], env=environment,
                                stdin=subprocess.DEVNULL, timeout=600)
        if result.returncode:
            raise SystemExit(result.returncode)
    except BaseException as error:
        primary_error, primary_stage = error, STAGE
    finally:
        STAGE = 'cleanup_own_private_staging'
        try:
            checked_private(work, uid)
            shutil.rmtree(work)
            sync_directory(root)
        except Exception as cleanup_error:
            if primary_error is None:
                raise
            # Preserve the original failure and report cleanup independently.
            print(json.dumps(sanitized_failure(cleanup_error), sort_keys=True, separators=(',', ':')),
                  file=sys.stderr, flush=True)
    if primary_error is not None:
        STAGE = primary_stage
        raise primary_error
    STAGE = 'completed'


ERROR_CODES = {
    'Invalid protected repair identity': 'protected_identity_invalid',
    'Repair bundle transport digest mismatch': 'bundle_transport_digest_invalid',
    'Invalid repair bundle envelope': 'bundle_envelope_invalid',
    'Only exact School relay bundle files are allowed': 'bundle_file_set_invalid',
    'Invalid repair bundle file size': 'bundle_file_size_invalid',
    'Existing School lock is unsafe': 'strict_shared_lock_unsafe',
    'Deployment home must be canonical': 'passwd_home_not_canonical',
    'Deployment home ancestry is unsafe': 'passwd_home_ancestry_unsafe',
    'Deployment home has a different owner': 'passwd_home_owner_changed',
    'Deployment state must be private and caller-owned': 'private_state_invalid',
    'Ordinary deployment-user execution required': 'ordinary_identity_required',
    'Existing shared lock normalization refused': 'shared_lock_normalization_refused',
}


def sanitized_failure(error):
    if isinstance(error, OSError):
        reason = {errno.EACCES: 'permission_denied', errno.EPERM: 'operation_not_permitted',
                  errno.ENOENT: 'missing', errno.ELOOP: 'symlink_refused',
                  errno.ENOTDIR: 'not_directory', errno.EIO: 'io_error'}.get(error.errno, 'other_os_error')
    elif isinstance(error, KeyError):
        reason = 'required_metadata_missing'
    elif isinstance(error, subprocess.TimeoutExpired):
        reason = 'controller_timeout'
    else:
        reason = ERROR_CODES.get(str(error), 'bootstrap_contract_invalid')
    return {'schemaVersion': 1, 'component': 'D066-bootstrap', 'state': 'refused',
            'stage': STAGE, 'reason': reason}


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        print(json.dumps(sanitized_failure(error), sort_keys=True, separators=(',', ':')), file=sys.stderr)
        sys.exit(1)
