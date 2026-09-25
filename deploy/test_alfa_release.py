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


if __name__ == '__main__':
    unittest.main()
