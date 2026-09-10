#!/usr/bin/env python3
"""Verify the complete R17 controller delta and every executable source input."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys

DIRECTORY = 'deploy/v52/recovery-r17/'
BASE = DIRECTORY + 'r16-controller.yml'
BASE_SHA = '8f10d8c7ac5a608eddd9368dd8e828c54c0fe02366cc28c56561af1f126832fe'
RECIPE_SHA = '2312c31a97b7530c5f2d563e9b45ada73c2adb81c4fd618339bb80a008e9eb16'
CONTROLLER = '.github/workflows/deploy-arthello-finance-r17-20260910.yml'
VERIFICATION = '.github/workflows/verify-arthello-r14.yml'
OLD_CONTROLLER = '.github/workflows/deploy-arthello-tochka-r16-20260910.yml'
FROZEN_PINS = 'deploy/v52/recovery-r16/source-pins.json'
FROZEN_PINS_SHA = 'd6f6b71b0cf5e8c64e43e3978d3cdba7b90528ab44b729a7f484d63f599e5448'
RELEASE = {'head': 'codex/finance-r17-20260910', 'mergeMethod': 'squash', 'parentSha': '01959896a53c98509634514433f9b07f5aa89ac9', 'pr': 412, 'prefix': 'D109: guarded finance R17'}
CHANGED_FROZEN_INPUTS = {'scripts/test/school-source.test.mjs', 'deploy/v52/Dockerfile', 'deploy/v52/src/lib/tochka-autosync.ts', 'deploy/school-source-manifest.json', 'scripts/verify-school-source.mjs'}
EXTRA_INPUTS = {'.github/scripts/fixtures/r17-accepted-r16-history.json', '.github/scripts/test-r17-continuation-adapters.py', 'deploy/v52/recovery-r16/transform.json', 'deploy/v52/recovery-r16/r15-controller.yml', '.github/workflows/verify-arthello-v52.yml', '.github/scripts/test-r17-live-baseline.py', '.github/scripts/r17-history-gate.py', '.github/scripts/run-finance-ci-browser.sh', 'deploy/v52/src/tests/finance-articles.test.mjs', '.github/scripts/test-r17-history-gate.py', '.github/scripts/r17-public-audit.py', '.github/scripts/test-r17-backup-adoption.py', '.github/scripts/finance-ci-browser.mjs', 'deploy/v52/src/app/api/finance/route.ts', '.github/scripts/r17-backup-controller.py', '.github/scripts/finance-ci-seed.mjs', 'deploy/v52/src/tests/finance-articles-d1.test.mjs', 'scripts/test/school-source.test.mjs', 'scripts/test/accepted-r16-history.test.py', 'deploy/v52/src/lib/finance-article-store.ts', 'deploy/v52/Dockerfile', 'deploy/v52/src/lib/finance-articles.ts', 'deploy/v52/src/tests/finance-articles-api.test.mjs', 'deploy/v52/src/tests/finance-article-store.test.mjs', 'scripts/run-accepted-r16-history.py', '.github/scripts/run-r17-live-browser.py', 'deploy/school-source-manifest.json', '.github/scripts/r17-candidate-state.py', 'scripts/verify-school-source.mjs', '.github/scripts/r17-live-baseline.py', 'scripts/test/retire-r16-browser.test.mjs', '.github/scripts/test-r17-backup-controller.py', 'deploy/v52/recovery-r16/check-contract.rb', '.github/scripts/r17-backup-adoption.py', '.github/scripts/test-r17-contract.py', '.github/scripts/test-run-r17-live-browser.py', 'deploy/v52/src/lib/tochka-autosync.ts', 'deploy/browser/retire-r16-browser.mjs', 'deploy/v52/recovery-r16/source-pins.json', '.github/scripts/r17-resume-candidate.py', 'deploy/v52/src/app/api/finance-actions/route.ts', 'deploy/v52/recovery-r17/verify-contract.py'}
RUBY_TEMPLATE = """require 'digest'
sources = {{
  'deploy/v52/recovery-r17/verify-contract.py' => '{verifier}',
  'deploy/v52/recovery-r17/source-pins.json' => '{pins}',
}}
sources.each do |path, expected|
  raise 'Unreviewed R17 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R17 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r17/verify-contract.py')
puts 'ARTHELLO_R17_SOURCE_CONTRACT=VERIFIED'
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
    require(len(recipe['operations']) == 28, 'TRANSFORM_SHAPE')
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
    pattern = r'(?m)^      R17_CONTRACT_SHA256: ([a-f0-9]{64})$'
    matches = re.findall(pattern, text)
    require(len(matches) == 1, 'VERIFICATION_CONTRACT_PIN')
    return re.sub(pattern, '      R17_CONTRACT_SHA256: CONTRACT_SHA256_PENDING', text).encode(), matches[0]


def verify(read):
    raw_pins = read(DIRECTORY + 'source-pins.json')
    pins = strict_json(raw_pins)
    require(set(pins) == {'format', 'release', 'controllerSha256', 'verificationNormalizedSha256', 'sourceFiles'}
            and pins['format'] == 1 and pins['release'] == RELEASE, 'SOURCE_PINS_SHAPE')
    frozen = read(FROZEN_PINS)
    require(digest(frozen) == FROZEN_PINS_SHA, 'FROZEN_R16_PINS_DRIFT')
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
    return {'kind': 'r17-source-transformation', 'result': 'verified', 'sourcePins': len(pins['sourceFiles']),
            'controllerSha256': digest(actual), 'durableProtocolSchema': 14, 'requiredMergeMethod': 'squash', 'productionAcceptance': 'not_run'}


def main():
    try:
        require(len(sys.argv) == 1, 'ARGUMENTS_NOT_ALLOWED')
        require(not Path(OLD_CONTROLLER).exists(), 'RETIRED_CONTROLLER_STILL_ACTIVE')
        result = verify(source_reader(Path.cwd()))
        print(json.dumps(result, separators=(',', ':')))
        return 0
    except Refused as error:
        print(json.dumps({'kind': 'r17-source-transformation', 'result': 'blocked', 'reason': str(error)}, separators=(',', ':')))
    except Exception:
        print('{"kind":"r17-source-transformation","result":"blocked","reason":"INPUT_UNAVAILABLE"}')
    return 2


if __name__ == '__main__':
    sys.exit(main())
