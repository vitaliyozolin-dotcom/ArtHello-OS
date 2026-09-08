#!/usr/bin/env python3
"""D064: narrow, configuration-only School HTTPS relay. No application writes."""
import datetime
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time
import tempfile

SCHOOL = 'school-1-11'
SOURCE = '54242340f2d9b6a9887d69ecc03520ddf9f7982c'
IMAGE = 'sha256:664c2c0c3e628a53ca492953803b420e0c4a44acab35eb250f5f899c10bc93df'
BACKEND = 'arthello-os_backend'
RELAY = 'school-arthello-sso-relay'
EGRESS = 'school-arthello-sso-egress'
HOSTNAME = 'arthello-188-225-38-55.sslip.io'
PREFIX = 'arthello.school-sso-relay.'
OWNER = 'D064'
STATE_ROOT = Path('/var/lib/school-arthello-sso-relay')
LOCK_PATH = Path('/var/lock/school-1-11-production.lock')
FILES = ('repair.py', 'relay.mjs', 'healthcheck.mjs')

class Refused(Exception):
    pass

def require(condition, code):
    if not condition:
        raise Refused(code)

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()

def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()

def sha_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')

def run(args, stdin=None, timeout=30):
    try:
        result = subprocess.run(args, input=stdin, text=True, capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise Refused('command_unavailable_or_timeout') from None
    require(result.returncode == 0, 'command_failed')
    return result.stdout

def inspect(kind, name, optional=False):
    try:
        result = subprocess.run(['docker', kind, 'inspect', name], text=True, capture_output=True, timeout=20, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise Refused('inspect_unavailable') from None
    if optional and result.returncode != 0 and ('No such' in result.stderr or 'not found' in result.stderr):
        return None
    require(result.returncode == 0, 'inspect_failed')
    try:
        values = json.loads(result.stdout)
        require(len(values) == 1, 'inspect_not_unique')
        return values[0]
    except (ValueError, KeyError, TypeError):
        raise Refused('inspect_invalid') from None

def private_dir(path, create=False):
    if create:
        path.mkdir(mode=0o700, parents=False)
        sync_directory(path.parent)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and info.st_uid == 0 and
            stat.S_IMODE(info.st_mode) == 0o700, 'state_directory_not_private')

def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def publish_bytes(path, content, mode=0o600):
    # Same-directory hard link publishes complete bytes atomically and refuses
    # replacement. fsync orders content before the directory entry/receipt.
    fd, temporary = tempfile.mkstemp(prefix='.publishing-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path, follow_symlinks=False)
        sync_directory(path.parent)
    finally:
        os.unlink(temporary)
        sync_directory(path.parent)

def write_json(path, value, mode=0o600):
    publish_bytes(path, canonical(value) + b'\n', mode)

def load_json(path):
    require(path.is_file() and not path.is_symlink(), 'state_file_missing_or_link')
    return json.loads(path.read_text())

def validate_manifest(bundle, expected):
    manifest = load_json(bundle / 'manifest.json')
    require(digest(manifest) == expected, 'reviewed_manifest_digest_mismatch')
    require(manifest.get('schemaVersion') == 1 and manifest.get('decisionId') == OWNER and
            manifest.get('school') == {'container': SCHOOL, 'sourceSha': SOURCE, 'imageId': IMAGE, 'network': BACKEND} and
            manifest.get('relay') == {'container': RELAY, 'egressNetwork': EGRESS, 'hostname': HOSTNAME,
                                      'upstream': '188.225.38.55:443', 'uid': 1001, 'gid': 1001} and
            set(manifest.get('files', {})) == set(FILES), 'manifest_contract_mismatch')
    for filename in FILES:
        require(sha_file(bundle / filename) == manifest['files'][filename], 'bundle_file_digest_mismatch')
    require(sha_file(Path(__file__).resolve()) == manifest['files']['repair.py'], 'controller_digest_mismatch')
    return manifest

def school_identity(school, backend):
    labels = school['Config'].get('Labels') or {}
    require(school['Name'] == '/' + SCHOOL and school['Image'] == IMAGE and
            labels.get('school.system') == SCHOOL and labels.get('school.environment') == 'production' and
            labels.get('school.candidate-sha') == SOURCE, 'school_identity_changed')
    require(school['State'].get('Running') and school['State'].get('Health', {}).get('Status') == 'healthy', 'school_not_healthy')
    require(backend['Name'] == BACKEND and backend['Driver'] == 'bridge' and backend['Internal'] is True and
            not backend.get('EnableIPv6') and school['HostConfig']['NetworkMode'] == BACKEND and
            set(school['NetworkSettings']['Networks']) == {BACKEND}, 'school_network_changed')
    endpoint = school['NetworkSettings']['Networks'][BACKEND]
    require(endpoint['NetworkID'] == backend['Id'], 'school_network_identity_changed')
    ip = str(ipaddress.IPv4Address(endpoint['IPAddress']))
    return ip

def school_fingerprint(school):
    # Config includes env only inside this hash. Raw values never leave memory.
    return digest({key: school[key] for key in ('Id', 'Image', 'Config', 'HostConfig', 'Mounts')} |
                  {'networks': {name: {key: endpoint.get(key) for key in ('NetworkID', 'IPAddress', 'GlobalIPv6Address', 'Aliases')}
                               for name, endpoint in school['NetworkSettings']['Networks'].items()}})

def network_fingerprint(network):
    # Membership necessarily adds the relay; the shared network properties must not change.
    return digest({key: network.get(key) for key in ('Id', 'Name', 'Driver', 'Internal', 'EnableIPv6', 'IPAM', 'Options', 'Labels')})

def free_backend_ip(network):
    # Docker arbitrates allocation when connecting/starting the endpoint. A race fails
    # the attempt; the controller never disconnects an occupied address.
    configs = network.get('IPAM', {}).get('Config') or []
    require(len(configs) == 1 and configs[0].get('Subnet'), 'backend_ipam_not_single_ipv4')
    subnet = ipaddress.IPv4Network(configs[0]['Subnet'])
    require(16 <= subnet.prefixlen <= 28, 'backend_subnet_outside_reviewed_size')
    occupied = {subnet.network_address, subnet.broadcast_address}
    if configs[0].get('Gateway'):
        occupied.add(ipaddress.IPv4Address(configs[0]['Gateway']))
    for address in (configs[0].get('AuxiliaryAddresses') or {}).values():
        occupied.add(ipaddress.IPv4Address(address))
    for member in (network.get('Containers') or {}).values():
        if member.get('IPv4Address'):
            occupied.add(ipaddress.IPv4Interface(member['IPv4Address']).ip)
    for offset in range(1, min(subnet.num_addresses - 1, 128)):
        address = subnet.broadcast_address - offset
        if address not in occupied:
            return str(address)
    raise Refused('backend_no_free_reviewed_address')

def alias_free(backend, own_id=None):
    for identity in (backend.get('Containers') or {}):
        member = inspect('container', identity)
        aliases = member['NetworkSettings']['Networks'].get(BACKEND, {}).get('Aliases') or []
        require(HOSTNAME not in aliases or identity == own_id, 'backend_alias_collision')

PROBE_JS = r'''
const dns=require('node:dns/promises');const https=require('node:https');
const host='arthello-188-225-38-55.sslip.io';
const expected=process.argv[2]||'';
const errors=new Set(['EAI_AGAIN','ENOTFOUND','ECONNREFUSED','ETIMEDOUT','ECONNRESET','ENETUNREACH','EHOSTUNREACH','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED']);
const code=e=>errors.has(e?.code)?e.code:'OTHER';
(async()=>{let addresses;try{addresses=await dns.lookup(host,{all:true});}catch(e){console.log(JSON.stringify({dnsOk:false,errorCode:code(e)}));return;}
const dnsOk=addresses.length>0;const expectedRelayOnly=addresses.every(x=>x.family===4&&x.address===expected);
if(!expected){console.log(JSON.stringify({dnsOk}));return;}
if(!expectedRelayOnly){console.log(JSON.stringify({dnsOk,expectedRelayOnly}));return;}
let done=false;const finish=data=>{if(done)return;done=true;console.log(JSON.stringify({dnsOk,expectedRelayOnly,...data}));};
const timer=setTimeout(()=>{finish({healthy:false,errorCode:'ETIMEDOUT'});process.exit(0);},12000);
const req=https.get({hostname:host,port:443,path:'/api/health',servername:host,rejectUnauthorized:true},res=>{let bytes=0;const parts=[];
res.on('data',chunk=>{bytes+=chunk.length;if(bytes>16384)req.destroy();else parts.push(chunk);});
res.on('end',()=>{clearTimeout(timer);try{const body=JSON.parse(Buffer.concat(parts).toString('utf8'));finish({httpStatus:res.statusCode,healthy:res.statusCode===200&&body.status==='ok',databaseAvailable:body.database==='available'});}catch{finish({healthy:false,errorCode:'INVALID_HEALTH'});}});
res.on('error',e=>{clearTimeout(timer);finish({healthy:false,errorCode:code(e)});});});
req.on('error',e=>{clearTimeout(timer);finish({healthy:false,errorCode:code(e)});});
})().catch(()=>{console.log(JSON.stringify({dnsOk:false,errorCode:'OTHER'}));process.exitCode=1;});
'''

def probe(school_id, relay_ip=''):
    output = run(['docker', 'exec', '-i', school_id, 'node', '-', relay_ip], PROBE_JS, timeout=25)
    value = json.loads(output)
    require(isinstance(value, dict), 'school_probe_invalid')
    return value

def labels_for(config_sha, school, backend, school_ip, activated, release):
    return {PREFIX + key: value for key, value in {
        'owner': OWNER, 'config-sha256': config_sha, 'school-id': school['Id'],
        'school-ip': school_ip, 'backend-id': backend['Id'], 'activated-at': activated,
        'release-sha': release['sha'], 'run-id': release['run'], 'attempt': release['attempt'],
    }.items()}

def verify_network(network, expected_labels):
    require(network['Name'] == EGRESS and network['Driver'] == 'bridge' and network['Internal'] is False and
            not network.get('EnableIPv6') and not network.get('Options') and
            network.get('Labels') == expected_labels and not network.get('Attachable'), 'egress_configuration_changed')

def verify_relay(relay, network, backend, state_dir, expected_labels, runtime, image_env, image_labels):
    require(relay['Name'] == '/' + RELAY and relay['Image'] == IMAGE and relay['Config']['Labels'] == (image_labels | expected_labels),
            'relay_identity_changed')
    config, host = relay['Config'], relay['HostConfig']
    require(config['User'] == '1001:1001' and config['Entrypoint'] == ['node'] and
            config['Cmd'] == ['/relay/relay.mjs'] and config['WorkingDir'] == '/relay' and
            sorted(config.get('Env') or []) == sorted(image_env), 'relay_process_configuration_changed')
    require(config.get('Healthcheck') == {'Test': ['CMD-SHELL', 'node /relay/healthcheck.mjs'],
            'Interval': 30000000000, 'Timeout': 12000000000, 'StartPeriod': 5000000000, 'Retries': 3}, 'relay_healthcheck_changed')
    require(host['ReadonlyRootfs'] and not host['Privileged'] and not host.get('CapAdd') and host.get('CapDrop') == ['ALL'] and
            host.get('SecurityOpt') == ['no-new-privileges:true'] and not host.get('PortBindings') and not host.get('PublishAllPorts') and
            host.get('Sysctls') == {'net.ipv4.ip_unprivileged_port_start': '0', 'net.ipv4.ip_forward': '0'} and
            host.get('RestartPolicy') == {'Name': 'unless-stopped', 'MaximumRetryCount': 0} and host['NetworkMode'] == EGRESS and
            host.get('Memory') == 134217728 and host.get('NanoCpus') == 250000000 and host.get('PidsLimit') == 32 and
            host.get('IpcMode') == 'none' and not host.get('PidMode') and not host.get('Devices') and not host.get('Binds'),
            'relay_isolation_changed')
    mounts = relay.get('Mounts') or []
    require(len(mounts) == 1 and mounts[0]['Type'] == 'bind' and mounts[0]['Source'] == str(state_dir / 'relay') and
            mounts[0]['Destination'] == '/relay' and mounts[0]['RW'] is False, 'relay_mounts_changed')
    networks = relay['NetworkSettings']['Networks']
    require(set(networks) == {BACKEND, EGRESS} and networks[BACKEND]['NetworkID'] == backend['Id'] and
            networks[EGRESS]['NetworkID'] == network['Id'] and networks[BACKEND]['IPAddress'] == runtime['bindAddress'] and
            HOSTNAME in (networks[BACKEND].get('Aliases') or []), 'relay_network_attachment_changed')
    require(set(network.get('Containers') or {}) == {relay['Id']}, 'egress_has_foreign_peer')


def repair():
    require(os.geteuid() == 0, 'root_required')
    os.umask(0o077)
    bundle = Path(os.environ.get('REPAIR_BUNDLE_DIR', '')).resolve()
    expected = os.environ.get('EXPECTED_REPAIR_CONFIG_SHA256', '')
    release = {'sha': os.environ.get('RELEASE_SHA', ''), 'run': os.environ.get('RELEASE_RUN_ID', ''),
               'attempt': os.environ.get('RELEASE_ATTEMPT', '')}
    require(re.fullmatch('[0-9a-f]{64}', expected) and re.fullmatch('[0-9a-f]{40}', release['sha']) and
            re.fullmatch('[1-9][0-9]*', release['run']) and re.fullmatch('[1-9][0-9]*', release['attempt']), 'release_inputs_invalid')
    manifest = validate_manifest(bundle, expected)
    school = inspect('container', SCHOOL)
    backend = inspect('network', BACKEND)
    school_ip = school_identity(school, backend)
    fingerprint = school_fingerprint(school)
    backend_fingerprint = network_fingerprint(backend)
    image = inspect('image', IMAGE)
    require(image['Id'] == IMAGE, 'school_image_unavailable')
    image_env = image['Config'].get('Env') or []
    # Reject inherited secret-bearing env; no runtime School env is ever passed.
    safe_image_env = {'PATH', 'NODE_VERSION', 'YARN_VERSION', 'NODE_ENV', 'PORT', 'HOSTNAME', 'NEXT_TELEMETRY_DISABLED',
                      'NEXT_PUBLIC_SCHOOL_PARENT_OTP_ENABLED', 'NEXT_PUBLIC_SCHOOL_DESIGN_V1', 'DATABASE_PATH'}
    require(all(item.split('=', 1)[0] in safe_image_env for item in image_env), 'image_env_not_allowlisted')
    image_labels = image['Config'].get('Labels') or {}
    require(set(image_labels) <= {'org.opencontainers.image.revision', 'org.opencontainers.image.source'}, 'image_labels_not_allowlisted')
    started_at = school['State']['StartedAt']
    existing = inspect('container', RELAY, optional=True)
    egress = inspect('network', EGRESS, optional=True)
    alias_free(backend, existing['Id'] if existing else None)
    state_dir = STATE_ROOT / expected
    created_relay = created_network = None
    created_state = False
    try:
        if existing:
            require(egress is not None and STATE_ROOT.exists() and state_dir.exists(), 'existing_relay_incomplete')
            private_dir(STATE_ROOT)
            private_dir(state_dir)
            saved = load_json(state_dir / 'state.json')
            runtime = load_json(state_dir / 'relay' / 'runtime.json')
            expected_labels = saved['labels']
            require(saved.get('schemaVersion') == 1 and saved.get('repairConfigSha256') == expected and
                    saved.get('schoolFingerprint') == fingerprint and saved.get('backendFingerprint') == backend_fingerprint and
                    saved.get('relayId') == existing['Id'] and saved.get('egressId') == egress['Id'] and
                    saved.get('runtimeConfigSha256') == digest(runtime) and runtime['schoolAddress'] == school_ip and
                    expected_labels.get(PREFIX + 'owner') == OWNER and expected_labels.get(PREFIX + 'config-sha256') == expected and
                    expected_labels.get(PREFIX + 'school-id') == school['Id'] and expected_labels.get(PREFIX + 'school-ip') == school_ip and
                    expected_labels.get(PREFIX + 'backend-id') == backend['Id'] and expected_labels.get(PREFIX + 'release-sha') == release['sha'],
                    'verified_relay_state_mismatch')
            for filename in ('relay.mjs', 'healthcheck.mjs'):
                require(sha_file(state_dir / 'relay' / filename) == manifest['files'][filename], 'deployed_script_changed')
            require(load_json(state_dir / 'manifest.json') == manifest, 'deployed_manifest_changed')
            activated = expected_labels[PREFIX + 'activated-at']
            mode = 'verified-existing'
        else:
            require(egress is None and not state_dir.exists(), 'unowned_or_incomplete_repair_exists')
            before_probe = probe(school['Id'])
            require(before_probe.get('dnsOk') is False and before_probe.get('errorCode') in ('EAI_AGAIN', 'ENOTFOUND'),
                    'diagnosed_dns_failure_not_reproduced')
            if not STATE_ROOT.exists():
                private_dir(STATE_ROOT, create=True)
            private_dir(STATE_ROOT)
            private_dir(state_dir, create=True)
            created_state = True
            relay_dir = state_dir / 'relay'
            relay_dir.mkdir(mode=0o755)
            os.chmod(relay_dir, 0o755)
            for filename in ('relay.mjs', 'healthcheck.mjs'):
                publish_bytes(relay_dir / filename, (bundle / filename).read_bytes(), 0o444)
            write_json(state_dir / 'manifest.json', manifest)
            # Configuration backup contains only identities and hashes, never env/DB/session data.
            write_json(state_dir / 'before.json', {'schemaVersion': 1, 'schoolId': school['Id'], 'schoolImageId': IMAGE,
                       'schoolSourceSha': SOURCE, 'schoolFingerprint': fingerprint, 'backendFingerprint': backend_fingerprint,
                       'backendId': backend['Id'], 'schoolAddress': school_ip, 'observedAtUtc': utc()})
            activated = utc()
            expected_labels = labels_for(expected, school, backend, school_ip, activated, release)
            label_args = [arg for key, value in sorted(expected_labels.items()) for arg in ('--label', key + '=' + value)]
            created_network = run(['docker', 'network', 'create', '--driver', 'bridge', *label_args, EGRESS]).strip()
            require(re.fullmatch('[0-9a-f]{64}', created_network), 'network_create_receipt_invalid')
            args = ['docker', 'create', '--name', RELAY, '--network', EGRESS, '--user', '1001:1001',
                    '--entrypoint', 'node', '--workdir', '/relay', '--read-only', '--cap-drop', 'ALL',
                    '--security-opt', 'no-new-privileges:true', '--sysctl', 'net.ipv4.ip_unprivileged_port_start=0',
                    '--sysctl', 'net.ipv4.ip_forward=0', '--memory', '128m', '--cpus', '0.25', '--pids-limit', '32',
                    '--ulimit', 'nofile=128:128', '--ipc', 'none', '--restart', 'unless-stopped',
                    '--mount', 'type=bind,src=' + str(relay_dir) + ',dst=/relay,readonly',
                    '--health-cmd', 'node /relay/healthcheck.mjs', '--health-interval', '30s', '--health-timeout', '12s',
                    '--health-start-period', '5s', '--health-retries', '3', *label_args, IMAGE, '/relay/relay.mjs']
            created_relay = run(args).strip()
            require(re.fullmatch('[0-9a-f]{64}', created_relay), 'container_create_receipt_invalid')
            bind_ip = free_backend_ip(inspect('network', BACKEND))
            run(['docker', 'network', 'connect', '--ip', bind_ip, '--alias', HOSTNAME, BACKEND, created_relay])
            runtime = {'bindAddress': bind_ip, 'schoolAddress': school_ip}
            write_json(relay_dir / 'runtime.json', runtime, 0o444)
            require(school_fingerprint(inspect('container', school['Id'])) == fingerprint and
                    network_fingerprint(inspect('network', BACKEND)) == backend_fingerprint, 'school_changed_during_setup')
            run(['docker', 'start', created_relay])
            existing = inspect('container', created_relay)
            egress = inspect('network', EGRESS)
            mode = 'created'
        verify_network(egress, expected_labels)
        verify_relay(existing, egress, backend, state_dir, expected_labels, runtime, image_env, image_labels)
        require(existing['State']['Running'], 'relay_not_running')
        # Uses actual production image/UID/netns: successful healthcheck also proves bind:443.
        for attempt in range(4):
            try:
                run(['docker', 'exec', existing['Id'], 'node', '/relay/healthcheck.mjs'], timeout=15)
                break
            except Refused:
                if attempt == 3:
                    raise Refused('relay_tls_health_failed') from None
                time.sleep(1)
        current_probe = probe(school['Id'], runtime['bindAddress'])
        require(current_probe.get('dnsOk') is True and current_probe.get('expectedRelayOnly') is True and
                current_probe.get('healthy') is True and current_probe.get('databaseAvailable') is True,
                'school_normal_dns_tls_health_failed')
        after = inspect('container', SCHOOL)
        after_backend = inspect('network', BACKEND)
        school_identity(after, after_backend)
        require(school_fingerprint(after) == fingerprint and after['State']['StartedAt'] == started_at and
                network_fingerprint(after_backend) == backend_fingerprint,
                'school_or_shared_network_changed')
        alias_free(after_backend, existing['Id'])
        if mode == 'created':
            write_json(state_dir / 'state.json', {'schemaVersion': 1, 'repairConfigSha256': expected,
                       'schoolFingerprint': fingerprint, 'backendFingerprint': backend_fingerprint,
                       'relayId': existing['Id'], 'egressId': egress['Id'], 'labels': expected_labels,
                       'runtimeConfigSha256': digest(runtime)})
        print(json.dumps({'schemaVersion': 1, 'state': 'verified', 'mode': mode, 'repairConfigSha256': expected,
              'runtimeConfigSha256': digest(runtime), 'schoolSourceSha': SOURCE, 'schoolImageId': IMAGE,
              'schoolContainerId': school['Id'], 'relayContainerId': existing['Id'],
              'activatedAtUtc': activated, 'verifiedAtUtc': utc()}, sort_keys=True))
        created_relay = created_network = None  # commit: never undo a verified repair on later browser-safe-abort
        created_state = False
    finally:
        # Rollback only IDs created by this attempt; never restart School or touch its DB/config.
        if created_relay:
            candidate = inspect('container', created_relay, optional=True)
            if candidate and candidate['Config'].get('Labels') == (image_labels | expected_labels):
                run(['docker', 'rm', '-f', created_relay])
        if created_network:
            candidate = inspect('network', created_network, optional=True)
            if candidate and candidate.get('Labels') == expected_labels and not candidate.get('Containers'):
                run(['docker', 'network', 'rm', created_network])
        if created_state and not inspect('container', RELAY, optional=True) and not inspect('network', EGRESS, optional=True):
            shutil.rmtree(state_dir)

def main():
    require(os.geteuid() == 0, 'root_required')
    with LOCK_PATH.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        repair()

if __name__ == '__main__':
    try:
        main()
    except (Refused, OSError, ValueError, KeyError, TypeError) as error:
        code = str(error) if isinstance(error, Refused) else 'repair_contract_or_state_invalid'
        print(json.dumps({'schemaVersion': 1, 'state': 'refused', 'reason': code}, sort_keys=True))
        sys.exit(1)
