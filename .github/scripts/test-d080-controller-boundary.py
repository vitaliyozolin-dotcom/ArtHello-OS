"""Execute the actual shell boundary with synthetic commands and failure points."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

WORKFLOW = Path(__file__).parents[1] / 'workflows/deploy-arthello-recovery-r9-20260909.yml'
source = WORKFLOW.read_text()
cutover = source.split('    - name: Clone preflight and guarded production cutover\n', 1)[1].split('    - name: School diagnostic and real browser acceptance after cutover\n', 1)[0]
lines = cutover.split('      run: |\n', 1)[1].splitlines()
shell = '\n'.join(line[8:] if line.startswith('        ') else line for line in lines) + '\n'
activation = shell.split('# D080_MAINTENANCE_ACTIVATION_BEGIN\n', 1)[1].split('# D080_MAINTENANCE_ACTIVATION_END', 1)[0]
fragment = activation[activation.index('python3 -I .github/scripts/d080-candidate-state.py begin'):]
rollback = shell[shell.index('  if [ "$public_commit_started"'):shell.index("  printf 'ARTHELLO_ROLLBACK=START")]


class ControllerBoundaryTest(unittest.TestCase):
    def run_shell(self, body, stage):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(['bash', '-c', body], text=True, capture_output=True, timeout=5,
                env={'PATH': os.environ['PATH'], 'FAILURE_STAGE': stage, 'HOME': directory})
        self.assertNotIn('syntax error', result.stderr)
        return result

    def test_actual_begin_cas_reload_failure_boundaries(self):
        harness = r'''
set -Eeuo pipefail
candidate_auth_started=0
route_changed=0
state_created=0
route_installed=0
completed=0
work=/synthetic
candidate_state_file=/synthetic/state
CADDY_CONTAINER=synthetic
maintenance_route_new=/synthetic/maintenance
original_route_sha=synthetic
trap 'printf "BOUNDARY:%s:%s:%s:%s\n" "$state_created" "$candidate_auth_started" "$route_installed" "$completed"' EXIT
python3() { if [ "$FAILURE_STAGE" = begin ]; then return 1; fi; state_created=1; }
require_current_main_release() { test "$FAILURE_STAGE" != main; }
docker() {
  if [[ "$*" == *' caddy reload '* ]]; then test "$FAILURE_STAGE" != reload; return; fi
  test "$FAILURE_STAGE" != cas-before || return 1
  route_installed=1
  test "$FAILURE_STAGE" != cas-ambiguous
}
complete_candidate_release() { completed=1; }
'''
        expected = {'begin': '0:0:0:0', 'main': '1:1:0:0', 'cas-before': '1:1:0:0',
                    'cas-ambiguous': '1:1:1:0', 'reload': '1:1:1:0', 'success': '1:1:1:1'}
        for stage, evidence in expected.items():
            with self.subTest(stage=stage):
                result = self.run_shell(harness + fragment, stage)
                self.assertIn('BOUNDARY:' + evidence, result.stdout)
                self.assertEqual(result.returncode == 0, stage == 'success')

    def test_actual_post_auth_rollback_never_restores_even_when_hold_proof_fails(self):
        for authenticated, public in [(0, 0), (1, 0), (1, 1)]:
            for proof in ('pass', 'fail'):
                harness = '''
set -u
public_commit_started=%s
candidate_auth_started=%s
original_rc=17
candidate_state_file=/synthetic/state
work=/synthetic
RELEASE_SHA=synthetic
EXPECTED_TREE=synthetic
GITHUB_RUN_ID=123
GITHUB_RUN_ATTEMPT=2
python3() { test "$FAILURE_STAGE" = pass || return 1; echo HELD; }
''' % (public, authenticated)
                result = self.run_shell(harness + rollback + '\necho RESTORE_PATH_REACHED\n', proof)
                self.assertEqual('RESTORE_PATH_REACHED' in result.stdout, not authenticated and not public)
                if authenticated or public:
                    self.assertEqual(result.returncode, 17)
                    self.assertNotIn('RESTORE_PATH_REACHED', result.stdout)
                if public or proof == 'fail':
                    self.assertNotIn('HELD', result.stdout)


if __name__ == '__main__':
    unittest.main()
