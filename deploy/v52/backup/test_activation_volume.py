"""Real UID/SQLite-independent filesystem tests; root is a fixture setup identity only."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('activation_volume', Path(__file__).with_name('activation-volume.py'))
activation = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(activation)
SHA = '1' * 40
NONCE = '2' * 64
NEXT = '3' * 64


def mapped_test_identities():
    if os.geteuid() != 0:
        return False
    for filename, identity in [('/proc/self/uid_map', 1002), ('/proc/self/gid_map', 1002)]:
        try:
            ranges = [list(map(int, line.split())) for line in Path(filename).read_text().splitlines()]
        except OSError:
            return False
        if not any(start <= identity < start + count for start, _host, count in ranges):
            return False
    return True


if os.environ.get('ARTHELLO_ACTIVATION_REQUIRE_REAL_IDS') == '1' and not mapped_test_identities():
    raise RuntimeError('HOSTED_ACTIVATION_AUTHORITY_REQUIRES_REAL_IDS')


@unittest.skipUnless(mapped_test_identities(), 'Real UID1002/UID1000 authority needs mapped IDs and root fixture setup; hosted Docker acceptance remains mandatory')
class ActivationVolumeTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='arthello-activation-v2-'))
        self.directory = self.root / 'activation'
        self.directory.mkdir()
        os.chmod(self.root, 0o755)
        os.chown(self.directory, 1002, 1000)
        os.chmod(self.directory, 0o750)
        self.seed = self.directory / activation.SEED
        self.seed.write_bytes(activation.SEED_DATA)
        os.chown(self.seed, 1002, 1000)
        os.chmod(self.seed, 0o440)

    def tearDown(self):
        shutil.rmtree(self.root)

    def child(self, callback, uid=1002, gid=1000):
        read_fd, write_fd = os.pipe()
        pid = os.fork()
        if pid == 0:
            os.close(read_fd)
            try:
                os.setgroups([])
                os.setgid(gid)
                os.setuid(uid)
                result = {'ok': True, 'value': callback()}
            except Exception as error:
                result = {'ok': False, 'error': type(error).__name__, 'code': str(error)}
            os.write(write_fd, json.dumps(result).encode())
            os.close(write_fd)
            os._exit(0)
        os.close(write_fd)
        result = b''
        while True:
            chunk = os.read(read_fd, 4096)
            if not chunk:
                break
            result += chunk
        os.close(read_fd)
        _, status = os.waitpid(pid, 0)
        self.assertEqual(status, 0)
        return json.loads(result)

    def operation(self, command='write', sha=SHA, nonce=NONCE, hook=None):
        fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            if hook:
                return hook(fd)
            if command == 'empty':
                activation.validate_writer()
                activation.inspect_directory(fd, empty=True)
                return {'empty': True}
            return activation.write_at(fd, sha, nonce)
        finally:
            os.close(fd)

    def marker(self, content=None, uid=1002, gid=1000, mode=0o640):
        p = self.directory / activation.MARKER
        p.write_bytes(activation.validate_identity(SHA, NONCE) if content is None else content)
        os.chown(p, uid, gid)
        os.chmod(p, mode)
        return p

    def test_write_replace_and_equal_replay_are_owned_bounded_and_durable(self):
        result = self.child(self.operation)
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['value']['mode'], 'created')
        p = self.directory / activation.MARKER
        m = p.stat()
        self.assertEqual((m.st_uid, m.st_gid, stat.S_IMODE(m.st_mode), m.st_nlink), (1002, 1000, 0o640, 1))
        self.assertEqual(p.read_bytes(), activation.validate_identity(SHA, NONCE))
        again = self.child(self.operation)
        self.assertEqual(again['value']['mode'], 'verified-existing')
        self.assertEqual(p.stat().st_ino, m.st_ino)
        replaced = self.child(lambda: self.operation(nonce=NEXT))
        self.assertEqual(replaced['value']['mode'], 'replaced')
        self.assertEqual(p.read_bytes(), activation.validate_identity(SHA, NEXT))
        self.assertEqual(set(os.listdir(self.directory)), {activation.SEED, activation.LOCK, activation.MARKER})

    def test_check_empty_is_read_only_and_rejects_present_marker(self):
        before = list(self.directory.iterdir())
        self.assertTrue(self.child(lambda: self.operation('empty'))['ok'])
        self.assertEqual(list(self.directory.iterdir()), before)
        self.marker()
        self.assertEqual(self.child(lambda: self.operation('empty'))['code'], 'MARKER_ALREADY_PRESENT')

    def test_root_application_and_wrong_primary_group_are_not_writer_authority(self):
        for uid, gid in [(0, 0), (1000, 1000), (1002, 1002)]:
            with self.subTest(uid=uid, gid=gid):
                result = self.child(self.operation, uid, gid)
                self.assertFalse(result['ok'])
        self.assertEqual(set(os.listdir(self.directory)), {activation.SEED})

    def test_application_cannot_create_modify_rename_or_delete_marker_even_with_shared_read_group(self):
        self.marker()
        operations = [
            lambda: (self.directory / 'forged').write_text('x'),
            lambda: (self.directory / activation.MARKER).write_text('x'),
            lambda: os.chmod(self.directory / activation.MARKER, 0o666),
            lambda: os.unlink(self.directory / activation.MARKER),
            lambda: os.rename(self.directory / activation.MARKER, self.directory / 'moved'),
        ]
        for action in operations:
            self.assertFalse(self.child(action, 1000, 1000)['ok'])
        self.assertEqual((self.directory / activation.MARKER).read_bytes(), activation.validate_identity(SHA, NONCE))

    def test_invalid_sha_or_nonce_never_creates_lock_or_marker(self):
        for sha, nonce in [('', NONCE), ('A' * 40, NONCE), (SHA, '2' * 32), (SHA, 'A' * 64), (SHA, NONCE + '\n')]:
            self.assertFalse(self.child(lambda: self.operation(sha=sha, nonce=nonce))['ok'])
        self.assertEqual(set(os.listdir(self.directory)), {activation.SEED})

    def test_wrong_directory_ownership_or_mode_is_not_repaired(self):
        for uid, gid, mode in [(1000,1000,0o750),(1002,1002,0o750),(1002,1000,0o770),(1002,1000,0o1750)]:
            os.chown(self.directory,uid,gid);os.chmod(self.directory,mode)
            result=self.child(self.operation)
            self.assertFalse(result['ok'])
            self.assertEqual((self.directory.stat().st_uid,self.directory.stat().st_gid,stat.S_IMODE(self.directory.stat().st_mode)),(uid,gid,mode))

    def test_seed_content_mode_owner_and_link_count_are_strict(self):
        for change in [lambda: self.seed.write_bytes(b'wrong'), lambda: os.chmod(self.seed,0o640), lambda: os.chown(self.seed,0,0), lambda: os.link(self.seed,self.root/'seed-link')]:
            self.seed.unlink();self.seed.write_bytes(activation.SEED_DATA);os.chown(self.seed,1002,1000);os.chmod(self.seed,0o440)
            change()
            self.assertFalse(self.child(self.operation)['ok'])
        self.assertFalse((self.directory/activation.MARKER).exists())

    def test_unexpected_entry_refuses_without_cleanup_or_adoption(self):
        unknown=self.directory/'foreign';unknown.write_bytes(b'preserve')
        result=self.child(self.operation)
        self.assertEqual(result['code'],'DIRECTORY_UNEXPECTED_ENTRY')
        self.assertEqual(unknown.read_bytes(),b'preserve')

    def test_existing_marker_owner_mode_hardlink_and_v1_are_never_replaced(self):
        cases=[{'uid':0},{'uid':1000},{'gid':1002},{'mode':0o660},{'content':b'ARTHELLO_TOCHKA_AUTOSYNC_V1 '+SHA.encode()+b' '+b'2'*32+b'\n'},{'content':b'x'*161}]
        for options in cases:
            p=self.directory/activation.MARKER
            if p.exists():p.unlink()
            p=self.marker(**options);before=p.read_bytes();meta=p.stat()
            self.assertFalse(self.child(lambda:self.operation(nonce=NEXT))['ok'])
            self.assertEqual(p.read_bytes(),before);self.assertEqual(p.stat().st_ino,meta.st_ino)
        p.unlink();p=self.marker();os.link(p,self.root/'marker-link')
        self.assertEqual(self.child(self.operation)['code'],'MARKER_LINK_COUNT_INVALID')

    def test_symlink_directory_and_fifo_markers_fail_without_blocking(self):
        p=self.directory/activation.MARKER
        target=self.root/'target';target.write_bytes(b'preserve')
        p.symlink_to(target)
        self.assertFalse(self.child(self.operation)['ok']);p.unlink()
        p.mkdir();os.chown(p,1002,1000)
        self.assertFalse(self.child(self.operation)['ok']);p.rmdir()
        os.mkfifo(p,0o640);os.chown(p,1002,1000)
        self.assertFalse(self.child(self.operation)['ok'])
        self.assertEqual(target.read_bytes(),b'preserve')

    def test_lock_exclusion_prevents_concurrent_publication(self):
        p=self.directory/activation.LOCK;p.touch(mode=0o600);os.chown(p,1002,1000)
        fd=os.open(p,os.O_RDWR)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            result=self.child(self.operation)
            self.assertEqual(result['error'],'BlockingIOError')
            self.assertFalse((self.directory/activation.MARKER).exists())
        finally:os.close(fd)

    def test_failure_before_rename_preserves_previous_marker_and_cleans_own_stage(self):
        self.marker()
        def hook(fd):
            with mock.patch.object(activation.os,'replace',side_effect=OSError('fixture')):
                return activation.write_at(fd,SHA,NEXT)
        self.assertFalse(self.child(lambda:self.operation(hook=hook))['ok'])
        self.assertEqual((self.directory/activation.MARKER).read_bytes(),activation.validate_identity(SHA,NONCE))
        self.assertEqual(set(os.listdir(self.directory)),{activation.SEED,activation.LOCK,activation.MARKER})

    def test_retry_after_rename_before_directory_sync_syncs_both_file_and_directory(self):
        def interrupt(fd):
            original=activation.os.fsync
            def fsync(target):
                if stat.S_ISDIR(os.fstat(target).st_mode):raise OSError('fixture directory sync interruption')
                return original(target)
            with mock.patch.object(activation.os,'fsync',side_effect=fsync):return activation.write_at(fd,SHA,NONCE)
        self.assertFalse(self.child(lambda:self.operation(hook=interrupt))['ok'])
        self.assertTrue((self.directory/activation.MARKER).exists())
        def retry(fd):
            original=activation.os.fsync;calls=[]
            def fsync(target):
                calls.append('directory' if stat.S_ISDIR(os.fstat(target).st_mode) else 'file')
                return original(target)
            with mock.patch.object(activation.os,'fsync',side_effect=fsync):result=activation.write_at(fd,SHA,NONCE)
            return {'receipt':result,'syncs':calls}
        result=self.child(lambda:self.operation(hook=retry))
        self.assertTrue(result['ok'],result)
        self.assertEqual(result['value']['receipt']['mode'],'verified-existing')
        self.assertEqual(result['value']['syncs'],['file','directory'])

    def test_cli_fixed_path_rejects_arbitrary_absolute_directory(self):
        self.assertEqual(self.child(lambda:activation.open_directory(str(self.directory)))['code'],'DIRECTORY_PATH_INVALID')


class PortableFilesystemModelTests(unittest.TestCase):
    """Real filesystem/atomicity with explicit current-UID model, not authority proof."""
    def setUp(self):
        self.directory=Path(tempfile.mkdtemp(prefix='arthello-activation-model-'))
        os.chmod(self.directory,0o750)
        self.seed=self.directory/activation.SEED
        self.seed.write_bytes(activation.SEED_DATA);os.chmod(self.seed,0o440)
        self.ids=mock.patch.multiple(activation,WRITER_UID=os.geteuid(),READER_GID=os.getegid())
        self.ids.start()
        self.fd=os.open(self.directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)

    def tearDown(self):
        os.close(self.fd);self.ids.stop();shutil.rmtree(self.directory)

    def test_model_write_replay_and_replacement_preserve_exact_v2_bytes(self):
        self.assertEqual(activation.write_at(self.fd,SHA,NONCE)['mode'],'created')
        self.assertEqual(activation.write_at(self.fd,SHA,NONCE)['mode'],'verified-existing')
        self.assertEqual(activation.write_at(self.fd,SHA,NEXT)['mode'],'replaced')
        self.assertEqual((self.directory/activation.MARKER).read_bytes(),activation.validate_identity(SHA,NEXT))

    def test_model_failure_before_rename_keeps_prior_marker(self):
        activation.write_at(self.fd,SHA,NONCE)
        with mock.patch.object(activation.os,'replace',side_effect=OSError('fixture')):
            with self.assertRaises(OSError):activation.write_at(self.fd,SHA,NEXT)
        self.assertEqual((self.directory/activation.MARKER).read_bytes(),activation.validate_identity(SHA,NONCE))
        self.assertEqual(set(os.listdir(self.directory)),{activation.SEED,activation.LOCK,activation.MARKER})

    def test_model_retry_after_interrupted_directory_fsync_restores_durability(self):
        original=activation.os.fsync
        def interrupt(target):
            if stat.S_ISDIR(os.fstat(target).st_mode):raise OSError('interrupted directory sync')
            return original(target)
        with mock.patch.object(activation.os,'fsync',side_effect=interrupt):
            with self.assertRaises(OSError):activation.write_at(self.fd,SHA,NONCE)
        calls=[]
        def record_sync(target):
            calls.append('directory' if stat.S_ISDIR(os.fstat(target).st_mode) else 'file')
            return original(target)
        with mock.patch.object(activation.os,'fsync',side_effect=record_sync):
            self.assertEqual(activation.write_at(self.fd,SHA,NONCE)['mode'],'verified-existing')
        self.assertEqual(calls,['file','directory'])

    def test_model_existing_v1_and_foreign_contents_remain_untouched(self):
        p=self.directory/activation.MARKER
        for data in [b'ARTHELLO_TOCHKA_AUTOSYNC_V1 '+SHA.encode()+b' '+b'2'*32+b'\n',b'wrong',b'x'*161]:
            p.write_bytes(data);os.chmod(p,0o640)
            with self.assertRaises(activation.ActivationError):activation.write_at(self.fd,SHA,NONCE)
            self.assertEqual(p.read_bytes(),data)

    def test_model_symlink_hardlink_and_fifo_refused_before_read(self):
        p=self.directory/activation.MARKER
        p.symlink_to(self.seed)
        with self.assertRaises(OSError):activation.write_at(self.fd,SHA,NONCE)
        p.unlink();os.mkfifo(p,0o640)
        with self.assertRaises(activation.ActivationError):activation.write_at(self.fd,SHA,NONCE)
        p.unlink();p.write_bytes(activation.validate_identity(SHA,NONCE));os.chmod(p,0o640)
        other=self.directory.parent/(self.directory.name+'-link')
        try:
            os.link(p,other)
            with self.assertRaisesRegex(activation.ActivationError,'LINK_COUNT'):activation.write_at(self.fd,SHA,NONCE)
        finally:other.unlink()

    def test_model_explicit_authority_constant_is_fixed_outside_filesystem_adapter(self):
        self.ids.stop()
        try:
            self.assertEqual((activation.WRITER_UID,activation.READER_GID),(1002,1000))
            for uid,gid in [(0,0),(1000,1000),(1002,1002)]:
                with mock.patch.object(activation.os,'geteuid',return_value=uid),mock.patch.object(activation.os,'getegid',return_value=gid):
                    with self.assertRaisesRegex(activation.ActivationError,'WRITER_IDENTITY_INVALID'):activation.validate_writer()
            with mock.patch.object(activation.os,'geteuid',return_value=1002),mock.patch.object(activation.os,'getegid',return_value=1000):activation.validate_writer()
        finally:self.ids.start()


if __name__=='__main__':
    unittest.main()
