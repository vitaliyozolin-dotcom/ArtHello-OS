"""Protected, non-mutating source/reconciliation inventory. No client rows in logs."""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from contextlib import contextmanager

ROOT=Path(__file__).resolve().parents[1]
# Previously accepted School key; D065/R17 protected School transport.
SCHOOL_HOST_PIN='SHA256:/kBNohTF+5g8U+jQt+PzOCoWZ9yCSFjBnEP3Oc3MwRI'
AUDIT_CENTRAL_LIVE=('d83da0ce8311a4b60832031a217b91c7dd6bb1c8',
                    'd066c3e7d94124efd847310e0d5ae9822401fa2f')

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

@contextmanager
def school_connection():
    """The same pinned production SSH identity for read-only and owner-approved delivery."""
    host=os.environ.get('DEPLOY_HOST',''); user=os.environ.get('DEPLOY_USER',''); port=os.environ.get('DEPLOY_PORT') or '2222'
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{0,252}',host) or not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}',user) or not port.isdigit() or not 0<int(port)<65536:
        raise release.Refused('SSH_CONFIGURATION')
    with tempfile.TemporaryDirectory(prefix='alfa-school-audit-') as temporary:
        key=Path(temporary)/'identity'; known=Path(temporary)/'known_hosts'
        key.write_text(os.environ.get('SSH_PRIVATE_KEY','')+'\n'); key.chmod(0o600)
        known.write_text(os.environ.get('SSH_KNOWN_HOSTS','')+'\n'); known.chmod(0o600)
        if not key.stat().st_size>100 or not known.stat().st_size>20: raise release.Refused('SSH_IDENTITY_MISSING')
        command=['ssh','-p',port,'-i',str(key),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','PasswordAuthentication=no',
                 '-o','KbdInteractiveAuthentication=no','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(known),
                 '-o','GlobalKnownHostsFile=/dev/null','-o','ConnectTimeout=15','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=2',
                 '--',user+'@'+host]
        def execute(remote, *, data=None, stream=None, timeout=90):
            transfer={'stdin':stream} if stream is not None else {'input':data}
            response=subprocess.run([*command,remote],**transfer,capture_output=True,timeout=timeout)
            if response.returncode and (b'Host key verification failed' in response.stderr or b'REMOTE HOST IDENTIFICATION' in response.stderr):
                scan=subprocess.run(['ssh-keyscan','-T','15','-p',port,'-t','ed25519',host],capture_output=True,timeout=25)
                lines=[line for line in scan.stdout.splitlines() if line and not line.startswith(b'#')]
                require(not scan.returncode and len(lines)==1,'PINNED_KEY_UNAVAILABLE')
                candidate=Path(temporary)/'pinned_candidate'; candidate.write_bytes(lines[0]+b'\n'); candidate.chmod(0o600)
                fingerprint=subprocess.run(['ssh-keygen','-lf',str(candidate),'-E','sha256'],capture_output=True,timeout=10)
                parts=fingerprint.stdout.decode().split()
                require(not fingerprint.returncode and len(parts)>=2 and parts[1]==SCHOOL_HOST_PIN,'PINNED_KEY_MISMATCH')
                known.write_bytes(candidate.read_bytes())
                if stream is not None: stream.seek(0)
                response=subprocess.run([*command,remote],**transfer,capture_output=True,timeout=timeout)
            if response.returncode:
                refusal=re.findall(rb'SCHOOL_RELEASE_BLOCKED=([A-Z_]{2,80})',response.stdout)
                if refusal: raise release.Refused('REMOTE_'+refusal[-1].decode())
            require(response.returncode==0,'SSH_COMMAND_UNCONFIRMED')
            return response.stdout
        # Resolve and authenticate before yielding a transport for any mutation.
        inventory=json.loads(execute('python3 -',data=(ROOT/'deploy/school_inventory.py').read_bytes()))
        yield execute,inventory

def school_inventory():
    try:
        with school_connection() as (_,inventory): return inventory
    except release.Refused as error:
        return {'status':'blocked','reason':str(error)}
    except Exception:
        return {'status':'blocked','reason':'SSH_RESPONSE_UNCONFIRMED'}

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
    central_source=image['Config']['Labels'].get('org.opencontainers.image.revision')
    require(central_source in (release.PINS['central'][0],*AUDIT_CENTRAL_LIVE,source),'CENTRAL_SOURCE')
    report={'controllerSha':source,'centralSource':central_source,'businessDataChanged':False}
    report['source']=capture(['docker','exec','-i',name,'node','--input-type=module','-'],'ALFA_SOURCE_AUDIT=',data=(ROOT/'.github/scripts/alfa-source-audit.mjs').read_bytes())
    print('ALFA_SOURCE_RECONCILIATION='+json.dumps({'controllerSha':source,'centralSource':central_source,
        'observedAt':report['source'].get('observedAt'),
        'sourceBranches':[{'id':branch['id'],'reconciliation':branch.get('reconciliation')}
            for branch in report['source'].get('sourceBranches',[]) if branch.get('reconciliation')],
        'status':report['source'].get('status','observed'),
        'reason':report['source'].get('reason')},ensure_ascii=False),flush=True)
    report['os']=capture(['docker','run','--rm','--read-only','--network','bridge','--cap-drop','ALL','--security-opt','no-new-privileges:true',
        '--pids-limit','64','--memory','512m','--user','1000:1000',
        '--env','ARTHELLO_OWNER_LOGIN','--env','ARTHELLO_OWNER_PASSWORD',
        '--mount','type=bind,src='+str(ROOT/'deploy')+',dst=/audit,readonly',
        '--entrypoint','node',container['Image'],'/audit/alfa_reconciliation_audit.mjs'],'ALFA_OS_AUDIT=',timeout=900)
    print('ALFA_OS_RECONCILIATION='+json.dumps(report['os'],ensure_ascii=False),flush=True)
    report['atlasData']=capture(['docker','exec','-i','atlas-school-diary','node','--input-type=module','-'],'DIARY_DATA_AUDIT=',data=(ROOT/'deploy/diary-data-audit.mjs').read_bytes())
    print('ALFA_ATLAS_DIARY_RECONCILIATION='+json.dumps(report['atlasData'],ensure_ascii=False),flush=True)
    with school_connection() as (execute,inventory):
        report['schoolRuntime']=inventory
        container_id=inventory.get('applicationContainerId','')
        candidates=inventory.get('candidates',[])
        print('ALFA_SCHOOL_INVENTORY_SUMMARY='+json.dumps({'status':inventory.get('status'),
            'reason':inventory.get('reason'), 'candidateCount':len(candidates),
            'candidateSources':[row.get('source') for row in candidates],
            'candidateSignals':[{'workingDir':row.get('workingDir'),
                'databasePathConfigured':row.get('databasePathConfigured'),
                'writableDataVolume':any(m.get('destination')=='/data' and m.get('type')=='volume' and m.get('writable')
                    for m in row.get('dataVolumes',[])),
                'backupVolumePresent':any(m.get('destination')=='/backups' for m in row.get('dataVolumes',[])),
                'networkCount':row.get('networkCount'),'portBindingsPresent':row.get('portBindingsPresent')}
                for row in candidates],
            'stoppedCandidates':inventory.get('stoppedCandidates',[]),
            'writerCount':sum(bool(row.get('databasePathConfigured')) and row.get('workingDir')=='/app'
                and any(m.get('destination')=='/data' and m.get('type')=='volume' and m.get('writable')
                    for m in row.get('dataVolumes',[])) for row in candidates)},ensure_ascii=False),flush=True)
        require(inventory.get('status')=='verified' and re.fullmatch(r'[a-f0-9]{64}',container_id),'SCHOOL_INVENTORY')
        output=execute('docker exec -i '+container_id+' node --input-type=module -',data=(ROOT/'deploy/diary-data-audit.mjs').read_bytes())
        lines=[line[len('DIARY_DATA_AUDIT='):] for line in output.decode().splitlines() if line.startswith('DIARY_DATA_AUDIT=')]
        require(len(lines)==1,'SCHOOL_DATA_AUDIT')
        report['schoolData']=json.loads(lines[0])
    directory=Path.home()/'.config/arthello/release-state'/('d195-audit-'+os.environ['GITHUB_RUN_ID'])
    directory.mkdir(mode=0o700,exist_ok=False)
    (directory/'receipt.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('ALFA_RECONCILIATION_AUDIT='+json.dumps(report,ensure_ascii=False))

if __name__=='__main__':
    try: main()
    except Exception as error:
        reason=str(error) if type(error).__name__=='Refused' and re.fullmatch(r'[A-Z_]{2,80}',str(error)) else 'UNCONFIRMED'
        print('ALFA_AUDIT_BLOCKED='+reason); raise SystemExit(2)
