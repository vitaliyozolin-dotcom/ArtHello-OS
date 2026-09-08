import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import pwd
import subprocess
import tempfile
import types
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('bootstrap',Path(__file__).with_name('r4-school-repair-remote.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.actual_uid=os.geteuid();self.actual_gid=os.getegid()
        self.actual_home=Path(pwd.getpwuid(self.actual_uid).pw_dir)
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup)
        self.home=Path(self.temporary.name)
        self.raw=json.dumps({'schemaVersion':1,'files':{name:base64.b64encode(b'fixture-data').decode() for name in b.FILES}}).encode()
        self.env={'RELEASE_SHA':'a'*40,'RELEASE_RUN_ID':'123','RELEASE_ATTEMPT':'1',
                  'EXPECTED_REPAIR_CONFIG_SHA256':'b'*64,
                  'EXPECTED_REPAIR_BUNDLE_SHA256':hashlib.sha256(self.raw).hexdigest()}
        for patcher in (mock.patch.dict(os.environ,self.env),
                        mock.patch.object(b.os,'getuid',return_value=1000),
                        mock.patch.object(b.os,'geteuid',return_value=1000),
                        mock.patch.object(b.os,'getgid',return_value=1000),
                        mock.patch.object(b.os,'getegid',return_value=1000),
                        mock.patch.object(b.pwd,'getpwuid',return_value=types.SimpleNamespace(pw_dir=str(self.home))),
                        mock.patch.object(b,'checked_home',return_value=self.home),
                        mock.patch.object(b.sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(self.raw)))):
            patcher.start();self.addCleanup(patcher.stop)

    def test_invalid_protected_identity_and_bundle_cannot_normalize_or_create_state(self):
        for kind in ('environment','digest','file_set'):
            raw=self.raw
            env=dict(self.env)
            if kind=='environment': env['RELEASE_SHA']='invalid'
            if kind=='digest': raw=b'changed bytes'
            if kind=='file_set':
                raw=json.dumps({'schemaVersion':1,'files':{'../escape':base64.b64encode(b'bad').decode()}}).encode()
                env['EXPECTED_REPAIR_BUNDLE_SHA256']=hashlib.sha256(raw).hexdigest()
            with mock.patch.dict(os.environ,env), mock.patch.object(b.sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(raw))),mock.patch.object(b,'normalize',side_effect=AssertionError('invalid transport must not normalize')):
                with self.assertRaises(ValueError): b.main()
            self.assertFalse((self.home/'.arthello-school-sso-relay').exists())

    def test_home_and_existing_state_refusal_precedes_normalization(self):
        for stage in ('home','state'):
            if stage=='state': (self.home/'.arthello-school-sso-relay').mkdir(mode=0o700)
            failing='checked_home' if stage=='home' else 'checked_private'
            with mock.patch.object(b,failing,side_effect=ValueError('safe-refusal')),mock.patch.object(b,'normalize',side_effect=AssertionError('unsafe paths must not normalize')):
                with self.assertRaises(ValueError): b.main()

    def test_normalization_is_after_decoded_bundle_before_strict_lock_and_staging(self):
        events=[]
        original_decode=b.decode_bundle
        def decode(raw,digest):
            result=original_decode(raw,digest);events.append('decoded');return result
        def normalize(): events.append('normalized');return {'schemaVersion':1,'state':'verified','mode':'normalized'}
        def strict(uid): events.append('strict');raise ValueError('test-stop-before-staging')
        stdout,stderr=io.StringIO(),io.StringIO()
        with mock.patch.object(b,'decode_bundle',side_effect=decode),mock.patch.object(b,'normalize',side_effect=normalize),mock.patch.object(b,'checked_shared_lock',side_effect=strict),contextlib.redirect_stdout(stdout),contextlib.redirect_stderr(stderr):
            with self.assertRaisesRegex(ValueError,'test-stop-before-staging'): b.main()
        self.assertEqual(events,['decoded','normalized','strict'])
        self.assertEqual(stdout.getvalue(),'')
        self.assertEqual(json.loads(stderr.getvalue())['state'],'verified')
        self.assertFalse((self.home/'.arthello-school-sso-relay').exists())

    def test_normalizer_refusal_does_not_reach_strict_lock_or_staging(self):
        with mock.patch.object(b,'normalize',return_value={'schemaVersion':1,'state':'refused','reason':'shared_lock_busy','modeChangeAttempted':False}),mock.patch.object(b,'checked_shared_lock',side_effect=AssertionError('must stop')),contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaisesRegex(ValueError,'normalization refused'): b.main()
        self.assertFalse((self.home/'.arthello-school-sso-relay').exists())

    def test_sanitized_error_has_stage_and_no_arbitrary_exception_text(self):
        b.STAGE='passwd_home'
        for error,code in [(PermissionError(13,'secret-user-and-path'),'permission_denied'),
                           (ValueError('secret-user-and-path'),'bootstrap_contract_invalid'),
                           (ValueError('Deployment home ancestry is unsafe'),'passwd_home_ancestry_unsafe')]:
            result=b.sanitized_failure(error)
            self.assertEqual(result['stage'],'passwd_home')
            self.assertEqual(result['reason'],code)
            self.assertNotIn('secret',json.dumps(result))

    def test_embedded_normalizer_is_exact_reviewed_standalone_function_block(self):
        # One reviewed permission-changing implementation is embedded verbatim.
        standalone=Path(__file__).with_name('normalize-school-shared-lock-d066.py').read_text()
        start=standalone.index('class Refused(Exception):')
        end=standalone.index("if __name__ == '__main__':")
        self.assertIn(standalone[start:end],Path(b.__file__).read_text())

    def test_controller_timeout_preserves_primary_stage_with_successful_or_failed_cleanup(self):
        for cleanup_fails in (False,True):
            stderr=io.StringIO()
            with contextlib.ExitStack() as stack:
                stack.enter_context(mock.patch.object(b.sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(self.raw))))
                stack.enter_context(mock.patch.object(b,'normalize',return_value={'schemaVersion':1,'state':'verified'}))
                stack.enter_context(mock.patch.object(b,'checked_shared_lock'))
                stack.enter_context(mock.patch.object(b,'checked_private'))
                stack.enter_context(mock.patch.object(b.subprocess,'run',side_effect=subprocess.TimeoutExpired('secret-controller-path',600)))
                if cleanup_fails:
                    stack.enter_context(mock.patch.object(b.shutil,'rmtree',side_effect=PermissionError(13,'secret-cleanup-path')))
                stack.enter_context(contextlib.redirect_stderr(stderr))
                with self.assertRaises(subprocess.TimeoutExpired) as caught: b.main()
            primary=b.sanitized_failure(caught.exception)
            self.assertEqual(primary['stage'],'execute_unchanged_reviewed_r3_controller')
            self.assertEqual(primary['reason'],'controller_timeout')
            records=[json.loads(line) for line in stderr.getvalue().splitlines()]
            cleanup=[record for record in records if record.get('stage')=='cleanup_own_private_staging']
            self.assertEqual(len(cleanup),1 if cleanup_fails else 0)
            if cleanup_fails: self.assertEqual(cleanup[0]['reason'],'permission_denied')
            self.assertNotIn('secret',json.dumps(primary)+stderr.getvalue())

    def test_cleanup_as_only_failure_is_reported_as_cleanup_and_never_success(self):
        with mock.patch.object(b,'normalize',return_value={'schemaVersion':1,'state':'verified'}),mock.patch.object(b,'checked_shared_lock'),mock.patch.object(b,'checked_private'),mock.patch.object(b.subprocess,'run',return_value=types.SimpleNamespace(returncode=0)),mock.patch.object(b.shutil,'rmtree',side_effect=PermissionError(13,'secret-cleanup-path')),contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(PermissionError) as caught: b.main()
        failure=b.sanitized_failure(caught.exception)
        self.assertEqual(failure['stage'],'cleanup_own_private_staging')
        self.assertEqual(failure['reason'],'permission_denied')

    def test_real_ordinary_process_normalizes_unpacks_executes_and_cleans_up(self):
        if self.actual_uid==0:
            if os.environ.get('GITHUB_ACTIONS')=='true':
                self.fail('Hosted D066 bootstrap must exercise a real ordinary UID')
            self.skipTest('Local runtime is root; required hosted gate runs the real ordinary-UID fixture')
        with tempfile.TemporaryDirectory(dir=self.actual_home) as folder:
            work=Path(folder);work.chmod(0o755)
            home=work/'home';home.mkdir(mode=0o700)
            lock=work/'existing.lock';lock.write_bytes(b'unchanged');lock.chmod(0o664)
            original=lock.stat()
            fixture=b'import json,os; print(json.dumps({"actualUid":os.geteuid(),"fixture":True}))\n'
            raw=json.dumps({'schemaVersion':1,'files':{name:base64.b64encode(fixture if name=='repair.py' else b'fixture').decode() for name in b.FILES}},sort_keys=True,separators=(',',':')).encode()
            environment=dict(os.environ,**self.env)
            environment['EXPECTED_REPAIR_BUNDLE_SHA256']=hashlib.sha256(raw).hexdigest()
            code='''import importlib.util,os,pathlib,sys,types
spec=importlib.util.spec_from_file_location('bootstrap',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
assert os.geteuid()>0
m.EXPECTED_UID=os.geteuid();m.EXPECTED_GID=os.getegid()
m.LOCK_PATH=pathlib.Path(sys.argv[2]);m.pwd.getpwuid=lambda uid:types.SimpleNamespace(pw_dir=sys.argv[3])
m.main()
'''
            result=subprocess.run([os.sys.executable,'-I','-c',code,str(Path(b.__file__).resolve()),str(lock),str(home)],input=raw,capture_output=True,env=environment)
            self.assertEqual(result.returncode,0,result.stderr.decode())
            self.assertEqual(json.loads(result.stdout),{'actualUid':self.actual_uid,'fixture':True})
            receipt=json.loads(result.stderr)
            self.assertEqual(receipt['state'],'verified')
            self.assertEqual(receipt['mode'],'normalized')
            self.assertEqual(receipt['executionUid'],self.actual_uid)
            self.assertEqual(lock.stat().st_mode&0o777,0o644)
            self.assertEqual(lock.stat().st_ino,original.st_ino)
            self.assertEqual(lock.read_bytes(),b'unchanged')
            state=home/'.arthello-school-sso-relay'
            self.assertEqual(state.stat().st_mode&0o777,0o700)
            self.assertEqual(list(state.iterdir()),[])


if __name__=='__main__': unittest.main()
