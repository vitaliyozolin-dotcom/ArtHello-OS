"""D197: update only the verified School application, preserving its live data."""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('release',ROOT/'deploy/alfa_release.py')
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
require=release.require
PREDECESSOR='368651d45e1621e226a21d8ec4219717d87935544c4d04b1ba6f6dd2024ea47f'
PREDECESSOR_IMAGE='sha256:09961fe876433cfa818ac1ec2822fa4181579a744473f10a55e31c1ffd229b0c'

def main(source,run_key,verification_run):
    os.umask(0o077)
    require(re.fullmatch(r'[a-f0-9]{40}',source) and re.fullmatch(r'[1-9][0-9]*-1',run_key)
            and re.fullmatch(r'[1-9][0-9]*',verification_run),'CONTEXT')
    def interrupted(*_): raise release.Refused('INTERRUPTED')
    for sig in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP): signal.signal(sig,interrupted)
    def current_main():
        url='https://api.github.com/repos/'+release.REPOSITORY+'/git/ref/heads/main'
        with urllib.request.urlopen(urllib.request.Request(url,headers={'Accept':'application/vnd.github+json','User-Agent':'ArtHello-protected-release'}),timeout=20) as response:
            require(response.status==200 and response.url==url,'MAIN_UNCONFIRMED')
            raw=response.read(16385)
        require(len(raw)<=16384 and json.loads(raw).get('object',{}).get('sha')==source,'MAIN_MOVED')
    current_main()
    require(shutil.disk_usage(ROOT).free>=5*1024**3,'DISK_CAPACITY')
    old=release.inspect(PREDECESSOR)
    require(old['Id']==PREDECESSOR and old['Image']==PREDECESSOR_IMAGE and old['State']['Running'],'PREDECESSOR')
    old_image=json.loads(release.docker('image','inspect',old['Image']))[0]
    require(old_image['Config']['Labels'].get('org.opencontainers.image.revision')==release.PINS['school'][0],'PREDECESSOR_SOURCE')
    image,image_source,image_tree=release.load_image(ROOT/'artifacts','school',source,'',int(verification_run))
    plan=release.runtime_plan(old,'school',image,image_source,image_tree)
    # The source image is shared with a relay. Exact ID plus the writable application
    # volume and database path distinguish the live diary from that relay.
    release.public_health()
    result=release.upgrade(old,plan,ROOT,run_key,current_main)
    receipt={'decision':'D197','state':'runtime-verified','controllerSha':source,'result':result,
             'alfaImportApplied':False,'diaryDirectoryApplied':False}
    (ROOT/'receipt.json').write_text(json.dumps(receipt,indent=2))
    print('SCHOOL_RELEASE='+json.dumps(receipt),flush=True)

if __name__=='__main__':
    try: main(*sys.argv[1:])
    except Exception as error:
        reason=str(error) if isinstance(error,release.Refused) and re.fullmatch(r'[A-Z_]{2,80}',str(error)) else 'UNCONFIRMED'
        print('SCHOOL_RELEASE_BLOCKED='+reason,flush=True);raise SystemExit(2)
