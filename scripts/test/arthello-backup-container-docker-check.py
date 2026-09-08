#!/usr/bin/env python3
"""Assertions run only against disposable hosted Docker backup fixtures."""
import argparse
import concurrent.futures
import datetime as dt
import errno
import http.client
import json
import os
from pathlib import Path
import signal
import socket
import sqlite3
import stat
import tempfile
import threading
import time

ROOT = Path('/var/backups/arthello-v52')
CONTROL = Path('/var/lib/arthello-v52-backup-control')
ACTIVATION = Path('/var/lib/arthello-v52-tochka-activation')
DATABASE = Path('/data/d1/fixture.sqlite')
MARKER = ACTIVATION / 'tochka-autosync.activation'
WAL_VALUE = 'committed-row-present-only-in-live-wal'


def owned(path, uid, gid, mode, *, directory=True):
    info = path.lstat()
    assert (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (uid, gid, mode), str(path)
    assert stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)


def denied(action):
    try:
        result = action()
        if isinstance(result, int):
            os.close(result)
    except OSError as exc:
        assert exc.errno in (errno.EROFS, errno.EACCES, errno.EPERM), exc.errno
    else:
        raise AssertionError('Unexpected write authority')


def source(directory, kind):
    assert os.geteuid() == (1002 if kind == 'foreign' else 1000)
    os.umask(0o077)
    if directory.exists():
        assert directory.is_dir() and directory.stat().st_uid == os.geteuid()
        directory.chmod(0o700)
    else:
        directory.mkdir(mode=0o700)
    database = directory / 'fixture.sqlite'
    db = sqlite3.connect(database)
    db.executescript('CREATE TABLE app_users(id INTEGER PRIMARY KEY);'
                     'CREATE TABLE entities(id INTEGER PRIMARY KEY, value TEXT);'
                     'CREATE TABLE system_runtime_state(id INTEGER PRIMARY KEY);'
                     'CREATE TABLE fixture_counter(id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL);'
                     'CREATE TABLE fixture_write_log(seq INTEGER PRIMARY KEY);'
                     'INSERT INTO fixture_counter VALUES(1, 0);'
                     "INSERT INTO entities VALUES(1, 'checkpointed-row');")
    db.commit()
    if kind != 'wal':
        db.close()
        if kind == 'mode':
            database.chmod(0o666)
        print('FIXTURE_SOURCE_CREATED', flush=True)
        return
    assert db.execute('PRAGMA journal_mode=WAL').fetchone()[0] == 'wal'
    db.execute('PRAGMA wal_autocheckpoint=0')
    assert db.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0] == 0
    # The committed sentinel must remain in WAL while the backup reader uses RO.
    db.execute('INSERT INTO entities VALUES(2, ?)', (WAL_VALUE,))
    db.commit()
    assert Path(str(database) + '-wal').stat().st_size > 32
    # immutable is deliberately confined to this negative test observation:
    # it proves the main file alone cannot supply the row under test.
    check = sqlite3.connect(database.as_uri() + '?immutable=1', uri=True)
    assert check.execute('SELECT count(*) FROM entities WHERE id=2').fetchone()[0] == 0
    check.close()
    stopped = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    signal.signal(signal.SIGINT, lambda *_: stopped.set())

    def transaction():
        # Both tables change in one actual committed transaction. Every online
        # snapshot must see the same count even while this producer keeps writing.
        with db:
            db.execute('UPDATE fixture_counter SET value=value+1 WHERE id=1')
            counter = db.execute('SELECT value FROM fixture_counter WHERE id=1').fetchone()[0]
            db.execute('INSERT INTO fixture_write_log(seq) VALUES(?)', (counter,))

    transaction()
    print('FIXTURE_LIVE_COMMITTED_WAL_READY', flush=True)
    while not stopped.wait(0.05):
        transaction()
    db.close()


class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(str(CONTROL / 'control.sock'))


def request(method='GET', path='/status', host='backup.internal'):
    connection = UnixHTTP('backup.internal', timeout=5)
    try:
        connection.request(method, path, headers={'Host': host, 'Content-Length': '0'})
        response = connection.getresponse()
        body = response.read(1_000_001)
        assert len(body) <= 1_000_000
        return response.status, json.loads(body)
    finally:
        connection.close()


def status():
    code, result = request()
    assert code == 200
    assert result['scope'] == 'arthello_database' and result['storage'] == 'same_server'
    assert result['retentionDays'] == 14
    assert isinstance(result['history'], list)
    return result


def idle():
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        result = status()
        if result['state'] == 'idle' and result['schedule']['enabled'] and result['history']:
            assert result['unreadableCopies'] == 0
            assert all(item['status'] == 'verified_at_creation' for item in result['history'])
            return result
        assert result['state'] != 'failed'
        time.sleep(0.2)
    raise AssertionError('Worker did not become verified and idle')


def manifest_checks():
    owned(ROOT, 1000, 1000, 0o700)
    manifests = list(ROOT.glob('arthello-v52-*/manifest.json'))
    assert manifests, 'No completed backup manifest'
    counters = []
    for path in manifests:
        owned(path.parent, 1000, 1000, 0o700)
        owned(path, 1000, 1000, 0o600, directory=False)
        value = json.loads(path.read_text())
        assert value['format'] == 'arthello-v52-sqlite-backup-v1'
        assert value['restoreVerified'] is True and value['integrityCheck'] == 'ok'
        assert value['backupId'] == path.parent.name
        database = path.parent / 'database.sqlite'
        owned(database, 1000, 1000, 0o600, directory=False)
        db = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
        assert db.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
        assert db.execute('SELECT value FROM entities WHERE id=2').fetchone() == (WAL_VALUE,)
        assert db.execute('SELECT count(*) FROM entities').fetchone() == (2,)
        counter, records, last_record = db.execute(
            'SELECT (SELECT value FROM fixture_counter WHERE id=1),'
            '(SELECT count(*) FROM fixture_write_log),'
            '(SELECT max(seq) FROM fixture_write_log)').fetchone()
        assert counter == records == last_record and counter > 0, 'Inconsistent concurrent transaction snapshot'
        counters.append(counter)
        db.close()
        assert not Path(str(database) + '-wal').exists()
    print(json.dumps({'verifiedManifests': len(manifests), 'liveWalRowCopied': True,
                      'minimumCommittedCounter': min(counters), 'maximumCommittedCounter': max(counters)}))


def manual():
    assert os.geteuid() == 1000
    before = idle()
    # Cover real directory read-only mounting as well as the fixed socket route.
    denied(lambda: os.open(CONTROL / 'forbidden-app-file', os.O_WRONLY | os.O_CREAT, 0o600))
    assert not list(ROOT.glob('arthello-v52-*')), 'Backup data accidentally exposed to app'
    assert request('POST', '/anything-else')[0] == 403
    assert request('POST', '/create', 'wrong.internal')[0] == 403
    # Allow the initial admission window to expire. This does not set worker time.
    time.sleep(5.2)
    before = idle()
    next_at = dt.datetime.fromisoformat(before['schedule']['nextAt'])
    assert next_at.tzinfo is not None
    # If the daily job is due imminently, observe its completion before measuring
    # manual request cardinality. Never disable or forge the real schedule.
    if next_at <= dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=100):
        deadline = time.monotonic() + 110
        while time.monotonic() < deadline:
            if dt.datetime.fromisoformat(status()['schedule']['nextAt']) > next_at:
                break
            time.sleep(0.5)
        else:
            raise AssertionError('Due automatic backup did not advance its schedule')
        time.sleep(5.2)
        before = idle()
    previous = {item['id'] for item in before['history']}
    barrier = threading.Barrier(6)

    def create(_):
        barrier.wait(timeout=5)
        return request('POST', '/create')[0]

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        responses = list(executor.map(create, range(6)))
    assert sorted(responses) == [202, 409, 409, 409, 409, 409], responses
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        after = idle()
        current = {item['id'] for item in after['history']}
        if current != previous:
            assert previous.issubset(current) and len(current - previous) == 1
            print('ARTHELLO_BACKUP_HOSTED_SOCKET_MANUAL_ADMISSION=PASS')
            print(json.dumps({'previousCopies': len(previous), 'currentCopies': len(current)}))
            return
        time.sleep(0.2)
    raise AssertionError('Accepted manual backup did not publish a verified manifest')


def isolation(kind):
    assert os.geteuid() == 1000
    denied(lambda: os.open(DATABASE, os.O_WRONLY)) if kind == 'worker' else None
    if kind == 'worker':
        denied(lambda: os.open(Path('/data') / 'forbidden-worker-file', os.O_WRONLY | os.O_CREAT, 0o600))
        assert not MARKER.exists(), 'Worker unexpectedly sees activation volume marker'
    else:
        expected = ('ARTHELLO_TOCHKA_AUTOSYNC_V2 ' + 'a' * 40 + ' ' + 'b' * 64 + '\n').encode()
        assert MARKER.read_bytes() == expected
        denied(lambda: os.open(MARKER, os.O_WRONLY | os.O_TRUNC))
        denied(lambda: os.chmod(MARKER, 0o660))
        denied(lambda: os.unlink(MARKER))
        assert MARKER.read_bytes() == expected
        assert not list(ROOT.glob('arthello-v52-*'))
    denied(lambda: os.open(ACTIVATION / 'forbidden-activation-write', os.O_WRONLY | os.O_CREAT, 0o600))
    print('ARTHELLO_BACKUP_HOSTED_' + kind.upper() + '_ISOLATION=PASS')


def overdue():
    """Simulate one missed schedule slot only in a stopped disposable worker."""
    assert os.geteuid() == os.getegid() == 1000
    state = ROOT / '.worker-state.json'
    owned(state, 1000, 1000, 0o600, directory=False)
    value = json.loads(state.read_text())
    assert value['schemaVersion'] == 1 and value['state'] == 'idle'
    assert value['activeAttempt'] is None and value['initialVerifiedAt']
    manifest = ROOT / value['lastVerifiedBackupId'] / 'manifest.json'
    assert json.loads(manifest.read_text())['restoreVerified'] is True
    now = dt.datetime.now(dt.timezone.utc)
    due = now.replace(hour=0, minute=15, second=0, microsecond=0)
    if now < due:
        due -= dt.timedelta(days=1)
    value['lastDueSlot'] = (due - dt.timedelta(days=1)).isoformat()
    value['nextRetryAt'] = None
    descriptor, temporary = tempfile.mkstemp(prefix='.fixture-state-', dir=ROOT)
    try:
        with os.fdopen(descriptor, 'w') as handle:
            os.fchmod(handle.fileno(), 0o600)
            json.dump(value, handle)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, state)
        descriptor = os.open(ROOT, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        Path(temporary).unlink(missing_ok=True)
    print('FIXTURE_ONLY_PREVIOUS_DUE_SLOT_RECORDED')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['source', 'seed', 'manifests', 'manual', 'isolation', 'status', 'unchanged-source', 'overdue'])
    parser.add_argument('--kind', default='wal')
    parser.add_argument('--directory', default='/data/d1')
    args = parser.parse_args()
    if args.action == 'source':
        source(Path(args.directory), args.kind)
    elif args.action == 'seed':
        assert os.geteuid() == 1000
        owned(ROOT, 1000, 1000, 0o700)
        owned(CONTROL, 1000, 1000, 0o750)
        owned(ACTIVATION, 1002, 1000, 0o750)
        owned(ACTIVATION / '.activation-volume-v2.seed', 1002, 1000, 0o440, directory=False)
        print('ARTHELLO_BACKUP_HOSTED_VOLUME_COPYUP_OWNERSHIP=PASS')
    elif args.action == 'manifests':
        manifest_checks()
    elif args.action == 'manual':
        manual()
    elif args.action == 'isolation':
        isolation(args.kind)
    elif args.action == 'status':
        print(json.dumps(idle(), sort_keys=True))
    elif args.action == 'overdue':
        overdue()
    else:
        owned(DATABASE, 1000, 1000, 0o600, directory=False)
        assert Path(str(DATABASE) + '-wal').stat().st_size > 32
        db = sqlite3.connect(DATABASE.as_uri() + '?mode=ro', uri=True)
        assert db.execute('SELECT count(*) FROM entities').fetchone() == (2,)
        assert db.execute('SELECT value FROM entities WHERE id=2').fetchone() == (WAL_VALUE,)
        counter, records = db.execute(
            'SELECT (SELECT value FROM fixture_counter WHERE id=1),'
            '(SELECT count(*) FROM fixture_write_log)').fetchone()
        assert counter == records and counter > 0
        db.close()
        print('ARTHELLO_BACKUP_HOSTED_SOURCE_PRESERVED=PASS')


if __name__ == '__main__':
    main()
