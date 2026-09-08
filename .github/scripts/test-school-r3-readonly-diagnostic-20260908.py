import importlib.util
import json
import os
from pathlib import Path
import pwd
import stat
import subprocess
import tempfile
import types
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('diagnose', Path(__file__).with_name('school-r3-readonly-diagnostic.py'))
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)


def fake_info(mode=0o755, uid=1002, gid=1002, kind=stat.S_IFDIR, inode=100):
    return types.SimpleNamespace(st_mode=kind | mode, st_uid=uid, st_gid=gid, st_nlink=1, st_dev=1, st_ino=inode)


def school_fixture():
    return {'Id': 'a'*64, 'Name': '/'+d.SCHOOL, 'Image': d.SCHOOL_IMAGE,
            'Config': {'User': '1001:1001', 'Env': ['SENSITIVE=must-never-print'],
                       'Labels': {'school.candidate-sha': d.SCHOOL_SHA, 'school.system': d.SCHOOL,
                                  'school.environment': 'production', 'unrelated': 'secret-label'}},
            'State': {'Running': True, 'Health': {'Status': 'healthy'}, 'StartedAt': d.SCHOOL_STARTED},
            'HostConfig': {'NetworkMode': d.BACKEND},
            'NetworkSettings': {'Networks': {d.BACKEND: {'IPAddress': '192.0.2.123'}}}}


class DiagnosticTests(unittest.TestCase):
    def test_lock_is_read_only_and_contents_never_read(self):
        with tempfile.TemporaryDirectory() as folder:
            lock = Path(folder) / 'lock'
            lock.write_text('must-never-print-lock-content')
            lock.chmod(0o444)
            before = lock.stat()
            with mock.patch.object(d, 'LOCK', lock), mock.patch.object(d.os, 'open', wraps=os.open) as opened, \
                 mock.patch.object(d.os, 'read', side_effect=AssertionError('contents must not be read')):
                result = d.observe_lock(os.geteuid())
            self.assertTrue(result['valid'])
            flags = opened.call_args.args[1]
            self.assertEqual(flags & (os.O_CREAT | os.O_TRUNC | os.O_WRONLY | os.O_RDWR), 0)
            self.assertTrue(flags & os.O_NOFOLLOW)
            self.assertTrue(flags & os.O_NONBLOCK)
            self.assertNotIn('must-never-print', json.dumps(result))
            self.assertEqual((before.st_ino, before.st_mode, before.st_mtime_ns),
                             (lock.stat().st_ino, lock.stat().st_mode, lock.stat().st_mtime_ns))
            self.assertEqual(lock.read_text(), 'must-never-print-lock-content')

    def test_missing_and_denied_are_distinct(self):
        with tempfile.TemporaryDirectory() as folder:
            lock = Path(folder) / 'missing'
            with mock.patch.object(d, 'LOCK', lock):
                result = d.observe_lock(os.geteuid())
            self.assertFalse(result['exists'])
            self.assertFalse(lock.exists())
        with mock.patch.object(Path, 'lstat', side_effect=PermissionError(13, 'secret-path')):
            record, info = d.observe_metadata(Path('/fixed'))
        self.assertIsNone(record['exists'])
        self.assertEqual(record['error'], 'permission_denied')
        self.assertNotIn('secret-path', json.dumps(record))

    def test_writable_lock_predicate_identifies_reason_without_modifying_it(self):
        with tempfile.TemporaryDirectory() as folder:
            lock = Path(folder) / 'lock'
            lock.write_text('preserve'); lock.chmod(0o666)
            with mock.patch.object(d, 'LOCK', lock):
                result = d.observe_lock(os.geteuid())
            self.assertTrue(result['readable'])
            self.assertFalse(result['valid'])
            self.assertFalse(result['checks']['notGroupOrWorldWritable'])
            self.assertEqual(stat.S_IMODE(lock.stat().st_mode), 0o666)

    def test_lock_symlink_fifo_and_inode_race_never_produce_valid_result(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'target'; target.write_text('preserve')
            lock = Path(folder) / 'lock'; lock.symlink_to(target)
            with mock.patch.object(d, 'LOCK', lock), mock.patch.object(d.os, 'open', side_effect=AssertionError('never open a known non-regular lock')) as opened:
                self.assertFalse(d.observe_lock(os.geteuid())['valid'])
                opened.assert_not_called()
            lock.unlink(); os.mkfifo(lock)
            with mock.patch.object(d, 'LOCK', lock), mock.patch.object(d.os, 'open', side_effect=AssertionError('never open a known non-regular lock')) as opened:
                self.assertFalse(d.observe_lock(os.geteuid())['valid'])
                opened.assert_not_called()
            self.assertEqual(target.read_text(), 'preserve')
        original = fake_info(0o644, kind=stat.S_IFREG)
        changed = fake_info(0o644, kind=stat.S_IFREG, inode=101)
        with mock.patch.object(Path, 'lstat', side_effect=[original, changed]), mock.patch.object(d.os, 'open', return_value=9), mock.patch.object(d.os, 'fstat', return_value=original), mock.patch.object(d.os, 'close'):
            record = d.observe_lock(1002)
        self.assertFalse(record['checks']['stableInode'])
        self.assertFalse(record['valid'])

    def test_home_uses_passwd_and_emits_no_username_or_path(self):
        def info(path):
            return fake_info(uid=1002 if str(path) == '/home/private-name' else 0)
        with mock.patch.object(d.pwd, 'getpwuid', return_value=types.SimpleNamespace(pw_dir='/home/private-name')), mock.patch.object(Path, 'resolve', lambda path: path), mock.patch.object(Path, 'lstat', info), mock.patch.dict(os.environ, {'HOME': '/untrusted-other', 'XDG_STATE_HOME': '/untrusted-other'}):
            record, home = d.observe_home(1002)
        self.assertTrue(record['valid'])
        self.assertEqual(home, Path('/home/private-name'))
        self.assertNotIn('private-name', json.dumps(record))
        self.assertNotIn('/home', json.dumps(record))
        self.assertNotIn('untrusted-other', json.dumps(record))
        self.assertEqual(len(record['pathSha256']), 64)

    def test_unsafe_home_ancestor_is_identified_without_fallback(self):
        def info(path):
            return fake_info(0o775 if str(path) == '/home' else 0o755,
                             uid=1002 if str(path) == '/home/private' else 0)
        with mock.patch.object(d.pwd, 'getpwuid', return_value=types.SimpleNamespace(pw_dir='/home/private')), mock.patch.object(Path, 'resolve', lambda path: path), mock.patch.object(Path, 'lstat', info):
            record, home = d.observe_home(1002)
        self.assertFalse(record['valid'])
        self.assertFalse(record['ancestors'][1]['checks']['notGroupOrWorldWritable'])
        with mock.patch.object(d.pwd, 'getpwuid', return_value=types.SimpleNamespace(pw_dir='/home/private,other')):
            record, home = d.observe_home(1002)
        self.assertIsNone(home)
        self.assertFalse(record['checks']['safeCharacters'])

    def test_state_does_not_traverse_symlink_or_read_receipts(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder); root = home / d.STATE_LEAF
            destination = home / 'do-not-traverse'; destination.mkdir()
            root.symlink_to(destination, target_is_directory=True)
            with mock.patch.object(Path, 'read_bytes', side_effect=AssertionError('no content reads')), mock.patch.object(Path, 'read_text', side_effect=AssertionError('no content reads')):
                result = d.observe_state(home, os.geteuid())
            self.assertFalse(result['configuration']['observed'])
            self.assertEqual(list(destination.iterdir()), [])
            root.unlink(); root.mkdir(mode=0o700)
            target = root/d.CONFIG_SHA; target.mkdir(mode=0o700)
            (target/'state.json').write_text('must-not-print-receipt-content')
            with mock.patch.object(Path, 'read_bytes', side_effect=AssertionError('no content reads')), mock.patch.object(Path, 'read_text', side_effect=AssertionError('no content reads')):
                result = d.observe_state(home, os.geteuid())
            self.assertTrue(result['fixedFiles']['state.json']['exists'])
            self.assertNotIn('must-not-print', json.dumps(result))
            self.assertNotIn(folder, json.dumps(result))

    def test_docker_only_four_fixed_readonly_commands_and_sanitized_output(self):
        school = school_fixture()
        backend = {'Id': 'b'*64, 'Name': d.BACKEND, 'Driver': 'bridge', 'Internal': True,
                   'EnableIPv6': False, 'Containers': {'a'*64: {'Name': 'secret-other-data'}}, 'Labels': {}}
        def run(args, **kwargs):
            if args[-1] == d.SCHOOL:
                return types.SimpleNamespace(returncode=0, stdout=json.dumps([school]), stderr='')
            if args[-1] == d.BACKEND:
                return types.SimpleNamespace(returncode=0, stdout=json.dumps([backend]), stderr='')
            return types.SimpleNamespace(returncode=1, stdout='', stderr=f'Error response from daemon: No such {args[1]}: {args[-1]}\n')
        with mock.patch.object(d.subprocess, 'run', side_effect=run) as called:
            result = d.observe_docker()
        commands = [call.args[0] for call in called.call_args_list]
        self.assertEqual(commands, [['docker','container','inspect',d.SCHOOL], ['docker','container','inspect',d.RELAY], ['docker','network','inspect',d.BACKEND], ['docker','network','inspect',d.EGRESS]])
        self.assertTrue(all(result['school']['baselineChecks'].values()))
        self.assertFalse(result['relay']['exists'])
        self.assertFalse(result['egress']['exists'])
        self.assertTrue(result['backend']['containsSchool'])
        encoded = json.dumps(result)
        for secret in ('must-never-print', 'secret-label', 'secret-other-data', '192.0.2.123', 'SENSITIVE'):
            self.assertNotIn(secret, encoded)

    def test_docker_denied_timeout_malformed_and_unknown_errors_do_not_claim_absence(self):
        for response in [types.SimpleNamespace(returncode=1,stdout='',stderr='permission denied at /secret/socket'),
                         types.SimpleNamespace(returncode=1,stdout='',stderr='Error: no such maybe secret'),
                         types.SimpleNamespace(returncode=0,stdout='secret-invalid-json',stderr='')]:
            with mock.patch.object(d.subprocess,'run',return_value=response):
                result=d.observe_docker()
            self.assertTrue(all(result[key]['exists'] is None for key in ('school','relay','backend','egress')))
            self.assertNotIn('secret',json.dumps(result))
        with mock.patch.object(d.subprocess,'run',side_effect=subprocess.TimeoutExpired('secret-command',20)):
            result=d.observe_docker()
        self.assertEqual(result['school']['error'],'command_timeout')
        self.assertIsNone(result['relay']['exists'])

    def test_docker_missing_without_any_success_does_not_assert_daemon_available(self):
        def run(args, **kwargs):
            return types.SimpleNamespace(returncode=1,stdout='',stderr=f'Error response from daemon: No such {args[1]}: {args[-1]}')
        with mock.patch.object(d.subprocess,'run',side_effect=run):
            result=d.observe_docker()
        self.assertFalse(result['daemonObserved'])
        self.assertIsNone(result['relay']['exists'])

    def test_labels_only_emit_validated_public_identities(self):
        result=d.safe_repair_labels({d.LABEL_PREFIX+'owner':'secret-owner',
                                    d.LABEL_PREFIX+'execution-uid':'secret-uid',
                                    d.LABEL_PREFIX+'release-sha':'secret-token',
                                    d.LABEL_PREFIX+'activated-at':'secret-path'})
        self.assertEqual(result['owner'],'other')
        self.assertNotIn('secret',json.dumps(result))
        self.assertIsNone(result['releaseSha'])


if __name__ == '__main__':
    unittest.main()
