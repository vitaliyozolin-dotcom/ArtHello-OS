#!/usr/bin/env python3
"""Read-only fixed-scope diagnostic for the failed D065 School bootstrap.

No file contents, paths, account names, environment values or Docker stderr are
printed. This program takes no arguments and performs no filesystem, locking,
container, network, authentication or application mutation.
"""
import datetime
import errno
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys

CONFIG_SHA = '7a358ba8a8c69d67d5dffcd3f2047967f43c33292b4c4767a9a20a1e02d36278'
SCHOOL_SHA = '54242340f2d9b6a9887d69ecc03520ddf9f7982c'
SCHOOL_IMAGE = 'sha256:664c2c0c3e628a53ca492953803b420e0c4a44acab35eb250f5f899c10bc93df'
SCHOOL_STARTED = '2026-09-03T11:13:44.872449964Z'
LOCK = Path('/var/lock/school-1-11-production.lock')
STATE_LEAF = '.arthello-school-sso-relay'
SCHOOL = 'school-1-11'
RELAY = 'school-arthello-sso-relay'
BACKEND = 'arthello-os_backend'
EGRESS = 'school-arthello-sso-egress'
LABEL_PREFIX = 'arthello.school-sso-relay.'
ALLOWED_ERRNOS = {
    errno.EACCES: 'permission_denied', errno.EPERM: 'operation_not_permitted',
    errno.ENOENT: 'missing', errno.ENOTDIR: 'not_directory',
    errno.ELOOP: 'symlink_loop_or_refused', errno.EIO: 'io_error',
    errno.EMFILE: 'process_file_limit', errno.ENFILE: 'system_file_limit',
    errno.ENAMETOOLONG: 'name_too_long',
}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def error_code(error):
    if isinstance(error, OSError):
        return ALLOWED_ERRNOS.get(error.errno, 'other_os_error')
    if isinstance(error, KeyError):
        return 'passwd_entry_missing'
    if isinstance(error, subprocess.TimeoutExpired):
        return 'command_timeout'
    return 'invalid_metadata'


def path_digest(path):
    return hashlib.sha256(str(path).encode('utf-8')).hexdigest()


def metadata(info):
    mode = info.st_mode
    kind = ('regular' if stat.S_ISREG(mode) else 'directory' if stat.S_ISDIR(mode)
            else 'symlink' if stat.S_ISLNK(mode) else 'other')
    return {'type': kind, 'uid': info.st_uid, 'gid': info.st_gid,
            'mode': format(stat.S_IMODE(mode), '04o'), 'links': info.st_nlink,
            'groupOrWorldWritable': bool(stat.S_IMODE(mode) & 0o022)}


def observe_metadata(path):
    try:
        info = path.lstat()
        return {'exists': True, 'error': None, **metadata(info)}, info
    except (OSError, ValueError) as error:
        return {'exists': False if isinstance(error, FileNotFoundError) else None,
                'error': error_code(error)}, None


def directory_checks(info, uid, private=False):
    if info is None:
        return {'valid': None}
    checks = {'directory': stat.S_ISDIR(info.st_mode),
              'notSymlink': not stat.S_ISLNK(info.st_mode),
              'callerOwned': info.st_uid == uid,
              'rootOrCallerOwned': info.st_uid in (0, uid),
              'notGroupOrWorldWritable': not bool(stat.S_IMODE(info.st_mode) & 0o022)}
    if private:
        checks['mode0700'] = stat.S_IMODE(info.st_mode) == 0o700
        checks['valid'] = all(checks[key] for key in ('directory', 'notSymlink', 'callerOwned', 'mode0700'))
    else:
        checks['valid'] = all(checks[key] for key in ('directory', 'notSymlink', 'rootOrCallerOwned', 'notGroupOrWorldWritable'))
    return checks


def observe_home(uid):
    try:
        raw = pwd.getpwuid(uid).pw_dir
        home = Path(raw)
        structural = {'absolute': home.is_absolute(), 'notRoot': home != Path('/'),
                      'safeCharacters': not any(char in raw for char in (',', '\n', '\r', '\0'))}
        try:
            structural['canonical'] = home.resolve() == home
        except (OSError, ValueError, RuntimeError) as error:
            structural['canonical'] = None
            structural['canonicalError'] = error_code(error)
        record = {'pathSha256': path_digest(home), 'checks': structural, 'ancestors': []}
        # Reject malformed passwd paths before any derived state path is inspected.
        if not all(structural.get(key) is True for key in ('absolute', 'notRoot', 'safeCharacters', 'canonical')):
            record['valid'] = False
            return record, None
        valid = True
        for index, path in enumerate([*reversed(home.parents), home]):
            item, info = observe_metadata(path)
            checks = directory_checks(info, uid)
            if path == home:
                checks['valid'] = checks['valid'] is True and checks['callerOwned'] is True if info else None
            item.update(index=index, isHome=path == home, checks=checks)
            record['ancestors'].append(item)
            valid = valid and checks['valid'] is True
        record['valid'] = valid
        # Even on an unsafe directory mode the canonical passwd path is known;
        # state inspection below performs metadata only and never opens contents.
        return record, home
    except (OSError, ValueError, KeyError, TypeError) as error:
        return {'valid': False, 'error': error_code(error)}, None


def observe_lock(uid):
    record, original = observe_metadata(LOCK)
    if original is None:
        record.update(readable=None if record['exists'] is None else False, valid=False)
        return record
    checks = {'regular': stat.S_ISREG(original.st_mode),
              'rootOrCallerOwned': original.st_uid in (0, uid),
              'singleLink': original.st_nlink == 1,
              'notGroupOrWorldWritable': not bool(stat.S_IMODE(original.st_mode) & 0o022)}
    if not checks['regular']:
        # Merely opening a device or FIFO can itself have side effects. A
        # symlink likewise needs no open attempt to establish this blocker.
        record.update(readable=None, openError='not_regular', checks=checks, valid=False)
        return record
    descriptor = None
    try:
        # Never creates/writes/truncates the lock and does not acquire a flock.
        descriptor = os.open(LOCK, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
        opened = os.fstat(descriptor)
        current = LOCK.lstat()
        checks['stableInode'] = ((original.st_dev, original.st_ino) ==
                                 (opened.st_dev, opened.st_ino) ==
                                 (current.st_dev, current.st_ino))
        checks['openedRegular'] = stat.S_ISREG(opened.st_mode)
        checks['openedRootOrCallerOwned'] = opened.st_uid in (0, uid)
        checks['openedSingleLink'] = opened.st_nlink == 1
        checks['openedNotGroupOrWorldWritable'] = not bool(stat.S_IMODE(opened.st_mode) & 0o022)
        record['readable'] = True
        record['openError'] = None
    except OSError as error:
        record['readable'] = False
        record['openError'] = error_code(error)
    finally:
        if descriptor is not None:
            os.close(descriptor)
    record['checks'] = checks
    record['valid'] = record['readable'] is True and all(checks.values())
    return record


def observe_state(home, uid):
    if home is None:
        return {'observed': False, 'reason': 'passwd_path_not_safe_to_derive'}
    root = home / STATE_LEAF
    target = root / CONFIG_SHA
    output = {'observed': True, 'rootPathSha256': path_digest(root),
              'configurationPathSha256': path_digest(target), 'configurationSha256': CONFIG_SHA}
    root_record, root_info = observe_metadata(root)
    root_record['checks'] = directory_checks(root_info, uid, private=True)
    output['root'] = root_record
    # Do not traverse a symlink/non-directory/foreign or insecure state root.
    if root_info is None or root_record['checks']['valid'] is not True:
        output['configuration'] = {'observed': False, 'reason': 'root_missing_or_not_safe_to_traverse'}
        return output
    target_record, target_info = observe_metadata(target)
    target_record['checks'] = directory_checks(target_info, uid, private=True)
    output['configuration'] = target_record
    if target_info is None or target_record['checks']['valid'] is not True:
        return output
    output['fixedFiles'] = {}
    for name in ('state.json', 'before.json', 'manifest.json', 'relay'):
        output['fixedFiles'][name] = observe_metadata(target / name)[0]
    # No file contents, arbitrary directory listing, or symlink traversal.
    return output


def docker_command(arguments):
    try:
        result = subprocess.run(arguments, stdin=subprocess.DEVNULL, capture_output=True,
                                text=True, timeout=20, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        return None, error_code(error)
    if result.returncode != 0:
        # Never pass through stderr: it may include socket paths or daemon data.
        error = result.stderr.strip()
        kind, name = arguments[1], arguments[-1]
        exact_absent = f'Error response from daemon: No such {kind}: {name}'
        alternate_absent = f'Error: No such {kind}: {name}'
        if error in (exact_absent, alternate_absent):
            return None, 'object_missing'
        return None, 'docker_read_unavailable'
    if len(result.stdout) > 4_194_304:
        return None, 'docker_metadata_too_large'
    try:
        values = json.loads(result.stdout)
        if not isinstance(values, list) or len(values) != 1 or not isinstance(values[0], dict):
            return None, 'docker_metadata_invalid'
        return values[0], None
    except (ValueError, TypeError):
        return None, 'docker_metadata_invalid'


def hex_value(value, size=64, prefix=''):
    return value if isinstance(value, str) and re.fullmatch(re.escape(prefix) + '[a-f0-9]{' + str(size) + '}', value) else None


def timestamp(value):
    return value if isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z', value) else None


def safe_repair_labels(labels):
    if not isinstance(labels, dict):
        return {'validObject': False}
    owner = labels.get(LABEL_PREFIX + 'owner')
    execution = labels.get(LABEL_PREFIX + 'execution-uid')
    return {'owner': 'D065' if owner == 'D065' else 'missing' if owner is None else 'other',
            'configurationSha256': hex_value(labels.get(LABEL_PREFIX + 'config-sha256')),
            'configurationMatches': labels.get(LABEL_PREFIX + 'config-sha256') == CONFIG_SHA,
            'executionUid': int(execution) if isinstance(execution, str) and re.fullmatch('[1-9][0-9]{0,9}', execution) and int(execution) < 2**31 else None,
            'stateDirectorySha256': hex_value(labels.get(LABEL_PREFIX + 'state-directory-sha256')),
            'releaseSha': hex_value(labels.get(LABEL_PREFIX + 'release-sha'), 40),
            'activatedAtUtc': timestamp(labels.get(LABEL_PREFIX + 'activated-at'))}


def container_record(raw, name):
    config, state, host = raw.get('Config') or {}, raw.get('State') or {}, raw.get('HostConfig') or {}
    labels = config.get('Labels') or {}
    networks = (raw.get('NetworkSettings') or {}).get('Networks') or {}
    mode = host.get('NetworkMode')
    uid = config.get('User')
    result = {'exists': True, 'error': None, 'id': hex_value(raw.get('Id')),
              'nameMatches': raw.get('Name') == '/' + name,
              'imageId': hex_value(raw.get('Image'), prefix='sha256:'),
              'running': state.get('Running') if type(state.get('Running')) is bool else None,
              'health': (state.get('Health') or {}).get('Status') if (state.get('Health') or {}).get('Status') in ('healthy', 'unhealthy', 'starting') else None,
              'startedAtUtc': timestamp(state.get('StartedAt')),
              'configuredUser': uid if isinstance(uid, str) and re.fullmatch(r'[0-9]{1,10}(?::[0-9]{1,10})?', uid) else 'unspecified' if uid == '' else 'other',
              'networkMode': mode if mode in (BACKEND, EGRESS, 'none', 'host', 'bridge') else 'other',
              'networkCount': len(networks), 'onBackend': BACKEND in networks, 'onEgress': EGRESS in networks,
              'sourceSha': hex_value(labels.get('school.candidate-sha'), 40)}
    if name == SCHOOL:
        result['baselineChecks'] = {'imageMatches': raw.get('Image') == SCHOOL_IMAGE,
            'sourceMatches': labels.get('school.candidate-sha') == SCHOOL_SHA,
            'systemLabelMatches': labels.get('school.system') == SCHOOL,
            'productionLabelMatches': labels.get('school.environment') == 'production',
            'networkModeMatches': mode == BACKEND, 'onlyBackendNetwork': set(networks) == {BACKEND},
            'startedAtMatches': state.get('StartedAt') == SCHOOL_STARTED}
    else:
        result['repairLabels'] = safe_repair_labels(labels)
    return result


def network_record(raw, name, school_id, relay_id):
    members = raw.get('Containers') or {}
    return {'exists': True, 'error': None, 'id': hex_value(raw.get('Id')),
            'nameMatches': raw.get('Name') == name,
            'bridgeDriver': raw.get('Driver') == 'bridge',
            'internal': raw.get('Internal') if type(raw.get('Internal')) is bool else None,
            'ipv6Enabled': raw.get('EnableIPv6') if type(raw.get('EnableIPv6')) is bool else None,
            'memberCount': len(members), 'containsSchool': school_id in members if school_id else None,
            'containsRelay': relay_id in members if relay_id else None,
            'repairLabels': safe_repair_labels(raw.get('Labels') or {})}


def observe_docker():
    output, raw_records = {}, {}
    # These four commands are literal and exhaustive. No input-selected target.
    for key, command in (
        ('school', ['docker', 'container', 'inspect', SCHOOL]),
        ('relay', ['docker', 'container', 'inspect', RELAY]),
        ('backend', ['docker', 'network', 'inspect', BACKEND]),
        ('egress', ['docker', 'network', 'inspect', EGRESS]),
    ):
        raw, error = docker_command(command)
        raw_records[key] = (raw, error)
    daemon_observed = any(raw is not None for raw, _ in raw_records.values())
    for key in ('school', 'relay', 'backend', 'egress'):
        raw, error = raw_records[key]
        if raw is None:
            output[key] = {'exists': False if error == 'object_missing' and daemon_observed else None, 'error': error}
            continue
        try:
            if key in ('school', 'relay'):
                output[key] = container_record(raw, SCHOOL if key == 'school' else RELAY)
            else:
                school_raw = raw_records['school'][0] or {}
                relay_raw = raw_records['relay'][0] or {}
                output[key] = network_record(raw, BACKEND if key == 'backend' else EGRESS,
                    hex_value(school_raw.get('Id')), hex_value(relay_raw.get('Id')))
        except (ValueError, TypeError, KeyError, AttributeError):
            output[key] = {'exists': True, 'error': 'docker_metadata_invalid'}
    output['daemonObserved'] = daemon_observed
    return output


def diagnose():
    output = {'schemaVersion': 1, 'diagnostic': 'D065-bootstrap-read-only', 'startedAtUtc': now()}
    uid, real_uid, gid, real_gid = os.geteuid(), os.getuid(), os.getegid(), os.getgid()
    output['caller'] = {'effectiveUid': uid, 'realUid': real_uid, 'effectiveGid': gid, 'realGid': real_gid,
                        'ordinaryIdentityValid': 0 < uid < 2**31 and uid == real_uid and gid == real_gid}
    output['lock'] = observe_lock(uid)
    output['home'], home = observe_home(uid)
    output['state'] = observe_state(home, uid)
    output['docker'] = observe_docker()
    state_root = output['state'].get('root') or {}
    state_ok = state_root.get('exists') is False or (state_root.get('checks') or {}).get('valid') is True
    ordered = [('ordinary_identity', output['caller']['ordinaryIdentityValid']),
               ('existing_shared_lock', output['lock']['valid']),
               ('passwd_home', output['home']['valid']),
               ('existing_private_state', state_ok)]
    output['firstFailedComparablePrecondition'] = next((name for name, passed in ordered if not passed), None)
    output['notObserved'] = ['original_transport_environment', 'original_bundle_bytes',
                             'original_exception_stage', 'original_cleanup_result', 'lock_acquisition']
    output['completedAtUtc'] = now()
    return output


if __name__ == '__main__':
    if len(sys.argv) != 1:
        print(json.dumps({'schemaVersion': 1, 'error': 'arguments_not_allowed'}))
        sys.exit(2)
    try:
        print(json.dumps(diagnose(), sort_keys=True, separators=(',', ':')))
    except Exception as error:
        # No traceback or exception text: either can expose passwd paths.
        print(json.dumps({'schemaVersion': 1, 'error': error_code(error)}))
        sys.exit(1)
