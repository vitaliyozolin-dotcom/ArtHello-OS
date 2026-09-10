#!/usr/bin/env python3
"""Verify the complete R15 controller delta and every executable source input."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys

DIRECTORY = 'deploy/v52/recovery-r15/'
BASE = DIRECTORY + 'r14-controller.yml'
BASE_SHA = 'c6b0fa7117ad6af3b34f3c69d9b624a5ca1ba8104d54dea6bb755a0e9b2de5ea'
RECIPE_SHA = 'd5c10c929ddb0087601cefe980bb6ce2cd6eb200e54da4d2e568be8ac3e2b53f'
CONTROLLER = '.github/workflows/deploy-arthello-tochka-r15-20260910.yml'
VERIFICATION = '.github/workflows/verify-arthello-r14.yml'
OLD_CONTROLLER = '.github/workflows/deploy-arthello-recovery-r14-20260909.yml'
FROZEN_PINS = 'deploy/v52/recovery-r14/source-pins.json'
FROZEN_PINS_SHA = '6101c7ed105a02e6a91bd1e646da715dbff1217a1cd4585cceea9f2ec1f212cb'
RELEASE = {'head': 'codex/tochka-r15-squash-fix-20260910', 'pr': 405, 'parentSha': 'bd3553187c6adcda3e0be1586b25c9c3b61dc3de', 'prefix': 'D101: guarded Tochka R15', 'mergeMethod': 'squash'}
CHANGED_FROZEN_INPUTS = {
    'deploy/v52/Dockerfile', 'scripts/test/tochka-account-identity.test.mjs',
    'deploy/v52/overrides/db/index.ts', 'deploy/v52/overrides/db/schema.ts',
    'deploy/v52/overrides/lib/tochka-autosync.ts',
}
EXTRA_INPUTS = {
    'deploy/v52/src/tests/tochka-autosync.test.mjs',
    '.github/scripts/fixtures/r15-rejected-publication.json',
    '.github/scripts/download-v52-artifact-r15.py', '.github/scripts/test-r15-artifact-download.py',
    '.github/scripts/r15-history-gate.py', '.github/scripts/test-r15-history-gate.py',
    'deploy/browser/retire-r14-browser.mjs', 'scripts/test/retire-r14-browser.test.mjs',
    'scripts/run-r14-historical-contract.py', 'scripts/test/r14-historical-contract.test.py',
    'scripts/verify-school-source.mjs', 'scripts/test/school-source.test.mjs',
    'deploy/school-source-manifest.json', 'deploy/v52/Dockerfile',
    'scripts/test/tochka-account-identity.test.mjs',
    'deploy/v52/src/db/index.ts', 'deploy/v52/src/db/schema.ts',
    'deploy/v52/src/lib/tochka-autosync.ts', 'deploy/v52/src/production/runtime-server.mjs',
    'deploy/v52/src/production/tochka-transport.mjs', 'deploy/v52/src/production/backup-transport.mjs',
    'deploy/v52/src/app/api/integration-actions/route.ts',
    'deploy/v52/src/tests/tochka-node-transport.test.mjs',
    'deploy/v52/runtime/package-lock.json', 'deploy/v52/certificates/russian-trusted-root-ca.pem',
    'deploy/v52/maintenance/production-data-inventory.py',
    DIRECTORY + 'verify-contract.py', '.github/scripts/test-r15-contract.py',
}
RUBY_TEMPLATE = """require 'digest'
sources = {{
  'deploy/v52/recovery-r15/verify-contract.py' => '{verifier}',
  'deploy/v52/recovery-r15/source-pins.json' => '{pins}',
}}
sources.each do |path, expected|
  raise 'Unreviewed R15 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R15 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r15/verify-contract.py')
puts 'ARTHELLO_R15_SOURCE_CONTRACT=VERIFIED'
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
    require(len(recipe['operations']) == 17, 'TRANSFORM_SHAPE')
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
    pattern = r'(?m)^      R15_CONTRACT_SHA256: ([a-f0-9]{64})$'
    matches = re.findall(pattern, text)
    require(len(matches) == 1, 'VERIFICATION_CONTRACT_PIN')
    return re.sub(pattern, '      R15_CONTRACT_SHA256: CONTRACT_SHA256_PENDING', text).encode(), matches[0]


def verify(read):
    raw_pins = read(DIRECTORY + 'source-pins.json')
    pins = strict_json(raw_pins)
    require(set(pins) == {'format', 'release', 'controllerSha256', 'verificationNormalizedSha256', 'sourceFiles'}
            and pins['format'] == 1 and pins['release'] == RELEASE, 'SOURCE_PINS_SHAPE')
    frozen = read(FROZEN_PINS)
    require(digest(frozen) == FROZEN_PINS_SHA, 'FROZEN_R14_PINS_DRIFT')
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
    return {'kind': 'r15-source-transformation', 'result': 'verified', 'sourcePins': len(pins['sourceFiles']),
            'controllerSha256': digest(actual), 'durableProtocolSchema': 14, 'requiredMergeMethod': 'squash', 'productionAcceptance': 'not_run'}


def main():
    try:
        require(len(sys.argv) == 1, 'ARGUMENTS_NOT_ALLOWED')
        require(not Path(OLD_CONTROLLER).exists(), 'RETIRED_CONTROLLER_STILL_ACTIVE')
        result = verify(source_reader(Path.cwd()))
        print(json.dumps(result, separators=(',', ':')))
        return 0
    except Refused as error:
        print(json.dumps({'kind': 'r15-source-transformation', 'result': 'blocked', 'reason': str(error)}, separators=(',', ':')))
    except Exception:
        print('{"kind":"r15-source-transformation","result":"blocked","reason":"INPUT_UNAVAILABLE"}')
    return 2


if __name__ == '__main__':
    sys.exit(main())
