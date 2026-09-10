"""Synthetic subprocess harness for the D075 launcher; no real Docker or database."""
import json
import copy
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = 'a' * 40
LIVE = 'b' * 64
IMAGE = 'sha256:' + 'c' * 64
TABLES = ('app_users app_systems organization_branches user_system_access user_branch_access '
          'bank_accounts bank_statement_imports bank_transactions financial_operations '
          'developer_feedback developer_feedback_events integration_connections integration_sync_runs '
          'alfacrm_finance_snapshots alfacrm_family_merge_candidates').split()
CHECKS = ('bankLinks accessUsers accessSystems branchUsers branchTargets feedbackAuthors '
          'feedbackEvents importConnections').split()

# Already-sanitized D088 observation, run 34330892606/job 102398954685.
# The new D091 status/update fields in the regression are synthetic test inputs.
D088_REPORT = json.loads(r'''
{
  "bankRuntime": {
    "autosync": {
      "failures": 2,
      "generationMatchesSetup": true,
      "leaseState": "released",
      "leasedUntilUtc": null,
      "nextAtUtc": "2026-09-09T09:01:16.902Z",
      "outcome": "error",
      "state": "observed",
      "updatedAgeSeconds": 888
    },
    "connection": {
      "enabled": true,
      "nextSyncAtUtc": "2026-09-09T09:01:16.902Z",
      "state": "observed",
      "status": "connection_error"
    },
    "latestRun": {
      "finishedAtUtc": "2026-09-09T08:11:14.266Z",
      "startedAtUtc": "2026-09-09T08:11:14.266Z",
      "state": "observed"
    },
    "observedAtUtc": "2026-09-09T08:46:04.026Z",
    "retainedJobs": {
      "exactWindowRows": 4,
      "invalidRows": 0,
      "olderEndRows": 0,
      "oldestAgeSeconds": 2102,
      "otherWindowRows": 0,
      "providerStatus": "not_stored",
      "scopeMatch": "unverified",
      "state": "observed",
      "total": 4
    },
    "setup": {
      "startDate": "2026-09-01",
      "state": "observed",
      "syncIntervalMinutes": 60,
      "syncMinute": 5
    },
    "state": "observed",
    "statementImports": {
      "failedRows": 0,
      "pendingRows": 0,
      "readyRows": 12,
      "state": "observed",
      "unknownRows": 0
    },
    "statementLease": {
      "expiresAtUtc": null,
      "leaseState": "unknown",
      "state": "not_observed"
    }
  },
  "bankWindow": {
    "activity": "not_observed",
    "checksComplete": false,
    "coverage": {
      "accountRows": 4,
      "accountsWithContainingStatementInLatestRun": 0,
      "accountsWithMatchingTransactionCount": 1,
      "accountsWithStatement": 4,
      "coveredInLatestRun": 0,
      "distinctAccountKeys": 4,
      "invalidAccountKeys": 0,
      "legalEntities": 1
    },
    "duplicates": {
      "excessRows": 0,
      "groups": 0,
      "missingIdentityRows": 0
    },
    "period": {
      "endDate": "2026-09-09",
      "startDate": "2026-09-01"
    },
    "state": "observed",
    "sync": {
      "conflictRows": 0,
      "errorRows": 0,
      "freshness": "not_requested",
      "rejectedRows": 0,
      "state": "pending"
    },
    "transactions": {
      "danglingLinks": 0,
      "eligibleMissingLinks": 0,
      "eligibleRows": 0,
      "expenseRows": 0,
      "incomeRows": 0,
      "pendingOrNonRub": 0,
      "rows": 0,
      "unexpectedAccountRows": 0
    }
  },
  "checks": {
    "accessSystems": {
      "state": "observed",
      "violations": 0
    },
    "accessUsers": {
      "state": "observed",
      "violations": 0
    },
    "bankLinks": {
      "state": "observed",
      "violations": 0
    },
    "branchTargets": {
      "state": "observed",
      "violations": 0
    },
    "branchUsers": {
      "state": "observed",
      "violations": 0
    },
    "feedbackAuthors": {
      "state": "schema_missing"
    },
    "feedbackEvents": {
      "state": "schema_missing"
    },
    "importConnections": {
      "state": "observed",
      "violations": 0
    }
  },
  "liveAcceptance": "not_run",
  "observedAtUtc": "2026-09-09T08:46:04.026Z",
  "productionMutations": false,
  "schemaVersion": 1,
  "status": "incomplete_or_issues",
  "tables": {
    "alfacrm_family_merge_candidates": {
      "state": "not_installed"
    },
    "alfacrm_finance_snapshots": {
      "state": "not_installed"
    },
    "app_systems": {
      "rows": 2,
      "state": "observed"
    },
    "app_users": {
      "rows": 7,
      "state": "observed"
    },
    "bank_accounts": {
      "rows": 4,
      "state": "observed"
    },
    "bank_statement_imports": {
      "rows": 12,
      "state": "observed"
    },
    "bank_transactions": {
      "rows": 0,
      "state": "observed"
    },
    "developer_feedback": {
      "state": "not_installed"
    },
    "developer_feedback_events": {
      "state": "not_installed"
    },
    "financial_operations": {
      "rows": 0,
      "state": "observed"
    },
    "integration_connections": {
      "rows": 19,
      "state": "observed"
    },
    "integration_sync_runs": {
      "rows": 7,
      "state": "observed"
    },
    "organization_branches": {
      "rows": 5,
      "state": "observed"
    },
    "user_branch_access": {
      "rows": 2,
      "state": "observed"
    },
    "user_system_access": {
      "rows": 14,
      "state": "observed"
    }
  }
}
''')



def report(complete=True):
    """Representative aggregate outputs; this harness never opens a database."""
    value = dict(schemaVersion=1, liveAcceptance='not_run', productionMutations=False,
                 observedAtUtc='2026-09-09T09:00:00.000Z',
                 status='bounded_checks_complete' if complete else 'incomplete_or_issues',
                 tables={name: dict(state='observed', rows=0) for name in TABLES},
                 checks={name: dict(state='observed', violations=0) for name in CHECKS})
    value['tables']['bank_accounts']['rows'] = 4
    value['tables']['bank_statement_imports']['rows'] = 12
    value['tables']['bank_transactions']['rows'] = 2 if complete else 0
    value['tables']['financial_operations']['rows'] = 2 if complete else 0
    value['bankWindow'] = dict(
        state='observed', period=dict(startDate='2026-09-01', endDate='2026-09-09'),
        sync=dict(state='complete' if complete else 'pending', freshness='not_requested',
                  rejectedRows=0, errorRows=0, conflictRows=0),
        coverage=dict(accountRows=4, distinctAccountKeys=4, legalEntities=1, invalidAccountKeys=0,
                      accountsWithStatement=4, coveredInLatestRun=4 if complete else 0,
                      accountsWithContainingStatementInLatestRun=4 if complete else 0,
                      accountsWithMatchingTransactionCount=4 if complete else 0),
        transactions=dict(rows=2 if complete else 0, eligibleRows=2 if complete else 0,
                          incomeRows=1 if complete else 0, expenseRows=1 if complete else 0,
                          eligibleMissingLinks=0, danglingLinks=0, pendingOrNonRub=0,
                          unexpectedAccountRows=0, incomeAmountMinor=100000 if complete else 0,
                          expenseAmountMinor=40000 if complete else 0, linkedIncomeAmountMinor=100000 if complete else 0,
                          linkedExpenseAmountMinor=40000 if complete else 0, linkedFinancialRows=2 if complete else 0, financialMismatchRows=0),
        duplicates=dict(groups=0, excessRows=0, missingIdentityRows=0),
        activity='observed' if complete else 'not_observed', checksComplete=complete)
    value['bankRuntime'] = dict(
        state='observed', observedAtUtc=value['observedAtUtc'],
        setup=dict(state='observed', startDate='2026-09-01', syncIntervalMinutes=60, syncMinute=0),
        connection=dict(state='observed', status='forming_statements', enabled=True,
                        nextSyncAtUtc='2026-09-09T09:30:00.000Z'),
        autosync=dict(state='observed', outcome='pending', generationMatchesSetup=True,
                      nextAtUtc='2026-09-09T09:30:00.000Z', leasedUntilUtc=None,
                      leaseState='released', failures=0, updatedAgeSeconds=120,
                      httpStatus=200, httpStatusState='observed', updatedAtUtc='2026-09-09T08:58:00.000Z',
                      failureStage=None, failureStageState='missing', commitFailureKind=None, commitFailureKindState='missing'),
        statementLease=dict(state='not_observed', expiresAtUtc=None, leaseState='unknown'),
        retainedJobs=dict(state='observed', scopeMatch='unverified', providerStatus='not_stored',
                          total=4, invalidRows=0, exactWindowRows=0, olderEndRows=4,
                          otherWindowRows=0, oldestAgeSeconds=3600),
        statementImports=dict(state='observed', readyRows=0, pendingRows=12, failedRows=0, unknownRows=0),
        latestRun=dict(state='observed', startedAtUtc='2026-09-09T08:58:00.000Z',
                       finishedAtUtc='2026-09-09T08:58:01.000Z',
                       status='complete' if complete else 'pending', failureKind=None))
    return value


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='readonly-launcher-test-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.log = self.directory / 'commands.jsonl'
        program = r'''
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
log = pathlib.Path(os.environ['D075_TEST_LOG'])
with log.open('a') as stream:
    stream.write(json.dumps([name, args]) + '\n')
if name == 'python3':
    if args[:2] == ['-I', '-c']:
        os.execv(sys.executable, [sys.executable, *args])
    previous = [json.loads(line) for line in log.read_text().splitlines()]
    count = sum(item[0] == 'python3' and 'scripts/production-data-consumers.py' in item[1] for item in previous)
    mode = os.environ.get('D075_TEST_MODE', '')
    if mode == 'initial-refusal' or mode == 'final-refusal' and count == 2:
        print('READONLY_BLOCKED=accepted_runtime_identity', file=sys.stderr)
        raise SystemExit(2)
    print(json.dumps(dict(liveId='b'*64,imageId='sha256:'+'c'*64,sourceSha='a'*40,
                         backupId=('f' if mode == 'final-drift' and count == 2 else 'd')*64), separators=(',', ':')))
elif name == 'precheck-node':
    print('d1/miniflare-D1DatabaseObject/' + 'e'*64 + '.sqlite')
elif name == 'docker':
    if args[0] == 'inspect':
        raise SystemExit(1)  # This invocation owns no previous temporary helper.
    if args[0] == 'exec':
        sys.stdin.read()
    elif args[0] == 'run':
        sys.stdin.read()
        if os.environ.get('D075_TEST_MODE') == 'nul':
            sys.stdout.buffer.write(b'\0')
        sys.stdout.buffer.write(os.environ['D075_TEST_REPORT'].encode())
        print('UNSAFE_STDERR_SENTINEL', file=sys.stderr)
        raise SystemExit(int(os.environ['D075_TEST_PROBE_EXIT']))
    else:
        raise SystemExit('unexpected Docker capability')
else:
    raise SystemExit('unexpected executable')
'''
        for name in ('python3', 'precheck-node', 'docker'):
            path = self.directory / name
            path.write_text('#!' + sys.executable + '\n' + program)
            path.chmod(0o700)
        self.environment = {
            **os.environ, 'PATH': str(self.directory) + ':' + os.environ['PATH'],
            'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1',
            'EXPECTED_LIVE_SOURCE_SHA': SOURCE, 'PRECHECK_NODE': str(self.directory / 'precheck-node'),
            'D075_TEST_LOG': str(self.log),
        }

    def run_launcher(self, mode='', value=None, probe_exit=0):
        value = report() if value is None else value
        return subprocess.run(['bash', 'scripts/run-production-readonly.sh'], cwd=ROOT,
                              env={**self.environment, 'D075_TEST_MODE': mode,
                                   'D075_TEST_REPORT': json.dumps(value) if isinstance(value, dict) else value,
                                   'D075_TEST_PROBE_EXIT': str(probe_exit)},
                              capture_output=True, text=True, timeout=10)

    def commands(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def observations(self):
        return [index for index, (name, args) in enumerate(self.commands())
                if name == 'python3' and 'scripts/production-data-consumers.py' in args]

    def assert_blocked(self, result, reason):
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('READONLY_BLOCKED=' + reason, result.stdout)
        self.assertNotIn('READONLY_FINISHED=', result.stdout)
        self.assertNotIn('READONLY_RESULT=', result.stdout)
        self.assertNotIn('UNSAFE_', result.stdout + result.stderr)

    def test_verified_pair_is_checked_before_and_after_only_readonly_probe(self):
        result = self.run_launcher()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.commands()
        observations = self.observations()
        probes = [(index, args) for index, (name, args) in enumerate(calls) if name == 'docker' and args[0] == 'run']
        self.assertEqual(len(observations), 2)
        self.assertEqual(len(probes), 1)
        index, args = probes[0]
        self.assertLess(observations[0], index)
        self.assertGreater(observations[1], index)
        self.assertEqual(args[args.index('--user') + 1], '1000:1000')
        self.assertEqual(args[args.index('--network') + 1], 'none')
        self.assertEqual(args[args.index('--cap-drop') + 1], 'ALL')
        self.assertEqual(args[args.index('--security-opt') + 1], 'no-new-privileges:true')
        for flag, expected in (('--pids-limit', '32'), ('--memory', '192m'), ('--cpus', '0.25'), ('--pull', 'never')):
            self.assertEqual(args[args.index(flag) + 1], expected)
        self.assertIn('--read-only', args)
        mounts = [args[i + 1] for i, value in enumerate(args) if value == '--mount']
        self.assertEqual(mounts, ['type=volume,src=arthello-direct-v44-data,dst=/data,readonly,volume-nocopy'])
        self.assertEqual(args[args.index('--entrypoint') + 2], IMAGE)
        self.assertFalse(any(value in args for value in ('--env-file', '--privileged', '--volume', '-v', '--pid', '--ipc')))
        self.assertIn('READONLY_FINISHED=aggregate_observation_not_live_acceptance', result.stdout)
        self.assertIn('READONLY_RESULT=bounded_checks_complete', result.stdout)
        self.assertIn('exact_readonly_consumer_history_not_verified', result.stdout)
        self.assertEqual([json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')], [report()])
        self.assertNotIn('UNSAFE_', result.stdout + result.stderr)

    def test_actual_pending_empty_bank_report_finishes_observation_but_preserves_issue_exit(self):
        value = report(False)
        result = self.run_launcher(value=value, probe_exit=2)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(len(self.observations()), 2)
        self.assertIn('READONLY_RESULT=incomplete_or_issues', result.stdout)
        self.assertIn('READONLY_FINISHED=aggregate_observation_not_live_acceptance', result.stdout)
        self.assertNotIn('READONLY_BLOCKED=', result.stdout)
        self.assertEqual([json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')], [value])

    def test_incomplete_schema_report_also_rechecks_consumers(self):
        value = report(False)
        value['tables']['bank_accounts'] = dict(state='not_installed')
        value['bankWindow'] = dict(state='schema_missing', checksComplete=False)
        result = self.run_launcher(value=value, probe_exit=2)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(len(self.observations()), 2)
        self.assertIn('READONLY_RESULT=incomplete_or_issues', result.stdout)
        self.assertIn('READONLY_FINISHED=', result.stdout)

    def test_source_blocked_report_is_distinct_from_execution_failure(self):
        value = dict(schemaVersion=1, status='blocked', reason='readonly_source_unavailable',
                     liveAcceptance='not_run', productionMutations=False)
        result = self.run_launcher(value=value, probe_exit=2)
        self.assert_blocked(result, 'readonly_source_unavailable')
        self.assertEqual(len(self.observations()), 1)
        self.assertIn('"status":"blocked"', result.stdout)

    def test_timeout_and_execution_failure_never_accept_even_complete_json(self):
        for code, reason in ((124, 'probe_timed_out'), (7, 'probe_failed'), (137, 'probe_failed')):
            with self.subTest(code=code):
                result = self.run_launcher(probe_exit=code)
                self.assert_blocked(result, reason)
                self.assertNotIn('{', result.stdout)

    def test_exit_and_report_status_must_agree(self):
        for value, code in ((report(), 2), (report(False), 0)):
            with self.subTest(code=code):
                self.assert_blocked(self.run_launcher(value=value, probe_exit=code), 'invalid_probe_report')

    def test_malformed_or_unexpected_content_cannot_reach_logs(self):
        valid = json.dumps(report())
        wrong_count = copy.deepcopy(report())
        wrong_count['tables']['bank_accounts']['rows'] = 'UNSAFE_ACCOUNT_ID'
        unknown = copy.deepcopy(report())
        unknown['bankWindow']['rawAccount'] = 'UNSAFE_ACCOUNT_ID'
        duplicate = valid.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1')
        for value in ('UNSAFE_RAW_NOT_JSON', valid + '\n' + valid, valid[:-2], duplicate,
                      wrong_count, unknown, valid + '\nD075_PROBE_EXIT=0\nUNSAFE_TRAILER'):
            with self.subTest(value=str(value)[:40]):
                result = self.run_launcher(value=value)
                self.assert_blocked(result, 'invalid_probe_report')
                self.assertNotIn('{', result.stdout)

    def test_nul_bytes_are_rejected_before_bash_can_drop_them(self):
        self.assert_blocked(self.run_launcher('nul'), 'invalid_probe_report')

    def test_oversize_output_is_bounded_and_never_published(self):
        result = self.run_launcher(value=json.dumps(report()) + ' ' * 33000 + 'UNSAFE_SUFFIX')
        self.assert_blocked(result, 'probe_output_limit')
        self.assertLess(len(result.stdout), 500)

    def test_non_numeric_or_unsafe_numeric_counts_are_rejected(self):
        for count in (True, -1, 1.5, 9007199254740992, float('nan'), float('inf')):
            with self.subTest(count=count):
                value = report()
                value['bankWindow']['coverage']['accountRows'] = count
                self.assert_blocked(self.run_launcher(value=value), 'invalid_probe_report')

    def test_runtime_metadata_is_fixed_and_sanitized_without_changing_completion(self):
        value = report()
        value['bankRuntime']['state'] = 'partial'
        value['bankRuntime']['setup'] = dict(state='schema_missing', startDate=None,
                                             syncIntervalMinutes=None, syncMinute=None)
        result = self.run_launcher(value=value)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('READONLY_RESULT=bounded_checks_complete', result.stdout)
        self.assertEqual([json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')], [value])
        for component, key, raw in (('retainedJobs', 'providerJobId', 'UNSAFE_JOB_ID'),
                                    ('autosync', 'outcome', 'UNSAFE_OUTCOME'),
                                    ('connection', 'nextSyncAtUtc', 'UNSAFE_TIMESTAMP'),
                                    ('retainedJobs', 'total', True)):
            with self.subTest(component=component, key=key):
                invalid = report()
                invalid['bankRuntime'][component][key] = raw
                self.assert_blocked(self.run_launcher(value=invalid), 'invalid_probe_report')

    def test_callback_http_status_quality_is_explicit_without_changing_issue_exit(self):
        for state, status in (('observed', 100), ('observed', 500), ('observed', 599),
                              ('missing', None), ('invalid', None)):
            with self.subTest(state=state, status=status):
                value = report(False)
                value['bankRuntime']['autosync'].update(httpStatus=status, httpStatusState=state)
                result = self.run_launcher(value=value, probe_exit=2)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn('READONLY_RESULT=incomplete_or_issues', result.stdout)
                self.assertIn('READONLY_FINISHED=', result.stdout)
                self.assertEqual([json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')], [value])

    def test_callback_status_schema_rejects_inconsistent_or_unsafe_pairs(self):
        cases = [('observed', None), ('missing', 500), ('invalid', 500),
                 (None, None), ('UNSAFE_STATUS', None)]
        cases += [('observed', value) for value in (True, '500', 'UNSAFE_HTTP_STATUS', 500.0, 500.5, 99, 600)]
        for state, status in cases:
            with self.subTest(state=state, status=status):
                value = report(False)
                value['bankRuntime']['autosync'].update(httpStatus=status, httpStatusState=state)
                self.assert_blocked(self.run_launcher(value=value, probe_exit=2), 'invalid_probe_report')
        value = report(False)
        value['bankRuntime']['autosync']['updatedAtUtc'] = 'UNSAFE_TIMESTAMP'
        self.assert_blocked(self.run_launcher(value=value, probe_exit=2), 'invalid_probe_report')

    def test_actual_d088_observation_accepts_only_the_new_status_fields_and_stays_incomplete(self):
        for state, status in (('observed', 500), ('missing', None), ('invalid', None)):
            with self.subTest(state=state):
                if self.log.exists():
                    self.log.unlink()
                value = copy.deepcopy(D088_REPORT)
                for name in 'incomeAmountMinor expenseAmountMinor linkedIncomeAmountMinor linkedExpenseAmountMinor linkedFinancialRows financialMismatchRows'.split():
                    value['bankWindow']['transactions'][name]=0
                # Synthetic values exercise D091 transport; D088 did not observe these fields.
                value['bankRuntime']['autosync'].update(httpStatus=status, httpStatusState=state,
                                                       updatedAtUtc='2026-09-09T08:31:16.000Z', failureStage=None, failureStageState='missing', commitFailureKind=None, commitFailureKindState='missing')
                # Synthetic current-schema extension; keep the historical D088 receipt unchanged.
                value['bankRuntime']['latestRun'].update(status='pending', failureKind=None)
                result = self.run_launcher(value=value, probe_exit=2)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertEqual(len(self.observations()), 2)
                self.assertIn('READONLY_RESULT=incomplete_or_issues', result.stdout)
                self.assertIn('READONLY_FINISHED=', result.stdout)
                observed = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
                self.assertEqual(observed, [value])
                for key in ('httpStatus', 'httpStatusState', 'updatedAtUtc', 'failureStage', 'failureStageState', 'commitFailureKind', 'commitFailureKindState'):
                    del observed[0]['bankRuntime']['autosync'][key]
                for name in 'incomeAmountMinor expenseAmountMinor linkedIncomeAmountMinor linkedExpenseAmountMinor linkedFinancialRows financialMismatchRows'.split():
                    del observed[0]['bankWindow']['transactions'][name]
                for key in ('status', 'failureKind'):
                    del observed[0]['bankRuntime']['latestRun'][key]
                self.assertEqual(observed[0], D088_REPORT)

    def test_lexical_failure_stage_passes_only_the_fixed_enum_and_final_identity_check(self):
        stages = ('setup_references', 'credential_read', 'statement_state_open', 'bank_sync',
                  'statement_fence', 'sync_commit', 'statement_acknowledge', 'statement_release',
                  'sync_callback', 'response_decode', 'response_result')
        for stage, state in [(item, 'observed') for item in stages] + [(None, 'missing'), (None, 'invalid')]:
            with self.subTest(stage=stage, state=state):
                if self.log.exists():
                    self.log.unlink()
                value = report(False)
                value['bankRuntime']['autosync'].update(outcome='error', failureStage=stage, failureStageState=state)
                result = self.run_launcher(value=value, probe_exit=2)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertEqual(len(self.observations()), 2)
                self.assertIn('READONLY_FINISHED=', result.stdout)
                self.assertEqual([json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')], [value])

    def test_failure_stage_schema_refuses_raw_error_data_and_inconsistent_observations(self):
        cases = [('observed', stage, 'error') for stage in (None, True, 500, [], {}, 'PRIVATE-ERROR', 'bank_sync\nPRIVATE-ERROR')]
        cases += [('missing', 'bank_sync', 'error'), ('invalid', 'bank_sync', 'error'),
                  ('PRIVATE-STATE', None, 'error'), (None, None, 'error')]
        cases += [('observed', 'bank_sync', outcome) for outcome in ('pending', 'complete', 'busy', 'running')]
        for state, stage, outcome in cases:
            with self.subTest(state=state, stage=stage, outcome=outcome):
                value = report(False)
                value['bankRuntime']['autosync'].update(outcome=outcome, failureStage=stage, failureStageState=state)
                self.assert_blocked(self.run_launcher(value=value, probe_exit=2), 'invalid_probe_report')

    def test_commit_failure_kind_is_checked_before_any_report_is_emitted(self):
        for kind in ['provider_identity', 'transaction_identity', 'unique_constraint', 'required_value', 'foreign_key', 'check_constraint', 'schema', 'binding_type', 'query_limit', 'database_busy', 'storage_full', 'database_readonly', 'storage_error', 'other']:
            value=report(False)
            value['bankRuntime']['autosync'].update(outcome='error',failureStage='sync_commit',failureStageState='observed',commitFailureKind=kind,commitFailureKindState='observed')
            result=self.run_launcher(value=value,probe_exit=2)
            self.assertEqual(result.returncode,2,result.stderr)
            self.assertIn('READONLY_FINISHED=',result.stdout)
        for kind,state,stage,outcome in [('PRIVATE_ERROR','observed','sync_commit','error'),
             ({'message':'PRIVATE_ERROR'},'observed','sync_commit','error'),
             ('schema','missing','sync_commit','error'),('schema','observed','bank_sync','error'),
             ('schema','observed','sync_commit','complete')]:
            value=report(False)
            value['bankRuntime']['autosync'].update(outcome=outcome,failureStage=stage,failureStageState='observed',commitFailureKind=kind,commitFailureKindState=state)
            result=self.run_launcher(value=value,probe_exit=2)
            self.assert_blocked(result,'invalid_probe_report')
            self.assertNotIn('PRIVATE_ERROR',result.stdout+result.stderr)

    def test_manual_result_schema_accepts_fixed_failure_and_refuses_payload_or_inconsistent_status(self):
        value = report(False)
        value['bankRuntime']['latestRun'].update(status='error', failureKind='statement_read_unclassified')
        result = self.run_launcher(value=value, probe_exit=2)
        self.assertIn('READONLY_FINISHED=aggregate_observation_not_live_acceptance', result.stdout)
        for change in ({'failureKind': 'UNSAFE_BANK_BODY'}, {'status': 'UNSAFE_STATUS'},
                       {'status': 'complete'}, {'failureKind': None}, {'httpStatus': 404}):
            invalid = copy.deepcopy(value)
            invalid['bankRuntime']['latestRun'].update(change)
            result = self.run_launcher(value=invalid, probe_exit=2)
            self.assertNotIn('READONLY_FINISHED=', result.stdout)
            self.assertNotIn('UNSAFE_', result.stdout)
            self.assertNotIn('"bankRuntime"', result.stdout)

    def test_money_fields_cannot_claim_completion_with_inconsistent_totals(self):
        for field,val in [('incomeAmountMinor',-1),('expenseAmountMinor',1.5),
                          ('linkedIncomeAmountMinor','PRIVATE_MONEY'),('financialMismatchRows',1),
                          ('linkedFinancialRows',1),('linkedIncomeAmountMinor',99999)]:
            value=report(True);value['bankWindow']['transactions'][field]=val
            result=self.run_launcher(value=value,probe_exit=0)
            self.assert_blocked(result,'invalid_probe_report')
            self.assertNotIn('PRIVATE_MONEY',result.stdout+result.stderr)

    def test_commit_schema_passes_only_known_column_names_and_bounded_metadata(self):
        schema = dict(state='partial', tables={name: dict(state='schema_missing') for name in
            ('bank_accounts', 'bank_statement_imports', 'bank_transactions', 'financial_operations',
             'integration_sync_runs', 'integration_log_entries', 'audit_events')})
        schema['tables']['bank_transactions'] = dict(state='observed', missingColumns=['payment_id'],
            primaryKeyMatches=True, providerIndex='matched', unexpectedRequiredColumns=0,
            foreignKeyRows=0, triggerRows=0, uniqueIndexCount=2)
        value = report(False)
        value['bankCommitSchema'] = schema
        result = self.run_launcher(value=value, probe_exit=2)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('READONLY_FINISHED=', result.stdout)
        self.assertEqual([json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')], [value])
        for key, raw in [('missingColumns', ['PRIVATE_COLUMN']), ('missingColumns', ['id', 'id']),
                         ('missingColumns', [True]), ('primaryKeyMatches', 'true'),
                         ('foreignKeyRows', 129), ('uniqueIndexCount', True),
                         ('providerIndex', 'PRIVATE_INDEX'), ('rawError', 'PRIVATE_ERROR')]:
            invalid = copy.deepcopy(value)
            invalid['bankCommitSchema']['tables']['bank_transactions'][key] = raw
            self.assert_blocked(self.run_launcher(value=invalid, probe_exit=2), 'invalid_probe_report')
        invalid = copy.deepcopy(value)
        invalid['bankCommitSchema']['state'] = 'observed'
        self.assert_blocked(self.run_launcher(value=invalid, probe_exit=2), 'invalid_probe_report')


    def test_unverified_source_never_runs_identity_scan_or_database_probe(self):
        result = self.run_launcher('initial-refusal')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(name == 'docker' and args[0] in ('run', 'exec') for name, args in self.commands()))
        self.assertNotIn('READONLY_FINISHED=', result.stdout)

    def test_final_identity_refusal_cannot_emit_finished(self):
        result = self.run_launcher('final-refusal')
        self.assert_blocked(result, 'final_runtime_identity')
        self.assertEqual(sum(name == 'docker' and args[0] == 'run' for name, args in self.commands()), 1)
        self.assertNotIn('{', result.stdout)

    def test_incomplete_report_requires_unchanged_final_consumers(self):
        for mode in ('final-refusal', 'final-drift'):
            with self.subTest(mode=mode):
                if self.log.exists():
                    self.log.unlink()
                result = self.run_launcher(mode, value=report(False), probe_exit=2)
                self.assert_blocked(result, 'final_runtime_identity')
                self.assertEqual(len(self.observations()), 2)
                self.assertNotIn('{', result.stdout)

    def test_complete_report_cannot_finish_after_consumer_drift(self):
        self.assert_blocked(self.run_launcher('final-drift'), 'final_runtime_identity')

    def test_no_expected_accepted_release_never_calls_docker(self):
        del self.environment['EXPECTED_LIVE_SOURCE_SHA']
        result = self.run_launcher()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.commands(), [])


if __name__ == '__main__':
    unittest.main()
