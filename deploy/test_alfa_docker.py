"""Disposable hosted-runner integration; never invoked by the production workflow."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from unittest.mock import patch

assert os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
assert os.environ.get('GITHUB_EVENT_NAME') in ('push', 'pull_request')
spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('alfa_release.py'))
release = importlib.util.module_from_spec(spec); spec.loader.exec_module(release)
image = 'node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e'
key = os.environ['GITHUB_RUN_ID'] + '-' + os.environ['GITHUB_RUN_ATTEMPT']
name = 'arthello-direct-' + key
data = 'arthello-direct-v44-data'
activation = 'ci-alfa-activation-' + key
backup = 'arthello-d194-central-' + key
retained = name + '-pre-d194-' + key
d = release.docker
# Fail if this supposedly disposable runner already owns any test resource.
assert not d('volume','ls','-q','--filter','name=^'+data+'$').strip()
script = """
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
fs.mkdirSync('/data/d1',{recursive:true});
function fixture(count=32) {
  const db=new DatabaseSync('/data/d1/app.sqlite');
  db.exec(`
    CREATE TABLE system_runtime_state(state_key TEXT PRIMARY KEY,state_value TEXT NOT NULL,updated_at TEXT);
    CREATE TABLE organization_branches(id TEXT); CREATE TABLE alfacrm_import_records(id TEXT); CREATE TABLE entities(id TEXT PRIMARY KEY,entity_type TEXT,display_name TEXT,status TEXT,source_system TEXT,source_record_id TEXT,data_quality TEXT,scope TEXT,metadata TEXT,created_by TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE entity_merges(survivor_id TEXT,duplicate_id TEXT);
    CREATE TABLE entity_links(from_entity_id TEXT,to_entity_id TEXT,relation_type TEXT);
    CREATE TABLE education_students(id TEXT PRIMARY KEY,child_entity_id TEXT,family_entity_id TEXT,group_id TEXT,status TEXT);
    CREATE TABLE education_groups(id TEXT PRIMARY KEY,unit_entity_id TEXT);
    CREATE TABLE audit_events(actor TEXT,action TEXT,entity_type TEXT,entity_id TEXT,payload TEXT);
    CREATE TABLE alfacrm_raw_observations(id TEXT PRIMARY KEY,payload TEXT);
    CREATE TABLE alfacrm_current_records(remote_branch_id TEXT,module TEXT,record_id TEXT,observation_id TEXT,active INTEGER);
    CREATE TABLE alfacrm_customer_balances(customer_id TEXT,remote_branch_id TEXT,balance_minor INTEGER);
    CREATE TABLE financial_operations(id TEXT PRIMARY KEY,amount_minor INTEGER);
  `);
  db.prepare('INSERT INTO system_runtime_state VALUES(?,?,?)').run('alfacrm_connector:v1',JSON.stringify({connected:true,autosync:{enabled:false},endpoint:'https://arthellonew.s20.online',branchMappings:{'6':'BR-KINDERGARTEN','10':'BR-ATLAS-SCHOOL'}}),'');
  db.exec("INSERT INTO education_groups VALUES('garden','BR-KINDERGARTEN'),('school','BR-ATLAS-SCHOOL'); INSERT INTO financial_operations VALUES('old',12345);");
  for(let n=1;n<=count;n++) add(db,n);
  return db;
}
function add(db,n) {
  for(const branch of ['6','10']) {
    const scope=branch==='6'?'Атлас — садик':'Атлас — школа', id=String(n), source=branch+':'+id;
    db.prepare('INSERT INTO alfacrm_raw_observations VALUES(?,?)').run(source,JSON.stringify({id,branch_ids:[6,10]}));
    db.prepare('INSERT INTO alfacrm_current_records VALUES(?,?,?,?,1)').run(branch,'families',id,source);
    db.prepare('INSERT INTO alfacrm_customer_balances VALUES(?,?,?)').run(id,branch,n*100);
    for(const kind of ['Семья','Ребёнок','Клиент']) {
      const card=kind+':'+source, root=kind+':6:'+id;
      db.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(card,kind,'name'+id,branch==='6'?'Активна':'Объединена','ALFACRM',source,'Проверено',scope,JSON.stringify({remoteBranchId:branch,localBranchId:branch==='6'?'BR-KINDERGARTEN':'BR-ATLAS-SCHOOL',alfaCustomerId:id,identitySourceStatus:'Активна',alfaStatusName:'Активен'}),'owner','','');
      if(branch==='10') db.prepare('INSERT INTO entity_merges VALUES(?,?)').run(root,card);
    }
  }
  for(const group of ['garden','school']) db.prepare('INSERT INTO education_students VALUES(?,?,?,?,?)').run(group+n,'Ребёнок:6:'+n,'Семья:6:'+n,group,'Активен');
}

if (!fs.existsSync('/data/d1/app.sqlite')) fixture().close();
fs.chownSync('/data/d1',1000,1000); fs.chownSync('/data/d1/app.sqlite',1000,1000);
require('node:http').createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({status:'ok'}));}).listen(8081,'127.0.0.1');
"""
try:
    d('pull', image, timeout=300)
    for volume in (data,activation): d('volume','create',volume)
    d('run','-d','--name',name,'--network','none','--read-only','--restart','no',
      '--mount','type=volume,src='+data+',dst=/data',
      '--mount','type=volume,src='+activation+',dst=/var/lib/arthello-v52-tochka-activation,readonly',
      '--env','RELEASE_SHA='+'c'*40,'--env','TOCHKA_AUTOSYNC_ACTIVATION_ID='+'d'*64,
      image,'node','-e',script)
    old=release.inspect(name)
    for _ in range(30):
        try: release.health(name,8081); break
        except release.Refused: release.time.sleep(1)
    else: raise AssertionError('synthetic runtime not ready')
    image_id=json.loads(d('image','inspect',image))[0]['Id']
    plan=release.runtime_plan(old,'central',image_id,'f'*40,'9'*40)
    real_mkdir = Path.mkdir
    def simulate_root_owned_mount(path, *args, **kwargs):
        if path.name == 'production-snapshots': raise PermissionError('root-owned mount')
        return real_mkdir(path, *args, **kwargs)
    with tempfile.TemporaryDirectory() as directory, patch.object(release.time,'sleep',lambda _:None), \
         patch.object(release,'public_health',lambda:None), patch.object(release,'mounted_backup_root',lambda:Path(directory)), \
         patch.object(Path,'mkdir',simulate_root_owned_mount):
        try:
            receipt=release.upgrade(old,plan,Path(directory),key,lambda:None)
            assert receipt['backup']['integrity']=='ok'
            backup_meta=json.loads(d('volume','inspect',backup))[0]
            assert backup_meta['Options']['o']=='bind'
            assert backup_meta['Options']['device']==str(Path(directory)/'production-snapshots'/backup)
            assert receipt['databaseRestored'] is False
            assert release.inspect(name)['Id'] != old['Id']
            assert release.inspect(retained)['State']['Running'] is False
            assert not list(Path(directory).glob('*.env'))
        finally:
            # Snapshot files are root-owned; restore fixture ownership before
            # TemporaryDirectory cleanup on this disposable hosted runner.
            if d('volume','ls','-q','--filter','name=^'+backup+'$').strip():
                d('run','--rm','--network','none','--read-only',
                  '--security-opt','no-new-privileges:true',
                  '--mount','type=volume,src='+backup+',dst=/snapshot',
                  '--entrypoint','chown',image,'-R',
                  str(os.getuid())+':'+str(os.getgid()),'/snapshot')
    release.health(name,8081)
    print('D194_DISPOSABLE_DOCKER_UPGRADE=VERIFIED')
finally:
    for container in (name,retained):
        subprocess.run(['docker','rm','-f',container],capture_output=True)
    for volume in (data,activation,backup):
        subprocess.run(['docker','volume','rm',volume],capture_output=True)
