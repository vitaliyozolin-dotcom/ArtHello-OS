"""Exercise namespace refusals without Docker or production access."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class CleanupOwnershipTests(unittest.TestCase):
    def test_occupied_namespace_never_authorizes_cleanup(self):
        for collision in ('container', 'volume', 'network', 'none'):
            with self.subTest(collision=collision), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                command = root / 'docker'
                command.write_text('''#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]
with open(os.environ['CALLS'],'a') as out: out.write(json.dumps(args)+'\\n')
kind='container' if args[:2]==['ps','-aq'] else 'volume' if args[:2]==['volume','ls'] else 'network' if args[:2]==['network','ls'] else None
if kind and os.environ['COLLISION']==kind: print('existing-other-resource')
if args[:2]==['volume','create']: sys.exit(9)
''')
                command.chmod(0o755)
                calls = root / 'calls'
                head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
                environment = {**os.environ, 'PATH': str(root) + ':' + os.environ['PATH'],
                    'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted', 'DOCKER_HOST': '',
                    'CHECKED_SOURCE_SHA': head, 'IMMUTABLE_IMAGE_ID': 'sha256:' + 'a' * 64,
                    'GITHUB_RUN_ID': '101', 'GITHUB_RUN_ATTEMPT': '1', 'RUNNER_TEMP': str(root),
                    'CALLS': str(calls), 'COLLISION': collision}
                result = subprocess.run(['bash', '.github/scripts/run-finance-ci-browser.sh'], cwd=ROOT,
                                        env=environment, capture_output=True, timeout=15)
                self.assertNotEqual(result.returncode, 0)
                rows = [json.loads(line) for line in calls.read_text().splitlines()]
                removals = [row for row in rows if 'rm' in row]
                creates = [row for row in rows if 'create' in row]
                if collision != 'none':
                    self.assertEqual(removals, [])
                    self.assertEqual(creates, [])
                else:
                    self.assertEqual(result.returncode, 9)
                    self.assertEqual(len(creates), 1)
                    self.assertEqual(removals, [
                        ['rm', '-f', 'arthello-finance-ci-101-1-browser', 'arthello-finance-ci-101-1-app'],
                        ['volume', 'rm', 'arthello-finance-ci-101-1-data'],
                        ['network', 'rm', 'arthello-finance-ci-101-1-net']])


if __name__ == '__main__':
    unittest.main()
