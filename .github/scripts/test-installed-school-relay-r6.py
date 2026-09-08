#!/usr/bin/env python3
"""Isolated rejection and read-only command tests; no Docker or host writes."""
import base64
import copy
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PosixPath
import stat
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
spec = importlib.util.spec_from_file_location('installed_relay_r6', HERE / 'verify-installed-school-relay-r6.py')
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)
SOURCE = Path(os.environ.get('R6_TEST_IMMUTABLE_R5_DIR', ROOT / 'deploy/school/sso-relay-r5'))
BUNDLE = json.dumps({'schemaVersion': 1, 'files': {
    name: base64.b64encode((SOURCE / name).read_bytes()).decode() for name in v.FILE_HASHES}}).encode()
ENV = {'RELEASE_SHA': 'f'*40, 'RELEASE_RUN_ID': '40000000000', 'RELEASE_ATTEMPT': '1'}
BID, EID = 'c'*64, 'd'*64
IP, RELAY_IP = '172.30.0.2', '172.30.0.254'
LOCK_STAT = SimpleNamespace(st_uid=1000, st_gid=1000, st_mode=stat.S_IFREG | 0o644,
                            st_nlink=1, st_dev=27, st_ino=12)


class FixturePath(PosixPath):
    def lstat(self):
        if self.name == 'school-1-11-production.lock':
            return LOCK_STAT
        return SimpleNamespace(st_mode=stat.S_IFDIR | (0o755 if self.name == 'relay' else 0o700), st_uid=1000)

    def is_symlink(self):
        return False


class Engine:
    def __init__(self):
        self.r, self.manifest = v.load_controller(BUNDLE)
        r = self.r
        self.root = FixturePath('/fixture/.arthello-school-sso-relay')
        self.state_dir = self.root / v.CONFIG_SHA
        self.state_sha = hashlib.sha256(str(self.state_dir).encode()).hexdigest()
        self.runtime = {'bindAddress': RELAY_IP, 'schoolAddress': IP, 'executionUid': 1000, 'stateDirectorySha256': self.state_sha}
        self.runtime_sha = r.digest(self.runtime)
        self.school = {'Id': v.SCHOOL_ID, 'Name': '/'+r.SCHOOL, 'Image': r.IMAGE,
                       'Config': {'Labels': {'school.system': r.SCHOOL, 'school.environment': 'production', 'school.candidate-sha': r.SOURCE},
                                  'Env': ['CENTRAL_ACCESS_SECRET=fixture-secret-must-not-escape']},
                       'HostConfig': {'NetworkMode': r.BACKEND},
                       'Mounts': [{'Source': '/first', 'Destination': '/data'}, {'Source': '/second', 'Destination': '/config'}],
                       'State': {'Running': True, 'Health': {'Status': 'healthy'}, 'StartedAt': v.SCHOOL_STARTED_AT},
                       'NetworkSettings': {'Networks': {r.BACKEND: {'NetworkID': BID, 'IPAddress': IP, 'GlobalIPv6Address': '', 'Aliases': [r.SCHOOL]}}}}
        self.backend = {'Id': BID, 'Name': r.BACKEND, 'Driver': 'bridge', 'Internal': True, 'EnableIPv6': False,
                        'IPAM': {'Config': [{'Subnet': '172.30.0.0/24', 'Gateway': '172.30.0.1'}]}, 'Options': {}, 'Labels': {},
                        'Containers': {v.SCHOOL_ID: {'IPv4Address': IP+'/24'}, v.RELAY_ID: {'IPv4Address': RELAY_IP+'/24'}}}
        self.image = {'Id': r.IMAGE, 'Config': {'Env': ['PATH=/usr/bin', 'NODE_ENV=production'],
                                              'Labels': {'org.opencontainers.image.revision': r.SOURCE}}}
        self.labels = r.labels_for(v.CONFIG_SHA, self.school, self.backend, IP, v.ACTIVATED_AT,
                                  {'sha': v.INSTALL_SHA, 'run': v.INSTALL_RUN, 'attempt': v.INSTALL_ATTEMPT}) | {
            r.PREFIX+'execution-uid': '1000', r.PREFIX+'state-directory-sha256': self.state_sha}
        self.egress = {'Id': EID, 'Name': r.EGRESS, 'Driver': 'bridge', 'Internal': False, 'EnableIPv6': False,
                       'Options': {}, 'Labels': self.labels, 'Attachable': False, 'Containers': {v.RELAY_ID: {'IPv4Address': '172.31.0.2/24'}}}
        self.relay = {'Id': v.RELAY_ID, 'Name': '/'+r.RELAY, 'Image': r.IMAGE,
                      'Config': {'Labels': self.image['Config']['Labels'] | self.labels, 'User': '1001:1001', 'Entrypoint': ['node'],
                                 'Cmd': ['/relay/relay.mjs'], 'WorkingDir': '/relay', 'Env': self.image['Config']['Env'],
                                 'Healthcheck': {'Test': ['CMD-SHELL', 'node /relay/healthcheck.mjs'], 'Interval': 30000000000,
                                                 'Timeout': 12000000000, 'StartPeriod': 5000000000, 'Retries': 3}},
                      'HostConfig': {'ReadonlyRootfs': True, 'Privileged': False, 'CapAdd': None, 'CapDrop': ['ALL'],
                                     'SecurityOpt': ['no-new-privileges:true'], 'PortBindings': {}, 'PublishAllPorts': False,
                                     'Sysctls': {'net.ipv4.ip_unprivileged_port_start': '0', 'net.ipv4.ip_forward': '0'},
                                     'RestartPolicy': {'Name': 'unless-stopped', 'MaximumRetryCount': 0}, 'NetworkMode': r.EGRESS,
                                     'Memory': 134217728, 'NanoCpus': 250000000, 'PidsLimit': 32, 'IpcMode': 'none',
                                     'PidMode': '', 'Devices': [], 'Binds': None},
                      'Mounts': [{'Type': 'bind', 'Source': str(self.state_dir / 'relay'), 'Destination': '/relay', 'RW': False}],
                      'NetworkSettings': {'Networks': {r.EGRESS: {'NetworkID': EID, 'IPAddress': '172.31.0.2', 'Aliases': [r.RELAY]},
                                                        r.BACKEND: {'NetworkID': BID, 'IPAddress': RELAY_IP, 'Aliases': [r.HOSTNAME]}}},
                      'State': {'Running': True, 'Health': {'Status': 'healthy'}}}
        self.before = {'schemaVersion': 2, 'executionUid': 1000, 'stateDirectorySha256': self.state_sha,
                       'schoolId': v.SCHOOL_ID, 'schoolImageId': r.IMAGE, 'schoolSourceSha': r.SOURCE,
                       'schoolFingerprint': r.school_fingerprint(self.school), 'backendFingerprint': r.network_fingerprint(self.backend),
                       'backendId': BID, 'schoolAddress': IP, 'observedAtUtc': v.ACTIVATED_AT}
        self.saved = {'schemaVersion': 2, 'executionUid': 1000, 'stateDirectorySha256': self.state_sha,
                      'repairConfigSha256': v.CONFIG_SHA, 'schoolFingerprint': self.before['schoolFingerprint'],
                      'backendFingerprint': self.before['backendFingerprint'], 'relayId': v.RELAY_ID, 'egressId': EID,
                      'labels': self.labels, 'runtimeConfigSha256': self.runtime_sha}
        self.documents = {'before.json': self.before, 'state.json': self.saved, 'runtime.json': self.runtime, 'manifest.json': self.manifest}
        self.scripts = dict(v.FILE_HASHES)
        self.commands = []
        self.probe_result = {'dnsOk': True, 'expectedRelayOnly': True, 'healthy': True, 'httpStatus': 200, 'databaseAvailable': True}
        self.after_probe = None
        self.fail_health = False

    def command(self, args, input, **kwargs):
        self.commands.append((copy.deepcopy(args), input))
        r = self.r
        if len(args) == 4 and args[:1] == ['docker'] and args[2] == 'inspect':
            objects = {'container': {r.SCHOOL: self.school, v.SCHOOL_ID: self.school, r.RELAY: self.relay, v.RELAY_ID: self.relay},
                       'network': {r.BACKEND: self.backend, r.EGRESS: self.egress}, 'image': {r.IMAGE: self.image}}
            value = objects[args[1]].get(args[3])
            return SimpleNamespace(returncode=0 if value else 1, stdout=json.dumps([value]) if value else '', stderr='missing')
        if args == ['docker', 'exec', v.RELAY_ID, 'node', '/relay/healthcheck.mjs']:
            return SimpleNamespace(returncode=1 if self.fail_health else 0, stdout='', stderr='')
        if args == ['docker', 'exec', '-i', v.SCHOOL_ID, 'node', '-', RELAY_IP] and input == r.PROBE_JS:
            if self.after_probe:
                self.after_probe()
            return SimpleNamespace(returncode=0, stdout=json.dumps(self.probe_result), stderr='')
        raise AssertionError('Forbidden subprocess reached transport')

    def verify(self, env=None):
        r = self.r
        r.caller_context = lambda: (1000, self.root)
        r.open_shared_lock = lambda uid: 700
        r.LOCK_PATH = FixturePath('/var/lock/school-1-11-production.lock')
        r.private_dir = lambda path, uid, create=False: v.require(create is False, 'creation_attempted')
        r.load_json = lambda path, uid, mode=0o600: copy.deepcopy(self.documents[path.name])
        r.sha_file = lambda path, uid, mode: self.scripts[path.name]
        with patch.object(v, 'STATE_SHA', self.state_sha), patch.object(v, 'RUNTIME_SHA', self.runtime_sha), \
             patch.object(v.os, 'getuid', return_value=1000), patch.object(v.os, 'geteuid', return_value=1000), \
             patch.object(v.os, 'getgid', return_value=1000), patch.object(v.os, 'getegid', return_value=1000), \
             patch.object(v.os, 'fstat', return_value=LOCK_STAT), patch.object(v.os, 'close') as closed, \
             patch.object(v.subprocess, 'run', side_effect=self.command), \
             patch.object(v.os, 'chmod', side_effect=AssertionError('mutation')), patch.object(v.os, 'chown', side_effect=AssertionError('mutation')), \
             patch.object(v.os, 'mkdir', side_effect=AssertionError('mutation')), patch.object(v.os, 'unlink', side_effect=AssertionError('mutation')):
            receipt = v.verify(r, self.manifest, ENV if env is None else env)
            closed.assert_called_once_with(700)
            return receipt


class InstalledRelayTests(unittest.TestCase):
    def setUp(self):
        self.e = Engine()

    def refused(self):
        with self.assertRaises((v.Refused, self.e.r.Refused)):
            self.e.verify()

    def test_fresh_receipt_preserves_install_identity_without_any_mutations(self):
        receipt = self.e.verify()
        self.assertEqual(receipt['mode'], 'verified-existing')
        self.assertEqual(receipt['activatedAtUtc'], v.ACTIVATED_AT)
        self.assertEqual(receipt['repairConfigSha256'], v.CONFIG_SHA)
        self.assertNotIn('fixture-secret', json.dumps(receipt))
        self.assertNotIn('result', receipt)  # No fabricated browser SSO result.
        self.assertGreaterEqual(datetime.datetime.fromisoformat(receipt['verifiedAtUtc'].replace('Z', '+00:00')),
                                datetime.datetime.fromisoformat(v.ACTIVATED_AT.replace('Z', '+00:00')))
        self.assertEqual(len([args for args, _ in self.e.commands if args[1] == 'exec']), 2)

    def test_new_candidate_is_not_substituted_for_installer_labels(self):
        self.e.labels[self.e.r.PREFIX+'release-sha'] = ENV['RELEASE_SHA']
        self.refused()

    def test_installer_release_cannot_be_replayed_as_continuation(self):
        with self.assertRaises(v.Refused): self.e.verify(ENV | {'RELEASE_SHA': v.INSTALL_SHA})

    def test_installer_run_cannot_be_replayed(self):
        with self.assertRaises(v.Refused): self.e.verify(ENV | {'RELEASE_RUN_ID': v.INSTALL_RUN})

    def test_foreign_run_and_attempt_in_saved_labels_rejected(self):
        for name in ('run-id', 'attempt'):
            with self.subTest(name=name):
                self.e = Engine()
                self.e.labels[self.e.r.PREFIX+name] = '999'
                self.refused()

    def test_future_or_naive_backup_metadata_rejected(self):
        for stamp in ('2026-09-08T09:16:11Z', '2026-09-08T09:16:10'):
            with self.subTest(stamp=stamp):
                self.e = Engine()
                self.e.before['observedAtUtc'] = stamp
                self.refused()

    def test_missing_relay_cannot_trigger_install(self):
        self.e.relay = None
        self.refused()
        self.assertFalse(any(args[1] != 'container' and args[1] != 'network' for args, _ in self.e.commands))

    def test_runtime_tampering_rejected(self):
        self.e.runtime['schoolAddress'] = '172.30.0.9'
        self.refused()

    def test_full_school_configuration_changes_rejected(self):
        self.e.school['Config']['Env'].append('NEW=value')
        self.refused()

    def test_school_restart_rejected(self):
        self.e.school['State']['StartedAt'] = '2026-09-08T09:16:10Z'
        self.refused()

    def test_mount_order_only_remains_safe(self):
        self.e.school['Mounts'].reverse()
        self.e.verify()

    def test_mount_detail_change_rejected(self):
        self.e.school['Mounts'][0]['UnknownNewField'] = 'changed'
        self.refused()

    def test_internal_network_change_rejected(self):
        self.e.backend['Internal'] = False
        self.refused()

    def test_egress_foreign_peer_rejected(self):
        self.e.egress['Containers']['e'*64] = {'IPv4Address': '172.31.0.3/24'}
        self.refused()

    def test_egress_foreign_labels_rejected(self):
        self.e.egress['Labels'] = self.e.labels | {'unreviewed': 'yes'}
        self.refused()

    def test_deployed_script_and_manifest_tamper_rejected(self):
        self.e.scripts['relay.mjs'] = 'a'*64
        self.refused()
        self.e = Engine()
        self.e.documents['manifest.json'] = copy.deepcopy(self.e.manifest) | {'extra': True}
        self.refused()

    def test_unhealthy_tls_or_school_probe_rejected(self):
        self.e.fail_health = True
        self.refused()
        self.e = Engine()
        self.e.probe_result['expectedRelayOnly'] = False
        self.refused()

    def test_second_snapshot_detects_runtime_mutation(self):
        self.e.after_probe = lambda: self.e.runtime.update({'executionUid': 999})
        self.refused()

    def test_second_snapshot_detects_relay_configuration_mutation(self):
        self.e.after_probe = lambda: self.e.relay['HostConfig'].update({'Privileged': True})
        self.refused()

    def test_inode_change_is_refused(self):
        changed = SimpleNamespace(**(LOCK_STAT.__dict__ | {'st_ino': 99}))
        original = FixturePath.lstat
        with patch.object(FixturePath, 'lstat', lambda path: changed if path.name == 'school-1-11-production.lock' else original(path)):
            self.refused()

    def test_transported_controller_and_manifest_are_immutable(self):
        for name in ('repair.py', 'manifest.json', 'relay.mjs', 'healthcheck.mjs'):
            envelope = json.loads(BUNDLE)
            envelope['files'][name] = base64.b64encode(b'changed').decode()
            with self.subTest(name=name), self.assertRaises(v.Refused):
                v.load_controller(json.dumps(envelope).encode())

    def test_bounded_unique_envelope(self):
        with self.assertRaises(v.Refused): v.load_controller(b'x'*(v.MAX_BUNDLE+1))
        with self.assertRaises(v.Refused): v.load_controller(b'{"schemaVersion":1,"schemaVersion":1,"files":{}}')

    def test_imported_mutators_are_disabled(self):
        for name in ('repair', 'main', 'publish_bytes', 'write_json', 'sync_directory', 'free_backend_ip'):
            with self.subTest(name=name), self.assertRaises(v.Refused): getattr(self.e.r, name)()
        with self.assertRaises(v.Refused): self.e.r.private_dir(self.e.root, 1000, create=True)

    def test_receipt_is_accepted_by_unchanged_r3_schema_validator(self):
        checker_path = SOURCE.parent.parent.parent / '.github/scripts/check-school-repair-receipt-r3.py'
        checker_spec = importlib.util.spec_from_file_location('unchanged_receipt_r3', checker_path)
        checker = importlib.util.module_from_spec(checker_spec)
        checker_spec.loader.exec_module(checker)
        receipt = self.e.verify()
        checker.validate(receipt, self.e.manifest, v.CONFIG_SHA, datetime.datetime.now(datetime.timezone.utc))

    def test_foreign_state_path_cannot_be_adopted(self):
        self.e.state_sha = 'e'*64
        self.refused()
        self.assertEqual(self.e.commands, [])

    def test_exact_ordinary_uid_and_gid_fail_before_caller_or_transport(self):
        for identity in ((0, 0, 0, 0), (1000, 0, 1000, 1000), (1000, 1000, 1001, 1001)):
            with self.subTest(identity=identity), \
                 patch.object(v.os, 'getuid', return_value=identity[0]), patch.object(v.os, 'geteuid', return_value=identity[1]), \
                 patch.object(v.os, 'getgid', return_value=identity[2]), patch.object(v.os, 'getegid', return_value=identity[3]), \
                 patch.object(self.e.r, 'caller_context', side_effect=AssertionError('must not inspect caller')), \
                 patch.object(v.subprocess, 'run', side_effect=AssertionError('must not invoke Docker')), self.assertRaises(v.Refused):
                v.verify(self.e.r, self.e.manifest, ENV)

    def test_group_writable_lock_cannot_be_normalized(self):
        with patch.object(LOCK_STAT, 'st_mode', stat.S_IFREG | 0o664):
            self.refused()
        self.assertEqual(self.e.commands, [])

    def test_foreign_lock_owner_cannot_be_normalized(self):
        with patch.object(LOCK_STAT, 'st_uid', 0):
            self.refused()
        self.assertEqual(self.e.commands, [])

    def test_readonly_command_allowlist_cannot_run_other_exec_or_mutate(self):
        transport = v.ReadOnlyDocker(self.e.r)
        for args in (['sudo', 'true'], ['docker', 'restart', v.RELAY_ID], ['docker', 'network', 'create', 'x'],
                     ['docker', 'exec', v.SCHOOL_ID, 'sh', '-c', 'true']):
            with self.subTest(args=args), self.assertRaises(v.Refused): transport.run(args)
        with self.assertRaises(v.Refused): transport.inspect('container', 'foreign')


if __name__ == '__main__':
    unittest.main()
