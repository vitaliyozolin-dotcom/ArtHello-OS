import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('r13_contract', ROOT / 'deploy/v52/recovery-r13/verify-contract.py')
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)


def parse_yaml(raw):
    if shutil.which('ruby'):
        return contract.yaml_document(raw)
    # Local preparation fallback only. Hosted verification uses installed Ruby/Psych.
    import yaml
    return yaml.safe_load(raw)


LOCAL_MAP = json.loads(Path(os.environ['R13_CONTRACT_TEST_SOURCE_MAP']).read_text()) if os.environ.get('R13_CONTRACT_TEST_SOURCE_MAP') else {}


def read_source(path):
    if path in LOCAL_MAP:
        return Path(LOCAL_MAP[path]).read_bytes()
    return contract.source_reader(ROOT)(path)


class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pins = contract.strict_json(read_source(contract.DIRECTORY + 'source-pins.json'))
        cls.recipe = contract.strict_json(read_source(contract.DIRECTORY + 'transform.json'))
        cls.projection = contract.apply_recipe(read_source(contract.BASE), cls.recipe, read_source)
        cls.release = {'head': 'codex/r13-contract-test', 'pr': 999999, 'parentSha': 'a' * 40, 'prefix': contract.PREFIX}
        cls.controller = contract.bind_release(cls.projection, cls.release)
        cls.old = parse_yaml(read_source(contract.BASE))
        cls.current = parse_yaml(cls.controller)

    def ready_fixture(self):
        pins = copy.deepcopy(self.pins)
        pins.update(status='reviewed-integrated', release=self.release, controllerSha256=contract.digest(self.controller))
        workflow = read_source(contract.VERIFICATION).replace(
            b'__R13_CONTRACT_SHA256_NONPUBLISHABLE_UNASSIGNED__', contract.digest(read_source(contract.CONTRACT)).encode())
        def read(path):
            if path == contract.CONTROLLER: return self.controller
            if path == contract.VERIFICATION: return workflow
            return read_source(path)
        return pins, read

    def test_actual_52_fragments_and_semantics_match_reviewed_composition(self):
        self.assertEqual(sum(len(group['operations']) for group in self.recipe['groups']), 52)
        self.assertEqual(contract.digest(self.projection.encode()), 'ff0649e009637ac4fc5f703acf1b63fda5dab85b6f34e0b72532d59c77772a75')
        pins, read = self.ready_fixture()
        result = contract.verify(read, pins, self.recipe, parse_yaml)
        self.assertEqual(result['result'], 'verified')
        self.assertEqual(result['productionAcceptance'], 'not_run')

    def test_unassigned_source_and_release_pins_cannot_pass(self):
        pins, read = self.ready_fixture()
        pins['status'] = 'NONPUBLISHABLE_UNASSIGNED'
        with self.assertRaisesRegex(contract.Refused, 'NONPUBLISHABLE_SOURCE_PINS_UNASSIGNED'):
            contract.verify(read, pins, self.recipe, parse_yaml)
        for field in ('head', 'pr', 'parentSha'):
            with self.subTest(field=field), self.assertRaisesRegex(contract.Refused, 'NONPUBLISHABLE_RELEASE_PINS_UNASSIGNED'):
                contract.bind_release(self.projection, {**self.release, field: None})
        with self.assertRaises(contract.Refused):
            contract.bind_release(self.projection, {**self.release, 'pr': True})

    def test_changed_controller_cannot_pass_by_only_updating_its_digest(self):
        pins, read = self.ready_fixture()
        altered = self.controller.replace(b'    timeout-minutes: 240', b'    timeout-minutes: 241')
        self.assertNotEqual(altered, self.controller)
        pins['controllerSha256'] = contract.digest(altered)
        with self.assertRaisesRegex(contract.Refused, 'CONTROLLER_DIFF_OUTSIDE_EXACT_TRANSFORMATION'):
            contract.verify(lambda path: altered if path == contract.CONTROLLER else read(path), pins, self.recipe, parse_yaml)

    def test_history_source_literal_span_and_frozen_functions_are_independently_bound(self):
        operation = next(op for group in self.recipe['groups'] for op in group['operations'] if op['kind'] == 'history')
        self.assertEqual(operation['afterTemplate'].count('__R13_HISTORY_BYTES_REPR__'), 1)
        self.assertEqual(operation['afterTemplate'].count('__D080_FUNCTION_BYTES_REPR__'), 1)
        self.assertLess(len(operation['afterTemplate'].encode()), 4096)
        with self.assertRaisesRegex(contract.Refused, 'FROZEN_R12_CONTROLLER_CHANGED'):
            contract.apply_recipe(read_source(contract.BASE) + b'\n', self.recipe, read_source)
        for key, value in (('beforeSha256', '0' * 64), ('afterSha256', '0' * 64),
                           ('afterTemplate', operation['afterTemplate'].replace('__R13_HISTORY_BYTES_REPR__', 'b"changed"'))):
            recipe = copy.deepcopy(self.recipe)
            changed = next(op for group in recipe['groups'] for op in group['operations'] if op['kind'] == 'history')
            changed[key] = value
            with self.subTest(key=key), self.assertRaises(contract.Refused):
                contract.apply_recipe(read_source(contract.BASE), recipe, read_source)
        with self.assertRaisesRegex(contract.Refused, 'FROZEN_HISTORY_SOURCE_CHANGED'):
            contract.frozen_functions(read_source(contract.FROZEN_HISTORY) + b'\n')

    def test_pinned_helper_and_test_coverage_cannot_be_removed_or_changed(self):
        pins, read = self.ready_fixture()
        helper = '.github/scripts/r13-resume-candidate.py'
        with self.assertRaisesRegex(contract.Refused, 'PINNED_SOURCE_CHANGED'):
            contract.verify(lambda path: read(path) + b'\n' if path == helper else read(path), pins, self.recipe, parse_yaml)
        del pins['sourceFiles']['.github/scripts/test-r13-backup-controller.py']
        with self.assertRaisesRegex(contract.Refused, 'REQUIRED_BEHAVIOR_TEST_PIN_MISSING'):
            contract.verify(read, pins, self.recipe, parse_yaml, )

    def test_authority_bundle_capacity_and_history_graph_cannot_drift(self):
        cases = []
        changed = copy.deepcopy(self.current); changed['permissions']['contents'] = 'write'; cases.append(changed)
        changed = copy.deepcopy(self.current); changed['jobs']['deploy']['environment'] = 'other'; cases.append(changed)
        changed = copy.deepcopy(self.current); changed['jobs']['bundle']['steps'][2]['run'] += '\necho different-browser-protocol\n'; cases.append(changed)
        changed = copy.deepcopy(self.current); changed['jobs']['deploy']['steps'][0]['name'] = 'Unchecked history'; cases.append(changed)
        changed = copy.deepcopy(self.current)
        contract.only_step(changed, name='Measure import capacity before downloading the verified archive')['run'] = 'true\n'; cases.append(changed)
        for document in cases:
            with self.assertRaises(contract.Refused):
                contract.semantic_contract(self.old, document, read_source(contract.HISTORY))

    def test_adopted_worker_requires_unchanged_transport_and_activation_protocol(self):
        for source in contract.BACKUP_PROTOCOL_SOURCES:
            pins, read = self.ready_fixture()
            with self.subTest(source=source, mutation='changed'), self.assertRaisesRegex(contract.Refused, 'PINNED_SOURCE_CHANGED'):
                contract.verify(lambda path: read(path) + b'\n' if path == source else read(path), pins, self.recipe, parse_yaml)
            del pins['sourceFiles'][source]
            with self.subTest(source=source, mutation='missing'), self.assertRaisesRegex(contract.Refused, 'ACCEPTED_BACKUP_PROTOCOL_PIN_MISSING'):
                contract.verify(read, pins, self.recipe, parse_yaml)

    def test_seal_copyback_consumer_and_before_after_identity_guards_are_required(self):
        for before, after in (
            ('|| backup_preservation_boundary; then', '; then'),
            ('backup_runtime verify-copyback', 'true'),
            ('assert_backup_consumers live-paused', 'true'),
            ('backup_runtime restore', 'true'),
            ('python3 -I .github/scripts/run-r13-live-browser.py', 'true'),
        ):
            document = copy.deepcopy(self.current)
            cutover = contract.only_step(document, identity='cutover')
            self.assertIn(before, cutover['run'])
            cutover['run'] = cutover['run'].replace(before, after)
            with self.subTest(before=before), self.assertRaises(contract.Refused):
                contract.semantic_contract(self.old, document, read_source(contract.HISTORY))

    def test_hosted_verification_requires_all_behavior_gates_and_normalized_identity(self):
        pins, read = self.ready_fixture()
        for mutation in ('permission', 'test', 'pin', 'checkout'):
            document = parse_yaml(read(contract.VERIFICATION))
            job = document['jobs']['r13-candidate-tests']
            if mutation == 'permission': document['permissions']['contents'] = 'write'
            if mutation == 'test': job['steps'][-1]['run'] = job['steps'][-1]['run'].replace(contract.TEST_COMMANDS[2], 'true')
            if mutation == 'pin': job['env']['R13_CONTRACT_SHA256'] = '0' * 64
            if mutation == 'checkout': job['steps'][0]['with']['persist-credentials'] = True
            with self.subTest(mutation=mutation), self.assertRaises(contract.Refused):
                contract.verification_contract(document, pins['verificationNormalizedSha256'], contract.digest(read(contract.CONTRACT)))

    def test_duplicate_json_paths_and_transform_document_mismatch_refuse(self):
        with self.assertRaisesRegex(contract.Refused, 'DUPLICATE_JSON_KEY'):
            contract.strict_json(b'{"status":"blocked","status":"reviewed-integrated"}')
        for path in ('../outside', '/outside', 'scripts/../outside', 'scripts\\outside'):
            with self.assertRaises(contract.Refused): contract.safe_path(path)
        pins, read = self.ready_fixture()
        recipe = copy.deepcopy(self.recipe)
        recipe['groups'][0]['operations'][0]['after'] += '# changed\n'
        with self.assertRaisesRegex(contract.Refused, 'TRANSFORM_DOCUMENT_MISMATCH'):
            contract.verify(read, pins, recipe, parse_yaml)


if __name__ == '__main__':
    unittest.main()
