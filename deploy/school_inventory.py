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
        if source not in ('54242340f2d9b6a9887d69ecc03520ddf9f7982c','e9a2a92edbd150dfeaa4b566a206e6bbb00169ad','0cb894eda21c6a446b804e51c8cac8c54af9b5cd','4f47f5f7707e73e9a02490fe9209f0129915cc00','8e6be4f4bc3af6333fc7761ef5501544edaa1acd','6afc12bb9e98b070f1b50e7cb111551e0618c81d','404d9b8db843ee9d1fcaaff7c1d157ac5ef00a22','c7b7082d32a191c209d6f8d62a2ece6ae8c8dda4','5876accedbdf3758971fdc383f1e0fad8c32a158'): continue
        config=row['Config']; host=row['HostConfig']
        candidates.append({'containerId':row['Id'],'image':row['Image'],'source':source,
          'readOnlyRoot':host['ReadonlyRootfs'],'portBindingsPresent':bool(host.get('PortBindings')),'networkCount':len(row['NetworkSettings']['Networks']),
          'workingDir':config.get('WorkingDir') if config.get('WorkingDir') in ['/app','/school','/'] else 'OTHER',
          'dataVolumes':[{ 'destination':m['Destination'],'writable':m['RW'],'type':m['Type']} for m in row['Mounts'] if m['Destination'] in ['/data','/backups']],
          'entrypointCount':len(config.get('Entrypoint') or []),'commandCount':len(config.get('Cmd') or []),
          'databasePathConfigured':any(v.startswith('DATABASE_PATH=/data/') for v in config.get('Env',[]))})
    writers=[row for row in candidates if row['databasePathConfigured'] and row['workingDir']=='/app' and any(m['destination']=='/data' and m['type']=='volume' and m['writable'] for m in row['dataVolumes'])]
    stopped=[]
    for container_id in docker('ps','-aq').decode().split():
        row=json.loads(docker('inspect',container_id))[0]
        if row['State']['Running']: continue
        try: image=json.loads(docker('image','inspect',row['Image']))[0]
        except Exception: continue
        source=image.get('Config',{}).get('Labels',{}).get('org.opencontainers.image.revision')
        if source not in ('54242340f2d9b6a9887d69ecc03520ddf9f7982c','5876accedbdf3758971fdc383f1e0fad8c32a158'): continue
        stopped.append({'containerId':row['Id'],'image':row['Image'],'source':source,
            'workingDir':row['Config'].get('WorkingDir') if row['Config'].get('WorkingDir') in ['/app','/school','/'] else 'OTHER',
            'databasePathConfigured':any(v.startswith('DATABASE_PATH=/data/') for v in row['Config'].get('Env',[])),
            'dataVolumes':[{'destination':m['Destination'],'writable':m['RW'],'type':m['Type']} for m in row['Mounts'] if m['Destination'] in ['/data','/backups']],
            'portBindingsPresent':bool(row['HostConfig'].get('PortBindings')),
            'networkCount':len(row['NetworkSettings']['Networks']),
            'exitCode':row['State'].get('ExitCode'),
            'oomKilled':row['State'].get('OOMKilled'),
            'finishedAt':row['State'].get('FinishedAt'),
            'errorPresent':bool(row['State'].get('Error')),
            'restartPolicy':row['HostConfig'].get('RestartPolicy',{}).get('Name'),
            'healthStatus':row['State'].get('Health',{}).get('Status'),
            'dataVolumeName':next((m.get('Name') for m in row['Mounts'] if m['Destination']=='/data' and m['Type']=='volume'),None)})
    print(json.dumps({'status':'verified' if len(writers)==1 else 'blocked','candidates':candidates,'applicationContainerId':writers[0]['containerId'] if len(writers)==1 else None,'stoppedCandidates':stopped}))
except Exception:
    print(json.dumps({'status':'blocked','reason':'REMOTE_INVENTORY_UNCONFIRMED'}))
