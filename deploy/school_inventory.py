"""Read-only remote Docker inventory; no secrets, addresses, names or DB content."""
import json
import subprocess

def docker(*args):
    return subprocess.run(['docker',*args],check=True,capture_output=True,timeout=20).stdout

try:
    candidates=[]
    for container_id in docker('ps','-q').decode().split():
        row=json.loads(docker('inspect',container_id))[0]
        image=json.loads(docker('image','inspect',row['Image']))[0]
        source=image.get('Config',{}).get('Labels',{}).get('org.opencontainers.image.revision')
        if source not in ('54242340f2d9b6a9887d69ecc03520ddf9f7982c','e9a2a92edbd150dfeaa4b566a206e6bbb00169ad'): continue
        config=row['Config']; host=row['HostConfig']
        candidates.append({'containerId':row['Id'],'image':row['Image'],'source':source,
          'readOnlyRoot':host['ReadonlyRootfs'],'portBindingsPresent':bool(host.get('PortBindings')),'networkCount':len(row['NetworkSettings']['Networks']),
          'workingDir':config.get('WorkingDir') if config.get('WorkingDir') in ['/app','/school','/'] else 'OTHER',
          'dataVolumes':[{ 'destination':m['Destination'],'writable':m['RW'],'type':m['Type']} for m in row['Mounts'] if m['Destination'] in ['/data','/backups']],
          'entrypointCount':len(config.get('Entrypoint') or []),'commandCount':len(config.get('Cmd') or []),
          'databasePathConfigured':any(v.startswith('DATABASE_PATH=/data/') for v in config.get('Env',[]))})
    writers=[row for row in candidates if row['databasePathConfigured'] and row['workingDir']=='/app' and any(m['destination']=='/data' and m['type']=='volume' and m['writable'] for m in row['dataVolumes'])]
    print(json.dumps({'status':'verified' if len(writers)==1 else 'blocked','candidates':candidates,'applicationContainerId':writers[0]['containerId'] if len(writers)==1 else None}))
except Exception:
    print(json.dumps({'status':'blocked','reason':'REMOTE_INVENTORY_UNCONFIRMED'}))
