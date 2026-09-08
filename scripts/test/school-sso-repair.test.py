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
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SOURCE_DIR = HERE if (HERE / 'repair.py').exists() else HERE.parent.parent / 'deploy/school/sso-relay'
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
        self.bundle = self.root / 'bundle'
        self.bundle.mkdir(mode=0o700)
        for filename in r.FILES:
            shutil.copyfile(SOURCE_DIR / filename, self.bundle / filename)
        self.manifest = {'schemaVersion': 1, 'decisionId': r.OWNER,
                         'school': {'container': r.SCHOOL, 'sourceSha': r.SOURCE, 'imageId': r.IMAGE, 'network': r.BACKEND},
                         'relay': {'container': r.RELAY, 'egressNetwork': r.EGRESS, 'hostname': r.HOSTNAME,
                                   'upstream': '188.225.38.55:443', 'uid': 1001, 'gid': 1001},
                         'files': {name: r.sha_file(self.bundle / name) for name in r.FILES}}
        (self.bundle / 'manifest.json').write_bytes(r.canonical(self.manifest))
        self.config_sha = r.digest(self.manifest)
        self.env = {'REPAIR_BUNDLE_DIR': str(self.bundle), 'EXPECTED_REPAIR_CONFIG_SHA256': self.config_sha,
                    'RELEASE_SHA': SHA, 'RELEASE_RUN_ID': '123', 'RELEASE_ATTEMPT': '1'}
        self.state_root = self.root / 'state'
        self.engine = Engine(self.state_root)
        fixture_uid = os.geteuid()
        def fixture_private_directory(path, create=False):
            # FakeDocker never operates on the host. Preserve real mode/link/owner
            # checks against the fixture owner, which can be a hosted non-root user.
            if create:
                path.mkdir(mode=0o700)
            self.assertFalse(path.is_symlink())
            self.assertEqual(path.stat().st_mode & 0o777, 0o700)
            self.assertEqual(path.stat().st_uid, fixture_uid)
        self.patches = [patch.object(r.os, 'geteuid', return_value=0),
                        patch.object(r, 'private_dir', side_effect=fixture_private_directory),
                        patch.object(r, 'STATE_ROOT', self.state_root), patch.object(r, 'LOCK_PATH', self.root / 'repair.lock'), patch.object(r, 'inspect', self.engine.inspect),
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
        with self.assertRaisesRegex(r.Refused, 'verified_relay_state_mismatch'):
            self.invoke()
        self.assertEqual(self.engine.mutations, [])
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
    def test_unprivileged_production_entrypoint_refuses(self):
        with patch.object(r.os, 'geteuid', return_value=1001):
            with self.assertRaisesRegex(r.Refused, 'root_required'):
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

if __name__ == '__main__':
    unittest.main()
