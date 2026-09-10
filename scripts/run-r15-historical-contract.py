#!/usr/bin/env python3
"""Hosted-only R15 history check after a reviewed banking source change.

Validate the current canonical source before restoring four pinned inputs in
a private fixture. This helper never authorizes production or changes checkout.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASELINE = '4a0713b4a7d87f132e49836fe0ce9ca9258bc1ec'
PINS_PATH = 'deploy/v52/recovery-r15/source-pins.json'
PINS_SHA256 = '6070d6944c441707a862a4ee0827165a5b0f11913e612913ecc98f79d10f2f34'
WORKFLOW = '.github/workflows/verify-arthello-r14.yml'
WORKFLOW_SHA256 = '8254103a7620a9383fb7c15964edb9387eb52dafcc7e000e182737beec1803bb'
CONTROLLER = '.github/workflows/deploy-arthello-tochka-r15-20260910.yml'
ARCHIVED_CONTROLLER = 'deploy/v52/recovery-r16/r15-controller.yml'
CURRENT_WORKFLOW_NORMALIZED = 'd951661d7a1638d0e246b062b27c0de3d822ddd1cd71659478f0835a6f45b053'
ARCHIVED_PATHS = ('deploy/school-source-manifest.json', 'scripts/run-r14-historical-contract.py')
CURRENT_PINS = {
    'deploy/school-source-manifest.json': '6cdd08eb0a330836889096e207858314a1a5dfd53b0153210aed0e2fabc9c6bc',
    'scripts/run-r14-historical-contract.py': 'ab0aeb384d5c5eb4859b86274f0a70778518b846620e4c2dbe47710c9c0fb48b',
    'deploy/v52/src/lib/integrations.ts': 'c90400051808810020bf61ab7d35cdf0652b84c182900d8dfaa72c1ee7c886b7',
    'deploy/v52/src/tests/tochka-pending-lifecycle.test.mjs': '525652fe49ba808c4c3520dd9dd705920dcdaa0152092e03cd8b74cda37e7a3d',
}
COMMANDS = (
    'ruby deploy/v52/recovery-r15/check-contract.rb',
    'python3 -I -B .github/scripts/test-r15-contract.py',
    'python3 -I -B .github/scripts/test-r15-artifact-download.py',
    'python3 -I -B .github/scripts/test-r15-history-gate.py',
    'node --test scripts/test/retire-r14-browser.test.mjs',
    'node --check deploy/browser/retire-r14-browser.mjs',
)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def require(value, reason):
    if not value:
        raise ValueError(reason)


def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], check=True,
                          capture_output=True, timeout=60).stdout


def extract_current(root, target):
    helper = root / 'scripts/run-frozen-release-contract.py'
    require(digest(helper.read_bytes()) == 'f6e3e21abb92ac45558c756ed7b14ed4ce3b1be4a489379238aa7e5c97f4d28d',
            'ARCHIVE_EXTRACTOR_DRIFT')
    spec = importlib.util.spec_from_file_location('frozen_archive', helper)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    head = git(root, 'rev-parse', 'HEAD').decode().strip()
    require(not os.environ.get('CHECKED_SOURCE_SHA') or os.environ['CHECKED_SOURCE_SHA'] == head,
            'CHECKED_SOURCE_MOVED')
    module.extract_archive(git(root, 'archive', '--format=tar', head), target)
    module.extract_archive(git(root, 'archive', '--format=tar', head, '.github/workflows'), target, workflows_only=True)
    return head


def check_current(target):
    target = Path(target)
    raw = (target / PINS_PATH).read_bytes()
    require(digest(raw) == PINS_SHA256, 'FROZEN_R15_PINS_DRIFT')
    pins = json.loads(raw)
    for name, expected in CURRENT_PINS.items():
        require(digest((target / name).read_bytes()) == expected, 'CURRENT_SOURCE_DRIFT:' + name)
    for name, expected in pins['sourceFiles'].items():
        if name not in ARCHIVED_PATHS:
            require(digest((target / name).read_bytes()) == expected, 'CURRENT_PROTOCOL_DRIFT:' + name)
    require(not (target / CONTROLLER).exists(), 'RETIRED_R15_CONTROLLER_ACTIVE')
    controller = target / ARCHIVED_CONTROLLER
    require(digest(controller.read_bytes()) == pins['controllerSha256'], 'FROZEN_R15_CONTROLLER_DRIFT')
    workflow = (target / WORKFLOW).read_text()
    pattern = r'(?m)^      R15_HISTORICAL_RUNNER_SHA256: [a-f0-9]{64}$'
    require(len(re.findall(pattern, workflow)) == 1, 'CURRENT_WORKFLOW_PIN')
    normalized = re.sub(pattern, '      R15_HISTORICAL_RUNNER_SHA256: RUNNER_SHA256_PENDING', workflow)
    r16_pattern = r'(?m)^      R16_CONTRACT_SHA256: [a-f0-9]{64}$'
    require(len(re.findall(r16_pattern, normalized)) == 1, 'CURRENT_R16_WORKFLOW_PIN')
    normalized = re.sub(r16_pattern, '      R16_CONTRACT_SHA256: CONTRACT_SHA256_PENDING', normalized)
    require(digest(normalized.encode()) == CURRENT_WORKFLOW_NORMALIZED, 'CURRENT_WORKFLOW_DRIFT')
    return pins


def overlay_historical(root, target, pins):
    for name, expected in [(name, pins['sourceFiles'][name]) for name in ARCHIVED_PATHS] + [(WORKFLOW, WORKFLOW_SHA256), (CONTROLLER, pins['controllerSha256'])]:
        raw = git(root, 'show', BASELINE + ':' + name)
        require(digest(raw) == expected, 'ARCHIVED_SOURCE_DRIFT:' + name)
        (Path(target) / name).write_bytes(raw)


def run(root=ROOT):
    with tempfile.TemporaryDirectory(prefix='arthello-r15-historical-') as temporary:
        target = Path(temporary)
        head = extract_current(root, target)
        pins = check_current(target)
        for command in (
                'node scripts/verify-school-source.mjs',
                'node --test deploy/v52/src/tests/tochka-pending-lifecycle.test.mjs',
                'node --test deploy/v52/src/tests/tochka-autosync.test.mjs scripts/test/tochka-account-identity.test.mjs'):
            subprocess.run(command.split(), cwd=target, check=True, timeout=120)
        overlay_historical(root, target, pins)
        require(git(root, 'rev-parse', 'HEAD').decode().strip() == head, 'CHECKED_SOURCE_MOVED')
        print(f'R15_HISTORICAL_COMPARISON current_code={head} archived_inputs={BASELINE} production_acceptance=not_run', flush=True)
        for command in COMMANDS:
            subprocess.run(command.split(), cwd=target, check=True, timeout=120)
    return 0


if __name__ == '__main__':
    require(len(sys.argv) == 1, 'ARGUMENTS_NOT_ALLOWED')
    sys.exit(run())
