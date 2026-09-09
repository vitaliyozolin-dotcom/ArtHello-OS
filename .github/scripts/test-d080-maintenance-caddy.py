#!/usr/bin/env python3
"""Exercise the D080 renderer through an actual Caddy process and HTTP requests.

Only synthetic credentials and localhost fixtures are used. Missing Caddy is a
failure, never a skipped acceptance test. Configs and subprocess diagnostics are
private; stdout contains one fixed-vocabulary result only.
"""
import copy
import http.client
import importlib.util
import json
import os
import pathlib
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HERE = pathlib.Path(__file__).resolve().parent
HOST = 'arthello-188-225-38-55.sslip.io'
SCHOOL = 'school-188-225-38-55.sslip.io'
OLD = 'arthello-direct-fixture-old:8081'
CANDIDATE = 'arthello-direct-123456789-1:8081'
SCHOOL_UPSTREAM = 'school-1-11:3111'
NONCE = '0123456789abcdef' * 4
AUTH = 'ArtHelloCandidate ' + NONCE
WRONG_AUTH = 'ArtHelloCandidate ' + 'f' * 64


class CheckFailed(Exception):
    pass


def require(condition):
    if not condition:
        raise CheckFailed()


def private_write(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        stream.write(value)


class Backend(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, name):
        self.name = name
        self.records = []
        self.lock = threading.Lock()
        super().__init__(('127.0.0.1', 0), BackendHandler)
        self.worker = threading.Thread(target=self.serve_forever, daemon=True)
        self.worker.start()

    def snapshot(self):
        with self.lock:
            return list(self.records)

    def close(self):
        self.shutdown()
        self.server_close()
        self.worker.join(timeout=3)
        require(not self.worker.is_alive())


class BackendHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def handle_fixture(self):
        length = int(self.headers.get('Content-Length', '0'))
        if length:
            self.rfile.read(length)
        with self.server.lock:
            self.server.records.append({
                'method': self.command,
                'path': self.path,
                'authorization': self.headers.get_all('Authorization') or [],
            })
        self.send_response(200)
        self.send_header('X-D080-Fixture', self.server.name)
        self.send_header('Content-Length', '2')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(b'OK')

    do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_TRACE = handle_fixture


def source_fixture(access_log):
    return f'''{HOST} {{
    encode gzip
    header X-D080-Preserved yes
    log {{
        output file {access_log}
        format json
    }}
    reverse_proxy {OLD}
}}

{SCHOOL} {{
    header X-D080-School-Preserved yes
    reverse_proxy {SCHOOL_UPSTREAM}
}}
'''


class CaddyFixture:
    def __init__(self, binary, root, rendered, backends, expected_candidate_proxies):
        self.process = None
        self.backends = backends
        self.checks = 0
        self.root = root
        root.mkdir(mode=0o700)
        config_file = root / 'Caddyfile'
        private_write(config_file, rendered)
        self.environment = {
            'PATH': os.environ.get('PATH', ''),
            'XDG_DATA_HOME': str(root / 'data'),
            'XDG_CONFIG_HOME': str(root / 'config'),
        }
        result = subprocess.run(
            [binary, 'adapt', '--config', str(config_file), '--adapter', 'caddyfile'],
            cwd=root, env=self.environment, capture_output=True, text=True, timeout=20,
        )
        require(result.returncode == 0)
        adapted = json.loads(result.stdout)
        # Keep the adapter's actual routing, CEL matchers, and middleware. Only
        # TLS/listening and the two exact synthetic upstream dials are localized.
        config = copy.deepcopy(adapted)
        servers = config['apps']['http']['servers']
        require(len(servers) == 1)
        server = next(iter(servers.values()))
        counts = {CANDIDATE: 0, SCHOOL_UPSTREAM: 0}

        def localize_upstreams(node):
            if isinstance(node, dict):
                if node.get('handler') == 'reverse_proxy':
                    require(len(node.get('upstreams', [])) == 1)
                    upstream = node['upstreams'][0]
                    dial = upstream['dial']
                    require(dial in counts)
                    counts[dial] += 1
                    backend = backends['candidate' if dial == CANDIDATE else 'school']
                    upstream['dial'] = '127.0.0.1:' + str(backend.server_port)
                for value in node.values():
                    localize_upstreams(value)
            elif isinstance(node, list):
                for item in node:
                    localize_upstreams(item)

        localize_upstreams(server['routes'])
        require(counts == {CANDIDATE: expected_candidate_proxies, SCHOOL_UPSTREAM: 1})
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            self.port = reservation.getsockname()[1]
        server['listen'] = ['127.0.0.1:' + str(self.port)]
        server['automatic_https'] = {'disable': True}
        server.pop('tls_connection_policies', None)
        config['apps'].pop('tls', None)
        config['admin'] = {'disabled': True}
        private_config = root / 'adapted.json'
        private_write(private_config, json.dumps(config))
        self.binary = binary
        self.private_config = private_config

    def start(self):
        self.process = subprocess.Popen(
            [self.binary, 'run', '--config', str(self.private_config)],
            cwd=self.root, env=self.environment,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            require(self.process.poll() is None)
            try:
                with socket.create_connection(('127.0.0.1', self.port), timeout=0.2):
                    return
            except OSError:
                time.sleep(0.05)
        raise CheckFailed()

    def stop(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=3)

    def check(self, method, path, headers=(), expected=503, host=HOST,
              backend=None, forwarded_authorization=()):
        before = {name: fixture.snapshot() for name, fixture in self.backends.items()}
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
        try:
            # http.client sends this origin-form path unchanged, including double
            # slashes, percent escapes, a trailing ?, and dot-segment variants.
            connection.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
            connection.putheader('Host', host)
            connection.putheader('Connection', 'close')
            for value in headers:
                connection.putheader('Authorization', value)
            body = b'{}' if method not in ('GET', 'HEAD') else b''
            if body:
                connection.putheader('Content-Type', 'application/json')
                connection.putheader('Content-Length', str(len(body)))
            connection.endheaders(body)
            response = connection.getresponse()
            response.read()
            require(response.status == expected)
            require(response.getheader('X-D080-Fixture') == backend)
            require(response.getheader('X-D080-Preserved' if host == HOST else 'X-D080-School-Preserved') == 'yes')
        finally:
            connection.close()
        for name, fixture in self.backends.items():
            after = fixture.snapshot()
            if name == backend:
                require(len(after) == len(before[name]) + 1)
                require(after[-1]['method'] == method)
                require(after[-1]['authorization'] == list(forwarded_authorization))
            else:
                require(after == before[name])
        self.checks += 1


def check_private_route(fixture):
    # Missing, wrong, duplicate (both orders), empty companion, and comma-list
    # credentials must never reach either backend, even on an otherwise allowed
    # read or the exact login POST.
    rejected_headers = [(), (WRONG_AUTH,), (AUTH, AUTH), (AUTH, WRONG_AUTH),
                        (WRONG_AUTH, AUTH), (AUTH, ''), ('', AUTH),
                        (AUTH + ', ' + AUTH,), (AUTH + ', ' + WRONG_AUTH,),
                        ('Bearer ' + NONCE,)]
    for headers in rejected_headers:
        for method, path in [('GET', '/'), ('HEAD', '/api/education'), ('POST', '/api/auth/login')]:
            fixture.check(method, path, headers)
    for method in ('GET', 'HEAD'):
        for path in ('/', '/api/education', '/api/auth/me', '/assets/fixture.js?revision=1'):
            fixture.check(method, path, (AUTH,), 200, backend='candidate')
    fixture.check('POST', '/api/auth/login', (AUTH,), 200, backend='candidate')
    for method in ('PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE'):
        for path in ('/api/auth/login', '/api/finance-actions', '/'):
            fixture.check(method, path, (AUTH,))
    login_variants = ['/api/auth/login/', '/api/auth/Login', '/API/auth/login',
                      '/api/auth/login?x=1', '/api/auth/login?', '/api/auth/%6cogin',
                      '/api/auth/login%2f', '/api//auth/login', '//api/auth/login',
                      '/api/auth/../auth/login', '/api/auth/%2e%2e/auth/login',
                      '/api/finance-actions', '/api/school-sso/exchange']
    for path in login_variants:
        fixture.check('POST', path, (AUTH,))
    # Exactly one unauthenticated public SSO exchange endpoint remains usable.
    exchange = '/api/school-sso/exchange'
    fixture.check('POST', exchange, (), 200, backend='candidate')
    for headers in ((AUTH,), (WRONG_AUTH,), (AUTH, AUTH), ('Bearer fixture',), ('',), ('', '')):
        fixture.check('POST', exchange, headers)
    for method in ('GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE'):
        fixture.check(method, exchange)
    exchange_variants = [exchange + '/', '/API/school-sso/exchange',
                         '/api/School-sso/exchange', '/api/school-sso/Exchange',
                         exchange + '?x=1', exchange + '?', '/api/school-sso/%65xchange',
                         exchange + '%2f', '/api//school-sso/exchange',
                         '//api/school-sso/exchange', '/api/school-sso/../school-sso/exchange',
                         '/api/school-sso/%2e%2e/school-sso/exchange']
    for path in exchange_variants:
        fixture.check('POST', path)
    for method, path in [('GET', '/'), ('HEAD', '/'), ('POST', exchange), ('PATCH', '/fixture')]:
        for headers in ((), (AUTH,), (WRONG_AUTH,)):
            fixture.check(method, path, headers, 200, SCHOOL, 'school', headers)


def check_normal_route(fixture):
    for method, path in [('GET', '/'), ('HEAD', '/api/education'),
                         ('POST', '/api/auth/login'), ('POST', '/api/finance-actions'),
                         ('PATCH', '/api/settings'), ('DELETE', '/api/fixture')]:
        for headers in ((), (WRONG_AUTH,)):
            fixture.check(method, path, headers, 200, backend='candidate', forwarded_authorization=headers)
    fixture.check('POST', '/api/school-sso/exchange', (), 200, SCHOOL, 'school')


def check_access_log(path):
    require(path.is_file() and 0 < path.stat().st_size <= 4 * 1024 * 1024)
    contents = path.read_text(encoding='utf-8')
    require(NONCE not in contents and 'f' * 64 not in contents)
    records = [json.loads(line) for line in contents.splitlines() if line.strip()]
    require(bool(records))
    require(any(record.get('status') == 503 for record in records))
    require(any(record.get('status') == 200 for record in records))
    require(any(record.get('status') == 200 and
                record.get('request', {}).get('uri') == '/assets/fixture.js?revision=1'
                for record in records))


def main():
    stage = 'caddy_unavailable'
    backends = {}
    fixture = None
    total = 0
    passed = False
    failed_check = None
    try:
        binary = shutil.which('caddy')
        require(binary is not None)
        signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(CheckFailed()))
        signal.alarm(90)
        stage = 'renderer_import_failed'
        spec = importlib.util.spec_from_file_location('d080_renderer', HERE / 'd080-maintenance-route.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix='d080-caddy-fixture-') as directory:
            root = pathlib.Path(directory)
            stage = 'fixture_setup_failed'
            backends['candidate'] = Backend('candidate')
            backends['school'] = Backend('school')
            access_log = root / 'access.json'
            normal, private = module.render_routes(source_fixture(access_log), OLD, CANDIDATE, NONCE)
            for name, rendered, proxies, checks in (
                ('maintenance', private, 2, check_private_route),
                ('normal', normal, 1, check_normal_route),
            ):
                stage = name + '_adapt_failed'
                fixture = CaddyFixture(binary, root / name, rendered, backends, proxies)
                try:
                    stage = name + '_startup_failed'
                    fixture.start()
                    stage = name + '_http_behavior_failed'
                    try:
                        checks(fixture)
                    except Exception:
                        failed_check = fixture.checks + 1
                        raise
                    total += fixture.checks
                finally:
                    fixture.stop()
                    fixture = None
            stage = 'access_log_redaction_failed'
            check_access_log(access_log)
        passed = True
    except Exception:
        pass
    finally:
        signal.alarm(0)
        cleanup_failed = False
        try:
            if fixture is not None:
                fixture.stop()
        except Exception:
            cleanup_failed = True
        for backend in backends.values():
            try:
                backend.close()
            except Exception:
                cleanup_failed = True
        if cleanup_failed:
            passed, stage = False, 'fixture_cleanup_failed'
    if passed:
        result = {'kind': 'candidate-maintenance-caddy-test', 'result': 'pass',
                  'httpChecks': total, 'accessLogRedaction': 'pass'}
    else:
        result = {'kind': 'candidate-maintenance-caddy-test', 'result': 'failed', 'reason': stage}
        if failed_check is not None:
            result['failedHttpCheck'] = failed_check
    print(json.dumps(result, separators=(',', ':')))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
