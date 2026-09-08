#!/usr/bin/env python3
"""Read-only continuation of the verified R5 School relay installation.

The immutable R5 library is authenticated in memory from a bounded stdin bundle.
Its installer is never called. Installation identity is deliberately independent
of the ArtHello candidate using the resulting fresh configuration receipt.
"""
import base64
import datetime
import hashlib
import ipaddress
import json
import os
import re
import stat
import subprocess
import sys
import types

INSTALL_SHA = 'ee8f3080d941a12be357eec0fd1d902acd01a2f9'
INSTALL_RUN = '34208952716'
INSTALL_ATTEMPT = '1'
CONFIG_SHA = '2ba0ad1ce530db9c9abb622e5727e6345ab74a85699e121b718d9a0405b1f40a'
RUNTIME_SHA = '1bdef8cee0ed6e5b69e4aeaa24ae4a7441487dc5e69b9c4f48d9a125a47204a9'
STATE_SHA = 'cedd256dabc1dc6ff105887d31b5893bb384cdfe751b532e0c115d69ff6bfeee'
SCHOOL_ID = 'bab402851b23dc6e34f1c8d273f97535d2a2e0f6485d821f3f9420c228dd29b7'
RELAY_ID = 'b6939c754019bfa4c873b2b1b3bc7fb3fcf2542cd72be3981fdbcec6335794b3'
ACTIVATED_AT = '2026-09-08T09:16:10Z'
SCHOOL_STARTED_AT = '2026-09-03T11:13:44.872449964Z'
FILE_HASHES = {
    'manifest.json': '3f243868ec16acb8837a120bb626c927c05cd964810fe3dad41ea2024163769b',
    'repair.py': '5d947a82413e193a558ac412be08d7a47988d2c97fa711e7c2a54511711de0f0',
    'relay.mjs': '9d425e2e414253cc1b4aec9024ffbef0f91fcf7f11b09aa6f2555060034dd4e3',
    'healthcheck.mjs': 'ed88c4f592293871b113b9f7a2e1826864882f31933b3742b8a211ceccf61c83',
}
MAX_BUNDLE = 262144


class Refused(Exception):
    pass


def require(value, code):
    if not value:
        raise Refused(code)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate_json_key')
        result[key] = value
    return result


def strict_json(content):
    return json.loads(content, object_pairs_hook=unique_object)


def forbidden(*args, **kwargs):
    raise Refused('mutation_or_installer_forbidden')


def load_controller(content):
    require(isinstance(content, bytes) and 0 < len(content) <= MAX_BUNDLE, 'bundle_size_invalid')
    envelope = strict_json(content)
    require(isinstance(envelope, dict) and set(envelope) == {'schemaVersion', 'files'} and
            type(envelope['schemaVersion']) is int and envelope['schemaVersion'] == 1 and
            isinstance(envelope['files'], dict) and set(envelope['files']) == set(FILE_HASHES), 'bundle_contract_invalid')
    files = {}
    for name, expected in FILE_HASHES.items():
        value = envelope['files'][name]
        require(isinstance(value, str) and len(value) <= 131072, 'bundle_file_size_invalid')
        decoded = base64.b64decode(value, validate=True)
        require(hashlib.sha256(decoded).hexdigest() == expected, 'immutable_file_digest_mismatch')
        files[name] = decoded
    # Execute only authenticated definitions, with the __main__ entry disabled.
    r = types.ModuleType('immutable_school_relay_r5')
    r.__file__ = '<authenticated-R5-memory>'
    exec(compile(files['repair.py'], r.__file__, 'exec'), r.__dict__)
    manifest = strict_json(files['manifest.json'])
    require(r.digest(manifest) == CONFIG_SHA and manifest['schemaVersion'] == 2 and
            manifest['decisionId'] == r.OWNER == 'D067' and
            manifest['files'] == {name: FILE_HASHES[name] for name in r.FILES}, 'manifest_identity_invalid')
    require(manifest['school'] == {'container': r.SCHOOL, 'sourceSha': r.SOURCE, 'imageId': r.IMAGE, 'network': r.BACKEND} and
            manifest['relay'] == {'container': r.RELAY, 'egressNetwork': r.EGRESS, 'hostname': r.HOSTNAME,
                                 'upstream': '188.225.38.55:443', 'uid': 1001, 'gid': 1001}, 'manifest_contract_invalid')
    for name in ('repair', 'main', 'publish_bytes', 'write_json', 'sync_directory', 'free_backend_ip'):
        setattr(r, name, forbidden)
    original_private_dir = r.private_dir

    def private_dir(path, uid, create=False):
        require(create is False, 'state_creation_forbidden')
        return original_private_dir(path, uid, create=False)

    r.private_dir = private_dir
    # Stored JSON is also strict; no ambiguous duplicate metadata is accepted.
    r.load_json = lambda path, uid, mode=0o600: strict_json(r.read_owned(path, uid, mode, 262144))
    return r, manifest


class ReadOnlyDocker:
    def __init__(self, r):
        self.r = r
        self.peer_ids = set()
        self.relay_ip = None

    def execute(self, args, stdin, timeout):
        try:
            result = subprocess.run(args, input=stdin, text=True, capture_output=True,
                                    timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise Refused('readonly_command_unavailable_or_timeout') from None
        require(result.returncode == 0 and len(result.stdout) <= 2097152, 'readonly_command_failed')
        return result.stdout

    def inspect(self, kind, name, optional=False):
        r = self.r
        allowed = {'container': {r.SCHOOL, SCHOOL_ID, r.RELAY, RELAY_ID} | self.peer_ids,
                   'network': {r.BACKEND, r.EGRESS}, 'image': {r.IMAGE}}
        require(optional is False and name in allowed.get(kind, set()), 'inspect_outside_installed_scope')
        values = strict_json(self.execute(['docker', kind, 'inspect', name], None, 20))
        require(isinstance(values, list) and len(values) == 1 and isinstance(values[0], dict), 'inspect_invalid')
        return values[0]

    def run(self, args, stdin=None, timeout=30):
        if args == ['docker', 'exec', RELAY_ID, 'node', '/relay/healthcheck.mjs']:
            require(stdin is None and timeout == 15, 'healthcheck_contract_invalid')
        elif args == ['docker', 'exec', '-i', SCHOOL_ID, 'node', '-', self.relay_ip]:
            require(self.relay_ip is not None and stdin == self.r.PROBE_JS and timeout == 25, 'school_probe_contract_invalid')
        else:
            raise Refused('non_readonly_command_forbidden')
        return self.execute(args, stdin, timeout)


def continuation_identity(environ):
    values = [environ.get(name, '') for name in ('RELEASE_SHA', 'RELEASE_RUN_ID', 'RELEASE_ATTEMPT')]
    require(re.fullmatch('[0-9a-f]{40}', values[0]) and values[0] != INSTALL_SHA and
            re.fullmatch('[1-9][0-9]*', values[1]) and values[1] != INSTALL_RUN and
            re.fullmatch('[1-9][0-9]*', values[2]), 'continuation_identity_invalid')
    return tuple(values)


def check_clock():
    now = datetime.datetime.now(datetime.timezone.utc)
    activated = datetime.datetime.fromisoformat(ACTIVATED_AT.replace('Z', '+00:00'))
    require(now >= activated, 'host_clock_precedes_installation')
    return now.isoformat(timespec='seconds').replace('+00:00', 'Z')


def snapshot(r, manifest, uid, state_root, docker):
    state_dir = state_root / CONFIG_SHA
    state_sha = hashlib.sha256(str(state_dir).encode('utf-8')).hexdigest()
    require(state_sha == STATE_SHA, 'installed_state_path_changed')
    r.private_dir(state_root, uid)
    r.private_dir(state_dir, uid)
    relay_dir = state_dir / 'relay'
    relay_info = relay_dir.lstat()
    require(stat.S_ISDIR(relay_info.st_mode) and not relay_dir.is_symlink() and
            relay_info.st_uid == uid and stat.S_IMODE(relay_info.st_mode) == 0o755, 'relay_directory_not_owned')
    school = r.inspect('container', r.SCHOOL)
    backend = r.inspect('network', r.BACKEND)
    require(school['Id'] == SCHOOL_ID and school['State']['StartedAt'] == SCHOOL_STARTED_AT, 'installed_school_changed')
    school_ip = r.school_identity(school, backend)
    fingerprint, backend_fingerprint = r.school_fingerprint(school), r.network_fingerprint(backend)
    peer_ids = set(backend.get('Containers') or {})
    require(SCHOOL_ID in peer_ids and RELAY_ID in peer_ids and
            all(re.fullmatch('[0-9a-f]{64}', value) for value in peer_ids), 'backend_membership_invalid')
    docker.peer_ids = peer_ids
    existing = r.inspect('container', r.RELAY)
    egress = r.inspect('network', r.EGRESS)
    require(existing['Id'] == RELAY_ID and re.fullmatch('[0-9a-f]{64}', egress['Id']), 'installed_relay_identity_changed')
    image = r.inspect('image', r.IMAGE)
    require(image['Id'] == r.IMAGE, 'installed_image_missing')
    image_env, image_labels = image['Config'].get('Env') or [], image['Config'].get('Labels') or {}
    safe_image_env = {'PATH', 'NODE_VERSION', 'YARN_VERSION', 'NODE_ENV', 'PORT', 'HOSTNAME', 'NEXT_TELEMETRY_DISABLED',
                      'NEXT_PUBLIC_SCHOOL_PARENT_OTP_ENABLED', 'NEXT_PUBLIC_SCHOOL_DESIGN_V1', 'DATABASE_PATH'}
    require(all(item.split('=', 1)[0] in safe_image_env for item in image_env), 'image_env_not_allowlisted')
    require(set(image_labels) <= {'org.opencontainers.image.revision', 'org.opencontainers.image.source'}, 'image_labels_not_allowlisted')
    before = r.load_json(state_dir / 'before.json', uid)
    saved = r.load_json(state_dir / 'state.json', uid)
    runtime = r.load_json(relay_dir / 'runtime.json', uid, 0o444)
    require(r.digest(runtime) == RUNTIME_SHA and set(runtime) == {'bindAddress', 'schoolAddress', 'executionUid', 'stateDirectorySha256'} and
            runtime['schoolAddress'] == school_ip and type(runtime['executionUid']) is int and runtime['executionUid'] == uid and
            runtime['stateDirectorySha256'] == state_sha, 'installed_runtime_changed')
    bind_ip = str(ipaddress.IPv4Address(runtime['bindAddress']))
    require(bind_ip == runtime['bindAddress'] and bind_ip != school_ip, 'relay_bind_invalid')
    labels = r.labels_for(CONFIG_SHA, school, backend, school_ip, ACTIVATED_AT,
                          {'sha': INSTALL_SHA, 'run': INSTALL_RUN, 'attempt': INSTALL_ATTEMPT}) | {
        r.PREFIX + 'execution-uid': str(uid), r.PREFIX + 'state-directory-sha256': state_sha}
    expected_before = {'schemaVersion': 2, 'executionUid': uid, 'stateDirectorySha256': state_sha,
                       'schoolId': SCHOOL_ID, 'schoolImageId': r.IMAGE, 'schoolSourceSha': r.SOURCE,
                       'schoolFingerprint': fingerprint, 'backendFingerprint': backend_fingerprint,
                       'backendId': backend['Id'], 'schoolAddress': school_ip, 'observedAtUtc': before.get('observedAtUtc')}
    require(before == expected_before and type(before['executionUid']) is int and type(before['schemaVersion']) is int,
            'configuration_backup_mismatch')
    observed = datetime.datetime.fromisoformat(before['observedAtUtc'].replace('Z', '+00:00'))
    activated = datetime.datetime.fromisoformat(ACTIVATED_AT.replace('Z', '+00:00'))
    require(observed.tzinfo is not None and observed <= activated,
            'configuration_backup_timestamp_invalid')
    expected_state = {'schemaVersion': 2, 'executionUid': uid, 'stateDirectorySha256': state_sha,
                      'repairConfigSha256': CONFIG_SHA, 'schoolFingerprint': fingerprint,
                      'backendFingerprint': backend_fingerprint, 'relayId': RELAY_ID, 'egressId': egress['Id'],
                      'labels': labels, 'runtimeConfigSha256': RUNTIME_SHA}
    require(saved == expected_state and type(saved['executionUid']) is int and type(saved['schemaVersion']) is int,
            'installed_state_or_original_release_changed')
    require(r.load_json(state_dir / 'manifest.json', uid) == manifest, 'deployed_manifest_changed')
    for filename in ('relay.mjs', 'healthcheck.mjs'):
        require(r.sha_file(relay_dir / filename, uid, 0o444) == manifest['files'][filename], 'deployed_script_changed')
    r.verify_network(egress, labels)
    r.verify_relay(existing, egress, backend, state_dir, labels, runtime, image_env, image_labels)
    require(existing['State'].get('Running') is True and existing['State'].get('Health', {}).get('Status') == 'healthy', 'relay_not_healthy')
    r.alias_free(backend, RELAY_ID)
    # Membership may contain other unchanged applications; their aliases are checked
    # individually above. Preserve complete relevant snapshots across the probes.
    return {'schoolFingerprint': fingerprint, 'backendFingerprint': backend_fingerprint,
            'relayFingerprint': r.school_fingerprint(existing), 'egressFingerprint': r.digest(egress),
            'stateFingerprint': r.digest(saved), 'beforeFingerprint': r.digest(before),
            'imageFingerprint': r.digest(image), 'bindAddress': bind_ip}


def verify(r, manifest, environ=None):
    continuation_identity(os.environ if environ is None else environ)
    check_clock()
    require((os.getuid(), os.geteuid(), os.getgid(), os.getegid()) == (1000, 1000, 1000, 1000), 'exact_ordinary_identity_required')
    uid, state_root = r.caller_context()
    require(uid == 1000, 'exact_ordinary_identity_required')
    fd = r.open_shared_lock(uid)
    try:
        lock = os.fstat(fd)
        require(lock.st_uid == uid and lock.st_gid == 1000 and stat.S_IMODE(lock.st_mode) == 0o644,
                'installed_shared_lock_changed')
        docker = ReadOnlyDocker(r)
        r.inspect, r.run = docker.inspect, docker.run
        before = snapshot(r, manifest, uid, state_root, docker)
        docker.relay_ip = before['bindAddress']
        r.run(['docker', 'exec', RELAY_ID, 'node', '/relay/healthcheck.mjs'], timeout=15)
        probe = r.probe(SCHOOL_ID, docker.relay_ip)
        require(probe.get('dnsOk') is True and probe.get('expectedRelayOnly') is True and probe.get('healthy') is True and
                probe.get('httpStatus') == 200 and probe.get('databaseAvailable') is True, 'school_normal_dns_tls_health_failed')
        require(snapshot(r, manifest, uid, state_root, docker) == before, 'installed_configuration_changed_during_probe')
        current = r.LOCK_PATH.lstat()
        require((current.st_dev, current.st_ino, current.st_uid, current.st_gid, current.st_mode, current.st_nlink) ==
                (lock.st_dev, lock.st_ino, lock.st_uid, lock.st_gid, lock.st_mode, lock.st_nlink), 'shared_lock_changed_during_probe')
        return {'schemaVersion': 2, 'executionUid': uid, 'stateDirectorySha256': STATE_SHA,
                'state': 'verified', 'mode': 'verified-existing', 'repairConfigSha256': CONFIG_SHA,
                'runtimeConfigSha256': RUNTIME_SHA, 'schoolSourceSha': r.SOURCE, 'schoolImageId': r.IMAGE,
                'schoolContainerId': SCHOOL_ID, 'relayContainerId': RELAY_ID,
                'activatedAtUtc': ACTIVATED_AT, 'verifiedAtUtc': check_clock()}
    finally:
        os.close(fd)


def main():
    r = None
    try:
        r, manifest = load_controller(sys.stdin.buffer.read(MAX_BUNDLE + 1))
        receipt = verify(r, manifest)
        print(json.dumps(receipt, sort_keys=True))
        return 0
    except Exception as error:
        code = str(error) if isinstance(error, Refused) or (r is not None and isinstance(error, r.Refused)) else 'readonly_contract_or_state_invalid'
        print(json.dumps({'schemaVersion': 2, 'state': 'refused', 'reason': code}, sort_keys=True))
        return 1


if __name__ == '__main__':
    sys.exit(main())
