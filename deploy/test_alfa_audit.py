import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
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

if __name__=='__main__':unittest.main()
