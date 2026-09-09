"""D080 durable auth boundary; never restores a database or manufactures acceptance."""
import argparse
from contextlib import contextmanager
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import tempfile

FIELDS = set('releaseSha sourceTree runId runAttempt candidateContainerId candidateName previousContainerId previousName imageId runtimeFingerprint dataVolume rollbackVolume backupWorker backupVolume backupControlVolume bankActivationVolume bankActivationId browserSourceSha browserImageId browserFingerprint originalRouteSha256 maintenanceRouteSha256 publicRouteSha256 workDirectory originalRouteFile maintenanceRouteFile publicRouteFile gateNonceFile schoolRepairReceiptFile schoolRepairConfigSha256 schoolRepairReceiptSha256 schoolSha backupRuntimeStateFile'.split())
SHA40 = 'releaseSha sourceTree browserSourceSha schoolSha'.split()
SHA64 = 'candidateContainerId previousContainerId runtimeFingerprint bankActivationId browserFingerprint originalRouteSha256 maintenanceRouteSha256 publicRouteSha256 schoolRepairConfigSha256 schoolRepairReceiptSha256'.split()
WORK_FILES = 'originalRouteFile maintenanceRouteFile publicRouteFile gateNonceFile'.split()


def require(value, pattern):
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise ValueError('Invalid candidate state identity')
    return value


def absolute(value):
    path = Path(value)
    if not path.is_absolute() or '..' in path.parts or str(path) != value or str(path.resolve()) != value:
        raise ValueError('Invalid candidate state path')
    return path


def validate_context(context):
    if not isinstance(context, dict) or set(context) != FIELDS:
        raise ValueError('Incomplete candidate context')
    if not all(isinstance(value, str) for value in context.values()):
        raise ValueError('Invalid candidate context value')
    for key in SHA40:
        require(context[key], r'[a-f0-9]{40}')
    for key in SHA64:
        require(context[key], r'[a-f0-9]{64}')
    for key in ('imageId', 'browserImageId'):
        require(context[key], r'sha256:[a-f0-9]{64}')
    for key in ('runId', 'runAttempt'):
        require(context[key], r'[1-9][0-9]*')
    key = context['runId'] + '-' + context['runAttempt']
    names = {
        'candidateName': 'arthello-direct-', 'rollbackVolume': 'arthello-rollback-',
        'backupWorker': 'arthello-v52-backup-worker-', 'backupVolume': 'arthello-v52-backups-',
        'backupControlVolume': 'arthello-v52-backup-control-',
        'bankActivationVolume': 'arthello-v52-tochka-activation-',
    }
    for field, prefix in names.items():
        if context[field] != prefix + key:
            raise ValueError('Candidate resource belongs to another invocation')
    require(context['previousName'], r'arthello-direct-[A-Za-z0-9][A-Za-z0-9_.-]{0,120}')
    require(context['dataVolume'], r'[A-Za-z0-9][A-Za-z0-9_.-]{0,120}')
    if context['candidateContainerId'] == context['previousContainerId'] or context['candidateName'] == context['previousName']:
        raise ValueError('Candidate and previous runtime must differ')
    if context['browserSourceSha'] != context['releaseSha']:
        raise ValueError('Browser must belong to the reviewed release')
    if len({context[k] for k in ('originalRouteSha256', 'maintenanceRouteSha256', 'publicRouteSha256')}) != 3:
        raise ValueError('Candidate route phases must differ')
    work = absolute(context['workDirectory'])
    if work.name != 'arthello-deploy-' + key:
        raise ValueError('Candidate work directory belongs to another invocation')
    for field in WORK_FILES:
        if absolute(context[field]).parent != work:
            raise ValueError('Candidate route files must remain in the invocation directory')
    if len({context[k] for k in WORK_FILES}) != len(WORK_FILES):
        raise ValueError('Candidate files must be distinct')
    for field in ('schoolRepairReceiptFile', 'backupRuntimeStateFile'):
        absolute(context[field])
    return context


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def read_private(path):
    path = absolute(str(path))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_uid != os.geteuid() or metadata.st_nlink != 1:
            raise ValueError('Candidate evidence must be an owned private regular file')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            data = stream.read(65537)
        if len(data) > 65536:
            raise ValueError('Candidate evidence is too large')
        return json.loads(data)
    finally:
        os.close(fd)


def atomic(path, record, replace=False):
    path = absolute(str(path))
    parent = path.parent
    metadata = parent.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.geteuid() or stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ValueError('Candidate state directory must be private and owned')
    if path.is_symlink() or (path.exists() and not replace):
        raise ValueError('Existing candidate state cannot be overwritten')
    if replace:
        read_private(path)
    fd, temporary = tempfile.mkstemp(prefix='.d080-', dir=parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(canonical(record))
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            os.replace(temporary, path)
        else:
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


def now():
    return dt.datetime.now(dt.timezone.utc)


def state_path(path, context):
    if absolute(str(path)).name != 'candidate-acceptance-' + context['releaseSha'] + '.json':
        raise ValueError('Candidate state filename does not match the release')


def begin(path, context):
    validate_context(context)
    state_path(path, context)
    validate_repair(context)
    stamp = now().isoformat()
    record = dict(schemaVersion=1, phase='maintenance-started', context=context,
                  contextSha256=digest(context), latestAttempt=context['runAttempt'],
                  maintenanceStartedAtUtc=stamp, observedAtUtc=stamp)
    atomic(path, record)
    return record


def load_state(path):
    record = read_private(path)
    if record.get('schemaVersion') != 1 or record.get('phase') not in ('maintenance-started', 'candidate-verified', 'public-started'):
        raise ValueError('Invalid candidate state phase')
    context = validate_context(record['context'])
    state_path(path, context)
    if record.get('contextSha256') != digest(context):
        raise ValueError('Candidate context changed')
    require(record.get('latestAttempt'), r'[1-9][0-9]*')
    if int(record['latestAttempt']) < int(context['runAttempt']):
        raise ValueError('Candidate state attempt predates its runtime')
    started = dt.datetime.fromisoformat(record['maintenanceStartedAtUtc'])
    if started.tzinfo is None or started > now():
        raise ValueError('Invalid candidate boundary timestamp')
    validate_repair(context)
    return record


def validate_repair(context):
    repair = read_private(context['schoolRepairReceiptFile'])
    if digest(repair) != context['schoolRepairReceiptSha256'] or repair.get('schemaVersion') != 2 or repair.get('state') != 'verified' or repair.get('repairConfigSha256') != context['schoolRepairConfigSha256']:
        raise ValueError('School repair does not match the bound verified receipt')
    uid = repair.get('executionUid')
    if type(uid) is not int or not 0 < uid < 2**31:
        raise ValueError('Invalid School repair execution identity')
    require(repair.get('stateDirectorySha256'), r'[a-f0-9]{64}')
    activated = dt.datetime.fromisoformat(repair['activatedAtUtc'].replace('Z', '+00:00'))
    if activated.tzinfo is None or activated > now():
        raise ValueError('Invalid School repair activation timestamp')
    return repair


def validate_receipt(record, receipt, attempt, clock):
    require(attempt, r'[1-9][0-9]*')
    context = record['context']
    if int(attempt) < int(record['latestAttempt']):
        raise ValueError('Candidate receipt attempt is stale')
    if receipt.get('acceptancePhase') != 'candidate-maintenance' or receipt.get('candidateContainerId') != context['candidateContainerId'] or receipt.get('candidateContextSha256') != record['contextSha256']:
        raise ValueError('Receipt is not bound to this maintenance candidate')
    observed = dt.datetime.fromisoformat(receipt['observedAtUtc'].replace('Z', '+00:00'))
    started = dt.datetime.fromisoformat(record['maintenanceStartedAtUtc'])
    if observed.tzinfo is None or observed < started:
        raise ValueError('Candidate receipt predates the authentication boundary')
    repair = validate_repair(context)
    spec = importlib.util.spec_from_file_location('d080_schema3', Path(__file__).with_name('check-school-live-acceptance-r7.py'))
    schema = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(schema)
    schema.validate(receipt, context['releaseSha'], context['schoolSha'], context['releaseSha'],
                    context['schoolRepairConfigSha256'], repair['activatedAtUtc'],
                    repair['executionUid'], repair['stateDirectorySha256'], clock)
    reference = 'https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/' + context['runId'] + '/attempts/' + attempt
    if receipt.get('evidenceReference') != reference:
        raise ValueError('Candidate receipt belongs to another execution')


@contextmanager
def state_lock(path):
    path = absolute(str(path))
    parent = path.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.geteuid() or stat.S_IMODE(parent.st_mode) & 0o077:
        raise ValueError('Candidate lock directory must be private and owned')
    fd = os.open(str(path) + '.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_uid != os.geteuid() or metadata.st_nlink != 1:
            raise ValueError('Candidate lock must be a private regular file')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def advance(path, receipt, attempt, public=False, clock=None):
    # Serialize the entire read/validate/replace transition, so a late verified
    # writer can never rewind a concurrent durable public-started boundary.
    with state_lock(path):
        return _advance_locked(path, receipt, attempt, public, clock)


def _advance_locked(path, receipt, attempt, public, clock):
    record = load_state(path)
    if record['phase'] == 'public-started':
        raise ValueError('Public boundary cannot be replayed')
    validate_receipt(record, receipt, attempt, clock or now())
    receipt_hash = digest(receipt)
    if public and (record['phase'] != 'candidate-verified' or record.get('acceptanceSha256') != receipt_hash or record['latestAttempt'] != attempt):
        raise ValueError('Public activation requires this verified candidate receipt')
    record.update(phase='public-started' if public else 'candidate-verified',
                  latestAttempt=attempt, acceptanceSha256=receipt_hash,
                  acceptanceObservedAtUtc=receipt['observedAtUtc'], observedAtUtc=now().isoformat())
    atomic(path, record, replace=True)
    return record


def resume_check(path, release, run, attempt):
    record = load_state(path)
    require(attempt, r'[1-9][0-9]*')
    context = record['context']
    if record['phase'] not in ('maintenance-started', 'candidate-verified') or context['releaseSha'] != release or context['runId'] != run:
        raise ValueError('Candidate state does not permit this continuation')
    if int(attempt) <= int(context['runAttempt']) or int(attempt) < int(record['latestAttempt']):
        raise ValueError('Candidate continuation must be a later attempt')
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('begin', 'verified', 'public-start', 'resume-check'))
    parser.add_argument('--state', required=True)
    parser.add_argument('--context')
    parser.add_argument('--receipt')
    parser.add_argument('--release')
    parser.add_argument('--run')
    parser.add_argument('--attempt')
    args = parser.parse_args()
    try:
        if args.command == 'begin':
            begin(args.state, read_private(args.context))
        elif args.command == 'resume-check':
            resume_check(args.state, args.release, args.run, args.attempt)
        else:
            advance(args.state, read_private(args.receipt), args.attempt, public=args.command == 'public-start')
    except Exception:
        raise SystemExit('ARTHELLO_D080_CANDIDATE_STATE=BLOCKED')
    print('ARTHELLO_D080_CANDIDATE_STATE=' + args.command.upper().replace('-', '_'))


if __name__ == '__main__':
    main()
