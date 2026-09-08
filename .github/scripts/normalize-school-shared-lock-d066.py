#!/usr/bin/env python3
"""D066: remove only group-write from the confirmed caller-owned School lock.

The sole permitted mutation is fchmod(existing validated locked fd, 0644).
There are no arguments, environment-selected paths, privilege transitions,
content reads/writes, file creation, lock replacement, or rollback to 0664.
"""
import datetime
import errno
import fcntl
import json
import os
from pathlib import Path
import stat
import sys

LOCK_PATH = Path('/var/lock/school-1-11-production.lock')
EXPECTED_UID = 1000
EXPECTED_GID = 1000
SOURCE_MODE = 0o664
TARGET_MODE = 0o644


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


if __name__ == '__main__':
    if len(sys.argv) != 1:
        print(json.dumps({'schemaVersion': 1, 'decisionId': 'D066', 'state': 'refused',
                          'reason': 'arguments_not_allowed', 'modeChangeAttempted': False}))
        sys.exit(2)
    try:
        receipt = normalize()
        print(json.dumps(receipt, sort_keys=True, separators=(',', ':')))
        sys.exit(0 if receipt['state'] == 'verified' else 1)
    except Exception:
        # An unexpected error must not disclose paths or make a no-mutation claim.
        print(json.dumps({'schemaVersion': 1, 'decisionId': 'D066', 'state': 'refused',
                          'reason': 'unexpected_normalizer_error', 'modeChangeAttempted': None}))
        sys.exit(1)
