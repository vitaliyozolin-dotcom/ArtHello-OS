#!/usr/bin/env python3
"""Verify the R13 source transformation; the Ruby entrypoint also preserves R12 gates."""

import ast
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

BASE = '.github/workflows/deploy-arthello-recovery-r12-20260909.yml'
BASE_SHA256 = '70466a2199d72611f5b3ee10f580163c02695496370db5159defdb2740db7798'
CONTROLLER = '.github/workflows/deploy-arthello-recovery-r13-20260909.yml'
VERIFICATION = '.github/workflows/verify-arthello-r13.yml'
CONTRACT = 'deploy/v52/recovery-r13/check-contract.rb'
DIRECTORY = 'deploy/v52/recovery-r13/'
HISTORY = '.github/scripts/r13-history-gate.py'
FROZEN_HISTORY = '.github/scripts/d080-replay-guard.py'
FROZEN_HISTORY_SHA256 = 'c8340b7073272dc2c56ea6cb0d3e4d1516fbb8b7e0b5ea5d4eb0b09bc210a9d8'
FROZEN_FUNCTIONS_SHA256 = '0d579abf075cbf84c9ca92e4f39e1855843bfcad24aa14edfe6ad09287250ca9'
PREFIX = 'D096: guarded R13'
BACKUP_PROTOCOL_SOURCES = (
    'deploy/v52/overrides/production/backup-transport.mjs',
    'deploy/v52/backup/activation-volume.py',
    'deploy/v52/backup/bridge.py',
    'deploy/v52/backup/worker.py',
    'deploy/v52/backup/backup.py',
    'deploy/v52/backup/probe.py',
)
PENDING_HEADER = (
    '# NONPUBLISHABLE_R13_COMMON_ONLY: release pins and separate integrations are unresolved.\n'
    '# Tentative D096 identity; canonical D076 browser bundle remains unchanged.\n'
    '# History, accepted-live/School, and backup/controller fragments are not integrated.\n'
    '# The local preview disables both deployment jobs and cannot prove release readiness.\n'
)
FINAL_HEADER = (
    '# D096: fresh R13 identity and accepted R12 history; canonical D076 browser protocol.\n'
    '# Exact accepted-live/School identity and adopted backup ownership precede fresh cutover.\n'
    '# Durable candidate/public/backup boundaries preserve current data on ambiguous continuation.\n'
    '# Frozen R5-R12 workflows and contracts remain unchanged.\n'
)
TEST_COMMANDS = (
    'python3 -I -B .github/scripts/test-r13-contract.py',
    'python3 -I -B .github/scripts/test-r13-history-gate.py',
    'python3 -I -B .github/scripts/test-r13-backup-adoption.py',
    'python3 -I -B .github/scripts/test-r13-backup-controller.py',
    'python3 -I -B .github/scripts/test-r13-continuation-adapters.py',
    'python3 -I -B .github/scripts/test-r13-live-baseline.py',
    'python3 -I -B .github/scripts/test-run-r13-live-browser.py',
    'node --test scripts/test/retire-r12-browser.test.mjs',
    'node --check deploy/browser/retire-r12-browser.mjs',
)


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
            require(key not in result, 'DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs)


def safe_path(value):
    require(type(value) is str and value and '\\' not in value, 'UNSAFE_SOURCE_PATH')
    path = PurePosixPath(value)
    require(not path.is_absolute() and '..' not in path.parts and str(path) == value, 'UNSAFE_SOURCE_PATH')
    return value


def source_reader(root):
    root = Path(root).resolve()
    def read(name):
        file = root / safe_path(name)
        require(file.is_file() and not file.is_symlink() and file.resolve().is_relative_to(root), 'SOURCE_NOT_ORDINARY')
        require(file.stat().st_size <= 4 * 1024 * 1024, 'SOURCE_TOO_LARGE')
        return file.read_bytes()
    return read


def yaml_document(raw):
    # Reuse the same Ruby/Psych parser as the inherited release contracts; no new package installation.
    result = subprocess.run(['ruby', '-rjson', '-ryaml', '-e',
        'STDOUT.write(JSON.generate(YAML.safe_load(STDIN.read, aliases: true)))'],
        input=raw, capture_output=True, timeout=30, check=True)
    return strict_json(result.stdout)


def frozen_functions(raw):
    require(digest(raw) == FROZEN_HISTORY_SHA256, 'FROZEN_HISTORY_SOURCE_CHANGED')
    text = raw.decode('utf-8')
    selected = {'safe_previous_job', 'validate_previous_attempt', 'validate_history', 'validate_candidate_attempt'}
    nodes = [node for node in ast.parse(text).body if isinstance(node, ast.FunctionDef) and node.name in selected]
    require(len(nodes) == 4 and {node.name for node in nodes} == selected, 'FROZEN_FUNCTION_SET_CHANGED')
    result = ('\n\n'.join(ast.get_source_segment(text, node) for node in nodes) + '\n').encode()
    require(digest(result) == FROZEN_FUNCTIONS_SHA256, 'FROZEN_FUNCTION_BYTES_CHANGED')
    return result


def apply_recipe(base, recipe, read):
    require(digest(base) == BASE_SHA256, 'FROZEN_R12_CONTROLLER_CHANGED')
    require(set(recipe) == {'format', 'basePath', 'baseSha256', 'groups'} and recipe['format'] == 1
            and recipe['basePath'] == BASE and recipe['baseSha256'] == BASE_SHA256, 'TRANSFORM_SCHEMA_CHANGED')
    require([group['name'] for group in recipe['groups']] == ['common', 'backup', 'history-live'], 'TRANSFORM_GROUPS_INCOMPLETE')
    text = base.decode('utf-8')
    labels = set()
    history_count = 0
    for group in recipe['groups']:
        require(set(group) == {'name', 'operations'} and 1 <= len(group['operations']) <= 64, 'TRANSFORM_GROUP_INVALID')
        for operation in group['operations']:
            label = operation['label']
            require(type(label) is str and re.fullmatch(r'[a-z0-9_.-]{1,100}', label) and label not in labels, 'TRANSFORM_LABEL_INVALID')
            labels.add(label)
            if operation['kind'] == 'replace':
                require(set(operation) == {'kind', 'label', 'count', 'before', 'after'}, 'REPLACEMENT_SCHEMA_CHANGED')
                before, after, count = operation['before'], operation['after'], operation['count']
                require(type(before) is str and before and type(after) is str
                        and type(count) is int and 1 <= count <= 64, 'REPLACEMENT_INVALID')
                require(text.count(before) == count, 'REPLACEMENT_ANCHOR_AMBIGUOUS')
                text = text.replace(before, after)
            elif operation['kind'] == 'history':
                history_count += 1
                require(set(operation) == {'kind', 'label', 'start', 'end', 'beforeSha256', 'afterTemplate', 'afterSha256'}, 'HISTORY_OPERATION_SCHEMA_CHANGED')
                start, end = operation['start'], operation['end']
                require(type(start) is str and start and type(end) is str and end
                        and text.count(start) == 1 and text.count(end) == 1, 'HISTORY_ANCHOR_AMBIGUOUS')
                first = text.index(start)
                last = text.index(end, first) + len(end)
                require(digest(text[first:last].encode()) == operation['beforeSha256'], 'HISTORY_OLD_SPAN_CHANGED')
                rendered = operation['afterTemplate']
                for marker, raw in (('__R13_HISTORY_BYTES_REPR__', read(HISTORY)),
                                    ('__D080_FUNCTION_BYTES_REPR__', frozen_functions(read(FROZEN_HISTORY)))):
                    require(rendered.count(marker) == 1, 'HISTORY_LITERAL_MARKER_AMBIGUOUS')
                    rendered = rendered.replace(marker, repr(raw))
                require(digest(rendered.encode()) == operation['afterSha256'], 'HISTORY_RENDERED_BYTES_CHANGED')
                text = text[:first] + rendered + text[last:]
            else:
                raise Refused('UNKNOWN_TRANSFORM_OPERATION')
    require(history_count == 1, 'EXACT_INLINE_HISTORY_OPERATION_REQUIRED')
    return text


def bind_release(text, release):
    require(set(release) == {'head', 'pr', 'parentSha', 'prefix'}, 'RELEASE_PIN_SCHEMA_CHANGED')
    require(type(release['head']) is str and re.fullmatch(r'codex/[a-z0-9][a-z0-9/-]{1,120}', release['head'])
            and type(release['pr']) is int and release['pr'] > 0
            and type(release['parentSha']) is str and re.fullmatch(r'[a-f0-9]{40}', release['parentSha'])
            and release['prefix'] == PREFIX, 'NONPUBLISHABLE_RELEASE_PINS_UNASSIGNED')
    replacements = {
        '__R13_RELEASE_HEAD_NONPUBLISHABLE_UNASSIGNED__': (release['head'], 3),
        '__R13_RELEASE_PR_NONPUBLISHABLE_UNASSIGNED__': (str(release['pr']), 3),
        '__R13_PARENT_SHA_NONPUBLISHABLE_UNASSIGNED__': (release['parentSha'], 1),
        PENDING_HEADER: (FINAL_HEADER, 1),
    }
    for before, (after, count) in replacements.items():
        require(text.count(before) == count, 'RELEASE_BINDING_COUNT_CHANGED')
        text = text.replace(before, after)
    require('NONPUBLISHABLE' not in text and '__R13_' not in text, 'UNRESOLVED_CONTROLLER_PLACEHOLDER')
    return text.encode()


def history_graph(raw):
    wanted = {'IDENTITY_STEP', 'RESUME_STEP', 'LIVE_STEP', 'CUTOVER_STEP', 'POST_STEP', 'PRESTEPS', 'POSTSTEPS'}
    values = {}
    def value(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, str): return node.value
        if isinstance(node, ast.Name): return values[node.id]
        if isinstance(node, ast.List): return [value(item) for item in node.elts]
        raise Refused('HISTORY_GRAPH_NOT_LITERAL')
    for node in ast.parse(raw).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in wanted:
            values[node.targets[0].id] = value(node.value)
    require(set(values) == wanted, 'HISTORY_GRAPH_INCOMPLETE')
    return values['PRESTEPS'] + [values['CUTOVER_STEP']] + values['POSTSTEPS']


def only_step(document, *, name=None, identity=None):
    steps = [step for step in document['jobs']['deploy']['steps']
             if (name is not None and step.get('name') == name) or (identity is not None and step.get('id') == identity)]
    require(len(steps) == 1, 'CONTROLLER_STEP_AMBIGUOUS')
    return steps[0]


def ordered(text, fragments, code):
    position = 0
    for fragment in fragments:
        next_position = text.find(fragment, position)
        require(next_position >= position, code)
        position = next_position + len(fragment)


def semantic_contract(old, current, history_raw):
    for key in ('on', 'permissions', 'concurrency'):
        require(current[key] == old[key], 'TOP_LEVEL_AUTHORITY_CHANGED')
    require(set(current['jobs']) == {'bundle', 'deploy'}, 'RELEASE_JOB_SET_CHANGED')
    for name in ('bundle', 'deploy'):
        for key in set(old['jobs'][name]) - {'if', 'steps'}:
            require(current['jobs'][name][key] == old['jobs'][name][key], 'RUNNER_LOCK_OR_JOB_AUTHORITY_CHANGED')
        require('false &&' not in current['jobs'][name]['if'], 'DISABLED_PREVIEW_IS_NOT_RELEASE')
    require(current['jobs']['bundle']['steps'] == old['jobs']['bundle']['steps'], 'CANONICAL_D076_BUNDLE_CHANGED')
    steps = current['jobs']['deploy']['steps']
    graph = ['Set up job'] + [step.get('name') or 'Run ' + step['uses'] for step in steps]
    graph += ['Post Check out exact verified release', 'Complete job']
    require(graph == history_graph(history_raw), 'INLINE_HISTORY_STEP_GRAPH_MISMATCH')
    for name in ('Measure import capacity before downloading the verified archive',
                 'Verify archive, import off-host bundle and verify portable identity'):
        require(only_step(current, name=name) == only_step(old, name=name), 'CAPACITY_OR_BROWSER_IMPORT_CHANGED')
    retirement = only_step(current, name='Retire only the exact unused accepted R12 browser image')
    require(retirement['if'] == "env.R9_RESUME_CANDIDATE != '1'" and
            retirement['run'].endswith('"$PRECHECK_NODE" deploy/browser/retire-r12-browser.mjs\n'), 'RETIREMENT_BOUNDARY_CHANGED')
    provenance = only_step(current, identity='provenance')['run']
    for fragment in (
        "workflow_success quality.yml 'Quality gates' 'secret-scan,test,d084-candidate-tests,d085-candidate-tests'",
        "workflow_success proof-gates.yml 'ArtHello Proof Gates' 'prove'",
        "workflow_success verify-arthello-v52.yml 'Verify ArtHello v52 release' 'verify-v52' \"$TRIGGER_VERIFY_RUN_ID\"",
        "workflow_success verify-arthello-r12.yml 'Verify ArtHello R12 continuation' 'd086-candidate-tests'",
        "workflow_success verify-arthello-r13.yml 'Verify ArtHello R13 continuation' 'r13-candidate-tests'",
    ):
        require(provenance.count(fragment) == 1, 'EXISTING_EXACT_SOURCE_GATE_CHANGED')
    for variable in ('quality_run', 'proof_run', 'verify_run', 'r12_run', 'r13_run'):
        require(('test -n "$' + variable + '"') in provenance, 'REQUIRED_SOURCE_GATE_REMOVED')
    all_shell = '\n'.join(step.get('run', '') for step in steps)
    require(not re.search(r'\bdocker\s+(?:system|image|container|volume)\s+prune\b', all_shell), 'BROAD_DOCKER_SWEEP_PRESENT')
    require('ARTHELLO_STALE_IMAGE_REMOVED' not in only_step(current, identity='image_import')['run']
            and 'read -r stale_id' not in only_step(current, identity='cutover')['run'], 'OPPORTUNISTIC_SWEEP_PRESENT')
    cutover = only_step(current, identity='cutover')['run']
    ordered(cutover, ['backup_adoption_seal_attempted=1\nbackup_runtime seal',
                      'backup_controller digest', 'backupAdoptionStateSha256',
                      'r13-candidate-state.py begin'], 'ADOPTION_SEAL_CONTEXT_ORDER_CHANGED')
    for fragment in ('|| backup_preservation_boundary; then', 'backup_runtime quiesce',
                     'backup_runtime verify-copyback', 'backup_runtime restore',
                     'backup_adoption_seal_attempted=1', 'backup_resource_attempt="$original_attempt"'):
        require(fragment in cutover, 'BACKUP_PRESERVATION_BOUNDARY_REMOVED')
    for phase in ('live', 'live-paused', 'stopped', 'copyback', 'candidate', 'candidate-paused'):
        require(('assert_backup_consumers ' + phase) in cutover, 'PHASE_CONSUMER_PROOF_REMOVED')
    ordered(cutover, ['backup_runtime quiesce', 'backup_runtime verify-copyback',
                      'assert_backup_consumers copyback', 'copy_volume "$rollback_volume" "$DATA_VOLUME"',
                      'backup_runtime restore'], 'FRESH_COPYBACK_READER_RESTORATION_ORDER_CHANGED')
    require(all_shell.count('python3 -I .github/scripts/run-r13-live-browser.py') == 2
            and 'bash .github/scripts/run-r10-live-browser.sh' not in all_shell, 'BEFORE_AFTER_BROWSER_IDENTITY_WRAPPER_REQUIRED')
    require(all_shell.count('python3 -I .github/scripts/r13-live-baseline.py school') == 2
            and 'python3 -I .github/scripts/r13-live-baseline.py live' in cutover,
            'ACCEPTED_LIVE_AND_SCHOOL_BASELINE_REQUIRED')


def verification_contract(document, expected_normalized_sha, ruby_contract_sha):
    require(document['permissions'] == {'contents': 'read'} and set(document['jobs']) == {'r13-candidate-tests'}, 'VERIFICATION_AUTHORITY_CHANGED')
    job = document['jobs']['r13-candidate-tests']
    require(job['runs-on'] == 'ubuntu-latest' and 'environment' not in job and 'permissions' not in job, 'VERIFICATION_NOT_UNPRIVILEGED_HOSTED')
    require(job['env']['R13_CONTRACT_SHA256'] == ruby_contract_sha, 'VERIFICATION_CONTRACT_PIN_CHANGED')
    body = '\n'.join(step.get('run', '') for step in job['steps'])
    ordered(body, ['ruby deploy/v52/recovery-r13/check-contract.rb', *TEST_COMMANDS], 'REQUIRED_BEHAVIOR_GATE_CHANGED')
    job['env']['R13_CONTRACT_SHA256'] = 'CONTRACT_SHA256_PENDING'
    canonical = json.dumps(document, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
    require(digest(canonical) == expected_normalized_sha, 'VERIFICATION_WORKFLOW_CHANGED')


def verify(read, pins, recipe, parse_yaml=yaml_document):
    require(set(pins) == {'format', 'status', 'release', 'controllerSha256', 'sourceFiles', 'transformSha256', 'verificationNormalizedSha256'}
            and pins['format'] == 1 and pins['status'] == 'reviewed-integrated', 'NONPUBLISHABLE_SOURCE_PINS_UNASSIGNED')
    require(type(pins['sourceFiles']) is dict and 16 <= len(pins['sourceFiles']) <= 100, 'SOURCE_MANIFEST_INCOMPLETE')
    for path, expected in pins['sourceFiles'].items():
        safe_path(path)
        require(type(expected) is str and re.fullmatch(r'[a-f0-9]{64}', expected), 'SOURCE_DIGEST_UNASSIGNED')
        require(digest(read(path)) == expected, 'PINNED_SOURCE_CHANGED')
    for path in (BASE, HISTORY, FROZEN_HISTORY, '.github/scripts/r13-backup-adoption.py',
                 '.github/scripts/r13-backup-controller.py', '.github/scripts/r13-candidate-state.py',
                 '.github/scripts/r13-resume-candidate.py', '.github/scripts/r13-public-audit.py',
                 '.github/scripts/r13-live-baseline.py', '.github/scripts/run-r13-live-browser.py',
                 '.github/scripts/d083-maintenance-route.py',
                 'deploy/v52/maintenance/image-runtime-fingerprint.jq',
                 '.github/scripts/run-r10-live-browser.sh', '.github/scripts/r10-live-browser-acceptance.py',
                 '.github/scripts/school-sso-readonly-diagnostic.sh',
                 '.github/scripts/check-school-live-acceptance-r7.py',
                 'deploy/browser/retire-r12-browser.mjs', 'deploy/browser/capacity.mjs'):
        require(path in pins['sourceFiles'], 'REQUIRED_SOURCE_PIN_MISSING')
    for command in TEST_COMMANDS:
        require(command.split()[-1] in pins['sourceFiles'], 'REQUIRED_BEHAVIOR_TEST_PIN_MISSING')
    for path in BACKUP_PROTOCOL_SOURCES:
        require(path in pins['sourceFiles'], 'ACCEPTED_BACKUP_PROTOCOL_PIN_MISSING')
    require(digest(read(DIRECTORY + 'transform.json')) == pins['transformSha256'], 'TRANSFORM_MANIFEST_CHANGED')
    require(recipe == strict_json(read(DIRECTORY + 'transform.json')), 'TRANSFORM_DOCUMENT_MISMATCH')
    expected = bind_release(apply_recipe(read(BASE), recipe, read), pins['release'])
    actual = read(CONTROLLER)
    require(expected == actual, 'CONTROLLER_DIFF_OUTSIDE_EXACT_TRANSFORMATION')
    require(digest(actual) == pins['controllerSha256'], 'FINAL_CONTROLLER_DIGEST_UNASSIGNED_OR_CHANGED')
    semantic_contract(parse_yaml(read(BASE)), parse_yaml(actual), read(HISTORY))
    verification_contract(parse_yaml(read(VERIFICATION)), pins['verificationNormalizedSha256'], digest(read(CONTRACT)))
    return {'kind': 'r13-source-transformation', 'result': 'verified', 'controllerSha256': digest(actual),
            'sourcePins': len(pins['sourceFiles']), 'productionAcceptance': 'not_run'}


def main():
    try:
        require(len(sys.argv) == 1, 'CONTRACT_ARGUMENTS_NOT_ALLOWED')
        read = source_reader(Path.cwd())
        pins = strict_json(read(DIRECTORY + 'source-pins.json'))
        recipe = strict_json(read(DIRECTORY + 'transform.json'))
        result = verify(read, pins, recipe)
        print(json.dumps(result, separators=(',', ':')))
        return 0
    except Refused as error:
        print(json.dumps({'kind': 'r13-source-transformation', 'result': 'blocked', 'reason': str(error)}, separators=(',', ':')))
    except Exception:
        print('{"kind":"r13-source-transformation","result":"blocked","reason":"CONTRACT_INPUT_OR_RUNTIME_UNAVAILABLE"}')
    return 2


if __name__ == '__main__':
    sys.exit(main())
