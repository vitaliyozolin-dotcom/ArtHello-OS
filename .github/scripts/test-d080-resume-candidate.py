import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('resume', Path(__file__).with_name('d080-resume-candidate.py'))
resume = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resume)


def private(path, body):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_bytes(body.encode() if isinstance(body, str) else body)
    path.chmod(0o600)
    return str(path)


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(body):
    return hashlib.sha256(body).hexdigest()


class HeldCandidate:
    """Synthetic deployment snapshots; no Docker daemon, network or real secrets."""
    def __init__(self, root):
        self.root = root
        self.secret_dir = root / 'config/arthello'
        self.state_dir = self.secret_dir / 'release-state'
        self.durable_root = self.state_dir / 'candidate-work'
        self.work = self.durable_root / 'arthello-deploy-41-1'
        self.work.mkdir(mode=0o700, parents=True)
        for parent in (self.secret_dir, self.state_dir, self.durable_root):
            parent.chmod(0o700)
        self.job_temp = root / 'runner-temp'
        self.job_temp.mkdir(mode=0o700)
        self.release, self.tree = 'a' * 40, 'b' * 40
        self.state_path = self.state_dir / ('candidate-acceptance-' + self.release + '.json')
        self.route = 'synthetic-maintenance-route\n'
        repair = dict(schemaVersion=2, state='verified', repairConfigSha256='1' * 64,
                      executionUid=1001, stateDirectorySha256='2' * 64,
                      activatedAtUtc='2026-01-01T00:00:00Z')
        # The source job receipt is disposable. Only the private copy is state-bound.
        private(self.job_temp / 'school-repair.json', json_bytes(repair))
        self.context = dict(
            releaseSha=self.release, sourceTree=self.tree, runId='41', runAttempt='1',
            candidateContainerId='c' * 64, candidateName='arthello-direct-41-1',
            previousContainerId='d' * 64, previousName='arthello-direct-previous',
            imageId='sha256:' + 'e' * 64, runtimeFingerprint='0' * 64,
            dataVolume='arthello-direct-v44-data', rollbackVolume='arthello-rollback-41-1',
            backupWorker='arthello-v52-backup-worker-41-1', backupVolume='arthello-v52-backups-41-1',
            backupControlVolume='arthello-v52-backup-control-41-1',
            bankActivationVolume='arthello-v52-tochka-activation-41-1', bankActivationId='f' * 64,
            browserSourceSha=self.release, browserImageId='sha256:' + '9' * 64, browserFingerprint='0' * 64,
            originalRouteSha256=sha(b'synthetic-original-route\n'),
            maintenanceRouteSha256=sha(self.route.encode()), publicRouteSha256=sha(b'synthetic-public-route\n'),
            workDirectory=str(self.work),
            originalRouteFile=private(self.work / 'external-routes.before.caddy', 'synthetic-original-route\n'),
            maintenanceRouteFile=private(self.work / 'external-routes.maintenance.caddy', self.route),
            publicRouteFile=private(self.work / 'external-routes.candidate.caddy', 'synthetic-public-route\n'),
            gateNonceFile=private(self.work / 'candidate-gate.nonce', '3' * 64 + '\n'),
            schoolRepairReceiptFile=private(self.work / 'school-repair-receipt.json', json_bytes(repair)),
            schoolRepairConfigSha256=repair['repairConfigSha256'], schoolRepairReceiptSha256=sha(json_bytes(repair)),
            schoolSha='4' * 40,
            backupRuntimeStateFile=str(self.state_dir / 'backup-runtime-41-1/backup-runtime-state.json'))
        c = self.context
        self.images = {
            c['imageId']: dict(Id=c['imageId'], Config=dict(User='node', Entrypoint=['docker-entrypoint.sh'], Env=['PATH=/usr/bin'], Labels={
                'org.opencontainers.image.revision': self.release, 'org.opencontainers.image.source-tree': self.tree})),
            c['browserImageId']: dict(Id=c['browserImageId'], Config=dict(User='1000:1000', Labels={
                'org.opencontainers.image.revision': self.release, 'org.arthello.role': 'e2e-browser'}))}
        # jq is an external-process boundary in this fixture; fingerprint() itself is real.
        for identity, field in [(c['imageId'], 'runtimeFingerprint'), (c['browserImageId'], 'browserFingerprint')]:
            c[field] = sha(json_bytes([self.images[identity]]))
        secret_names = ['integration-credentials-key', 'bootstrap-password', 'central-access-secret', 'openai-api-key']
        file_env = ['INTEGRATION_CREDENTIALS_KEY_FILE', 'ARTHELLO_BOOTSTRAP_PASSWORD_FILE',
                    'CENTRAL_ACCESS_SECRET_FILE', 'OPENAI_API_KEY_FILE']
        for name in secret_names:
            private(self.secret_dir / name, 'synthetic-only\n')
        self.candidate = dict(Id=c['candidateContainerId'], Name='/' + c['candidateName'], Image=c['imageId'],
            Config=dict(Image=c['imageId'], User='node', Entrypoint=['docker-entrypoint.sh'], Cmd=['node', 'production/runtime-server.mjs'],
                        Labels={'arthello.release.sha': self.release},
                        Env=['RELEASE_SHA=' + self.release, 'TOCHKA_AUTOSYNC_ENABLED=1',
                             'TOCHKA_AUTOSYNC_ACTIVATION_ID=' + c['bankActivationId'],
                             'ARTHELLO_PUBLIC_ORIGIN=https://arthello-188-225-38-55.sslip.io',
                             'SCHOOL_PUBLIC_ORIGIN=https://school-188-225-38-55.sslip.io',
                             'SCHOOL_DIARY_SYNC_URL=https://school-188-225-38-55.sslip.io',
                             'SCHOOL_DIARY_ALLOWED_ORIGINS=https://school-188-225-38-55.sslip.io',
                             'NODE_ENV=production', 'PORT=8081', 'ARTHELLO_D1_PATH=/data/d1']
                            + [key + '=/run/secrets/' + name for key, name in zip(file_env, secret_names)]),
            HostConfig=dict(ReadonlyRootfs=True, Privileged=False, NetworkMode='gateway-private',
                            CapDrop=['ALL'], SecurityOpt=['no-new-privileges:true'],
                            Tmpfs={'/tmp': '', '/app/node_modules/.mf': 'rw,uid=1000,gid=1000,mode=0700'}),
            NetworkSettings=dict(Networks={'gateway-private': {}}), State=dict(Running=True, Paused=False),
            Mounts=[dict(Type='volume', Name=name, Destination=target, RW=writable) for target, name, writable in [
                ('/data', c['dataVolume'], True),
                ('/var/lib/arthello-v52-backup-control', c['backupControlVolume'], False),
                ('/var/lib/arthello-v52-tochka-activation', c['bankActivationVolume'], False)]]
                + [dict(Type='bind', Source=str(self.secret_dir / name), Destination='/run/secrets/' + name, RW=False)
                   for name in secret_names]
                + [dict(Type='tmpfs', Source='', Destination=target, RW=True)
                   for target in ('/tmp', '/app/node_modules/.mf')])
        self.previous = dict(Id=c['previousContainerId'], Name='/' + c['previousName'],
            State=dict(Running=False, Paused=False), HostConfig=dict(RestartPolicy=dict(Name='no')),
            Mounts=[dict(Type='volume', Name=c['dataVolume'], Destination='/data', RW=True)])
        self.caddy = dict(Id='5' * 64, Name='/stroios-caddy-1', State=dict(Running=True, Paused=False),
                          NetworkSettings=dict(Networks={'gateway-private': {}}))
        self.rollback = dict(Name=c['rollbackVolume'], Driver='local', Options=None, Labels={
            'arthello.release.sha': self.release, 'arthello.release.run': '41',
            'arthello.rollback.source-container': c['previousContainerId'], 'arthello.rollback.data-volume': c['dataVolume']})
        self.backup_state, self.volumes, self.worker = self.backup_fixture()
        private(Path(c['backupRuntimeStateFile']), json_bytes(self.backup_state))
        self.record = resume.state.begin(self.state_path, c)
        self.main_sha = self.release
        self.probe_ok = True
        self.reload_ok = True
        self.backup_ok = True
        self.bank_empty = True
        self.writer = ''
        self.consumers = [c['candidateContainerId']]
        self.extra_containers = {}
        self.calls = []

    def backup_fixture(self):
        c = self.context
        def labels(role):
            return {'io.arthello.r7.' + key: value for key, value in dict(scope='backup-runtime-v1', run='41',
                attempt='1', release=self.release, tree=self.tree, image=c['imageId'], role=role, instance='6' * 64).items()}
        roles = [('backups', c['backupVolume']), ('control', c['backupControlVolume']), ('activation', c['bankActivationVolume'])]
        volumes = {name: dict(Name=name, Driver='local', Scope='local', Options=None,
                   CreatedAt='2026-01-01T00:00:00Z', Labels=labels(role)) for role, name in roles}
        resources = [dict(kind='volume', role=role, name=name, createdAt='2026-01-01T00:00:00Z') for role, name in roles]
        resources += [dict(kind='container', role='seed', name='arthello-v52-activation-seed-41-1', id='7' * 64, removed=True),
                      dict(kind='container', role='worker', name=c['backupWorker'], id='8' * 64)]
        state = dict(schemaVersion=1, state='verified', pending=None, instance='6' * 64, resources=resources,
            identity=dict(releaseSha=self.release, treeSha=self.tree, imageId=c['imageId'], runId='41', attempt='1',
                sourceVolume=c['dataVolume'], sourceRelativeSha256=sha(resume.backup.SOURCE_RELATIVE.encode())))
        worker = dict(Id='8' * 64, Name='/' + c['backupWorker'], Image=c['imageId'],
            Config=dict(Image=c['imageId'], User='1000:1000', Entrypoint=['python3'],
                Cmd=['-I', '/opt/arthello-backup/worker.py'], Labels=labels('worker'),
                Env=['PATH=/usr/bin', 'ARTHELLO_BACKUP_SOURCE_RELATIVE=' + resume.backup.SOURCE_RELATIVE]),
            HostConfig=dict(NetworkMode='none', ReadonlyRootfs=True, CapDrop=['ALL'],
                SecurityOpt=['no-new-privileges:true'], PidsLimit=64, Memory=268435456, NanoCpus=500000000,
                Tmpfs={'/tmp': 'rw,uid=1000,gid=1000,mode=0700'}, RestartPolicy=dict(Name='unless-stopped'),
                Mounts=[dict(Type='volume', Source=name, Target=target, ReadOnly=readonly,
                             VolumeOptions=dict(NoCopy=nocopy)) for name, target, readonly, nocopy in [
                    (c['dataVolume'], '/data', True, True),
                    (c['backupVolume'], '/var/backups/arthello-v52', False, False),
                    (c['backupControlVolume'], '/var/lib/arthello-v52-backup-control', False, False)]]),
            NetworkSettings=dict(Networks={'none': {}}), State=dict(Running=True, Paused=False),
            Mounts=[dict(Type='volume', Name=name, Destination=target, RW=writable) for name, target, writable in [
                (c['dataVolume'], '/data', False), (c['backupVolume'], '/var/backups/arthello-v52', True),
                (c['backupControlVolume'], '/var/lib/arthello-v52-backup-control', True)]])
        return state, volumes, worker

    def inspect(self, kind, name, missing=False):
        self.calls.append(('inspect', kind, name))
        if kind == 'image': return copy.deepcopy(self.images[name])
        if kind == 'volume': return copy.deepcopy(self.rollback if name == self.context['rollbackVolume'] else self.volumes[name])
        values = {self.context['candidateContainerId']: self.candidate,
                  self.context['previousContainerId']: self.previous,
                  self.context['backupWorker']: self.worker, 'stroios-caddy-1': self.caddy, **self.extra_containers}
        if kind == 'container' and name in values: return copy.deepcopy(values[name])
        raise AssertionError('Unexpected inspection: ' + repr((kind, name)))

    def command(self, args, timeout=30):
        self.calls.append(('docker', args))
        if args == ['ps', '--no-trunc', '--filter', 'name=^/arthello-direct-', '--format', '{{.ID}}']:
            return self.context['candidateContainerId']
        if args == ['ps', '-aq', '--filter', 'name=^/arthello-v52-activation-writer-41-1$']:
            return self.writer
        if args == ['ps', '--no-trunc', '--filter', 'volume=' + self.context['dataVolume'], '--format', '{{.ID}}']:
            return '\n'.join(self.consumers)
        if args == ['container', 'exec', self.worker['Id'], 'python3', '-I', '/opt/arthello-backup/probe.py', '--require-initial-verified']:
            return json.dumps(dict(schemaVersion=1, state='verified', initialVerified=self.backup_ok))
        if args == ['container', 'exec', self.context['candidateContainerId'], 'node', '-e', resume.BANK_EMPTY]:
            resume.require(self.bank_empty)
            return ''
        raise AssertionError('Unexpected Docker command: ' + repr(args))

    def process(self, args, *, input=None, maximum=1048576):
        self.calls.append(('process', args))
        if args[:2] == ['jq', '-cS']:
            return json_bytes(json.loads(input)).decode()
        if args == ['docker', 'container', 'exec', 'stroios-caddy-1', 'cat', '/data/external-routes.caddy']:
            return self.route
        if args == ['docker', 'container', 'exec', 'stroios-caddy-1', 'caddy', 'validate',
                    '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']:
            return ''
        if args == ['docker', 'container', 'exec', 'stroios-caddy-1', 'caddy', 'reload',
                    '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']:
            resume.require(self.reload_ok)
            self.probe_ok = True
            return ''
        if args == ['python3', '-I', str(Path(resume.__file__).with_name('d080-maintenance-route.py')),
                    'probe', '--nonce-file', self.context['gateNonceFile']]:
            resume.require(self.probe_ok)
            return ''
        raise AssertionError('Unexpected process: ' + repr(args))

    def github(self, request, timeout):
        assert request.full_url == 'https://api.github.com/repos/vitaliyozolin-dotcom/ArtHello-OS/git/ref/heads/main'
        assert timeout == 20
        self.calls.append(('current-main', request.full_url))
        return io.BytesIO(json_bytes(dict(object=dict(sha=self.main_sha))))

    def verify(self, **overrides):
        args = dict(release=self.release, tree=self.tree, run='41', attempt='2',
                    durable_root=str(self.durable_root), docker=self)
        args.update(overrides)
        with patch.object(resume, 'command', self.process), patch.object(resume.urllib.request, 'urlopen', self.github), \
             patch.dict(os.environ, {'GH_TOKEN': 'synthetic-github-token'}):
            return resume.verify(self.state_path, **args)

    def repair(self, *, cli=False, mode="--repair-maintenance"):
        identity = dict(release=self.release, tree=self.tree, run='41', attempt='1',
                        durable_root=str(self.durable_root))
        argv = ['d080-resume-candidate.py', '--state', str(self.state_path), mode]
        for key, value in identity.items():
            argv += ['--' + key.replace('_', '-'), value]
        with patch.object(resume, 'command', self.process), patch.object(resume.urllib.request, 'urlopen', self.github), \
             patch.object(resume, 'Docker', return_value=self), patch.dict(os.environ, {'GH_TOKEN': 'synthetic-github-token'}), \
             patch.object(sys, 'argv', argv):
            return resume.main() if cli else resume.repair_maintenance(self.state_path, **identity)


class ResumeCandidateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.fixture = HeldCandidate(Path(self.temporary.name).resolve())

    def test_full_resume_verifies_bound_runtime_and_fresh_current_main(self):
        before = self.fixture.state_path.read_bytes()
        result = self.fixture.verify()
        self.assertEqual(result['context'], self.fixture.context)
        self.assertEqual(before, self.fixture.state_path.read_bytes())
        self.assertEqual(self.fixture.calls[-1][0], 'current-main')
        self.assertTrue(any(call[0] == 'docker' and '/opt/arthello-backup/probe.py' in call[1] for call in self.fixture.calls))
        self.assertTrue(any(call[0] == 'process' and 'probe' in call[1] for call in self.fixture.calls))

    def test_failed_job_temp_cleanup_preserves_nonce_routes_and_bound_repair(self):
        shutil.rmtree(self.fixture.job_temp)
        self.assertEqual(self.fixture.verify()['phase'], 'maintenance-started')
        self.assertTrue(Path(self.fixture.context['schoolRepairReceiptFile']).is_file())
        self.assertTrue(Path(self.fixture.context['gateNonceFile']).is_file())

    def test_maintenance_repair_reloads_only_verified_disk_route_then_probes_effective_route(self):
        self.fixture.probe_ok = False
        before = self.fixture.state_path.read_bytes()
        self.assertEqual(self.fixture.repair()['phase'], 'maintenance-started')
        self.assertEqual(self.fixture.state_path.read_bytes(), before)
        calls = self.fixture.calls
        reloads = [i for i, call in enumerate(calls) if call[0] == 'process' and 'reload' in call[1]]
        validations = [i for i, call in enumerate(calls) if call[0] == 'process' and 'validate' in call[1]]
        current_main = [i for i, call in enumerate(calls) if call[0] == 'current-main']
        probes = [i for i, call in enumerate(calls) if call[0] == 'process' and 'probe' in call[1]]
        self.assertEqual(len(reloads), 1)
        self.assertEqual(len(validations), 1)
        self.assertEqual(len(current_main), 2)
        self.assertEqual(len(probes), 1)
        self.assertLess(current_main[0], validations[0])
        self.assertLess(validations[0], reloads[0])
        self.assertLess(reloads[0], probes[0])
        self.assertLess(probes[0], current_main[1])

    def test_maintenance_repair_rejects_changed_disk_main_or_public_state_before_reload(self):
        original_route = self.fixture.route
        original_state = self.fixture.state_path.read_bytes()
        for changed in ('disk-route', 'main', 'public-state'):
            self.fixture.calls.clear()
            if changed == 'disk-route': self.fixture.route = 'different public route\n'
            if changed == 'main': self.fixture.main_sha = '0' * 40
            if changed == 'public-state':
                record = json.loads(original_state)
                record['phase'] = 'public-started'
                private(self.fixture.state_path, json_bytes(record))
            with self.subTest(changed=changed), self.assertRaises(ValueError): self.fixture.repair()
            self.assertFalse(any(call[0] == 'process' and ('reload' in call[1] or 'validate' in call[1])
                                 for call in self.fixture.calls))
            self.fixture.route = original_route
            self.fixture.main_sha = self.fixture.release
            private(self.fixture.state_path, original_state)

    def test_readonly_current_attempt_verification_never_emits_a_replay_hold_or_reloads(self):
        output = io.StringIO()
        before = self.fixture.state_path.read_bytes()
        with patch('sys.stdout', output):
            self.fixture.repair(cli=True, mode='--verify-maintenance')
        self.assertEqual(output.getvalue(), 'ARTHELLO_D080_MAINTENANCE_RUNTIME=VERIFIED\n')
        self.assertEqual(self.fixture.state_path.read_bytes(), before)
        self.assertFalse(any(call[0] == 'process' and ('reload' in call[1] or 'validate' in call[1])
                             for call in self.fixture.calls))

    def test_failed_maintenance_reload_emits_no_held_marker_and_preserves_state(self):
        self.fixture.probe_ok = False
        self.fixture.reload_ok = False
        before = self.fixture.state_path.read_bytes()
        output = io.StringIO()
        with patch('sys.stdout', output), self.assertRaises(SystemExit) as failure:
            self.fixture.repair(cli=True)
        self.assertEqual(str(failure.exception), 'ARTHELLO_D080_RESUME_RUNTIME=BLOCKED')
        self.assertNotIn('MAINTENANCE_HELD', output.getvalue())
        self.assertEqual(self.fixture.state_path.read_bytes(), before)
        self.assertFalse(self.fixture.probe_ok)
        self.assertTrue(self.fixture.bank_empty)
        self.assertFalse(self.fixture.state_path.with_name('activation-' + self.fixture.release + '.json').exists())
        self.assertEqual(sum(call[0] == 'process' and 'reload' in call[1] for call in self.fixture.calls), 1)

    def test_public_marker_or_public_state_never_resumes(self):
        marker = self.fixture.state_path.with_name('activation-' + self.fixture.release + '.json')
        private(marker, '{}')
        with self.assertRaises(ValueError): self.fixture.verify()
        marker.unlink()
        state = json.loads(self.fixture.state_path.read_text())
        state['phase'] = 'public-started'
        private(self.fixture.state_path, json_bytes(state))
        with self.assertRaises(ValueError): self.fixture.verify()

    def test_other_run_release_tree_or_original_attempt_cannot_resume(self):
        for change in [dict(run='42'), dict(release='f' * 40), dict(tree='f' * 40), dict(attempt='1')]:
            with self.subTest(change=change), self.assertRaises(ValueError): self.fixture.verify(**change)

    def test_original_attempt_can_only_verify_a_maintenance_hold(self):
        self.assertEqual(self.fixture.verify(attempt='1', hold=True)['phase'], 'maintenance-started')

    def test_foreign_or_public_durable_root_is_refused(self):
        with self.assertRaises(ValueError): self.fixture.verify(durable_root=str(self.fixture.job_temp))
        self.fixture.durable_root.chmod(0o755)
        with self.assertRaises(ValueError): self.fixture.verify()

    def test_changed_bound_school_receipt_cannot_resume(self):
        receipt = Path(self.fixture.context['schoolRepairReceiptFile'])
        body = json.loads(receipt.read_text())
        body['repairConfigSha256'] = '0' * 64
        private(receipt, json_bytes(body))
        with self.assertRaises(ValueError): self.fixture.verify()

    def test_stale_main_cannot_resume(self):
        self.fixture.main_sha = 'f' * 40
        with self.assertRaises(ValueError): self.fixture.verify()

    def test_mutated_app_or_browser_image_is_refused(self):
        for field in ('imageId', 'browserImageId'):
            image = self.fixture.images[self.fixture.context[field]]
            original = copy.deepcopy(image)
            image['Config']['Labels']['org.opencontainers.image.revision'] = 'f' * 40
            with self.subTest(field=field), self.assertRaises(ValueError): self.fixture.verify()
            image.clear()
            image.update(original)

    def test_changed_route_or_ineffective_maintenance_is_refused(self):
        original = self.fixture.route
        self.fixture.route = 'public route\n'
        with self.assertRaises(ValueError): self.fixture.verify()
        self.fixture.route = original
        self.fixture.probe_ok = False
        with self.assertRaises(ValueError): self.fixture.verify()

    def test_bank_activation_or_existing_writer_is_refused(self):
        self.fixture.bank_empty = False
        with self.assertRaises(ValueError): self.fixture.verify()
        self.fixture.bank_empty = True
        self.fixture.writer = '9' * 64
        with self.assertRaises(ValueError): self.fixture.verify()

    def test_backup_probe_failure_and_foreign_volume_are_refused(self):
        self.fixture.backup_ok = False
        with self.assertRaises(ValueError): self.fixture.verify()
        self.fixture.backup_ok = True
        self.fixture.volumes[self.fixture.context['backupVolume']]['Labels']['io.arthello.r7.run'] = '42'
        with self.assertRaises(resume.backup.Refused): self.fixture.verify()

    def test_running_previous_container_and_foreign_data_writer_are_refused(self):
        self.fixture.previous['State']['Running'] = True
        with self.assertRaises(ValueError): self.fixture.verify()
        self.fixture.previous['State']['Running'] = False
        identity = '0' * 64
        self.fixture.extra_containers[identity] = dict(Mounts=[dict(Name=self.fixture.context['dataVolume'], RW=True)])
        self.fixture.consumers.append(identity)
        with self.assertRaises(ValueError): self.fixture.verify()

    def test_missing_durable_file_or_changed_private_mode_is_refused(self):
        nonce = Path(self.fixture.context['gateNonceFile'])
        nonce.chmod(0o644)
        with self.assertRaises(ValueError): self.fixture.verify()
        nonce.unlink()
        with self.assertRaises(FileNotFoundError): self.fixture.verify()

    def test_candidate_identity_privileges_and_mounts_are_exact(self):
        patches = [('Id', '0' * 64), ('Image', 'sha256:' + '0' * 64),
                   ('Name', '/arthello-direct-42-1'), ('State', dict(Running=True, Paused=True))]
        baseline = copy.deepcopy(self.fixture.candidate)
        for key, value in patches:
            self.fixture.candidate = {**copy.deepcopy(baseline), key: value}
            with self.subTest(key=key), self.assertRaises(ValueError): self.fixture.verify()
        for patch_value in [dict(Privileged=True), dict(ReadonlyRootfs=False), dict(NetworkMode='host'),
                            dict(PortBindings={'8081/tcp': [{}]}), dict(CapAdd=['SYS_ADMIN'])]:
            self.fixture.candidate = copy.deepcopy(baseline)
            self.fixture.candidate['HostConfig'].update(patch_value)
            with self.subTest(patch=patch_value), self.assertRaises(ValueError): self.fixture.verify()

    def test_foreign_network_secret_mount_or_extra_writable_path_is_refused(self):
        baseline = copy.deepcopy(self.fixture.candidate)
        for change in ('network', 'secret', 'bank-write', 'extra-tmpfs', 'duplicate-env', 'raw-secret', 'entrypoint'):
            self.fixture.candidate = copy.deepcopy(baseline)
            if change == 'network': self.fixture.candidate['NetworkSettings']['Networks']['foreign'] = {}
            if change == 'secret': self.fixture.candidate['Mounts'][3]['Source'] = str(self.fixture.root / 'foreign-secret')
            if change == 'bank-write': self.fixture.candidate['Mounts'][2]['RW'] = True
            if change == 'extra-tmpfs': self.fixture.candidate['Mounts'].append(dict(Type='tmpfs', Destination='/extra', RW=True))
            if change == 'duplicate-env': self.fixture.candidate['Config']['Env'].append('RELEASE_SHA=' + self.fixture.release)
            if change == 'raw-secret': self.fixture.candidate['Config']['Env'].append('CENTRAL_ACCESS_SECRET=synthetic')
            if change == 'entrypoint': self.fixture.candidate['Config']['Entrypoint'] = ['other-entrypoint.sh']
            with self.subTest(change=change), self.assertRaises(ValueError): self.fixture.verify()

    def test_optional_openai_must_match_its_file_mount(self):
        self.fixture.candidate['Config']['Env'] = [item for item in self.fixture.candidate['Config']['Env']
                                                  if not item.startswith('OPENAI_API_KEY_FILE=')]
        with self.assertRaises(ValueError): self.fixture.verify()
        self.fixture.candidate['Mounts'] = [item for item in self.fixture.candidate['Mounts']
                                           if item.get('Destination') != '/run/secrets/openai-api-key']
        self.assertEqual(self.fixture.verify()['phase'], 'maintenance-started')

    def test_private_input_refuses_symlink_fifo_public_mode_and_overflow(self):
        source = self.fixture.root / 'input'
        private(source, 'fixed synthetic')
        self.assertEqual(resume.raw_private(source), b'fixed synthetic')
        link = self.fixture.root / 'link'
        link.symlink_to(source)
        with self.assertRaises((ValueError, OSError)): resume.raw_private(link)
        pipe = self.fixture.root / 'fifo'
        os.mkfifo(pipe, mode=0o600)
        with self.assertRaises(ValueError): resume.raw_private(pipe)
        with self.assertRaises(ValueError): resume.raw_private(source, maximum=1)
        source.chmod(0o644)
        with self.assertRaises(ValueError): resume.raw_private(source)


if __name__ == '__main__':
    unittest.main()
