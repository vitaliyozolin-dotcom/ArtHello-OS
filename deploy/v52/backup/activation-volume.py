#!/usr/bin/env python3
"""One-shot V2 bank activation writer; isolated UID and dedicated named volume."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
import re
import secrets
import stat
import sys

DIRECTORY = '/var/lib/arthello-v52-tochka-activation'
MARKER = 'tochka-autosync.activation'
SEED = '.activation-volume-v2.seed'
SEED_DATA = b'ARTHELLO_TOCHKA_ACTIVATION_VOLUME_V2\n'
LOCK = '.activation-volume-v2.lock'
WRITER_UID = 1002
READER_GID = 1000
MARKER_LIMIT = 160
PROTOCOL = re.compile(rb'ARTHELLO_TOCHKA_AUTOSYNC_V2 [0-9a-f]{40} [0-9a-f]{64}\n')


class ActivationError(Exception):
    """Only fixed diagnostic codes leave this process."""


def require(condition, code):
    if not condition:
        raise ActivationError(code)


def same_inode(left, right):
    return (left.st_dev, left.st_ino) == (right.st_dev, right.st_ino)


def validate_identity(sha, nonce):
    require(isinstance(sha, str) and re.fullmatch(r'[0-9a-f]{40}', sha), 'RELEASE_ID_INVALID')
    require(isinstance(nonce, str) and re.fullmatch(r'[0-9a-f]{64}', nonce), 'ACTIVATION_ID_INVALID')
    return f'ARTHELLO_TOCHKA_AUTOSYNC_V2 {sha} {nonce}\n'.encode('ascii')


def validate_writer():
    require(os.geteuid() == WRITER_UID and os.getegid() == READER_GID, 'WRITER_IDENTITY_INVALID')


def validate_directory(fd):
    value = os.fstat(fd)
    require(stat.S_ISDIR(value.st_mode), 'DIRECTORY_NOT_REGULAR')
    require(value.st_uid == WRITER_UID and value.st_gid == READER_GID, 'DIRECTORY_OWNER_INVALID')
    require(stat.S_IMODE(value.st_mode) == 0o750, 'DIRECTORY_MODE_INVALID')
    return value


def open_directory(path):
    require(path == DIRECTORY, 'DIRECTORY_PATH_INVALID')
    # Walk fixed ancestors by descriptor: O_NOFOLLOW must apply to every component.
    current = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        parts = DIRECTORY.strip('/').split('/')
        for index, part in enumerate(parts):
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=current)
            os.close(current)
            current = next_fd
            if index < len(parts) - 1:
                ancestor = os.fstat(current)
                require(ancestor.st_uid == 0 and not stat.S_IMODE(ancestor.st_mode) & 0o022, 'DIRECTORY_ANCESTOR_UNTRUSTED')
        validate_directory(current)
        result = current
        current = None
        return result
    finally:
        if current is not None:
            os.close(current)


def metadata(fd, mode, limit, code):
    value = os.fstat(fd)
    require(stat.S_ISREG(value.st_mode), code + '_NOT_REGULAR')
    require(value.st_uid == WRITER_UID and value.st_gid == READER_GID, code + '_OWNER_INVALID')
    require(value.st_nlink == 1, code + '_LINK_COUNT_INVALID')
    require(stat.S_IMODE(value.st_mode) == mode, code + '_MODE_INVALID')
    require(0 <= value.st_size <= limit, code + '_SIZE_INVALID')
    return value


def read_owned(fd, name, mode, limit, code):
    item = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=fd)
    try:
        before = metadata(item, mode, limit, code)
        data = os.read(item, limit + 1)
        after = metadata(item, mode, limit, code)
        require(same_inode(before, after) and before.st_mtime_ns == after.st_mtime_ns
                and before.st_ctime_ns == after.st_ctime_ns and len(data) == before.st_size,
                code + '_CHANGED_DURING_READ')
        require(same_inode(after, os.stat(name, dir_fd=fd, follow_symlinks=False)), code + '_PATH_CHANGED')
        return data, after
    finally:
        os.close(item)


def inspect_directory(fd, empty=False):
    validate_directory(fd)
    names = set(os.listdir(fd))
    require(names <= {SEED, MARKER, LOCK}, 'DIRECTORY_UNEXPECTED_ENTRY')
    require(SEED in names, 'SEED_MISSING')
    seed, _ = read_owned(fd, SEED, 0o440, len(SEED_DATA), 'SEED')
    require(seed == SEED_DATA, 'SEED_CONTENT_INVALID')
    if LOCK in names:
        lock_data, _ = read_owned(fd, LOCK, 0o600, 0, 'LOCK')
        require(lock_data == b'', 'LOCK_CONTENT_INVALID')
    if MARKER not in names:
        return None
    require(not empty, 'MARKER_ALREADY_PRESENT')
    content, marker_meta = read_owned(fd, MARKER, 0o640, MARKER_LIMIT, 'MARKER')
    require(PROTOCOL.fullmatch(content), 'MARKER_PROTOCOL_INVALID')
    return content, marker_meta


def receipt(sha, nonce, data, mode):
    return {
        'schemaVersion': 1, 'state': 'verified', 'mode': mode, 'protocol': 'ARTHELLO_TOCHKA_AUTOSYNC_V2',
        'releaseSha': sha, 'activationId': nonce, 'executionUid': WRITER_UID, 'executionGid': READER_GID,
        'markerMode': '0640', 'contentSha256': hashlib.sha256(data).hexdigest(),
        'verifiedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


def write_at(fd, sha, nonce):
    """Descriptor entry point for tests; CLI always obtains the fixed directory."""
    validate_writer()
    data = validate_identity(sha, nonce)
    inspect_directory(fd)
    lock = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, 0o600, dir_fd=fd)
    temporary = None
    try:
        metadata(lock, 0o600, 0, 'LOCK')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(same_inode(os.fstat(lock), os.stat(LOCK, dir_fd=fd, follow_symlinks=False)), 'LOCK_PATH_CHANGED')
        before = inspect_directory(fd)
        if before is not None and before[0] == data:
            # A previous writer may have died after rename but before directory
            # fsync. Re-observing equal bytes alone does not prove durability.
            existing = os.open(MARKER, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=fd)
            try:
                current = metadata(existing, 0o640, MARKER_LIMIT, 'MARKER')
                require(same_inode(current, before[1]) and os.read(existing, MARKER_LIMIT + 1) == data,
                        'MARKER_CHANGED_DURING_REPLAY')
                os.fsync(existing)
                os.fsync(fd)
            finally:
                os.close(existing)
            require(inspect_directory(fd)[0] == data, 'MARKER_VERIFY_FAILED')
            return receipt(sha, nonce, data, 'verified-existing')
        temporary = '.activation-stage-' + secrets.token_hex(16)
        staged = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o640, dir_fd=fd)
        try:
            # File creation is by UID1002:GID1000. There is no runtime chown.
            os.fchmod(staged, 0o640)
            metadata(staged, 0o640, MARKER_LIMIT, 'STAGED')
            count = 0
            while count < len(data):
                written = os.write(staged, data[count:])
                require(written > 0, 'MARKER_SHORT_WRITE')
                count += written
            os.fsync(staged)
            metadata(staged, 0o640, MARKER_LIMIT, 'STAGED')
        finally:
            os.close(staged)
        # Recheck the target before atomic publication. A prior foreign or
        # modified object is never replaced, even when a valid marker was read.
        try:
            current = os.stat(MARKER, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            require(before is None, 'MARKER_CHANGED_BEFORE_PUBLICATION')
        else:
            require(before is not None and same_inode(current, before[1])
                    and current.st_ctime_ns == before[1].st_ctime_ns,
                    'MARKER_CHANGED_BEFORE_PUBLICATION')
        os.replace(temporary, MARKER, src_dir_fd=fd, dst_dir_fd=fd)
        temporary = None
        os.fsync(fd)
        after = inspect_directory(fd)
        require(after is not None and after[0] == data, 'MARKER_VERIFY_FAILED')
        return receipt(sha, nonce, data, 'created' if before is None else 'replaced')
    finally:
        if temporary is not None:
            try:
                os.unlink(temporary, dir_fd=fd)
            except FileNotFoundError:
                pass
        os.close(lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    empty = sub.add_parser('check-empty')
    empty.add_argument('--directory', required=True)
    write = sub.add_parser('write')
    write.add_argument('--directory', required=True)
    write.add_argument('--release-sha', required=True)
    write.add_argument('--nonce', required=True)
    args = parser.parse_args()
    try:
        validate_writer()
        if args.command == 'write':
            validate_identity(args.release_sha, args.nonce)
        fd = open_directory(args.directory)
        try:
            if args.command == 'check-empty':
                inspect_directory(fd, empty=True)
                result = {'schemaVersion': 1, 'state': 'empty-verified', 'executionUid': WRITER_UID,
                          'executionGid': READER_GID, 'directoryMode': '0750', 'markerPresent': False}
            else:
                result = write_at(fd, args.release_sha, args.nonce)
        finally:
            os.close(fd)
        print(json.dumps(result, sort_keys=True))
        return 0
    except ActivationError as error:
        print(json.dumps({'state': 'refused', 'code': str(error)}, sort_keys=True), file=sys.stderr)
    except BlockingIOError:
        print(json.dumps({'state': 'refused', 'code': 'ACTIVATION_BUSY'}, sort_keys=True), file=sys.stderr)
    except OSError:
        print(json.dumps({'state': 'refused', 'code': 'FILESYSTEM_PRECONDITION_FAILED'}, sort_keys=True), file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
