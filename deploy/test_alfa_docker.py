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
const db=new DatabaseSync('/data/app.sqlite');
db.exec('CREATE TABLE IF NOT EXISTS alfacrm_import_records(id TEXT); CREATE TABLE IF NOT EXISTS system_runtime_state(state_key TEXT PRIMARY KEY,state_value TEXT);');
db.prepare('INSERT OR IGNORE INTO system_runtime_state VALUES (?,?)').run('alfacrm_connector:v1',JSON.stringify({connected:true,autosync:{enabled:false}}));
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
    with tempfile.TemporaryDirectory() as directory, patch.object(release.time,'sleep',lambda _:None), \
         patch.object(release,'public_health',lambda:None):
        receipt=release.upgrade(old,plan,Path(directory),key,lambda:None)
        assert receipt['backup']['integrity']=='ok'
        assert receipt['databaseRestored'] is False
        assert release.inspect(name)['Id'] != old['Id']
        assert release.inspect(retained)['State']['Running'] is False
        assert not list(Path(directory).glob('*.env'))
    release.health(name,8081)
    print('D194_DISPOSABLE_DOCKER_UPGRADE=VERIFIED')
finally:
    for container in (name,retained):
        subprocess.run(['docker','rm','-f',container],capture_output=True)
    for volume in (data,activation,backup):
        subprocess.run(['docker','volume','rm',volume],capture_output=True)
