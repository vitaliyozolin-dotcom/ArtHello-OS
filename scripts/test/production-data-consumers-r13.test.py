"""R13 public consumer proof with real durable validators and bounded FakeDocker."""
import copy
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


consumers = load('r13_production_consumers_test', ROOT / 'scripts/production-data-consumers-r13.py')
donor = load('r13_public_consumer_fixtures', ROOT / '.github/scripts/test-r13-continuation-adapters.py')
launcher_donor = load('r13_readonly_launcher_fixtures', ROOT / 'scripts/test/run-production-readonly.test.py')
private, json_bytes = donor.private, donor.json_bytes
REFUSED = (ValueError, OSError, consumers.adoption.r7.Refused,
           consumers.controller.r7.Refused, consumers.gateway.GateError,
           donor.adoption.r7.Refused, donor.backup_tests.r7.Refused)


class MetadataDocker:
    """Only metadata, exact accepted-worker health, and two fixed gateway reads."""
    def __init__(self, fixture, main):
        self.fixture, self.main = fixture, main
        self.calls, self.gateway_id = [], None
        self.after_gateway_read = None

    def bind_gateway(self, identity):
        assert identity == self.fixture.gateway_evidence['gatewayId']
        self.gateway_id = identity
        self.calls.append(('bind_gateway', identity))

    def inspect(self, kind, name, missing=False):
        assert kind in ('container', 'image', 'volume')
        self.calls.append(('inspect', kind, name, missing))
        return self.fixture.inspect(kind, name, missing)

    def command(self, arguments, timeout=30):
        self.calls.append(('command', list(arguments)))
        if arguments[:6] == ['container', 'ls', '--all', '--quiet', '--no-trunc', '--filter']:
            assert len(arguments) == 7
            return self.fixture.command(arguments, timeout)
        if arguments == ['ps', '--no-trunc', '--filter', 'volume=' + self.fixture.context['dataVolume'], '--format', '{{.ID}}']:
            objects = self.fixture.backup.docker.objects
            return '\n'.join(sorted({item['Id'] for (kind, _), item in objects.items()
                if kind == 'container' and item.get('State', {}).get('Running') is True
                and any(m.get('Name') == self.fixture.context['dataVolume'] for m in item.get('Mounts', []))}))
        raise AssertionError('Unexpected Docker command: ' + repr(arguments))

    def run(self, arguments, timeout=30):
        self.calls.append(('run', list(arguments)))
        assert arguments == ['container', 'exec', consumers.adoption.ACCEPTED_WORKER_ID,
                             'python3', '-I', '/opt/arthello-backup/probe.py', '--require-initial-verified']
        return self.fixture.run(arguments, timeout)

    def read_gateway_config(self, identity, filename):
        assert identity == self.gateway_id == self.fixture.gateway_evidence['gatewayId']
        assert filename in ('/etc/caddy/Caddyfile', '/data/external-routes.caddy')
        self.calls.append(('gateway_read', identity, filename))
        result = self.main if filename == '/etc/caddy/Caddyfile' else self.fixture.route
        if self.after_gateway_read is not None:
            callback, self.after_gateway_read = self.after_gateway_read, None
            callback()
        return result


class PublicConsumerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='r13-public-consumers-', dir=Path.home())
        self.addCleanup(self.temp.cleanup)
        self.f = donor.HeldR13(Path(self.temp.name).resolve())
        c = self.f.context
        # Supplement the held fixture with real published-image and gateway defaults.
        self.f.images[c['imageId']]['Config']['Cmd'] = ['node', 'production/runtime-server.mjs']
        self.f.candidate['Config']['Labels'].update({
            'arthello.release.tree': c['sourceTree'], 'arthello.release.run': c['runId'],
        })
        self.f.candidate['State'].update(Restarting=False, Dead=False)
        c['runtimeFingerprint'] = hashlib.sha256(json_bytes([self.f.images[c['imageId']]])).hexdigest()
        self.main = '{$APP_DOMAIN} {\n    respond 200\n}\nimport /data/external-routes.caddy\n'
        private(self.f.work / 'Caddyfile.before', self.main)
        self.f.gateway_evidence['mainConfigSha256'] = hashlib.sha256(self.main.encode()).hexdigest()
        private(Path(c['gatewayEvidenceFile']), json_bytes(self.f.gateway_evidence))
        c['gatewayEvidenceSha256'] = donor.state.digest(self.f.gateway_evidence)
        self.f.caddy['State'].update(Restarting=False, Dead=False)
        self.f.caddy['Config'] = {'Env': ['APP_DOMAIN=stroios.example.invalid', 'UNRELATED_SECRET=PRIVATE_SENTINEL']}
        self.f.backup.docker.objects['container', 'stroios-caddy-1'] = self.f.caddy
        self.f.state_path.unlink()
        self.f.record = donor.state.begin(self.f.state_path, c)
        receipt = self.f.receipt('3')
        donor.state.advance(self.f.state_path, receipt, '3')
        receipt_path = Path(private(self.f.work / 'actual-acceptance.json', json_bytes(receipt)))
        self.audit = donor.public.prepare(self.f.state_path, receipt_path, '3')
        self.marker = self.f.state_dir / ('activation-' + self.f.release + '.json')
        donor.activation.begin(self.marker, self.f.release, c['runId'], '3', c['candidateContainerId'],
                               c['previousContainerId'], c['rollbackVolume'], c['originalRouteSha256'],
                               c['publicRouteSha256'], str(self.audit))
        donor.state.advance(self.f.state_path, receipt, '3', public=True)
        self.f.route = Path(c['publicRouteFile']).read_text()
        self.record = donor.state.load_state(self.f.state_path)
        self.pins = dict(runId=c['runId'], resourceAttempt=c['runAttempt'], acceptedAttempt='3',
                         imageId=c['imageId'], runtimeFingerprint=c['runtimeFingerprint'],
                         candidateContainerId=c['candidateContainerId'], contextSha256=self.record['contextSha256'])
        self.docker = MetadataDocker(self.f, self.main)
        self.f.calls.clear()
        self.f.backup.docker.commands.clear()
        for target in (patch.object(Path, 'home', return_value=self.f.root),
                       patch.object(consumers, 'EXPECTED_SOURCE', self.f.release),
                       patch.object(consumers, 'EXPECTED_TREE', self.f.tree),
                       patch.object(consumers, 'ACCEPTED_PINS', self.pins),
                       patch.object(consumers.boundary, 'command', self.f.process),
                       patch.object(consumers.boundary, 'verify', side_effect=AssertionError('No held-candidate resume')),
                       patch.object(consumers.boundary, 'repair_maintenance', side_effect=AssertionError('No route repair')),
                       patch('subprocess.run', side_effect=AssertionError('No external subprocess')),
                       patch('subprocess.Popen', side_effect=AssertionError('No external process')),
                       patch('socket.create_connection', side_effect=AssertionError('No network')),
                       patch('urllib.request.urlopen', side_effect=AssertionError('No GitHub request'))):
            target.start()
            self.addCleanup(target.stop)

    def observe(self, **overrides):
        arguments = dict(expected_release=self.f.release, state_dir=self.f.state_dir, docker=self.docker)
        arguments.update(overrides)
        return consumers.observe(**arguments)

    def write_record(self, value):
        private(self.f.state_path, json_bytes(value))

    def historical(self):
        fixture = SimpleNamespace(root=self.f.state_dir, accepted=self.f.accepted_path, f=self.f.backup,
                                  app=lambda old=False: copy.deepcopy(self.f.previous), addCleanup=self.addCleanup)
        previous = donor.controller_tests.ControllerTests.predecessor(fixture)
        bound = patch.object(consumers.controller, 'ACCEPTED_CONTEXT_SHA256', fixture.historical['contextSha256'])
        bound.start()
        self.addCleanup(bound.stop)
        return previous, fixture

    def test_exact_public_app_and_adopted_r12_worker_have_readonly_proof(self):
        paths = [self.f.state_path, self.marker, self.f.own_path, self.f.accepted_path]
        before = [p.read_bytes() for p in paths], copy.deepcopy(self.f.backup.docker.objects)
        result = self.observe()
        expected = dict(liveId=self.f.candidate['Id'], imageId=self.f.candidate['Image'],
                        sourceSha=self.f.release, backupId=consumers.adoption.ACCEPTED_WORKER_ID)
        self.assertEqual({k: result[k] for k in expected}, expected)
        self.assertEqual(set(result), {*expected, 'proofSha256'})
        self.assertRegex(result['proofSha256'], r'^[a-f0-9]{64}$')
        self.assertEqual(result, self.observe())
        self.assertEqual(before, ([p.read_bytes() for p in paths], self.f.backup.docker.objects))
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        self.assertNotEqual(result['sourceSha'], consumers.adoption.ACCEPTED_SHA)
        self.assertEqual(self.record['latestAttempt'], '3')
        self.assertEqual(self.record['context']['runAttempt'], '1')
        self.assertFalse(any(call[0] == 'current-main' for call in self.f.calls))

    def test_published_activation_does_not_require_empty_bank_volume(self):
        self.f.bank_empty = False
        self.f.writer = '9' * 64
        self.assertEqual(self.observe()['liveId'], self.f.candidate['Id'])
        self.assertFalse(any(call[0] == 'run' and consumers.boundary.BANK_EMPTY in call[1] for call in self.docker.calls))

    def test_exact_receipt_bound_stopped_historical_predecessor_is_preserved(self):
        previous, fixture = self.historical()
        before = copy.deepcopy(previous), fixture.historical_path.read_bytes()
        self.assertEqual(self.observe()['liveId'], self.f.candidate['Id'])
        self.assertEqual(before, (previous, fixture.historical_path.read_bytes()))
        previous['State']['Paused'] = True
        with self.assertRaises(REFUSED): self.observe()

    def test_unpinned_historical_predecessor_is_denied(self):
        _, fixture = self.historical()
        with patch.object(consumers.controller, 'ACCEPTED_CONTEXT_SHA256', '0' * 64), self.assertRaises(REFUSED):
            self.observe()

    def test_missing_or_nonpublic_candidate_state_fails_before_docker(self):
        for phase in ('maintenance-started', 'candidate-verified', 'unknown'):
            with self.subTest(phase=phase):
                self.write_record(dict(self.record, phase=phase))
                with self.assertRaises(REFUSED): self.observe()
                self.assertEqual(self.docker.calls, [])
        self.f.state_path.unlink()
        with self.assertRaises(REFUSED): self.observe()
        self.assertEqual(self.docker.calls, [])

    def test_context_digest_and_exact_accepted_pins_cannot_be_rebound(self):
        for field, value in [('contextSha256', '0' * 64), ('latestAttempt', '4'), ('acceptanceSha256', '')]:
            with self.subTest(field=field):
                self.write_record(dict(self.record, **{field: value}))
                with self.assertRaises(REFUSED): self.observe()
        changed = copy.deepcopy(self.record)
        changed['context']['bankActivationId'] = '8' * 64
        changed['contextSha256'] = donor.state.digest(changed['context'])
        self.write_record(changed)
        with self.assertRaises(REFUSED): self.observe()
        self.assertEqual(self.docker.calls, [])

    def test_wrong_release_tree_and_noncanonical_home_root_fail_closed(self):
        for release in ('', 'main', '0' * 40):
            with self.subTest(release=release), self.assertRaises(REFUSED): self.observe(expected_release=release)
        with patch.object(consumers, 'EXPECTED_TREE', '0' * 40), self.assertRaises(REFUSED): self.observe()
        with patch.object(Path, 'home', return_value=self.f.root / 'other'), self.assertRaises(REFUSED): self.observe()
        with self.assertRaises(REFUSED): self.observe(state_dir=self.f.state_dir.parent)
        self.assertEqual(self.docker.calls, [])

    def test_pending_or_malformed_accepted_pins_refuse_before_docker(self):
        for field in self.pins:
            for value in (None, '', 'unbound'):
                with self.subTest(field=field, value=value), \
                     patch.object(consumers, 'ACCEPTED_PINS', dict(self.pins, **{field: value})), \
                     self.assertRaises(REFUSED):
                    self.observe()
                self.assertEqual(self.docker.calls, [])

    def test_missing_changed_or_future_d063_activation_is_denied(self):
        original = self.marker.read_bytes()
        self.marker.unlink()
        with self.assertRaises(REFUSED): self.observe()
        record = json.loads(original)
        changes = [('state', 'not-started'), ('releaseSha', consumers.adoption.ACCEPTED_SHA),
                   ('runAttempt', '1'), ('candidateContainerId', '0' * 64),
                   ('candidateRouteSha256', '0' * 64), ('diagnosticDirectory', str(self.f.work)),
                   ('observedAtUtc', (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)).isoformat())]
        for field, value in changes:
            with self.subTest(field=field):
                private(self.marker, json_bytes(dict(record, **{field: value})))
                with self.assertRaises(REFUSED): self.observe()

    def test_private_state_symlink_mode_and_duplicate_json_are_denied(self):
        original = self.f.state_path.read_bytes()
        self.f.state_path.chmod(0o644)
        with self.assertRaises(REFUSED): self.observe()
        self.f.state_path.chmod(0o600)
        target = self.f.state_path.with_name('saved-public.json')
        self.f.state_path.rename(target)
        self.f.state_path.symlink_to(target)
        with self.assertRaises(REFUSED): self.observe()
        self.f.state_path.unlink()
        private(self.f.state_path, b'{"phase":"public-started",' + original[1:])
        with self.assertRaises(REFUSED): self.observe()

    def test_unsealed_changed_or_replaced_adoption_fails_before_docker(self):
        original = self.f.own_path.read_bytes()
        for fields in (dict(phase='adopted', sealed=False), dict(acceptedStateSha256='0' * 64)):
            saved = json.loads(original)
            saved.update(fields)
            private(self.f.own_path, json_bytes(saved))
            with self.subTest(fields=fields), self.assertRaises(REFUSED): self.observe()
            self.assertEqual(self.docker.calls, [])
        private(self.f.own_path, original)
        accepted = json.loads(self.f.accepted_path.read_bytes())
        accepted['probe']['historyCount'] += 1
        private(self.f.accepted_path, json_bytes(accepted))
        with self.assertRaises(REFUSED): self.observe()

    def test_shared_adoption_lock_refuses_concurrent_mutation(self):
        fd = os.open(self.f.own_path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(REFUSED): self.observe()
        finally:
            os.close(fd)

    def test_unknown_running_or_stopped_reader_or_writer_is_denied(self):
        for running in (False, True):
            for writable in (False, True):
                extra = dict(Id='7' * 64, Name='/unknown-canonical-consumer', Config={},
                             State=dict(Running=running, Paused=False),
                             HostConfig=dict(RestartPolicy=dict(Name='no', MaximumRetryCount=0)),
                             Mounts=[dict(Type='volume', Name=self.f.context['dataVolume'], Destination='/data', RW=writable)])
                self.f.backup.docker.objects['container', 'unknown-canonical-consumer'] = extra
                with self.subTest(running=running, writable=writable), self.assertRaises(REFUSED): self.observe()

    def test_old_accepted_app_cannot_restart_or_change_image(self):
        for field, value in [('Running', True), ('Paused', True)]:
            self.f.previous['State'][field] = value
            with self.subTest(field=field), self.assertRaises(REFUSED): self.observe()
            self.f.previous['State'][field] = False
        self.f.previous['Image'] = self.f.context['imageId']
        with self.assertRaises(REFUSED): self.observe()

    def test_live_writer_runtime_or_control_mount_drift_is_denied(self):
        original = copy.deepcopy(self.f.candidate)
        for mutation in (
            lambda x: x['State'].update(Running=False),
            lambda x: x['State'].update(Paused=True),
            lambda x: x['Config'].update(User='root'),
            lambda x: x['Config']['Labels'].update({'arthello.release.tree': '0' * 40}),
            lambda x: x['HostConfig'].update(Privileged=True),
            lambda x: next(m for m in x['Mounts'] if m['Destination'] == '/var/lib/arthello-v52-backup-control').update(RW=True),
            lambda x: x['Mounts'].append(dict(Type='volume', Name=self.f.context['backupVolume'], Destination='/history', RW=False)),
        ):
            self.f.candidate.clear()
            self.f.candidate.update(copy.deepcopy(original))
            mutation(self.f.candidate)
            with self.assertRaises(REFUSED): self.observe()

    def test_accepted_worker_stopped_unhealthy_or_writable_is_denied(self):
        self.f.worker['State']['Running'] = False
        with self.assertRaises(REFUSED): self.observe()
        self.f.worker['State']['Running'] = True
        self.f.backup_ok = False
        with self.assertRaises(REFUSED): self.observe()
        self.f.backup_ok = True
        next(m for m in self.f.worker['Mounts'] if m['Destination'] == '/data')['RW'] = True
        with self.assertRaises(REFUSED): self.observe()

    def test_gateway_identity_domain_and_public_route_are_bound(self):
        original = copy.deepcopy(self.f.caddy)
        for mutation in (
            lambda x: x.update(Image='sha256:' + '0' * 64),
            lambda x: x['State'].update(Restarting=True),
            lambda x: x['Config'].update(Env=['APP_DOMAIN=other.example.invalid']),
            lambda x: x['Config'].update(Env=['APP_DOMAIN=stroios.example.invalid'] * 2),
        ):
            self.f.caddy.clear()
            self.f.caddy.update(copy.deepcopy(original))
            mutation(self.f.caddy)
            with self.assertRaises(REFUSED): self.observe()
        self.f.caddy.clear()
        self.f.caddy.update(original)
        self.f.route = 'unbound-public-route\n'
        with self.assertRaises(REFUSED): self.observe()

    def test_second_observation_rejects_consumer_metadata_drift(self):
        self.docker.after_gateway_read = lambda: self.f.previous['State'].update(Running=True)
        with self.assertRaises(REFUSED): self.observe()

    def test_second_observation_rejects_new_stopped_canonical_reader(self):
        def drift():
            self.f.backup.docker.objects['container', 'late-reader'] = {
                'Id': '7' * 64, 'Name': '/late-reader', 'Config': {},
                'State': {'Running': False, 'Paused': False},
                'HostConfig': {'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}},
                'Mounts': [{'Type': 'volume', 'Name': self.f.context['dataVolume'], 'Destination': '/data', 'RW': False}],
            }
        self.docker.after_gateway_read = drift
        with self.assertRaises(REFUSED): self.observe()

    def test_final_worker_check_rejects_service_stopped_after_healthy_probe(self):
        self.docker.after_gateway_read = lambda: self.f.worker['State'].update(Running=False)
        with self.assertRaises(REFUSED): self.observe()

    def test_second_observation_rejects_same_id_app_image_drift(self):
        self.docker.after_gateway_read = lambda: self.f.candidate.update(Image='sha256:' + '0' * 64)
        with self.assertRaises(REFUSED): self.observe()

    def test_second_observation_rejects_durable_record_drift(self):
        self.docker.after_gateway_read = lambda: self.write_record(dict(self.record, acceptanceSha256='9' * 64))
        with self.assertRaises(REFUSED): self.observe()

    def test_second_observation_rejects_activation_record_drift(self):
        def drift():
            record = json.loads(self.marker.read_bytes())
            record['runAttempt'] = '4'
            private(self.marker, json_bytes(record))
        self.docker.after_gateway_read = drift
        with self.assertRaises(REFUSED): self.observe()

    def test_sealed_state_changed_during_healthy_probe_is_denied(self):
        original = self.f.run
        def probe(arguments, timeout=30):
            result = original(arguments, timeout)
            record = json.loads(self.f.own_path.read_bytes())
            record['backupAtAdoption']['historyCount'] += 1
            private(self.f.own_path, json_bytes(record))
            return result
        with patch.object(self.f, 'run', probe), self.assertRaises(REFUSED): self.observe()

    def test_history_growth_keeps_sealed_evidence_and_proof_stable(self):
        original = self.f.own_path.read_bytes()
        before = self.observe()
        self.f.backup.docker.health.update(historyCount=8, lastVerifiedBackupId='later-synthetic')
        self.assertEqual(self.observe(), before)
        self.assertEqual(self.f.own_path.read_bytes(), original)

    def test_between_observations_valid_historical_inventory_change_changes_proof(self):
        before = self.observe()
        self.historical()
        after = self.observe()
        self.assertEqual(before['liveId'], after['liveId'])
        self.assertNotEqual(before['proofSha256'], after['proofSha256'])

    def test_between_observations_receipt_change_changes_proof(self):
        before = self.observe()
        self.write_record(dict(self.record, acceptanceSha256='9' * 64))
        after = self.observe()
        self.assertEqual(before['liveId'], after['liveId'])
        self.assertNotEqual(before['proofSha256'], after['proofSha256'])

    def test_real_docker_facade_rejects_mutations_and_unbound_reads_before_process(self):
        docker = consumers.Docker()
        worker = consumers.adoption.ACCEPTED_WORKER_ID
        forbidden = [
            ['container', 'start', worker], ['container', 'stop', worker],
            ['container', 'update', '--restart=no', worker], ['container', 'rm', worker],
            ['volume', 'create', 'unexpected'], ['volume', 'rm', 'unexpected'],
            ['container', 'ls', '--quiet', '--no-trunc', '--filter', 'volume=' + consumers.VOLUME],
            ['container', 'exec', self.f.candidate['Id'], 'node', '-e', consumers.boundary.BANK_EMPTY],
            ['container', 'exec', worker, 'sh', '-c', 'true'],
            ['container', 'exec', '0' * 64, 'python3', '-I', '/opt/arthello-backup/probe.py', '--require-initial-verified'],
            ['exec', self.f.caddy['Id'], 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile'],
        ]
        with patch('subprocess.run') as process:
            for arguments in forbidden:
                with self.subTest(arguments=arguments), self.assertRaises(REFUSED):
                    docker.run(arguments)
            with self.assertRaises(REFUSED):
                docker.read_gateway_config(self.f.caddy['Id'], '/etc/caddy/Caddyfile')
            docker.bind_gateway(self.f.caddy['Id'])
            for identity, filename in [('0' * 64, '/etc/caddy/Caddyfile'),
                                       (self.f.caddy['Id'], '/run/secrets/private'),
                                       (self.f.caddy['Id'], '/data/../etc/caddy/Caddyfile')]:
                with self.assertRaises(REFUSED): docker.read_gateway_config(identity, filename)
            with self.assertRaises(REFUSED): docker.bind_gateway('0' * 64)
            process.assert_not_called()

    def test_real_docker_facade_permits_only_exact_bounded_metadata_probe_and_config_reads(self):
        docker = consumers.Docker()
        metadata = [
            ['container', 'inspect', self.f.candidate['Id']],
            ['image', 'inspect', self.f.context['imageId']],
            ['volume', 'inspect', self.f.context['dataVolume']],
            ['container', 'ls', '--all', '--quiet', '--no-trunc', '--filter', 'volume=' + consumers.VOLUME],
            ['container', 'exec', consumers.adoption.ACCEPTED_WORKER_ID, 'python3', '-I',
             '/opt/arthello-backup/probe.py', '--require-initial-verified'],
        ]
        with patch('subprocess.run', return_value=SimpleNamespace(returncode=0, stdout='synthetic', stderr='')) as process:
            for arguments in metadata:
                docker.run(arguments, timeout=999)
                self.assertEqual(process.call_args.args, (['docker', *arguments],))
                self.assertEqual(process.call_args.kwargs['timeout'], 20)
                self.assertEqual(set(process.call_args.kwargs['env']), {'PATH'})
            docker.bind_gateway(self.f.caddy['Id'])
            for filename in ('/etc/caddy/Caddyfile', '/data/external-routes.caddy'):
                self.assertEqual(docker.read_gateway_config(self.f.caddy['Id'], filename), 'synthetic')
                self.assertEqual(process.call_args.args, (['docker', 'exec', self.f.caddy['Id'], 'cat', filename],))
                self.assertEqual(process.call_args.kwargs['timeout'], 10)
                self.assertEqual(set(process.call_args.kwargs['env']), {'PATH'})
        with patch('subprocess.run', return_value=SimpleNamespace(returncode=1, stdout='', stderr='synthetic failure')), self.assertRaises(REFUSED):
            docker.read_gateway_config(self.f.caddy['Id'], '/etc/caddy/Caddyfile')
        with patch('subprocess.run', return_value=SimpleNamespace(returncode=0, stdout='x' * (consumers.gateway.MAX_CONFIG + 1), stderr='')), self.assertRaises(REFUSED):
            docker.read_gateway_config(self.f.caddy['Id'], '/etc/caddy/Caddyfile')


class R13LauncherTests(unittest.TestCase):
    """Compose the existing temporary executable harness; do not rediscover its suite."""
    def setUp(self):
        self.fixture = launcher_donor.LauncherTests('test_verified_pair_is_checked_before_and_after_only_readonly_probe')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.environment['EXPECTED_LIVE_SOURCE_SHA'] = 'f5fa3e46e3510e6fc98ae4455f4b499c0ba30695'
        shim = self.fixture.directory / 'python3'
        source = shim.read_text()
        replacements = [
            ('scripts/production-data-consumers.py', 'scripts/production-data-consumers-r13.py'),
            ("sourceSha='a'*40", "sourceSha='f5fa3e46e3510e6fc98ae4455f4b499c0ba30695'"),
            ("backupId=('f' if mode == 'final-drift' and count == 2 else 'd')*64",
             "backupId=('f' if mode == 'final-drift' and count == 2 else 'd')*64,\n"
             "                         proofSha256=('f' if mode == 'proof-drift' and count == 2 else 'e')*64"),
        ]
        for before, after in replacements:
            self.assertEqual(source.count(before), 1)
            source = source.replace(before, after)
        shim.write_text(source)

    def new_observations(self):
        calls = self.fixture.commands()
        self.assertFalse(any(name == 'python3' and 'scripts/production-data-consumers.py' in args for name, args in calls))
        observations = [(index, args) for index, (name, args) in enumerate(calls)
                        if name == 'python3' and 'scripts/production-data-consumers-r13.py' in args]
        for _, arguments in observations:
            self.assertEqual(arguments[:2], ['-I', 'scripts/production-data-consumers-r13.py'])
            self.assertEqual(arguments[arguments.index('--expected-release') + 1], self.fixture.environment['EXPECTED_LIVE_SOURCE_SHA'])
        return observations

    def test_fixed_r13_launcher_observes_before_and_after_complete_or_incomplete_probe(self):
        for complete in (True, False):
            with self.subTest(complete=complete):
                self.fixture.log.unlink(missing_ok=True)
                value = launcher_donor.report(complete)
                result = self.fixture.run_launcher(value=value, probe_exit=0 if complete else 2)
                self.assertEqual(result.returncode, 0 if complete else 2, result.stderr)
                observations = self.new_observations()
                probes = [(i, args) for i, (name, args) in enumerate(self.fixture.commands()) if name == 'docker' and args[:1] == ['run']]
                self.assertEqual(len(observations), 2)
                self.assertEqual(len(probes), 1)
                self.assertLess(observations[0][0], probes[0][0])
                self.assertGreater(observations[1][0], probes[0][0])
                self.assertIn('READONLY_RESULT=' + ('bounded_checks_complete' if complete else 'incomplete_or_issues'), result.stdout)
                self.assertIn('READONLY_FINISHED=aggregate_observation_not_live_acceptance', result.stdout)
                self.assertNotIn('READONLY_BLOCKED=', result.stdout)
                self.assertNotIn('UNSAFE_', result.stdout + result.stderr)

    def test_initial_r13_refusal_has_no_legacy_fallback_or_database_probe(self):
        result = self.fixture.run_launcher('initial-refusal')
        self.assertEqual(result.returncode, 2)
        self.assertEqual(len(self.new_observations()), 1)
        self.assertFalse(any(name == 'docker' and args[:1] in (['run'], ['exec']) for name, args in self.fixture.commands()))
        self.assertFalse(any(name == 'precheck-node' for name, _ in self.fixture.commands()))
        self.assertNotIn('READONLY_FINISHED=', result.stdout)
        self.assertNotIn('READONLY_RESULT=', result.stdout)

    def test_final_r13_proof_only_drift_blocks_unchanged_legacy_identity_fields(self):
        # This mode changes only proofSha256; liveId/imageId/sourceSha/backupId remain fixed.
        result = self.fixture.run_launcher('proof-drift')
        self.fixture.assert_blocked(result, 'final_runtime_identity')
        self.assertEqual(len(self.new_observations()), 2)
        self.assertEqual(sum(name == 'docker' and args[:1] == ['run'] for name, args in self.fixture.commands()), 1)
        self.assertFalse(any(line.startswith('{') for line in result.stdout.splitlines()))


if __name__ == '__main__':
    unittest.main()
