import ast,copy,hashlib,importlib.util,io,json
from contextlib import redirect_stdout
from datetime import datetime,timezone
from pathlib import Path
import tempfile,unittest,zipfile
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
def load(name,path):
 s=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
d=load('r17_download','.github/scripts/download-v52-artifact-r17.py')
old=load('r15_download','.github/scripts/download-v52-artifact-r15.py')
ACTUAL=json.loads((ROOT/'.github/scripts/fixtures/r17-producer-artifacts.json').read_text())
NOW=datetime(2026,9,10,14,28,tzinfo=timezone.utc)
class Tests(unittest.TestCase):
 def setUp(self):
  self.v=copy.deepcopy(ACTUAL);self.source=self.v['run']['head_sha'];self.run=self.v['run']['id']
 def check(self):return d.metadata(self.v['run'],self.v['listing'],self.v['main'],self.source,self.run,NOW)
 def artifact(self,proof=False):return next(a for a in self.v['listing']['artifacts'] if a['name'].startswith('finance-browser-' if proof else 'arthello-v52-verification-'))
 def test_actual_producer_inventory_reproduces_old_failure_and_selects_only_exact_app(self):
  with self.assertRaisesRegex(old.Refused,'ARTIFACT_INVENTORY'):old.metadata(self.v['run'],self.v['listing'],self.v['main'],self.source,self.run,NOW)
  self.assertEqual(self.check()['id'],10156784922)
  self.v['listing']['artifacts'].reverse();self.assertEqual(self.check()['id'],10156784922)
 def test_complete_inventory_has_no_extra_missing_duplicate_or_ambiguous_members(self):
  original=copy.deepcopy(self.v['listing']);app=self.artifact();proof=self.artifact(True)
  for listing in [{},dict(total_count=True,artifacts=[app,proof]),dict(total_count=1,artifacts=[app]),dict(total_count=2,artifacts=[app,app]),dict(total_count=3,artifacts=[app,proof,app]),dict(total_count=2,artifacts=[app,None]),dict(total_count=2,artifacts=[app,dict(proof,name='unexpected')]),dict(total_count=2,artifacts=[app,dict(proof,name=[])])]:
   with self.subTest(listing=listing.get('total_count')):
    self.v['listing']=listing
    with self.assertRaises(d.Refused):self.check()
  self.v['listing']=original
 def test_proof_identity_size_digest_expiry_are_not_ignored(self):
  for key,value in [('id',True),('id',0),('id',10156784922),('expired',True),('size_in_bytes',True),('size_in_bytes',0),('size_in_bytes',8*1024**2+1),('digest','bad'),('expires_at','2020-01-01T00:00:00Z'),('expires_at','2030-01-01T00:00:00'),('expires_at',None)]:
   self.setUp();self.artifact(True)[key]=value
   with self.subTest(key=key,value=value),self.assertRaises(d.Refused):self.check()
 def test_both_artifacts_require_exact_producer_source_run_and_repository(self):
  for proof in [False,True]:
   for key,value in [('head_sha','0'*40),('id',1),('head_branch','other'),('repository_id',1),('head_repository_id',1)]:
    self.setUp();self.artifact(proof)['workflow_run'][key]=value
    with self.subTest(proof=proof,key=key),self.assertRaises(d.Refused):self.check()
 def test_primary_archive_guards_and_owner_main_attempt_one_remain(self):
  for key,value in [('id',True),('expired',True),('size_in_bytes',True),('size_in_bytes',0),('digest','bad'),('expires_at','2020-01-01T00:00:00Z')]:
   self.setUp();self.artifact()[key]=value
   with self.subTest(key=key),self.assertRaises(d.Refused):self.check()
  for key,value in [('run_attempt',2),('status','in_progress'),('conclusion','failure'),('head_sha','0'*40),('event','pull_request'),('actor',{'login':'other'}),('triggering_actor',{'login':'other'})]:
   self.setUp();self.v['run'][key]=value
   with self.subTest(key=key),self.assertRaises(d.Refused):self.check()
  self.setUp();self.v['main']['object']['sha']='0'*40
  with self.assertRaises(d.Refused):self.check()
 def test_frozen_transport_extraction_context_and_output_are_byte_identical(self):
  original=(ROOT/'.github/scripts/download-v52-artifact-r15.py').read_text();current=(ROOT/'.github/scripts/download-v52-artifact-r17.py').read_text()
  self.assertEqual(hashlib.sha256(original.encode()).hexdigest(),'85975b2b3a6835728e756dba88219a8f0bcf37b333c0921df2c618afc224776f')
  def segments(text):return {n.name:ast.get_source_segment(text,n) for n in ast.parse(text).body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}
  before,after=segments(original),segments(current);self.assertEqual(set(before),set(after))
  for name in before:
   if name!='metadata':self.assertEqual(before[name],after[name],name)
  for name in ['MAX_BYTES','MEMBERS','API','OWNER','REPOSITORY','REPOSITORY_ID']:self.assertEqual(getattr(d,name),getattr(old,name))
 def test_main_downloads_only_app_and_retains_exact_three_members_and_current_main(self):
  payload=io.BytesIO()
  with zipfile.ZipFile(payload,'w') as z:
   for name in d.MEMBERS:z.writestr(name,b'synthetic fixture')
  data=payload.getvalue();app=self.artifact();app.update(size_in_bytes=len(data),digest='sha256:'+hashlib.sha256(data).hexdigest())
  reads=[];streams=[];v=self.v
  class Client:
   def __init__(self,_):pass
   def json(self,path):
    reads.append(path)
    if path=='/actions/runs/34488251067':return v['run']
    if path=='/actions/runs/34488251067/artifacts?per_page=100':return v['listing']
    if path=='/git/ref/heads/main':return v['main']
    raise AssertionError('unlisted path')
   def stream(self,artifact):streams.append(artifact['id']);return io.BytesIO(data)
  class Clock(datetime):
   @classmethod
   def now(cls,tz=None):return NOW
  with tempfile.TemporaryDirectory() as temporary:
   directory=Path(temporary)/'owned';out=io.StringIO()
   with patch.object(d,'context',return_value=(self.source,self.run,directory)),patch.object(d,'GitHub',Client),patch.object(d,'datetime',Clock),patch.object(d.sys,'argv',['download']),redirect_stdout(out):
    self.assertEqual(d.main(),0)
   self.assertEqual(streams,[10156784922]);self.assertEqual(reads.count('/git/ref/heads/main'),2)
   self.assertEqual({p.name for p in directory.iterdir()},set(d.MEMBERS))
   result=json.loads(out.getvalue());self.assertEqual(result['members'],3);self.assertIs(result['imageImported'],False)
if __name__=='__main__':unittest.main()
