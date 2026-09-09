import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = pathlib.Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('maintenance', HERE / 'd080-maintenance-route.py')
maintenance = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(maintenance)

HOST = 'arthello-188-225-38-55.sslip.io'
OLD = 'arthello-direct-old:8081'
NEW = 'arthello-direct-123-1:8081'
NONCE = 'a' * 64
SOURCE = '''# Existing external routes\narthello-188-225-38-55.sslip.io {\n    encode zstd gzip\n    header X-Frame-Options DENY\n    reverse_proxy arthello-direct-old:8081\n}\n\nschool-188-225-38-55.sslip.io {\n    reverse_proxy school-1-11:3111\n}\n'''


class MaintenanceTest(unittest.TestCase):
    def test_main_config_cannot_hide_credentials_logging_or_another_import(self):
        main = '{\n    email fixture@example.invalid\n}\nimport /data/external-routes.caddy\n'
        maintenance.validate_main_config(main)
        for value in [main + 'import /private/config\n', main.replace('email fixture@example.invalid', 'servers {\n log_credentials\n }'),
                      main.replace('email fixture@example.invalid', 'servers {\n "log_credentials"\n }'),
                      main + '"import" /private/config\n', main + '{$EXTRA_CONFIG}\n',
                      main + HOST + ' { respond 200 }\n', main.replace('external-routes.caddy', 'other.caddy'),
                      'import /data/external-routes.caddy extra-argument\n']:
            with self.assertRaises(maintenance.GateError):
                maintenance.validate_main_config(value)

    def test_exact_host_preserves_all_other_bytes_and_normal_route(self):
        normal, private = maintenance.render_routes(SOURCE, OLD, NEW, NONCE)
        self.assertEqual(normal, SOURCE.replace(OLD, NEW))
        self.assertEqual(private.split('\nschool-')[1], SOURCE.split('\nschool-')[1])
        self.assertIn('    encode zstd gzip\n    header X-Frame-Options DENY\n', private)
        self.assertEqual(private.count(NONCE), 1)
        self.assertNotIn(OLD, private)

    def test_ambiguous_or_foreign_routes_fail_before_rendering(self):
        cases = [SOURCE.replace(HOST, 'foreign.invalid'), SOURCE + SOURCE,
                 SOURCE.replace(HOST, HOST + ' alias.invalid'),
                 SOURCE.replace('    reverse_proxy ' + OLD, '    reverse_proxy ' + OLD + '\n    respond 200'),
                 SOURCE.replace('    reverse_proxy ' + OLD, '    handle {\n        reverse_proxy ' + OLD + '\n    }'),
                 SOURCE.replace('    reverse_proxy ' + OLD, '    reverse_proxy ' + OLD + ' other:8081'),
                 SOURCE.replace('    reverse_proxy ' + OLD, '    import private-routes'),
                 SOURCE.replace('    reverse_proxy ' + OLD, '    reverse_proxy ' + OLD + ' {\n        header_up X-Foo bar\n    }'),
                 SOURCE.replace('    encode zstd gzip', '    rewrite * /api/school-sso/exchange'),
                 SOURCE.replace('    encode zstd gzip', '    @existing path /api/*'),
                 SOURCE.replace('    encode zstd gzip', '    log {\n      output file /tmp/access.log\n    }\n    handle_errors { respond 200 }')]
        for source in cases:
            with self.subTest(source=source):
                with self.assertRaises(maintenance.GateError):
                    maintenance.render_routes(source, OLD, NEW, NONCE)
        for old, new, nonce in [(OLD, 'foreign:8081', NONCE), (OLD, NEW, 'secret'),
                                (OLD, NEW, NONCE + '\n'), (OLD, OLD, NONCE),
                                (OLD + '\nrespond 200', NEW, NONCE)]:
            with self.assertRaises(maintenance.GateError):
                maintenance.render_routes(SOURCE, old, new, nonce)

    def test_probe_requests_are_bounded_no_credentials_or_mutating_payloads(self):
        calls = []
        def transport(method, path, headers):
            calls.append((method, path, headers))
            return 200 if method == 'GET' and path == '/' and headers == [NONCE] else 503
        result = maintenance.probe_gate(NONCE, transport)
        self.assertEqual(result['result'], 'pass')
        self.assertGreaterEqual(result['negativeChecks'], 12)
        self.assertEqual(calls[-1], ('GET', '/', [NONCE]))
        self.assertTrue(any(headers == [NONCE, NONCE] for _, _, headers in calls))
        self.assertFalse(any(path == '/api/school-sso/exchange' and method == 'POST' for method, path, _ in calls))
        with self.assertRaises(maintenance.GateError):
            maintenance.probe_gate(NONCE, lambda *_: 200)

    def test_private_nonce_and_outputs_reject_symlinks_permissive_modes_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            nonce = root / 'nonce'
            nonce.write_text(NONCE)
            nonce.chmod(0o600)
            self.assertEqual(maintenance.read_nonce(nonce), NONCE)
            link = root / 'link'
            link.symlink_to(nonce)
            with self.assertRaises(maintenance.GateError):
                maintenance.read_nonce(link)
            nonce.chmod(0o644)
            with self.assertRaises(maintenance.GateError):
                maintenance.read_nonce(nonce)
            fifo = root / 'fifo'
            os.mkfifo(fifo, 0o600)
            with self.assertRaises(maintenance.GateError):
                maintenance.read_nonce(fifo)
            output = root / 'new'
            maintenance.write_private(output, 'PRIVATE_CONFIG')
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(maintenance.GateError):
                maintenance.write_private(output, 'OTHER')
            self.assertEqual(output.read_text(), 'PRIVATE_CONFIG')

    def test_cli_render_uses_private_files_and_never_emits_the_nonce(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name, value in [('before', SOURCE), ('main', 'import /data/external-routes.caddy\n'), ('nonce', NONCE + '\n')]:
                maintenance.write_private(root / name, value)
            result = subprocess.run([sys.executable, str(HERE / 'd080-maintenance-route.py'), 'render',
                                     '--input', str(root / 'before'), '--main-config', str(root / 'main'),
                                     '--normal-output', str(root / 'normal'), '--maintenance-output', str(root / 'private'),
                                     '--old-upstream', OLD, '--candidate-upstream', NEW, '--nonce-file', str(root / 'nonce')],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stderr, '')
            self.assertEqual(json.loads(result.stdout), {'kind': 'candidate-maintenance-route', 'result': 'rendered'})
            self.assertEqual((root / 'normal').read_text(), SOURCE.replace(OLD, NEW))
            self.assertEqual((root / 'private').stat().st_mode & 0o777, 0o600)
            self.assertNotIn(NONCE, result.stdout)

    def test_curl_keeps_authorization_out_of_arguments_environment_and_output(self):
        observed = []
        def run(command, **kwargs):
            observed.append((command, kwargs))
            return subprocess.CompletedProcess(command, 0, '503', 'PRIVATE_REMOTE_BODY')
        with patch.object(maintenance.subprocess, 'run', run):
            self.assertEqual(maintenance.curl_status('POST', '/api/auth/login', [NONCE, NONCE]), 503)
        command, kwargs = observed[0]
        self.assertEqual(command, ['curl', '--disable', '--config', '-'])
        self.assertEqual(set(kwargs['env']), {'PATH'})
        self.assertNotIn(NONCE, repr(command) + repr(kwargs['env']))
        self.assertEqual(kwargs['input'].count('Authorization: ArtHelloCandidate ' + NONCE), 2)
        self.assertIn('output = "/dev/null"', kwargs['input'])
        self.assertIn('data = "{}"', kwargs['input'])
        self.assertIn('proto = "=https"', kwargs['input'])
        self.assertNotIn('insecure', kwargs['input'])
        self.assertNotIn('location', kwargs['input'])
        with patch.object(maintenance.subprocess, 'run', lambda *a, **k: subprocess.CompletedProcess(a[0], 0, 'PRIVATE_RESPONSE', '')):
            with self.assertRaises(maintenance.GateError):
                maintenance.curl_status('GET', '/', [])

    def test_cli_unknown_args_and_missing_private_input_are_sanitized(self):
        for args in [['PRIVATE_ARGUMENT'], ['probe', '--nonce-file', '/PRIVATE_NONCE_PATH']]:
            result = subprocess.run([sys.executable, str(HERE / 'd080-maintenance-route.py'), *args], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stderr, '')
            self.assertNotIn('PRIVATE', result.stdout)
            self.assertIn('"result":"blocked"', result.stdout)


if __name__ == '__main__':
    unittest.main()
