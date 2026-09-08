import json, os, urllib.request

def safe_previous_job(job):
    if job.get('status') != 'completed':
        return False
    if job.get('conclusion') == 'skipped' and not job.get('steps'):
        return True
    cutovers = [step for step in job.get('steps', []) if step.get('name') == 'Clone preflight and guarded production cutover']
    return len(cutovers) == 1 and cutovers[0].get('conclusion') == 'skipped'

def run():
    repository = os.environ['EXPECTED_REPOSITORY']
    release = os.environ['RELEASE_SHA']
    current_run = int(os.environ['GITHUB_RUN_ID'])
    current_attempt = int(os.environ['GITHUB_RUN_ATTEMPT'])
    api = 'https://api.github.com/repos/' + repository
    def get(path):
        request = urllib.request.Request(api + path, headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    runs = get('/actions/workflows/deploy-arthello-recovery-20260908.yml/runs?event=workflow_run&head_sha=' + release + '&per_page=100')
    assert runs['total_count'] == len(runs['workflow_runs']), 'Replay history pagination incomplete'
    assert 1 <= current_attempt <= 50
    for previous in runs['workflow_runs']:
        assert previous['head_sha'] == release and previous['repository']['full_name'] == repository
        assert previous['path'].split('@')[0] == '.github/workflows/deploy-arthello-recovery-20260908.yml'
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
    print('ARTHELLO_D063_REPLAY_BOUNDARY=VERIFIED')

if __name__ == '__main__':
    run()
