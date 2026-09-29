#!/usr/bin/env python3
"""D194 runtime plan and rollback primitives. Never restores a database snapshot."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.request


class Refused(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


def checkpoint(stage):
    print('D194_STAGE=' + stage, flush=True)


def runtime_plan(old, system, image, source, tree):
    require(system in ('central', 'atlas', 'school'), 'SYSTEM')
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', image), 'IMAGE')
    require(re.fullmatch(r'[a-f0-9]{40}', source) and re.fullmatch(r'[a-f0-9]{40}', tree), 'SOURCE')
    config, host = old['Config'], old['HostConfig']
    name = old['Name'].removeprefix('/')
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', name), 'NAME')
    require(old['State']['Running'] is True and not host.get('Privileged'), 'RUNTIME')
    require(not host.get('Devices') and (system == 'school' or not host.get('PortBindings')) and not host.get('CapAdd'), 'HOST_CAPABILITY')
    for key in ('AutoRemove', 'PublishAllPorts', 'ExtraHosts', 'GroupAdd', 'DeviceCgroupRules', 'DeviceRequests',
                'Ulimits', 'Sysctls', 'Dns', 'DnsOptions', 'DnsSearch', 'OomKillDisable', 'Init', 'PidMode', 'UTSMode', 'UsernsMode'):
        require(not host.get(key), 'UNSUPPORTED_HOST_OPTION')
    require(host.get('IpcMode') in (None, '', 'private') and host.get('CgroupnsMode') in (None, '', 'private'), 'NAMESPACE')
    networks = list(old['NetworkSettings']['Networks'])
    require(len(networks) == 1 and re.fullmatch(r'[A-Za-z0-9_.-]+', networks[0]), 'NETWORK')
    environment, keys = list(config['Env']), set()
    for item in environment:
        key, separator, value = item.partition('=')
        require(separator and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key) and key not in keys
                and '\n' not in value and '\r' not in value and '\0' not in value, 'ENVIRONMENT')
        keys.add(key)
    if system == 'central':
        require(host.get('ReadonlyRootfs') is True, 'CENTRAL_ROOTFS')
        # RELEASE_SHA belongs to the existing bank activation. Its exact value,
        # activation ID, credentials and read-only activation mount are retained.
        # The new application source is recorded in OCI/container labels/receipt.
        require('RELEASE_SHA' in keys and 'TOCHKA_AUTOSYNC_ACTIVATION_ID' in keys, 'BANK_IDENTITY')
        environment = [v for v in environment if not v.startswith('ALFACRM_AUTOSYNC_ENABLED=')]
        environment.append('ALFACRM_AUTOSYNC_ENABLED=1')
    destinations, mounts, data = set(), [], None
    for mount in old['Mounts']:
        destination = mount['Destination']
        require(destination not in destinations and destination.startswith('/')
                and not any(c in destination for c in ',\n\r\0'), 'MOUNT_DESTINATION')
        destinations.add(destination)
        if mount['Type'] == 'volume':
            volume = mount['Name']
            require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]+', volume), 'VOLUME')
            spec = 'type=volume,src=' + volume + ',dst=' + destination
            spec += ('' if mount['RW'] else ',readonly') + ',volume-nocopy'
            if destination == '/data':
                require(mount['RW'], 'DATA_READONLY')
                data = volume
        elif mount['Type'] == 'bind':
            path = mount['Source']
            require(not mount['RW'] and path.startswith('/')
                    and not any(c in path for c in ',\n\r\0'), 'BIND')
            spec = 'type=bind,src=' + path + ',dst=' + destination + ',readonly'
        elif mount['Type'] == 'tmpfs':
            require(destination in host.get('Tmpfs', {}), 'TMPFS')
            continue
        else:
            raise Refused('MOUNT_TYPE')
        mounts.append(spec)
    require(data, 'DATA_VOLUME')
    if system == 'central':
        require(data == 'arthello-direct-v44-data', 'CENTRAL_DATA')
        require(any('dst=/var/lib/arthello-v52-tochka-activation,readonly,' in m for m in mounts), 'BANK_MOUNT')
    elif system == 'atlas':
        require(data == 'atlas-school-diary-data'
                and 'DATABASE_PATH=/data/atlas-school.sqlite' in environment, 'ATLAS_DATA')
        require(any(m == 'type=volume,src=atlas-school-diary-backups,dst=/backups,volume-nocopy' for m in mounts), 'ATLAS_BACKUPS')
    elif system == 'school':
        require(config.get('WorkingDir') == '/app' and 'DATABASE_PATH=/data/school-1-11.sqlite' in environment, 'SCHOOL_DATA')
        require(any(m['Type'] == 'volume' and m['Destination'] == '/backups' and m['RW'] for m in old['Mounts']), 'SCHOOL_BACKUPS')
    restart = host['RestartPolicy']['Name']
    require(restart in ('no', 'always', 'unless-stopped', 'on-failure'), 'RESTART')
    if restart == 'on-failure' and host['RestartPolicy']['MaximumRetryCount']:
        restart += ':' + str(host['RestartPolicy']['MaximumRetryCount'])
    labels = dict(config.get('Labels') or {})
    labels.update({'org.opencontainers.image.revision': source, 'org.opencontainers.image.source-tree': tree,
                   'arthello.release.sha': source, 'arthello.release.tree': tree, 'arthello.config.decision': 'D194'})
    args = ['--restart=no', '--network', networks[0]]
    if system == 'school':
        bindings = host.get('PortBindings') or {}
        require(set(bindings) == {'3000/tcp'} and len(bindings['3000/tcp']) == 1, 'SCHOOL_PORTS')
        binding = bindings['3000/tcp'][0]
        require(binding.get('HostIp') in ('127.0.0.1', '0.0.0.0', '') and re.fullmatch(r'[0-9]{1,5}', binding.get('HostPort', ''))
                and 0 < int(binding['HostPort']) < 65536, 'SCHOOL_PORTS')
        args += ['--publish', (binding['HostIp'] + ':' if binding['HostIp'] else '') + binding['HostPort'] + ':3000/tcp']
    for alias in old['NetworkSettings']['Networks'][networks[0]].get('Aliases') or []:
        if alias not in (name, old['Id'], old['Id'][:12]):
            require(re.fullmatch(r'[A-Za-z0-9_.-]+', alias), 'NETWORK_ALIAS')
            args += ['--network-alias', alias]
    if host.get('ReadonlyRootfs'):
        args.append('--read-only')
    if config.get('User'):
        args += ['--user', config['User']]
    if config.get('WorkingDir'):
        args += ['--workdir', config['WorkingDir']]
    for key, value in (host.get('Tmpfs') or {}).items():
        args += ['--tmpfs', key + (':' + value if value else '')]
    for flag, values in (('--cap-drop', host.get('CapDrop')), ('--security-opt', host.get('SecurityOpt'))):
        for value in values or []:
            args += [flag, value]
    for flag, value in (('--memory', host.get('Memory')), ('--pids-limit', host.get('PidsLimit'))):
        if value and value > 0:
            args += [flag, str(value)]
    if host.get('NanoCpus'):
        args += ['--cpus', str(host['NanoCpus'] / 1_000_000_000)]
    for mount in mounts:
        args += ['--mount', mount]
    for key, value in labels.items():
        args += ['--label', key + '=' + value]
    entrypoint = config.get('Entrypoint') or []
    require(len(entrypoint) <= 1, 'ENTRYPOINT')
    if entrypoint:
        args += ['--entrypoint', entrypoint[0]]
    return {'system': system, 'name': name, 'environment': environment, 'mounts': mounts, 'dataVolume': data,
            'restart': restart, 'args': args, 'command': config.get('Cmd') or [],
            'image': image, 'source': source, 'tree': tree}


def rollback_runtime(docker, name, retained, restart, candidate_exists):
    # Both images use the same retained /data volume. In particular, a failure
    # after public traffic must not discard new writes by restoring a snapshot.
    if candidate_exists:
        docker('rm', '-f', name)
    docker('rename', retained, name)
    docker('start', name)
    docker('update', '--restart=' + restart, name)


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'vitaliyozolin-dotcom/ArtHello-OS'
OWNER = 'vitaliyozolin-dotcom'
PINS = {
    'central': ('d83da0ce8311a4b60832031a217b91c7dd6bb1c8', None),
    'atlas': ('04a080bb247f1b5dbadfe504a59ae475bd09b6d1', '21daada019ffebb6b8d30de48f268ed3163c6c3e'),
    'school': ('5876accedbdf3758971fdc383f1e0fad8c32a158', '5802a5e6fb6d254f1f67a3776ae0c47d43a68859'),
}


# Exact verified D194 #75 receipt; do not accept a label without its container and image.
CENTRAL_PREDECESSORS = {
    # Protected release #123, run 36623049417; independently audited by #124.
    ('c8ff2621025940d0c30547cbdccb107cf827afcc',
     'a1b279e27e9e4405c9c905bfad767bd5fd63344f54a4f8affc35e419b4831330',
     'sha256:1302e619640ece623bc17c6b93a484772536a70cd4d69b0cabe375e97f38d76b'),
    # Protected release #122, run 36619170501; verified runtime receipt.
    ('5380eea5627805ddeeb2ce77ca11b24dec083607',
     'aa6bbd0c8e72ea7ab4afcfde0f2032b0c0ed5b01d20003bae079ef865d4abe13',
     'sha256:51936bd4dbf615b109539c3adc9c6eec060292ab4aa91e9c30e6cd293b12ffbe'),
    ('098cedb2a1e349c1676376391a331399ceed98ca', 'f2008a5291c24b7950b56deb65796d8453048e23df4ea4bb480cefa915539763',
     'sha256:050a044802cb17780160360ad1cdf23a880fad79c4ed36a3969387d1ca33402b'),
    # Protected release #116, run 36489373283; independent audit #118.
    ('a17a94ec96b7a73bc00aea8192a9be4d747b9a45',
     '70b4e1eebaf1683a7673f23a916ebe21d043227ec3343dadeb4d51eaa6930b60',
     'sha256:653aaf09775cea640bac46db6cbd9e0d64005a93b361c3ef8a91d3a66049a9e5'),
    # Protected release #113, run 36479811010; independent audit #115.
    ('1b5110105440ae739cd70c6669bf79ad001cd0e4',
     'e357a82b4490ddeb2724809f154f9b272f361da4abd8a41e483b07aa5937306a',
     'sha256:cde7d0c4ff2cd637c4c0d6196d0f8083a4c9e68ca947beec3b29fc69cba41f0e'),
    # Protected release #104, run 36411431413; audit #108 confirms source/runtime.
    ('d39fb05d6dc27dfba29fd65adf2ff41e5b9d1a2a',
     '0fdf3cb668f581e7ce161e6000c61028888560e20f576e0b8086d3b8a5f137c1',
     'sha256:f1adcdfd06d3072ce182351b0fb5e9c17d8d01f00cbf6d8f9c397795f59ea497'),
    # Verified release #100, run 36406660132; audit #102 confirms current source.
    ('5320821c5780fc3e52147ff230c5799dd555b3e2',
     '1913e18fd2ca45cf2be27d1d8580b3154868cd76d28b4d31c8d675d8a09a5c76',
     'sha256:76feeaaf28511c8edcb0f5d654a1683b58e1153a4db81960e24fa4066e62cae8'),
    # Verified release #97, run 36354505540; independent audit #99.
    ('9b98ece1ef86b95b01ea61c69f5d843219a0ac80',
     'e7fd7a5a16f6c620438cb805ba4976ccf14aa7f2effed4fa93244daaedb5a11a',
     'sha256:19d0d36b1c2d17500ae585e067938fed88b7be80a5292113f97391ab473f36bc'),
    # Verified release #92, run 36349330050; audit #95 confirms current source.
    ('0210d4c7dabe5376d892c7058ffab74b36185a64',
     '816a3809565ebd9dffde3d1d9acbc6ef511dc9a85081394d433061f5bb5bcc01',
     'sha256:ba308d67f3e1a2be1e8a1a155604c60d69fe2b2a39ce1db6a57eaab1d805fe1a'),
    # Verified release #90, run 36344308306; runtime receipt and subsequent audit #91.
    ('cc8cff9c2a396a97aeb6daf8dc0907a72f5587fa',
     '2de93aa84275826a4e94b7aae90842f1f49fe12e5b48a3b16cdc6f7db0073fd4',
     'sha256:e6770ca51e4c2276c3101edce144912fa518bce9195a29a6d505e4d835f478e1'),
    # Verified release #87, run 36273821384, runtime receipt.
    ('ecfc2378d595584bd52ce9c9f53a6cb22ef3411d',
     'af1167702c64ebc92362cad7c54aa6c9f005a960431e855dc6c0a879faf8fa2e',
     'sha256:90d84fefa8f665b91d2f186c9d5a76241341202e17b80471470ca406795319eb'),
    # Verified release #85, run 36269374177; exact receipt observed 2026-09-27 MSK.
    ('49cea8d5f69d356e16c6aa88ecc8a7e93cef417d',
     '308dc013a0a93031beea8385e47691236cbc9c9616abfec73890b651a51d0c37',
     'sha256:01b236f67cd1576ec6c92a7c2936c48c9d72b24b04cdcc526a26eb2748f9ffe6'),
    ('d83da0ce8311a4b60832031a217b91c7dd6bb1c8',
     '66cc912f6088bc1b929d23ee07fc906b94e82fdd2e747ce6419fb7b2fe3a7b91',
     'sha256:70fc84b541c2bffebd8d3130544d98158d25ced0c788890511b7d96a39c50216'),
    ('d066c3e7d94124efd847310e0d5ae9822401fa2f',
     'be2c859257c765ff3fdffda4247757328058ec4f3efecd67eb5312cf6f2c8b35',
     'sha256:c4b2621160a2ecbad49f48d34ee8584a37c300a31aebb5c44658b7cace3048da'),
}


def run(*args, input=None, timeout=120):
    result = subprocess.run(args, input=input, capture_output=True, timeout=timeout)
    # Docker arguments, stderr and exception text may contain credentials.
    if result.returncode != 0:
        matched = re.search(rb'SNAPSHOT_REFUSED=(DATABASE_SCHEMA|DIARY_IDENTITY|CAPACITY|INTEGRITY|DATABASE_MISSING|CONNECTOR_NOT_QUIESCED|EACCES|EROFS|ENOSPC|UNCONFIRMED)(?:\r?\n|$)', result.stderr)
        raise Refused('SNAPSHOT_' + matched[1].decode() if matched else 'COMMAND_FAILED')
    return result.stdout


def docker(*args, **kwargs):
    return run('docker', *args, **kwargs)


def inspect(name):
    return json.loads(docker('inspect', name))[0]


def file_hash(path):
    with open(path, 'rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def authorization(env):
    expected = {'GITHUB_REPOSITORY': REPOSITORY, 'GITHUB_EVENT_NAME': 'workflow_dispatch',
                'GITHUB_REF': 'refs/heads/main', 'GITHUB_ACTOR': OWNER, 'GITHUB_TRIGGERING_ACTOR': OWNER,
                'GITHUB_RUN_ATTEMPT': '1', 'CUTOVER_CONFIRMATION': 'DEPLOY ALFA UPDATE TO PRODUCTION'}
    for key, value in expected.items():
        require(env.get(key) == value, 'PROTECTED_CONTEXT')
    source = env.get('RELEASE_SHA', '')
    require(re.fullmatch(r'[a-f0-9]{40}', source) and source == env.get('GITHUB_SHA'), 'SOURCE')
    require(re.fullmatch(r'[1-9][0-9]*', env.get('GITHUB_RUN_ID', '')), 'RUN')
    require(run('git', 'rev-parse', 'HEAD').decode().strip() == source, 'CHECKOUT')
    return source


def load_image(directory, system, source, tree, run_id):
    root = directory / system
    if system == 'central':
        receipt = json.loads((root / 'arthello-v52.json').read_text())
        archive = root / 'arthello-v52-image.tar.gz'
        checksum = (root / 'arthello-v52.json.sha256').read_text().split()
        require(checksum == [file_hash(root / 'arthello-v52.json'), 'arthello-v52.json'], 'CHECKSUM')
        require(receipt.get('repository') == REPOSITORY and receipt.get('headSha') == source
                and receipt.get('treeSha') == tree and receipt.get('workflowRunId') == str(run_id)
                and receipt.get('workflowRunAttempt') == '1' and receipt.get('runnerTrust') == 'github-hosted-ephemeral'
                and receipt.get('productionCapability') is False and receipt.get('imageArchiveSha256') == file_hash(archive), 'IMAGE_EVIDENCE')
        tag = 'arthello-v52-verify:' + source
    else:
        receipt = json.loads((root / 'receipt.json').read_text())
        archive = root / 'image.tar.gz'
        require(receipt.get('controllerSha') == source and receipt.get('diary') == system
                and receipt.get('runId') == str(run_id) and receipt.get('isolatedDirectorySmoke') == 'verified'
                and receipt.get('productionApplied') is False and receipt.get('sourceSha') == PINS[system][1], 'DIARY_EVIDENCE')
        checks = [line.split() for line in (root / 'checksums.sha256').read_text().splitlines()]
        require(checks == [[file_hash(root / name), name] for name in ('image.tar.gz', 'receipt.json')], 'CHECKSUM')
        source, tree = receipt['sourceSha'], receipt['sourceTree']
        tag = 'arthello-directory-' + system + ':' + source
    require(re.fullmatch(r'[a-f0-9]{40}', source) and re.fullmatch(r'[a-f0-9]{40}', tree), 'IMAGE_SOURCE')
    run('gzip', '-t', str(archive), timeout=300)
    docker('image', 'load', '--input', str(archive), timeout=900)
    image = json.loads(docker('image', 'inspect', tag))[0]
    fingerprint = run('jq', '-cS', '-f', str(ROOT / 'deploy/v52/maintenance/image-runtime-fingerprint.jq'),
                      input=json.dumps([image]).encode())
    require(hashlib.sha256(fingerprint).hexdigest() == receipt['runtimeFingerprintSha256'], 'IMAGE_FINGERPRINT')
    labels = image['Config']['Labels']
    require(labels.get('org.opencontainers.image.revision') == source
            and labels.get('org.opencontainers.image.source-tree') == tree, 'IMAGE_LABELS')
    return image['Id'], source, tree


def health(name, port):
    script = "fetch('http://127.0.0.1:%d/api/health',{signal:AbortSignal.timeout(5000)}).then(async r=>{let b=await r.json();if(!r.ok||b.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))" % port
    docker('exec', name, 'node', '-e', script, timeout=10)


def public_health():
    for host in ('arthello', 'atlas', 'school'):
        url = 'https://' + host + '-188-225-38-55.sslip.io/api/health'
        with urllib.request.urlopen(url, timeout=15) as response:
            require(response.status == 200 and response.url == url, 'PUBLIC_ENDPOINT')
            body = response.read(16385)
        require(len(body) <= 16384 and json.loads(body).get('status') == 'ok', 'PUBLIC_HEALTH')


def stable_health_window(name, port, restart_count, soak_checks=13, recovery_checks=24, required_successes=3):
    # AlfaCRM autosync intentionally starts 30 seconds after process boot. Its
    # first due import can briefly make the SQLite-backed health route return
    # busy while the process itself remains healthy. Do not accept that state
    # indefinitely: the candidate must stay running without a restart and then
    # recover several consecutive database-backed health checks before public
    # traffic acceptance.
    for _ in range(soak_checks):
        time.sleep(5)
        current = inspect(name)
        require(current['State']['Running'] is True, 'RUNTIME_STOPPED')
        require(current['RestartCount'] == restart_count, 'UNSTABLE_RUNTIME')
        try:
            health(name, port)
        except Refused as error:
            if str(error) != 'COMMAND_FAILED':
                raise
    consecutive = 0
    for _ in range(recovery_checks):
        current = inspect(name)
        require(current['State']['Running'] is True, 'RUNTIME_STOPPED')
        require(current['RestartCount'] == restart_count, 'UNSTABLE_RUNTIME')
        try:
            health(name, port)
            consecutive += 1
            if consecutive >= required_successes:
                return
        except Refused as error:
            if str(error) != 'COMMAND_FAILED':
                raise
            consecutive = 0
        time.sleep(5)
    raise Refused('HEALTH_RECOVERY')


def mounted_backup_root():
    root = Path('/mnt/arthello-release')
    require(not root.is_symlink() and root.resolve() == root and root.is_mount(), 'BACKUP_DISK_NOT_MOUNTED')
    require(root.stat().st_dev != Path('/').stat().st_dev, 'BACKUP_DISK_IS_ROOT')
    return root


def prepare_backup_directory(volume, image=None):
    require(re.fullmatch(r'arthello-d194-(central|atlas|school)-[0-9]+-[0-9]+', volume), 'BACKUP_NAME')
    root = mounted_backup_root()
    base = root / 'production-snapshots'
    require(not base.is_symlink(), 'BACKUP_DIRECTORY_SYMLINK')
    try:
        base.mkdir(mode=0o700, exist_ok=True)
    except PermissionError:
        # The attached filesystem can be root-owned. Create only this new private
        # directory via the already verified runtime image, never chmod the disk.
        require(image and re.fullmatch(r'sha256:[a-f0-9]{64}', image), 'BACKUP_DIRECTORY_PERMISSION')
        require(not base.exists(), 'BACKUP_DIRECTORY_PERMISSION')
        docker('run', '--rm', '--network', 'none', '--read-only', '--user', '0:0',
               '--security-opt', 'no-new-privileges:true', '--pids-limit', '32', '--memory', '128m',
               '--mount', 'type=bind,src=' + str(root) + ',dst=/backup-disk',
               '--entrypoint', 'node', image, '-e',
               "const fs=require('node:fs'); const p='/backup-disk/production-snapshots'; "
               "fs.mkdirSync(p,{mode:0o700}); fs.chownSync(p,Number(process.argv[1]),Number(process.argv[2]));",
               str(os.geteuid()), str(os.getegid()))
    require(base.resolve() == base and base.stat().st_dev == root.stat().st_dev
            and base.stat().st_uid == os.geteuid() and base.stat().st_mode & 0o077 == 0, 'BACKUP_DIRECTORY_UNSAFE')
    destination = base / volume
    require(not destination.exists() and not destination.is_symlink(), 'BACKUP_DIRECTORY_EXISTS')
    destination.mkdir(mode=0o700)
    require(destination.stat().st_dev == root.stat().st_dev, 'BACKUP_DISK_MOVED')
    return destination


def upgrade(old, plan, work, run_key, current_main):
    name, retained = plan['name'], plan['name'] + '-pre-d194-' + run_key
    system = plan['system']
    backup_volume = 'arthello-d194-' + system + '-' + run_key
    port = 8081 if system == 'central' else 3000
    require(not json.loads(docker('ps', '-aq', '--filter', 'name=^/' + retained + '$', '--format', '{{json .ID}}') or 'null'), 'RETAINED_EXISTS')
    require(not docker('volume', 'ls', '-q', '--filter', 'name=^' + backup_volume + '$').strip(), 'BACKUP_EXISTS')
    current_main()
    require(inspect(name)['Id'] == old['Id'], 'LIVE_MOVED')
    checkpoint('prepare-backup-directory')
    backup_directory = prepare_backup_directory(backup_volume, plan['image']) if system == 'central' else None
    checkpoint('backup-directory-ready')
    envfile = work / (system + '.env')
    envfile.write_text('\n'.join(plan['environment']) + '\n')
    envfile.chmod(0o600)
    stopped = renamed = False
    journal = work / (system + '-operation.json')

    def record(phase):
        value = {'phase': phase, 'system': system, 'name': name, 'previousContainerId': old['Id'],
                 'retained': retained, 'dataVolume': plan['dataVolume'], 'backupVolume': backup_volume,
                 'backupDirectory': str(backup_directory) if backup_directory else None,
                 'candidateImage': plan['image'], 'databaseRestoreAllowed': False}
        temp = journal.with_suffix('.tmp')
        with temp.open('w') as output:
            json.dump(value, output)
            output.flush()
            os.fsync(output.fileno())
        temp.replace(journal)
        descriptor = os.open(work, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    try:
        # Register the recovery state before each mutating command, including
        # cases where Docker commits an operation but the client loses its reply.
        stopped = True
        record('stopping-predecessor')
        checkpoint('stop-predecessor')
        docker('update', '--restart=no', name)
        docker('stop', '--time', '30', name, timeout=45)
        require(inspect(name)['State']['Running'] is False, 'STOP_FAILED')
        # Another running container must not have any writable mount of /data.
        for container_id in docker('ps', '-q').decode().split():
            other = inspect(container_id)
            require(not any(m.get('Name') == plan['dataVolume'] and m.get('RW') for m in other['Mounts']), 'OTHER_WRITER')
        require(inspect(old['Id'])['State']['Running'] is False, 'WRITER_NOT_STOPPED')
        backup_options = ['--driver', 'local', '--opt', 'type=none', '--opt', 'o=bind',
                          '--opt', 'device=' + str(backup_directory)] if backup_directory else []
        docker('volume', 'create', '--label', 'arthello.scope=production-backup', *backup_options, backup_volume)
        checkpoint('wal-complete-snapshot')
        output = docker('run', '--rm', '--network', 'none', '--read-only', '--user', '0:0',
                        '--security-opt', 'no-new-privileges:true', '--pids-limit', '32', '--memory', '512m',
                        '--mount', 'type=volume,src=' + plan['dataVolume'] + ',dst=/source,readonly,volume-nocopy',
                        '--mount', 'type=volume,src=' + backup_volume + ',dst=/snapshot,volume-nocopy',
                        '--mount', 'type=bind,src=' + str(ROOT / 'deploy/alfa_backup.mjs') + ',dst=/run/backup.mjs,readonly',
                        '--env', 'SNAPSHOT_SYSTEM=' + system, '--env', 'SNAPSHOT_WRITER_STOPPED=1',
                        '--entrypoint', 'node', plan['image'], '/run/backup.mjs', timeout=600)
        backup_receipt = json.loads(output)
        require(backup_receipt['integrity'] == 'ok', 'BACKUP')
        current_main()
        if system == 'central':
            checkpoint('apply-fixed-atlas-school-roster')
            transfer_output = docker('run', '--rm', '--network', 'none', '--read-only', '--user', '1000:1000',
                '--security-opt', 'no-new-privileges:true', '--pids-limit', '32', '--memory', '512m',
                '--mount', 'type=volume,src=' + plan['dataVolume'] + ',dst=/data,volume-nocopy',
                '--mount', 'type=bind,src=' + str(ROOT / 'deploy') + ',dst=/maintenance,readonly',
                '--env', 'ATLAS_SCHOOL_ONLY_WRITER_STOPPED=1', '--entrypoint', 'node', plan['image'],
                '/maintenance/atlas_school_only.mjs', timeout=300)
            transfer_reports = [json.loads(line.split('=', 1)[1]) for line in transfer_output.decode().splitlines() if line.startswith('ATLAS_SCHOOL_ONLY_RESULT=')]
            require(len(transfer_reports) == 1 and transfer_reports[0].get('schoolOnly') == 32 and transfer_reports[0].get('historyUnchanged') is True, 'ATLAS_SCHOOL_ONLY_UNCONFIRMED')
            print('ATLAS_SCHOOL_ONLY_RESULT=' + json.dumps(transfer_reports[0]), flush=True)
        renamed = True
        record('replacing-runtime')
        checkpoint('replace-runtime-preserve-data')
        docker('rename', name, retained)
        # Candidate uses the same data volume. It may receive traffic immediately;
        # every rollback path therefore preserves its database writes.
        docker('run', '-d', '--name', name, *plan['args'], '--env-file', str(envfile),
               plan['image'], *plan['command'], timeout=90)
        ready = False
        for _ in range(60):
            try:
                health(name, port)
                ready = True
                break
            except Refused:
                time.sleep(2)
        require(ready, 'READINESS')
        checkpoint('runtime-ready')
        actual = inspect(name)
        require(actual['Image'] == plan['image'], 'CANDIDATE_IMAGE')
        require(set(actual['Config']['Env']) == set(plan['environment']), 'ENV_DRIFT')
        require(any(m.get('Name') == plan['dataVolume'] and m['Destination'] == '/data' and m['RW'] for m in actual['Mounts']), 'DATA_DRIFT')
        restart_count = actual['RestartCount']
        stable_health_window(name, port, restart_count)
        checkpoint('public-health')
        public_health()
        current_main()
        docker('update', '--restart=' + plan['restart'], name)
        record('runtime-verified')
        return {'system': system, 'source': plan['source'], 'tree': plan['tree'], 'imageId': plan['image'],
                'containerId': actual['Id'], 'previousContainerId': old['Id'], 'retained': retained,
                'dataVolume': plan['dataVolume'], 'backupVolume': backup_volume, 'backup': backup_receipt,
                'databaseRestored': False, 'bankEnvironmentPreserved': system == 'central'}
    except Exception:
        if renamed:
            # Inspect by ID to distinguish a committed rename/run after a lost reply.
            retained_exists = inspect(old['Id'])['Name'] == '/' + retained
            if retained_exists:
                existing = docker('ps', '-aq', '--filter', 'name=^/' + name + '$').strip()
                rollback_runtime(docker, name, retained, plan['restart'], bool(existing))
            else:
                docker('start', old['Id'])
                docker('update', '--restart=' + plan['restart'], old['Id'])
        elif stopped:
            docker('start', old['Id'])
            docker('update', '--restart=' + plan['restart'], old['Id'])
        record('previous-runtime-started-data-retained')
        checkpoint('previous-runtime-started-data-retained')
        raise
    finally:
        envfile.unlink(missing_ok=True)


def main():
    os.umask(0o077)
    def interrupted(signum, frame):
        raise Refused('INTERRUPTED')
    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, interrupted)
    source = authorization(os.environ)
    checkpoint('protected-context-verified')
    system = os.environ.get('RELEASE_SYSTEM')
    require(system in PINS, 'SYSTEM')
    require(system != 'school', 'USE_PROTECTED_SCHOOL_TRANSPORT')
    spec = importlib.util.spec_from_file_location('artifacts', ROOT / 'deploy/alfa_artifact.py')
    artifacts = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(artifacts)
    client = artifacts.bounded.GitHub(os.environ.get('GH_TOKEN'))

    def current_main():
        artifacts.bounded.exact_fields(client.json('/git/ref/heads/main').get('object'), {'type': 'commit', 'sha': source}, 'MAIN_MOVED')

    current_main()
    run_key = os.environ['GITHUB_RUN_ID'] + '-1'
    work = Path.home() / '.config/arthello/release-state' / ('d194-' + run_key)
    work.mkdir(mode=0o700, exist_ok=False)
    require(shutil.disk_usage(work).free >= 5 * 1024**3, 'DISK_CAPACITY')
    tree = run('git', 'rev-parse', 'HEAD^{tree}').decode().strip()
    runs = artifacts.download(source, work / 'artifacts', system)
    checkpoint('exact-main-artifact-verified')
    image, image_source, image_tree = load_image(work / 'artifacts', system, source, tree, runs['verify-arthello-v52'])
    names = docker('ps', '--format', '{{.Names}}').decode().split()
    names = [n for n in names if (re.fullmatch(r'arthello-direct-[1-9][0-9]*-[1-9][0-9]*', n) if system == 'central' else n == 'atlas-school-diary')]
    require(len(names) == 1, 'LIVE_AMBIGUOUS')
    old = inspect(names[0])
    old_image = json.loads(docker('image', 'inspect', old['Image']))[0]
    revision = old_image['Config']['Labels']['org.opencontainers.image.revision']
    if system == 'central':
        require((revision, old['Id'], old['Image']) in CENTRAL_PREDECESSORS, 'PREDECESSOR_INVENTORY')
    else:
        require(revision == PINS[system][0], 'PREDECESSOR')
    if system == 'atlas':
        require(old['Id'] == 'c617551b662f2f45afe4ebba39507479c285769b580627e5c030aa5a3efffbba'
                and old['Image'] == 'sha256:38b25e525cbcbebff5e581840138f01f5f89dd7aa521eecec0ba5b15fd1bca93', 'PREDECESSOR_INVENTORY')
    plan = runtime_plan(old, system, image, image_source, image_tree)
    public_health()
    gateway_receipt = None
    if system == 'central':
        spec = importlib.util.spec_from_file_location('gateway', ROOT / 'deploy/alfa_gateway.py')
        gateway = importlib.util.module_from_spec(spec); spec.loader.exec_module(gateway)
        gateway_receipt = gateway.repair(sys.modules[__name__], work, run_key, current_main)
        checkpoint('central-gateway-keepalive-verified')
    result = upgrade(old, plan, work, run_key, current_main)
    receipt = {'decision': 'D194', 'state': 'runtime-verified', 'controllerSha': source, 'verificationRuns': runs,
               'result': result, 'gateway': gateway_receipt, 'alfaImportApplied': False, 'diaryDirectoryApplied': False}
    (work / 'receipt.json').write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # No raw subprocess error, env, record, credential or signed URL in logs.
        reason = str(error) if type(error).__name__ == 'Refused' else 'INTERNAL_FAILURE'
        if not re.fullmatch(r'[A-Z_]{2,80}', reason): reason = 'INTERNAL_FAILURE'
        print('D194_RELEASE_BLOCKED reason=' + reason, file=sys.stderr)
        sys.exit(2)
