"""Protected, non-mutating source/reconciliation inventory. No client rows in logs."""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]

def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'deploy'/f'{name}.py')
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

release=load('alfa_release')
artifacts=load('alfa_artifact')
require=release.require

def capture(command, prefix, *, data=None, timeout=600):
    result=subprocess.run(command,input=data,capture_output=True,timeout=timeout)
    lines=result.stdout.decode().splitlines()
    reports=[json.loads(line[len(prefix):]) for line in lines if line.startswith(prefix)]
    if result.returncode==0 and len(reports)==1: return reports[0]
    safe=re.findall(rb'(?:ALFA_OS_AUDIT_BLOCKED|ALFA_SOURCE_AUDIT_FAILED)=([A-Z_0-9]{3,70})',result.stderr)
    return {'status':'blocked','reason':safe[-1].decode() if safe else 'COMMAND_UNCONFIRMED'}

def school_inventory():
    host=os.environ.get('DEPLOY_HOST',''); user=os.environ.get('DEPLOY_USER',''); port=os.environ.get('DEPLOY_PORT') or '2222'
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{0,252}',host) or not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}',user) or not port.isdigit() or not 0<int(port)<65536:
        return {'status':'blocked','reason':'SSH_CONFIGURATION'}
    with tempfile.TemporaryDirectory(prefix='alfa-school-audit-') as temporary:
        key=Path(temporary)/'identity'; known=Path(temporary)/'known_hosts'
        key.write_text(os.environ.get('SSH_PRIVATE_KEY','')+'\n'); key.chmod(0o600)
        known.write_text(os.environ.get('SSH_KNOWN_HOSTS','')+'\n'); known.chmod(0o600)
        if not key.stat().st_size>100 or not known.stat().st_size>20: return {'status':'blocked','reason':'SSH_IDENTITY_MISSING'}
        remote=(ROOT/'deploy/school_inventory.py').read_bytes()
        command=['ssh','-p',port,'-i',str(key),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','PasswordAuthentication=no',
                 '-o','KbdInteractiveAuthentication=no','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(known),
                 '-o','GlobalKnownHostsFile=/dev/null','-o','ConnectTimeout=15','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=2',
                 '--',user+'@'+host,'python3 -']
        response=subprocess.run(command,input=remote,capture_output=True,timeout=90)
        if response.returncode:
            reason='SSH_HOST_KEY_UNCONFIRMED' if b'Host key verification failed' in response.stderr or b'REMOTE HOST IDENTIFICATION' in response.stderr else 'SSH_CONNECTION_UNCONFIRMED'
            return {'status':'blocked','reason':reason}
        try: return json.loads(response.stdout)
        except (ValueError,UnicodeDecodeError): return {'status':'blocked','reason':'SSH_RESPONSE_UNCONFIRMED'}

def main():
    os.umask(0o077)
    expected={'GITHUB_REPOSITORY':release.REPOSITORY,'GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF':'refs/heads/main',
              'GITHUB_ACTOR':release.OWNER,'GITHUB_TRIGGERING_ACTOR':release.OWNER,'GITHUB_RUN_ATTEMPT':'1',
              'ALFA_AUDIT_CONFIRMATION':'AUDIT ALFA WITHOUT APPLY'}
    for key,value in expected.items(): require(os.environ.get(key)==value,'PROTECTED_CONTEXT')
    source=os.environ.get('RELEASE_SHA','')
    require(re.fullmatch(r'[a-f0-9]{40}',source) and source==os.environ.get('GITHUB_SHA'),'SOURCE')
    require(release.run('git','rev-parse','HEAD').decode().strip()==source,'CHECKOUT')
    client=artifacts.bounded.GitHub(os.environ.get('GH_TOKEN'))
    artifacts.bounded.exact_fields(client.json('/git/ref/heads/main').get('object'),{'type':'commit','sha':source},'MAIN_MOVED')
    for workflow in ('quality','proof-gates','verify-arthello-v52'):
        runs=client.json('/actions/workflows/'+workflow+'.yml/runs?head_sha='+source+'&event=push&per_page=100')
        require(runs.get('total_count')==len(runs.get('workflow_runs',[]))==1,'RUN_AMBIGUOUS')
        artifacts.verify_run(runs['workflow_runs'][0],source,workflow)
    name='arthello-direct-34837407187-1'; container=release.inspect(name)
    require(container['State']['Running'] is True,'CENTRAL_UNAVAILABLE')
    image=json.loads(release.docker('image','inspect',container['Image']))[0]
    require(image['Config']['Labels'].get('org.opencontainers.image.revision')=='dc390739a09c1fff24ead9f490e339c1eabd3c3d','CENTRAL_SOURCE')
    report={'controllerSha':source,'centralSource':'dc390739a09c1fff24ead9f490e339c1eabd3c3d','businessDataChanged':False}
    report['source']=capture(['docker','exec','-i',name,'node','--input-type=module','-'],'ALFA_SOURCE_AUDIT=',data=(ROOT/'.github/scripts/alfa-source-audit.mjs').read_bytes())
    report['os']=capture(['docker','run','--rm','--read-only','--network','bridge','--cap-drop','ALL','--security-opt','no-new-privileges:true',
        '--pids-limit','64','--memory','512m','--user','1000:1000',
        '--env','ARTHELLO_OWNER_LOGIN','--env','ARTHELLO_OWNER_PASSWORD',
        '--mount','type=bind,src='+str(ROOT/'deploy')+',dst=/audit,readonly',
        '--entrypoint','node',container['Image'],'/audit/alfa_reconciliation_audit.mjs'],'ALFA_OS_AUDIT=',timeout=900)
    report['schoolRuntime']=school_inventory()
    directory=Path.home()/'.config/arthello/release-state'/('d195-audit-'+os.environ['GITHUB_RUN_ID'])
    directory.mkdir(mode=0o700,exist_ok=False)
    (directory/'receipt.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('ALFA_RECONCILIATION_AUDIT='+json.dumps(report,ensure_ascii=False))

if __name__=='__main__':
    try: main()
    except Exception as error:
        reason=str(error) if type(error).__name__=='Refused' and re.fullmatch(r'[A-Z_]{2,80}',str(error)) else 'UNCONFIRMED'
        print('ALFA_AUDIT_BLOCKED='+reason); raise SystemExit(2)
