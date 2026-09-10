#!/usr/bin/env python3
"""Check current source and unchanged release guards; execute accepted history in a private checkout.
This hosted-only verifier has no production capability and never authorizes a release.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASELINE = 'cb990279e070fddbfa9a0adbd21b56de25b85588'
BASELINE_TREE = '1ce4c733034060dc84d558d49dab96d1be9b1cf8'
PINS = 'deploy/v52/recovery-r16/source-pins.json'
PINS_SHA256 = 'd6f6b71b0cf5e8c64e43e3978d3cdba7b90528ab44b729a7f484d63f599e5448'
WORKFLOW = '.github/workflows/verify-arthello-r14.yml'
WORKFLOW_NORMALIZED_SHA256 = '884bcf91e9ee7b6e07127b7114a0b9bb17155413a3f1bf79ddb4792b1fc9c55d'
# These are the only changed inputs among the 97 frozen R16 source pins.
# The first represents the reviewed current application; the other two are D105
# inputs already present in the base and preserved byte-for-byte. Current scheduler
# behavior is tested before any historical fixture is created.
CURRENT_INPUTS = {'deploy/school-source-manifest.json': '7fef2b28906074db702be636caed32dacbdadd58843575444f22824f6e9afb24', 'deploy/v52/Dockerfile': 'a5372486dc7fa4efe45646a4a2a0562514e362fcfbad28d1d6ea8cb4872c09a6', 'deploy/v52/src/lib/tochka-autosync.ts': 'be895ff2426e1fac2941986ec0de0de18586dc9756bf5ee0ac239387e26a94dc'}
COMMANDS = {
    'r14': [
        ['python3', '-I', '-B', 'scripts/test/r14-historical-contract.test.py'],
        ['python3', '-I', '-B', 'scripts/run-r14-historical-contract.py'],
    ],
    'r15': [
        ['python3', '-I', '-B', 'scripts/test/r15-historical-contract.test.py'],
        ['python3', '-I', '-B', 'scripts/run-r15-historical-contract.py'],
    ],
    'r16': [
        ['ruby', 'deploy/v52/recovery-r16/check-contract.rb'],
        *[['python3', '-I', '-B', '.github/scripts/' + name] for name in (
            'test-r16-contract.py', 'test-r16-history-gate.py', 'test-r16-backup-adoption.py',
            'test-r16-backup-controller.py', 'test-r16-continuation-adapters.py',
            'test-r16-live-baseline.py', 'test-run-r16-live-browser.py')],
        ['node', '--test', 'scripts/test/retire-r15-browser.test.mjs'],
        ['node', '--check', 'deploy/browser/retire-r15-browser.mjs'],
    ],
}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def require(value, reason):
    if not value:
        raise ValueError(reason)


def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], check=True,
                          capture_output=True, timeout=60).stdout


def check_current(read):
    raw = read(PINS)
    require(digest(raw) == PINS_SHA256, 'FROZEN_R16_PINS_DRIFT')
    pins = json.loads(raw)
    require(len(pins['sourceFiles']) == 97, 'SOURCE_INVENTORY')
    require(set(CURRENT_INPUTS) == {'deploy/school-source-manifest.json', 'deploy/v52/Dockerfile',
                                   'deploy/v52/src/lib/tochka-autosync.ts'}, 'MUTABLE_INPUT_INVENTORY')
    for path, expected in pins['sourceFiles'].items():
        require(digest(read(path)) == CURRENT_INPUTS.get(path, expected), 'CURRENT_SOURCE_DRIFT:' + path)
    require(digest(read('.github/workflows/deploy-arthello-tochka-r16-20260910.yml')) == pins['controllerSha256'],
            'FROZEN_CONTROLLER_DRIFT')
    workflow = read(WORKFLOW).decode()
    pattern = r'(?m)^      ACCEPTED_HISTORY_RUNNER_SHA256: [a-f0-9]{64}$'
    require(len(re.findall(pattern, workflow)) == 3, 'RUNNER_PIN_COUNT')
    normalized = re.sub(pattern, '      ACCEPTED_HISTORY_RUNNER_SHA256: RUNNER_SHA256_PENDING', workflow)
    require(digest(normalized.encode()) == WORKFLOW_NORMALIZED_SHA256, 'CURRENT_WORKFLOW_DRIFT')


def run(suite, root=ROOT):
    require(suite in COMMANDS, 'UNKNOWN_SUITE')
    head = git(root, 'rev-parse', 'HEAD').decode().strip()
    require(re.fullmatch('[a-f0-9]{40}', head), 'INVALID_HEAD')
    require(os.environ.get('CHECKED_SOURCE_SHA') == head, 'CHECKED_SOURCE_MOVED')
    read = lambda name: git(root, 'show', head + ':' + name)
    check_current(read)
    require(git(root, 'rev-parse', BASELINE + '^{tree}').decode().strip() == BASELINE_TREE, 'ACCEPTED_TREE_DRIFT')
    # Current source tests execute BEFORE the historical checkout is created.
    for command in (
        ['node', 'scripts/verify-school-source.mjs'],
        ['node', '--test', 'deploy/v52/src/tests/tochka-autosync.test.mjs',
         'deploy/v52/src/tests/tochka-pending-lifecycle.test.mjs',
         'scripts/test/tochka-account-identity.test.mjs',
         'deploy/v52/src/tests/finance-articles.test.mjs',
         'deploy/v52/src/tests/finance-article-store.test.mjs',
         'deploy/v52/src/tests/finance-articles-api.test.mjs'],
    ):
        subprocess.run(command, cwd=root, check=True, timeout=180)
    with tempfile.TemporaryDirectory(prefix='arthello-accepted-r16-history-') as directory:
        target = Path(directory) / 'checkout'
        subprocess.run(['git', 'clone', '--shared', '--no-checkout', '--quiet', str(root), str(target)],
                       check=True, timeout=60)
        git(target, 'checkout', '--detach', BASELINE)
        require(git(target, 'rev-parse', 'HEAD').decode().strip() == BASELINE, 'HISTORICAL_HEAD_DRIFT')
        require(git(target, 'rev-parse', 'HEAD^{tree}').decode().strip() == BASELINE_TREE, 'HISTORICAL_TREE_DRIFT')
        # The child scripts check the historical SHA. This never substitutes the
        # outer PR SHA, changes origin/main, or produces runtime acceptance.
        environment = {**os.environ, 'CHECKED_SOURCE_SHA': BASELINE}
        print(f'ACCEPTED_HISTORY current_source={head} history_source={BASELINE} suite={suite} production_acceptance=not_run', flush=True)
        for command in COMMANDS[suite]:
            subprocess.run(command, cwd=target, env=environment, check=True, timeout=180)
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == head, 'CHECKED_SOURCE_MOVED')
    return 0


if __name__ == '__main__':
    require(len(sys.argv) == 2, 'ARGUMENTS_REQUIRED')
    sys.exit(run(sys.argv[1]))
