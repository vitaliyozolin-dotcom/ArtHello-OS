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
    def test_stopped_diagnostics_keep_retry_limit_without_disclosing_names(self):
        row={'Id':'a'*64,'Image':'sha256:'+'b'*64,
             'State':{'Running':False,'ExitCode':137,'OOMKilled':True,'FinishedAt':'2026-09-26T00:00:00Z','Error':'private-error'},
             'Config':{'WorkingDir':'/app','Env':['DATABASE_PATH=/data/private.sqlite']},
             'HostConfig':{'PortBindings':{},'RestartPolicy':{'Name':'on-failure','MaximumRetryCount':5}},
             'Mounts':[{'Destination':'/data','Type':'volume','RW':True,'Name':'private-volume'}],
             'NetworkSettings':{'Networks':{'private-network':{}}}}
        def run(command, **kwargs):
            args=command[1:]
            if args==['ps','-q']: data=b''
            elif args==['ps','-aq']: data=('a'*64).encode()
            elif args[0]=='inspect': data=json.dumps([row]).encode()
            elif args[:2]==['image','inspect']:
                data=json.dumps([{'Config':{'Labels':{'org.opencontainers.image.revision':'5876accedbdf3758971fdc383f1e0fad8c32a158'}}}]).encode()
            else: self.fail('Unexpected Docker operation')
            return subprocess.CompletedProcess(command,0,data,b'')
        output=io.StringIO()
        with patch('subprocess.run',side_effect=run),contextlib.redirect_stdout(output):
            runpy.run_path(str(Path(__file__).with_name('school_inventory.py')))
        report=json.loads(output.getvalue()); stopped=report['stoppedCandidates'][0]
        self.assertEqual(report['status'],'blocked')
        self.assertIsNone(report['applicationContainerId'])
        self.assertEqual(stopped['restartMaximumRetryCount'],5)
        self.assertTrue(stopped['oomKilled'])
        self.assertTrue(stopped['errorPresent'])
        self.assertTrue(stopped['dataVolumePresent'])
        self.assertNotIn('private-',output.getvalue())

if __name__=='__main__':unittest.main()
