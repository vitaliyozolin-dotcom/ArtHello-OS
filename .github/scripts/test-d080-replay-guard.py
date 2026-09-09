import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('replay', Path(__file__).with_name('d080-replay-guard.py'))
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

    def test_r8_incomplete_job_graph_cannot_authorize_replay(self):
        bundle = dict(name='bundle', status='completed', conclusion='success', run_attempt=1, labels=['ubuntu-latest'])
        for previous_jobs in ([], [bundle], [self.job]):
            with self.subTest(names=[job['name'] for job in previous_jobs]), self.assertRaises(AssertionError):
                replay.validate_previous_attempt(dict(total_count=len(previous_jobs), jobs=previous_jobs), 1)

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


R8_OBSERVED = {
  "run": {
    "id": 34283447507,
    "head_sha": "5385090d48f4dae29c314dff7ae974d854560940",
    "path": ".github/workflows/deploy-arthello-recovery-r8-20260908.yml",
    "repository": {
      "full_name": "vitaliyozolin-dotcom/ArtHello-OS"
    },
    "head_repository": {
      "full_name": "vitaliyozolin-dotcom/ArtHello-OS"
    },
    "event": "workflow_run",
    "head_branch": "main",
    "actor": {
      "login": "vitaliyozolin-dotcom"
    },
    "triggering_actor": {
      "login": "vitaliyozolin-dotcom"
    },
    "run_attempt": 1,
    "status": "completed",
    "conclusion": "failure"
  },
  "jobs": {
    "total_count": 2,
    "jobs": [
      {
        "id": 102253627289,
        "run_id": 34283447507,
        "name": "bundle",
        "head_sha": "5385090d48f4dae29c314dff7ae974d854560940",
        "head_branch": "main",
        "run_attempt": 1,
        "status": "completed",
        "conclusion": "success",
        "labels": [
          "ubuntu-latest"
        ],
        "steps": [
          {
            "name": "Set up job",
            "number": 1,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
            "number": 2,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
            "number": 3,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Test browser policy and install locked package off the VPS",
            "number": 4,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Build immutable bundle and exercise Chromium sandbox and natural flow fixture",
            "number": 5,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Run actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
            "number": 6,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Post Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
            "number": 11,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Post Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
            "number": 12,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Complete job",
            "number": 13,
            "status": "completed",
            "conclusion": "success"
          }
        ]
      },
      {
        "id": 102254222317,
        "run_id": 34283447507,
        "name": "deploy",
        "head_sha": "5385090d48f4dae29c314dff7ae974d854560940",
        "head_branch": "main",
        "run_attempt": 1,
        "status": "completed",
        "conclusion": "failure",
        "labels": [
          "self-hosted",
          "linux",
          "x64",
          "arthello-gateway"
        ],
        "steps": [
          {
            "name": "Set up job",
            "number": 1,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Verify D078 R8 identity and preserved R5 R7 abort boundary",
            "number": 2,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Wait for exact main Quality Proof and v52 verification",
            "number": 3,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Check out exact verified release",
            "number": 4,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Verify checkout and release contracts",
            "number": 5,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Verify installed R5 School relay with fresh receipt",
            "number": 6,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Check existing gateway Docker authority",
            "number": 7,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Check current release and existing browser runtime",
            "number": 8,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Measure import capacity before downloading the verified archive",
            "number": 9,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Run actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
            "number": 10,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Verify archive, import off-host bundle and verify portable identity",
            "number": 11,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "School diagnostic and real browser acceptance before cutover",
            "number": 12,
            "status": "completed",
            "conclusion": "failure"
          },
          {
            "name": "Download and load exact hosted-verified image",
            "number": 13,
            "status": "completed",
            "conclusion": "skipped"
          },
          {
            "name": "Verify and load exact hosted-verified image",
            "number": 14,
            "status": "completed",
            "conclusion": "skipped"
          },
          {
            "name": "Resolve authoritative School sync secret",
            "number": 15,
            "status": "completed",
            "conclusion": "skipped"
          },
          {
            "name": "Clone preflight and guarded production cutover",
            "number": 16,
            "status": "completed",
            "conclusion": "skipped"
          },
          {
            "name": "School diagnostic and real browser acceptance after cutover",
            "number": 17,
            "status": "completed",
            "conclusion": "skipped"
          },
          {
            "name": "Remove only this downloaded temporary archive",
            "number": 18,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Remove temporary School SSH material",
            "number": 19,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Production summary",
            "number": 20,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Post Check out exact verified release",
            "number": 40,
            "status": "completed",
            "conclusion": "success"
          },
          {
            "name": "Complete job",
            "number": 41,
            "status": "completed",
            "conclusion": "success"
          }
        ]
      }
    ]
  }
}


class R8AbortTests(unittest.TestCase):
    def validate(self, evidence=None):
        evidence = R8_OBSERVED if evidence is None else evidence
        replay.validate_r8_abort(evidence['run'], evidence['jobs'], REPOSITORY)

    def test_actual_r8_abort_is_accepted(self):
        self.validate()

    def test_wrong_run_provenance_is_rejected(self):
        patches = [dict(id=123), dict(head_sha='f' * 40), dict(path='other.yml'),
                   dict(repository=dict(full_name='other/repo')),
                   dict(head_repository=dict(full_name='other/repo')),
                   dict(event='push'), dict(head_branch='other'),
                   dict(actor=dict(login='other')), dict(triggering_actor=dict(login='other')),
                   dict(run_attempt=2), dict(status='in_progress'), dict(conclusion='success')]
        for patch in patches:
            evidence = copy.deepcopy(R8_OBSERVED)
            evidence['run'].update(patch)
            with self.subTest(patch=patch), self.assertRaises(AssertionError):
                self.validate(evidence)

    def test_incomplete_duplicate_or_unexpected_jobs_are_rejected(self):
        for mode in ('empty', 'missing_bundle', 'missing_deploy', 'duplicate', 'unexpected', 'pagination'):
            evidence = copy.deepcopy(R8_OBSERVED)
            jobs = evidence['jobs']['jobs']
            if mode == 'empty':
                jobs.clear()
            elif mode == 'missing_bundle':
                jobs.pop(0)
            elif mode == 'missing_deploy':
                jobs.pop(1)
            elif mode == 'duplicate':
                jobs[1] = copy.deepcopy(jobs[0])
            elif mode == 'unexpected':
                jobs[1]['name'] = 'unknown'
            evidence['jobs']['total_count'] = len(jobs) + (mode == 'pagination')
            with self.subTest(mode=mode), self.assertRaises(AssertionError):
                self.validate(evidence)

    def test_each_r8_job_identity_and_status_is_pinned(self):
        for index in range(2):
            for patch in [dict(id=123), dict(run_id=123), dict(head_sha='f' * 40),
                          dict(head_branch='other'), dict(run_attempt=2), dict(status='in_progress'),
                          dict(conclusion='cancelled'), dict(labels=['other'])]:
                evidence = copy.deepcopy(R8_OBSERVED)
                evidence['jobs']['jobs'][index].update(patch)
                with self.subTest(index=index, patch=patch), self.assertRaises(AssertionError):
                    self.validate(evidence)

    def test_each_observed_r8_step_is_unambiguous_and_completed(self):
        for job_index in range(2):
            for index in range(len(R8_OBSERVED['jobs']['jobs'][job_index]['steps'])):
                for mode in ('missing', 'duplicate', 'changed', 'running'):
                    evidence = copy.deepcopy(R8_OBSERVED)
                    steps = evidence['jobs']['jobs'][job_index]['steps']
                    if mode == 'missing':
                        steps.pop(index)
                    elif mode == 'duplicate':
                        steps.append(copy.deepcopy(steps[index]))
                    elif mode == 'changed':
                        steps[index]['conclusion'] = 'cancelled'
                    else:
                        steps[index]['status'] = 'in_progress'
                    with self.subTest(job=job_index, step=index, mode=mode), self.assertRaises(AssertionError):
                        self.validate(evidence)



class R9HistoryTests(unittest.TestCase):
    def setUp(self):
        self.release = 'a' * 40
        self.current = 3000
        self.requested = []
        self.runs = dict(total_count=2, workflow_runs=[
            self.make_run(2000, 2, 'completed', 'failure'),
            self.make_run(self.current, 3, 'in_progress', None),
        ])
        self.jobs = {}
        for identity, attempt in [(2000, 1), (2000, 2), (self.current, 1), (self.current, 2)]:
            jobs = copy.deepcopy(R8_OBSERVED['jobs'])
            for index, job in enumerate(jobs['jobs']):
                job.update(id=identity * 100 + attempt * 10 + index,
                           run_id=identity, run_attempt=attempt, head_sha=self.release)
            self.jobs[self.path(identity, attempt)] = jobs

    def make_run(self, identity, attempt, status, conclusion):
        return {**copy.deepcopy(R8_OBSERVED['run']), 'id': identity, 'run_attempt': attempt,
                'head_sha': self.release, 'path': '.github/workflows/deploy-arthello-recovery-r9-20260909.yml',
                'status': status, 'conclusion': conclusion}

    def path(self, identity, attempt):
        return f'/actions/runs/{identity}/attempts/{attempt}/jobs?per_page=100'

    def get(self, path):
        self.requested.append(path)
        return self.jobs[path]

    def validate(self):
        replay.validate_history(self.runs, self.get, REPOSITORY, self.release, self.current, 3)

    def test_every_previous_attempt_of_every_run_is_checked(self):
        self.validate()
        self.assertEqual(self.requested, [self.path(2000, 1), self.path(2000, 2),
                                         self.path(self.current, 1), self.path(self.current, 2)])

    def test_first_attempt_does_not_invent_prior_job_evidence(self):
        runs = dict(total_count=1, workflow_runs=[self.make_run(self.current, 1, 'in_progress', None)])
        replay.validate_history(runs, self.get, REPOSITORY, self.release, self.current, 1)
        self.assertEqual(self.requested, [])

    def test_run_inventory_missing_current_duplicate_or_truncated_is_rejected(self):
        for mode in ('truncated', 'missing_current', 'duplicate'):
            with self.subTest(mode=mode):
                self.setUp()
                if mode == 'truncated':
                    self.runs['total_count'] += 1
                elif mode == 'missing_current':
                    self.runs['workflow_runs'][1]['id'] = 4000
                else:
                    self.runs['workflow_runs'][0]['id'] = self.current
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_wrong_source_owner_or_workflow_in_any_run_is_rejected(self):
        for index in range(2):
            for patch in [dict(head_sha='b' * 40), dict(path='other.yml'),
                          dict(head_repository=dict(full_name='other/repo')),
                          dict(repository=dict(full_name='other/repo')), dict(event='push'),
                          dict(head_branch='other'), dict(actor=dict(login='other')),
                          dict(triggering_actor=dict(login='other')),
                          dict(run_attempt=0), dict(run_attempt=51), dict(run_attempt='1')]:
                with self.subTest(index=index, patch=patch):
                    self.setUp()
                    self.runs['workflow_runs'][index].update(patch)
                    with self.assertRaises(AssertionError):
                        self.validate()

    def test_successful_ambiguous_or_active_other_run_is_rejected(self):
        for patch in [dict(status='in_progress'), dict(conclusion='success'),
                      dict(conclusion=None), dict(conclusion='timed_out')]:
            with self.subTest(patch=patch):
                self.setUp()
                self.runs['workflow_runs'][0].update(patch)
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_failure_in_any_historical_attempt_is_not_ignored(self):
        for path in list(self.jobs):
            for mode in ('missing_job', 'duplicate_job', 'unexpected_job', 'truncated',
                         'wrong_attempt', 'wrong_run', 'wrong_source', 'duplicate_id',
                         'cutover_started', 'post_browser_started', 'post_browser_missing',
                         'skipped_job_with_executed_post_browser'):
                with self.subTest(path=path, mode=mode):
                    self.setUp()
                    page = self.jobs[path]
                    jobs = page['jobs']
                    if mode == 'missing_job':
                        jobs.pop()
                        page['total_count'] = len(jobs)
                    elif mode == 'duplicate_job':
                        jobs[1] = copy.deepcopy(jobs[0])
                    elif mode == 'unexpected_job':
                        jobs[1]['name'] = 'unknown'
                    elif mode == 'truncated':
                        page['total_count'] += 1
                    elif mode == 'wrong_attempt':
                        jobs[1]['run_attempt'] += 1
                    elif mode == 'wrong_run':
                        jobs[1]['run_id'] = 4000
                    elif mode == 'wrong_source':
                        jobs[1]['head_sha'] = 'b' * 40
                    elif mode == 'duplicate_id':
                        jobs[1]['id'] = jobs[0]['id']
                    else:
                        target = ('Clone preflight and guarded production cutover' if mode == 'cutover_started'
                                  else 'School diagnostic and real browser acceptance after cutover')
                        steps = jobs[1]['steps']
                        step = next(item for item in steps if item['name'] == target)
                        if mode == 'post_browser_missing':
                            steps.remove(step)
                        else:
                            step['conclusion'] = 'success'
                        if mode == 'skipped_job_with_executed_post_browser':
                            jobs[1]['conclusion'] = 'skipped'
                    with self.assertRaises(AssertionError):
                        self.validate()

    def test_missing_attempt_page_and_transport_failure_propagate(self):
        del self.jobs[self.path(2000, 2)]
        with self.assertRaises(KeyError):
            self.validate()
        def failed_get(path):
            raise TimeoutError('fixed synthetic failure')
        with self.assertRaises(TimeoutError):
            replay.validate_history(self.runs, failed_get, REPOSITORY, self.release, self.current, 3)

    def test_skipped_deploy_without_steps_is_safe_only_with_complete_hosted_job_graph(self):
        for page in self.jobs.values():
            page['jobs'][1].update(conclusion='skipped', steps=[])
        self.validate()


if __name__ == '__main__':
    unittest.main()
