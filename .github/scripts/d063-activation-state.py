"""Durable D063 publication boundary and post-verification bank activation."""
import datetime
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile


def exact(value, pattern):
    if not re.fullmatch(pattern, value):
        raise ValueError('Invalid release state identity')
    return value


def atomic_write(path, data, mode=0o600, gid=None, replace=False):
    path = Path(path)
    parent = path.parent
    if not parent.is_absolute() or parent.is_symlink() or not parent.is_dir():
        raise ValueError('Release state directory must be a real absolute directory')
    if path.is_symlink() or (path.exists() and not replace):
        raise ValueError('Existing release state must not be replayed')
    fd, temporary = tempfile.mkstemp(prefix='.d063-', dir=parent)
    try:
        os.fchmod(fd, mode)
        if gid is not None:
            os.fchown(fd, 0, gid)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            os.replace(temporary, path)
        else:
            # Atomic no-replace publication; a concurrent existing marker fails.
            os.link(temporary, path, follow_symlinks=False)
            os.unlink(temporary)
        directory_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def begin(path, sha, run, attempt, candidate, previous, rollback, original_route, candidate_route, work):
    record = {
        'schemaVersion': 1, 'state': 'activation-started',
        'releaseSha': exact(sha, r'[a-f0-9]{40}'),
        'runId': exact(run, r'[1-9][0-9]*'),
        'runAttempt': exact(attempt, r'[1-9][0-9]*'),
        'candidateContainerId': exact(candidate, r'[a-f0-9]{64}'),
        'previousContainerId': exact(previous, r'[a-f0-9]{64}'),
        'rollbackVolume': exact(rollback, r'arthello-rollback-[1-9][0-9]*-[1-9][0-9]*'),
        'originalRouteSha256': exact(original_route, r'[a-f0-9]{64}'),
        'candidateRouteSha256': exact(candidate_route, r'[a-f0-9]{64}'),
        'diagnosticDirectory': work,
        'observedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    if not Path(work).is_absolute() or Path(work).name != f'arthello-deploy-{run}-{attempt}':
        raise ValueError('Invalid diagnostic directory')
    atomic_write(path, (json.dumps(record, sort_keys=True) + '\n').encode())
    return record


def enable_autosync(directory, sha, nonce, gid):
    exact(sha, r'[a-f0-9]{40}')
    exact(nonce, r'[a-f0-9]{32}')
    exact(gid, r'[0-9]+')
    if os.geteuid() != 0:
        raise ValueError('Bank activation must be written by root')
    directory = Path(directory)
    if str(directory) != '/var/lib/arthello-v52-backup-control':
        raise ValueError('Unexpected bank activation directory')
    metadata = directory.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_gid != int(gid):
        raise ValueError('Unexpected bank activation directory ownership')
    data = f'ARTHELLO_TOCHKA_AUTOSYNC_V1 {sha} {nonce}\n'.encode('ascii')
    atomic_write(directory / 'tochka-autosync.activation', data, mode=0o640, gid=int(gid), replace=True)


if __name__ == '__main__':
    command, *arguments = sys.argv[1:]
    if command == 'activation-start':
        begin(*arguments)
        print('ARTHELLO_PUBLIC_ACTIVATION_BOUNDARY=DURABLE')
    elif command == 'enable-autosync':
        enable_autosync(*arguments)
        print('ARTHELLO_TOCHKA_AUTOSYNC_ACTIVATION=VERIFIED')
    else:
        raise ValueError('Unknown release state operation')
