import importlib.util
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = pathlib.Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('maintenance', HERE / 'd083-maintenance-route.py')
maintenance = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(maintenance)

HOST = 'arthello-188-225-38-55.sslip.io'
OLD = 'arthello-direct-old:8081'
NEW = 'arthello-direct-123-1:8081'
NONCE = 'a' * 64
SOURCE = '''# Existing external routes\narthello-188-225-38-55.sslip.io {\n    encode zstd gzip\n    header X-Frame-Options DENY\n    reverse_proxy arthello-direct-old:8081\n}\n\nschool-188-225-38-55.sslip.io {\n    reverse_proxy school-1-11:3111\n}\n'''
SHARED = (HERE / 'test-fixtures/d083-stroios-Caddyfile').read_text()
GATEWAY = 'b' * 64
IMAGE = 'sha256:' + 'c' * 64
DOMAIN = 'stroios.example.invalid'


def evidence(main=SHARED, source=SOURCE):
    return {'version': 1, 'gatewayId': GATEWAY, 'gatewayImageId': IMAGE, 'appDomain': DOMAIN,
            'mainConfigSha256': maintenance.sha256(main), 'externalRoutesSha256': maintenance.sha256(source)}


def observation(domain=DOMAIN):
    return [{'Id': GATEWAY, 'Image': IMAGE, 'State': {'Running': True, 'Paused': False, 'Restarting': False},
             'Config': {'Env': ['APP_DOMAIN=' + domain, 'UNRELATED_SECRET=PRIVATE_ENV_SENTINEL']}}]


def cli_fixture(root, main=SHARED):
    for name, value in [('before', SOURCE), ('main', main), ('nonce', NONCE + '\n'),
                        ('live-main', main), ('live-routes', SOURCE), ('inspect', json.dumps(observation())),
                        ('evidence', json.dumps(evidence(main)))]:
        maintenance.write_private(root / name, value)
    docker = root / 'docker'
    docker.write_text('#!' + sys.executable + '\n' + '''import json, pathlib, sys
root=pathlib.Path(__file__).parent
args=sys.argv[1:]
with (root/'calls').open('a') as log: log.write(json.dumps(args)+'\\n')
if args == ['container','inspect','b'*64]: name='inspect'
elif args == ['exec','b'*64,'cat','/etc/caddy/Caddyfile']: name='live-main'
elif args == ['exec','b'*64,'cat','/data/external-routes.caddy']: name='live-routes'
else: raise SystemExit(7)
sys.stdout.write((root/name).read_text())
''')
    docker.chmod(0o700)
    return {**os.environ, 'PATH': str(root) + os.pathsep + os.environ.get('PATH', '')}


def invoke(root, command, env, extras=()):
    args = [sys.executable, str(HERE / 'd083-maintenance-route.py'), command,
            '--input', str(root / 'before'), '--main-config', str(root / 'main'),
            '--gateway-env-evidence', str(root / 'evidence'), *extras]
    return subprocess.run(args, env=env, capture_output=True, text=True, timeout=8)


class MaintenanceTest(unittest.TestCase):
    def test_shared_stroios_template_accepts_only_bound_top_level_domain(self):
        source = (HERE / 'test-fixtures/d083-stroios-Caddyfile').read_text()
        maintenance.validate_main_config(source, app_domain='stroios.example.invalid')
        self.assertTrue(source.startswith('{$APP_DOMAIN} {\n'))
        with self.assertRaises(maintenance.GateError):
            maintenance.validate_main_config(source)

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
            env = cli_fixture(root)
            result = subprocess.run([sys.executable, str(HERE / 'd083-maintenance-route.py'), 'render',
                                     '--input', str(root / 'before'), '--main-config', str(root / 'main'),
                                     '--normal-output', str(root / 'normal'), '--maintenance-output', str(root / 'private'),
                                     '--old-upstream', OLD, '--candidate-upstream', NEW, '--nonce-file', str(root / 'nonce'),
                                     '--gateway-env-evidence', str(root / 'evidence')],
                                    capture_output=True, text=True, env=env)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stderr, '')
            self.assertEqual(json.loads(result.stdout), {'kind': 'candidate-maintenance-route', 'result': 'rendered'})
            self.assertEqual((root / 'normal').read_text(), SOURCE.replace(OLD, NEW))
            self.assertEqual((root / 'private').stat().st_mode & 0o777, 0o600)
            self.assertNotIn(NONCE, result.stdout)
            self.assertNotIn(DOMAIN, result.stdout)
            self.assertEqual((root / 'main').read_text(), SHARED)

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

    def test_exact_shared_template_identity_is_frozen(self):
        raw = (HERE / 'test-fixtures/d083-stroios-Caddyfile').read_bytes()
        self.assertEqual(hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest(),
                         '37ff734e50f904982407baffe43cbc787dc3ce9f')

    def test_only_one_unquoted_top_level_placeholder_site_address_is_accepted(self):
        cases = [SHARED.replace('{$APP_DOMAIN}', token) for token in
                 ['{$OTHER}', '{$APP_DOMAIN:default.invalid}', '"{$APP_DOMAIN}"', '`{$APP_DOMAIN}`',
                  'https://{$APP_DOMAIN}', '{$APP_DOMAIN}:443', '*.{$APP_DOMAIN}',
                  '{$APP_DOMAIN},', 'alias.invalid {$APP_DOMAIN}', '{$APP_DOMAIN} alias.invalid']]
        cases += [SHARED + '# {$UNRELATED}\n', SHARED + '# {$APP_DOMAIN}\n',
                  SHARED.replace('encode zstd gzip', 'header X-Value {$APP_DOMAIN}'),
                  SHARED.replace('encode zstd gzip', 'header X-Value {env.APP_DOMAIN}'),
                  SHARED + '{$APP_DOMAIN} {\n respond 200\n}\n',
                  'example.invalid {\n' + SHARED + '}\n',
                  SHARED.replace('import /data/external-routes.caddy', 'import /data/external-routes.caddy other'),
                  SHARED + 'import /private/other\n',
                  SHARED.replace('  encode zstd gzip', '  log {\n    log_credentials\n  }')]
        for source in cases:
            with self.subTest(case=cases.index(source)):
                with self.assertRaises(maintenance.GateError):
                    maintenance.validate_main_config(source, app_domain=DOMAIN)
        for source in [SOURCE + '# {$OTHER}\n', SOURCE + '# {env.APP_DOMAIN}\n']:
            with self.assertRaises(maintenance.GateError):
                maintenance.render_routes(source, OLD, NEW, NONCE)

    def test_domain_has_no_origin_overlap_or_caddy_syntax(self):
        cases = ['', HOST, 'school-188-225-38-55.sslip.io', 'Example.invalid', 'example.invalid.',
                 'https://example.invalid', 'example.invalid:443', '*.example.invalid', 'example.invalid/route',
                 'example.invalid other.invalid', 'example.invalid\nrespond 200', 'example.invalid\r',
                 'example.invalid\t', 'example.invalid\x00', '{$OTHER}', '"example.invalid"',
                 'example.invalid#comment', 'example..invalid', '-example.invalid', 'example-.invalid',
                 'example_invalid', 'localhost', '127.0.0.1', '[::1]', 'a' * 64 + '.invalid',
                 '.'.join(['a' * 63] * 5)]
        for domain in cases:
            with self.subTest(case=cases.index(domain)):
                with self.assertRaises(maintenance.GateError):
                    maintenance.validate_main_config(SHARED, app_domain=domain)
        for domain in [DOMAIN, 'a.example', 'xn--e1afmkfd.example', 'stroios-188-225-38-55.sslip.io']:
            maintenance.validate_main_config(SHARED, app_domain=domain)

    def test_fresh_gateway_observation_reads_only_exact_metadata_and_files(self):
        calls = []
        def read(args):
            calls.append(args)
            if args == ['container', 'inspect', GATEWAY]: return json.dumps(observation())
            if args == ['exec', GATEWAY, 'cat', '/etc/caddy/Caddyfile']: return SHARED
            if args == ['exec', GATEWAY, 'cat', '/data/external-routes.caddy']: return SOURCE
            raise AssertionError('Unexpected Docker operation')
        value = maintenance.observe_gateway(GATEWAY, include_external=True, read=read)
        self.assertEqual({'version': 1, **value}, evidence())
        self.assertEqual(len(calls), 3)
        self.assertNotIn('PRIVATE_ENV_SENTINEL', json.dumps(value))
        self.assertNotIn('UNRELATED_SECRET', json.dumps(value))
        self.assertEqual(calls[0], ['container', 'inspect', GATEWAY])

    def test_gateway_identity_state_and_sole_env_assignment_fail_closed(self):
        cases = []
        for field, value in [('Id', 'd' * 64), ('Image', 'caddy:latest'), ('Image', None)]:
            record = observation(); record[0][field] = value; cases.append(record)
        for field, value in [('Running', False), ('Running', 1), ('Paused', True), ('Restarting', True)]:
            record = observation(); record[0]['State'][field] = value; cases.append(record)
        for env in [[], None, ['APP_DOMAIN=' + DOMAIN] * 2, ['APP_DOMAIN'], ['APP_DOMAIN='],
                    ['APP_DOMAIN=' + HOST], ['APP_DOMAIN=' + DOMAIN + '\nrespond 200'], [123]]:
            record = observation(); record[0]['Config']['Env'] = env; cases.append(record)
        cases += [[], observation() + observation(), {}, [None]]
        for record in cases:
            calls = []
            def read(args):
                calls.append(args)
                return json.dumps(record) if args[0] == 'container' else SHARED
            with self.subTest(case=cases.index(record)):
                with self.assertRaises(maintenance.GateError):
                    maintenance.observe_gateway(GATEWAY, read=read)
                self.assertEqual(len(calls), 1)
        for value in ['--help', GATEWAY[:12], GATEWAY + '\n', None]:
            with self.assertRaises(maintenance.GateError):
                maintenance.observe_gateway(value, read=lambda _: self.fail('Unexpected Docker call'))

    def test_binding_verifies_live_main_domain_image_and_original_route_copy(self):
        expected = evidence()
        observed = {key: value for key, value in expected.items() if key not in ('version', 'externalRoutesSha256')}
        self.assertEqual(maintenance.verify_gateway_evidence(SHARED, SOURCE, expected, observe=lambda _: observed), expected)
        for key, value in [('gatewayId', 'd' * 64), ('gatewayImageId', 'sha256:' + 'd' * 64),
                           ('appDomain', 'changed.example.invalid'), ('mainConfigSha256', 'd' * 64)]:
            with self.subTest(field=key):
                with self.assertRaises(maintenance.GateError):
                    maintenance.verify_gateway_evidence(SHARED, SOURCE, expected, observe=lambda _: {**observed, key: value})
        for main, external in [(SHARED + '# drift\n', SOURCE), (SHARED, SOURCE + '# drift\n')]:
            with self.assertRaises(maintenance.GateError):
                maintenance.verify_gateway_evidence(main, external, expected, observe=lambda _: self.fail('Unbound input'))

    def test_capture_binds_both_actual_gateway_files_before_evidence_creation(self):
        expected = evidence()
        observed = {key: value for key, value in expected.items() if key != 'version'}
        self.assertEqual(maintenance.capture_gateway_evidence(SHARED, SOURCE, GATEWAY,
                         observe=lambda identifier, include_external: observed), expected)
        for field in ('mainConfigSha256', 'externalRoutesSha256'):
            with self.assertRaises(maintenance.GateError):
                maintenance.capture_gateway_evidence(SHARED, SOURCE, GATEWAY,
                    observe=lambda identifier, include_external: {**observed, field: 'd' * 64})

    def test_private_evidence_rejects_duplicate_unknown_fields_and_bad_schema(self):
        cases = [json.dumps({**evidence(), 'version': True}), json.dumps({**evidence(), 'extra': 'PRIVATE_EXTRA'}),
                 json.dumps({**evidence(), 'gatewayId': GATEWAY[:12]}),
                 json.dumps({**evidence(), 'appDomain': HOST}), json.dumps({**evidence(), 'mainConfigSha256': 'INVALID'}),
                 json.dumps({**evidence(), 'gatewayImageId': 'caddy:latest'}), '[]',
                 json.dumps(evidence())[:-1] + ',"version":1}']
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for i, value in enumerate(cases):
                path = root / str(i); maintenance.write_private(path, value)
                with self.assertRaises(maintenance.GateError): maintenance.load_evidence(path)
            valid = root / 'valid'; maintenance.write_private(valid, json.dumps(evidence()))
            self.assertEqual(maintenance.load_evidence(valid), evidence())
            valid.chmod(0o644)
            with self.assertRaises(maintenance.GateError): maintenance.load_evidence(valid)
            valid.chmod(0o600); (root / 'link').symlink_to(valid)
            with self.assertRaises(OSError): maintenance.load_evidence(root / 'link')

    def test_cli_observe_creates_private_binding_then_resume_rechecks_actual_main(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); env = cli_fixture(root)
            (root / 'evidence').unlink()
            result = invoke(root, 'observe-gateway', env, ['--gateway-id', GATEWAY])
            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertEqual(json.loads(result.stdout), {'kind': 'candidate-gateway-binding', 'result': 'observed'})
            self.assertEqual((root / 'evidence').stat().st_mode & 0o777, 0o600)
            self.assertEqual(maintenance.load_evidence(root / 'evidence'), evidence())
            (root / 'live-routes').write_text('MAINTENANCE_RENDERED_CONFIG')
            result = invoke(root, 'verify-gateway', env)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(json.loads(result.stdout), {'kind': 'candidate-gateway-binding', 'result': 'verified'})
            (root / 'live-main').write_text(SHARED + '# PRIVATE_CONFIG_DRIFT\n')
            result = invoke(root, 'verify-gateway', env)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stderr, '')
            self.assertNotIn('PRIVATE', result.stdout)
            self.assertNotIn(DOMAIN, result.stdout)

    def test_cli_failed_observation_never_writes_evidence_or_exposes_docker_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); env = cli_fixture(root)
            (root / 'evidence').unlink()
            (root / 'docker').write_text('#!' + sys.executable + '\nimport sys\nprint("PRIVATE_DOCKER_ENV")\nprint("PRIVATE_DOCKER_ERROR",file=sys.stderr)\nsys.exit(1)\n')
            result = invoke(root, 'observe-gateway', env, ['--gateway-id', GATEWAY])
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stderr, '')
            self.assertNotIn('PRIVATE', result.stdout)
            self.assertFalse((root / 'evidence').exists())

    def test_cli_render_rejects_stale_domain_before_writing_either_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); env = cli_fixture(root)
            (root / 'inspect').write_text(json.dumps(observation('changed.example.invalid')))
            result = invoke(root, 'render', env, ['--normal-output', str(root / 'normal'),
                '--maintenance-output', str(root / 'maintenance'), '--nonce-file', str(root / 'nonce'),
                '--old-upstream', OLD, '--candidate-upstream', NEW])
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stderr, '')
            self.assertEqual(json.loads(result.stdout), {'kind': 'candidate-maintenance-route', 'result': 'blocked'})
            self.assertFalse((root / 'normal').exists())
            self.assertFalse((root / 'maintenance').exists())
            self.assertEqual((root / 'main').read_text(), SHARED)

    def test_cli_unknown_args_and_missing_private_input_are_sanitized(self):
        for args in [['PRIVATE_ARGUMENT'], ['probe', '--nonce-file', '/PRIVATE_NONCE_PATH']]:
            result = subprocess.run([sys.executable, str(HERE / 'd083-maintenance-route.py'), *args], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stderr, '')
            self.assertNotIn('PRIVATE', result.stdout)
            self.assertIn('"result":"blocked"', result.stdout)


if __name__ == '__main__':
    unittest.main()
