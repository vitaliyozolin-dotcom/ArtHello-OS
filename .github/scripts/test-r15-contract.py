import ast
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('contract', ROOT / 'deploy/v52/recovery-r15/verify-contract.py')
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.read = contract.source_reader(ROOT)
        self.pins = contract.strict_json(self.read(contract.DIRECTORY + 'source-pins.json'))

    def replaced(self, changes):
        return lambda name: changes[name] if name in changes else self.read(name)

    def test_complete_reviewed_controller_and_inputs(self):
        result = contract.verify(self.read)
        self.assertEqual(result['result'], 'verified')
        self.assertEqual(result['durableProtocolSchema'], 14)
        self.assertEqual(result['productionAcceptance'], 'not_run')
        self.assertFalse((ROOT / contract.OLD_CONTROLLER).exists())

    def test_any_controller_insertion_is_refused(self):
        raw = self.read(contract.CONTROLLER)
        for marker in [b'jobs:', b'    environment: production-ru', b'    - name: Verify and load exact hosted-verified image',
                       b'    - name: Clone fresh snapshot and guarded R14 production cutover',
                       b'    - name: Remove temporary School SSH material']:
            self.assertEqual(raw.count(marker), 1)
            changed = raw.replace(marker, b'# unreviewed command\n' + marker)
            with self.subTest(marker=marker), self.assertRaisesRegex(contract.Refused, 'CONTROLLER_DRIFT'):
                contract.verify(self.replaced({contract.CONTROLLER: changed}))

    def test_original_guards_after_delivery_remain_exact(self):
        before = self.read(contract.BASE).decode()
        after = self.read(contract.CONTROLLER).decode()
        marker = '    - name: Verify and load exact hosted-verified image\n'
        expected = before[before.index(marker):].replace('"$RUNNER_TEMP/arthello-v52-release-$GITHUB_RUN_ID"',
                                                        '"$RUNNER_TEMP/arthello-v52-release-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"')
        self.assertEqual(after[after.index(marker):], expected)

    def test_recipe_cannot_add_or_repin_operations(self):
        base = self.read(contract.BASE)
        raw = self.read(contract.DIRECTORY + 'transform.json')
        recipe = contract.strict_json(raw)
        for change in ['count', 'after', 'release']:
            value = copy.deepcopy(recipe)
            if change == 'count':
                value['operations'][0]['count'] += 1
            elif change == 'after':
                value['operations'][0]['after'] += '\ntrue\n'
            else:
                value['release']['pr'] += 1
            with self.subTest(change=change), self.assertRaisesRegex(contract.Refused, 'FROZEN_TRANSFORM_DRIFT'):
                contract.transform(base, json.dumps(value).encode())

    def test_common_backup_protocol_cannot_be_repinned(self):
        name = '.github/scripts/r14-backup-controller.py'
        pins = copy.deepcopy(self.pins)
        pins['sourceFiles'][name] = contract.digest(b'changed')
        with self.assertRaisesRegex(contract.Refused, 'FROZEN_PROTOCOL_REPINNED'):
            contract.verify(self.replaced({name: b'changed', contract.DIRECTORY + 'source-pins.json': json.dumps(pins).encode()}))

    def test_current_source_and_helper_mutations_are_refused(self):
        for name in ['deploy/v52/src/db/index.ts', 'deploy/v52/src/lib/tochka-autosync.ts',
                     '.github/scripts/download-v52-artifact-r15.py', 'deploy/browser/retire-r14-browser.mjs',
                     '.github/scripts/r14-live-baseline.py']:
            with self.subTest(name=name), self.assertRaisesRegex(contract.Refused, 'SOURCE_DRIFT'):
                contract.verify(self.replaced({name: self.read(name) + b'\n'}))

    def test_source_inventory_cannot_omit_a_guard(self):
        pins = copy.deepcopy(self.pins)
        del pins['sourceFiles']['.github/scripts/r14-backup-adoption.py']
        with self.assertRaisesRegex(contract.Refused, 'SOURCE_INVENTORY'):
            contract.verify(self.replaced({contract.DIRECTORY + 'source-pins.json': json.dumps(pins).encode()}))

    def test_verification_permissions_checkout_and_pin_are_reviewed(self):
        raw = self.read(contract.VERIFICATION)
        for before, after in [(b'contents: read', b'contents: write'),
                              (b'persist-credentials: false', b'persist-credentials: true'),
                              (b'python3 -I -B .github/scripts/test-r15-artifact-download.py', b'true')]:
            self.assertIn(before, raw)
            with self.subTest(before=before), self.assertRaisesRegex(contract.Refused, 'VERIFICATION_DRIFT'):
                contract.verify(self.replaced({contract.VERIFICATION: raw.replace(before, after)}))

    def test_duplicate_keys_and_unsafe_paths_fail(self):
        with self.assertRaisesRegex(contract.Refused, 'DUPLICATE_KEY'):
            contract.strict_json(b'{"format":1,"format":2}')
        for name in ['../file', '/etc/passwd', './AGENTS.md', 'scripts/../AGENTS.md', 'scripts\\file']:
            with self.subTest(name=name), self.assertRaises(contract.Refused):
                self.read(name)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'real').write_text('example')
            (root / 'alias').symlink_to(root / 'real')
            with self.assertRaises(contract.Refused):
                contract.source_reader(root)('alias')

    def test_inline_history_is_exact_reviewed_helper(self):
        lines = self.read(contract.CONTROLLER).decode().splitlines()
        literals = [line.strip() for line in lines if line.strip().startswith('HELPER_LITERAL = ')]
        self.assertEqual(len(literals), 1)
        raw = ast.literal_eval(literals[0].split(' = ', 1)[1])
        self.assertEqual(raw, self.read('.github/scripts/r15-history-gate.py'))


if __name__ == '__main__':
    unittest.main()
