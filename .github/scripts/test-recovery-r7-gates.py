import base64
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import subprocess
import tempfile
import unittest
from unittest import mock

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

acceptance = load('acceptance', 'check-school-live-acceptance-r7.py')
replay = load('replay', 'd069-replay-guard.py')
activation = load('activation', 'd063-activation-state.py')
transport = load('transport', 'r3-school-repair-remote.py')
receipt_gate = load('receipt_gate', 'check-school-repair-receipt-r3.py')


def step_script(step_id):
    path = Path(__file__).resolve().parents[1] / 'workflows/deploy-arthello-recovery-r7-20260908.yml'
    source = path.read_text().splitlines()
    identity = source.index('      id: ' + step_id)
    step_start = max(i for i in range(identity + 1) if source[i].startswith('    - name:'))
    start = source.index('      run: |', step_start) + 1
    end = next((i for i in range(start, len(source)) if source[i] and not source[i].startswith('        ')), len(source))
    return '\n'.join(line[8:] if line else '' for line in source[start:end]) + '\n'

def cutover_script():
    return step_script('cutover')


class GateTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.datetime(2026, 9, 8, 8, tzinfo=datetime.timezone.utc)
        self.record = {'schemaVersion':3,'observedSchoolRepairExecutionUid':1002,'observedSchoolRepairStateDirectorySha256':'e'*64,'observedSchoolRepairConfigSha256':'f'*64,'intendedCandidateArtHelloSha':'a'*40,'observedLiveSchoolSha':'b'*40,'observedLiveArtHelloSha':'c'*40,'arthelloOrigin':'https://arthello-188-225-38-55.sslip.io','schoolOrigin':'https://school-188-225-38-55.sslip.io','method':'natural-browser-navigation','sessionInjected':False,'callbackUrlConstructed':False,'verifiedSteps':['open_education_in_authenticated_arthello','click_diary_entry','follow_natural_sso_redirects','authenticated_school_diary_visible'],'result':'pass','evidenceReference':'synthetic-test-fixture-only','observedAtUtc':'2026-09-08T07:50:00Z'}

    def check(self, record):
        return acceptance.validate(record, 'a'*40, 'b'*40, 'c'*40, 'f'*64, '2026-09-08T07:45:00Z', 1002, 'e'*64, self.now)

    def test_school_receipt_binds_manifest_identity_and_recent_real_probe(self):
        manifest={'school':{'container':'school-1-11','sourceSha':receipt_gate.SCHOOL_SHA,'imageId':receipt_gate.SCHOOL_IMAGE,'network':'arthello-os_backend'}}
        expected=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        receipt={'executionUid':1002,'stateDirectorySha256':'e'*64,'schemaVersion':2,'state':'verified','mode':'created','repairConfigSha256':expected,'runtimeConfigSha256':'a'*64,'schoolSourceSha':receipt_gate.SCHOOL_SHA,'schoolImageId':receipt_gate.SCHOOL_IMAGE,'schoolContainerId':'b'*64,'relayContainerId':'c'*64,'activatedAtUtc':'2026-09-08T07:58:00Z','verifiedAtUtc':'2026-09-08T07:59:00Z'}
        receipt_gate.validate(receipt,manifest,expected,self.now)
        receipt_gate.validate(dict(receipt,mode='verified-existing'),manifest,expected,self.now)
        for patch in [{'state':'refused'},{'repairConfigSha256':'d'*64},{'schoolImageId':'sha256:'+'d'*64},{'schoolContainerId':'c'*64},{'verifiedAtUtc':'2026-09-08T07:30:00Z'},{'activatedAtUtc':'2026-09-08T08:00:00Z'},{'extra':'unexpected'},{'executionUid':0},{'executionUid':True},{'stateDirectorySha256':'bad'}]:
            with self.subTest(patch=patch),self.assertRaises(AssertionError):
                receipt_gate.validate(dict(receipt,**patch),manifest,expected,self.now)

    def test_alfacrm_presence_prints_only_flags_and_exact_missing_legacy(self):
        with tempfile.TemporaryDirectory() as temporary:
            executable=Path(temporary)/'docker'
            payload=['ALFACRM_DOMAIN=fixture.example','ALFACRM_EMAIL=   ','ALFACRM_API_KEY=fixture-secret-never-print','UNRELATED_KEY=also-never-print']
            executable.write_text('#!/usr/bin/python3\nimport json,sys\nif sys.argv[1]=="inspect": print('+repr(json.dumps(payload))+')\n')
            executable.chmod(0o755)
            environment=dict(os.environ,PATH=temporary+os.pathsep+os.environ['PATH'])
            script=Path(__file__).with_name('r2-alfacrm-env-presence.sh')
            result=subprocess.run(['bash',str(script),'--current-arthello','a'*64],env=environment,capture_output=True,text=True,check=True)
            self.assertEqual(json.loads(result.stdout),{'scope':'current-arthello','targetPresent':True,'ALFACRM_DOMAIN':True,'ALFACRM_EMAIL':False,'ALFACRM_API_KEY':True})
            self.assertNotIn('fixture-secret',result.stdout+result.stderr)
            self.assertNotIn('also-never-print',result.stdout+result.stderr)
            result=subprocess.run(['bash',str(script),'--school-legacy'],env=environment,capture_output=True,text=True,check=True)
            self.assertEqual(json.loads(result.stdout),{'scope':'legacy-arthello-os-api-on-school-host','targetPresent':False})

    def test_moved_main_prevents_school_mutation_after_transport_preparation(self):
        repair=step_script('school_repair')
        start=repair.index('# Recheck current main immediately before')
        end=repair.index('\nSCHOOL_REPAIR_CONFIG_SHA256=',start)
        actual=repair[start:end]
        with tempfile.TemporaryDirectory() as temporary:
            work=Path(temporary)
            (work/'bundle').write_text('{}')
            fixture=r"""
set -Eeuo pipefail
work="$1"
RELEASE_SHA="$2"
MOVED_MAIN="$3"
GH_TOKEN=fixture GITHUB_REPOSITORY=fixture/repository
GITHUB_RUN_ID=123 GITHUB_RUN_ATTEMPT=1
repair_config_sha256=fixture repair_bundle_sha256=fixture bootstrap_base64=fixture
repair_bundle_file="$work/bundle" repair_receipt_file="$work/receipt"
DEPLOY_USER=fixture DEPLOY_HOST=fixture
ssh_options=()
curl() { printf '{}'; }
jq() { printf '%s\n' "$MOVED_MAIN"; }
timeout() { while [ "$1" != ssh ]; do shift; done; "$@"; }
ssh() { echo invoked >> "$work/calls"; echo '{"fixture":true}'; }
"""
            result=subprocess.run(['bash','-c',fixture+actual,'test',temporary,'a'*40,'b'*40],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertFalse((work/'calls').exists())
            result=subprocess.run(['bash','-c',fixture+actual,'test',temporary,'a'*40,'a'*40],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual((work/'calls').read_text(),'invoked\n')

    def test_exact_fresh_natural_evidence(self):
        self.check(self.record)

    def test_each_identity_must_match(self):
        for key in ['intendedCandidateArtHelloSha','observedLiveSchoolSha','observedLiveArtHelloSha','observedSchoolRepairConfigSha256','observedSchoolRepairExecutionUid','observedSchoolRepairStateDirectorySha256']:
            with self.subTest(key=key), self.assertRaises(AssertionError):
                self.check(dict(self.record, **{key:'d'*40}))

    def test_stale_future_or_naive_evidence_rejected(self):
        for stamp in ['2026-09-08T07:00:00Z','2026-09-08T07:44:59Z','2026-09-08T08:00:01Z','2026-09-08T07:50:00']:
            with self.subTest(stamp=stamp), self.assertRaises(AssertionError):
                self.check(dict(self.record, observedAtUtc=stamp))

    def test_empty_logs_do_not_replace_browser_evidence(self):
        with self.assertRaises(AssertionError):
            self.check({'callbackErrorCounts':{}})

    def test_injected_session_or_callback_rejected(self):
        for key in ['sessionInjected','callbackUrlConstructed']:
            with self.subTest(key=key), self.assertRaises(AssertionError):
                self.check(dict(self.record, **{key:True}))

    def test_incomplete_navigation_rejected(self):
        with self.assertRaises(AssertionError):
            self.check(dict(self.record, verifiedSteps=self.record['verifiedSteps'][:-1]))

    def test_failed_before_cutover_is_retryable(self):
        self.assertTrue(replay.safe_previous_job({'status':'completed','conclusion':'failure','steps':[{'name':'Verify installed R5 School relay with fresh receipt','conclusion':'success'},{'name':'Read-only School diagnostic and real browser acceptance','conclusion':'failure'},{'name':'Clone preflight and guarded production cutover','conclusion':'skipped'}]}))

    def test_failed_or_ambiguous_school_repair_cannot_resume(self):
        for conclusion in ['failure', 'cancelled', None]:
            with self.subTest(conclusion=conclusion):
                self.assertFalse(replay.safe_previous_job({'status':'completed','conclusion':'failure','steps':[
                    {'name':'Verify installed R5 School relay with fresh receipt','conclusion':conclusion},
                    {'name':'Clone preflight and guarded production cutover','conclusion':'skipped'}]}))

    def test_pre_repair_failure_with_both_mutation_steps_skipped_can_resume(self):
        self.assertTrue(replay.safe_previous_job({'status':'completed','conclusion':'failure','steps':[
            {'name':'Verify installed R5 School relay with fresh receipt','conclusion':'skipped'},
            {'name':'Clone preflight and guarded production cutover','conclusion':'skipped'}]}))

    def test_started_cutover_or_unknown_history_not_retryable(self):
        for conclusion in ['failure','cancelled','success',None]:
            with self.subTest(conclusion=conclusion):
                self.assertFalse(replay.safe_previous_job({'status':'completed','steps':[{'name':'Clone preflight and guarded production cutover','conclusion':conclusion}]}))
        self.assertFalse(replay.safe_previous_job({'status':'in_progress','steps':[]}))
        self.assertFalse(replay.safe_previous_job({'status':'completed','conclusion':'failure','steps':[]}))

    def test_activation_marker_is_durable_exact_and_cannot_be_replaced(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'activation.json'
            record = activation.begin(path, 'a'*40, '123', '2', 'b'*64, 'c'*64,
                                      'arthello-rollback-123-2', 'd'*64, 'e'*64,
                                      str(Path(temporary) / 'arthello-deploy-123-2'))
            self.assertEqual(json.loads(path.read_text()), record)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(ValueError):
                activation.atomic_write(path, b'overwrite forbidden')
            self.assertEqual(json.loads(path.read_text()), record)

    def test_activation_marker_rejects_symlink_and_invalid_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            real = Path(temporary) / 'real'
            real.write_text('preserve')
            link = Path(temporary) / 'link'
            link.symlink_to(real)
            with self.assertRaises(ValueError):
                activation.atomic_write(link, b'overwrite forbidden', replace=True)
            self.assertEqual(real.read_text(), 'preserve')
            with self.assertRaises(ValueError):
                activation.begin(Path(temporary)/'bad', 'not-sha', '123', '1', 'b'*64, 'c'*64,
                                 'arthello-rollback-123-1', 'd'*64, 'e'*64, '/tmp/arthello-deploy-123-1')

    def test_candidate_checks_precede_boundary_and_bank_activation_follows_public_gates(self):
        script = cutover_script()
        local = script.index('verify_public "$run_key-internal" http://127.0.0.1:8081')
        boundary = script.index('public_commit_started=1')
        route_move = script.index('mv "$CANDIDATE_ROUTE" /data/external-routes.caddy')
        public = script.index('verify_public "$run_key"', route_move)
        hmac = script.index('verify_school_sync_secret after-route-activation', public)
        enable = script.index('activation-volume.py write', hmac)
        self.assertLess(local, boundary)
        self.assertLess(boundary, route_move)
        self.assertLess(route_move, public)
        self.assertLess(public, hmac)
        self.assertLess(hmac, enable)
        self.assertIn('require_current_main_release', script[hmac:enable])
        self.assertIn('-e TOCHKA_AUTOSYNC_ACTIVATION_ID="$autosync_activation_id"', script[:local])

    def test_post_boundary_failures_preserve_new_writes_and_pre_boundary_rolls_back(self):
        rollback = re.search(r'^rollback\(\) \{\n.*?^\}', cutover_script(), re.M | re.S).group()
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / 'database'
            log = Path(temporary) / 'operations'
            harness = r'''
set +e
public_commit_started="$1"
activation_state_file=durable-state
work="$2"
database="$work/database"
log="$work/operations"
candidate_paused=0 live_paused=0 candidate=new live_id=old
clone_container=clone release_active=0 live_data_modified=1 backup_ready=1
rollback_volume=snapshot DATA_VOLUME=current old_restart_disabled=0 route_changed=0
inventory_script=unused PUBLIC_URL=unused SCHOOL_URL=unused
container_exists() { [ "$1" = old ]; }
volume_exists() { return 0; }
docker() { printf 'docker %s\n' "$*" >> "$log"; case "$*" in *State.Paused*) echo false;; *State.Running*) echo true;; esac; }
copy_volume() { printf 'snapshot-restored\n' > "$database"; echo restore >> "$log"; }
snapshot_volume() { return 0; }
content_manifest() { return 0; }
cmp() { return 0; }
python3() { return 0; }
curl() { return 0; }
jq() { return 0; }
wait_old_health() { return 0; }
cleanup_transient() { echo cleanup >> "$log"; }
cleanup_backup_runtime() { return 0; }
'''
            for phase, crossed, code in [('local-health', 0, 1), ('route-move', 1, 2), ('ambiguous-reload', 1, 3), ('public-check', 1, 4), ('cancel-after-public', 1, 143)]:
                with self.subTest(phase=phase):
                    database.write_text('new-user-writes\n')
                    log.write_text('')
                    result = subprocess.run(['bash', '-c', harness + '\n' + rollback + f'\nrollback {code}\n', 'fault-test', str(crossed), temporary], capture_output=True, text=True)
                    self.assertEqual(result.returncode, code)
                    if crossed:
                        self.assertEqual(database.read_text(), 'new-user-writes\n')
                        self.assertEqual(log.read_text(), '')
                        self.assertIn('POST_ACTIVATION_RECOVERY_REQUIRED', result.stderr)
                    else:
                        self.assertEqual(database.read_text(), 'snapshot-restored\n')
                        self.assertIn('restore', log.read_text())

class OrdinaryBackupContinuationTests(unittest.TestCase):
    def setUp(self):
        self.repo='vitaliyozolin-dotcom/ArtHello-OS'
        self.previous={'id':replay.PREVIOUS_RUN,'head_sha':replay.PREVIOUS_SHA,'path':replay.PREVIOUS_PATH,
            'repository':{'full_name':self.repo},'head_repository':{'full_name':self.repo},'event':'workflow_run','head_branch':'main',
            'actor':{'login':'vitaliyozolin-dotcom'},'triggering_actor':{'login':'vitaliyozolin-dotcom'},
            'run_attempt':1,'status':'completed','conclusion':'failure'}
        self.previous_job={'id':replay.PREVIOUS_JOB,'name':'deploy','run_attempt':1,'status':'completed','conclusion':'failure','steps':[
            {'name':'Verify installed R5 School relay with fresh receipt','conclusion':'success'},
            {'name':'Check existing gateway backup installation capability','conclusion':'failure'},
            {'name':'Read-only School diagnostic and real browser acceptance','conclusion':'skipped'},
            {'name':'Clone preflight and guarded production cutover','conclusion':'skipped'}]}

    def test_exact_r6_capability_abort_does_not_rearm_r6(self):
        replay.validate_r6_abort(self.previous,{'total_count':1,'jobs':[self.previous_job]},self.repo)

    def test_early_source_probe_is_readonly_and_rejects_untrusted_ownership(self):
        workflow=(Path(__file__).resolve().parents[1]/'workflows/deploy-arthello-recovery-r7-20260908.yml').read_text()
        source=workflow.split("node <<'D069_SOURCE_READONLY'\n",1)[1].split('        D069_SOURCE_READONLY',1)[0]
        source='\n'.join(line[8:] for line in source.splitlines())
        harness=r'''
const vm = require('node:vm');
const payload = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const fixture = payload.fixture;
const calls=[]; const output=[];
const info={uid:1000,gid:1000,mode:0o100640,dev:1,ino:2,...fixture.info,isFile:()=>fixture.regular !== false};
const fakefs={constants:{O_RDONLY:0,O_NOFOLLOW:0x20000,O_NONBLOCK:0x800},
 realpathSync:path=>fixture.symlink ? path+'-other' : path,
 openSync:(path,flags)=>{calls.push(['open',flags]);if(fixture.denied)throw Error('denied');return 17;},
 fstatSync:fd=>info,lstatSync:path=>({dev:1,ino:fixture.replaced ? 3 : 2}),
 closeSync:fd=>calls.push(['close',fd])};
const process={getuid:()=>fixture.uid ?? 1000,getgid:()=>fixture.gid ?? 1000,exitCode:0};
vm.runInNewContext(payload.source,{require:name=>{if(name!=='node:fs')throw Error('forbidden');return fakefs;},process,console:{log:value=>output.push(JSON.parse(value))}});
console.log(JSON.stringify({calls,output,exitCode:process.exitCode}));
'''
        fixtures=[{}, {'uid':0}, {'gid':0}, {'info':{'uid':0}}, {'info':{'gid':0}},
                  {'info':{'mode':0o100666}}, {'regular':False}, {'symlink':True}, {'denied':True}, {'replaced':True}]
        for fixture in fixtures:
            with self.subTest(fixture=fixture):
                result=subprocess.run(['node','-e',harness],input=json.dumps({'source':source,'fixture':fixture}),text=True,capture_output=True,check=True)
                actual=json.loads(result.stdout)
                self.assertEqual(actual['exitCode'],0 if not fixture else 1)
                self.assertEqual(len(actual['output']),1)
                self.assertEqual(actual['output'][0]['sourceOwnershipVerified'],not fixture)
                self.assertNotIn('/data',result.stdout)
                for call in actual['calls']:
                    self.assertIn(call[0],['open','close'])
                    if call[0]=='open':self.assertEqual(call[1],0x20800)

    def test_replayed_wrong_or_started_r6_is_rejected(self):
        import copy
        for key,value in [('head_sha','a'*40),('id',123),('run_attempt',2),('event','pull_request'),('path',replay.CONSUMER_PATH),('status','in_progress'),('conclusion','success')]:
            with self.subTest(key=key),self.assertRaises(AssertionError):
                replay.validate_r6_abort(dict(self.previous,**{key:value}),{'total_count':1,'jobs':[self.previous_job]},self.repo)
        for index in range(4):
            for outcome in ['success','failure','cancelled','skipped',None]:
                if self.previous_job['steps'][index]['conclusion']==outcome:continue
                job=copy.deepcopy(self.previous_job);job['steps'][index]['conclusion']=outcome
                with self.subTest(index=index,outcome=outcome),self.assertRaises(AssertionError):
                    replay.validate_r6_abort(self.previous,{'total_count':1,'jobs':[job]},self.repo)
        for jobs in [{'total_count':0,'jobs':[]},{'total_count':2,'jobs':[self.previous_job]}]:
            with self.assertRaises(AssertionError):replay.validate_r6_abort(self.previous,jobs,self.repo)

    def test_missing_current_run_history_fails_closed_after_both_prior_checks(self):
        import io
        environment={'EXPECTED_REPOSITORY':self.repo,'RELEASE_SHA':'a'*40,'GITHUB_RUN_ID':'999','GITHUB_RUN_ATTEMPT':'2','GH_TOKEN':'synthetic-test-only'}
        for runs in [[],[{'id':998}],[{'id':999},{'id':999}]]:
            routes=[]
            def response(request,timeout):
                path=request.full_url;routes.append(path)
                if '/actions/workflows/' in path:value={'total_count':len(runs),'workflow_runs':runs}
                else:value={}
                return io.StringIO(json.dumps(value))
            with mock.patch.dict(os.environ,environment),mock.patch.object(replay,'validate_installation') as install,mock.patch.object(replay,'validate_r6_abort') as abort,mock.patch.object(replay.urllib.request,'urlopen',side_effect=response),self.assertRaises(AssertionError):
                replay.run()
            install.assert_called_once();abort.assert_called_once()
            self.assertEqual(len(routes),5)

    def test_first_backup_is_verified_before_live_stop_and_runtime_has_no_host_admin(self):
        source=cutover_script()
        self.assertLess(source.index("printf 'ARTHELLO_CLONE_PREFLIGHT=VERIFIED"),source.index('backup_runtime prepare | tee'))
        self.assertLess(source.index('ARTHELLO_BACKUP_ORDINARY_RUNTIME=VERIFIED'),source.index('docker stop --time 30 "$live_id"'))
        self.assertNotRegex(source,r'root_command|sudo\s|systemctl|host_active_d1|data_mountpoint|backup/install(?:-bridge)?\.sh|enable-autosync')
        self.assertIn('dst=/var/lib/arthello-v52-backup-control,readonly,volume-nocopy',source)
        self.assertIn('dst=/var/lib/arthello-v52-tochka-activation,readonly,volume-nocopy',source)
        self.assertIn('all($mounts[]; .Type == "volume" and .RW == false)',source)
        self.assertNotIn('assert_readonly_secret_mount "$candidate" /var/lib/arthello-v52-',source)

    def test_app_and_backup_cannot_write_the_activation_marker(self):
        source=cutover_script()
        writer=source[source.index('docker run --rm',source.index('verify_school_sync_secret after-route-activation')):]
        writer=writer[:writer.index("printf 'release_container=")]
        self.assertIn('--user 1002:1000 --network none --read-only --cap-drop ALL',writer)
        self.assertIn('src=$bank_activation_volume,dst=/var/lib/arthello-v52-tochka-activation,volume-nocopy',writer)
        self.assertNotIn('backup_control_volume',writer)
        self.assertNotIn('backup_volume',writer)
        self.assertNotIn('$DATA_VOLUME',writer)
        self.assertNotIn('runtime_secret_mounts',writer)
        self.assertIn('secrets.token_hex(32)',source)
        self.assertIn('.executionUid == 1002 and .executionGid == 1000',writer)
        self.assertIn('.markerMode == "0640" and .mode == "created"',writer)

    def test_persistent_state_directory_is_private_nofollow_and_never_adopts_run_directory(self):
        initialize=re.search(r'^initialize_backup_runtime_state\(\) \{\n.*?^\}',cutover_script(),re.M|re.S).group()
        harness='set -Eeuo pipefail\nsecret_dir="$1"; run_key=1234-1\n'+initialize+'\ninitialize_backup_runtime_state\n'
        for case in ['valid','repeat','secret-symlink','release-symlink','release-mode','secret-mode','writable-ancestor']:
            with self.subTest(case=case),tempfile.TemporaryDirectory(prefix='arthello-r7-state-',dir=Path.home()) as temporary:
                root=Path(temporary);secret=root/'secret';secret.mkdir(mode=0o700)
                release=secret/'release-state'
                if case=='secret-symlink':
                    secret.rename(root/'target');secret.symlink_to(root/'target',target_is_directory=True)
                elif case=='release-symlink':
                    (root/'target').mkdir(mode=0o700);release.symlink_to(root/'target',target_is_directory=True)
                elif case=='release-mode':release.mkdir(mode=0o755)
                elif case=='secret-mode':secret.chmod(0o755)
                elif case=='writable-ancestor':root.chmod(0o777)
                result=subprocess.run(['bash','-c',harness,'fixture',str(secret)],text=True,capture_output=True)
                if case in ['valid','repeat']:
                    self.assertEqual(result.returncode,0,result.stderr)
                    directory=release/'backup-runtime-1234-1'
                    self.assertEqual(directory.stat().st_mode & 0o7777,0o700)
                    self.assertEqual(directory.stat().st_uid,os.geteuid())
                    if case=='repeat':
                        marker=directory/'untouched';marker.write_text('existing-owner-proof')
                        again=subprocess.run(['bash','-c',harness,'fixture',str(secret)],text=True,capture_output=True)
                        self.assertNotEqual(again.returncode,0)
                        self.assertEqual(marker.read_text(),'existing-owner-proof')
                else:
                    self.assertNotEqual(result.returncode,0)
                    self.assertFalse((release/'backup-runtime-1234-1').exists())

    def test_transient_cleanup_cannot_delete_persistent_ownership_after_success_or_public_failure(self):
        source=cutover_script()
        initialize=re.search(r'^initialize_backup_runtime_state\(\) \{\n.*?^\}',source,re.M|re.S).group()
        cleanup=re.search(r'^cleanup_transient\(\) \{\n.*?^\}',source,re.M|re.S).group()
        safe=re.search(r'^require_safe_work_path\(\) \{\n.*?^\}',source,re.M|re.S).group()
        self.assertIn('backup_runtime_state_dir="$secret_dir/release-state/backup-runtime-$run_key"',source)
        self.assertNotIn('backup_runtime_state="$work/',source)
        self.assertLess(source.index('\ninitialize_backup_runtime_state\n'),source.index('backup_runtime_started=1'))
        with tempfile.TemporaryDirectory(prefix='arthello-r7-lifecycle-',dir=Path.home()) as temporary:
            root=Path(temporary);secret=root/'secret';secret.mkdir(mode=0o700)
            create='secret_dir="$1"; run_key=1234-1\n'+initialize+'\ninitialize_backup_runtime_state\n'
            subprocess.run(['bash','-c',create,'fixture',str(secret)],check=True,capture_output=True,text=True)
            state=secret/'release-state/backup-runtime-1234-1/backup-runtime-state.json'
            state.write_text('{"schemaVersion":1,"instance":"synthetic-ownership-proof","resources":[{"name":"worker","id":"recorded-id"}]}\n')
            state.chmod(0o600);proof=state.read_bytes();inode=state.stat().st_ino
            runner=root/'transient';runner.mkdir()
            for public,cleanup_failed in [(0,0),(1,0),(1,1),(0,1)]:
                with self.subTest(public=public,cleanup_failed=cleanup_failed):
                    work=runner/'arthello-deploy-1234-1';work.mkdir();(work/'sensitive-db-snapshot').write_text('synthetic')
                    harness='''
set -Eeuo pipefail
RUNNER_TEMP="$1";work="$RUNNER_TEMP/arthello-deploy-1234-1";public_commit_started="$2";backup_runtime_cleanup_failed="$3"
release_active=1;backup_runtime_started=1;clone_container=clone;copy_helper=copy;snapshot_helper=snapshot;clone_volume=clone-volume
CADDY_CONTAINER=caddy;route_new=route;config_new=config
docker() { return 0; }
'''
                    result=subprocess.run(['bash','-c',harness+'\n'+safe+'\n'+cleanup+'\ncleanup_transient','fixture',str(runner),str(public),str(cleanup_failed)],text=True,capture_output=True)
                    self.assertEqual(result.returncode,0,result.stderr)
                    self.assertFalse(work.exists())
                    self.assertEqual(state.read_bytes(),proof)
                    self.assertEqual(state.stat().st_ino,inode)
                    self.assertEqual(state.stat().st_mode & 0o7777,0o600)

    def test_new_backup_cleanup_respects_public_boundary_and_failed_containment(self):
        rollback=re.search(r'^rollback\(\) \{\n.*?^\}',cutover_script(),re.M|re.S).group()
        with tempfile.TemporaryDirectory() as temporary:
            work=Path(temporary);database=work/'db';log=work/'log'
            harness=r'''
set +e
work="$1"; database="$work/db"; log="$work/log"; public_commit_started="$2"; cleanup_result="$3"
activation_state_file=durable; candidate_paused=0; live_paused=0; candidate=new; live_id=old
clone_container=clone; release_active=0; live_data_modified=1; backup_ready=1; rollback_volume=snapshot; DATA_VOLUME=current
old_restart_disabled=0; route_changed=0; inventory_script=unused; PUBLIC_URL=unused; SCHOOL_URL=unused
container_exists() { [ "$1" = old ]; }
volume_exists() { return 0; }
docker() { if [ "$1" = inspect ]; then echo true; fi; }
cleanup_backup_runtime() { echo worker-cleanup >> "$log"; return "$cleanup_result"; }
copy_volume() { echo restored > "$database"; echo restore >> "$log"; }
snapshot_volume() { return 0; }; content_manifest() { return 0; }; cmp() { return 0; }; python3() { return 0; }
curl() { return 0; }; jq() { return 0; }; wait_old_health() { return 0; }; cleanup_transient() { echo transient >> "$log"; }
'''
            for crossed,cleanup_result in [(0,0),(0,1),(1,0)]:
                database.write_text('new-user-writes\n');log.write_text('')
                result=subprocess.run(['bash','-c',harness+'\n'+rollback+'\nrollback 19','fixture',temporary,str(crossed),str(cleanup_result)],capture_output=True,text=True)
                self.assertEqual(result.returncode,19)
                if crossed:
                    self.assertEqual(log.read_text(),'')
                elif cleanup_result:
                    self.assertNotIn('restore',log.read_text())
                else:
                    self.assertLess(log.read_text().index('worker-cleanup'),log.read_text().index('restore'))
                self.assertEqual(database.read_text(),'restored\n' if not crossed and cleanup_result==0 else 'new-user-writes\n')

    def test_existing_secret_inventory_and_data_copy_functions_are_unchanged(self):
        path=Path(__file__).resolve().parents[1]/'workflows/deploy-arthello-recovery-r6-20260908.yml'
        lines=path.read_text().splitlines();identity=lines.index('      id: cutover')
        step=max(i for i in range(identity+1) if lines[i].startswith('    - name:'));start=lines.index('      run: |',step)+1
        end=next((i for i in range(start,len(lines)) if lines[i] and not lines[i].startswith('        ')),len(lines))
        old='\n'.join(line[8:] if line else '' for line in lines[start:end])+'\n'
        for match in re.finditer(r'^([a-z_]+)\(\) \{\n.*?^\}',old,re.M|re.S):
            name=match[1]
            if name in ['cleanup_transient','rollback']:continue
            actual=re.search(r'^'+name+r'\(\) \{\n.*?^\}',cutover_script(),re.M|re.S)
            self.assertEqual(actual.group(),match.group(),name)


if __name__ == '__main__':
    unittest.main()
