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

acceptance = load('acceptance', 'check-school-live-acceptance-r5.py')
replay = load('replay', 'd067-replay-guard.py')
activation = load('activation', 'd063-activation-state.py')
transport = load('transport', 'r3-school-repair-remote.py')
receipt_gate = load('receipt_gate', 'check-school-repair-receipt-r3.py')


def step_script(step_id):
    path = Path(__file__).resolve().parents[1] / 'workflows/deploy-arthello-recovery-r5-20260908.yml'
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
        self.assertTrue(replay.safe_previous_job({'status':'completed','conclusion':'failure','steps':[{'name':'Repair School egress configuration with durable receipt','conclusion':'success'},{'name':'Read-only School diagnostic and real browser acceptance','conclusion':'failure'},{'name':'Clone preflight and guarded production cutover','conclusion':'skipped'}]}))

    def test_failed_or_ambiguous_school_repair_cannot_resume(self):
        for conclusion in ['failure', 'cancelled', None]:
            with self.subTest(conclusion=conclusion):
                self.assertFalse(replay.safe_previous_job({'status':'completed','conclusion':'failure','steps':[
                    {'name':'Repair School egress configuration with durable receipt','conclusion':conclusion},
                    {'name':'Clone preflight and guarded production cutover','conclusion':'skipped'}]}))

    def test_pre_repair_failure_with_both_mutation_steps_skipped_can_resume(self):
        self.assertTrue(replay.safe_previous_job({'status':'completed','conclusion':'failure','steps':[
            {'name':'Repair School egress configuration with durable receipt','conclusion':'skipped'},
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
        enable = script.index('d063-activation-state.py enable-autosync', hmac)
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

if __name__ == '__main__':
    unittest.main()
