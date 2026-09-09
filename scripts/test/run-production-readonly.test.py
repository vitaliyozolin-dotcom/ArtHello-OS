"""Synthetic subprocess harness for the D075 launcher; no real Docker or database."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = 'a' * 40
LIVE = 'b' * 64
IMAGE = 'sha256:' + 'c' * 64


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='readonly-launcher-test-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.log = self.directory / 'commands.jsonl'
        program = r'''
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
log = pathlib.Path(os.environ['D075_TEST_LOG'])
with log.open('a') as stream:
    stream.write(json.dumps([name, args]) + '\n')
if name == 'python3':
    previous = [json.loads(line) for line in log.read_text().splitlines()]
    count = sum(item[0] == 'python3' for item in previous)
    mode = os.environ.get('D075_TEST_MODE', '')
    if mode == 'initial-refusal' or mode == 'final-refusal' and count == 2:
        print('READONLY_BLOCKED=accepted_runtime_identity', file=sys.stderr)
        raise SystemExit(2)
    print(json.dumps(dict(liveId='b'*64,imageId='sha256:'+'c'*64,sourceSha='a'*40,backupId='d'*64), separators=(',', ':')))
elif name == 'precheck-node':
    print('d1/miniflare-D1DatabaseObject/' + 'e'*64 + '.sqlite')
elif name == 'docker':
    if args[0] == 'inspect':
        raise SystemExit(1)  # This invocation owns no previous temporary helper.
    if args[0] == 'exec':
        sys.stdin.read()
    elif args[0] == 'run':
        sys.stdin.read()
        print('{"schemaVersion":1,"synthetic":true,"productionMutations":false}')
    else:
        raise SystemExit('unexpected Docker capability')
else:
    raise SystemExit('unexpected executable')
'''
        for name in ('python3', 'precheck-node', 'docker'):
            path = self.directory / name
            path.write_text('#!' + sys.executable + '\n' + program)
            path.chmod(0o700)
        self.environment = {
            **os.environ, 'PATH': str(self.directory) + ':' + os.environ['PATH'],
            'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1',
            'EXPECTED_LIVE_SOURCE_SHA': SOURCE, 'PRECHECK_NODE': str(self.directory / 'precheck-node'),
            'D075_TEST_LOG': str(self.log),
        }

    def run_launcher(self, mode=''):
        return subprocess.run(['bash', 'scripts/run-production-readonly.sh'], cwd=ROOT,
                              env={**self.environment, 'D075_TEST_MODE': mode},
                              capture_output=True, text=True, timeout=10)

    def commands(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_verified_pair_is_checked_before_and_after_only_readonly_probe(self):
        result = self.run_launcher()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.commands()
        observations = [index for index, (name, _) in enumerate(calls) if name == 'python3']
        probes = [(index, args) for index, (name, args) in enumerate(calls) if name == 'docker' and args[0] == 'run']
        self.assertEqual(len(observations), 2)
        self.assertEqual(len(probes), 1)
        index, args = probes[0]
        self.assertLess(observations[0], index)
        self.assertGreater(observations[1], index)
        self.assertEqual(args[args.index('--user') + 1], '1000:1000')
        self.assertEqual(args[args.index('--network') + 1], 'none')
        self.assertEqual(args[args.index('--cap-drop') + 1], 'ALL')
        self.assertEqual(args[args.index('--security-opt') + 1], 'no-new-privileges:true')
        self.assertIn('--read-only', args)
        mounts = [args[i + 1] for i, value in enumerate(args) if value == '--mount']
        self.assertEqual(mounts, ['type=volume,src=arthello-direct-v44-data,dst=/data,readonly,volume-nocopy'])
        self.assertEqual(args[args.index('--entrypoint') + 2], IMAGE)
        self.assertFalse(any(value in args for value in ('--env-file', '--privileged', '--volume', '-v', '--pid', '--ipc')))
        self.assertIn('READONLY_FINISHED=aggregate_observation_not_live_acceptance', result.stdout)
        self.assertIn('exact_readonly_consumer_history_not_verified', result.stdout)

    def test_unverified_source_never_runs_identity_scan_or_database_probe(self):
        result = self.run_launcher('initial-refusal')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(name == 'docker' and args[0] in ('run', 'exec') for name, args in self.commands()))
        self.assertNotIn('READONLY_FINISHED=', result.stdout)

    def test_final_identity_refusal_cannot_emit_finished(self):
        result = self.run_launcher('final-refusal')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(sum(name == 'docker' and args[0] == 'run' for name, args in self.commands()), 1)
        self.assertNotIn('READONLY_FINISHED=', result.stdout)

    def test_no_expected_accepted_release_never_calls_docker(self):
        del self.environment['EXPECTED_LIVE_SOURCE_SHA']
        result = self.run_launcher()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.commands(), [])


if __name__ == '__main__':
    unittest.main()
