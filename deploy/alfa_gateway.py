"""D257: verified central-only Caddy keepalive repair with durable rollback."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re

HOST = 'arthello-188-225-38-55.sslip.io'
UPSTREAM = 'arthello-direct-34837407187-1:8081'
OBSERVED_CONFIG = 'c0b26ea8c7e1be734eb20775c0608acd707ab24dc694a0c1057661f880134abc'


class Refused(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


def digest(config):
    return hashlib.sha256(json.dumps(config, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def desired_config(config):
    result = copy.deepcopy(config)
    targets = []
    def walk(value, scope=frozenset(), depth=0):
        require(depth <= 40, 'GATEWAY_DEPTH')
        if isinstance(value, list):
            for row in value: walk(row, scope, depth + 1)
        elif isinstance(value, dict):
            if 'match' in value:
                matches = value['match']
                require(isinstance(matches, list), 'GATEWAY_MATCH')
                hosts = [host for match in matches if isinstance(match, dict) for host in match.get('host', [])]
                if hosts:
                    if any(not isinstance(match, dict) or not match.get('host') for match in matches): hosts.append('*')
                    scope = frozenset(hosts)
            if value.get('handler') == 'reverse_proxy' and HOST in scope:
                require(scope == {HOST}, 'GATEWAY_SHARED_HOST')
                require(value.get('upstreams') == [{'dial': UPSTREAM}], 'GATEWAY_UPSTREAM')
                transport = value.setdefault('transport', {'protocol': 'http'})
                require(transport.get('protocol', 'http') == 'http' and 'tls' not in transport, 'GATEWAY_TRANSPORT')
                keep = transport.setdefault('keep_alive', {})
                require(isinstance(keep, dict) and keep.get('enabled', True) is True, 'GATEWAY_KEEPALIVE_CHANGED')
                keep['enabled'] = False
                targets.append(value)
            for child in value.values():
                if isinstance(child, (list, dict)): walk(child, scope, depth + 1)
    walk(result.get('apps', {}).get('http', {}).get('servers', {}))
    require(len(targets) == 1, 'GATEWAY_TARGET_COUNT')
    return result


def render_routes(source):
    require(isinstance(source, str) and 0 < len(source.encode()) <= 1_000_000 and '\r' not in source and '\0' not in source, 'GATEWAY_ROUTE_SIZE')
    pattern = re.compile(r'(?m)^([ \t]*)reverse_proxy ' + re.escape(UPSTREAM) + r'[ \t]*\n')
    require(len(pattern.findall(source)) == 1, 'GATEWAY_ROUTE_AMBIGUOUS')
    def replace(match):
        indent = match[1]
        return (indent + 'reverse_proxy ' + UPSTREAM + ' {\n' + indent + '  transport http {\n'
                + indent + '    keepalive off\n' + indent + '  }\n' + indent + '}\n')
    return pattern.sub(replace, source)


def repair(release, work, run_key, current_main, *, audit=None):
    # The protected release already verified owner, exact main, all three CI gates,
    # application predecessor and artifact provenance before entering here.
    require(re.fullmatch(r'[1-9][0-9]*-1', run_key), 'GATEWAY_RUN_KEY')
    if audit is None:
        spec = importlib.util.spec_from_file_location('gateway_audit', Path(__file__).with_name('alfa_audit.py'))
        audit = importlib.util.module_from_spec(spec); spec.loader.exec_module(audit)
    read = audit.read_bounded_command
    ids = read(['docker', 'ps', '--no-trunc', '--filter', 'ancestor=' + audit.GATEWAY_IMAGE, '--format', '{{.ID}}']).decode().split()
    require(len(ids) == 1 and re.fullmatch(r'[a-f0-9]{64}', ids[0]), 'GATEWAY_IDENTITY')
    gateway = ids[0]
    inspected = release.inspect(gateway)
    require(inspected['State']['Running'] and inspected['Image'] == audit.GATEWAY_IMAGE, 'GATEWAY_IDENTITY')
    require(inspected['Config']['Cmd'] == ['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], 'GATEWAY_STARTUP_CONFIG')
    require(any(m.get('Type') == 'volume' and m.get('Destination') == '/data' and m.get('RW') for m in inspected['Mounts']), 'GATEWAY_DURABLE_DATA')
    def config():
        return json.loads(read(['docker', 'exec', gateway, 'wget', '-T', '25', '-qO-', 'http://127.0.0.1:2019/config/']))
    def file(path):
        return read(['docker', 'exec', gateway, 'cat', path], max_bytes=1_000_000)
    def adapt(path):
        return json.loads(read(['docker', 'exec', gateway, 'caddy', 'adapt', '--config', path, '--adapter', 'caddyfile']))
    def write(path, content):
        release.docker('exec', '-i', gateway, 'sh', '-ceu', 'umask 077; set -C; cat > "$1"; sync', 'sh', path, input=content)
    route = '/data/external-routes.caddy'
    main = '/etc/caddy/Caddyfile'
    before = config()
    main_bytes, route_bytes = file(main), file(route)
    require(main_bytes.count(b'import /data/external-routes.caddy') == 1, 'GATEWAY_IMPORT')
    require(adapt(main) == before, 'GATEWAY_DISK_RUNTIME_DRIFT')
    if digest(before) != OBSERVED_CONFIG:
        prior = []
        for path in work.parent.glob('d194-*/gateway-operation.json'):
            if path.stat().st_size > 8192: continue
            try: receipt = json.loads(path.read_text())
            except (ValueError, OSError): continue
            if (receipt.get('phase') == 'verified' and receipt.get('decision') == 'D257'
                    and receipt.get('gatewayId') == gateway and receipt.get('beforeSha256') == OBSERVED_CONFIG
                    and receipt.get('afterSha256') == digest(before)):
                prior.append(receipt)
        require(bool(prior), 'GATEWAY_CONFIG_CHANGED')
        release.public_health()
        return {**prior[-1], 'alreadyApplied': True}
    expected = desired_config(before)
    candidate = render_routes(route_bytes.decode()).encode()
    prefix = '/data/d257-' + run_key
    backup, staged, staged_main = prefix + '.before', prefix + '.new', prefix + '.Caddyfile'
    # Both an on-volume recovery file and the protected release journal survive
    # controller interruption. No credentials/configuration are printed.
    (work / 'gateway-main.before').write_bytes(main_bytes)
    (work / 'gateway-routes.before').write_bytes(route_bytes)
    write(backup, route_bytes)
    write(staged, candidate)
    write(staged_main, main_bytes.replace(b'import /data/external-routes.caddy', ('import ' + staged).encode()))
    require(file(backup) == route_bytes and file(staged) == candidate, 'GATEWAY_BACKUP_READBACK')
    require(adapt(staged_main) == expected, 'GATEWAY_UNEXPECTED_CONFIG_DIFF')
    release.docker('exec', gateway, 'caddy', 'validate', '--config', staged_main, '--adapter', 'caddyfile')
    journal = work / 'gateway-operation.json'
    receipt = {'decision': 'D257', 'gatewayId': gateway, 'beforeSha256': digest(before), 'afterSha256': digest(expected), 'backupPath': backup, 'businessDataChanged': False}
    def record(phase):
        receipt['phase'] = phase
        temporary = journal.with_suffix('.tmp')
        with temporary.open('w') as output:
            json.dump(receipt, output); output.flush(); os.fsync(output.fileno())
        temporary.replace(journal)
        descriptor = os.open(work, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(descriptor)
        finally: os.close(descriptor)
    def reload():
        release.docker('exec', gateway, 'caddy', 'reload', '--config', main, '--adapter', 'caddyfile')
    current_main()
    require(config() == before and file(main) == main_bytes and file(route) == route_bytes, 'GATEWAY_MOVED')
    touched = False
    try:
        record('installing')
        touched = True
        release.docker('exec', gateway, 'sh', '-ceu', 'mv "$1" "$2"; sync', 'sh', staged, route)
        reload()
        require(config() == expected and file(route) == candidate, 'GATEWAY_APPLY_READBACK')
        release.public_health()
        current_main()
        record('verified')
        return dict(receipt)
    except BaseException:
        if touched:
            record('rolling-back')
            recovery = prefix + '.rollback'
            release.docker('exec', gateway, 'sh', '-ceu', 'cp -p "$1" "$2"; mv "$2" "$3"; sync', 'sh', backup, recovery, route)
            reload()
            require(config() == before and file(route) == route_bytes, 'GATEWAY_ROLLBACK_UNCONFIRMED')
            release.public_health()
            record('rolled-back')
        raise
