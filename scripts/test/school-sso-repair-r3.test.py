#!/usr/bin/env python3
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SOURCE_DIR = HERE if (HERE / 'repair.py').exists() else HERE.parent.parent / 'deploy/school/sso-relay-r3'
spec = importlib.util.spec_from_file_location('school_repair', SOURCE_DIR / 'repair.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

SID, RID, BID, EID = ['a'*64, 'b'*64, 'c'*64, 'd'*64]
IP, RELAY_IP = '172.30.0.2', '172.30.0.254'
SHA = '1'*40

def fixtures():
    backend = {'Id': BID, 'Name': r.BACKEND, 'Driver': 'bridge', 'Internal': True, 'EnableIPv6': False,
               'IPAM': {'Config': [{'Subnet': '172.30.0.0/24', 'Gateway': '172.30.0.1'}]},
               'Options': {}, 'Labels': {}, 'Containers': {SID: {'IPv4Address': IP+'/24'}}}
    school = {'Id': SID, 'Name': '/'+r.SCHOOL, 'Image': r.IMAGE,
              'Config': {'Labels': {'school.system': r.SCHOOL, 'school.environment': 'production', 'school.candidate-sha': r.SOURCE},
                         'Env': ['CENTRAL_ACCESS_SECRET=private-do-not-print'], 'Image': 'school-original'},
              'HostConfig': {'NetworkMode': r.BACKEND}, 'Mounts': [{'Source': '/school-data', 'Destination': '/data'}],
              'State': {'Running': True, 'Health': {'Status': 'healthy'}, 'StartedAt': '2026-09-08T05:00:00Z'},
              'NetworkSettings': {'Networks': {r.BACKEND: {'NetworkID': BID, 'IPAddress': IP,
                                                         'GlobalIPv6Address': '', 'Aliases': [r.SCHOOL]}}}}
    image = {'Id': r.IMAGE, 'Config': {'Env': ['PATH=/usr/bin', 'NODE_ENV=production', 'DATABASE_PATH=/data/school-1-11.sqlite'],
                                     'Labels': {'org.opencontainers.image.revision': r.SOURCE}}}
    return school, backend, image

class Engine:
    def __init__(self, state_root):
        self.school, self.backend, self.image = fixtures()
        self.relay = self.egress = None
        self.mutations = []
        self.state_root = state_root
        self.fail_health = False
        self.fail_school_probe = False
    def inspect(self, kind, name, optional=False):
        values = {'container': {r.SCHOOL: self.school, SID: self.school, r.RELAY: self.relay, RID: self.relay},
                  'network': {r.BACKEND: self.backend, BID: self.backend, r.EGRESS: self.egress, EID: self.egress},
                  'image': {r.IMAGE: self.image}}
        result = values[kind].get(name)
        if result is None and not optional:
            raise r.Refused('fixture_missing')
        return copy.deepcopy(result)
    def run(self, args, stdin=None, timeout=30):
        assert args[0] == 'docker'
        if args[1] == 'exec':
            if args[2] == '-i':
                if not self.relay:
                    return json.dumps({'dnsOk': False, 'errorCode': 'EAI_AGAIN'})
                return json.dumps({'dnsOk': True, 'expectedRelayOnly': True,
                                   'healthy': not self.fail_school_probe, 'databaseAvailable': True})
            if self.fail_health:
                raise r.Refused('command_failed')
            return ''
        self.mutations.append(args[:])
        labels = dict(args[i+1].split('=', 1) for i, value in enumerate(args[:-1]) if value == '--label')
        if args[1:3] == ['network', 'create']:
            self.egress = {'Id': EID, 'Name': r.EGRESS, 'Driver': 'bridge', 'Internal': False, 'EnableIPv6': False,
                           'Options': {}, 'Labels': labels, 'Attachable': False, 'Containers': {}}
            return EID+'\n'
        if args[1] == 'create':
            config_sha = labels[r.PREFIX+'config-sha256']
            self.relay = {'Id': RID, 'Name': '/'+r.RELAY, 'Image': r.IMAGE,
                          'Config': {'Labels': self.image['Config']['Labels'] | labels, 'User': '1001:1001', 'Entrypoint': ['node'],
                                     'Cmd': ['/relay/relay.mjs'], 'WorkingDir': '/relay', 'Env': self.image['Config']['Env'],
                                     'Healthcheck': {'Test': ['CMD-SHELL', 'node /relay/healthcheck.mjs'], 'Interval': 30000000000,
                                                     'Timeout': 12000000000, 'StartPeriod': 5000000000, 'Retries': 3}},
                          'HostConfig': {'ReadonlyRootfs': True, 'Privileged': False, 'CapAdd': None, 'CapDrop': ['ALL'],
                                         'SecurityOpt': ['no-new-privileges:true'], 'PortBindings': {}, 'PublishAllPorts': False,
                                         'Sysctls': {'net.ipv4.ip_unprivileged_port_start': '0', 'net.ipv4.ip_forward': '0'},
                                         'RestartPolicy': {'Name': 'unless-stopped', 'MaximumRetryCount': 0}, 'NetworkMode': r.EGRESS,
                                         'Memory': 134217728, 'NanoCpus': 250000000, 'PidsLimit': 32, 'IpcMode': 'none',
                                         'PidMode': '', 'Devices': [], 'Binds': None},
                          'Mounts': [{'Type': 'bind', 'Source': str(self.state_root / config_sha / 'relay'), 'Destination': '/relay', 'RW': False}],
                          'NetworkSettings': {'Networks': {r.EGRESS: {'NetworkID': EID, 'IPAddress': '172.31.0.2', 'Aliases': [r.RELAY]}}},
                          'State': {'Running': False}}
            return RID+'\n'
        if args[1:3] == ['network', 'connect']:
            self.relay['NetworkSettings']['Networks'][r.BACKEND] = {'NetworkID': BID, 'IPAddress': '',
                'IPAMConfig': {'IPv4Address': args[args.index('--ip')+1]}, 'Aliases': [args[args.index('--alias')+1]]}
            return ''
        if args[1] == 'start':
            endpoint = self.relay['NetworkSettings']['Networks'][r.BACKEND]
            # Actual Docker allocation occurs on start, not created-container inspect.
            endpoint['IPAddress'] = endpoint['IPAMConfig']['IPv4Address']
            self.relay['State']['Running'] = True
            self.backend['Containers'][RID] = {'IPv4Address': endpoint['IPAddress']+'/24'}
            self.egress['Containers'][RID] = {'IPv4Address': '172.31.0.2/24'}
            return RID+'\n'
        if args[1:3] == ['rm', '-f']:
            assert args[3] == RID
            self.relay = None
            self.backend['Containers'].pop(RID, None)
            self.egress['Containers'].clear()
            return RID+'\n'
        if args[1:3] == ['network', 'rm']:
            assert args[3] == EID
            self.egress = None
            return EID+'\n'
        raise AssertionError(args)

class RepairTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state_root = self.root / r.STATE_LEAF
        self.state_root.mkdir(mode=0o700)
        self.bundle = self.state_root / '.incoming-test'
        self.bundle.mkdir(mode=0o700)
        for filename in r.FILES:
            shutil.copyfile(SOURCE_DIR / filename, self.bundle / filename)
            os.chmod(self.bundle / filename, 0o600)
        self.manifest = {'schemaVersion': 2, 'decisionId': r.OWNER,
                         'school': {'container': r.SCHOOL, 'sourceSha': r.SOURCE, 'imageId': r.IMAGE, 'network': r.BACKEND},
                         'relay': {'container': r.RELAY, 'egressNetwork': r.EGRESS, 'hostname': r.HOSTNAME,
                                   'upstream': '188.225.38.55:443', 'uid': 1001, 'gid': 1001},
                         'files': {name: r.sha_file(self.bundle / name, os.geteuid(), 0o600) for name in r.FILES}}
        (self.bundle / 'manifest.json').write_bytes(r.canonical(self.manifest))
        os.chmod(self.bundle / 'manifest.json', 0o600)
        self.config_sha = r.digest(self.manifest)
        self.env = {'REPAIR_BUNDLE_DIR': str(self.bundle), 'EXPECTED_REPAIR_CONFIG_SHA256': self.config_sha,
                    'RELEASE_SHA': SHA, 'RELEASE_RUN_ID': '123', 'RELEASE_ATTEMPT': '1'}
        self.lock_path = self.root / 'existing-shared.lock'
        self.lock_path.write_text('')
        self.lock_path.chmod(0o644)
        self.engine = Engine(self.state_root)
        fixture_uid = os.geteuid()
        def fixture_private_directory(path, uid, create=False):
            # FakeDocker never operates on the host. Preserve real mode/link/owner
            # checks against the fixture owner, which can be a hosted non-root user.
            if create:
                path.mkdir(mode=0o700)
            self.assertFalse(path.is_symlink())
            self.assertEqual(path.stat().st_mode & 0o777, 0o700)
            self.assertEqual(path.stat().st_uid, fixture_uid)
        self.patches = [patch.object(r, '__file__', str(self.bundle / 'repair.py')),
                        patch.object(r, 'caller_context', return_value=(fixture_uid, self.state_root)),
                        patch.object(r, 'private_dir', side_effect=fixture_private_directory),
                        patch.object(r, 'LOCK_PATH', self.lock_path), patch.object(r, 'inspect', self.engine.inspect),
                        patch.object(r, 'run', self.engine.run), patch.dict(os.environ, self.env),
                        patch.object(r.time, 'sleep', lambda _: None)]
        for item in self.patches:
            item.start()
    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()
    def invoke(self):
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            r.main()
        self.assertNotIn('private-do-not-print', stream.getvalue())
        return json.loads(stream.getvalue())
    def test_create_then_retry_is_readonly_and_keeps_activation(self):
        baseline = r.school_fingerprint(self.engine.school)
        first = self.invoke()
        self.assertEqual(first['mode'], 'created')
        self.assertEqual(first['state'], 'verified')
        self.assertEqual(r.school_fingerprint(self.engine.school), baseline)
        self.engine.mutations.clear()
        # Same Docker container can restart without changing its configuration/IP.
        self.engine.school['State']['StartedAt'] = '2026-09-08T06:00:00Z'
        second = self.invoke()
        self.assertEqual(second['mode'], 'verified-existing')
        self.assertEqual(second['activatedAtUtc'], first['activatedAtUtc'])
        self.assertEqual(second['repairConfigSha256'], first['repairConfigSha256'])
        self.assertEqual(self.engine.mutations, [])
    def test_school_ip_change_refuses_existing_without_mutation(self):
        self.invoke()
        self.engine.mutations.clear()
        self.engine.school['NetworkSettings']['Networks'][r.BACKEND]['IPAddress'] = '172.30.0.3'
        with self.assertRaisesRegex(r.Refused, 'configuration_backup_mismatch'):
            self.invoke()
        self.assertEqual(self.engine.mutations, [])
    def test_existing_state_mode_tamper_refuses_without_mutation(self):
        self.invoke()
        self.engine.mutations.clear()
        (self.state_root / self.config_sha / 'state.json').chmod(0o644)
        with self.assertRaisesRegex(r.Refused, 'owned_file_invalid'):
            self.invoke()
        self.assertEqual(self.engine.mutations, [])
    def test_missing_shared_lock_fails_before_any_controller_mutation(self):
        self.lock_path.unlink()
        with self.assertRaises(FileNotFoundError):
            self.invoke()
        self.assertEqual(self.engine.mutations, [])
        self.assertFalse((self.state_root / self.config_sha).exists())
    def test_existing_relay_isolation_tamper_refuses_without_mutation(self):
        self.invoke()
        self.engine.mutations.clear()
        self.engine.relay['HostConfig']['Privileged'] = True
        with self.assertRaisesRegex(r.Refused, 'relay_isolation_changed'):
            self.invoke()
        self.assertEqual(self.engine.mutations, [])
    def test_failed_school_tls_rolls_back_only_created_resources(self):
        original = copy.deepcopy(self.engine.school)
        self.engine.fail_school_probe = True
        with self.assertRaisesRegex(r.Refused, 'school_normal_dns_tls_health_failed'):
            self.invoke()
        self.assertEqual(self.engine.school, original)
        self.assertIsNone(self.engine.relay)
        self.assertIsNone(self.engine.egress)
        self.assertFalse((self.state_root / self.config_sha).exists())
        self.assertEqual(self.engine.mutations[-2:], [['docker', 'rm', '-f', RID], ['docker', 'network', 'rm', EID]])
    def test_bundle_tamper_refuses_before_any_mutation(self):
        (self.bundle / 'relay.mjs').write_text('tampered')
        with self.assertRaisesRegex(r.Refused, 'bundle_file_digest_mismatch'):
            self.invoke()
        self.assertEqual(self.engine.mutations, [])
    def test_fingerprint_changes_for_secret_but_never_contains_it(self):
        before = r.school_fingerprint(self.engine.school)
        self.engine.school['Config']['Env'] = ['CENTRAL_ACCESS_SECRET=another-private-value']
        after = r.school_fingerprint(self.engine.school)
        self.assertNotEqual(before, after)
        self.assertEqual(len(after), 64)
    def test_free_ip_excludes_gateway_peers_and_auxiliary(self):
        backend = copy.deepcopy(self.engine.backend)
        backend['IPAM']['Config'][0]['AuxiliaryAddresses'] = {'reserved': '172.30.0.254'}
        backend['Containers']['e'*64] = {'IPv4Address': '172.30.0.253/24'}
        self.assertEqual(r.free_backend_ip(backend), '172.30.0.252')
    def test_foreign_alias_collision_refuses(self):
        backend = copy.deepcopy(self.engine.backend)
        backend['Containers'] = {'e'*64: {'IPv4Address': '172.30.0.3/24'}}
        foreign = {'NetworkSettings': {'Networks': {r.BACKEND: {'Aliases': [r.HOSTNAME]}}}}
        with patch.object(r, 'inspect', return_value=foreign):
            with self.assertRaisesRegex(r.Refused, 'backend_alias_collision'):
                r.alias_free(backend)
    def test_wrong_school_image_refuses_before_any_mutation(self):
        self.engine.school['Image'] = 'sha256:'+'e'*64
        with self.assertRaisesRegex(r.Refused, 'school_identity_changed'):
            self.invoke()
        self.assertEqual(self.engine.mutations, [])
    def test_shared_network_must_stay_internal(self):
        self.engine.backend['Internal'] = False
        with self.assertRaisesRegex(r.Refused, 'school_network_changed'):
            self.invoke()
        self.assertEqual(self.engine.mutations, [])
    def test_publication_refuses_existing_file(self):
        path = self.root / 'receipt.json'
        r.write_json(path, {'previous': True})
        with self.assertRaises(FileExistsError):
            r.write_json(path, {'new': True})
        self.assertEqual(json.loads(path.read_text()), {'previous': True})
    def test_fault_before_publication_leaves_no_receipt(self):
        path = self.root / 'receipt.json'
        with patch.object(r.os, 'link', side_effect=OSError('before link')):
            with self.assertRaises(OSError):
                r.write_json(path, {'state': 'verified'})
        self.assertFalse(path.exists())
        self.assertEqual(list(self.root.glob('.publishing-*')), [])
    def test_fault_after_publication_never_exposes_partial_json(self):
        path = self.root / 'receipt.json'
        real_fsync = r.os.fsync
        calls = []
        def fault(fd):
            calls.append(fd)
            if len(calls) == 2:
                raise OSError('after link')
            return real_fsync(fd)
        with patch.object(r.os, 'fsync', side_effect=fault):
            with self.assertRaises(OSError):
                r.write_json(path, {'state': 'verified', 'repairConfigSha256': 'a'*64})
        self.assertEqual(json.loads(path.read_text()), {'state': 'verified', 'repairConfigSha256': 'a'*64})
        self.assertEqual(list(self.root.glob('.publishing-*')), [])

class BoundaryTests(unittest.TestCase):
    def synthetic_caller(self, *, uid=1001, real_uid=1001, home='/home/deploy', owner=1001, unsafe=None, symlink=None):
        modes = {'/': 0o755, '/home': 0o755, '/home/deploy': 0o700}
        def metadata(path):
            return SimpleNamespace(st_mode=stat.S_IFDIR | (0o777 if str(path) == unsafe else modes.get(str(path), 0o700)),
                                   st_uid=owner if str(path) == home else 0)
        stack = contextlib.ExitStack()
        stack.enter_context(patch.object(r.os, 'geteuid', return_value=uid))
        stack.enter_context(patch.object(r.os, 'getuid', return_value=real_uid))
        stack.enter_context(patch.object(r.os, 'getgid', return_value=1001))
        stack.enter_context(patch.object(r.os, 'getegid', return_value=1001))
        stack.enter_context(patch.object(r.pwd, 'getpwuid', return_value=SimpleNamespace(pw_dir=home)))
        stack.enter_context(patch.object(Path, 'resolve', lambda path: path))
        stack.enter_context(patch.object(Path, 'lstat', metadata))
        stack.enter_context(patch.object(Path, 'is_symlink', lambda path: str(path) == symlink))
        return stack
    def test_passwd_home_controls_state_location_not_environment(self):
        with self.synthetic_caller(), patch.dict(os.environ, {'HOME': '/untrusted', 'REPAIR_STATE_ROOT': '/untrusted'}):
            self.assertEqual(r.caller_context(), (1001, Path('/home/deploy') / r.STATE_LEAF))
    def test_root_and_setuid_execution_refused(self):
        for uid, real_uid in ((0, 0), (1001, 1002)):
            with self.subTest(uid=uid, real_uid=real_uid), self.synthetic_caller(uid=uid, real_uid=real_uid):
                with self.assertRaisesRegex(r.Refused, 'ordinary_caller_required'):
                    r.caller_context()
    def test_unsafe_owner_ancestor_and_symlink_refused(self):
        for options, reason in (({'owner': 0}, 'passwd_home_not_owned'),
                                ({'unsafe': '/home'}, 'unsafe_home_ancestor'),
                                ({'symlink': '/home/deploy'}, 'unsafe_home_ancestor')):
            with self.subTest(options=options), self.synthetic_caller(**options):
                with self.assertRaisesRegex(r.Refused, reason):
                    r.caller_context()
    def test_mount_source_commas_and_newlines_refused(self):
        for home in ('/home/deploy,other', '/home/deploy\nother', '/home/deploy\rother'):
            with self.subTest(home=home), self.synthetic_caller(home=home):
                with self.assertRaisesRegex(r.Refused, 'passwd_home_unsafe_characters'):
                    r.caller_context()
    def test_actual_host_nonroot_home_path_or_root_refusal(self):
        # This executes the real path validation on a hosted non-root runner.
        # The local container runs as root and must reject that caller.
        if os.geteuid() == 0:
            with self.assertRaisesRegex(r.Refused, 'ordinary_caller_required'):
                r.caller_context()
        else:
            uid, path = r.caller_context()
            self.assertEqual(uid, os.geteuid())
            self.assertEqual(path, Path(r.pwd.getpwuid(uid).pw_dir) / r.STATE_LEAF)
    def test_shared_lock_readonly_still_excludes_second_workflow(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'shared.lock'
            path.write_bytes(b'unchanged')
            path.chmod(0o644)
            before = path.stat()
            with patch.object(r, 'LOCK_PATH', path):
                real_open = r.os.open
                flags = []
                def capture(name, supplied, *args):
                    flags.append(supplied)
                    return real_open(name, supplied, *args)
                with patch.object(r.os, 'open', side_effect=capture):
                    fd = r.open_shared_lock(os.geteuid())
                try:
                    with self.assertRaises(BlockingIOError):
                        r.open_shared_lock(os.geteuid())
                finally:
                    os.close(fd)
                fd = r.open_shared_lock(os.geteuid())
                os.close(fd)
            self.assertEqual(flags[0] & os.O_ACCMODE, os.O_RDONLY)
            self.assertTrue(flags[0] & os.O_NOFOLLOW)
            self.assertFalse(flags[0] & (os.O_CREAT | os.O_TRUNC | os.O_APPEND))
            self.assertEqual(path.read_bytes(), b'unchanged')
            self.assertEqual(path.stat().st_mtime_ns, before.st_mtime_ns)
    def test_owned_files_reject_foreign_owner_mode_symlink_hardlink_and_oversize(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            path.write_text('immutable')
            path.chmod(0o600)
            with self.assertRaisesRegex(r.Refused, 'owned_file_invalid'):
                r.read_owned(path, os.geteuid() + 1, 0o600)
            with self.assertRaisesRegex(r.Refused, 'owned_file_invalid'):
                r.read_owned(path, os.geteuid(), 0o444)
            with self.assertRaisesRegex(r.Refused, 'owned_file_invalid'):
                r.read_owned(path, os.geteuid(), 0o600, limit=2)
            link = Path(directory) / 'linked'
            link.symlink_to(path)
            with self.assertRaises(OSError):
                r.read_owned(link, os.geteuid(), 0o600)
            link.unlink()
            os.link(path, link)
            with self.assertRaisesRegex(r.Refused, 'owned_file_invalid'):
                r.read_owned(path, os.geteuid(), 0o600)
    def test_fifo_shared_lock_is_rejected_without_blocking(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'shared.lock'
            os.mkfifo(path, 0o600)
            with patch.object(r, 'LOCK_PATH', path):
                with self.assertRaisesRegex(r.Refused, 'shared_lock_unsafe'):
                    r.open_shared_lock(os.geteuid())
    def test_missing_symlink_and_writable_shared_lock_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'shared.lock'
            with patch.object(r, 'LOCK_PATH', path):
                with self.assertRaises(FileNotFoundError):
                    r.open_shared_lock(os.geteuid())
                self.assertFalse(path.exists())
                target = Path(directory) / 'target'
                target.write_text('keep')
                path.symlink_to(target)
                with self.assertRaises(OSError):
                    r.open_shared_lock(os.geteuid())
                path.unlink()
                path.write_text('keep')
                path.chmod(0o666)
                with self.assertRaisesRegex(r.Refused, 'shared_lock_unsafe'):
                    r.open_shared_lock(os.geteuid())
                self.assertEqual(path.read_text(), 'keep')

if __name__ == '__main__':
    unittest.main()
