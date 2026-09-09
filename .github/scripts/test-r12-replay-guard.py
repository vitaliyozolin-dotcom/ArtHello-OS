import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('replay', Path(__file__).with_name('r12-replay-guard.py'))
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



class R12HistoryTests(unittest.TestCase):
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
                'head_sha': self.release, 'path': '.github/workflows/deploy-arthello-recovery-r12-20260909.yml',
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


class CandidateReplayTests(unittest.TestCase):
    def setUp(self):
        self.release = 'a' * 40
        self.run = dict(id=7000, head_sha=self.release, repository=dict(full_name=REPOSITORY),
                        head_repository=dict(full_name=REPOSITORY), path=replay.CONSUMER_PATH,
                        event='workflow_run', head_branch='main', actor=dict(login='vitaliyozolin-dotcom'),
                        triggering_actor=dict(login='vitaliyozolin-dotcom'), run_attempt=2,
                        status='in_progress', conclusion=None)
        names = replay.CANDIDATE_PRESTEPS + ['Clone preflight and guarded production cutover'] + replay.CANDIDATE_POSTSTEPS
        steps = [dict(name=name, status='completed', conclusion='success') for name in names]
        for step in steps:
            if step['name'] in ('Verify retained candidate before any replay skip',
                                 'School diagnostic and real browser acceptance after cutover'):
                step['conclusion'] = 'skipped'
            if step['name'] == 'Clone preflight and guarded production cutover':
                step['conclusion'] = 'failure'
        shared = dict(run_id=7000, head_sha=self.release, head_branch='main', run_attempt=1, status='completed')
        self.jobs = dict(total_count=2, jobs=[
            dict(**shared, id=8000, name='bundle', conclusion='success', labels=['ubuntu-latest']),
            dict(**shared, id=8001, name='deploy', conclusion='failure',
                 labels=['self-hosted', 'linux', 'x64', 'arthello-gateway'], steps=steps)])
        self.log = '2026-09-09T08:00:00Z ARTHELLO_D080_CANDIDATE_MAINTENANCE_HELD=1'

    def validate(self):
        return replay.validate_history(dict(total_count=1, workflow_runs=[self.run]),
                                       lambda path: self.jobs, REPOSITORY, self.release, 7000, 2,
                                       get_logs=lambda identity: self.log)

    def test_same_run_verified_candidate_hold_requests_runtime_verification(self):
        self.assertTrue(self.validate())

    def test_missing_duplicate_or_public_activation_log_refuses_resume(self):
        for log in ('', self.log + '\n' + self.log, self.log + '\nARTHELLO_RELEASE_ACTIVE=' + self.release,
                    self.log + '\nARTHELLO_D080_CANDIDATE_STATE=PUBLIC_START'):
            self.log, original = log, self.log
            with self.subTest(log=log), self.assertRaises(AssertionError):
                self.validate()
            self.log = original

    def test_no_provenance_skip_unknown_step_or_postbrowser_is_permitted(self):
        for name, conclusion in [('Wait for exact main Quality Proof and v52 verification', 'skipped'),
                                 ('School diagnostic and real browser acceptance after cutover', 'success'),
                                 ('Resolve authoritative School sync secret', 'skipped')]:
            changed = copy.deepcopy(self.jobs)
            next(step for step in self.jobs['jobs'][1]['steps'] if step['name'] == name)['conclusion'] = conclusion
            with self.subTest(name=name), self.assertRaises(AssertionError):
                self.validate()
            self.jobs = changed
        self.jobs['jobs'][1]['steps'].append(dict(name='unexpected', status='completed', conclusion='success'))
        with self.assertRaises(AssertionError):
            self.validate()

    def test_another_run_cannot_adopt_a_held_candidate(self):
        foreign = copy.deepcopy(self.run)
        foreign.update(id=6000, run_attempt=1, status='completed', conclusion='failure')
        current = {**self.run, 'run_attempt': 1}
        with self.assertRaises(AssertionError):
            replay.validate_history(dict(total_count=2, workflow_runs=[foreign, current]),
                                    lambda path: self.jobs, REPOSITORY, self.release, 7000, 1,
                                    get_logs=lambda identity: self.log)

    def test_resumed_attempt_requires_explicit_successful_runtime_check(self):
        self.run['run_attempt'] = 3
        for job in self.jobs['jobs']:
            job['run_attempt'] = 2
        for step in self.jobs['jobs'][1]['steps']:
            if step['name'] == 'Verify retained candidate before any replay skip':
                step['conclusion'] = 'success'
            if step['name'] in replay.CANDIDATE_IMPORTS:
                step['conclusion'] = 'skipped'
        replay.validate_candidate_attempt(self.jobs, 2, lambda identity: self.log)
        next(step for step in self.jobs['jobs'][1]['steps']
             if step['name'] == 'Verify retained candidate before any replay skip')['conclusion'] = 'skipped'
        with self.assertRaises(AssertionError):
            replay.validate_candidate_attempt(self.jobs, 2, lambda identity: self.log)



R9_OBSERVED = {
  "commit": {
    "sha": "30f825d674cbf498be713c7b637e1dfd9f9c42cd",
    "tree": {
      "sha": "bf1c67e32ea329546ce8870a4c3589f9b2c6a16d"
    }
  },
  "jobs": {
    "jobs": [
      {
        "conclusion": "success",
        "head_branch": "main",
        "head_sha": "30f825d674cbf498be713c7b637e1dfd9f9c42cd",
        "id": 102361193671,
        "labels": [
          "ubuntu-latest"
        ],
        "name": "bundle",
        "run_attempt": 1,
        "run_id": 34318973875,
        "runner_name": "GitHub Actions 1000003822",
        "status": "completed",
        "steps": [
          {
            "conclusion": "success",
            "name": "Set up job",
            "number": 1,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
            "number": 2,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
            "number": 3,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Test browser policy and install locked package off the VPS",
            "number": 4,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Build immutable bundle and exercise Chromium sandbox and natural flow fixture",
            "number": 5,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Run actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
            "number": 6,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Post Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
            "number": 11,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Post Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
            "number": 12,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Complete job",
            "number": 13,
            "status": "completed"
          }
        ]
      },
      {
        "conclusion": "failure",
        "head_branch": "main",
        "head_sha": "30f825d674cbf498be713c7b637e1dfd9f9c42cd",
        "id": 102361578781,
        "labels": [
          "self-hosted",
          "linux",
          "x64",
          "arthello-gateway"
        ],
        "name": "deploy",
        "run_attempt": 1,
        "run_id": 34318973875,
        "runner_name": "arthello-gateway",
        "status": "completed",
        "steps": [
          {
            "conclusion": "success",
            "name": "Set up job",
            "number": 1,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Verify D080 R9 identity and preserved R5 R8 abort boundary",
            "number": 2,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Wait for exact main Quality Proof and v52 verification",
            "number": 3,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Check out exact verified release",
            "number": 4,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Verify checkout and release contracts",
            "number": 5,
            "status": "completed"
          },
          {
            "conclusion": "skipped",
            "name": "Verify retained candidate before any replay skip",
            "number": 6,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Verify installed R5 School relay with fresh receipt",
            "number": 7,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Check existing gateway Docker authority",
            "number": 8,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Check current release and existing browser runtime",
            "number": 9,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Measure import capacity before downloading the verified archive",
            "number": 10,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Run actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
            "number": 11,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Verify archive, import off-host bundle and verify portable identity",
            "number": 12,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Read-only School diagnostic before candidate acceptance",
            "number": 13,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Download and load exact hosted-verified image",
            "number": 14,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Verify and load exact hosted-verified image",
            "number": 15,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Verify actual gateway Caddy with isolated candidate fixture",
            "number": 16,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Resolve authoritative School sync secret",
            "number": 17,
            "status": "completed"
          },
          {
            "conclusion": "failure",
            "name": "Clone preflight and guarded production cutover",
            "number": 18,
            "status": "completed"
          },
          {
            "conclusion": "skipped",
            "name": "School diagnostic and real browser acceptance after cutover",
            "number": 19,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Remove only this downloaded temporary archive",
            "number": 20,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Remove temporary School SSH material",
            "number": 21,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Production summary",
            "number": 22,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Post Check out exact verified release",
            "number": 44,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Complete job",
            "number": 45,
            "status": "completed"
          }
        ]
      }
    ],
    "total_count": 2
  },
  "run": {
    "actor": {
      "login": "vitaliyozolin-dotcom"
    },
    "conclusion": "failure",
    "event": "workflow_run",
    "head_branch": "main",
    "head_repository": {
      "full_name": "vitaliyozolin-dotcom/ArtHello-OS"
    },
    "head_sha": "30f825d674cbf498be713c7b637e1dfd9f9c42cd",
    "id": 34318973875,
    "path": ".github/workflows/deploy-arthello-recovery-r9-20260909.yml",
    "repository": {
      "full_name": "vitaliyozolin-dotcom/ArtHello-OS"
    },
    "run_attempt": 1,
    "status": "completed",
    "triggering_actor": {
      "login": "vitaliyozolin-dotcom"
    }
  }
}


class R9PreauthAbortTests(unittest.TestCase):
    def setUp(self):
        self.evidence = copy.deepcopy(R9_OBSERVED)
        self.lines = ['ARTHELLO_CHECKOUT=' + replay.R9_SHA, 'ARTHELLO_TREE=' + replay.R9_TREE] + replay.R9_CUTOVER_OUTPUT[:]

    def validate(self):
        replay.validate_r9_abort(self.evidence['run'], self.evidence['jobs'], self.evidence['commit'],
                                 '\n'.join(self.lines), REPOSITORY)

    def test_exact_observed_r9_preauth_abort_is_accepted(self):
        self.validate()

    def test_every_r9_run_provenance_field_is_pinned(self):
        patches = [dict(id=123), dict(head_sha='f' * 40), dict(path=replay.CONSUMER_PATH),
                   dict(repository=dict(full_name='other/repo')), dict(head_repository=dict(full_name='other/repo')),
                   dict(event='push'), dict(head_branch='other'), dict(actor=dict(login='other')),
                   dict(triggering_actor=dict(login='other')), dict(run_attempt=2),
                   dict(status='in_progress'), dict(conclusion='success')]
        for patch in patches:
            with self.subTest(patch=patch):
                self.setUp()
                self.evidence['run'].update(patch)
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_commit_source_and_tree_are_pinned(self):
        for commit in [dict(sha='f' * 40, tree=dict(sha=replay.R9_TREE)),
                       dict(sha=replay.R9_SHA, tree=dict(sha='f' * 40))]:
            with self.subTest(commit=commit):
                self.evidence['commit'] = commit
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_complete_r9_job_inventory_is_required(self):
        for mode in ('missing', 'duplicate', 'unknown', 'pagination'):
            with self.subTest(mode=mode):
                self.setUp()
                jobs = self.evidence['jobs']['jobs']
                if mode == 'missing':
                    jobs.pop()
                elif mode == 'duplicate':
                    jobs[1] = copy.deepcopy(jobs[0])
                elif mode == 'unknown':
                    jobs[1]['name'] = 'other'
                self.evidence['jobs']['total_count'] = len(jobs) + (mode == 'pagination')
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_r9_job_identity_runner_source_attempt_and_status_are_pinned(self):
        for index in range(2):
            for patch in [dict(id=123), dict(run_id=123), dict(head_sha='f' * 40), dict(head_branch='other'),
                          dict(run_attempt=2), dict(status='in_progress'), dict(conclusion='cancelled'),
                          dict(labels=['self-hosted', 'other'])]:
                with self.subTest(index=index, patch=patch):
                    self.setUp()
                    self.evidence['jobs']['jobs'][index].update(patch)
                    with self.assertRaises(AssertionError):
                        self.validate()
        self.setUp()
        self.evidence['jobs']['jobs'][1]['runner_name'] = 'other'
        with self.assertRaises(AssertionError):
            self.validate()

    def test_every_r9_step_number_name_status_and_conclusion_are_pinned(self):
        for job_index in range(2):
            for index in range(len(R9_OBSERVED['jobs']['jobs'][job_index]['steps'])):
                for mode in ('missing', 'duplicate', 'number', 'name', 'running', 'conclusion'):
                    with self.subTest(job=job_index, step=index, mode=mode):
                        self.setUp()
                        steps = self.evidence['jobs']['jobs'][job_index]['steps']
                        if mode == 'missing':
                            steps.pop(index)
                        elif mode == 'duplicate':
                            steps.append(copy.deepcopy(steps[index]))
                        else:
                            field, value = {'number': ('number', 900), 'name': ('name', 'other'),
                                            'running': ('status', 'in_progress'),
                                            'conclusion': ('conclusion', 'cancelled')}[mode]
                            steps[index][field] = value
                        with self.assertRaises(AssertionError):
                            self.validate()

    def test_each_execution_proof_line_is_required_once_and_in_order(self):
        for index in range(len(self.lines)):
            for mode in ('missing', 'duplicate', 'changed'):
                with self.subTest(index=index, mode=mode):
                    self.setUp()
                    if mode == 'missing':
                        self.lines.pop(index)
                    elif mode == 'duplicate':
                        self.lines.append(self.lines[index])
                    else:
                        self.lines[index] += ' changed'
                    with self.assertRaises(AssertionError):
                        self.validate()
        self.setUp()
        self.lines[-3], self.lines[-2] = self.lines[-2], self.lines[-3]
        with self.assertRaises(AssertionError):
            self.validate()
        self.setUp()
        self.lines.insert(4, 'unexplained runtime output')
        with self.assertRaises(AssertionError):
            self.validate()

    def test_echoed_source_is_not_execution_proof_and_timestamps_are_supported(self):
        emitted = self.lines[:]
        self.lines = ['##[group]Run shell script'] + emitted + ['##[endgroup]']
        with self.assertRaises(AssertionError):
            self.validate()
        self.lines += emitted
        self.lines = ['2026-09-09T06:30:00.1234567Z ' + line for line in self.lines]
        self.validate()

    def test_truncated_groups_and_oversized_logs_are_rejected(self):
        for extra in ('##[group]Unfinished', '##[endgroup]', 'x' * 1048577):
            with self.subTest(kind=extra[:24]):
                self.setUp()
                self.lines.append(extra)
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_any_clone_auth_public_or_bank_output_is_rejected(self):
        markers = ['ARTHELLO_CLONE_PREFLIGHT=VERIFIED', 'ARTHELLO_BACKUP_ORDINARY_RUNTIME=VERIFIED',
                   'ARTHELLO_ROLLBACK_VOLUME=VERIFIED name=synthetic',
                   'ARTHELLO_D080_CANDIDATE_STATE=BEGIN', 'ARTHELLO_D080_CANDIDATE_STATE=PUBLIC_START',
                   'ARTHELLO_D080_CANDIDATE_MAINTENANCE_HELD=1', 'ARTHELLO_POST_AUTH_RECOVERY_REQUIRED=1',
                   'ARTHELLO_RELEASE_ACTIVE=' + replay.R9_SHA, 'ARTHELLO_TOCHKA_AUTOSYNC_ACTIVATION_V2=VERIFIED',
                   'ARTHELLO_R9_SSO_ACCEPTANCE=VERIFIED',
                   '{"kind":"server-natural-sso","result":"pass"}',
                   '{"kind":"candidate-maintenance-probe","result":"pass"}',
                   '{"kind":"candidate-maintenance-route","result":"rendered"}']
        for marker in markers:
            with self.subTest(marker=marker):
                self.setUp()
                self.lines.append(marker)
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_frozen_r9_is_never_an_r10_replay_consumer(self):
        previous = copy.deepcopy(self.evidence['run'])
        previous.update(id=7000, path=replay.CONSUMER_PATH, status='in_progress', conclusion=None)
        for release, current_run, path in [(replay.R9_SHA, 7000, replay.CONSUMER_PATH),
                                           ('a' * 40, replay.R9_RUN, replay.CONSUMER_PATH),
                                           ('a' * 40, 7000, replay.R9_PATH)]:
            previous.update(id=current_run, head_sha=release, path=path)
            with self.subTest(release=release, current_run=current_run, path=path), self.assertRaises(AssertionError):
                replay.validate_history(dict(total_count=1, workflow_runs=[previous]),
                                        lambda path: self.fail('No replay evidence may authorize frozen R9'),
                                        REPOSITORY, release, current_run, 1)

    def test_conflicting_boundary_or_semantically_duplicate_renderer_output_is_rejected(self):
        extras = ['ARTHELLO_CHECKOUT=' + 'f' * 40, 'ARTHELLO_TREE=' + 'f' * 40,
                  'ARTHELLO_CUTOVER_IMMUTABLE_IMAGE=VERIFIED id=foreign',
                  'ARTHELLO_ACTIVE_D1_FD=VERIFIED role=candidate handles=3',
                  'ARTHELLO_ROLLBACK=FAILED_MANUAL_RECOVERY_REQUIRED',
                  '{"result": "blocked", "kind": "candidate-maintenance-route"}',
                  '{"kind":"candidate-maintenance-route","result":"blocked","extra":1}']
        for extra in extras:
            with self.subTest(extra=extra):
                self.setUp()
                self.lines.append(extra)
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_new_unused_image_retirement_is_fresh_only_and_r9_graph_remains_frozen(self):
        name = 'Retire only the exact unused R9 browser image under D084'
        self.assertIn(name, replay.CANDIDATE_IMPORTS)
        position = replay.CANDIDATE_PRESTEPS.index(name)
        self.assertEqual(replay.CANDIDATE_PRESTEPS[position + 1],
                         'Retire only unused recoverable R10 images for import capacity under D086')
        self.assertNotIn(name, [step[0] for step in replay.R9_STEPS['deploy']])



R10_OBSERVED = {
  "commit": {
    "sha": "2e57dd22c6ff1cec1fcad0bd11af479e465c00bb",
    "tree": {
      "sha": "445762d319e5c792d97617e8a4515045bc3b4126"
    }
  },
  "jobs": {
    "jobs": [
      {
        "conclusion": "success",
        "head_branch": "main",
        "head_sha": "2e57dd22c6ff1cec1fcad0bd11af479e465c00bb",
        "id": 102370988472,
        "labels": [
          "ubuntu-latest"
        ],
        "name": "bundle",
        "run_attempt": 1,
        "run_id": 34322039891,
        "runner_name": "GitHub Actions 1000003859",
        "status": "completed",
        "steps": [
          {
            "conclusion": "success",
            "name": "Set up job",
            "number": 1,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
            "number": 2,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
            "number": 3,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Test browser policy and install locked package off the VPS",
            "number": 4,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Build immutable bundle and exercise Chromium sandbox and natural flow fixture",
            "number": 5,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Run actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
            "number": 6,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Post Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
            "number": 11,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Post Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
            "number": 12,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Complete job",
            "number": 13,
            "status": "completed"
          }
        ]
      },
      {
        "conclusion": "failure",
        "head_branch": "main",
        "head_sha": "2e57dd22c6ff1cec1fcad0bd11af479e465c00bb",
        "id": 102371510204,
        "labels": [
          "self-hosted",
          "linux",
          "x64",
          "arthello-gateway"
        ],
        "name": "deploy",
        "run_attempt": 1,
        "run_id": 34322039891,
        "runner_name": "arthello-gateway",
        "status": "completed",
        "steps": [
          {
            "conclusion": "success",
            "name": "Set up job",
            "number": 1,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Verify D084 R10 identity and preserved R5 R8 R9 abort boundary",
            "number": 2,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Wait for exact main Quality Proof and v52 verification",
            "number": 3,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Check out exact verified release",
            "number": 4,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Verify checkout and release contracts",
            "number": 5,
            "status": "completed"
          },
          {
            "conclusion": "skipped",
            "name": "Verify retained candidate before any replay skip",
            "number": 6,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Verify installed R5 School relay with fresh receipt",
            "number": 7,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Check existing gateway Docker authority",
            "number": 8,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Check current release and existing browser runtime",
            "number": 9,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Retire only the exact unused R9 browser image under D084",
            "number": 10,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Measure import capacity before downloading the verified archive",
            "number": 11,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Run actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
            "number": 12,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Verify archive, import off-host bundle and verify portable identity",
            "number": 13,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Read-only School diagnostic before candidate acceptance",
            "number": 14,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Download and load exact hosted-verified image",
            "number": 15,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Verify and load exact hosted-verified image",
            "number": 16,
            "status": "completed"
          },
          {
            "conclusion": "failure",
            "name": "Verify actual gateway Caddy with isolated candidate fixture",
            "number": 17,
            "status": "completed"
          },
          {
            "conclusion": "skipped",
            "name": "Resolve authoritative School sync secret",
            "number": 18,
            "status": "completed"
          },
          {
            "conclusion": "skipped",
            "name": "Clone preflight and guarded production cutover",
            "number": 19,
            "status": "completed"
          },
          {
            "conclusion": "skipped",
            "name": "School diagnostic and real browser acceptance after cutover",
            "number": 20,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Remove only this downloaded temporary archive",
            "number": 21,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Remove temporary School SSH material",
            "number": 22,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Production summary",
            "number": 23,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Post Check out exact verified release",
            "number": 46,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Complete job",
            "number": 47,
            "status": "completed"
          }
        ]
      }
    ],
    "total_count": 2
  },
  "run": {
    "actor": {
      "login": "vitaliyozolin-dotcom"
    },
    "conclusion": "failure",
    "event": "workflow_run",
    "head_branch": "main",
    "head_repository": {
      "full_name": "vitaliyozolin-dotcom/ArtHello-OS"
    },
    "head_sha": "2e57dd22c6ff1cec1fcad0bd11af479e465c00bb",
    "id": 34322039891,
    "path": ".github/workflows/deploy-arthello-recovery-r10-20260909.yml",
    "repository": {
      "full_name": "vitaliyozolin-dotcom/ArtHello-OS"
    },
    "run_attempt": 1,
    "status": "completed",
    "triggering_actor": {
      "login": "vitaliyozolin-dotcom"
    }
  }
}


class R10FixtureAbortTests(unittest.TestCase):
    def setUp(self):
        self.evidence = copy.deepcopy(R10_OBSERVED)
        self.permission_error = "rm: cannot remove '/synthetic/runner/_temp/d083-target-caddy.A1b2C3d4/test-fixtures/d083-stroios-Caddyfile': Permission denied"
        self.lines = ['ARTHELLO_CHECKOUT=' + replay.R10_SHA, 'ARTHELLO_TREE=' + replay.R10_TREE,
                      replay.R10_HOSTED_IMAGE_OUTPUT] + replay.R10_CADDY_OUTPUT[:] + [self.permission_error, replay.R10_EXIT_OUTPUT]

    def validate(self):
        replay.validate_r10_abort(self.evidence['run'], self.evidence['jobs'], self.evidence['commit'],
                                  '\n'.join(self.lines), REPOSITORY)

    def test_exact_observed_r10_abort_is_accepted_without_persisting_private_path(self):
        self.validate()

    def test_every_r10_run_provenance_field_and_source_tree_are_pinned(self):
        patches = [dict(id=123), dict(head_sha='f' * 40), dict(path=replay.CONSUMER_PATH),
                   dict(repository=dict(full_name='other/repo')), dict(head_repository=dict(full_name='other/repo')),
                   dict(event='push'), dict(head_branch='other'), dict(actor=dict(login='other')),
                   dict(triggering_actor=dict(login='other')), dict(run_attempt=2), dict(run_attempt=True),
                   dict(status='in_progress'), dict(conclusion='success')]
        for patch in patches:
            with self.subTest(patch=patch):
                self.setUp()
                self.evidence['run'].update(patch)
                with self.assertRaises(AssertionError):
                    self.validate()
        for commit in [dict(sha='f' * 40, tree=dict(sha=replay.R10_TREE)),
                       dict(sha=replay.R10_SHA, tree=dict(sha='f' * 40))]:
            with self.subTest(commit=commit):
                self.setUp()
                self.evidence['commit'] = commit
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_complete_r10_job_inventory_is_required(self):
        for mode in ('missing', 'duplicate', 'unknown', 'pagination'):
            with self.subTest(mode=mode):
                self.setUp()
                jobs = self.evidence['jobs']['jobs']
                if mode == 'missing':
                    jobs.pop()
                elif mode == 'duplicate':
                    jobs[1] = copy.deepcopy(jobs[0])
                elif mode == 'unknown':
                    jobs[1]['name'] = 'other'
                self.evidence['jobs']['total_count'] = len(jobs) + (mode == 'pagination')
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_r10_job_identity_runner_source_attempt_and_status_are_pinned(self):
        for index in range(2):
            for patch in [dict(id=123), dict(run_id=123), dict(head_sha='f' * 40), dict(head_branch='other'),
                          dict(run_attempt=2), dict(run_attempt=True), dict(status='in_progress'),
                          dict(conclusion='cancelled'), dict(labels=['self-hosted', 'other'])]:
                with self.subTest(index=index, patch=patch):
                    self.setUp()
                    self.evidence['jobs']['jobs'][index].update(patch)
                    with self.assertRaises(AssertionError):
                        self.validate()
        self.setUp()
        self.evidence['jobs']['jobs'][1]['runner_name'] = 'other'
        with self.assertRaises(AssertionError):
            self.validate()

    def test_every_r10_step_number_name_status_and_conclusion_are_pinned(self):
        for job_index in range(2):
            for index in range(len(R10_OBSERVED['jobs']['jobs'][job_index]['steps'])):
                for mode in ('missing', 'duplicate', 'number', 'boolean_number', 'name', 'running', 'conclusion'):
                    with self.subTest(job=job_index, step=index, mode=mode):
                        self.setUp()
                        steps = self.evidence['jobs']['jobs'][job_index]['steps']
                        if mode == 'missing':
                            steps.pop(index)
                        elif mode == 'duplicate':
                            steps.append(copy.deepcopy(steps[index]))
                        else:
                            field, value = {'number': ('number', 900), 'boolean_number': ('number', True),
                                            'name': ('name', 'other'), 'running': ('status', 'in_progress'),
                                            'conclusion': ('conclusion', 'cancelled')}[mode]
                            steps[index][field] = value
                        with self.assertRaises(AssertionError):
                            self.validate()

    def test_each_execution_proof_line_is_required_once_and_in_order(self):
        for index in range(len(self.lines)):
            for mode in ('missing', 'duplicate', 'changed'):
                with self.subTest(index=index, mode=mode):
                    self.setUp()
                    if mode == 'missing':
                        self.lines.pop(index)
                    elif mode == 'duplicate':
                        self.lines.append(self.lines[index])
                    else:
                        self.lines[index] += ' changed'
                    with self.assertRaises(AssertionError):
                        self.validate()
        self.setUp()
        self.lines[-3], self.lines[-2] = self.lines[-2], self.lines[-3]
        with self.assertRaises(AssertionError):
            self.validate()
        self.setUp()
        self.lines.insert(4, 'unexplained runtime output')
        with self.assertRaises(AssertionError):
            self.validate()

    def test_permission_error_must_be_for_the_observed_owned_fixture_shape(self):
        changes = [('/synthetic/', 'relative/'), ('d083-target-caddy.', 'other-target-caddy.'),
                   ('A1b2C3d4', 'A1b2C3d'), ('A1b2C3d4', 'A1b2C3d45'), ('A1b2C3d4', 'A1b2C3_4'),
                   ('test-fixtures/', 'unrelated/'), ('d083-stroios-Caddyfile', 'production-Caddyfile'),
                   ('Permission denied', 'Read-only file system')]
        for old, new in changes:
            with self.subTest(old=old, new=new):
                self.setUp()
                self.lines[-2] = self.permission_error.replace(old, new)
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_any_secret_clone_auth_public_or_bank_output_is_rejected(self):
        prefixes = ['ARTHELLO_CUTOVER_IMMUTABLE_IMAGE=', 'ARTHELLO_CLONE_PREFLIGHT=',
                    'ARTHELLO_SCHOOL_SYNC_SECRET=', 'ARTHELLO_SCHOOL_SYNC_HMAC=', 'ARTHELLO_ACTIVE_D1_FD=',
                    'ARTHELLO_BACKUP_ORDINARY_RUNTIME=', 'ARTHELLO_ROLLBACK_VOLUME=', 'ARTHELLO_ROLLBACK=',
                    'ARTHELLO_D080_CANDIDATE_STATE=', 'ARTHELLO_D080_CANDIDATE_MAINTENANCE_HELD=',
                    'ARTHELLO_POST_AUTH_RECOVERY_REQUIRED=', 'ARTHELLO_RELEASE_ACTIVE=',
                    'ARTHELLO_TOCHKA_AUTOSYNC_ACTIVATION_V2=', 'ARTHELLO_R9_SSO_ACCEPTANCE=',
                    'ARTHELLO_R10_SSO_ACCEPTANCE=']
        for prefix in prefixes:
            with self.subTest(prefix=prefix):
                self.setUp()
                self.lines.append(prefix + 'VERIFIED')
                with self.assertRaises(AssertionError):
                    self.validate()
        for kind in ('server-natural-sso', 'candidate-maintenance-probe', 'candidate-maintenance-route',
                     'candidate-gateway-binding'):
            with self.subTest(kind=kind):
                self.setUp()
                self.lines.append('{"kind":"' + kind + '","result":"blocked"}')
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_blocked_r10_receipt_is_not_proof_that_authentication_did_not_occur(self):
        self.lines.append('ARTHELLO_R10_SSO_ACCEPTANCE=BLOCKED')
        with self.assertRaises(AssertionError):
            self.validate()

    def test_caddy_count_redaction_result_or_conflicting_log_proof_cannot_change(self):
        changes = [('134', '118'), ('"accessLogRedaction":"pass"', '"accessLogRedaction":"blocked"'),
                   ('"result":"pass"', '"result":"blocked"')]
        for old, new in changes:
            with self.subTest(old=old, new=new):
                self.setUp()
                self.lines[3] = self.lines[3].replace(old, new)
                with self.assertRaises(AssertionError):
                    self.validate()
        extras = ['ARTHELLO_CHECKOUT=' + 'f' * 40, 'ARTHELLO_TREE=' + 'f' * 40,
                  'ARTHELLO_HOSTED_IMAGE=VERIFIED image=foreign',
                  'ARTHELLO_TARGET_CADDY_FIXTURE=BLOCKED', '##[error]Process completed with exit code 2.',
                  "rm: cannot remove '/synthetic/other-file': Permission denied",
                  '{"result":"pass","kind":"candidate-maintenance-caddy-test","httpChecks":134,"accessLogRedaction":"pass"}']
        for extra in extras:
            with self.subTest(extra=extra):
                self.setUp()
                self.lines.append(extra)
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_echoed_source_is_not_execution_proof_and_timestamps_are_supported(self):
        emitted = self.lines[:]
        self.lines = ['##[group]Run shell script'] + emitted + ['##[endgroup]']
        with self.assertRaises(AssertionError):
            self.validate()
        self.lines += emitted
        self.lines = ['2026-09-09T07:30:00.1234567Z ' + line for line in self.lines]
        self.validate()

    def test_truncated_groups_and_oversized_logs_are_rejected(self):
        for extra in ('##[group]Unfinished', '##[endgroup]', 'x' * 1048577):
            with self.subTest(kind=extra[:24]):
                self.setUp()
                self.lines.append(extra)
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_frozen_r10_is_never_an_r11_replay_consumer(self):
        previous = copy.deepcopy(self.evidence['run'])
        previous.update(id=7000, path=replay.CONSUMER_PATH, status='in_progress', conclusion=None)
        for release, current_run, path in [(replay.R10_SHA, 7000, replay.CONSUMER_PATH),
                                           ('a' * 40, replay.R10_RUN, replay.CONSUMER_PATH),
                                           ('a' * 40, 7000, replay.R10_PATH)]:
            previous.update(id=current_run, head_sha=release, path=path)
            with self.subTest(release=release, current_run=current_run, path=path), self.assertRaises(AssertionError):
                replay.validate_history(dict(total_count=1, workflow_runs=[previous]),
                                        lambda path: self.fail('No replay evidence may authorize frozen R10'),
                                        REPOSITORY, release, current_run, 1)

    def test_r12_preserves_r9_retirement_and_adds_only_the_authorized_r10_scope(self):
        self.assertEqual(replay.CANDIDATE_PRESTEPS[1],
                         'Verify D086 R12 identity and preserved R5 R8 R9 R10 R11 abort boundary')
        self.assertEqual([name for name in replay.CANDIDATE_PRESTEPS if name.startswith('Retire ')],
                         ['Retire only the exact unused R9 browser image under D084',
                          'Retire only unused recoverable R10 images for import capacity under D086'])
        self.assertCountEqual([name for name in replay.CANDIDATE_IMPORTS if name.startswith('Retire ')],
                         ['Retire only the exact unused R9 browser image under D084',
                          'Retire only unused recoverable R10 images for import capacity under D086'])



R11_OBSERVED = {
  "commit": {
    "sha": "e579a20a2a1a40fab489340511f8c35dc6929081",
    "tree": {
      "sha": "d88300198e34e84a197118d4121f7da1fd3484cd"
    }
  },
  "jobs": {
    "jobs": [
      {
        "conclusion": "success",
        "head_branch": "main",
        "head_sha": "e579a20a2a1a40fab489340511f8c35dc6929081",
        "id": 102377827825,
        "labels": [
          "ubuntu-latest"
        ],
        "name": "bundle",
        "run_attempt": 1,
        "run_id": 34324235442,
        "runner_name": "GitHub Actions 1000003878",
        "status": "completed",
        "steps": [
          {
            "conclusion": "success",
            "name": "Set up job",
            "number": 1,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
            "number": 2,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
            "number": 3,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Test browser policy and install locked package off the VPS",
            "number": 4,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Build immutable bundle and exercise Chromium sandbox and natural flow fixture",
            "number": 5,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Run actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
            "number": 6,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Post Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
            "number": 11,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Post Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
            "number": 12,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Complete job",
            "number": 13,
            "status": "completed"
          }
        ]
      },
      {
        "conclusion": "failure",
        "head_branch": "main",
        "head_sha": "e579a20a2a1a40fab489340511f8c35dc6929081",
        "id": 102378379405,
        "labels": [
          "self-hosted",
          "linux",
          "x64",
          "arthello-gateway"
        ],
        "name": "deploy",
        "run_attempt": 1,
        "run_id": 34324235442,
        "runner_name": "arthello-gateway",
        "status": "completed",
        "steps": [
          {
            "conclusion": "success",
            "name": "Set up job",
            "number": 1,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Verify D085 R11 identity and preserved R5 R8 R9 R10 abort boundary",
            "number": 2,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Wait for exact main Quality Proof and v52 verification",
            "number": 3,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Check out exact verified release",
            "number": 4,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Verify checkout and release contracts",
            "number": 5,
            "status": "completed"
          },
          {
            "conclusion": "skipped",
            "name": "Verify retained candidate before any replay skip",
            "number": 6,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Verify installed R5 School relay with fresh receipt",
            "number": 7,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Check existing gateway Docker authority",
            "number": 8,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Check current release and existing browser runtime",
            "number": 9,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Retire only the exact unused R9 browser image under D084",
            "number": 10,
            "status": "completed"
          },
          {
            "conclusion": "failure",
            "name": "Measure import capacity before downloading the verified archive",
            "number": 11,
            "status": "completed"
          },
          {
            "conclusion": "skipped",
            "name": "Run actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
            "number": 12,
            "status": "completed"
          },
          {
            "conclusion": "skipped",
            "name": "Verify archive, import off-host bundle and verify portable identity",
            "number": 13,
            "status": "completed"
          },
          {
            "conclusion": "skipped",
            "name": "Read-only School diagnostic before candidate acceptance",
            "number": 14,
            "status": "completed"
          },
          {
            "conclusion": "skipped",
            "name": "Download and load exact hosted-verified image",
            "number": 15,
            "status": "completed"
          },
          {
            "conclusion": "skipped",
            "name": "Verify and load exact hosted-verified image",
            "number": 16,
            "status": "completed"
          },
          {
            "conclusion": "skipped",
            "name": "Verify actual gateway Caddy with isolated candidate fixture",
            "number": 17,
            "status": "completed"
          },
          {
            "conclusion": "skipped",
            "name": "Resolve authoritative School sync secret",
            "number": 18,
            "status": "completed"
          },
          {
            "conclusion": "skipped",
            "name": "Clone preflight and guarded production cutover",
            "number": 19,
            "status": "completed"
          },
          {
            "conclusion": "skipped",
            "name": "School diagnostic and real browser acceptance after cutover",
            "number": 20,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Remove only this downloaded temporary archive",
            "number": 21,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Remove temporary School SSH material",
            "number": 22,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Production summary",
            "number": 23,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Post Check out exact verified release",
            "number": 46,
            "status": "completed"
          },
          {
            "conclusion": "success",
            "name": "Complete job",
            "number": 47,
            "status": "completed"
          }
        ]
      }
    ],
    "total_count": 2
  },
  "run": {
    "actor": {
      "login": "vitaliyozolin-dotcom"
    },
    "conclusion": "failure",
    "event": "workflow_run",
    "head_branch": "main",
    "head_repository": {
      "full_name": "vitaliyozolin-dotcom/ArtHello-OS"
    },
    "head_sha": "e579a20a2a1a40fab489340511f8c35dc6929081",
    "id": 34324235442,
    "path": ".github/workflows/deploy-arthello-recovery-r11-20260909.yml",
    "repository": {
      "full_name": "vitaliyozolin-dotcom/ArtHello-OS"
    },
    "run_attempt": 1,
    "status": "completed",
    "triggering_actor": {
      "login": "vitaliyozolin-dotcom"
    }
  }
}
R11_CAPACITY_LOG = [
    '{"kind":"server-browser-image-retirement","result":"absent"}',
    'BROWSER_IMPORT_CAPACITY_KIB scratch_available=5807140 scratch_required=3348735 docker_available=5807140 docker_required=7995084',
    'SERVER_BROWSER_BLOCKED=insufficient_import_space',
    '##[error]Process completed with exit code 2.',
]


class R11CapacityAbortTests(unittest.TestCase):
    def setUp(self):
        self.evidence = copy.deepcopy(R11_OBSERVED)
        self.lines = ['ARTHELLO_CHECKOUT=' + self.evidence['run']['head_sha'],
                      'ARTHELLO_TREE=' + self.evidence['commit']['tree']['sha']] + R11_CAPACITY_LOG[:]

    def validate(self):
        replay.validate_r11_abort(self.evidence['run'], self.evidence['jobs'], self.evidence['commit'],
                                  '\n'.join(self.lines), REPOSITORY)

    def test_exact_observed_capacity_abort_is_accepted(self):
        self.validate()

    def test_r11_run_provenance_and_source_tree_are_pinned(self):
        patches = [dict(id=123), dict(head_sha='f' * 40), dict(path=replay.CONSUMER_PATH),
                   dict(repository=dict(full_name='other/repo')), dict(head_repository=dict(full_name='other/repo')),
                   dict(event='push'), dict(head_branch='other'), dict(actor=dict(login='other')),
                   dict(triggering_actor=dict(login='other')), dict(run_attempt=2), dict(run_attempt=True),
                   dict(status='in_progress'), dict(conclusion='success')]
        for patch in patches:
            with self.subTest(patch=patch):
                self.setUp()
                self.evidence['run'].update(patch)
                with self.assertRaises(AssertionError):
                    self.validate()
        for key in ('sha', 'tree'):
            with self.subTest(key=key):
                self.setUp()
                if key == 'sha':
                    self.evidence['commit']['sha'] = 'f' * 40
                else:
                    self.evidence['commit']['tree']['sha'] = 'f' * 40
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_complete_r11_job_inventory_is_required(self):
        for mode in ('missing', 'duplicate', 'unknown', 'pagination'):
            with self.subTest(mode=mode):
                self.setUp()
                jobs = self.evidence['jobs']['jobs']
                if mode == 'missing':
                    jobs.pop()
                elif mode == 'duplicate':
                    jobs[1] = copy.deepcopy(jobs[0])
                elif mode == 'unknown':
                    jobs[1]['name'] = 'other'
                self.evidence['jobs']['total_count'] = len(jobs) + (mode == 'pagination')
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_r11_job_identity_runner_source_attempt_and_status_are_pinned(self):
        for index in range(2):
            for patch in [dict(id=123), dict(run_id=123), dict(head_sha='f' * 40), dict(head_branch='other'),
                          dict(run_attempt=2), dict(run_attempt=True), dict(status='in_progress'),
                          dict(conclusion='cancelled'), dict(labels=['self-hosted', 'other'])]:
                with self.subTest(index=index, patch=patch):
                    self.setUp()
                    self.evidence['jobs']['jobs'][index].update(patch)
                    with self.assertRaises(AssertionError):
                        self.validate()
        self.setUp()
        self.evidence['jobs']['jobs'][1]['runner_name'] = 'other'
        with self.assertRaises(AssertionError):
            self.validate()

    def test_every_r11_step_number_name_status_and_conclusion_are_pinned(self):
        for job_index in range(2):
            for index in range(len(R11_OBSERVED['jobs']['jobs'][job_index]['steps'])):
                for mode in ('missing', 'duplicate', 'number', 'boolean_number', 'name', 'running', 'conclusion'):
                    with self.subTest(job=job_index, step=index, mode=mode):
                        self.setUp()
                        steps = self.evidence['jobs']['jobs'][job_index]['steps']
                        if mode == 'missing':
                            steps.pop(index)
                        elif mode == 'duplicate':
                            steps.append(copy.deepcopy(steps[index]))
                        else:
                            field, value = {'number': ('number', 900), 'boolean_number': ('number', True),
                                            'name': ('name', 'other'), 'running': ('status', 'in_progress'),
                                            'conclusion': ('conclusion', 'cancelled')}[mode]
                            steps[index][field] = value
                        with self.assertRaises(AssertionError):
                            self.validate()

    def test_pinned_capacity_lines_are_required_once_in_the_observed_order(self):
        for index in range(len(self.lines)):
            for mode in ('missing', 'duplicate', 'changed'):
                with self.subTest(index=index, mode=mode):
                    self.setUp()
                    if mode == 'missing':
                        self.lines.pop(index)
                    elif mode == 'duplicate':
                        self.lines.append(self.lines[index])
                    else:
                        self.lines[index] += ' changed'
                    with self.assertRaises(AssertionError):
                        self.validate()
        for index in range(2, 5):
            with self.subTest(reorder=index):
                self.setUp()
                self.lines[index], self.lines[index + 1] = self.lines[index + 1], self.lines[index]
                with self.assertRaises(AssertionError):
                    self.validate()
        self.setUp()
        self.lines.insert(4, 'unexplained execution output')
        with self.assertRaises(AssertionError):
            self.validate()

    def test_capacity_numbers_and_only_absent_retirement_cannot_change(self):
        for old, new in [('5807140', '5807141'), ('3348735', '3348734'), ('7995084', '7995083'),
                         ('"absent"', '"removed"'), ('insufficient_import_space', 'import_download'),
                         ('exit code 2.', 'exit code 1.')]:
            with self.subTest(old=old, new=new):
                self.setUp()
                self.lines = [line.replace(old, new) for line in self.lines]
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_any_import_caddy_secret_clone_auth_public_or_rollback_output_is_rejected(self):
        markers = [
            'SERVER_BROWSER_ARCHIVE=verified', 'BROWSER_IMPORT_RECHECK_KIB docker_available=1',
            'BROWSER_IMAGE_VERIFIED source=synthetic', 'BROWSER_IMAGE_ID=sha256:synthetic',
            'ARTHELLO_IMAGE_IMPORT=COMPLETE', 'ARTHELLO_IMAGE_EVIDENCE=VERIFIED',
            'ARTHELLO_HOSTED_IMAGE=VERIFIED', 'ARTHELLO_TARGET_CADDY_FIXTURE=VERIFIED',
            'ARTHELLO_CUTOVER_IMMUTABLE_IMAGE=VERIFIED', 'ARTHELLO_CLONE_PREFLIGHT=VERIFIED',
            'ARTHELLO_SCHOOL_SYNC_SECRET=VERIFIED', 'ARTHELLO_SCHOOL_SYNC_HMAC=VERIFIED',
            'ARTHELLO_ACTIVE_D1_FD=VERIFIED', 'ARTHELLO_BACKUP_ORDINARY_RUNTIME=VERIFIED',
            'ARTHELLO_ROLLBACK_VOLUME=VERIFIED', 'ARTHELLO_ROLLBACK=VERIFIED',
            'ARTHELLO_D080_CANDIDATE_STATE=BEGIN', 'ARTHELLO_D080_CANDIDATE_STATE=PUBLIC_START',
            'ARTHELLO_D080_CANDIDATE_MAINTENANCE_HELD=1', 'ARTHELLO_POST_AUTH_RECOVERY_REQUIRED=1',
            'ARTHELLO_D080_PUBLIC_AUDIT=BLOCKED', 'ARTHELLO_D080_PUBLIC_AUDIT=VERIFIED',
            'ARTHELLO_D080_RESUME_RUNTIME=BLOCKED', 'ARTHELLO_D080_RESUME_RUNTIME=VERIFIED',
            'ARTHELLO_D080_MAINTENANCE_RUNTIME=BLOCKED', 'ARTHELLO_D080_MAINTENANCE_RUNTIME=VERIFIED',
            'ARTHELLO_RELEASE_ACTIVE=synthetic', 'ARTHELLO_TOCHKA_AUTOSYNC_ACTIVATION_V2=VERIFIED',
            'ARTHELLO_R9_SSO_ACCEPTANCE=BLOCKED', 'ARTHELLO_R10_SSO_ACCEPTANCE=BLOCKED',
            'ARTHELLO_R11_SSO_ACCEPTANCE=BLOCKED',
        ]
        for marker in markers:
            with self.subTest(marker=marker):
                self.setUp()
                self.lines.append(marker)
                with self.assertRaises(AssertionError):
                    self.validate()
        for kind in ('server-natural-sso', 'candidate-maintenance-probe', 'candidate-maintenance-route',
                     'candidate-gateway-binding', 'candidate-maintenance-caddy-test'):
            with self.subTest(kind=kind):
                self.setUp()
                self.lines.append('{"kind":"' + kind + '","result":"blocked"}')
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_conflicting_source_failure_or_duplicate_retirement_json_is_rejected(self):
        for extra in ['ARTHELLO_CHECKOUT=' + 'f' * 40, 'ARTHELLO_TREE=' + 'f' * 40,
                      'BROWSER_IMPORT_CAPACITY_KIB scratch_available=1', 'SERVER_BROWSER_BLOCKED=other',
                      '##[error]Process completed with exit code 1.',
                      '{"result":"absent","kind":"server-browser-image-retirement"}',
                      '{"kind":"server-browser-image-retirement","result":"absent","extra":1}']:
            with self.subTest(extra=extra):
                self.setUp()
                self.lines.append(extra)
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_echoed_source_is_not_proof_and_incomplete_or_oversized_logs_are_rejected(self):
        emitted = self.lines[:]
        self.lines = ['##[group]Run shell script'] + emitted + ['##[endgroup]']
        with self.assertRaises(AssertionError):
            self.validate()
        self.lines += emitted
        self.lines = ['2026-09-09T08:00:00.1234567Z ' + line for line in self.lines]
        self.validate()
        for extra in ('##[group]Unfinished', '##[endgroup]', 'x' * 1048577):
            with self.subTest(kind=extra[:24]):
                self.setUp()
                self.lines.append(extra)
                with self.assertRaises(AssertionError):
                    self.validate()

    def test_frozen_r11_source_or_run_is_never_an_r12_consumer(self):
        previous = copy.deepcopy(self.evidence['run'])
        previous.update(id=7000, path=replay.CONSUMER_PATH, status='in_progress', conclusion=None)
        for release, current_run, path in [
            (R11_OBSERVED['run']['head_sha'], 7000, replay.CONSUMER_PATH),
            ('a' * 40, R11_OBSERVED['run']['id'], replay.CONSUMER_PATH),
            ('a' * 40, 7000, R11_OBSERVED['run']['path']),
        ]:
            previous.update(id=current_run, head_sha=release, path=path)
            with self.subTest(release=release, current_run=current_run, path=path), self.assertRaises(AssertionError):
                replay.validate_history(dict(total_count=1, workflow_runs=[previous]),
                                        lambda path: self.fail('Frozen R11 cannot be authorized by replay evidence'),
                                        REPOSITORY, release, current_run, 1)

    def test_new_r10_retirement_is_ordered_and_mandatory_only_for_a_fresh_candidate(self):
        name = 'Retire only unused recoverable R10 images for import capacity under D086'
        self.assertIn(name, replay.CANDIDATE_IMPORTS)
        position = replay.CANDIDATE_PRESTEPS.index(name)
        self.assertEqual(replay.CANDIDATE_PRESTEPS[position - 1], 'Retire only the exact unused R9 browser image under D084')
        self.assertEqual(replay.CANDIDATE_PRESTEPS[position + 1], 'Measure import capacity before downloading the verified archive')
        case = CandidateReplayTests()
        case.setUp()
        self.assertTrue(case.validate())
        fresh = case.jobs['jobs'][1]['steps']
        next(step for step in fresh if step['name'] == name)['conclusion'] = 'skipped'
        with self.assertRaises(AssertionError):
            case.validate()
        for mode in ('success', 'missing', 'reordered'):
            with self.subTest(mode=mode):
                case.setUp()
                for job in case.jobs['jobs']:
                    job['run_attempt'] = 2
                steps = case.jobs['jobs'][1]['steps']
                for step in steps:
                    if step['name'] == 'Verify retained candidate before any replay skip':
                        step['conclusion'] = 'success'
                    if step['name'] in replay.CANDIDATE_IMPORTS:
                        step['conclusion'] = 'skipped'
                replay.validate_candidate_attempt(case.jobs, 2, lambda identity: case.log)
                target = next(step for step in steps if step['name'] == name)
                if mode == 'success':
                    target['conclusion'] = 'success'
                elif mode == 'missing':
                    steps.remove(target)
                else:
                    index = steps.index(target)
                    steps[index], steps[index + 1] = steps[index + 1], steps[index]
                with self.assertRaises(AssertionError):
                    replay.validate_candidate_attempt(case.jobs, 2, lambda identity: case.log)


if __name__ == '__main__':
    unittest.main()
