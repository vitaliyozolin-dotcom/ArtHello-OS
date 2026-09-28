"""Protected, non-mutating source/reconciliation inventory. No client rows in logs."""
import hashlib
import math
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
# Exact central source from successful protected release 36269374177.
AUDIT_CENTRAL_LIVE=('d39fb05d6dc27dfba29fd65adf2ff41e5b9d1a2a',
                    '5320821c5780fc3e52147ff230c5799dd555b3e2',
                    '0210d4c7dabe5376d892c7058ffab74b36185a64',
                    'cc8cff9c2a396a97aeb6daf8dc0907a72f5587fa',
                    '49cea8d5f69d356e16c6aa88ecc8a7e93cef417d',
                    'd83da0ce8311a4b60832031a217b91c7dd6bb1c8',
                    'd066c3e7d94124efd847310e0d5ae9822401fa2f')

def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'deploy'/f'{name}.py')
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

release=load('alfa_release')
artifacts=load('alfa_artifact')
require=release.require

def summarize_runtime_failure(container, raw):
    # Fixed counters only: never return log lines, exception values, env or paths.
    lines=raw.decode('utf-8',errors='replace').splitlines()
    patterns={
        'crossRequestIo':'Cannot perform I/O on behalf of a different request',
        'transportFailure':'ALFA_TRANSPORT_FAILURE=',
        'transportCrossRequestIo':'CROSS_REQUEST_IO',
        'transportUnclassified':'"reason":"UNCLASSIFIED"',
        'transportTimeout':'"reason":"TIMEOUT"',
        'transportCallerAbort':'"reason":"CALLER_ABORT"',
        'transportResponseTooLarge':'"reason":"RESPONSE_TOO_LARGE"',
        'transportTlsExpired':'CERT_HAS_EXPIRED',
        'transportDnsNotFound':'ENOTFOUND',
        'transportSocket':'UND_ERR_SOCKET',
        'alfaActionFailed':'alfacrm.staged_action_failed',
        'fetchFailed':'fetch failed',
        'uncaughtException':'Uncaught',
        'memoryLimit':'Memory limit exceeded',
        'outOfMemory':'out of memory',
        'cpuLimit':'CPU time limit exceeded',
        'scriptWillNeverComplete':'The script will never generate a response',
        'cancelledIo':'I/O operation canceled',
        'socketHangUp':'socket hang up',
        'connectionReset':'ECONNRESET',
        'sqliteBusy':'SQLITE_BUSY',
        'sqliteError':'SQLITE_ERROR',
        'd1Error':'D1_ERROR',
    }
    for reason in ('ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN',
        'UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET',
        'CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID'):
        patterns['transport_'+reason]='"reason":"'+reason+'"'
    state=container.get('State',{})
    restarts=container.get('RestartCount')
    return {'status':'observed','source':'bounded-central-runtime-logs','window':'2h','tailLimit':200,
        'running':state.get('Running') is True,'oomKilled':state.get('OOMKilled') is True,
        'errorPresent':bool(state.get('Error')),
        'restartCount':restarts if type(restarts) is int and restarts>=0 else None,
        'linesRead':len(lines),
        'signals':{key:sum(pattern.lower() in line.lower() for line in lines) for key,pattern in patterns.items()}}

def runtime_failure_diagnostics(container, container_id):
    require(re.fullmatch(r'[a-f0-9]{64}',container_id),'CENTRAL_CONTAINER_ID')
    try:
        result=subprocess.run(['docker','logs','--since','2h','--tail','200',container_id],capture_output=True,timeout=30)
    except subprocess.TimeoutExpired:
        return {'status':'blocked','reason':'RUNTIME_LOG_READ_UNCONFIRMED'}
    if result.returncode!=0:
        return {'status':'blocked','reason':'RUNTIME_LOG_READ_UNCONFIRMED'}
    separator=b'\n' if result.stdout and result.stderr and not result.stdout.endswith(b'\n') else b''
    return summarize_runtime_failure(container,result.stdout+separator+result.stderr)


# Observed by protected read-only capacity run 36410336697; no mutable tag.
GATEWAY_IMAGE='sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d'

def summarize_gateway_failure(raw):
    patterns={'connectionRefused':'connection refused','connectionReset':'connection reset',
        'unexpectedEof':'unexpected eof','ioTimeout':'i/o timeout',
        'deadlineExceeded':'deadline exceeded','noSuchHost':'no such host',
        'tlsHandshake':'tls handshake','contextCanceled':'context canceled',
        'upstreamClosed':'upstream prematurely closed','eof':'eof',
        'closedBody':'invalid read on closed body','malformedResponse':'malformed http',
        'connectionClosed':'connection closed','headerTooLarge':'header too large'}
    lines=raw.decode('utf-8',errors='replace').splitlines()
    report={'status':'observed','source':'bounded-pinned-gateway-logs','window':'2h','tailLimit':200,
        'linesRead':len(lines),'jsonLines':0,'centralErrors':0,'alfaErrors':0,
        'statuses':{str(code):0 for code in (500,502,503,504)},
        'signals':{key:0 for key in patterns},'unclassifiedErrors':0}
    report['alfa']={'signals':{key:0 for key in patterns},'statuses':{str(code):0 for code in (500,502,503,504)},'recent':[]}
    for line in lines:
        try: row=json.loads(line)
        except (ValueError,TypeError): continue
        if not isinstance(row,dict):continue
        report['jsonLines']+=1
        request=row.get('request')
        if not isinstance(request,dict):continue
        if request.get('host') not in ('arthello-188-225-38-55.sslip.io','arthello-origin.internal'):continue
        status=row.get('status')
        if row.get('level')!='error' and not (type(status) is int and 500<=status<=599):continue
        report['centralErrors']+=1
        uri=request.get('uri')
        is_alfa=isinstance(uri,str) and uri.split('?',1)[0]=='/api/integrations/alfacrm'
        if is_alfa:report['alfaErrors']+=1
        if type(status) is int and str(status) in report['statuses']:report['statuses'][str(status)]+=1
        message=row.get('msg','')
        message=message.lower() if isinstance(message,str) else ''
        matched=False
        for key,pattern in patterns.items():
            if pattern in message:report['signals'][key]+=1;matched=True
        if not matched:report['unclassifiedErrors']+=1
        if is_alfa:
            reasons=[key for key,pattern in patterns.items() if pattern in message]
            for key in reasons:report['alfa']['signals'][key]+=1
            if type(status) is int and str(status) in report['alfa']['statuses']:report['alfa']['statuses'][str(status)]+=1
            duration=row.get('duration');timestamp=row.get('ts')
            report['alfa']['recent'].append({
                'status':status if type(status) is int and 500<=status<=599 else None,
                'method':request.get('method') if request.get('method') in ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS') else 'unknown',
                'timestamp':timestamp if type(timestamp) in (int,float) and math.isfinite(timestamp) and 0<timestamp<4102444800 else None,
                'durationMs':round(duration*1000) if type(duration) in (int,float) and math.isfinite(duration) and 0<=duration<=3600 else None,
                'reasons':reasons or ['unclassified']})
            report['alfa']['recent']=report['alfa']['recent'][-8:]
    return report

def gateway_failure_diagnostics():
    blocked={'status':'blocked','reason':'GATEWAY_LOG_READ_UNCONFIRMED'}
    try:
        found=subprocess.run(['docker','ps','--no-trunc','--filter','ancestor='+GATEWAY_IMAGE,
            '--format','{{.ID}}'],capture_output=True,timeout=30)
        ids=found.stdout.decode('ascii',errors='replace').split()
        if found.returncode!=0 or len(ids)!=1 or not re.fullmatch(r'[a-f0-9]{64}',ids[0]):
            return {'status':'blocked','reason':'GATEWAY_IDENTITY_UNCONFIRMED'}
        result=subprocess.run(['docker','logs','--since','2h','--tail','200',ids[0]],capture_output=True,timeout=30)
        if result.returncode!=0:return blocked
        separator=b'\n' if result.stdout and result.stderr and not result.stdout.endswith(b'\n') else b''
        return summarize_gateway_failure(result.stdout+separator+result.stderr)
    except (subprocess.TimeoutExpired,OSError):return blocked


def summarize_gateway_config(config):
    hosts={'arthello-188-225-38-55.sslip.io','arthello-origin.internal'}
    proxies=[]
    def duration(value,default):
        if value is None or value==0:return default
        if type(value) is int and 0<value<=3600_000_000_000:return value
        if isinstance(value,str):
            parsed=re.fullmatch(r'([0-9]+)(ns|us|ms|s|m|h)',value)
            if parsed:
                n=int(parsed[1])*{'ns':1,'us':1000,'ms':1000000,'s':1000000000,'m':60000000000,'h':3600000000000}[parsed[2]]
                if 0<n<=3600_000_000_000:return n
        return None
    def walk(value,scope=frozenset(),depth=0):
        require(depth<=40,'GATEWAY_CONFIG_DEPTH')
        if isinstance(value,list):
            for row in value:walk(row,scope,depth+1)
        elif isinstance(value,dict):
            if isinstance(value.get('match'),list):
                selected=[h for match in value['match'] if isinstance(match,dict) for h in match.get('host',[]) if isinstance(h,str)]
                if selected:
                    if any(not isinstance(match,dict) or not match.get('host') for match in value['match']):selected.append('*')
                    scope=frozenset(selected)
            if value.get('handler')=='reverse_proxy' and scope & hosts:
                transport=value.get('transport') or {}
                require(isinstance(transport,dict),'GATEWAY_TRANSPORT_FORMAT')
                keep=transport.get('keep_alive') or {}
                require(isinstance(keep,dict),'GATEWAY_KEEPALIVE_FORMAT')
                upstreams=value.get('upstreams') or []
                require(isinstance(upstreams,list),'GATEWAY_UPSTREAM_FORMAT')
                enabled=keep.get('enabled',True)
                proxies.append({
                    'exclusiveCentralHostScope':scope<=hosts,
                    'publicHost': 'arthello-188-225-38-55.sslip.io' in scope,
                    'originHost':'arthello-origin.internal' in scope,
                    'upstreams':len(upstreams),
                    'exactCentralUpstream':len(upstreams)==1 and isinstance(upstreams[0],dict) and upstreams[0].get('dial')=='arthello-direct-34837407187-1:8081',
                    'httpTransport':transport.get('protocol','http')=='http',
                    'tlsConfigured':'tls' in transport,
                    'keepAliveEnabled':enabled if type(enabled) is bool else None,
                    'keepAliveSource':'configured' if 'keep_alive' in transport else 'caddy-default',
                    'idleTimeoutNs':duration(keep.get('idle_timeout'),120000000000),
                    'versions':[v for v in transport.get('versions',[]) if v in ('1.1','2','h2c','3')]})
            for key,child in value.items():
                if key!='match' and isinstance(child,(list,dict)):walk(child,scope,depth+1)
    require(isinstance(config,dict),'GATEWAY_CONFIG_FORMAT')
    walk(config.get('apps',{}).get('http',{}).get('servers',{}))
    return {'status':'observed','centralProxies':proxies,
        'configSha256':hashlib.sha256(json.dumps(config,sort_keys=True,separators=(',',':')).encode()).hexdigest()}

def gateway_config_diagnostics():
    try:
        found=subprocess.run(['docker','ps','--no-trunc','--filter','ancestor='+GATEWAY_IMAGE,
            '--format','{{.ID}}'],capture_output=True,timeout=30)
        ids=found.stdout.decode('ascii',errors='replace').split()
        if found.returncode!=0 or len(ids)!=1 or not re.fullmatch(r'[a-f0-9]{64}',ids[0]):
            return {'status':'blocked','reason':'GATEWAY_IDENTITY_UNCONFIRMED'}
        result=subprocess.run(['docker','exec',ids[0],'wget','-qO-','http://127.0.0.1:2019/config/'],capture_output=True,timeout=30)
        if result.returncode!=0 or len(result.stdout)>2_000_000:
            return {'status':'blocked','reason':'GATEWAY_CONFIG_READ_UNCONFIRMED'}
        return summarize_gateway_config(json.loads(result.stdout))
    except Exception:
        return {'status':'blocked','reason':'GATEWAY_CONFIG_UNCONFIRMED'}

def capture(command, prefix, *, data=None, timeout=600):
    result=subprocess.run(command,input=data,capture_output=True,timeout=timeout)
    lines=result.stdout.decode().splitlines()
    reports=[json.loads(line[len(prefix):]) for line in lines if line.startswith(prefix)]
    if result.returncode==0 and len(reports)==1: return reports[0]
    safe=re.findall(rb'(?:ALFA_OS_AUDIT_BLOCKED|ALFA_SOURCE_AUDIT_FAILED|BANK_DATA_AUDIT_BLOCKED)=([A-Z_0-9]{3,70})',result.stderr)
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

def verify_central_source(central_source, controller_source):
    require(central_source in (release.PINS['central'][0],*AUDIT_CENTRAL_LIVE,controller_source),'CENTRAL_SOURCE')

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
    verify_central_source(central_source,source)
    report={'controllerSha':source,'centralSource':central_source,'businessDataChanged':False}
    report['runtimeDiagnostics']=runtime_failure_diagnostics(container,container['Id'])
    print('ALFA_RUNTIME_DIAGNOSTICS='+json.dumps(report['runtimeDiagnostics']),flush=True)
    report['gatewayDiagnostics']=gateway_failure_diagnostics()
    print('ALFA_GATEWAY_DIAGNOSTICS='+json.dumps(report['gatewayDiagnostics']),flush=True)
    report['gatewayConfig']=gateway_config_diagnostics()
    print('ALFA_GATEWAY_CONFIG='+json.dumps(report['gatewayConfig']),flush=True)
    report['bank']=capture(['docker','exec','-i',name,'node','--input-type=module','-'],'BANK_DATA_AUDIT=',data=(ROOT/'deploy/bank-data-audit.mjs').read_bytes())
    print('BANK_RECONCILIATION='+json.dumps(report['bank'],ensure_ascii=False),flush=True)
    report['source']=capture(['docker','exec','-i',name,'node','--input-type=module','-'],'ALFA_SOURCE_AUDIT=',data=(ROOT/'.github/scripts/alfa-source-audit.mjs').read_bytes())
    print('ALFA_SOURCE_RECONCILIATION='+json.dumps({'controllerSha':source,'centralSource':central_source,
        'observedAt':report['source'].get('observedAt'),
        'storedLessonDiagnostics':report['source'].get('storedLessonDiagnostics'),
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
