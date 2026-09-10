import ast
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
import urllib.error
from unittest.mock import patch

path = Path(__file__).with_name('r15-history-gate.py')
spec = importlib.util.spec_from_file_location('history', path)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
# Sanitized actual GitHub metadata for accepted R13, not generated from gate expectations.
ACTUAL = json.loads((path.parent / 'fixtures/r14-accepted-r13-history.json').read_text())
SOURCE = 'a' * 40
CURRENT = 90000000001

def run(identity=CURRENT, attempt=1, status='in_progress', conclusion=None):
    value = copy.deepcopy(ACTUAL['run'])
    value.update(id=identity, path=gate.CONSUMER_PATH, name='Deploy R14', head_sha=SOURCE,
                 run_attempt=attempt, status=status, conclusion=conclusion)
    return value

def jobs(attempt=1, identity=CURRENT, held=False, resumed=False):
    value = copy.deepcopy(ACTUAL['jobs'])
    for row in value['jobs']:
        row.update(id=identity + 1000 + attempt * 2 + (row['name'] == 'deploy'), run_id=identity,
                   run_attempt=attempt, head_sha=SOURCE)
        if row['name'] == 'deploy':
            row['conclusion'] = 'failure'
            names = gate.PRESTEPS + [gate.CUTOVER_STEP] + gate.POSTSTEPS
            row['steps'] = [dict(name=name, number=index + 1, status='completed', conclusion='success')
                            for index, name in enumerate(names)]
            for step in row['steps']:
                if step['name'] == gate.RESUME_STEP:
                    step['conclusion'] = 'success' if resumed else 'skipped'
                if resumed and step['name'] in gate.IMPORTS:
                    step['conclusion'] = 'skipped'
                if step['name'] == gate.CUTOVER_STEP:
                    step['conclusion'] = 'failure' if held else 'skipped'
                if step['name'] == gate.POST_STEP:
                    step['conclusion'] = 'skipped'
    return value

def deploy(value):
    return next(job for job in value['jobs'] if job['name'] == 'deploy')

def step(value, name):
    return next(item for item in deploy(value)['steps'] if item['name'] == name)

class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.accepted = copy.deepcopy(ACTUAL)
        self.runs = {'total_count': 1, 'workflow_runs': [run()]}
        self.pages, self.logs, self.reads = {}, {}, []

    def page(self, identity, attempt):
        return f'/actions/runs/{identity}/attempts/{attempt}/jobs?per_page=100'

    def get(self, path):
        self.reads.append(path)
        return self.pages[path]

    def log(self, identity):
        self.reads.append(identity)
        return self.logs[identity]

    def check(self, attempt=1, **extra):
        return gate.validate_gate(self.accepted['run'], self.accepted['jobs'], self.accepted['commit'],
                                  self.runs, self.get, self.log, SOURCE, CURRENT, attempt, **extra)

    def held(self, attempt=1, resumed=False):
        self.runs['workflow_runs'] = [run(attempt=attempt + 1)]
        for prior in range(1, attempt + 1):
            value = jobs(prior, held=True, resumed=prior > 1 and resumed)
            self.pages[self.page(CURRENT, prior)] = value
            self.logs[deploy(value)['id']] = '2026-09-09T10:00:00.000Z ARTHELLO_D080_CANDIDATE_MAINTENANCE_HELD=1\n'
        return value

    def test_actual_accepted_success_and_fresh_run_have_no_log_reads_or_restore_authority(self):
        result = self.check()
        self.assertEqual(result['mode'], 'fresh')
        self.assertIs(result['dataRestoreAuthorized'], False)
        self.assertIs(result['retainedRuntimeVerificationRequired'], False)
        self.assertEqual(self.reads, [])

    def test_each_accepted_provenance_and_job_identity_is_fixed(self):
        for key, bad in [('id', CURRENT), ('name', 'another'), ('path', gate.CONSUMER_PATH),
                         ('head_sha', SOURCE), ('head_branch', 'fork'), ('event', 'push'),
                         ('run_attempt', 2), ('run_attempt', True), ('status', 'in_progress'), ('conclusion', 'failure')]:
            with self.subTest(key=key, bad=bad):
                self.accepted = copy.deepcopy(ACTUAL); self.accepted['run'][key] = bad
                with self.assertRaises(gate.Refused): self.check()
        for key in ('repository', 'head_repository', 'actor', 'triggering_actor'):
            self.accepted = copy.deepcopy(ACTUAL)
            self.accepted['run'][key] = {'full_name': 'foreign/repo', 'login': 'foreign'}
            with self.assertRaises(gate.Refused): self.check()
        for key, bad in [('sha', SOURCE), ('tree', {'sha': 'b' * 40})]:
            self.accepted = copy.deepcopy(ACTUAL); self.accepted['commit'][key] = bad
            with self.assertRaises(gate.Refused): self.check()
        for index in (0, 1):
            for key, bad in [('id', 1), ('run_id', CURRENT), ('run_attempt', True), ('head_sha', SOURCE),
                             ('head_branch', 'fork'), ('labels', ['ubuntu-latest', 'self-hosted']), ('conclusion', 'failure')]:
                self.accepted = copy.deepcopy(ACTUAL); self.accepted['jobs']['jobs'][index][key] = bad
                with self.assertRaises(gate.Refused): self.check()

    def test_complete_accepted_step_graph_cannot_be_missing_reordered_or_changed(self):
        for index in (0, 1):
            for operation in ('missing', 'duplicate', 'reorder', 'failure', 'number', 'running'):
                self.accepted = copy.deepcopy(ACTUAL); steps = self.accepted['jobs']['jobs'][index]['steps']
                if operation == 'missing': steps.pop()
                if operation == 'duplicate': steps.append(copy.deepcopy(steps[0]))
                if operation == 'reorder': steps[0], steps[1] = steps[1], steps[0]
                if operation == 'failure': steps[0]['conclusion'] = 'failure'
                if operation == 'number': steps[0]['number'] = True
                if operation == 'running': steps[0]['status'] = 'in_progress'
                with self.assertRaises(gate.Refused): self.check()
        for change in ('count', 'missing', 'duplicate'):
            self.accepted = copy.deepcopy(ACTUAL); value = self.accepted['jobs']
            if change == 'count': value['total_count'] = 3
            if change == 'missing': value['jobs'].pop()
            if change == 'duplicate': value['jobs'][1] = copy.deepcopy(value['jobs'][0])
            with self.assertRaises(gate.Refused): self.check()

    def test_old_release_or_accepted_run_can_never_be_rearmed(self):
        for source in gate.FORBIDDEN_SOURCES:
            with self.assertRaises(gate.Refused):
                gate.validate_gate(ACTUAL['run'], ACTUAL['jobs'], ACTUAL['commit'], self.runs, self.get,
                                   self.log, source, CURRENT, 1)
        for identity in gate.FORBIDDEN_RUNS:
            with self.assertRaises(gate.Refused):
                gate.validate_gate(ACTUAL['run'], ACTUAL['jobs'], ACTUAL['commit'], self.runs, self.get,
                                   self.log, SOURCE, identity, 1)

    def test_inventory_current_attempt_and_each_prior_attempt_are_complete(self):
        self.runs['workflow_runs'] = [run(attempt=3), run(identity=CURRENT + 1, attempt=2, status='completed', conclusion='failure')]
        self.runs['total_count'] = 2
        for identity in (CURRENT, CURRENT + 1):
            for attempt in (1, 2): self.pages[self.page(identity, attempt)] = jobs(attempt, identity)
        self.assertEqual(self.check(3)['mode'], 'fresh')
        self.assertEqual(len(self.reads), 4)
        del self.pages[self.page(CURRENT + 1, 1)]
        with self.assertRaises(gate.Refused): self.check(3)
        for rows, count in [([], 0), ([run(), run()], 2), ([run()], 2), ([run(attempt=2)], 1),
                            ([run(status='completed', conclusion='success')], 1)]:
            self.runs = {'total_count': count, 'workflow_runs': rows}
            with self.assertRaises(gate.Refused): self.check()

    def test_other_active_or_successful_run_cannot_be_replayed(self):
        for status, conclusion in [('in_progress', None), ('completed', 'success'), ('completed', None)]:
            self.runs = {'total_count': 2, 'workflow_runs': [run(), run(CURRENT + 1, status=status, conclusion=conclusion)]}
            with self.assertRaises(gate.Refused): self.check()

    def test_historical_run_provenance_and_job_labels_are_checked_before_resume(self):
        value = self.held()
        for key, bad in [('path', gate.ACCEPTED_PATH), ('head_sha', gate.ACCEPTED_SOURCE), ('head_branch', 'branch'),
                         ('actor', {'login': 'foreign'}), ('run_attempt', True)]:
            self.runs['workflow_runs'] = [run(attempt=2)]; self.runs['workflow_runs'][0][key] = bad
            with self.assertRaises(gate.Refused): self.check(2)
        self.runs['workflow_runs'] = [run(attempt=2)]
        for key, bad in [('labels', ['self-hosted']), ('run_attempt', True), ('head_sha', 'b' * 40),
                         ('run_id', CURRENT + 1), ('id', False)]:
            changed = copy.deepcopy(value); deploy(changed)[key] = bad; self.pages[self.page(CURRENT, 1)] = changed
            with self.assertRaises(gate.Refused): self.check(2)

    def test_held_candidate_requires_same_run_and_fresh_runtime_verification_never_restore(self):
        self.held()
        result = self.check(2)
        self.assertEqual(result['mode'], 'resume_candidate')
        self.assertIs(result['retainedRuntimeVerificationRequired'], True)
        self.assertIs(result['dataRestoreAuthorized'], False)
        self.runs = {'total_count': 2, 'workflow_runs': [run(), run(CURRENT + 1, status='completed', conclusion='failure')]}
        other = jobs(identity=CURRENT + 1, held=True); self.pages[self.page(CURRENT + 1, 1)] = other
        with self.assertRaises(gate.Refused): self.check()

    def test_held_candidate_public_markers_or_postbrowser_execution_are_terminal(self):
        value = self.held(); identity = deploy(value)['id']
        held = self.logs[identity]
        for suffix in ['ARTHELLO_RELEASE_ACTIVE=x', 'ARTHELLO_TOCHKA_AUTOSYNC_ACTIVATION_V2=VERIFIED',
                       'ARTHELLO_D080_CANDIDATE_STATE=PUBLIC_START']:
            self.logs[identity] = held + suffix
            with self.assertRaises(gate.Refused): self.check(2)
        for log in ['', held + held, 'x' * (1048576 + 1)]:
            self.logs[identity] = log
            with self.assertRaises(gate.Refused): self.check(2)
        self.logs[identity] = held
        for conclusion in ('success', 'failure', 'cancelled'):
            step(value, gate.POST_STEP)['conclusion'] = conclusion
            with self.assertRaises(gate.Refused): self.check(2)

    def test_pre_auth_and_post_auth_hold_share_no_restore_permission(self):
        value = self.held(); identity = deploy(value)['id']
        self.logs[identity] += 'ARTHELLO_D080_CANDIDATE_STATE=AUTH_STARTED\nARTHELLO_POST_AUTH_RECOVERY_REQUIRED=1\n'
        self.assertEqual(self.check(2)['mode'], 'resume_candidate')
        self.assertIs(self.check(2)['dataRestoreAuthorized'], False)

    def test_resume_import_skips_require_proven_retained_candidate_and_attempt_greater_than_one(self):
        value = self.held(attempt=2, resumed=True)
        self.assertEqual(self.check(3)['mode'], 'resume_candidate')
        step(value, gate.RESUME_STEP)['conclusion'] = 'skipped'
        with self.assertRaises(gate.Refused): self.check(3)
        value = self.held()
        step(value, gate.RESUME_STEP)['conclusion'] = 'success'
        with self.assertRaises(gate.Refused): self.check(2)

    def test_unknown_step_or_old_step_name_cannot_bypass_frozen_protocol(self):
        for alteration in ('unknown', 'old_cutover', 'old_after', 'duplicate_number'):
            value = self.held()
            if alteration == 'unknown': deploy(value)['steps'].insert(3, {'name': 'extra mutation', 'number': 4, 'status': 'completed', 'conclusion': 'success'})
            if alteration == 'old_cutover': step(value, gate.CUTOVER_STEP)['name'] = 'Clone preflight and guarded production cutover'
            if alteration == 'old_after': step(value, gate.POST_STEP)['name'] = 'School diagnostic and real browser acceptance after cutover'
            if alteration == 'duplicate_number': deploy(value)['steps'][1]['number'] = 1
            with self.assertRaises(gate.Refused): self.check(2)

    def test_skipped_deploy_without_steps_needs_complete_hosted_job_inventory(self):
        self.runs['workflow_runs'] = [run(attempt=2)]
        value = jobs(); deploy(value).update(conclusion='skipped', steps=[])
        self.pages[self.page(CURRENT, 1)] = value
        self.assertEqual(self.check(2)['mode'], 'fresh')
        value['jobs'].pop(0)
        with self.assertRaises(gate.Refused): self.check(2)

    def test_hash_checked_inline_functions_equal_checkout_path_and_reject_one_byte_drift(self):
        original = Path(__file__).with_name('d080-replay-guard.py').read_text()
        names = {'safe_previous_job', 'validate_previous_attempt', 'validate_history', 'validate_candidate_attempt'}
        source = ('\n\n'.join(ast.get_source_segment(original, node) for node in ast.parse(original).body
                             if isinstance(node, ast.FunctionDef) and node.name in names) + '\n').encode()
        self.assertEqual(hashlib.sha256(source).hexdigest(), gate.FROZEN_FUNCTIONS_SHA256)
        self.assertEqual(self.check(frozen_functions=source), self.check())
        with self.assertRaises(gate.Refused): self.check(frozen_functions=source + b'\n')

    def test_arbitrary_log_transport_exception_is_never_exposed(self):
        value = self.held(); self.logs.clear()
        with self.assertRaises(gate.Refused) as caught: self.check(2)
        self.assertNotIn('900000', str(caught.exception))
        self.assertEqual(str(caught.exception), 'HISTORY_EVIDENCE_INVALID')

    def test_inline_gate_needs_no_checkout_file_when_exact_frozen_functions_are_embedded(self):
        namespace = {'__name__': 'r14_inline'}
        exec(compile(path.read_bytes(), '<trusted-workflow-inline>', 'exec'), namespace)
        self.assertNotIn('__file__', namespace)
        original = Path(__file__).with_name('d080-replay-guard.py').read_text()
        names = {'safe_previous_job', 'validate_previous_attempt', 'validate_history', 'validate_candidate_attempt'}
        functions = ('\n\n'.join(ast.get_source_segment(original, node) for node in ast.parse(original).body
                                if isinstance(node, ast.FunctionDef) and node.name in names) + '\n').encode()
        result = namespace['validate_gate'](ACTUAL['run'], ACTUAL['jobs'], ACTUAL['commit'], self.runs,
                                             self.get, self.log, SOURCE, CURRENT, 1, frozen_functions=functions)
        self.assertEqual(result['mode'], 'fresh')
        self.assertEqual(self.reads, [])

class Opener:
    def __init__(self, replies):
        self.replies, self.calls = list(replies), []

    def open(self, request, timeout):
        self.calls.append((request.full_url, dict(request.header_items()), timeout))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception): raise reply
        return io.BytesIO(reply)


class TransportTests(unittest.TestCase):
    def environment(self):
        return {'EXPECTED_REPOSITORY': gate.REPOSITORY, 'GITHUB_REPOSITORY': gate.REPOSITORY,
                'GITHUB_ACTOR': gate.OWNER, 'GITHUB_TRIGGERING_ACTOR': gate.OWNER,
                'GITHUB_EVENT_NAME': 'workflow_run', 'RELEASE_SHA': SOURCE,
                'GITHUB_RUN_ID': str(CURRENT), 'GITHUB_RUN_ATTEMPT': '1', 'GH_TOKEN': 'synthetic-private-token'}

    def test_cli_context_is_exact_and_old_releases_cannot_be_selected(self):
        good = self.environment()
        self.assertEqual(gate.cli_context(good), (SOURCE, CURRENT, 1))
        for key in good:
            if key == 'GH_TOKEN': continue
            bad = dict(good); bad[key] = 'foreign'
            with self.assertRaises(gate.Refused): gate.cli_context(bad)
        for attempt in ('0', '51', '1.0', '+1'):
            bad = dict(good); bad['GITHUB_RUN_ATTEMPT'] = attempt
            with self.assertRaises(gate.Refused): gate.cli_context(bad)

    def test_json_is_bounded_and_duplicate_keys_are_refused(self):
        path = '/actions/runs/' + str(gate.ACCEPTED_RUN)
        for raw in (b'{"id":1,"id":2}', b'x' * (2 * 1048576 + 1)):
            evidence = gate.GitHubEvidence('synthetic-token', SOURCE, CURRENT, 1, Opener([raw]))
            with self.assertRaises(gate.Refused): evidence.get(path)
        opener = Opener([]); evidence = gate.GitHubEvidence('synthetic-token', SOURCE, CURRENT, 1, opener)
        with self.assertRaises(gate.Refused): evidence.get('/repos/foreign/secret')
        self.assertEqual(opener.calls, [])

    def test_only_current_run_prior_deploy_logs_are_readable(self):
        value = jobs(1); opener = Opener([json.dumps(value).encode(), b'safe-log'])
        evidence = gate.GitHubEvidence('synthetic-token', SOURCE, CURRENT, 2, opener)
        with self.assertRaises(gate.Refused): evidence.logs(deploy(value)['id'])
        evidence.get(f'/actions/runs/{CURRENT}/attempts/1/jobs?per_page=100')
        with self.assertRaises(gate.Refused): evidence.logs(value['jobs'][0]['id'])
        self.assertEqual(evidence.logs(deploy(value)['id']), 'safe-log')
        self.assertEqual(len(opener.calls), 2)
        self.assertTrue(all(call[2] == 20 for call in opener.calls))

    def test_log_redirect_is_fixed_https_blob_and_never_forwards_token(self):
        url = 'https://example.blob.core.windows.net/short-lived?sig=synthetic'
        redirect = urllib.error.HTTPError('https://api.github.com/example', 302, 'redirect', {'Location': url}, None)
        opener = Opener([redirect, b'held']); evidence = gate.GitHubEvidence('synthetic-token', SOURCE, CURRENT, 2, opener)
        evidence.log_jobs.add(42)
        self.assertEqual(evidence.logs(42), 'held')
        self.assertIn('Authorization', opener.calls[0][1])
        self.assertEqual(opener.calls[1][1], {})
        for url in ('http://example.blob.core.windows.net/x', 'https://example.com/x',
                    'https://example.blob.core.windows.net.evil.test/x', 'https://user:pass@example.blob.core.windows.net/x',
                    'https://example.blob.core.windows.net:8443/x', 'https://example.blob.core.windows.net/x#fragment'):
            opener = Opener([urllib.error.HTTPError('https://api.github.com/example', 302, 'redirect', {'Location': url}, None)])
            evidence = gate.GitHubEvidence('synthetic-token', SOURCE, CURRENT, 2, opener); evidence.log_jobs.add(42)
            with self.assertRaises(gate.Refused): evidence.logs(42)
            self.assertEqual(len(opener.calls), 1)

    def test_no_second_redirect_or_oversize_log_and_request_budget_is_finite(self):
        first = urllib.error.HTTPError('https://api.github.com/example', 302, 'redirect',
                                      {'Location': 'https://example.blob.core.windows.net/x'}, None)
        second = urllib.error.HTTPError('https://example.blob.core.windows.net/x', 302, 'redirect',
                                       {'Location': 'https://foreign.example/x'}, None)
        evidence = gate.GitHubEvidence('synthetic-token', SOURCE, CURRENT, 2, Opener([first, second])); evidence.log_jobs.add(42)
        with self.assertRaises(urllib.error.HTTPError): evidence.logs(42)
        evidence = gate.GitHubEvidence('synthetic-token', SOURCE, CURRENT, 2, Opener([b'x' * (1048576 + 1)])); evidence.log_jobs.add(42)
        with self.assertRaises(gate.Refused): evidence.logs(42)
        evidence.requests = 128
        with self.assertRaises(gate.Refused): evidence.logs(42)

    def test_complete_cli_reads_metadata_only_for_fresh_run_and_prints_bounded_receipt(self):
        replies = [ACTUAL['run'], ACTUAL['jobs'], ACTUAL['commit'], {'total_count': 1, 'workflow_runs': [run()]}]
        opener = Opener([json.dumps(value).encode() for value in replies])
        evidence = gate.GitHubEvidence('synthetic-token', SOURCE, CURRENT, 1, opener)
        output = io.StringIO()
        with patch.dict(gate.os.environ, self.environment(), clear=True), patch.object(sys, 'argv', ['history']), \
             patch.object(gate, 'GitHubEvidence', return_value=evidence), patch('sys.stdout', output):
            self.assertEqual(gate.main(), 0)
        result = json.loads(output.getvalue())
        self.assertEqual(result['mode'], 'fresh'); self.assertIs(result['dataRestoreAuthorized'], False)
        self.assertEqual(len(opener.calls), 4)
        self.assertNotIn('synthetic', output.getvalue()); self.assertNotIn('token', output.getvalue())

    def test_cli_never_prints_exception_text_and_rejects_generic_arguments(self):
        output = io.StringIO()
        with patch.dict(gate.os.environ, self.environment(), clear=True), patch.object(sys, 'argv', ['history']), \
             patch.object(gate, 'GitHubEvidence', side_effect=RuntimeError('synthetic-private-secret')), patch('sys.stdout', output):
            self.assertEqual(gate.main(), 2)
        self.assertNotIn('synthetic', output.getvalue())
        self.assertEqual(json.loads(output.getvalue())['code'], 'HISTORY_EVIDENCE_UNAVAILABLE')
        output = io.StringIO()
        with patch.object(sys, 'argv', ['history', '--target=foreign']), patch('sys.stdout', output):
            self.assertEqual(gate.main(), 2)
        self.assertEqual(json.loads(output.getvalue())['code'], 'HISTORY_ARGUMENTS_NOT_ALLOWED')


if __name__ == '__main__':
    unittest.main()
