#!/usr/bin/env python3
"""Verify the complete R16 controller delta and every executable source input."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys

DIRECTORY = 'deploy/v52/recovery-r16/'
BASE = DIRECTORY + 'r15-controller.yml'
BASE_SHA = '01c024628e68de8ba8acb339ca431a06af7315b11fee78801e108b2fbc441740'
RECIPE_SHA = '304688a387e8819887416cefe8be262a835281432456c85bb407d6e0d8fc106f'
CONTROLLER = '.github/workflows/deploy-arthello-tochka-r16-20260910.yml'
VERIFICATION = '.github/workflows/verify-arthello-r14.yml'
OLD_CONTROLLER = '.github/workflows/deploy-arthello-tochka-r15-20260910.yml'
FROZEN_PINS = 'deploy/v52/recovery-r15/source-pins.json'
FROZEN_PINS_SHA = '6070d6944c441707a862a4ee0827165a5b0f11913e612913ecc98f79d10f2f34'
RELEASE = {"head":"codex/tochka-r16-20260910","mergeMethod":"squash","parentSha":"422f32e52b38a8a5b6b942c4ea9d1cef71e15d05","pr":408,"prefix":"D104: guarded Tochka R16"}
CHANGED_FROZEN_INPUTS = {'deploy/school-source-manifest.json', 'scripts/run-r14-historical-contract.py'}
EXTRA_INPUTS = {
    '.github/scripts/r16-backup-adoption.py',
    '.github/scripts/r16-backup-controller.py',
    '.github/scripts/r16-candidate-state.py',
    '.github/scripts/r16-public-audit.py',
    '.github/scripts/r16-resume-candidate.py',
    '.github/scripts/r16-live-baseline.py',
    '.github/scripts/run-r16-live-browser.py',
    '.github/scripts/r16-history-gate.py',
    '.github/scripts/fixtures/r16-accepted-r15-history.json',
    '.github/scripts/test-r16-backup-adoption.py',
    '.github/scripts/test-r16-backup-controller.py',
    '.github/scripts/test-r16-continuation-adapters.py',
    '.github/scripts/test-r16-live-baseline.py',
    '.github/scripts/test-run-r16-live-browser.py',
    '.github/scripts/test-r16-history-gate.py',
    '.github/scripts/test-r16-contract.py',
    'deploy/browser/retire-r15-browser.mjs',
    'scripts/test/retire-r15-browser.test.mjs',
    'scripts/run-r15-historical-contract.py',
    'scripts/test/r15-historical-contract.test.py',
    'deploy/school-source-manifest.json',
    'scripts/run-r14-historical-contract.py',
    'deploy/v52/src/lib/integrations.ts',
    'deploy/v52/src/tests/tochka-pending-lifecycle.test.mjs',
    'deploy/v52/recovery-r16/verify-contract.py',
    'deploy/v52/recovery-r15/source-pins.json',
    'deploy/v52/recovery-r15/check-contract.rb',
    'deploy/v52/recovery-r15/transform.json',
    'deploy/v52/recovery-r15/r14-controller.yml',
}
RUBY_TEMPLATE = """require 'digest'
sources = {{
  'deploy/v52/recovery-r16/verify-contract.py' => '{verifier}',
  'deploy/v52/recovery-r16/source-pins.json' => '{pins}',
}}
sources.each do |path, expected|
  raise 'Unreviewed R16 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R16 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r16/verify-contract.py')
puts 'ARTHELLO_R16_SOURCE_CONTRACT=VERIFIED'
"""


class Refused(ValueError):
    pass


def require(value, code):
    if not value:
        raise Refused(code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'DUPLICATE_KEY')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs)


def source_reader(root):
    root = Path(root).resolve()
    def read(name):
        require(isinstance(name, str) and '\\' not in name, 'SOURCE_PATH')
        relative = PurePosixPath(name)
        require(not relative.is_absolute() and '..' not in relative.parts and str(relative) == name, 'SOURCE_PATH')
        path = root / name
        require(path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(root)
                and path.stat().st_size <= 4 * 1024 * 1024, 'SOURCE_FILE')
        return path.read_bytes()
    return read


def transform(base, raw_recipe):
    require(digest(base) == BASE_SHA and digest(raw_recipe) == RECIPE_SHA, 'FROZEN_TRANSFORM_DRIFT')
    recipe = strict_json(raw_recipe)
    require(recipe['format'] == 1 and recipe['baseSha256'] == BASE_SHA and recipe['release'] == RELEASE,
            'RELEASE_IDENTITY')
    require(len(recipe['operations']) == 31, 'TRANSFORM_SHAPE')
    text = base.decode()
    labels = set()
    for operation in recipe['operations']:
        require(set(operation) == {'label', 'before', 'after', 'count'} and
                operation['label'] not in labels and type(operation['count']) is int and operation['count'] > 0,
                'TRANSFORM_SHAPE')
        labels.add(operation['label'])
        require(text.count(operation['before']) == operation['count'], 'TRANSFORM_MATCH_COUNT')
        text = text.replace(operation['before'], operation['after'])
    return text.encode()


def normalized_verification(raw):
    text = raw.decode()
    pattern = r'(?m)^      R16_CONTRACT_SHA256: ([a-f0-9]{64})$'
    matches = re.findall(pattern, text)
    require(len(matches) == 1, 'VERIFICATION_CONTRACT_PIN')
    return re.sub(pattern, '      R16_CONTRACT_SHA256: CONTRACT_SHA256_PENDING', text).encode(), matches[0]


def verify(read):
    raw_pins = read(DIRECTORY + 'source-pins.json')
    pins = strict_json(raw_pins)
    require(set(pins) == {'format', 'release', 'controllerSha256', 'verificationNormalizedSha256', 'sourceFiles'}
            and pins['format'] == 1 and pins['release'] == RELEASE, 'SOURCE_PINS_SHAPE')
    frozen = read(FROZEN_PINS)
    require(digest(frozen) == FROZEN_PINS_SHA, 'FROZEN_R15_PINS_DRIFT')
    common = {p: h for p, h in strict_json(frozen)['sourceFiles'].items() if p not in CHANGED_FROZEN_INPUTS}
    require(set(pins['sourceFiles']) == set(common) | EXTRA_INPUTS, 'SOURCE_INVENTORY')
    for name, expected in common.items():
        require(pins['sourceFiles'][name] == expected, 'FROZEN_PROTOCOL_REPINNED')
    for name, expected in pins['sourceFiles'].items():
        require(isinstance(expected, str) and re.fullmatch(r'[a-f0-9]{64}', expected), 'SOURCE_DIGEST')
        require(digest(read(name)) == expected, 'SOURCE_DRIFT')
    expected_controller = transform(read(BASE), read(DIRECTORY + 'transform.json'))
    actual = read(CONTROLLER)
    require(actual == expected_controller and digest(actual) == pins['controllerSha256'], 'CONTROLLER_DRIFT')
    ruby = RUBY_TEMPLATE.format(verifier=digest(read(DIRECTORY + 'verify-contract.py')), pins=digest(raw_pins)).encode()
    require(read(DIRECTORY + 'check-contract.rb') == ruby, 'CONTRACT_ENTRYPOINT_DRIFT')
    normalized, contract_sha = normalized_verification(read(VERIFICATION))
    require(digest(ruby) == contract_sha and digest(normalized) == pins['verificationNormalizedSha256'], 'VERIFICATION_DRIFT')
    return {'kind': 'r16-source-transformation', 'result': 'verified', 'sourcePins': len(pins['sourceFiles']),
            'controllerSha256': digest(actual), 'durableProtocolSchema': 14, 'requiredMergeMethod': 'squash', 'productionAcceptance': 'not_run'}


def main():
    try:
        require(len(sys.argv) == 1, 'ARGUMENTS_NOT_ALLOWED')
        require(not Path(OLD_CONTROLLER).exists(), 'RETIRED_CONTROLLER_STILL_ACTIVE')
        result = verify(source_reader(Path.cwd()))
        print(json.dumps(result, separators=(',', ':')))
        return 0
    except Refused as error:
        print(json.dumps({'kind': 'r16-source-transformation', 'result': 'blocked', 'reason': str(error)}, separators=(',', ':')))
    except Exception:
        print('{"kind":"r16-source-transformation","result":"blocked","reason":"INPUT_UNAVAILABLE"}')
    return 2


if __name__ == '__main__':
    sys.exit(main())
