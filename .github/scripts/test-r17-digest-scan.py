"""Prove the exact public checksum exception leaves secret detection active."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = 'deploy/v52/src/tests/finance-articles-api.test.mjs'
PIN_FILE = 'deploy/v52/recovery-r17/source-pins.json'
PUBLIC_DIGEST = 'b7276c29aa18837416f49b9d18d7899f5b9886e0548554e2ee037c59f5ea38e3'
IMAGE = 'ghcr.io/gitleaks/gitleaks:v8.30.0@sha256:691af3c7c5a48b16f187ce3446d5f194838f91238f27270ed36eef6359a574d9'


class PublicDigestTests(unittest.TestCase):
    def test_exception_is_only_exact_public_digest_at_exact_inventory_path(self):
        self.assertEqual(hashlib.sha256((ROOT / SOURCE).read_bytes()).hexdigest(), PUBLIC_DIGEST)
        self.assertEqual(json.loads((ROOT / PIN_FILE).read_text())['sourceFiles'][SOURCE], PUBLIC_DIGEST)
        value = tomllib.loads((ROOT / '.gitleaks.toml').read_text())
        self.assertEqual(set(value), {'title', 'extend', 'rules'})
        self.assertEqual(value['extend'], {'useDefault': True})
        self.assertEqual(value['rules'], [{'id': 'generic-api-key', 'allowlists': [{
            'description': 'Exact SHA-256 of the public finance API regression test in the R17 source inventory',
            'condition': 'AND', 'paths': [r'(^|/)deploy/v52/recovery-r17/source-pins\.json$'],
            'regexTarget': 'secret', 'regexes': ['^' + PUBLIC_DIGEST + '$']}]}])

    @unittest.skipUnless(os.environ.get('GITHUB_ACTIONS') == 'true', 'actual scanner runs on hosted CI')
    def test_actual_pinned_scanner_detects_new_value_and_other_path(self):
        for case in ('original_default', 'exact_public_digest', 'different_value', 'different_path'):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                if case != 'original_default':
                    (root / '.gitleaks.toml').write_bytes((ROOT / '.gitleaks.toml').read_bytes())
                path = PIN_FILE if case != 'different_path' else 'other/source-pins.json'
                target = root / path
                target.parent.mkdir(parents=True)
                digest = secrets.token_hex(32) if case == 'different_value' else PUBLIC_DIGEST
                target.write_text(json.dumps({SOURCE: digest}, indent=2))
                result = subprocess.run(['docker', 'run', '--rm', '--user', f'{os.getuid()}:{os.getgid()}',
                    '-v', str(root) + ':/scan:ro', IMAGE, 'dir', '--no-banner', '--redact', '--exit-code', '23', '/scan'],
                    capture_output=True, timeout=120)
                self.assertEqual(result.returncode, 0 if case == 'exact_public_digest' else 23,
                                 'pinned scanner boundary failed: ' + case)


if __name__ == '__main__':
    unittest.main()
