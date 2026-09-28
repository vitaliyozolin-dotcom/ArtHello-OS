import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import tempfile
import json

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('alfa_release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def runtime():
    return {
        'Id': 'a' * 64, 'Name': '/arthello-direct-123-1', 'Image': 'sha256:' + 'b' * 64,
        'State': {'Running': True},
        'Config': {'Env': ['RELEASE_SHA=' + 'c' * 40, 'TOCHKA_AUTOSYNC_ENABLED=1',
                           'TOCHKA_AUTOSYNC_ACTIVATION_ID=' + 'd' * 64, 'ALFACRM_IMPORT_ENABLED=true'],
                   'User': 'node', 'WorkingDir': '/app', 'Labels': {}},
        'HostConfig': {'ReadonlyRootfs': True, 'Privileged': False, 'PortBindings': {},
                       'Binds': [], 'Devices': [], 'CapAdd': [], 'SecurityOpt': [], 'CapDrop': [],
                       'RestartPolicy': {'Name': 'unless-stopped', 'MaximumRetryCount': 0},
                       'Tmpfs': {'/tmp': '', '/app/node_modules/.mf': 'rw,uid=1000,gid=1000,mode=0700'},
                       'Memory': 0, 'NanoCpus': 0, 'PidsLimit': None},
        'NetworkSettings': {'Networks': {'stroios_default': {}}},
        'Mounts': [{'Type': 'volume', 'Name': 'arthello-direct-v44-data', 'Destination': '/data', 'RW': True},
                   {'Type': 'volume', 'Name': 'activation-existing', 'Destination': '/var/lib/arthello-v52-tochka-activation', 'RW': False},
                   {'Type': 'bind', 'Source': '/secrets/key', 'Destination': '/run/secrets/key', 'RW': False}],
    }


class ReleaseTests(unittest.TestCase):
    def test_central_predecessor_is_the_successful_d194_receipt(self):
        self.assertEqual(release.PINS['central'][0], 'd83da0ce8311a4b60832031a217b91c7dd6bb1c8')
        source = Path(release.__file__).read_text()
        self.assertIn('66cc912f6088bc1b929d23ee07fc906b94e82fdd2e747ce6419fb7b2fe3a7b91', source)
        self.assertIn('sha256:70fc84b541c2bffebd8d3130544d98158d25ced0c788890511b7d96a39c50216', source)
        live = ('d066c3e7d94124efd847310e0d5ae9822401fa2f',
                'be2c859257c765ff3fdffda4247757328058ec4f3efecd67eb5312cf6f2c8b35',
                'sha256:c4b2621160a2ecbad49f48d34ee8584a37c300a31aebb5c44658b7cace3048da')
        self.assertIn(live, release.CENTRAL_PREDECESSORS)
        self.assertNotIn((live[0], live[1], 'sha256:' + '0' * 64), release.CENTRAL_PREDECESSORS)

    def test_preserves_bank_configuration_and_storage(self):
        old = runtime()
        plan = release.runtime_plan(old, 'central', 'sha256:' + 'e' * 64, 'f' * 40, '9' * 40)
        self.assertEqual(plan['environment'], old['Config']['Env'] + ['ALFACRM_AUTOSYNC_ENABLED=1'])
        self.assertIn('type=volume,src=activation-existing,dst=/var/lib/arthello-v52-tochka-activation,readonly,volume-nocopy', plan['mounts'])
        self.assertEqual(plan['dataVolume'], 'arthello-direct-v44-data')
        self.assertEqual(plan['name'], 'arthello-direct-123-1')

    def test_ambiguous_or_unsafe_runtime_is_rejected_before_changes(self):
        for change in (
            lambda v: v['NetworkSettings']['Networks'].update(other={}),
            lambda v: v['Mounts'].append(v['Mounts'][0]),
            lambda v: v['HostConfig'].update(Privileged=True),
            lambda v: v['Config']['Env'].append('RELEASE_SHA=conflict'),
            lambda v: v['Mounts'].append({'Type': 'bind', 'Source': '/etc', 'Destination': '/etc', 'RW': True}),
            lambda v: v['HostConfig'].update(PortBindings={'8081/tcp': [{'HostPort': '8081'}]}),
        ):
            old = runtime()
            change(old)
            with self.assertRaises(release.Refused):
                release.runtime_plan(old, 'central', 'sha256:' + 'e' * 64, 'f' * 40, '9' * 40)

    def test_failed_candidate_never_restores_old_database(self):
        calls = []
        release.rollback_runtime(lambda *args: calls.append(args), 'live', 'retained', 'unless-stopped', True)
        self.assertEqual(calls, [('rm', '-f', 'live'), ('rename', 'retained', 'live'),
                                 ('start', 'live'), ('update', '--restart=unless-stopped', 'live')])

    def test_atlas_cannot_be_installed_over_another_institution_volume(self):
        old = runtime(); old['Name'] = '/atlas-school-diary'
        old['Config']['Env'] = ['DATABASE_PATH=/data/atlas-school.sqlite']
        old['Mounts'] = [{'Type':'volume','Name':'atlas-school-diary-data','Destination':'/data','RW':True},
                         {'Type':'volume','Name':'atlas-school-diary-backups','Destination':'/backups','RW':True}]
        release.runtime_plan(old,'atlas','sha256:'+'e'*64,'f'*40,'9'*40)
        old['Mounts'][0]['Name'] = 'other-school-data'
        with self.assertRaises(release.Refused):
            release.runtime_plan(old,'atlas','sha256:'+'e'*64,'f'*40,'9'*40)

    def test_before_candidate_creation_retained_runtime_is_still_recovered(self):
        calls = []
        release.rollback_runtime(lambda *args: calls.append(args), 'live', 'retained', 'no', False)
        self.assertEqual(calls, [('rename', 'retained', 'live'), ('start', 'live'), ('update', '--restart=no', 'live')])

    def test_backup_failure_restarts_original_and_removes_temporary_environment(self):
        old = runtime(); calls=[]
        plan = release.runtime_plan(old, 'central', 'sha256:'+'e'*64, 'f'*40, '9'*40)
        def docker(*args, **kwargs):
            calls.append(args)
            if args[0]=='run':
                raise release.Refused('BACKUP_FAILED')
            return b''
        def inspect(name):
            item = json.loads(json.dumps(old))
            if any(call[0]=='stop' for call in calls): item['State']['Running']=False
            return item
        with tempfile.TemporaryDirectory() as directory, patch.object(release,'docker',docker), patch.object(release,'inspect',inspect):
            with self.assertRaises(release.Refused):
                release.upgrade(old,plan,Path(directory),'123-1',lambda:None)
            self.assertFalse((Path(directory)/'central.env').exists())
        self.assertIn(('start',old['Id']),calls)
        self.assertFalse(any(call[0]=='rename' for call in calls))
        backup_call = next(call for call in calls if call[0] == 'run')
        self.assertLess(next(i for i, call in enumerate(calls) if call[0] == 'stop'), calls.index(backup_call))
        self.assertIn('SNAPSHOT_WRITER_STOPPED=1', backup_call)

    def test_post_public_failure_preserves_current_database_and_recovers_container(self):
        old = runtime(); calls=[]; renamed=False; started=False
        plan = release.runtime_plan(old, 'central', 'sha256:'+'e'*64, 'f'*40, '9'*40)
        def docker(*args, **kwargs):
            nonlocal renamed,started
            calls.append(args)
            if args[0]=='rename': renamed=True
            if args[:2]==('run','--rm'): return b'{"integrity":"ok"}'
            if args[:2]==('run','-d'): started=True
            if args[0]=='ps' and started: return b'candidate'
            return b''
        def inspect(name):
            item=json.loads(json.dumps(old))
            if name==old['Id'] and renamed:
                item['Name'] += '-pre-d194-123-1'
            elif started:
                item['Image']=plan['image'];item['Config']['Env']=plan['environment'];item['RestartCount']=0
            elif any(call[0]=='stop' for call in calls): item['State']['Running']=False
            return item
        with tempfile.TemporaryDirectory() as directory, patch.object(release,'docker',docker), patch.object(release,'inspect',inspect), \
             patch.object(release,'health',lambda *args:None), patch.object(release.time,'sleep',lambda _:None), \
             patch.object(release,'public_health',side_effect=release.Refused('PUBLIC_FAILED')):
            with self.assertRaises(release.Refused):
                release.upgrade(old,plan,Path(directory),'123-1',lambda:None)
        self.assertIn(('rm','-f',plan['name']),calls)
        self.assertIn(('start',plan['name']),calls)
        self.assertEqual(sum(call[0]=='run' and call[1]=='--rm' for call in calls),1)


    def test_stable_health_window_recovers_after_transient_database_busy(self):
        outcomes = [release.Refused('COMMAND_FAILED'), None, release.Refused('COMMAND_FAILED'),
                    None, None, None]

        def health(*_):
            outcome = outcomes.pop(0)
            if outcome:
                raise outcome

        def inspect(_):
            return {'State': {'Running': True}, 'RestartCount': 0}

        with patch.object(release, 'health', health), patch.object(release, 'inspect', inspect), \
             patch.object(release.time, 'sleep', lambda _: None):
            release.stable_health_window('candidate', 8081, 0, soak_checks=3,
                                         recovery_checks=3, required_successes=3)
        self.assertEqual(outcomes, [])

    def test_stable_health_window_rejects_candidate_that_never_recovers(self):
        def health(*_):
            raise release.Refused('COMMAND_FAILED')

        def inspect(_):
            return {'State': {'Running': True}, 'RestartCount': 0}

        with patch.object(release, 'health', health), patch.object(release, 'inspect', inspect), \
             patch.object(release.time, 'sleep', lambda _: None):
            with self.assertRaisesRegex(release.Refused, 'HEALTH_RECOVERY'):
                release.stable_health_window('candidate', 8081, 0, soak_checks=1,
                                             recovery_checks=2, required_successes=2)

    def test_stable_health_window_rejects_restart_even_if_health_recovers(self):
        def inspect(_):
            return {'State': {'Running': True}, 'RestartCount': 1}

        with patch.object(release, 'health', lambda *_: None), patch.object(release, 'inspect', inspect), \
             patch.object(release.time, 'sleep', lambda _: None):
            with self.assertRaisesRegex(release.Refused, 'UNSTABLE_RUNTIME'):
                release.stable_health_window('candidate', 8081, 0, soak_checks=1,
                                             recovery_checks=1, required_successes=1)


class GatewayTests(unittest.TestCase):
    def module(self):
        spec = importlib.util.spec_from_file_location('gateway', Path(__file__).with_name('alfa_gateway.py'))
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        return module

    def config(self):
        return {'apps': {'http': {'servers': {'srv0': {'routes': [
            {'match': [{'host': ['arthello-188-225-38-55.sslip.io']}],
             'handle': [{'handler': 'reverse_proxy', 'upstreams': [{'dial': 'arthello-direct-34837407187-1:8081'}]}]},
            {'match': [{'host': ['unrelated.example']}], 'handle': [{'handler': 'reverse_proxy', 'upstreams': [{'dial': 'other:3000'}]}]}
        ]}}}}}

    def test_gateway_only_changes_exact_central_connection_reuse(self):
        g = self.module(); original = self.config(); before = json.dumps(original, sort_keys=True)
        desired = g.desired_config(original)
        self.assertEqual(json.dumps(original, sort_keys=True), before)
        routes = desired['apps']['http']['servers']['srv0']['routes']
        self.assertEqual(routes[0]['handle'][0]['transport'], {'protocol': 'http', 'keep_alive': {'enabled': False}})
        self.assertEqual(routes[1], original['apps']['http']['servers']['srv0']['routes'][1])

    def test_gateway_rejects_shared_ambiguous_or_changed_target(self):
        g = self.module()
        for mutate in (
            lambda routes: routes[0]['match'][0]['host'].append('other.example'),
            lambda routes: routes[0]['match'].append({}),
            lambda routes: routes.append(routes[0]),
            lambda routes: routes[0]['handle'][0]['upstreams'].append({'dial': 'other:8081'}),
            lambda routes: routes[0]['handle'][0].update(transport={'protocol': 'http', 'tls': {}}),
        ):
            value = self.config(); mutate(value['apps']['http']['servers']['srv0']['routes'])
            with self.assertRaises(ValueError): g.desired_config(value)

    def test_gateway_renderer_preserves_all_other_bytes(self):
        g = self.module()
        source = '# comment\narthello-188-225-38-55.sslip.io {\n  encode gzip\n  reverse_proxy arthello-direct-34837407187-1:8081\n}\nother.example {\n reverse_proxy other:3000\n}\n'
        result = g.render_routes(source)
        self.assertEqual(result, source.replace('  reverse_proxy arthello-direct-34837407187-1:8081\n', '  reverse_proxy arthello-direct-34837407187-1:8081 {\n    transport http {\n      keepalive off\n    }\n  }\n'))
        for bad in (source + source, source.replace(':8081\n', ':8081 {\n')):
            with self.assertRaises(ValueError): g.render_routes(bad)

    def test_gateway_accepts_http_prefix_existing_block_and_comments(self):
        g = self.module()
        for directive in (
            '  reverse_proxy http://arthello-direct-34837407187-1:8081 # retained comment\n',
            '  reverse_proxy arthello-direct-34837407187-1:8081 {\n    header_up X-Synthetic retained\n  }\n',
            '  reverse_proxy http://arthello-direct-34837407187-1:8081 {\n    transport http {\n      dial_timeout 5s\n    }\n  }\n',
        ):
            source = 'arthello-188-225-38-55.sslip.io {\n' + directive + '}\n'
            result = g.render_routes(source)
            self.assertEqual(result.count('keepalive off'), 1)
            self.assertEqual(result.count('transport http'), 1)
            if 'retained' in source: self.assertIn('retained', result)
            if 'dial_timeout' in source: self.assertIn('dial_timeout 5s', result)
            self.assertEqual(result.count('reverse_proxy'), 1)

    def test_gateway_scopes_repeated_upstream_to_central_host_only(self):
        g = self.module()
        central = g.HOST + ' {\n  reverse_proxy ' + g.UPSTREAM + '\n}\n'
        pay = 'pay.example {\n  handle /api/* {\n    reverse_proxy ' + g.UPSTREAM + '\n  }\n  handle {\n    reverse_proxy ' + g.UPSTREAM + '\n  }\n}\n'
        result = g.render_routes(central + pay)
        self.assertEqual(result, g.render_routes(central) + pay)
        self.assertEqual(result.count('keepalive off'), 1)
        for source in (central + central + pay, central.replace(g.HOST, g.HOST + ',other.example') + pay):
            with self.assertRaises(ValueError): g.render_routes(source)

    def exercise_repair(self, fail_health=False, drift=False):
        from types import SimpleNamespace
        import copy
        g = self.module(); before = self.config(); expected = g.desired_config(before)
        state = {'config': copy.deepcopy(before), 'health': 0, 'writes': 0}
        gateway = 'b' * 64; image = 'sha256:' + 'c' * 64
        main = '/etc/caddy/Caddyfile'; route = '/data/external-routes.caddy'
        original = b'arthello-188-225-38-55.sslip.io {\n reverse_proxy arthello-direct-34837407187-1:8081\n}\n'
        files = {main: b'import /data/external-routes.caddy\n', route: original}
        def adapted(path):
            imported = files[path].decode().strip().split(' ')[1]
            value = expected if b'keepalive off' in files[imported] else before
            if drift and path == main: return {'unexpected': True}
            return copy.deepcopy(value)
        def read(command, **kwargs):
            if command[1] == 'ps': return gateway.encode()
            if command[3] == 'wget': return json.dumps(state['config']).encode()
            if command[3] == 'cat': return files[command[4]]
            if command[3:5] == ['caddy', 'adapt']: return json.dumps(adapted(command[6])).encode()
            raise AssertionError(command)
        def docker(*args, **kwargs):
            args = list(args)
            if args[:2] == ['exec', '-i']:
                path = args[-1]; self.assertNotIn(path, files); files[path] = kwargs['input']; state['writes'] += 1
            elif args[2:4] == ['caddy', 'reload']: state['config'] = adapted(main)
            elif args[2:4] == ['caddy', 'validate']: pass
            elif args[2:4] == ['sh', '-ceu']:
                if args[4].startswith('mv '): files[args[-1]] = files.pop(args[-2])
                elif args[4].startswith('cp -p '): files[args[-1]] = files[args[-3]]
                else: raise AssertionError(args)
            else: raise AssertionError(args)
            return b''
        def health():
            state['health'] += 1
            if fail_health and state['health'] == 1: raise RuntimeError('synthetic health failure')
        inspected = {'State': {'Running': True}, 'Image': image,
                     'Config': {'Cmd': ['caddy', 'run', '--config', main, '--adapter', 'caddyfile']},
                     'Mounts': [{'Type': 'volume', 'Destination': '/data', 'RW': True}]}
        runtime = SimpleNamespace(inspect=lambda _: inspected, docker=docker, public_health=health)
        audit = SimpleNamespace(read_bounded_command=read, GATEWAY_IMAGE=image)
        with tempfile.TemporaryDirectory() as directory, patch.object(g, 'OBSERVED_CONFIG', g.digest(before)):
            work = Path(directory) / 'd194-123-1'; work.mkdir()
            if drift:
                with self.assertRaisesRegex(ValueError, 'GATEWAY_DISK_RUNTIME_DRIFT'):
                    g.repair(runtime, work, '123-1', lambda: None, audit=audit)
                self.assertEqual(state['writes'], 0)
            elif fail_health:
                with self.assertRaisesRegex(RuntimeError, 'synthetic health failure'):
                    g.repair(runtime, work, '123-1', lambda: None, audit=audit)
                self.assertEqual(state['config'], before); self.assertEqual(files[route], original)
                self.assertEqual(json.loads((work / 'gateway-operation.json').read_text())['phase'], 'rolled-back')
            else:
                receipt = g.repair(runtime, work, '123-1', lambda: None, audit=audit)
                self.assertEqual(receipt['phase'], 'verified'); self.assertEqual(state['config'], expected)
                self.assertEqual(files['/data/d257-123-1.before'], original)
                self.assertIn(b'keepalive off', files[route])
                retry = Path(directory) / 'd194-124-1'; retry.mkdir()
                writes = state['writes']
                repeated = g.repair(runtime, retry, '124-1', lambda: None, audit=audit)
                self.assertTrue(repeated['alreadyApplied']); self.assertEqual(state['writes'], writes)

    def test_gateway_durable_apply_and_readback(self):
        self.exercise_repair()

    def test_gateway_health_failure_restores_bytes_and_live_config(self):
        self.exercise_repair(fail_health=True)

    def test_gateway_disk_runtime_drift_prevents_any_write(self):
        self.exercise_repair(drift=True)

if __name__ == '__main__':
    unittest.main()
