"""Synthetic inventory regression tests; never inspect or operate on production."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


consumers = load('production_data_consumers', ROOT / 'scripts/production-data-consumers.py')
donor = load('accepted_r10_fixture', ROOT / '.github/scripts/test-d083-resume-candidate.py')
REJECTED = (ValueError, consumers.backup.Refused, consumers.gateway.GateError)


class ProductionDataConsumersTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='production-consumers-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.fixture = donor.HeldCandidate(self.root)
        context = self.fixture.context
        # The older resume fixture did not need these image-default/label checks;
        # supply the actual accepted R10 defaults required by the new observer.
        self.fixture.images[context['imageId']]['Config']['Cmd'] = ['node', 'production/runtime-server.mjs']
        self.fixture.candidate['Config']['Labels'].update({
            'arthello.release.tree': context['sourceTree'], 'arthello.release.run': context['runId'],
        })
        self.gateway_main = '{$APP_DOMAIN} {\n    respond 200\n}\nimport /data/external-routes.caddy\n'
        donor.private(self.fixture.work / 'Caddyfile.before', self.gateway_main)
        self.fixture.gateway_evidence['mainConfigSha256'] = donor.sha(self.gateway_main.encode())
        donor.private(Path(context['gatewayEvidenceFile']), donor.json_bytes(self.fixture.gateway_evidence))
        context['gatewayEvidenceSha256'] = consumers.boundary.state.digest(self.fixture.gateway_evidence)
        self.fixture.record['contextSha256'] = consumers.boundary.state.digest(context)
        self.fixture.caddy['State']['Restarting'] = False
        self.fixture.caddy['Config'] = {'Env': ['APP_DOMAIN=stroios.example.invalid', 'UNRELATED_SECRET=PRIVATE_SENTINEL']}
        self.candidate_state = copy.deepcopy(self.fixture.record)
        self.candidate_state.update(
            phase='public-started', acceptanceSha256='1' * 64,
            acceptanceObservedAtUtc=self.fixture.record['observedAtUtc'],
        )
        self.activation = dict(
            schemaVersion=1, state='activation-started', releaseSha=context['releaseSha'],
            runId=context['runId'], runAttempt=context['runAttempt'],
            candidateContainerId=context['candidateContainerId'],
            previousContainerId=context['previousContainerId'],
            rollbackVolume=context['rollbackVolume'],
            originalRouteSha256=context['originalRouteSha256'],
            candidateRouteSha256=context['publicRouteSha256'],
            diagnosticDirectory=context['workDirectory'],
            observedAtUtc=self.fixture.record['observedAtUtc'],
        )
        self.inventory = [self.fixture.candidate, self.fixture.worker]
        self.arguments = dict(
            expected_release=self.fixture.release,
            candidate_state=self.candidate_state,
            activation=self.activation,
            backup_state=self.fixture.backup_state,
            image=self.fixture.images[context['imageId']],
            caddy=self.fixture.caddy,
            secret_dir=str(self.fixture.secret_dir),
        )

    def validate(self, inventory=None, **overrides):
        arguments = {**self.arguments, **overrides}
        with patch('subprocess.run', side_effect=AssertionError('Unexpected subprocess')), \
             patch('subprocess.Popen', side_effect=AssertionError('Unexpected process')), \
             patch('socket.create_connection', side_effect=AssertionError('Unexpected network')):
            return consumers.validate_inventory(self.inventory if inventory is None else inventory, **arguments)

    def reject_changes(self, baseline, variants, *, argument=None, index=None):
        for description, change in variants:
            altered = copy.deepcopy(baseline)
            change(altered)
            with self.subTest(change=description), self.assertRaises(REJECTED):
                if argument is not None:
                    self.validate(**{argument: altered})
                else:
                    inventory = copy.deepcopy(self.inventory)
                    inventory[index] = altered
                    self.validate(inventory)

    def test_exact_published_app_and_owned_readonly_worker_are_accepted(self):
        before = copy.deepcopy((self.inventory, self.arguments))
        expected = dict(liveId=self.fixture.candidate['Id'], imageId=self.fixture.candidate['Image'],
                        sourceSha=self.fixture.release, backupId=self.fixture.worker['Id'])
        self.assertEqual(self.validate(), expected)
        self.assertEqual(self.validate(list(reversed(self.inventory))), expected)
        self.assertEqual((self.inventory, self.arguments), before)

    def test_later_public_attempt_keeps_original_resource_identity(self):
        self.candidate_state['latestAttempt'] = '2'
        self.activation['runAttempt'] = '2'
        self.activation['diagnosticDirectory'] = str(self.root / 'arthello-deploy-41-2')
        self.assertEqual(self.validate()['liveId'], self.fixture.candidate['Id'])

    def test_observe_reads_real_private_receipts_and_rechecks_inventory(self):
        self.write_public_receipts()
        docker = self.fake_docker()
        result = consumers.observe(self.fixture.release, self.fixture.state_dir, docker=docker)
        self.assertEqual(result, self.validate())
        self.assertEqual(sum(call[0] == 'ps' for call in docker.calls), 2)
        self.assertEqual(sum(call[0] == 'inspect' for call in docker.calls), 5)
        self.assertEqual({call[1] for call in docker.calls if call[0] == 'inspect'}, {'container', 'image'})
        self.assertEqual([call for call in docker.calls if call[0] == 'gateway_config'],
                         [('gateway_config', self.fixture.gateway_evidence['gatewayId'], path)
                          for path in ('/etc/caddy/Caddyfile', '/data/external-routes.caddy')])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_observe_refuses_second_inventory_drift(self):
        self.write_public_receipts()
        docker = self.fake_docker(drift=True)
        with self.assertRaises(REJECTED):
            consumers.observe(self.fixture.release, self.fixture.state_dir, docker=docker)
        self.assertEqual(sum(call[0] == 'ps' for call in docker.calls), 2)

    def test_observe_refuses_nonpublic_or_missing_source_evidence(self):
        self.write_public_receipts()
        state = copy.deepcopy(self.candidate_state)
        state['phase'] = 'maintenance-started'
        donor.private(self.fixture.state_path, donor.json_bytes(state))
        with self.assertRaises(REJECTED):
            consumers.observe(self.fixture.release, self.fixture.state_dir, docker=self.fake_docker())
        with self.assertRaises((ValueError, OSError)):
            consumers.observe('0' * 40, self.fixture.state_dir, docker=self.fake_docker())

    def test_legacy_context_or_changed_gateway_evidence_blocks_before_docker(self):
        self.write_public_receipts()
        original = copy.deepcopy(self.candidate_state)
        altered = copy.deepcopy(original)
        for field in ('gatewayEvidenceFile', 'gatewayEvidenceSha256'):
            del altered['context'][field]
        altered['contextSha256'] = consumers.boundary.state.digest(altered['context'])
        donor.private(self.fixture.state_path, donor.json_bytes(altered))
        docker = self.fake_docker()
        with self.assertRaises(REJECTED):
            consumers.observe(self.fixture.release, self.fixture.state_dir, docker=docker)
        self.assertEqual(docker.calls, [])
        donor.private(self.fixture.state_path, donor.json_bytes(original))
        changed = {**self.fixture.gateway_evidence, 'appDomain': 'changed.example.invalid'}
        donor.private(Path(self.fixture.context['gatewayEvidenceFile']), donor.json_bytes(changed))
        with self.assertRaises(REJECTED):
            consumers.observe(self.fixture.release, self.fixture.state_dir, docker=docker)
        self.assertEqual(docker.calls, [])

    def test_fresh_gateway_domain_missing_duplicate_or_changed_is_rejected(self):
        self.write_public_receipts()
        for values in [[], ['APP_DOMAIN=changed.example.invalid'],
                       ['APP_DOMAIN=stroios.example.invalid'] * 2,
                       ['APP_DOMAIN=stroios.example.invalid\nPRIVATE_TOKEN'],
                       ['APP_DOMAIN=arthello-188-225-38-55.sslip.io']]:
            with self.subTest(case=len(values)):
                self.fixture.caddy['Config']['Env'] = values
                docker = self.fake_docker()
                with self.assertRaises(REJECTED):
                    consumers.observe(self.fixture.release, self.fixture.state_dir, docker=docker)

    def test_fresh_gateway_main_or_public_routes_must_match_accepted_bytes(self):
        self.write_public_receipts()
        for target in ('/etc/caddy/Caddyfile', '/data/external-routes.caddy'):
            docker = self.fake_docker()
            original = docker.read_gateway_config
            docker.read_gateway_config = lambda identity, path: 'PRIVATE_CHANGED_CONFIG' if path == target else original(identity, path)
            with self.subTest(path=target), self.assertRaises(REJECTED):
                consumers.observe(self.fixture.release, self.fixture.state_dir, docker=docker)

    def test_retained_source_file_changes_or_gateway_inspect_race_are_rejected(self):
        self.write_public_receipts()
        for file in (self.fixture.work / 'Caddyfile.before', Path(self.fixture.context['originalRouteFile'])):
            original = file.read_bytes()
            donor.private(file, original + b'# PRIVATE_DRIFT\n')
            with self.assertRaises(REJECTED):
                consumers.observe(self.fixture.release, self.fixture.state_dir, docker=self.fake_docker())
            donor.private(file, original)
        docker = self.fake_docker()
        original_inspect = docker.inspect
        def inspect(kind, identity):
            value = original_inspect(kind, identity)
            if identity == self.fixture.gateway_evidence['gatewayId']:
                value['Image'] = 'sha256:' + '0' * 64
            return value
        docker.inspect = inspect
        with self.assertRaises(REJECTED):
            consumers.observe(self.fixture.release, self.fixture.state_dir, docker=docker)

    def write_public_receipts(self):
        donor.private(self.fixture.state_path, donor.json_bytes(self.candidate_state))
        donor.private(self.fixture.state_dir / ('activation-' + self.fixture.release + '.json'), donor.json_bytes(self.activation))
        donor.private(Path(self.fixture.context['backupRuntimeStateFile']), donor.json_bytes(self.fixture.backup_state))

    def fake_docker(self, drift=False):
        fixture = self.fixture
        gateway_main = self.gateway_main
        public_route = Path(fixture.context['publicRouteFile']).read_text()

        class MetadataDocker:
            def __init__(self):
                self.calls = []
                self.inventories = 0

            def command(self, arguments):
                assert arguments == ['ps', '--no-trunc', '--filter', 'volume=' + consumers.VOLUME, '--format', '{{.ID}}']
                self.calls.append(('ps',))
                self.inventories += 1
                identities = [fixture.candidate['Id'], fixture.worker['Id']]
                if drift and self.inventories > 1:
                    identities.append('0' * 64)
                return '\n'.join(identities) + '\n'

            def inspect(self, kind, identity):
                self.calls.append(('inspect', kind, identity))
                values = {
                    ('container', fixture.candidate['Id']): fixture.candidate,
                    ('container', fixture.worker['Id']): fixture.worker,
                    ('container', 'stroios-caddy-1'): fixture.caddy,
                    ('container', fixture.gateway_evidence['gatewayId']): fixture.caddy,
                    ('image', fixture.context['imageId']): fixture.images[fixture.context['imageId']],
                }
                assert (kind, identity) in values
                return copy.deepcopy(values[(kind, identity)])

            def read_gateway_config(self, identity, path):
                assert identity == fixture.gateway_evidence['gatewayId']
                self.calls.append(('gateway_config', identity, path))
                return {'/etc/caddy/Caddyfile': gateway_main, '/data/external-routes.caddy': public_route}[path]

        return MetadataDocker()

    def test_missing_duplicate_unknown_or_extra_consumer_is_refused(self):
        unknown = dict(Id='0' * 64, Name='/foreign-reader', State=dict(Running=True, Paused=False),
                       Mounts=[dict(Type='volume', Name=self.fixture.context['dataVolume'],
                                    Destination='/data', RW=False)])
        variants = [[], [self.fixture.candidate], [self.fixture.worker],
                    [self.fixture.candidate, self.fixture.candidate],
                    [self.fixture.worker, self.fixture.worker],
                    [self.fixture.candidate, unknown], self.inventory + [unknown],
                    self.inventory + [copy.deepcopy(self.fixture.worker)]]
        for writable in (False, True):
            foreign = copy.deepcopy(unknown)
            foreign['Mounts'][0]['RW'] = writable
            variants.append(self.inventory + [foreign])
        for number, inventory in enumerate(variants):
            with self.subTest(inventory=number), self.assertRaises(ValueError):
                self.validate(inventory)

    def test_wrong_expected_release_and_image_identity_are_refused(self):
        for release in ('b' * 40, '', 'main'):
            with self.subTest(release=release), self.assertRaises(ValueError):
                self.validate(expected_release=release)
        self.reject_changes(self.arguments['image'], [
            ('image-id', lambda image: image.update(Id='sha256:' + '0' * 64)),
            ('source', lambda image: image['Config']['Labels'].update({'org.opencontainers.image.revision': '0' * 40})),
            ('tree', lambda image: image['Config']['Labels'].update({'org.opencontainers.image.source-tree': '0' * 40})),
            ('entrypoint', lambda image: image['Config'].update(Entrypoint=['foreign-entrypoint'])),
        ], argument='image')

    def test_missing_nonpublic_or_changed_candidate_receipt_is_refused(self):
        with self.assertRaises(ValueError):
            self.validate(candidate_state=None)
        self.reject_changes(self.candidate_state, [
            ('schema', lambda record: record.update(schemaVersion=2)),
            ('maintenance', lambda record: record.update(phase='maintenance-started')),
            ('verified-private', lambda record: record.update(phase='candidate-verified')),
            ('missing-context', lambda record: record.pop('context')),
            ('wrong-context-digest', lambda record: record.update(contextSha256='0' * 64)),
            ('changed-context', lambda record: record['context'].update(previousContainerId='0' * 64)),
            ('missing-acceptance', lambda record: record.pop('acceptanceSha256')),
            ('invalid-acceptance', lambda record: record.update(acceptanceSha256='not-a-digest')),
            ('missing-attempt', lambda record: record.pop('latestAttempt')),
            ('zero-attempt', lambda record: record.update(latestAttempt='0')),
        ], argument='candidate_state')

    def test_missing_or_mismatched_public_activation_receipt_is_refused(self):
        with self.assertRaises(ValueError):
            self.validate(activation=None)
        variants = [('schema', lambda value: value.update(schemaVersion=2)),
                    ('state', lambda value: value.update(state='candidate-verified'))]
        wrong = dict(releaseSha='0' * 40, runId='99', runAttempt='2',
                     candidateContainerId='0' * 64, previousContainerId='0' * 64,
                     rollbackVolume='arthello-rollback-99-1', originalRouteSha256='0' * 64,
                     candidateRouteSha256=self.fixture.context['maintenanceRouteSha256'])
        for field, value in wrong.items():
            variants.append((field, lambda record, field=field, value=value: record.update({field: value})))
        self.reject_changes(self.activation, variants, argument='activation')

    def test_missing_unverified_or_foreign_backup_receipt_is_refused(self):
        with self.assertRaises(ValueError):
            self.validate(backup_state=None)
        self.reject_changes(self.fixture.backup_state, [
            ('schema', lambda state: state.update(schemaVersion=2)),
            ('pending-state', lambda state: state.update(state='creating')),
            ('pending-resource', lambda state: state.update(pending={'kind': 'container', 'role': 'worker'})),
            ('instance', lambda state: state.update(instance='0' * 64)),
            ('malformed-instance', lambda state: state.update(instance='invalid')),
            ('identity-release', lambda state: state['identity'].update(releaseSha='0' * 40)),
            ('identity-run', lambda state: state['identity'].update(runId='42')),
            ('identity-attempt', lambda state: state['identity'].update(attempt='2')),
            ('identity-source', lambda state: state['identity'].update(sourceVolume='foreign-data')),
            ('identity-db-path', lambda state: state['identity'].update(sourceRelativeSha256='0' * 64)),
            ('missing-worker', lambda state: state.update(resources=[r for r in state['resources'] if r['role'] != 'worker'])),
            ('duplicate-worker', lambda state: state['resources'].append(copy.deepcopy(state['resources'][-1]))),
            ('worker-id', lambda state: state['resources'][-1].update(id='0' * 64)),
            ('worker-name', lambda state: state['resources'][-1].update(name='foreign-worker')),
            ('volume-name', lambda state: state['resources'][0].update(name='foreign-backups')),
        ], argument='backup_state')

    def test_worker_label_image_command_environment_and_runtime_are_exact(self):
        self.reject_changes(self.fixture.worker, [
            ('id', lambda worker: worker.update(Id='0' * 64)),
            ('name', lambda worker: worker.update(Name='/foreign-worker')),
            ('image', lambda worker: worker.update(Image='sha256:' + '0' * 64)),
            ('config-image', lambda worker: worker['Config'].update(Image='foreign:latest')),
            ('label-release', lambda worker: worker['Config']['Labels'].update({'io.arthello.r7.release': '0' * 40})),
            ('label-instance', lambda worker: worker['Config']['Labels'].update({'io.arthello.r7.instance': '0' * 64})),
            ('label-extra', lambda worker: worker['Config']['Labels'].update({'io.arthello.r7.foreign': 'unexpected'})),
            ('root-user', lambda worker: worker['Config'].update(User='0:0')),
            ('entrypoint', lambda worker: worker['Config'].update(Entrypoint=['sh'])),
            ('command', lambda worker: worker['Config'].update(Cmd=['-c', 'true'])),
            ('extra-env', lambda worker: worker['Config']['Env'].append('SYNTHETIC_SECRET=unused')),
            ('duplicate-env', lambda worker: worker['Config']['Env'].append('PATH=/usr/bin')),
            ('db-path-env', lambda worker: worker['Config'].update(Env=['PATH=/usr/bin', 'ARTHELLO_BACKUP_SOURCE_RELATIVE=foreign.sqlite'])),
            ('stopped', lambda worker: worker['State'].update(Running=False)),
            ('paused', lambda worker: worker['State'].update(Paused=True)),
        ], index=1)

    def test_worker_external_access_and_privilege_changes_are_refused(self):
        variants = []
        for key, value in dict(NetworkMode='host', ReadonlyRootfs=False, Privileged=True,
                               CapAdd=['SYS_ADMIN'], CapDrop=[], SecurityOpt=[],
                               PidsLimit=0, Memory=0, NanoCpus=0, PidMode='host', IpcMode='host',
                               Binds=['/tmp:/foreign'], VolumesFrom=['foreign'],
                               Devices=[{'PathOnHost': '/dev/null'}], DeviceRequests=[{'Count': -1}],
                               PortBindings={'8081/tcp': [{'HostPort': '18081'}]}, PublishAllPorts=True,
                               ExtraHosts=['foreign:127.0.0.1'], GroupAdd=['0']).items():
            variants.append((key, lambda worker, key=key, value=value: worker['HostConfig'].update({key: value})))
        variants.extend([
            ('extra-network', lambda worker: worker['NetworkSettings']['Networks'].update(foreign={})),
            ('restart-policy', lambda worker: worker['HostConfig']['RestartPolicy'].update(Name='always')),
            ('tmpfs-options', lambda worker: worker['HostConfig'].update(Tmpfs={'/tmp': 'rw,mode=0777'})),
        ])
        self.reject_changes(self.fixture.worker, variants, index=1)

    def test_worker_writable_source_or_foreign_mount_is_refused(self):
        self.reject_changes(self.fixture.worker, [
            ('data-writable', lambda worker: worker['Mounts'][0].update(RW=True)),
            ('foreign-data', lambda worker: worker['Mounts'][0].update(Name='foreign-data')),
            ('source-at-other-path', lambda worker: worker['Mounts'][0].update(Destination='/foreign')),
            ('extra-bind', lambda worker: worker['Mounts'].append(dict(Type='bind', Source='/tmp', Destination='/extra', RW=False))),
            ('extra-activation-volume', lambda worker: worker['Mounts'].append(dict(Type='volume', Name=self.fixture.context['bankActivationVolume'], Destination='/activation', RW=False))),
            ('configured-data-writable', lambda worker: worker['HostConfig']['Mounts'][0].update(ReadOnly=False)),
            ('configured-volume-copy', lambda worker: worker['HostConfig']['Mounts'][0]['VolumeOptions'].update(NoCopy=False)),
            ('configured-foreign', lambda worker: worker['HostConfig']['Mounts'][1].update(Source='foreign-backups')),
            ('tmpfs-readonly', lambda worker: worker['Mounts'].append(dict(Type='tmpfs', Destination='/tmp', RW=False))),
        ], index=1)

    def test_app_alternate_network_secret_mount_or_profile_is_refused(self):
        self.reject_changes(self.fixture.candidate, [
            ('release-label', lambda app: app['Config']['Labels'].update({'arthello.release.sha': '0' * 40})),
            ('extra-network', lambda app: app['NetworkSettings']['Networks'].update(foreign={})),
            ('host-network', lambda app: app['HostConfig'].update(NetworkMode='host')),
            ('changed-network', lambda app: app['HostConfig'].update(NetworkMode='other')),
            ('secret-source', lambda app: app['Mounts'][3].update(Source=str(self.root / 'foreign-secret'))),
            ('secret-writable', lambda app: app['Mounts'][3].update(RW=True)),
            ('extra-bind', lambda app: app['Mounts'].append(dict(Type='bind', Source='/tmp', Destination='/extra', RW=False))),
            ('data-readonly', lambda app: app['Mounts'][0].update(RW=False)),
            ('activation-writable', lambda app: app['Mounts'][2].update(RW=True)),
            ('duplicate-env', lambda app: app['Config']['Env'].append('RELEASE_SHA=' + self.fixture.release)),
            ('raw-secret-env', lambda app: app['Config']['Env'].append('CENTRAL_ACCESS_SECRET=synthetic')),
            ('entrypoint', lambda app: app['Config'].update(Entrypoint=['foreign-entrypoint'])),
            ('root-user', lambda app: app['Config'].update(User='0')),
            ('privileged', lambda app: app['HostConfig'].update(Privileged=True)),
            ('writable-root', lambda app: app['HostConfig'].update(ReadonlyRootfs=False)),
            ('stopped', lambda app: app['State'].update(Running=False)),
        ], index=0)
        with self.assertRaises(ValueError):
            self.validate(secret_dir=str(self.root / 'other-secrets'))

    def test_caddy_must_be_running_and_share_the_exact_app_network(self):
        self.reject_changes(self.fixture.caddy, [
            ('foreign-id', lambda caddy: caddy.update(Id='0' * 64)),
            ('foreign-image', lambda caddy: caddy.update(Image='sha256:' + '0' * 64)),
            ('stopped', lambda caddy: caddy['State'].update(Running=False)),
            ('paused', lambda caddy: caddy['State'].update(Paused=True)),
            ('restarting', lambda caddy: caddy['State'].update(Restarting=True)),
            ('foreign-name', lambda caddy: caddy.update(Name='/foreign-caddy')),
            ('no-network', lambda caddy: caddy['NetworkSettings'].update(Networks={})),
            ('different-network', lambda caddy: caddy['NetworkSettings'].update(Networks={'foreign': {}})),
        ], argument='caddy')


class DockerCommandBoundaryTests(unittest.TestCase):
    def test_only_two_fixed_gateway_config_paths_can_be_read_without_a_shell(self):
        docker = consumers.Docker()
        for path in ('/etc/caddy/Caddyfile', '/data/external-routes.caddy'):
            with patch('subprocess.run', return_value=subprocess.CompletedProcess([], 0, 'PRIVATE_CONFIG', '')) as process:
                self.assertEqual(docker.read_gateway_config('a' * 64, path), 'PRIVATE_CONFIG')
                args, kwargs = process.call_args
                self.assertEqual(args, (['docker', 'exec', 'a' * 64, 'cat', path],))
                self.assertTrue(kwargs['capture_output'])
                self.assertEqual(kwargs['timeout'], 10)
                self.assertEqual(set(kwargs['env']), {'PATH'})
        with patch('subprocess.run') as process:
            for identity, path in [('a' * 12, '/etc/caddy/Caddyfile'), ('--help', '/etc/caddy/Caddyfile'),
                                   ('a' * 64, '/run/secrets/key'), ('a' * 64, '/etc/caddy/../secret'),
                                   ('a' * 64, '/etc/caddy/Caddyfile; echo PRIVATE')]:
                with self.assertRaises(ValueError):
                    docker.read_gateway_config(identity, path)
            process.assert_not_called()

    def test_mutating_execution_and_other_command_families_never_launch(self):
        forbidden = [['exec', 'synthetic', 'true'], ['run', 'synthetic'],
                     ['container', 'exec', 'synthetic', 'true'], ['container', 'start', 'synthetic'],
                     ['container', 'stop', 'synthetic'], ['container', 'update', 'synthetic'],
                     ['container', 'rm', 'synthetic'], ['image', 'rm', 'synthetic'],
                     ['system', 'prune'], ['volume', 'inspect', 'synthetic']]
        with patch('subprocess.run') as process:
            for arguments in forbidden:
                with self.subTest(command=arguments[:2]), self.assertRaises(ValueError):
                    consumers.Docker().command(arguments)
            process.assert_not_called()

    def test_metadata_commands_use_bounded_private_capture(self):
        commands = [['ps', '--no-trunc'], ['container', 'inspect', 'a' * 64],
                    ['image', 'inspect', 'sha256:' + 'b' * 64]]
        for arguments in commands:
            with self.subTest(command=arguments[:2]), \
                 patch('subprocess.run', return_value=subprocess.CompletedProcess([], 0, '[]', '')) as process:
                self.assertEqual(consumers.Docker().command(arguments), '[]')
                args, kwargs = process.call_args
                self.assertEqual(args, (['docker', *arguments],))
                self.assertEqual(kwargs['timeout'], 10)
                self.assertTrue(kwargs['capture_output'])
                self.assertEqual(set(kwargs['env']), {'PATH'})


class PrivateInventoryInputTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='private-inventory-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.path = self.root / 'inventory.json'
        self.value = {'synthetic': True, 'containers': []}
        self.path.write_text(json.dumps(self.value), encoding='utf-8')
        self.path.chmod(0o600)

    def test_owned_private_regular_json_is_read(self):
        self.assertEqual(consumers.read_private(self.path), self.value)

    def test_symlink_hardlink_public_mode_and_invalid_json_are_refused(self):
        link = self.root / 'symlink.json'
        link.symlink_to(self.path)
        with self.assertRaises((ValueError, OSError)):
            consumers.read_private(link)
        hardlink = self.root / 'hardlink.json'
        os.link(self.path, hardlink)
        with self.assertRaises(ValueError):
            consumers.read_private(self.path)
        hardlink.unlink()
        self.path.chmod(0o644)
        with self.assertRaises(ValueError):
            consumers.read_private(self.path)
        self.path.chmod(0o600)
        self.path.write_text('not JSON', encoding='utf-8')
        with self.assertRaises(ValueError):
            consumers.read_private(self.path)

    def test_fifo_is_refused_without_blocking(self):
        fifo = self.root / 'fifo'
        os.mkfifo(fifo, mode=0o600)
        # A subprocess deadline turns an accidentally blocking FIFO open into a
        # deterministic failure instead of hanging the hosted test job.
        code = """import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location('reader', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
try:
    module.read_private(pathlib.Path(sys.argv[2]))
except (ValueError, OSError):
    raise SystemExit(0)
raise SystemExit(1)
"""
        result = subprocess.run([sys.executable, '-I', '-c', code, str(ROOT / 'scripts/production-data-consumers.py'), str(fifo)],
                                capture_output=True, text=True, timeout=3)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr, '')

    def test_oversized_json_is_refused(self):
        self.path.write_text(json.dumps({'synthetic': 'x' * 65537}), encoding='utf-8')
        with self.assertRaises(ValueError):
            consumers.read_private(self.path)

    def test_duplicate_keys_and_nonobject_json_are_refused(self):
        for body in ('{"synthetic":true,"synthetic":false}', '[]', 'null'):
            self.path.write_text(body, encoding='utf-8')
            with self.subTest(body=body), self.assertRaises(ValueError):
                consumers.read_private(self.path)


if __name__ == '__main__':
    unittest.main()
