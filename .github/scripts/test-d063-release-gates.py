import datetime
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

acceptance = load('acceptance', 'check-school-live-acceptance.py')
replay = load('replay', 'd063-replay-guard.py')
activation = load('activation', 'd063-activation-state.py')


def cutover_script():
    path = Path(__file__).resolve().parents[1] / 'workflows/deploy-arthello-recovery-20260908.yml'
    source = path.read_text().splitlines()
    start = source.index('      id: cutover')
    start = source.index('      run: |', start) + 1
    end = next((i for i in range(start, len(source)) if source[i] and not source[i].startswith('        ')), len(source))
    return '\n'.join(line[8:] if line else '' for line in source[start:end]) + '\n'

class GateTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.datetime(2026, 9, 8, 8, tzinfo=datetime.timezone.utc)
        self.record = {'schemaVersion':1,'intendedCandidateArtHelloSha':'a'*40,'observedLiveSchoolSha':'b'*40,'observedLiveArtHelloSha':'c'*40,'arthelloOrigin':'https://arthello-188-225-38-55.sslip.io','schoolOrigin':'https://school-188-225-38-55.sslip.io','method':'natural-browser-navigation','sessionInjected':False,'callbackUrlConstructed':False,'verifiedSteps':['open_education_in_authenticated_arthello','click_diary_entry','follow_natural_sso_redirects','authenticated_school_diary_visible'],'result':'pass','evidenceReference':'synthetic-test-fixture-only','observedAtUtc':'2026-09-08T07:50:00Z'}

    def check(self, record):
        return acceptance.validate(record, 'a'*40, 'b'*40, 'c'*40, self.now)

    def test_exact_fresh_natural_evidence(self):
        self.check(self.record)

    def test_each_identity_must_match(self):
        for key in ['intendedCandidateArtHelloSha','observedLiveSchoolSha','observedLiveArtHelloSha']:
            with self.subTest(key=key), self.assertRaises(AssertionError):
                self.check(dict(self.record, **{key:'d'*40}))

    def test_stale_future_or_naive_evidence_rejected(self):
        for stamp in ['2026-09-08T07:00:00Z','2026-09-08T08:00:01Z','2026-09-08T07:50:00']:
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
        self.assertTrue(replay.safe_previous_job({'status':'completed','conclusion':'failure','steps':[{'name':'Read-only School diagnostic and real browser acceptance','conclusion':'failure'},{'name':'Clone preflight and guarded production cutover','conclusion':'skipped'}]}))

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
