import ast
import copy
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('contract', ROOT / 'deploy/v52/recovery-r16/verify-contract.py')
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
                       b'    - name: Clone fresh snapshot and guarded R16 production cutover',
                       b'    - name: Remove temporary School SSH material']:
            self.assertEqual(raw.count(marker), 1)
            changed = raw.replace(marker, b'# unreviewed command\n' + marker)
            with self.subTest(marker=marker), self.assertRaisesRegex(contract.Refused, 'CONTROLLER_DRIFT'):
                contract.verify(self.replaced({contract.CONTROLLER: changed}))

    def test_original_guards_after_delivery_remain_exact(self):
        before = self.read(contract.BASE).decode()
        after = self.read(contract.CONTROLLER).decode()
        marker = '    - name: Verify and load exact hosted-verified image\n'
        expected = before[before.index(marker):]
        allowed = [["Verify R14 identity and accepted R13 success history","Verify R16 identity and accepted R15 success history"],["Verify R14 checkout and release contracts","Verify R16 checkout and release contracts"],["Verify retained R14 candidate before any replay skip","Verify retained R16 candidate before any replay skip"],["Verify accepted R13 baseline and preserved School relay","Verify accepted R15 baseline and preserved School relay"],["Clone fresh snapshot and guarded R14 production cutover","Clone fresh snapshot and guarded R16 production cutover"],["School diagnostic and real browser acceptance after R14 cutover","School diagnostic and real browser acceptance after R16 cutover"],["Retire only the exact unused R14 browser image","Retire only the exact unused accepted R15 browser image"],["r14-backup-adoption.py","r16-backup-adoption.py"],["r14-backup-controller.py","r16-backup-controller.py"],["r14-candidate-state.py","r16-candidate-state.py"],["r14-public-audit.py","r16-public-audit.py"],["r14-resume-candidate.py","r16-resume-candidate.py"],["r14-live-baseline.py","r16-live-baseline.py"],["run-r14-live-browser.py","run-r16-live-browser.py"],["6356740984e0c7ad1ad6a30da8bd8f5c6c0b8c268d11f35d09e5984e76c2f76e","3b81e98433e7d948d899fcfc1a9e94ee15faa3ef17cb1d1d4d1cb5c371ff67c7"]]
        for old, new in allowed:
            expected = expected.replace(old, new)
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
                     '.github/scripts/r14-live-baseline.py', '.github/scripts/r16-backup-controller.py',
                     '.github/scripts/r16-backup-adoption.py', '.github/scripts/r16-candidate-state.py',
                     'deploy/v52/src/lib/integrations.ts', 'deploy/browser/retire-r15-browser.mjs']:
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
                              (b'python3 -I -B .github/scripts/test-r16-backup-controller.py', b'true')]:
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
        self.assertEqual(raw, self.read('.github/scripts/r16-history-gate.py'))

    def test_publication_method_is_explicitly_squash(self):
        self.assertEqual(contract.RELEASE.get('mergeMethod'), 'squash')
        self.assertEqual(self.pins['release'].get('mergeMethod'), 'squash')

    def test_actual_rejected_merge_and_valid_squash_use_unchanged_jq_gate(self):
        raw = self.read(contract.CONTROLLER).decode()
        pattern = r"'(\.sha == \$sha and\n\s+\.commit\.verification\.verified == true and\n\s+\(\.parents \| length\) == 1 and\n\s+\.parents\[0\]\.sha == \$previous_sha)'"
        filters = re.findall(pattern, raw)
        self.assertEqual(len(filters), 1, 'the original single-parent/signature gate must remain exact')
        actual = json.loads(self.read('.github/scripts/fixtures/r15-rejected-publication.json'))
        previous = '9862a6e863d4d791c00ddeaba9480154ad5b8c4d'
        def accepted(value):
            run = subprocess.run(['jq', '-e', '--arg', 'sha', actual['sha'], '--arg', 'previous_sha', previous, filters[0]],
                                 input=json.dumps(value), text=True, capture_output=True, timeout=10)
            return run.returncode == 0
        self.assertTrue(actual['commit']['verification']['verified'])
        self.assertEqual(len(actual['parents']), 2)
        self.assertFalse(accepted(actual), 'actual PR404 merge must remain rejected')
        synthetic = copy.deepcopy(actual)
        synthetic['parents'] = [{'sha': previous}]
        self.assertTrue(accepted(synthetic), 'synthetic verified squash shape is admissible, not live evidence')
        for mutation in ['signature', 'source', 'parent', 'no_parents', 'duplicate_parent']:
            value = copy.deepcopy(synthetic)
            if mutation == 'signature': value['commit']['verification']['verified'] = False
            elif mutation == 'source': value['sha'] = '0' * 40
            elif mutation == 'parent': value['parents'][0]['sha'] = '0' * 40
            elif mutation == 'no_parents': value['parents'] = []
            else: value['parents'] *= 2
            with self.subTest(mutation=mutation):
                self.assertFalse(accepted(value))


if __name__ == '__main__':
    unittest.main()
