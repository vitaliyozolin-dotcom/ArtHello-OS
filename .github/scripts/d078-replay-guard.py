import json, os, urllib.request

INSTALL_SHA = 'ee8f3080d941a12be357eec0fd1d902acd01a2f9'
INSTALL_RUN = 34208952716
INSTALL_JOB = 102005327418
INSTALL_PATH = '.github/workflows/deploy-arthello-recovery-r5-20260908.yml'
CONSUMER_PATH = '.github/workflows/deploy-arthello-recovery-r8-20260908.yml'
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

def run():
    repository = os.environ['EXPECTED_REPOSITORY']
    release = os.environ['RELEASE_SHA']
    assert release != INSTALL_SHA, 'R8 candidate identity must differ from preserved installation'
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
    runs = get('/actions/workflows/' + CONSUMER_PATH.split('/')[-1] + '/runs?event=workflow_run&head_sha=' + release + '&per_page=100')
    assert runs['total_count'] == len(runs['workflow_runs']), 'Replay history pagination incomplete'
    identities = [previous['id'] for previous in runs['workflow_runs']]
    assert len(set(identities)) == len(identities), 'Replay history contains duplicate runs'
    assert identities.count(current_run) == 1, 'Current run is missing from complete replay history'
    assert 1 <= current_attempt <= 50
    for previous in runs['workflow_runs']:
        assert previous['head_sha'] == release and previous['repository']['full_name'] == repository
        assert previous['path'].split('@')[0] == CONSUMER_PATH
        attempt_count = int(previous['run_attempt'])
        assert 1 <= attempt_count <= 50
        if previous['id'] == current_run:
            assert attempt_count == current_attempt
            attempts = range(1, current_attempt)
        else:
            assert previous['status'] == 'completed', 'Another release run is active'
            assert previous['conclusion'] in ['failure', 'cancelled', 'skipped'], 'Successful or ambiguous release cannot be replayed'
            attempts = range(1, attempt_count + 1)
        for attempt in attempts:
            jobs = get('/actions/runs/' + str(previous['id']) + '/attempts/' + str(attempt) + '/jobs?per_page=100')
            assert jobs['total_count'] == len(jobs['jobs']), 'Attempt jobs pagination incomplete'
            assert len(jobs['jobs']) <= 1
            for job in jobs['jobs']:
                assert job['name'] == 'deploy' and job['run_attempt'] == attempt
                assert safe_previous_job(job), 'A previous cutover started or its absence cannot be proven'
    print('ARTHELLO_D078_PRESERVED_R5_AND_R7_ABORT_REPLAY_BOUNDARY=VERIFIED')

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

if __name__ == '__main__':
    run()
