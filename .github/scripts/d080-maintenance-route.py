#!/usr/bin/env python3
"""D080: render one bounded private route; observe only fixed public statuses.

The caller owns Caddy validation/reload and durable recovery. This helper never
applies a route, deletes a recovery file, or prints private configuration.
"""
import argparse
import json
import os
import pathlib
import re
import stat
import subprocess

ORIGIN = 'https://arthello-188-225-38-55.sslip.io'
HOST = 'arthello-188-225-38-55.sslip.io'
HEADER = 'Authorization'
AUTH_PREFIX = 'ArtHelloCandidate '
MAX_CONFIG = 1024 * 1024


class GateError(Exception):
    pass


def require(condition):
    if not condition:
        raise GateError()


def tokens(source):
    """Small structural lexer; refuse unknown quoting rather than guess scope."""
    require(isinstance(source, str) and 0 < len(source.encode()) <= MAX_CONFIG and '\x00' not in source and '\r' not in source)
    result, i, line = [], 0, 1
    while i < len(source):
        if source[i].isspace():
            line += source[i] == '\n'
            i += 1
            continue
        if source[i] == '#':
            end = source.find('\n', i)
            i = len(source) if end < 0 else end
            continue
        start, number = i, line
        if source[i] in ('"', '`'):
            quote = source[i]
            i += 1
            while i < len(source) and source[i] != quote:
                require(source[i] != '\n')
                if source[i] == '\\' and quote == '"':
                    i += 1
                i += 1
            require(i < len(source))
            i += 1
            value = source[start:i]
        else:
            while i < len(source) and not source[i].isspace() and source[i] != '#':
                i += 1
            value = source[start:i]
            require('<<' not in value and '\\' not in value)
        result.append((value, start, i, number))
    return result


def validate_main_config(source):
    parsed = tokens(source)
    values = [value for value, *_ in parsed]
    require(not any('log_credentials' in value or '{$' in value or HOST in value for value in values))
    imports = [i for i, value in enumerate(values) if value.strip('"`') == 'import']
    require(len(imports) == 1)
    i = imports[0]
    require(values[i] == 'import' and i + 1 < len(parsed) and values[i + 1] == '/data/external-routes.caddy')
    require(parsed[i][3] == parsed[i + 1][3])
    require(i + 2 == len(parsed) or parsed[i + 2][3] != parsed[i][3])


def render_routes(source, old_upstream, candidate_upstream, nonce):
    require(re.fullmatch(r'arthello-direct-[A-Za-z0-9._-]+:8081', old_upstream or '') is not None)
    require(re.fullmatch(r'arthello-direct-[1-9][0-9]*-[1-9][0-9]*:8081', candidate_upstream or '') is not None)
    require(old_upstream != candidate_upstream)
    require(re.fullmatch(r'[a-f0-9]{64}', nonce or '') is not None)
    parsed = tokens(source)
    values = [item[0] for item in parsed]
    require(not any(value.strip('"`') == 'import' or 'log_credentials' in value or '{$' in value for value in values))
    require(sum(value in (HOST, 'https://' + HOST) for value in values) == 1)
    require(sum(HOST in value for value in values) == 1)
    require(values.count(old_upstream) == 1 and candidate_upstream not in values)
    depths, stack, pairs = [], [], {}
    for index, value in enumerate(values):
        depths.append(len(stack))
        if value == '{':
            stack.append(index)
        elif value == '}':
            require(bool(stack))
            pairs[stack.pop()] = index
    require(not stack)
    host_index = next(i for i, value in enumerate(values) if value in (HOST, 'https://' + HOST))
    require(depths[host_index] == 0 and host_index + 1 < len(values) and values[host_index + 1] == '{')
    require(host_index == 0 or values[host_index - 1] == '}')
    opening = host_index + 1
    closing = pairs[opening]
    require(parsed[host_index][3] == parsed[opening][3])
    require(opening + 1 == closing or parsed[opening + 1][3] > parsed[opening][3])
    allowed = {'encode', 'header', 'tls', 'log', 'bind'}
    proxy = []
    i = opening + 1
    while i < closing:
        require(depths[i] == 1 and values[i] not in ('{', '}'))
        first, end = i, i + 1
        while end < closing and parsed[end][3] == parsed[first][3] and values[end] not in ('{', '}'):
            end += 1
        block = end < closing and values[end] == '{' and parsed[end][3] == parsed[first][3]
        if values[first] == 'reverse_proxy':
            require(not block and values[first:end] == ['reverse_proxy', old_upstream])
            proxy.append(first)
        else:
            require(values[first] in allowed)
        if block:
            i = pairs[end] + 1
        else:
            require(end == closing or parsed[end][3] > parsed[first][3])
            i = end
    require(len(proxy) == 1)
    proxy_index = proxy[0]
    start, end = parsed[proxy_index][1], parsed[proxy_index + 1][2]
    line_start = source.rfind('\n', 0, start) + 1
    indent = source[line_start:start]
    require(not indent.strip())
    line_end = source.find('\n', end)
    require(line_end >= 0 and not source[end:line_end].strip())
    normal = source[:start] + 'reverse_proxy ' + candidate_upstream + source[end:]
    # Caddy's header placeholder joins duplicate values with commas; equality
    # with a single nonce therefore rejects both duplicate and comma-list forms.
    # orig_uri preserves case, query and escaped path, unlike normalized path().
    authorization = '{http.request.header.Authorization}'
    original_uri = '{http.request.orig_uri}'
    method = '{http.request.method}'
    candidate_rule = f"{authorization} == '{AUTH_PREFIX}{nonce}' && ({method} == 'GET' || {method} == 'HEAD' || ({method} == 'POST' && {original_uri} == '/api/auth/login'))"
    exchange_rule = f"{method} == 'POST' && {original_uri} == '/api/school-sso/exchange'"
    lines = [
        'route {',
        f'    @arthello_candidate expression `{candidate_rule}`',
        '    @arthello_exchange {',
        '        header !Authorization',
        f'        expression `{exchange_rule}`',
        '    }',
        '    handle @arthello_candidate {',
        '        request_header -Authorization',
        f'        reverse_proxy {candidate_upstream}',
        '    }',
        '    handle @arthello_exchange {',
        '        request_header -Authorization',
        f'        reverse_proxy {candidate_upstream}',
        '    }',
        '    handle {',
        '        request_header -Authorization',
        '        respond "Service temporarily unavailable" 503',
        '    }',
        '}',
    ]
    maintenance = source[:start] + ('\n' + indent).join(lines) + source[end:]
    return normal, maintenance


def read_private(path, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1 and info.st_uid == os.getuid())
        require(0 < info.st_size <= maximum)
        with os.fdopen(fd, 'r', encoding='utf-8') as stream:
            fd = None
            value = stream.read(maximum + 1)
            require(len(value.encode()) <= maximum)
            return value
    finally:
        if fd is not None:
            os.close(fd)


def read_nonce(path):
    try:
        value = read_private(path, 65)
        require(re.fullmatch(r'[a-f0-9]{64}\n?', value) is not None)
        return value.rstrip('\n')
    except (OSError, UnicodeError):
        raise GateError() from None


def write_private(path, value):
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
    except OSError:
        raise GateError() from None


def curl_status(method, path, headers):
    require(method in ('GET', 'HEAD', 'POST', 'PATCH', 'DELETE'))
    require(path.startswith('/') and not any(character in path for character in ('"', '\\', '\r', '\n')))
    require(all(re.fullmatch(r'[a-f0-9]{64}', value) for value in headers))
    config = ['silent', 'show-error', 'proto = "=https"', 'connect-timeout = 5', 'max-time = 10',
              'max-redirs = 0', 'output = "/dev/null"', 'write-out = "%{http_code}"',
              f'request = "{method}"', f'url = "{ORIGIN}{path}"']
    config += [f'header = "{HEADER}: {AUTH_PREFIX}{value}"' for value in headers]
    if method in ('POST', 'PATCH', 'DELETE'):
        config += ['header = "Content-Type: application/json"', 'data = "{}"']
    result = subprocess.run(['curl', '--disable', '--config', '-'], input='\n'.join(config) + '\n',
                            text=True, capture_output=True, timeout=12, env={'PATH': os.environ.get('PATH', '')})
    require(result.returncode == 0 and re.fullmatch(r'[1-5][0-9]{2}', result.stdout or '') is not None)
    return int(result.stdout)


def probe_gate(nonce, transport=curl_status):
    require(re.fullmatch(r'[a-f0-9]{64}', nonce or '') is not None)
    wrong = ('0' if nonce[0] != '0' else '1') + nonce[1:]
    paths = [('GET', '/'), ('GET', '/api/education'), ('GET', '/api/auth/login'),
             ('GET', '/api/school-sso/authorize'), ('POST', '/api/auth/login'), ('POST', '/api/finance-actions')]
    checks = [(method, path, values) for values in ([], [wrong]) for method, path in paths]
    checks += [('GET', '/', [nonce, nonce]), ('GET', '/', [nonce, wrong]),
               ('POST', '/api/finance-actions', [nonce]), ('PATCH', '/api/settings', [nonce]),
               ('GET', '/api/school-sso/exchange', []), ('POST', '/api/school-sso/exchange/', [])]
    for method, path, headers in checks:
        require(transport(method, path, headers) == 503)
    require(transport('GET', '/', [nonce]) == 200)
    return {'kind': 'candidate-maintenance-probe', 'result': 'pass', 'negativeChecks': len(checks), 'candidateRoot': 'reachable'}


class QuietParser(argparse.ArgumentParser):
    def error(self, message):
        raise GateError()


def main():
    try:
        parser = QuietParser(add_help=False)
        commands = parser.add_subparsers(dest='command', required=True, parser_class=QuietParser)
        render = commands.add_parser('render', add_help=False)
        for name in ('input', 'main-config', 'normal-output', 'maintenance-output', 'old-upstream', 'candidate-upstream', 'nonce-file'):
            render.add_argument('--' + name, required=True)
        probe = commands.add_parser('probe', add_help=False)
        probe.add_argument('--nonce-file', required=True)
        args = parser.parse_args()
        nonce = read_nonce(args.nonce_file)
        if args.command == 'render':
            source = read_private(args.input, MAX_CONFIG)
            validate_main_config(read_private(args.main_config, MAX_CONFIG))
            normal, private = render_routes(source, args.old_upstream, args.candidate_upstream, nonce)
            require(pathlib.Path(args.normal_output).absolute() != pathlib.Path(args.maintenance_output).absolute())
            require(not pathlib.Path(args.normal_output).exists() and not pathlib.Path(args.maintenance_output).exists())
            write_private(args.normal_output, normal)
            write_private(args.maintenance_output, private)
            result = {'kind': 'candidate-maintenance-route', 'result': 'rendered'}
        else:
            result = probe_gate(nonce)
        print(json.dumps(result, separators=(',', ':')))
        return 0
    except Exception:
        print('{"kind":"candidate-maintenance-route","result":"blocked"}')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
