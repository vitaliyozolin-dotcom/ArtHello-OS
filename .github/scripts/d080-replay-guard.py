import json, os, urllib.request

INSTALL_SHA = 'ee8f3080d941a12be357eec0fd1d902acd01a2f9'
INSTALL_RUN = 34208952716
INSTALL_JOB = 102005327418
INSTALL_PATH = '.github/workflows/deploy-arthello-recovery-r5-20260908.yml'
CONSUMER_PATH = '.github/workflows/deploy-arthello-recovery-r9-20260909.yml'
PREVIOUS_SHA = 'eb47c1360fbd701876a3c49efe029194707304db'
PREVIOUS_RUN = 34221458013
PREVIOUS_JOB = 102045375780
PREVIOUS_PATH = '.github/workflows/deploy-arthello-recovery-r6-20260908.yml'

def safe_previous_job(job):
    if job.get('status') != 'completed':
        return False
    if job.get('conclusion') == 'skipped' and not job.get('steps'):
        return True
    cutovers = [step for step in job.get('steps', []) if step.get('name') == 'Clone preflight and guarded production cutover']
    verifications = [step for step in job.get('steps', []) if step.get('name') == 'Verify installed R5 School relay with fresh receipt']
    return (len(cutovers) == 1 and cutovers[0].get('conclusion') == 'skipped' and
            len(verifications) == 1 and verifications[0].get('conclusion') in ('success', 'skipped'))

def validate_installation(run, jobs, repository):
    assert run['id'] == INSTALL_RUN and run['head_sha'] == INSTALL_SHA
    assert run['path'].split('@')[0] == INSTALL_PATH
    assert run['repository']['full_name'] == repository and run['head_repository']['full_name'] == repository
    assert run['event'] == 'workflow_run' and run['head_branch'] == 'main'
    assert run['actor']['login'] == 'vitaliyozolin-dotcom' and run['triggering_actor']['login'] == 'vitaliyozolin-dotcom'
    assert run['run_attempt'] == 1 and run['status'] == 'completed' and run['conclusion'] == 'failure'
    assert jobs['total_count'] == len(jobs['jobs']) == 1
    job = jobs['jobs'][0]
    assert job['id'] == INSTALL_JOB and job['name'] == 'deploy' and job['run_attempt'] == 1
    assert job['status'] == 'completed' and job['conclusion'] == 'failure'
    expectations = {
        'Repair School egress configuration with durable receipt': 'success',
        'Read-only School diagnostic and real browser acceptance': 'failure',
        'Clone preflight and guarded production cutover': 'skipped',
    }
    for name, conclusion in expectations.items():
        matching = [step for step in job['steps'] if step.get('name') == name]
        assert len(matching) == 1 and matching[0].get('conclusion') == conclusion

def validate_previous_attempt(jobs, attempt):
    assert jobs['total_count'] == len(jobs['jobs']), 'Attempt jobs pagination incomplete'
    names = [job['name'] for job in jobs['jobs']]
    assert len(names) == 2 and len(names) == len(set(names)), 'Incomplete or duplicate release jobs'
    assert set(names) == {'bundle', 'deploy'}, 'Missing or unknown release capability job'
    for job in jobs['jobs']:
        assert job['run_attempt'] == attempt
        if job['name'] == 'bundle':
            assert job['status'] == 'completed'
            assert job['conclusion'] in ('success', 'failure', 'cancelled', 'skipped')
            assert 'ubuntu-latest' in job.get('labels', []) and 'self-hosted' not in job['labels']
        else:
            assert safe_previous_job(job), 'A previous cutover started or its absence cannot be proven'

def run():
    repository = os.environ['EXPECTED_REPOSITORY']
    release = os.environ['RELEASE_SHA']
    assert release not in (INSTALL_SHA, PREVIOUS_SHA, 'dbe630145a3828643fcfb9f202b1239e8cc54826', R8_SHA), 'R9 candidate identity must differ from preserved releases'
    current_run = int(os.environ['GITHUB_RUN_ID'])
    current_attempt = int(os.environ['GITHUB_RUN_ATTEMPT'])
    api = 'https://api.github.com/repos/' + repository
    def get(path):
        request = urllib.request.Request(api + path, headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    # The verified R5 is a preserved prerequisite, never a rearmed failed consumer.
    validate_installation(get('/actions/runs/' + str(INSTALL_RUN)),
                         get('/actions/runs/' + str(INSTALL_RUN) + '/attempts/1/jobs?per_page=100'), repository)
    validate_r6_abort(get('/actions/runs/' + str(PREVIOUS_RUN)),
                      get('/actions/runs/' + str(PREVIOUS_RUN) + '/attempts/1/jobs?per_page=100'), repository)
    validate_r7_abort(get('/actions/runs/34227595623'),
                      get('/actions/runs/34227595623/attempts/1/jobs?per_page=100'), repository)
    validate_r8_abort(get('/actions/runs/' + str(R8_RUN)),
                      get('/actions/runs/' + str(R8_RUN) + '/attempts/1/jobs?per_page=100'), repository)
    runs = get('/actions/workflows/' + CONSUMER_PATH.split('/')[-1] + '/runs?event=workflow_run&head_sha=' + release + '&per_page=100')
    validate_history(runs, get, repository, release, current_run, current_attempt)
    print('ARTHELLO_D080_PRESERVED_R5_AND_R8_ABORT_REPLAY_BOUNDARY=VERIFIED')

def validate_r6_abort(run, jobs, repository):
    assert run['id'] == PREVIOUS_RUN and run['head_sha'] == PREVIOUS_SHA
    assert run['path'].split('@')[0] == PREVIOUS_PATH
    assert run['repository']['full_name'] == repository and run['head_repository']['full_name'] == repository
    assert run['event'] == 'workflow_run' and run['head_branch'] == 'main'
    assert run['actor']['login'] == 'vitaliyozolin-dotcom' and run['triggering_actor']['login'] == 'vitaliyozolin-dotcom'
    assert run['run_attempt'] == 1 and run['status'] == 'completed' and run['conclusion'] == 'failure'
    assert jobs['total_count'] == len(jobs['jobs']) == 1
    job = jobs['jobs'][0]
    assert job['id'] == PREVIOUS_JOB and job['name'] == 'deploy' and job['run_attempt'] == 1
    assert job['status'] == 'completed' and job['conclusion'] == 'failure'
    expected = {'Verify installed R5 School relay with fresh receipt':'success',
                'Check existing gateway backup installation capability':'failure',
                'Read-only School diagnostic and real browser acceptance':'skipped',
                'Clone preflight and guarded production cutover':'skipped'}
    for name, conclusion in expected.items():
        matching = [step for step in job['steps'] if step.get('name') == name]
        assert len(matching) == 1 and matching[0].get('conclusion') == conclusion


def validate_r7_abort(run, jobs, repository):
    assert run['id'] == 34227595623 and run['head_sha'] == 'dbe630145a3828643fcfb9f202b1239e8cc54826'
    assert run['path'].split('@')[0] == '.github/workflows/deploy-arthello-recovery-r7-20260908.yml'
    assert run['repository']['full_name'] == repository and run['head_repository']['full_name'] == repository
    assert run['event'] == 'workflow_run' and run['head_branch'] == 'main'
    assert run['actor']['login'] == 'vitaliyozolin-dotcom' and run['triggering_actor']['login'] == 'vitaliyozolin-dotcom'
    assert run['run_attempt'] == 1 and run['status'] == 'completed' and run['conclusion'] == 'failure'
    assert jobs['total_count'] == len(jobs['jobs']) == 1
    job = jobs['jobs'][0]
    assert job['id'] == 102065872459 and job['name'] == 'deploy' and job['run_attempt'] == 1
    assert job['status'] == 'completed' and job['conclusion'] == 'failure'
    expected = {'Verify installed R5 School relay with fresh receipt': 'success',
                'Check existing gateway Docker authority': 'success',
                'Read-only School diagnostic and real browser acceptance': 'failure',
                'Download and load exact hosted-verified image': 'skipped',
                'Verify and load exact hosted-verified image': 'skipped',
                'Resolve authoritative School sync secret': 'skipped',
                'Clone preflight and guarded production cutover': 'skipped'}
    for name, conclusion in expected.items():
        matching = [step for step in job['steps'] if step.get('name') == name]
        assert len(matching) == 1 and matching[0].get('conclusion') == conclusion


R8_RUN = 34283447507
R8_SHA = '5385090d48f4dae29c314dff7ae974d854560940'
R8_PATH = '.github/workflows/deploy-arthello-recovery-r8-20260908.yml'
# Immutable, complete step graph observed from /attempts/1/jobs on 2026-09-09.
# No log bodies, credentials or browser page data are consumed by this guard.
R8_STEPS = {
    "bundle": [
        ("Set up job", 1, "success"),
        ("Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262", 2, "success"),
        ("Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020", 3, "success"),
        ("Test browser policy and install locked package off the VPS", 4, "success"),
        ("Build immutable bundle and exercise Chromium sandbox and natural flow fixture", 5, "success"),
        ("Run actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02", 6, "success"),
        ("Post Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020", 11, "success"),
        ("Post Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262", 12, "success"),
        ("Complete job", 13, "success"),
    ],
    "deploy": [
        ("Set up job", 1, "success"),
        ("Verify D078 R8 identity and preserved R5 R7 abort boundary", 2, "success"),
        ("Wait for exact main Quality Proof and v52 verification", 3, "success"),
        ("Check out exact verified release", 4, "success"),
        ("Verify checkout and release contracts", 5, "success"),
        ("Verify installed R5 School relay with fresh receipt", 6, "success"),
        ("Check existing gateway Docker authority", 7, "success"),
        ("Check current release and existing browser runtime", 8, "success"),
        ("Measure import capacity before downloading the verified archive", 9, "success"),
        ("Run actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093", 10, "success"),
        ("Verify archive, import off-host bundle and verify portable identity", 11, "success"),
        ("School diagnostic and real browser acceptance before cutover", 12, "failure"),
        ("Download and load exact hosted-verified image", 13, "skipped"),
        ("Verify and load exact hosted-verified image", 14, "skipped"),
        ("Resolve authoritative School sync secret", 15, "skipped"),
        ("Clone preflight and guarded production cutover", 16, "skipped"),
        ("School diagnostic and real browser acceptance after cutover", 17, "skipped"),
        ("Remove only this downloaded temporary archive", 18, "success"),
        ("Remove temporary School SSH material", 19, "success"),
        ("Production summary", 20, "success"),
        ("Post Check out exact verified release", 40, "success"),
        ("Complete job", 41, "success"),
    ],
}


def validate_r8_abort(run, jobs, repository):
    assert run['id'] == R8_RUN and run['head_sha'] == R8_SHA
    assert run['path'].split('@')[0] == R8_PATH
    assert run['repository']['full_name'] == repository and run['head_repository']['full_name'] == repository
    assert run['event'] == 'workflow_run' and run['head_branch'] == 'main'
    assert run['actor']['login'] == 'vitaliyozolin-dotcom' and run['triggering_actor']['login'] == 'vitaliyozolin-dotcom'
    assert run['run_attempt'] == 1 and run['status'] == 'completed' and run['conclusion'] == 'failure'
    assert jobs['total_count'] == len(jobs['jobs']) == 2, 'R8 attempt jobs pagination incomplete'
    names = [job['name'] for job in jobs['jobs']]
    assert len(set(names)) == 2 and set(names) == {'bundle', 'deploy'}, 'R8 job graph mismatch'
    expected_jobs = {'bundle': (102253627289, 'success', ['ubuntu-latest']),
                     'deploy': (102254222317, 'failure', ['self-hosted', 'linux', 'x64', 'arthello-gateway'])}
    for job in jobs['jobs']:
        identity, conclusion, labels = expected_jobs[job['name']]
        assert job['id'] == identity and job['run_id'] == R8_RUN and job['run_attempt'] == 1
        assert job['head_sha'] == R8_SHA and job['head_branch'] == 'main'
        assert job['status'] == 'completed' and job['conclusion'] == conclusion
        assert job['labels'] == labels, 'R8 runner identity mismatch'
        steps = job['steps']
        assert all(step['status'] == 'completed' for step in steps)
        observed = [(step['name'], step['number'], step['conclusion']) for step in steps]
        assert observed == R8_STEPS[job['name']], 'R8 complete abort step graph mismatch'


def validate_history(runs, get, repository, release, current_run, current_attempt):
    assert runs['total_count'] == len(runs['workflow_runs']), 'Replay history pagination incomplete'
    identities = [previous['id'] for previous in runs['workflow_runs']]
    assert all(type(identity) is int and identity > 0 for identity in identities)
    assert len(set(identities)) == len(identities), 'Replay history contains duplicate runs'
    assert identities.count(current_run) == 1, 'Current run is missing from complete replay history'
    assert type(current_attempt) is int and 1 <= current_attempt <= 50
    for previous in runs['workflow_runs']:
        assert previous['head_sha'] == release
        assert previous['repository']['full_name'] == repository and previous['head_repository']['full_name'] == repository
        assert previous['path'].split('@')[0] == CONSUMER_PATH
        assert previous['event'] == 'workflow_run' and previous['head_branch'] == 'main'
        assert previous['actor']['login'] == 'vitaliyozolin-dotcom' and previous['triggering_actor']['login'] == 'vitaliyozolin-dotcom'
        attempt_count = previous['run_attempt']
        assert type(attempt_count) is int and 1 <= attempt_count <= 50
        if previous['id'] == current_run:
            assert attempt_count == current_attempt
            attempts = range(1, current_attempt)
        else:
            assert previous['status'] == 'completed', 'Another release run is active'
            assert previous['conclusion'] in ['failure', 'cancelled', 'skipped'], 'Successful or ambiguous release cannot be replayed'
            attempts = range(1, attempt_count + 1)
        for attempt in attempts:
            jobs = get('/actions/runs/' + str(previous['id']) + '/attempts/' + str(attempt) + '/jobs?per_page=100')
            validate_previous_attempt(jobs, attempt)
            job_ids = [job['id'] for job in jobs['jobs']]
            assert all(type(identity) is int and identity > 0 for identity in job_ids)
            assert len(job_ids) == len(set(job_ids)), 'Replay jobs contain duplicate identities'
            for job in jobs['jobs']:
                assert job['run_id'] == previous['id'] and job['head_sha'] == release
                assert job['head_branch'] == 'main'
                if job['name'] == 'deploy' and job.get('steps'):
                    after = [step for step in job.get('steps', []) if step.get('name') == 'School diagnostic and real browser acceptance after cutover']
                    assert len(after) == 1 and after[0].get('conclusion') == 'skipped', 'Post-cutover execution or missing evidence prohibits replay'


if __name__ == '__main__':
    run()
