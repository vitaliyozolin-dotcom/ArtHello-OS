#!/usr/bin/env python3
"""Diagnose the frozen R9 route validator without rendering files or touching services."""
import argparse
import hashlib
import json
import pathlib
import stat
import types

FROZEN_SHA256 = '3dc40bd012925c5f52d33b0dfb1ba3187108d007329337b8757e4b337b41ede7'
HELPER = pathlib.Path(__file__).with_name('d080-maintenance-route.py')
# Line identities are meaningful only after the exact frozen-source digest passes.
INVARIANTS = {
    ('tokens', 33): 'lexical_input_format',
    ('tokens', 49): 'quoted_token_multiline',
    ('tokens', 53): 'quoted_token_unterminated',
    ('tokens', 60): 'bare_token_escape_or_heredoc',
    ('validate_main_config', 68): 'main_forbidden_token',
    ('validate_main_config', 70): 'main_import_count',
    ('validate_main_config', 72): 'main_import_target_or_quoting',
    ('validate_main_config', 73): 'main_import_target_newline',
    ('validate_main_config', 74): 'main_import_extra_arguments',
    ('render_routes', 78): 'old_upstream_format',
    ('render_routes', 79): 'candidate_upstream_format',
    ('render_routes', 80): 'same_old_and_candidate_upstream',
    ('render_routes', 81): 'synthetic_nonce_format',
    ('render_routes', 84): 'routes_forbidden_token',
    ('render_routes', 85): 'route_origin_token_count',
    ('render_routes', 86): 'route_origin_substring_count',
    ('render_routes', 87): 'route_upstream_count_or_candidate_present',
    ('render_routes', 94): 'unmatched_closing_brace',
    ('render_routes', 96): 'unmatched_opening_brace',
    ('render_routes', 98): 'origin_scope_or_opening_brace',
    ('render_routes', 99): 'origin_alias_or_previous_token',
    ('render_routes', 102): 'origin_opening_brace_newline',
    ('render_routes', 103): 'site_body_on_opening_line',
    ('render_routes', 108): 'directive_scope_or_brace',
    ('render_routes', 114): 'proxy_block_or_arguments',
    ('render_routes', 117): 'unsupported_site_directive',
    ('render_routes', 121): 'directive_line_boundary',
    ('render_routes', 123): 'proxy_directive_count',
    ('render_routes', 128): 'proxy_indentation',
    ('render_routes', 130): 'proxy_trailing_content_or_missing_newline',
    ('read_private', 170): 'private_file_metadata',
    ('read_private', 171): 'private_file_size',
    ('read_private', 175): 'private_file_decoded_size',
}


def frozen_helper():
    body = HELPER.read_bytes()
    if len(body) > 1024 * 1024 or hashlib.sha256(body).hexdigest() != FROZEN_SHA256:
        raise ValueError('Untrusted validator source')
    module = types.ModuleType('d082_frozen_route_validator')
    module.__file__ = str(HELPER)
    exec(compile(body, str(HELPER), 'exec'), module.__dict__)
    return module


def specific_reason(identity, local, default):
    # Select from fixed literals only; configuration values never enter output.
    if identity in (('validate_main_config', 68), ('render_routes', 84)):
        values = local.get('values', [])
        prefix = 'main' if identity[0] == 'validate_main_config' else 'routes'
        if any('log_credentials' in value for value in values):
            return prefix + '_credentials_logging'
        if any('{$' in value for value in values):
            return prefix + '_environment_expansion'
        if prefix == 'main':
            return 'main_contains_arthello_origin'
        return 'routes_import_directive'
    if identity == ('read_private', 170):
        info = local['info']
        if not stat.S_ISREG(info.st_mode):
            return 'input_not_regular_file'
        if stat.S_IMODE(info.st_mode) != 0o600:
            return 'input_mode_not_0600'
        if info.st_nlink != 1:
            return 'input_has_multiple_links'
        return 'input_owner_mismatch'
    if identity == ('render_routes', 87):
        return 'old_upstream_token_count' if local['values'].count(local['old_upstream']) != 1 else 'candidate_upstream_already_present'
    if identity == ('render_routes', 114):
        return 'proxy_has_options_block' if local['block'] else 'proxy_arguments_mismatch'
    return default


def classify(error):
    frame = error.__traceback__
    selected = None
    while frame is not None:
        identity = (frame.tb_frame.f_code.co_name, frame.tb_lineno)
        if frame.tb_frame.f_code.co_filename == str(HELPER) and identity in INVARIANTS:
            selected = specific_reason(identity, frame.tb_frame.f_locals, INVARIANTS[identity])
        frame = frame.tb_next
    if selected is not None:
        return selected
    if isinstance(error, UnicodeError):
        return 'input_utf8_invalid'
    if isinstance(error, OSError):
        return 'input_read_failed'
    return 'unexpected_validation_exception'


def record(result, stage, reason):
    return dict(kind='d082-route-diagnostic', result=result, stage=stage, reason=reason)


def diagnose(*, input, main_config, old_upstream, candidate_upstream):
    stage = 'validator_source'
    try:
        helper = frozen_helper()
        stage = 'routes_input'
        routes = helper.read_private(input, helper.MAX_CONFIG)
        stage = 'main_input'
        main = helper.read_private(main_config, helper.MAX_CONFIG)
        stage = 'main_structure'
        helper.validate_main_config(main)
        stage = 'route_structure'
        helper.render_routes(routes, old_upstream, candidate_upstream, '0' * 64)
        return record('pass', 'complete', 'supported_structure')
    except Exception as error:
        return record('blocked', stage, 'validator_source_mismatch' if stage == 'validator_source' else classify(error))


class QuietParser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError('Invalid diagnostic arguments')


def main():
    try:
        parser = QuietParser(add_help=False)
        for name in ('input', 'main-config', 'old-upstream', 'candidate-upstream'):
            parser.add_argument('--' + name, required=True)
        args = parser.parse_args()
        result = diagnose(**vars(args))
    except Exception:
        result = record('blocked', 'arguments', 'invalid_arguments')
    print(json.dumps(result, separators=(',', ':')))
    return 0 if result['result'] == 'pass' else 2


if __name__ == '__main__':
    raise SystemExit(main())
