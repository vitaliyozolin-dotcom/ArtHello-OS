"""D200 owner-approved API synchronization; one missing-status record stays untouched."""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import time

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('audit',ROOT/'deploy/alfa_audit.py')
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
release=audit.release
require=release.require

def main():
    os.umask(0o077)
    for key,value in {'GITHUB_REPOSITORY':release.REPOSITORY,'GITHUB_EVENT_NAME':'workflow_dispatch',
        'GITHUB_REF':'refs/heads/main','GITHUB_ACTOR':release.OWNER,'GITHUB_TRIGGERING_ACTOR':release.OWNER,
        'GITHUB_RUN_ATTEMPT':'1','ALFA_SYNC_CONFIRMATION':'SYNC ALFA EXCEPT ONE MISSING STATUS'}.items():
        require(os.environ.get(key)==value,'PROTECTED_CONTEXT')
    source=os.environ.get('RELEASE_SHA','')
    require(re.fullmatch(r'[a-f0-9]{40}',source) and source==os.environ.get('GITHUB_SHA'),'SOURCE')
    require(release.run('git','rev-parse','HEAD').decode().strip()==source,'CHECKOUT')
    client=audit.artifacts.bounded.GitHub(os.environ.get('GH_TOKEN'))
    audit.artifacts.bounded.exact_fields(client.json('/git/ref/heads/main').get('object'),{'type':'commit','sha':source},'MAIN_MOVED')
    for workflow in ('quality','proof-gates','verify-arthello-v52'):
        runs=client.json('/actions/workflows/'+workflow+'.yml/runs?head_sha='+source+'&event=push&per_page=100')
        require(runs.get('total_count')==len(runs.get('workflow_runs',[]))==1,'RUN_AMBIGUOUS')
        audit.artifacts.verify_run(runs['workflow_runs'][0],source,workflow)
    container=release.inspect('arthello-direct-34837407187-1')
    require(container['State']['Running'],'CENTRAL_UNAVAILABLE')
    image=json.loads(release.docker('image','inspect',container['Image']))[0]
    require(image['Config']['Labels'].get('org.opencontainers.image.revision')==source,'CENTRAL_SOURCE')
    # The immediately preceding protected release made a WAL-complete backup.
    # Only its exact live container/image and a fresh verified receipt qualify.
    receipts=[]
    for path in (Path.home()/'.config/arthello/release-state').glob('d194-*/receipt.json'):
        if time.time()-path.stat().st_mtime>1800: continue
        receipt=json.loads(path.read_text());result=receipt.get('result',{})
        if receipt.get('controllerSha')==source and receipt.get('state')=='runtime-verified' and result.get('containerId')==container['Id'] and result.get('imageId')==container['Image'] and result.get('backup',{}).get('integrity')=='ok':
            receipts.append(result)
    require(len(receipts)==1,'FRESH_RELEASE_BACKUP_REQUIRED')
    release.docker('volume','inspect',receipts[0]['backupVolume'])
    release.public_health()
    directory=Path.home()/'.config/arthello/release-state'/('d200-sync-'+os.environ['GITHUB_RUN_ID'])
    directory.mkdir(mode=0o700,exist_ok=False)
    run_key=os.environ['GITHUB_RUN_ID']+'-1'
    require(re.fullmatch(r'[1-9][0-9]*-1',run_key),'RUN_KEY')
    backup_script=(ROOT/'deploy/diary-sync-backup.mjs').read_bytes()
    def backup_receipt(output,system):
        rows=[json.loads(line.split('=',1)[1]) for line in output.decode().splitlines() if line.startswith('DIARY_SYNC_BACKUP=')]
        require(len(rows)==1 and rows[0].get('system')==system and rows[0].get('integrity')=='ok'
                and re.fullmatch(r'[a-f0-9]{64}',rows[0].get('sha256','')),'DIARY_BACKUP_UNCONFIRMED')
        return rows[0]
    # Each diary owns a separate database. A central backup alone cannot protect it.
    atlas=release.inspect('atlas-school-diary')
    atlas_image=json.loads(release.docker('image','inspect',atlas['Image']))[0]
    require(atlas['State']['Running'] and atlas_image['Config']['Labels'].get('org.opencontainers.image.revision')==release.PINS['atlas'][1]
            and 'DATABASE_PATH=/data/atlas-school.sqlite' in atlas['Config']['Env']
            and any(m['Type']=='volume' and m['Destination']=='/backups' and m['RW'] for m in atlas['Mounts']),'ATLAS_BACKUP_IDENTITY')
    atlas_backup=subprocess.run(['docker','exec','-i','-e','ARTHELLO_SYNC_BACKUP_KEY='+run_key,atlas['Id'],
        'node','--input-type=module','-'],input=backup_script,capture_output=True,timeout=180)
    require(atlas_backup.returncode==0,'ATLAS_BACKUP_FAILED')
    diary_backups={'atlas':backup_receipt(atlas_backup.stdout,'atlas')}
    with audit.school_connection() as (execute,inventory):
        school_id=inventory.get('applicationContainerId','')
        require(inventory.get('status')=='verified' and re.fullmatch(r'[a-f0-9]{64}',school_id),'SCHOOL_INVENTORY')
        candidate=next((row for row in inventory.get('candidates',[]) if row['containerId']==school_id),{})
        require(candidate.get('source')==release.PINS['school'][1]
                and any(m['destination']=='/backups' and m['type']=='volume' and m['writable'] for m in candidate.get('dataVolumes',[])),'SCHOOL_BACKUP_IDENTITY')
        output=execute('docker exec -i -e ARTHELLO_SYNC_BACKUP_KEY='+run_key+' '+school_id+' node --input-type=module -',data=backup_script,timeout=180)
        diary_backups['school']=backup_receipt(output,'school')
    (directory/'diary-backups.json').write_text(json.dumps(diary_backups))
    print('ALFA_SYNC_PROGRESS='+json.dumps({'stage':'diary-backups-verified','systems':sorted(diary_backups)}),flush=True)
    result=subprocess.run(['docker','run','--rm','--read-only','--network','bridge','--cap-drop','ALL',
        '--security-opt','no-new-privileges:true','--pids-limit','64','--memory','512m','--user','1000:1000',
        '--env','ARTHELLO_OWNER_LOGIN','--env','ARTHELLO_OWNER_PASSWORD',
        '--mount','type=bind,src='+str(ROOT/'deploy')+',dst=/sync,readonly',
        '--entrypoint','node',container['Image'],'/sync/alfa_sync.mjs'],capture_output=True,timeout=1500)
    # Print only explicitly structured, non-personal summaries. Never raw API bodies.
    for line in result.stdout.decode().splitlines():
        if line.startswith(('ALFA_SYNC_PROGRESS=','ALFA_SYNC_RESULT=')): print(line,flush=True)
    reports=[json.loads(line.split('=',1)[1]) for line in result.stdout.decode().splitlines() if line.startswith('ALFA_SYNC_RESULT=')]
    safe=re.findall(rb'ALFA_SYNC_BLOCKED=([A-Z_0-9]{3,70})',result.stderr)
    require(result.returncode==0 and len(reports)==1,safe[-1].decode() if safe else 'SYNC_UNCONFIRMED')
    receipt={'controllerSha':source,'backupVolume':receipts[0]['backupVolume'],'diaryBackups':diary_backups,'result':reports[0]}
    (directory/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2))
    release.public_health()

if __name__=='__main__':
    try: main()
    except Exception as error:
        reason=str(error) if isinstance(error,release.Refused) and re.fullmatch(r'[A-Z_0-9]{3,70}',str(error)) else 'UNCONFIRMED'
        print('ALFA_SYNC_BLOCKED='+reason,flush=True);raise SystemExit(2)
