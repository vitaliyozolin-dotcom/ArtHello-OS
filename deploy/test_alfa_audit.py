import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
import contextlib
import io
import runpy
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('audit',Path(__file__).with_name('alfa_audit.py'))
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)

class CentralSourceTests(unittest.TestCase):
    def test_confirmed_release85_and_current_controller_are_accepted(self):
        audit.verify_central_source('49cea8d5f69d356e16c6aa88ecc8a7e93cef417d','c'*40)
        audit.verify_central_source('c'*40,'c'*40)

    def test_unconfirmed_runtime_never_reaches_bank_audit(self):
        with self.assertRaisesRegex(audit.release.Refused,'CENTRAL_SOURCE'):
            audit.verify_central_source('f'*40,'c'*40)

class SchoolPinTests(unittest.TestCase):
    def probe(self, fingerprint):
        calls=[]
        def run(command, **kwargs):
            calls.append(command)
            if command[0]=='ssh-keyscan': return subprocess.CompletedProcess(command,0,b'fixture ssh-ed25519 synthetic-public-key\n',b'')
            if command[0]=='ssh-keygen': return subprocess.CompletedProcess(command,0,('256 '+fingerprint+' fixture (ED25519)\n').encode(),b'')
            if sum(c[0]=='ssh' for c in calls)==1: return subprocess.CompletedProcess(command,255,b'',b'Host key verification failed.')
            self.assertIn('StrictHostKeyChecking=yes',command)
            known=next(v.split('=',1)[1] for v in command if v.startswith('UserKnownHostsFile='))
            self.assertIn('synthetic-public-key',Path(known).read_text())
            return subprocess.CompletedProcess(command,0,json.dumps({'status':'verified','candidates':[]}).encode(),b'')
        with patch.dict(audit.os.environ,{'DEPLOY_HOST':'fixture.test','DEPLOY_USER':'fixture','DEPLOY_PORT':'2222','SSH_PRIVATE_KEY':'x'*150,'SSH_KNOWN_HOSTS':'fixture old-key-value'},clear=True),patch.object(audit.subprocess,'run',side_effect=run):
            return audit.school_inventory(),calls
    def test_only_previously_pinned_key_allows_authenticated_retry(self):
        result,calls=self.probe(audit.SCHOOL_HOST_PIN)
        self.assertEqual(result['status'],'verified')
        self.assertEqual(sum(c[0]=='ssh' for c in calls),2)
    def test_untrusted_key_never_reaches_second_connection(self):
        result,calls=self.probe('SHA256:not-the-accepted-school-key')
        self.assertEqual(result['reason'],'PINNED_KEY_MISMATCH')
        self.assertEqual(sum(c[0]=='ssh' for c in calls),1)

class StoppedInventoryTests(unittest.TestCase):
    def probe(self, running=False):
        row={'Id':'a'*64,'Image':'sha256:'+'b'*64,
             'State':{'Running':running,'ExitCode':137,'OOMKilled':True,'FinishedAt':'2026-09-26T00:00:00Z','Error':'private-error'},
             'Config':{'WorkingDir':'/app','Env':['DATABASE_PATH=/data/private.sqlite']},
             'HostConfig':{'ReadonlyRootfs':False,'PortBindings':{},'RestartPolicy':{'Name':'on-failure','MaximumRetryCount':5}},
             'Mounts':[{'Destination':'/data','Type':'volume','RW':True,'Name':'private-volume'}],
             'NetworkSettings':{'Networks':{'private-network':{}}}}
        def run(command, **kwargs):
            args=command[1:]
            if args==['ps','-q']: data=('a'*64).encode() if running else b''
            elif args==['ps','-aq']: data=('a'*64).encode()
            elif args[0]=='inspect': data=json.dumps([row]).encode()
            elif args[:2]==['image','inspect']:
                revision='5802a5e6fb6d254f1f67a3776ae0c47d43a68859' if running else '5876accedbdf3758971fdc383f1e0fad8c32a158'
                data=json.dumps([{'Config':{'Labels':{'org.opencontainers.image.revision':revision}}}]).encode()
            else: self.fail('Unexpected Docker operation')
            return subprocess.CompletedProcess(command,0,data,b'')
        output=io.StringIO()
        with patch('subprocess.run',side_effect=run),contextlib.redirect_stdout(output):
            runpy.run_path(str(Path(__file__).with_name('school_inventory.py')))
        return json.loads(output.getvalue()),output.getvalue()

    def test_accepted_successor_is_read_back_as_current_writer(self):
        report,text=self.probe(running=True)
        self.assertEqual(report['status'],'verified')
        self.assertEqual(report['applicationContainerId'],'a'*64)
        self.assertEqual(len(report['candidates']),1)
        self.assertEqual(report['stoppedCandidates'],[])
        self.assertNotIn('private-',text)

    def test_stopped_diagnostics_keep_retry_limit_without_disclosing_names(self):
        report,text=self.probe(); stopped=report['stoppedCandidates'][0]
        self.assertEqual(report['status'],'blocked')
        self.assertIsNone(report['applicationContainerId'])
        self.assertEqual(stopped['restartMaximumRetryCount'],5)
        self.assertTrue(stopped['oomKilled'])
        self.assertTrue(stopped['errorPresent'])
        self.assertTrue(stopped['dataVolumePresent'])
        self.assertNotIn('private-',text)

class RuntimeFailureTests(unittest.TestCase):
    def test_runtime_summary_counts_only_fixed_signals(self):
        container={'State':{'Running':True,'OOMKilled':False,'Error':'PRIVATE'},'RestartCount':2,'Config':{'Env':['PRIVATE']}}
        lines=b'PRIVATE token\nError: Cannot perform I/O on behalf of a different request. PRIVATE\nalfacrm.staged_action_failed\nPRIVATE fetch failed\n'
        result=audit.summarize_runtime_failure(container,lines)
        self.assertEqual(result['restartCount'],2)
        self.assertEqual(result['signals']['crossRequestIo'],1)
        self.assertEqual(result['signals']['alfaActionFailed'],1)
        self.assertEqual(result['signals']['fetchFailed'],1)
        self.assertNotIn('PRIVATE',json.dumps(result))
        self.assertEqual(result['linesRead'],4)

    def test_runtime_log_failure_is_not_an_empty_success(self):
        container={'State':{'Running':True},'RestartCount':0}
        with patch.object(audit.subprocess,'run',return_value=subprocess.CompletedProcess([],1,b'PRIVATE',b'PRIVATE')):
            result=audit.runtime_failure_diagnostics(container,'a'*64)
        self.assertEqual(result['status'],'blocked')
        self.assertEqual(result['reason'],'RUNTIME_LOG_READ_UNCONFIRMED')
        self.assertNotIn('PRIVATE',json.dumps(result))

    def test_runtime_read_has_fixed_bounded_scope(self):
        container={'State':{'Running':True,'OOMKilled':False},'RestartCount':0}
        with patch.object(audit.subprocess,'run',return_value=subprocess.CompletedProcess([],0,b'',b'')) as run:
            result=audit.runtime_failure_diagnostics(container,'a'*64)
        self.assertEqual(result['status'],'observed')
        self.assertEqual(run.call_args.args[0],['docker','logs','--since','2h','--tail','200','a'*64])
        self.assertEqual(run.call_args.kwargs['timeout'],30)

if __name__=='__main__':unittest.main()
