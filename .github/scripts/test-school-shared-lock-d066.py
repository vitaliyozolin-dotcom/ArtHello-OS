import fcntl
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import types
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('normalizer', Path(__file__).with_name('normalize-school-shared-lock-d066.py'))
n = importlib.util.module_from_spec(spec)
spec.loader.exec_module(n)


class NormalizerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.lock = Path(self.temporary.name) / 'existing.lock'
        self.lock.write_bytes(b'existing coordination content must remain unchanged\n')
        self.lock.chmod(0o664)
        self.patch_path = mock.patch.object(n, 'LOCK_PATH', self.lock)
        self.patch_identity = mock.patch.object(n, 'caller_identity', return_value=(os.geteuid(), os.getegid()))
        self.patch_path.start(); self.patch_identity.start()
        self.addCleanup(self.patch_path.stop); self.addCleanup(self.patch_identity.stop)

    def test_exact_existing_inode_mode_change_preserves_contents_owner_and_append(self):
        before = self.lock.stat()
        with mock.patch.object(n.os, 'fchmod', wraps=os.fchmod) as chmod, mock.patch.object(n.os, 'open', wraps=os.open) as opened:
            result = n.normalize()
        after = self.lock.stat()
        self.assertEqual(result['state'], 'verified')
        self.assertEqual(result['mode'], 'normalized')
        self.assertEqual(result['previousMode'], '0664')
        self.assertEqual(result['currentMode'], '0644')
        self.assertEqual(chmod.call_count, 1)
        self.assertEqual(chmod.call_args.args[1], 0o644)
        self.assertEqual((before.st_ino,before.st_uid,before.st_gid,before.st_size,before.st_mtime_ns),
                         (after.st_ino,after.st_uid,after.st_gid,after.st_size,after.st_mtime_ns))
        self.assertEqual(stat.S_IMODE(after.st_mode), 0o644)
        self.assertEqual(self.lock.read_bytes(), b'existing coordination content must remain unchanged\n')
        flags = opened.call_args.args[1]
        self.assertEqual(flags & (os.O_CREAT | os.O_TRUNC | os.O_WRONLY | os.O_RDWR), 0)
        self.assertTrue(flags & os.O_NOFOLLOW)
        self.assertTrue(flags & os.O_NONBLOCK)
        with self.lock.open('ab') as stream:
            stream.write(b'')
        self.assertNotIn(str(self.lock),json.dumps(result))

    def test_correct_mode_is_verified_without_chmod_or_fsync(self):
        self.lock.chmod(0o644)
        with mock.patch.object(n.os,'fchmod',side_effect=AssertionError('no mode write')), mock.patch.object(n.os,'fsync',side_effect=AssertionError('no write sync')):
            result=n.normalize()
        self.assertEqual(result['state'],'verified')
        self.assertEqual(result['mode'],'verified-existing')
        self.assertFalse(result['modeChangeAttempted'])

    def test_real_competing_flock_prevents_change_and_remains_held(self):
        holder=os.open(self.lock,os.O_RDONLY)
        try:
            fcntl.flock(holder,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with mock.patch.object(n.os,'fchmod',side_effect=AssertionError('busy lock must not change')):
                result=n.normalize()
            self.assertEqual(result['reason'],'shared_lock_busy')
            self.assertFalse(result['modeChangeAttempted'])
            self.assertEqual(stat.S_IMODE(self.lock.stat().st_mode),0o664)
        finally:
            os.close(holder)
        self.assertEqual(n.normalize()['state'],'verified')

    def test_missing_symlink_fifo_and_unreviewed_modes_never_open_or_create(self):
        self.lock.unlink()
        for kind in ('missing','symlink','fifo','other_mode'):
            if kind=='symlink': self.lock.symlink_to(Path(self.temporary.name)/'missing-target')
            if kind=='fifo': os.mkfifo(self.lock)
            if kind=='other_mode': self.lock.write_text('preserve'); self.lock.chmod(0o666)
            with mock.patch.object(n.os,'open',side_effect=AssertionError('must fail before open')):
                result=n.normalize()
            self.assertEqual(result['state'],'refused')
            self.assertFalse(result['modeChangeAttempted'])
            if self.lock.exists() or self.lock.is_symlink(): self.lock.unlink()
        self.assertFalse(self.lock.exists())

    def test_foreign_owner_group_and_hardlink_refused(self):
        info=self.lock.stat()
        for field,value in [('st_uid',info.st_uid+1),('st_gid',info.st_gid+1),('st_nlink',2)]:
            patched=types.SimpleNamespace(**{key:getattr(info,key) for key in ('st_mode','st_uid','st_gid','st_nlink','st_dev','st_ino')})
            setattr(patched,field,value)
            with mock.patch.object(Path,'lstat',return_value=patched), mock.patch.object(n.os,'open',side_effect=AssertionError('must fail before open')):
                result=n.normalize()
            self.assertEqual(result['state'],'refused')
            self.assertFalse(result['modeChangeAttempted'])

    def test_path_replacement_before_mutation_does_not_change_any_inode(self):
        original=self.lock.stat()
        changed=types.SimpleNamespace(**{key:getattr(original,key) for key in ('st_mode','st_uid','st_gid','st_nlink','st_dev','st_ino')})
        changed.st_ino+=1
        with mock.patch.object(Path,'lstat',side_effect=[original,changed]), mock.patch.object(n.os,'fchmod',side_effect=AssertionError('replaced path must not change')):
            result=n.normalize()
        self.assertEqual(result['reason'],'lock_inode_changed')
        self.assertFalse(result['modeChangeAttempted'])
        self.assertEqual(stat.S_IMODE(self.lock.stat().st_mode),0o664)

    def test_chmod_is_only_called_while_actual_exclusive_lock_is_held(self):
        actual_chmod=os.fchmod
        def locked_chmod(fd, mode):
            contender=os.open(self.lock,os.O_RDONLY)
            try:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(contender,fcntl.LOCK_EX|fcntl.LOCK_NB)
            finally: os.close(contender)
            actual_chmod(fd,mode)
        with mock.patch.object(n.os,'fchmod',side_effect=locked_chmod):
            self.assertEqual(n.normalize()['state'],'verified')

    def test_failure_after_chmod_keeps_0644_and_reports_attempt_without_rollback(self):
        with mock.patch.object(n.os,'fsync',side_effect=OSError(5,'must-never-print-secret-path')), mock.patch.object(n.os,'fchmod',wraps=os.fchmod) as chmod:
            result=n.normalize()
        self.assertEqual(result['state'],'refused')
        self.assertTrue(result['modeChangeAttempted'])
        self.assertEqual(chmod.call_count,1)
        self.assertEqual(stat.S_IMODE(self.lock.stat().st_mode),0o644)
        self.assertNotIn('must-never-print',json.dumps(result))

    def test_root_changed_real_identity_and_wrong_confirmed_uid_are_refused(self):
        self.patch_identity.stop()
        for uid,euid,gid,egid in [(0,0,0,0),(1000,1001,1000,1000),(1000,1000,1000,1001),(1002,1002,1000,1000)]:
            with mock.patch.object(n.os,'getuid',return_value=uid),mock.patch.object(n.os,'geteuid',return_value=euid),mock.patch.object(n.os,'getgid',return_value=gid),mock.patch.object(n.os,'getegid',return_value=egid),mock.patch.object(Path,'lstat',side_effect=AssertionError('identity must reject first')):
                result=n.normalize()
            self.assertEqual(result['reason'],'confirmed_deployment_identity_required')
            self.assertFalse(result['modeChangeAttempted'])


if __name__=='__main__':
    unittest.main()
