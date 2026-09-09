"""Read-only attestation of the pinned, failed old-live Education browser run."""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

REPOSITORY = 'vitaliyozolin-dotcom/ArtHello-OS'
SOURCE = '582edaf1a66a953edb2d61e03040d1a13e70a0ad'
RUN = 34314770145
JOB = 102348936617
BUNDLE = 102348573223
OBSERVED = '2026-09-09T05:29:05.827Z'
WORKFLOW = '.github/workflows/check-arthello-server-browser.yml'
EXPECTED_REPORT = dict(kind='server-natural-sso', result='blocked', stage='education',
                       reason='education_forbidden', liveAcceptance='not_passed',
                       sandboxStatus=dict(namespaces=True, pidNamespaces=True,
                                          networkNamespaces=True, seccomp=True),
                       observedAtUtc=OBSERVED)


def validate(run, jobs, log):
    assert run['id'] == RUN and run['head_sha'] == SOURCE and run['run_attempt'] == 1
    assert run['path'].split('@')[0] == WORKFLOW
    assert run['event'] == 'workflow_run' and run['head_branch'] == 'main'
    assert run['status'] == 'completed' and run['conclusion'] == 'failure'
    for key in ('repository', 'head_repository'):
        assert run[key]['full_name'] == REPOSITORY
    for key in ('actor', 'triggering_actor'):
        assert run[key]['login'] == 'vitaliyozolin-dotcom'
    assert jobs['total_count'] == len(jobs['jobs']) == 2
    by_name = {job['name']: job for job in jobs['jobs']}
    assert set(by_name) == {'bundle', 'natural-browser'}
    for name, identity, conclusion in [('bundle', BUNDLE, 'success'), ('natural-browser', JOB, 'failure')]:
        job = by_name[name]
        assert job['id'] == identity and job['run_id'] == RUN
        assert job['head_sha'] == SOURCE and job['run_attempt'] == 1
        assert job['status'] == 'completed' and job['conclusion'] == conclusion
    browser = [step for step in by_name['natural-browser']['steps']
               if step.get('name') == 'Run dedicated employee natural login and diary navigation']
    assert len(browser) == 1 and browser[0]['status'] == 'completed' and browser[0]['conclusion'] == 'failure'
    records = []
    for line in log.splitlines():
        content = re.sub(r'^\d{4}-\d\d-\d\dT\S+Z ', '', line)
        if not content.startswith('{'):
            continue
        try:
            record = json.loads(content)
        except (ValueError, TypeError):
            continue
        if isinstance(record, dict) and record.get('kind') == 'server-natural-sso':
            records.append(record)
    assert records == [EXPECTED_REPORT]
    return dict(kind='r9-historical-baseline', evidence='confirmed', result='blocked',
                stage='education', reason='education_forbidden', liveAcceptance='not_passed',
                testSourceSha=SOURCE, runId=RUN, runAttempt=1, jobId=JOB, observedAtUtc=OBSERVED)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def read_bounded(response, maximum):
    body = response.read(maximum + 1)
    assert len(body) <= maximum
    return body.decode('utf-8')


def fetch(path, *, logs=False):
    url = 'https://api.github.com/repos/' + REPOSITORY + path
    request = urllib.request.Request(url, headers={
        'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
        'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    opener = urllib.request.build_opener(NoRedirect())
    maximum = 1048576 if logs else 524288
    try:
        with opener.open(request, timeout=20) as response:
            body = read_bounded(response, maximum)
    except urllib.error.HTTPError as error:
        assert logs and error.code in (302, 307)
        location = error.headers.get('Location', '')
        parsed = urllib.parse.urlsplit(location)
        assert parsed.scheme == 'https' and parsed.hostname and parsed.port in (None, 443)
        assert parsed.username is None and parsed.password is None
        assert parsed.hostname.endswith('.blob.core.windows.net')
        # Never forward GitHub authorization to the signed log-storage URL.
        with opener.open(urllib.request.Request(location), timeout=20) as response:
            body = read_bounded(response, maximum)
    return body if logs else json.loads(body)


def main():
    try:
        report = validate(fetch('/actions/runs/' + str(RUN)),
                          fetch('/actions/runs/' + str(RUN) + '/attempts/1/jobs?per_page=100'),
                          fetch('/actions/jobs/' + str(JOB) + '/logs', logs=True))
    except Exception:
        raise SystemExit('ARTHELLO_D080_BASELINE_EVIDENCE=BLOCKED')
    print(json.dumps(report, separators=(',', ':')))


if __name__ == '__main__':
    main()
