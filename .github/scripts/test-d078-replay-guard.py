import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('replay', Path(__file__).with_name('d078-replay-guard.py'))
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)
REPOSITORY = 'vitaliyozolin-dotcom/ArtHello-OS'


class ReplayTests(unittest.TestCase):
    def setUp(self):
        self.run = dict(id=34227595623, head_sha='dbe630145a3828643fcfb9f202b1239e8cc54826',
                        path='.github/workflows/deploy-arthello-recovery-r7-20260908.yml',
                        repository=dict(full_name=REPOSITORY), head_repository=dict(full_name=REPOSITORY),
                        event='workflow_run', head_branch='main', actor=dict(login='vitaliyozolin-dotcom'),
                        triggering_actor=dict(login='vitaliyozolin-dotcom'), run_attempt=1,
                        status='completed', conclusion='failure')
        expected = {'Verify installed R5 School relay with fresh receipt': 'success',
                    'Check existing gateway Docker authority': 'success',
                    'Read-only School diagnostic and real browser acceptance': 'failure',
                    'Download and load exact hosted-verified image': 'skipped',
                    'Verify and load exact hosted-verified image': 'skipped',
                    'Resolve authoritative School sync secret': 'skipped',
                    'Clone preflight and guarded production cutover': 'skipped'}
        self.job = dict(id=102065872459, name='deploy', run_attempt=1, status='completed',
                        conclusion='failure', steps=[dict(name=name, conclusion=value) for name, value in expected.items()])

    def validate(self, run=None, job=None):
        replay.validate_r7_abort(self.run if run is None else run,
                                 dict(total_count=1, jobs=[self.job if job is None else job]), REPOSITORY)

    def test_verified_abort_is_accepted(self):
        self.validate()

    def test_stale_or_other_controller_run_is_rejected(self):
        for patch in [dict(head_sha='f' * 40), dict(id=123), dict(run_attempt=2),
                      dict(conclusion='success'), dict(status='in_progress'),
                      dict(path='other.yml'), dict(triggering_actor=dict(login='other'))]:
            with self.subTest(patch=patch), self.assertRaises(AssertionError):
                self.validate(run={**self.run, **patch})

    def test_each_missing_ambiguous_or_changed_step_is_rejected(self):
        for index in range(len(self.job['steps'])):
            for mode in ('missing', 'duplicate', 'cancelled'):
                job = copy.deepcopy(self.job)
                if mode == 'missing':
                    job['steps'].pop(index)
                elif mode == 'duplicate':
                    job['steps'].append(job['steps'][index])
                else:
                    job['steps'][index]['conclusion'] = 'cancelled'
                with self.subTest(index=index, mode=mode), self.assertRaises(AssertionError):
                    self.validate(job=job)

    def test_started_cutover_is_never_safe_to_replay(self):
        self.assertTrue(replay.safe_previous_job(self.job))
        for conclusion in ('success', 'failure', 'cancelled', None):
            job = copy.deepcopy(self.job)
            job['steps'][-1]['conclusion'] = conclusion
            self.assertFalse(replay.safe_previous_job(job))

    def test_r8_hosted_bundle_and_unstarted_cutover_can_resume(self):
        bundle = dict(name='bundle', status='completed', conclusion='success', run_attempt=1, labels=['ubuntu-latest'])
        jobs = dict(total_count=2, jobs=[bundle, self.job])
        replay.validate_previous_attempt(jobs, 1)
        for patch in [dict(name='unknown'), dict(status='in_progress'), dict(labels=['self-hosted']), dict(run_attempt=2)]:
            with self.subTest(patch=patch), self.assertRaises(AssertionError):
                replay.validate_previous_attempt(dict(total_count=2, jobs=[{**bundle, **patch}, self.job]), 1)
        changed = copy.deepcopy(self.job)
        changed['steps'][-1]['conclusion'] = 'failure'
        with self.assertRaises(AssertionError):
            replay.validate_previous_attempt(dict(total_count=2, jobs=[bundle, changed]), 1)
        with self.assertRaises(AssertionError):
            replay.validate_previous_attempt(dict(total_count=2, jobs=[bundle, bundle]), 1)


if __name__ == '__main__':
    unittest.main()
