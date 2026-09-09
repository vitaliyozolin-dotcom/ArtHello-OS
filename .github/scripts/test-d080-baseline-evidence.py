import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('baseline', Path(__file__).with_name('d080-baseline-evidence.py'))
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)


class BaselineTests(unittest.TestCase):
    def setUp(self):
        self.run = dict(id=baseline.RUN, head_sha=baseline.SOURCE, run_attempt=1,
                        path=baseline.WORKFLOW, event='workflow_run', head_branch='main',
                        status='completed', conclusion='failure',
                        repository=dict(full_name=baseline.REPOSITORY),
                        head_repository=dict(full_name=baseline.REPOSITORY),
                        actor=dict(login='vitaliyozolin-dotcom'),
                        triggering_actor=dict(login='vitaliyozolin-dotcom'))
        self.jobs = dict(total_count=2, jobs=[
            dict(name=name, id=identity, run_id=baseline.RUN, head_sha=baseline.SOURCE,
                 run_attempt=1, status='completed', conclusion=conclusion,
                 steps=[dict(name='Run dedicated employee natural login and diary navigation',
                             status='completed', conclusion='failure')] if name == 'natural-browser' else [])
            for name, identity, conclusion in [('bundle', baseline.BUNDLE, 'success'),
                                               ('natural-browser', baseline.JOB, 'failure')]])
        self.log = '2026-09-09T05:29:05.8296268Z ' + baseline.json.dumps(baseline.EXPECTED_REPORT)

    def test_confirmed_failure_is_never_relabelled_pass(self):
        record = baseline.validate(self.run, self.jobs, self.log)
        self.assertEqual(record['result'], 'blocked')
        self.assertEqual(record['liveAcceptance'], 'not_passed')
        self.assertEqual(record['reason'], 'education_forbidden')

    def test_wrong_source_attempt_owner_or_result_rejected(self):
        for key, value in [('head_sha', 'a' * 40), ('run_attempt', 2), ('conclusion', 'success'),
                           ('actor', dict(login='foreign')), ('event', 'pull_request')]:
            with self.subTest(key=key), self.assertRaises(AssertionError):
                baseline.validate({**self.run, key: value}, self.jobs, self.log)

    def test_incomplete_duplicate_or_foreign_job_rejected(self):
        for alter in ('missing', 'duplicate', 'foreign'):
            jobs = copy.deepcopy(self.jobs)
            if alter == 'missing': jobs['jobs'].pop()
            if alter == 'duplicate': jobs['jobs'][1] = jobs['jobs'][0]
            if alter == 'foreign': jobs['jobs'][1]['run_id'] += 1
            with self.subTest(alter=alter), self.assertRaises(AssertionError):
                baseline.validate(self.run, jobs, self.log)

    def test_missing_duplicate_changed_or_passing_record_rejected(self):
        for log in ['', self.log + '\n' + self.log, self.log.replace('education_forbidden', 'login_rejected'),
                    self.log.replace('"blocked"', '"pass"'), self.log.replace(baseline.OBSERVED, '2026-09-09T06:00:00Z')]:
            with self.subTest(log=log), self.assertRaises(AssertionError):
                baseline.validate(self.run, self.jobs, log)

    def test_unrelated_private_log_content_is_not_exported(self):
        record = baseline.validate(self.run, self.jobs, 'PRIVATE_SENTINEL\n' + self.log + '\nPRIVATE_SENTINEL')
        self.assertNotIn('PRIVATE_SENTINEL', baseline.json.dumps(record))


if __name__ == '__main__':
    unittest.main()
