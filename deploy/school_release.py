"""Owner-dispatched delivery over the previously pinned School SSH boundary."""
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import tarfile

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('audit',ROOT/'deploy/alfa_audit.py')
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
release=audit.release
require=release.require
FILES=('deploy/alfa_release.py','deploy/alfa_backup.mjs','deploy/school_release_remote.py',
       'deploy/v52/maintenance/image-runtime-fingerprint.jq',
       'artifacts/school/image.tar.gz','artifacts/school/receipt.json','artifacts/school/checksums.sha256')

def receiver_code(source,run_key,verification_run,digest,size):
    require(re.fullmatch(r'[a-f0-9]{40}',source) and re.fullmatch(r'[1-9][0-9]*-1',run_key)
            and type(verification_run) is int and verification_run>0 and re.fullmatch(r'[a-f0-9]{64}',digest) and type(size) is int and 0<size<2*1024**3,'BUNDLE')
    # Only an exact inventory of regular files from the reviewed controller and
    # verified immutable artifact is accepted. No archive paths or links are trusted.
    return f'''
import hashlib,json,os,pathlib,shutil,subprocess,sys,tarfile
os.umask(0o077)
root=pathlib.Path.home()/'.config/arthello/release-state'/('d197-{run_key}')
root.mkdir(parents=True,exist_ok=False,mode=0o700)
assert shutil.disk_usage(root).free>=5*1024**3
archive=root/'delivery.tar'
remaining={size}
digest=hashlib.sha256()
with archive.open('xb') as out:
    while remaining:
        chunk=sys.stdin.buffer.read(min(1024*1024,remaining))
        assert chunk
        remaining-=len(chunk);digest.update(chunk);out.write(chunk)
    assert not sys.stdin.buffer.read(1)
assert digest.hexdigest()=={digest!r}
with tarfile.open(archive) as bundle:
    entries=bundle.getmembers()
    assert len(entries)=={len(FILES)} and {{e.name for e in entries}}=={set(FILES)!r}
    assert all(e.isfile() and 0<e.size<2*1024**3 for e in entries)
    for entry in entries:
        target=root/entry.name;target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with bundle.extractfile(entry) as inp,target.open('xb') as out: shutil.copyfileobj(inp,out,1024*1024)
archive.unlink()
result=subprocess.run(['python3','-I','-B',str(root/'deploy/school_release_remote.py'),{source!r},{run_key!r},{str(verification_run)!r}])
raise SystemExit(result.returncode)
'''

def main():
    os.umask(0o077)
    source=release.authorization(os.environ)
    require(os.environ.get('RELEASE_SYSTEM')=='school','SYSTEM')
    run_key=os.environ['GITHUB_RUN_ID']+'-1'
    work=Path.home()/'.config/arthello/release-state'/('d197-school-'+run_key)
    work.mkdir(parents=True,exist_ok=False,mode=0o700)
    runs=audit.artifacts.download(source,work/'artifacts','school')
    # Verify receipt, image checksum and fingerprint on the gateway before delivery;
    # the remote host repeats these checks before it stops the application.
    release.load_image(work/'artifacts','school',source,'',runs['verify-arthello-v52'])
    archive=work/'delivery.tar'
    with tarfile.open(archive,'w') as bundle:
        for name in FILES:
            path=(work if name.startswith('artifacts/') else ROOT)/name
            require(path.is_file() and not path.is_symlink(),'BUNDLE_FILE')
            bundle.add(path,arcname=name,recursive=False)
    with audit.school_connection() as (execute,inventory):
        require(inventory.get('status')=='verified' and inventory.get('applicationContainerId')=='814d37b2b44a661ed16fc372008e6a7766e73efa2c897eacda08dc3be7e04e74','LIVE_APPLICATION_UNCONFIRMED')
        code=receiver_code(source,run_key,runs['verify-arthello-v52'],release.file_hash(archive),archive.stat().st_size)
        command='python3 -c '+shlex.quote(code)
        with archive.open('rb') as stream:
            output=execute(command,stream=stream,timeout=1800).decode()
    lines=[line[len('SCHOOL_RELEASE='):] for line in output.splitlines() if line.startswith('SCHOOL_RELEASE=')]
    require(len(lines)==1,'RECEIPT_UNCONFIRMED')
    receipt=json.loads(lines[0]);require(receipt.get('state')=='runtime-verified' and receipt.get('controllerSha')==source,'RECEIPT_UNCONFIRMED')
    receipt['verificationRuns']=runs
    (work/'receipt.json').write_text(json.dumps(receipt,indent=2))
    print('SCHOOL_RELEASE='+json.dumps(receipt))

if __name__=='__main__':
    try: main()
    except Exception as error:
        reason=str(error) if type(error).__name__=='Refused' and re.fullmatch(r'[A-Z_]{2,80}',str(error)) else 'UNCONFIRMED'
        print('SCHOOL_DELIVERY_BLOCKED='+reason);raise SystemExit(2)
