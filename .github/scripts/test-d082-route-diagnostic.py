import ast
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from unittest.mock import Mock, patch


HERE = pathlib.Path(__file__).parent
SCRIPT = HERE / 'd082-route-diagnostic.py'
SPEC = importlib.util.spec_from_file_location('diagnostic', SCRIPT)
diagnostic = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(diagnostic)

HOST = 'arthello-188-225-38-55.sslip.io'
OLD = 'arthello-direct-old:8081'
NEW = 'arthello-direct-123-1:8081'
SENTINELS = ('PRIVATE_CONFIG_SENTINEL', 'PRIVATE_PATH_SENTINEL',
             'PRIVATE_TOKEN_SENTINEL', 'a1' * 32,
             'https://private.invalid/callback?code=PRIVATE_CODE_SENTINEL')
MAIN = '{\n    email fixture@example.invalid\n}\nimport /data/external-routes.caddy\n'
SOURCE = '''arthello-188-225-38-55.sslip.io {
    encode zstd gzip
    header X-Frame-Options DENY
    reverse_proxy arthello-direct-old:8081
}
school-188-225-38-55.sslip.io {
    reverse_proxy school-1-11:3111
}
'''


class DiagnosticTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='d082-PRIVATE_PATH_SENTINEL-')
        self.root = pathlib.Path(self.temporary.name)
        self.routes = self.root / 'PRIVATE_CONFIG_SENTINEL.routes'
        self.main = self.root / 'PRIVATE_TOKEN_SENTINEL.main'
        self.write(self.routes, SOURCE)
        self.write(self.main, MAIN)

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, path, value):
        if isinstance(value, bytes):
            path.write_bytes(value)
        else:
            path.write_text(value)
        path.chmod(0o600)

    def diagnose(self, **kwargs):
        values = dict(input=self.routes, main_config=self.main,
                      old_upstream=OLD, candidate_upstream=NEW)
        values.update(kwargs)
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            result = diagnostic.diagnose(**values)
        self.assertEqual(stdout.getvalue(), '')
        self.assertEqual(stderr.getvalue(), '')
        self.assert_safe(result)
        return result

    def assert_safe(self, result):
        self.assertEqual(set(result), {'kind', 'result', 'stage', 'reason'})
        self.assertEqual(result['kind'], 'd082-route-diagnostic')
        self.assertIn(result['result'], ('pass', 'blocked'))
        self.assertRegex(result['stage'], r'^[a-z_]+$')
        self.assertRegex(result['reason'], r'^[a-z0-9_]+$')
        serialized = json.dumps(result)
        for sentinel in SENTINELS + (str(self.root), OLD, NEW):
            self.assertNotIn(sentinel, serialized)

    def assert_blocked(self, result, stage, reason):
        self.assertEqual(result, dict(kind='d082-route-diagnostic', result='blocked',
                                      stage=stage, reason=reason))

    def cli(self, args=None, script=SCRIPT):
        if args is None:
            args = ['--input', str(self.routes), '--main-config', str(self.main),
                    '--old-upstream', OLD, '--candidate-upstream', NEW]
        result = subprocess.run([sys.executable, '-I', str(script), *args],
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.stderr, '')
        self.assertEqual(len(result.stdout.splitlines()), 1)
        record = json.loads(result.stdout)
        self.assert_safe(record)
        self.assertEqual(result.returncode, 0 if record['result'] == 'pass' else 2)
        return record

    def test_supported_structure_emits_only_fixed_success_record(self):
        result = self.diagnose()
        self.assertEqual(result, dict(kind='d082-route-diagnostic', result='pass',
                                     stage='complete', reason='supported_structure'))
        self.assertEqual(self.cli(), result)
        self.assertEqual(self.routes.read_text(), SOURCE)
        self.assertEqual(self.main.read_text(), MAIN)

    def test_private_configuration_and_nonce_like_values_never_enter_output(self):
        private = '# ' + ' '.join(SENTINELS) + '\n'
        self.write(self.routes, private + SOURCE)
        self.write(self.main, private + MAIN)
        self.assertEqual(self.diagnose()['result'], 'pass')
        self.assertEqual(self.cli()['result'], 'pass')
        self.write(self.main, private + MAIN + '{$PRIVATE_TOKEN_SENTINEL}\n')
        self.assert_blocked(self.cli(), 'main_structure', 'main_environment_expansion')

    def test_realistic_unrelated_site_environment_expansion_is_reproducible(self):
        main = '''{
    email fixture@example.invalid
}
{$APP_DOMAIN} {
    reverse_proxy unrelated-app:3000
}
import /data/external-routes.caddy
'''
        self.write(self.main, main)
        self.assert_blocked(self.diagnose(), 'main_structure', 'main_environment_expansion')
        self.write(self.main, main.replace('{$APP_DOMAIN}', 'unrelated.example.invalid'))
        self.assertEqual(self.diagnose()['result'], 'pass')

    def test_main_invariants_have_specific_fixed_reasons(self):
        cases = [
            (MAIN + 'log_credentials\n', 'main_credentials_logging'),
            (MAIN + '{$PRIVATE_TOKEN_SENTINEL}\n', 'main_environment_expansion'),
            (MAIN + HOST + ' { respond 200 }\n', 'main_contains_arthello_origin'),
            (MAIN + 'import /PRIVATE_PATH_SENTINEL\n', 'main_import_count'),
            ('import /PRIVATE_PATH_SENTINEL\n', 'main_import_target_or_quoting'),
            ('"import" /data/external-routes.caddy\n', 'main_import_target_or_quoting'),
            ('import\n/data/external-routes.caddy\n', 'main_import_target_newline'),
            ('import /data/external-routes.caddy PRIVATE_TOKEN_SENTINEL\n', 'main_import_extra_arguments'),
            (MAIN + '"PRIVATE_TOKEN_SENTINEL\n"', 'quoted_token_multiline'),
            (MAIN + '"PRIVATE_TOKEN_SENTINEL', 'quoted_token_unterminated'),
            (MAIN + 'PRIVATE_TOKEN_SENTINEL\\escaped\n', 'bare_token_escape_or_heredoc'),
            (MAIN + '\x00PRIVATE_TOKEN_SENTINEL', 'lexical_input_format'),
        ]
        for source, reason in cases:
            with self.subTest(reason=reason):
                self.write(self.main, source)
                self.assert_blocked(self.diagnose(), 'main_structure', reason)

    def test_route_invariants_have_specific_fixed_reasons(self):
        cases = [
            (SOURCE + 'log_credentials\n', 'routes_credentials_logging'),
            (SOURCE + '{$PRIVATE_TOKEN_SENTINEL}\n', 'routes_environment_expansion'),
            (SOURCE + 'import /PRIVATE_PATH_SENTINEL\n', 'routes_import_directive'),
            (SOURCE.replace(HOST, 'foreign.invalid'), 'route_origin_token_count'),
            (SOURCE + SOURCE, 'route_origin_token_count'),
            (SOURCE + 'alias-' + HOST + ' {\n}\n', 'route_origin_substring_count'),
            (SOURCE.replace(OLD, 'foreign:8081'), 'old_upstream_token_count'),
            (SOURCE.replace('school-1-11:3111', NEW), 'candidate_upstream_already_present'),
            ('}\n' + SOURCE, 'unmatched_closing_brace'),
            (SOURCE + '{\n', 'unmatched_opening_brace'),
            (SOURCE.replace(HOST + ' {', HOST + ' alias.invalid {'), 'origin_scope_or_opening_brace'),
            (SOURCE.replace(HOST + ' {', 'alias.invalid ' + HOST + ' {'), 'origin_alias_or_previous_token'),
            (SOURCE.replace(HOST + ' {', HOST + '\n{'), 'origin_opening_brace_newline'),
            (SOURCE.replace('{\n    encode', '{ encode', 1), 'site_body_on_opening_line'),
            (SOURCE.replace('    encode zstd gzip', '    rewrite * /PRIVATE_PATH_SENTINEL'), 'unsupported_site_directive'),
            (SOURCE.replace('reverse_proxy ' + OLD, 'reverse_proxy ' + OLD + ' extra:8081'), 'proxy_arguments_mismatch'),
            (SOURCE.replace('reverse_proxy ' + OLD, 'reverse_proxy ' + OLD + ' {\n        header_up X-Token PRIVATE_TOKEN_SENTINEL\n    }'), 'proxy_has_options_block'),
            (SOURCE.replace('reverse_proxy ' + OLD, 'header X-Upstream ' + OLD), 'proxy_directive_count'),
            (SOURCE.replace('reverse_proxy ' + OLD, 'reverse_proxy ' + OLD + ' # PRIVATE_TOKEN_SENTINEL'), 'proxy_trailing_content_or_missing_newline'),
        ]
        for source, reason in cases:
            with self.subTest(reason=reason):
                self.write(self.routes, source)
                self.assert_blocked(self.diagnose(), 'route_structure', reason)

    def test_upstream_arguments_are_validated_and_never_echoed(self):
        for overrides, reason in [
            ({'old_upstream': 'PRIVATE_TOKEN_SENTINEL'}, 'old_upstream_format'),
            ({'candidate_upstream': 'PRIVATE_TOKEN_SENTINEL'}, 'candidate_upstream_format'),
            ({'old_upstream': NEW}, 'same_old_and_candidate_upstream'),
        ]:
            with self.subTest(reason=reason):
                self.assert_blocked(self.diagnose(**overrides), 'route_structure', reason)

    def test_actual_validation_order_preserves_the_first_failure(self):
        self.write(self.main, MAIN + '{$PRIVATE_TOKEN_SENTINEL}\n')
        self.write(self.routes, SOURCE + '{$PRIVATE_TOKEN_SENTINEL}\n')
        self.assert_blocked(self.diagnose(), 'main_structure', 'main_environment_expansion')
        self.main.chmod(0o644)
        self.assert_blocked(self.diagnose(), 'main_input', 'input_mode_not_0600')
        self.routes.chmod(0o644)
        self.assert_blocked(self.diagnose(), 'routes_input', 'input_mode_not_0600')

    def test_symlink_inputs_are_rejected_without_target_leakage(self):
        for field, target, stage in [('input', self.routes, 'routes_input'),
                                     ('main_config', self.main, 'main_input')]:
            with self.subTest(field=field):
                link = self.root / ('PRIVATE_PATH_SENTINEL.' + field + '.link')
                link.symlink_to(target)
                self.assert_blocked(self.diagnose(**{field: link}), stage, 'input_read_failed')

    def test_fifo_inputs_are_rejected_without_waiting_for_a_writer(self):
        fifo = self.root / 'PRIVATE_PATH_SENTINEL.fifo'
        os.mkfifo(fifo, 0o600)
        result = self.cli(['--input', str(fifo), '--main-config', str(self.main),
                           '--old-upstream', OLD, '--candidate-upstream', NEW])
        self.assert_blocked(result, 'routes_input', 'input_not_regular_file')
        self.assert_blocked(self.diagnose(main_config=fifo), 'main_input', 'input_not_regular_file')

    def test_directory_input_is_rejected(self):
        self.assert_blocked(self.diagnose(input=self.root), 'routes_input', 'input_not_regular_file')

    def test_private_mode_is_required_for_both_inputs(self):
        for path, field, stage in [(self.routes, 'input', 'routes_input'),
                                   (self.main, 'main_config', 'main_input')]:
            for mode in (0o400, 0o640, 0o644, 0o660, 0o700):
                with self.subTest(field=field, mode=oct(mode)):
                    path.chmod(mode)
                    self.assert_blocked(self.diagnose(), stage, 'input_mode_not_0600')
            path.chmod(0o600)

    def test_hardlinked_inputs_are_rejected(self):
        for path, stage in [(self.routes, 'routes_input'), (self.main, 'main_input')]:
            with self.subTest(stage=stage):
                link = self.root / ('PRIVATE_PATH_SENTINEL.' + stage + '.hardlink')
                os.link(path, link)
                self.assert_blocked(self.diagnose(), stage, 'input_has_multiple_links')
                link.unlink()

    def test_input_owner_mismatch_is_rejected(self):
        with patch.object(os, 'getuid', return_value=os.getuid() + 1):
            self.assert_blocked(self.diagnose(), 'routes_input', 'input_owner_mismatch')

    def test_empty_oversized_and_invalid_utf8_inputs_are_rejected(self):
        for value, reason in [(b'', 'private_file_size'),
                              (b'#' * (1024 * 1024 + 1), 'private_file_size'),
                              (b'PRIVATE_TOKEN_SENTINEL\xff', 'input_utf8_invalid')]:
            for path, stage in [(self.routes, 'routes_input'), (self.main, 'main_input')]:
                with self.subTest(stage=stage, reason=reason):
                    self.write(path, value)
                    self.assert_blocked(self.diagnose(), stage, reason)
                    self.write(path, SOURCE if path == self.routes else MAIN)

    def test_missing_files_and_invalid_path_types_are_sanitized(self):
        missing = self.root / 'PRIVATE_PATH_SENTINEL.missing'
        self.assert_blocked(self.diagnose(input=missing), 'routes_input', 'input_read_failed')
        self.assert_blocked(self.diagnose(main_config=missing), 'main_input', 'input_read_failed')
        self.assert_blocked(self.diagnose(input=None), 'routes_input', 'unexpected_validation_exception')

    def test_cli_missing_unknown_help_and_private_argv_are_sanitized(self):
        for args in [[], ['PRIVATE_TOKEN_SENTINEL'], ['--help'],
                     ['--input', '/PRIVATE_PATH_SENTINEL'],
                     ['--nonce-file', '/PRIVATE_TOKEN_SENTINEL'],
                     ['--input', str(self.routes), '--main-config', str(self.main),
                      '--old-upstream', OLD, '--candidate-upstream', NEW,
                      '--maintenance-output', '/PRIVATE_PATH_SENTINEL']]:
            with self.subTest(argument_count=len(args)):
                self.assert_blocked(self.cli(args), 'arguments', 'invalid_arguments')

    def test_unexpected_exception_messages_never_escape(self):
        helper = diagnostic.frozen_helper()
        for error in [RuntimeError(' '.join(SENTINELS)),
                      OSError(' '.join(SENTINELS)),
                      UnicodeError(' '.join(SENTINELS))]:
            with self.subTest(error=type(error).__name__):
                with patch.object(helper, 'read_private', side_effect=error), \
                     patch.object(diagnostic, 'frozen_helper', return_value=helper):
                    result = self.diagnose()
                self.assertEqual(result['result'], 'blocked')
                self.assertEqual(result['stage'], 'routes_input')

    def test_exact_frozen_source_covers_every_classified_require_call(self):
        body = diagnostic.HELPER.read_bytes()
        self.assertEqual(hashlib.sha256(body).hexdigest(), diagnostic.FROZEN_SHA256)
        expected = set()
        for function in ast.parse(body).body:
            if isinstance(function, ast.FunctionDef) and function.name in (
                    'tokens', 'validate_main_config', 'render_routes', 'read_private'):
                for node in ast.walk(function):
                    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'require':
                        expected.add((function.name, node.lineno))
        self.assertEqual(set(diagnostic.INVARIANTS), expected)

    def test_source_pin_mismatch_fails_before_helper_execution(self):
        marker = self.root / 'PRIVATE_PATH_SENTINEL.execution-marker'
        untrusted = self.root / 'PRIVATE_TOKEN_SENTINEL.untrusted.py'
        self.write(untrusted, 'from pathlib import Path\nPath(' + repr(str(marker)) + ').write_text("PRIVATE_CONFIG_SENTINEL")\nprint("PRIVATE_TOKEN_SENTINEL")\n')
        with patch.object(diagnostic, 'HELPER', untrusted):
            self.assert_blocked(self.diagnose(), 'validator_source', 'validator_source_mismatch')
        self.assertFalse(marker.exists())

    def test_only_synthetic_nonce_is_used_and_rendered_configuration_is_discarded(self):
        helper = diagnostic.frozen_helper()
        render = Mock(wraps=helper.render_routes)
        with patch.object(helper, 'render_routes', render), \
             patch.object(helper, 'write_private') as write_private, \
             patch.object(helper, 'read_nonce') as read_nonce, \
             patch.object(helper, 'probe_gate') as probe_gate, \
             patch.object(helper, 'curl_status') as curl_status, \
             patch.object(diagnostic, 'frozen_helper', return_value=helper):
            self.assertEqual(self.diagnose()['result'], 'pass')
        render.assert_called_once_with(SOURCE, OLD, NEW, '0' * 64)
        for forbidden in (write_private, read_nonce, probe_gate, curl_status):
            forbidden.assert_not_called()

    def test_diagnostic_performs_no_mutation_subprocess_or_network_operation(self):
        real_os_open, real_io_open = os.open, io.open
        observed_flags = []

        def read_only_os_open(path, flags, *args, **kwargs):
            observed_flags.append(flags)
            self.assertEqual(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND), 0)
            return real_os_open(path, flags, *args, **kwargs)

        def read_only_io_open(file, mode='r', *args, **kwargs):
            self.assertFalse(any(character in mode for character in 'wax+'))
            return real_io_open(file, mode, *args, **kwargs)

        forbidden = []
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(os, 'open', read_only_os_open))
            stack.enter_context(patch.object(io, 'open', read_only_io_open))
            for owner, names in [
                (os, ('system', 'popen', 'fork', 'unlink', 'remove', 'rename', 'replace', 'mkdir', 'makedirs',
                      'rmdir', 'chmod', 'fchmod', 'chown', 'fchown', 'link', 'symlink', 'truncate', 'ftruncate', 'write')),
                (subprocess, ('run', 'Popen', 'call', 'check_call', 'check_output')),
                (socket, ('socket', 'create_connection')),
                (urllib.request, ('urlopen',)),
            ]:
                for name in names:
                    spy = stack.enter_context(patch.object(owner, name, side_effect=AssertionError('Forbidden operation')))
                    forbidden.append(spy)
            self.assertEqual(self.diagnose()['result'], 'pass')
        self.assertEqual(len(observed_flags), 2)
        for spy in forbidden:
            spy.assert_not_called()

    def test_cli_creates_no_cache_output_or_other_artifact(self):
        package = self.root / 'private-package'
        package.mkdir()
        for path in (SCRIPT, diagnostic.HELPER):
            shutil.copyfile(path, package / path.name)

        def snapshot():
            result = {}
            for path in self.root.rglob('*'):
                info = path.lstat()
                result[str(path.relative_to(self.root))] = (
                    stat.S_IMODE(info.st_mode), info.st_size, info.st_mtime_ns,
                    hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None)
            return result

        before = snapshot()
        self.assertEqual(self.cli(script=package / SCRIPT.name)['result'], 'pass')
        self.assertEqual(snapshot(), before)
        self.assertFalse(list(package.rglob('__pycache__')))


if __name__ == '__main__':
    unittest.main()
