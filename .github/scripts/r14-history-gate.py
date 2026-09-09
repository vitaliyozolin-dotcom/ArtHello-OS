"""Pure R14 history gate: accepted R13 success plus preserved candidate replay rules."""
import ast
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPOSITORY = 'vitaliyozolin-dotcom/ArtHello-OS'
OWNER = 'vitaliyozolin-dotcom'
ACCEPTED_SOURCE = 'f5fa3e46e3510e6fc98ae4455f4b499c0ba30695'
ACCEPTED_TREE = '3f49b1b7c0e3ed6dfdaaafbccc071386c9b5edde'
ACCEPTED_IMAGE = 'sha256:99b77401c79bb439d3ecbc06d6895b22aae311b3264c27be7dcdf9fabb4b3554'
ACCEPTED_RUN = 34340461537
ACCEPTED_PATH = '.github/workflows/deploy-arthello-recovery-r13-20260909.yml'
CONSUMER_PATH = '.github/workflows/deploy-arthello-recovery-r14-20260909.yml'
FROZEN_SHA256 = 'c8340b7073272dc2c56ea6cb0d3e4d1516fbb8b7e0b5ea5d4eb0b09bc210a9d8'
FROZEN_FUNCTIONS_SHA256 = '0d579abf075cbf84c9ca92e4f39e1855843bfcad24aa14edfe6ad09287250ca9'
FORBIDDEN_SOURCES = {
    ACCEPTED_SOURCE, '77f26ec9bcba7233f39d5e8cb9f59c276bc8c1ed', 'ee8f3080d941a12be357eec0fd1d902acd01a2f9',
    'eb47c1360fbd701876a3c49efe029194707304db', 'dbe630145a3828643fcfb9f202b1239e8cc54826',
    '5385090d48f4dae29c314dff7ae974d854560940', '30f825d674cbf498be713c7b637e1dfd9f9c42cd',
    '2e57dd22c6ff1cec1fcad0bd11af479e465c00bb', 'e579a20a2a1a40fab489340511f8c35dc6929081',
}
FORBIDDEN_RUNS = {ACCEPTED_RUN, 34326582961, 34208952716, 34221458013, 34227595623,
                  34283447507, 34318973875, 34322039891, 34324235442}
ACCEPTED_JOBS = {'bundle': 102430072322, 'deploy': 102430586207}
LABELS = {'bundle': ['ubuntu-latest'], 'deploy': ['self-hosted', 'linux', 'x64', 'arthello-gateway']}
# Complete observed /attempts/1/jobs graph, independently read from accepted R13.
ACCEPTED_STEPS = {'bundle': [['Set up job', 1, 'success'], ['Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262', 2, 'success'], ['Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', 3, 'success'], ['Test browser policy and install locked package off the VPS', 4, 'success'], ['Build immutable bundle and exercise Chromium sandbox and natural flow fixture', 5, 'success'], ['Run actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02', 6, 'success'], ['Post Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', 11, 'success'], ['Post Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262', 12, 'success'], ['Complete job', 13, 'success']], 'deploy': [['Set up job', 1, 'success'], ['Verify R13 identity and accepted R12 success history', 2, 'success'], ['Wait for exact main Quality Proof and v52 verification', 3, 'success'], ['Check out exact verified release', 4, 'success'], ['Verify R13 checkout and release contracts', 5, 'success'], ['Verify retained R13 candidate before any replay skip', 6, 'skipped'], ['Verify accepted R12 baseline and preserved School relay', 7, 'success'], ['Check existing gateway Docker authority', 8, 'success'], ['Check current release and existing browser runtime', 9, 'success'], ['Retire only the exact unused accepted R12 browser image', 10, 'success'], ['Measure import capacity before downloading the verified archive', 11, 'success'], ['Run actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093', 12, 'success'], ['Verify archive, import off-host bundle and verify portable identity', 13, 'success'], ['Read-only School diagnostic before candidate acceptance', 14, 'success'], ['Download and load exact hosted-verified image', 15, 'success'], ['Verify and load exact hosted-verified image', 16, 'success'], ['Verify actual gateway Caddy with isolated candidate fixture', 17, 'success'], ['Resolve authoritative School sync secret', 18, 'success'], ['Clone fresh snapshot and guarded R13 production cutover', 19, 'success'], ['School diagnostic and real browser acceptance after R13 cutover', 20, 'success'], ['Remove only this downloaded temporary archive', 21, 'success'], ['Remove temporary School SSH material', 22, 'success'], ['Production summary', 23, 'success'], ['Post Check out exact verified release', 46, 'success'], ['Complete job', 47, 'success']]}

IDENTITY_STEP = 'Verify R14 identity and accepted R13 success history'
RESUME_STEP = 'Verify retained R14 candidate before any replay skip'
LIVE_STEP = 'Verify accepted R13 baseline and preserved School relay'
CUTOVER_STEP = 'Clone fresh snapshot and guarded R14 production cutover'
POST_STEP = 'School diagnostic and real browser acceptance after R14 cutover'
PRESTEPS = [
    'Set up job', IDENTITY_STEP, 'Wait for exact main Quality Proof and v52 verification',
    'Check out exact verified release', 'Verify R14 checkout and release contracts', RESUME_STEP, LIVE_STEP,
    'Check existing gateway Docker authority', 'Check current release and existing browser runtime',
    'Retire only the exact unused accepted R13 browser image',
    'Measure import capacity before downloading the verified archive',
    'Run actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
    'Verify archive, import off-host bundle and verify portable identity',
    'Read-only School diagnostic before candidate acceptance',
    'Download and load exact hosted-verified image', 'Verify and load exact hosted-verified image',
    'Verify actual gateway Caddy with isolated candidate fixture', 'Resolve authoritative School sync secret',
]
IMPORTS = {
    'Retire only the exact unused accepted R13 browser image',
    'Measure import capacity before downloading the verified archive',
    'Run actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
    'Verify archive, import off-host bundle and verify portable identity',
    'Download and load exact hosted-verified image', 'Verify and load exact hosted-verified image',
    'Resolve authoritative School sync secret',
}
POSTSTEPS = [POST_STEP, 'Remove only this downloaded temporary archive', 'Remove temporary School SSH material',
             'Production summary', 'Post Check out exact verified release', 'Complete job']
RENAMES = {
    'Verify installed R5 School relay with fresh receipt': LIVE_STEP,
    'Verify retained candidate before any replay skip': RESUME_STEP,
    'Clone preflight and guarded production cutover': CUTOVER_STEP,
    'School diagnostic and real browser acceptance after cutover': POST_STEP,
}

class Refused(Exception):
    pass

def require(condition, code):
    if not condition:
        raise Refused(code)

def load_protocol(frozen_functions=None):
    # Parse and execute the exact checked bytes, never reopen after hashing.
    names = {'safe_previous_job', 'validate_previous_attempt', 'validate_history', 'validate_candidate_attempt'}
    if frozen_functions is None:
        path = Path(__file__).with_name('d080-replay-guard.py')
        raw = path.read_bytes()
        require(hashlib.sha256(raw).hexdigest() == FROZEN_SHA256, 'FROZEN_HISTORY_DRIFT')
        text = raw.decode('utf-8')
        original = ast.parse(text)
        frozen_functions = ('\n\n'.join(ast.get_source_segment(text, node) for node in original.body
                            if isinstance(node, ast.FunctionDef) and node.name in names) + '\n').encode()
    require(type(frozen_functions) is bytes and hashlib.sha256(frozen_functions).hexdigest() == FROZEN_FUNCTIONS_SHA256,
            'FROZEN_FUNCTIONS_DRIFT')
    module = ast.parse(frozen_functions, filename='<frozen-d080-history>')
    functions = [node for node in module.body if isinstance(node, ast.FunctionDef) and node.name in names]
    require(len(functions) == len(names) and {node.name for node in functions} == names, 'FROZEN_HISTORY_SHAPE')
    class Rename(ast.NodeTransformer):
        def visit_Constant(self, node):
            if isinstance(node.value, str) and node.value in RENAMES:
                return ast.copy_location(ast.Constant(RENAMES[node.value]), node)
            return node
    selected = ast.fix_missing_locations(Rename().visit(ast.Module(body=functions, type_ignores=[])))
    namespace = {'re': re, 'CONSUMER_PATH': CONSUMER_PATH,
                 'CANDIDATE_PRESTEPS': PRESTEPS, 'CANDIDATE_IMPORTS': IMPORTS,
                 'CANDIDATE_POSTSTEPS': POSTSTEPS}
    # Assertions remain active even if a caller starts Python with optimization.
    exec(compile(selected, '<frozen-d080-history>', 'exec', optimize=0), namespace)
    return namespace

def identity(run, source, path):
    require(isinstance(run, dict) and run.get('head_sha') == source and run.get('path') == path
            and run.get('repository', {}).get('full_name') == REPOSITORY
            and run.get('head_repository', {}).get('full_name') == REPOSITORY
            and run.get('event') == 'workflow_run' and run.get('head_branch') == 'main'
            and run.get('actor', {}).get('login') == OWNER
            and run.get('triggering_actor', {}).get('login') == OWNER, 'RUN_IDENTITY_INVALID')

def complete_jobs(value):
    require(isinstance(value, dict) and type(value.get('total_count')) is int
            and isinstance(value.get('jobs'), list) and value['total_count'] == len(value['jobs']) == 2,
            'JOB_INVENTORY_INCOMPLETE')
    rows = value['jobs']
    require(all(isinstance(job, dict) for job in rows)
            and {job.get('name') for job in rows} == {'bundle', 'deploy'}, 'JOB_GRAPH_INVALID')
    ids = [job.get('id') for job in rows]
    require(all(type(item) is int and item > 0 for item in ids) and len(set(ids)) == 2, 'JOB_ID_INVALID')
    for job in rows:
        require(job.get('labels') == LABELS[job['name']], 'JOB_RUNNER_INVALID')
        require(type(job.get('run_id')) is int and job['run_id'] > 0
                and type(job.get('run_attempt')) is int and 1 <= job['run_attempt'] <= 50,
                'JOB_ATTEMPT_INVALID')
    return rows

def accepted_success(run, jobs, commit):
    identity(run, ACCEPTED_SOURCE, ACCEPTED_PATH)
    require(type(run.get('id')) is int and run['id'] == ACCEPTED_RUN
            and type(run.get('run_attempt')) is int and run['run_attempt'] == 1
            and run.get('name') == 'Deploy ArtHello recovery R13 D096'
            and run.get('status') == 'completed' and run.get('conclusion') == 'success', 'R13_SUCCESS_REQUIRED')
    require(isinstance(commit, dict) and commit.get('sha') == ACCEPTED_SOURCE
            and commit.get('tree', {}).get('sha') == ACCEPTED_TREE, 'R13_TREE_INVALID')
    for job in complete_jobs(jobs):
        require(job['id'] == ACCEPTED_JOBS[job['name']] and job.get('run_id') == ACCEPTED_RUN
                and type(job.get('run_attempt')) is int and job['run_attempt'] == 1
                and job.get('head_sha') == ACCEPTED_SOURCE and job.get('head_branch') == 'main'
                and job.get('status') == 'completed' and job.get('conclusion') == 'success', 'R13_JOB_INVALID')
        steps = job.get('steps')
        require(isinstance(steps, list) and all(isinstance(step, dict) and step.get('status') == 'completed'
                and type(step.get('number')) is int for step in steps), 'R13_STEP_INVALID')
        observed = [[step.get('name'), step.get('number'), step.get('conclusion')] for step in steps]
        require(observed == ACCEPTED_STEPS[job['name']], 'R13_COMPLETE_STEP_GRAPH_INVALID')

def validate_gate(accepted_run, accepted_jobs, accepted_commit, runs, get_attempt_jobs, get_candidate_logs,
                  release, current_run, current_attempt, frozen_functions=None):
    """No restore authorization. A resume result requires the separate durable runtime verifier."""
    try:
        accepted_success(accepted_run, accepted_jobs, accepted_commit)
        require(isinstance(release, str) and re.fullmatch(r'[a-f0-9]{40}', release)
                and release not in FORBIDDEN_SOURCES and type(current_run) is int and current_run > 0
                and current_run not in FORBIDDEN_RUNS and type(current_attempt) is int
                and 1 <= current_attempt <= 50, 'FRESH_R14_IDENTITY_REQUIRED')
        require(isinstance(runs, dict) and type(runs.get('total_count')) is int
                and isinstance(runs.get('workflow_runs'), list)
                and runs['total_count'] == len(runs['workflow_runs']) <= 100, 'HISTORY_INCOMPLETE')
        for run in runs['workflow_runs']:
            identity(run, release, CONSUMER_PATH)
            if run.get('id') == current_run:
                require(run.get('status') == 'in_progress' and run.get('conclusion') is None, 'CURRENT_RUN_NOT_ACTIVE')
        def jobs(path):
            require(isinstance(path, str) and re.fullmatch(r'/actions/runs/[1-9][0-9]*/attempts/[1-9][0-9]*/jobs\?per_page=100', path),
                    'ATTEMPT_PATH_INVALID')
            value = get_attempt_jobs(path)
            for job in complete_jobs(value):
                steps = job.get('steps')
                if job['name'] == 'deploy' and steps:
                    require(isinstance(steps, list) and all(isinstance(step, dict) for step in steps)
                            and [step.get('name') for step in steps] == PRESTEPS + [CUTOVER_STEP] + POSTSTEPS,
                            'R14_COMPLETE_STEP_GRAPH_INVALID')
                    numbers = [step.get('number') for step in steps]
                    require(all(type(number) is int and number > 0 for number in numbers)
                            and numbers == sorted(set(numbers))
                            and all(step.get('status') == 'completed'
                                    and step.get('conclusion') in ('success', 'failure', 'cancelled', 'skipped') for step in steps),
                            'R14_STEP_STATE_INVALID')
            return value
        protocol = load_protocol(frozen_functions)
        resume = protocol['validate_history'](runs, jobs, REPOSITORY, release, current_run, current_attempt,
                                               get_logs=get_candidate_logs)
        return {'schemaVersion': 14, 'history': 'verified', 'mode': 'resume_candidate' if resume else 'fresh',
                'acceptedSource': ACCEPTED_SOURCE, 'acceptedTree': ACCEPTED_TREE,
                'acceptedRun': ACCEPTED_RUN, 'dataRestoreAuthorized': False,
                'retainedRuntimeVerificationRequired': resume}
    except Refused:
        raise
    except Exception:
        # Metadata, log bodies, transport failures and arbitrary exception text never escape.
        raise Refused('HISTORY_EVIDENCE_INVALID') from None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, 'DUPLICATE_EVIDENCE_KEY')
        value[key] = item
    return value


class GitHubEvidence:
    """Fixed read-only endpoints; logs can belong only to this run's earlier deploy."""
    def __init__(self, token, release, current_run, current_attempt, opener=None):
        require(isinstance(token, str) and bool(token), 'GITHUB_TOKEN_REQUIRED')
        self.token, self.release, self.current_run, self.current_attempt = token, release, current_run, current_attempt
        self.opener = opener or urllib.request.build_opener(NoRedirect())
        self.requests, self.log_jobs = 0, set()
        self.api = 'https://api.github.com/repos/' + REPOSITORY
        self.history_path = '/actions/workflows/' + CONSUMER_PATH.split('/')[-1] + '/runs?event=workflow_run&head_sha=' + release + '&per_page=100'

    def open(self, request):
        self.requests += 1
        require(self.requests <= 128, 'EVIDENCE_REQUEST_LIMIT')
        return self.opener.open(request, timeout=20)

    def request(self, path):
        return urllib.request.Request(self.api + path, headers={'Authorization': 'Bearer ' + self.token,
            'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})

    def get(self, path):
        fixed = {'/actions/runs/' + str(ACCEPTED_RUN),
                 '/actions/runs/' + str(ACCEPTED_RUN) + '/attempts/1/jobs?per_page=100',
                 '/git/commits/' + ACCEPTED_SOURCE, self.history_path}
        require(path in fixed or re.fullmatch(r'/actions/runs/[1-9][0-9]*/attempts/[1-9][0-9]*/jobs\?per_page=100', path),
                'METADATA_PATH_NOT_ALLOWED')
        with self.open(self.request(path)) as response:
            raw = response.read(2 * 1048576 + 1)
        require(len(raw) <= 2 * 1048576, 'METADATA_TOO_LARGE')
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object)
        if isinstance(value, dict) and isinstance(value.get('jobs'), list):
            for job in value['jobs']:
                if (isinstance(job, dict) and job.get('name') == 'deploy' and job.get('run_id') == self.current_run
                        and job.get('head_sha') == self.release and type(job.get('run_attempt')) is int
                        and 1 <= job['run_attempt'] < self.current_attempt and type(job.get('id')) is int and job['id'] > 0):
                    self.log_jobs.add(job['id'])
        return value

    def logs(self, job_id):
        require(type(job_id) is int and job_id in self.log_jobs, 'LOG_JOB_NOT_VALIDATED')
        try:
            response = self.open(self.request('/actions/jobs/' + str(job_id) + '/logs'))
        except urllib.error.HTTPError as error:
            require(error.code in (302, 307), 'LOG_REDIRECT_INVALID')
            location = error.headers.get('Location', '')
            parsed = urllib.parse.urlsplit(location)
            require(parsed.scheme == 'https' and parsed.hostname and parsed.hostname.endswith('.blob.core.windows.net')
                    and parsed.port in (None, 443) and parsed.username is None and parsed.password is None
                    and not parsed.fragment, 'LOG_REDIRECT_INVALID')
            # The bearer token is never forwarded to the short-lived blob URL.
            response = self.open(urllib.request.Request(location))
        with response:
            raw = response.read(1048576 + 1)
        require(len(raw) <= 1048576, 'LOG_TOO_LARGE')
        return raw.decode('utf-8')


def cli_context(environment):
    require(environment.get('EXPECTED_REPOSITORY') == REPOSITORY
            and environment.get('GITHUB_REPOSITORY') == REPOSITORY
            and environment.get('GITHUB_ACTOR') == OWNER
            and environment.get('GITHUB_TRIGGERING_ACTOR') == OWNER
            and environment.get('GITHUB_EVENT_NAME') == 'workflow_run', 'PROTECTED_HISTORY_CONTEXT_REQUIRED')
    release = environment.get('RELEASE_SHA', '')
    run, attempt = environment.get('GITHUB_RUN_ID', ''), environment.get('GITHUB_RUN_ATTEMPT', '')
    require(re.fullmatch(r'[a-f0-9]{40}', release) and re.fullmatch(r'[1-9][0-9]*', run)
            and re.fullmatch(r'[1-9][0-9]*', attempt) and 1 <= int(attempt) <= 50
            and release not in FORBIDDEN_SOURCES and int(run) not in FORBIDDEN_RUNS, 'FRESH_R14_IDENTITY_REQUIRED')
    return release, int(run), int(attempt)


def main(frozen_functions=None):
    try:
        require(len(sys.argv) == 1, 'HISTORY_ARGUMENTS_NOT_ALLOWED')
        release, run, attempt = cli_context(os.environ)
        evidence = GitHubEvidence(os.environ.get('GH_TOKEN'), release, run, attempt)
        result = validate_gate(
            evidence.get('/actions/runs/' + str(ACCEPTED_RUN)),
            evidence.get('/actions/runs/' + str(ACCEPTED_RUN) + '/attempts/1/jobs?per_page=100'),
            evidence.get('/git/commits/' + ACCEPTED_SOURCE), evidence.get(evidence.history_path),
            evidence.get, evidence.logs, release, run, attempt, frozen_functions=frozen_functions)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Refused as error:
        print(json.dumps({'schemaVersion': 14, 'history': 'refused', 'code': str(error)}))
    except Exception:
        print(json.dumps({'schemaVersion': 14, 'history': 'refused', 'code': 'HISTORY_EVIDENCE_UNAVAILABLE'}))
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
