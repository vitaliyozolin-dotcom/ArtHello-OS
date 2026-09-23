import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('school',ROOT/'deploy/school_release.py')
school=importlib.util.module_from_spec(spec);spec.loader.exec_module(school)
fixture_spec=importlib.util.spec_from_file_location('fixture',ROOT/'deploy/test_alfa_release.py')
fixture=importlib.util.module_from_spec(fixture_spec);fixture_spec.loader.exec_module(fixture)

def runtime():
    old=fixture.runtime();old['Name']='/existing-school'
    old['Config'].update(Env=['DATABASE_PATH=/data/school-1-11.sqlite','CENTRAL_ACCESS_SECRET=synthetic-value'],User='1001',WorkingDir='/app',Entrypoint=['docker-entrypoint.sh'],Cmd=['node','server.js'])
    old['HostConfig'].update(ReadonlyRootfs=False,Tmpfs={},PortBindings={'3000/tcp':[{'HostIp':'127.0.0.1','HostPort':'3210'}]})
    old['Mounts']=[{'Type':'volume','Name':'existing-school-data','Destination':'/data','RW':True},{'Type':'volume','Name':'existing-school-backups','Destination':'/backups','RW':True}]
    return old

class SchoolDeliveryTests(unittest.TestCase):
    def test_inventory_recognizes_the_exact_live_predecessor_source(self):
        inventory = (ROOT/'deploy/school_inventory.py').read_text()
        self.assertIn(repr(school.release.PINS['school'][0]), inventory)

    def test_exact_ports_environment_commands_and_volumes_are_retained(self):
        old=runtime();plan=school.release.runtime_plan(old,'school','sha256:'+'e'*64,'f'*40,'9'*40)
        self.assertEqual(plan['environment'],old['Config']['Env'])
        self.assertEqual(plan['command'],['node','server.js'])
        self.assertEqual(plan['dataVolume'],'existing-school-data')
        self.assertIn('127.0.0.1:3210:3000/tcp',plan['args'])
        self.assertIn('type=volume,src=existing-school-backups,dst=/backups,volume-nocopy',plan['mounts'])

    def test_relay_and_wrong_database_cannot_be_selected_as_application(self):
        for mutate in (lambda v:v['Config'].update(WorkingDir='/relay'),lambda v:v.update(Mounts=[]),
                       lambda v:v['Config'].update(Env=['DATABASE_PATH=/data/atlas-school.sqlite']),
                       lambda v:v['NetworkSettings']['Networks'].update(other={}),
                       lambda v:v['HostConfig'].update(PortBindings={'8081/tcp':[{'HostIp':'','HostPort':'80'}]})):
            old=runtime();mutate(old)
            with self.assertRaises(school.release.Refused):school.release.runtime_plan(old,'school','sha256:'+'e'*64,'f'*40,'9'*40)

    def test_corrupt_delivery_never_executes_remote_release(self):
        code=school.receiver_code('a'*40,'123-1',456,'b'*64,3)
        with tempfile.TemporaryDirectory() as temporary:
            code=code.replace("pathlib.Path.home()",'pathlib.Path('+repr(temporary)+')')
            completed=subprocess.run([sys.executable,'-c',code],input=b'bad',capture_output=True)
            self.assertNotEqual(completed.returncode,0)
            self.assertFalse((Path(temporary)/'.config/arthello/release-state/d197-123-1/deploy').exists())

    def test_school_upgrade_creates_school_backup_not_atlas_backup(self):
        old=runtime();plan=school.release.runtime_plan(old,'school','sha256:'+'e'*64,'f'*40,'9'*40);calls=[]
        def docker(*args,**kwargs):
            calls.append(args)
            if args[:2]==('run','--rm'):raise school.release.Refused('BACKUP_FAILED')
            return b''
        def inspect(_):
            item=json.loads(json.dumps(old));item['State']['Running']=not any(a[0]=='stop' for a in calls);return item
        with tempfile.TemporaryDirectory() as temporary,patch.object(school.release,'docker',docker),patch.object(school.release,'inspect',inspect):
            with self.assertRaises(school.release.Refused):school.release.upgrade(old,plan,Path(temporary),'123-1',lambda:None)
            self.assertFalse((Path(temporary)/'school.env').exists())
        self.assertIn(('volume','create','--label','arthello.scope=production-backup','arthello-d194-school-123-1'),calls)
        self.assertTrue(any('SNAPSHOT_SYSTEM=school' in c for c in calls))
        self.assertIn(('start',old['Id']),calls)

if __name__=='__main__':unittest.main()
