import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest import mock

def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

d = module('diagnostic', 'school-r4-fingerprint-diagnostic.py')
h = module('health', 'school-r4-public-health-diagnostic.py')

def fixture():
    school = {'Id': 'a'*64, 'Image': d.SCHOOL_IMAGE, 'Name': '/'+d.SCHOOL,
              'Config': {'Env': ['SECRET=never-output-value'], 'Labels': {'private-label': 'never-output-label', 'school.candidate-sha': d.SCHOOL_SHA}},
              'HostConfig': {'NetworkMode': d.BACKEND, 'Binds': ['/private-path:/data']},
              'Mounts': [{'Source': '/secret-one', 'Destination': '/data', 'RW': True}, {'Source': '/secret-two', 'Destination': '/cache', 'RW': False}],
              'NetworkSettings': {'Networks': {d.BACKEND: {'NetworkID': 'b'*64, 'IPAddress': '192.0.2.10', 'GlobalIPv6Address': '', 'Aliases': ['private-alias']}}},
              'State': {'Running': True, 'Health': {'Status': 'healthy'}, 'StartedAt': d.SCHOOL_STARTED}}
    backend = {'Id': 'b'*64, 'Name': d.BACKEND, 'Driver': 'bridge', 'Internal': True, 'EnableIPv6': False,
               'IPAM': {'Config': [{'Subnet': '192.0.2.0/24'}]}, 'Options': {}, 'Labels': {'private': 'never-output-label'}, 'Containers': {}}
    return school, backend

class FingerprintTests(unittest.TestCase):
    def test_exact_fingerprints_match_existing_controller_algorithm(self):
        school, backend = fixture()
        old = {key: school[key] for key in ('Id','Image','Config','HostConfig','Mounts')} | {'networks': {name: {key: endpoint.get(key) for key in ('NetworkID','IPAddress','GlobalIPv6Address','Aliases')} for name, endpoint in school['NetworkSettings']['Networks'].items()}}
        expected = hashlib.sha256(json.dumps(old, sort_keys=True, separators=(',',':')).encode()).hexdigest()
        self.assertEqual(d.fingerprint_record(school, backend)['schoolExactSha256'], expected)

    def test_mount_permutation_explains_exact_change_without_erasing_content(self):
        school, backend = fixture(); changed = copy.deepcopy(school); changed['Mounts'].reverse()
        result = d.compare_samples(school, backend, changed, backend)
        self.assertTrue(result['schoolExactChanged'])
        self.assertTrue(result['schoolChangeExplainedOnlyByMountOrder'])
        self.assertEqual(result['changedFieldPaths'], ['School.Mounts.order'])
        changed['Mounts'][0]['RW'] = True
        self.assertTrue(d.compare_samples(school, backend, changed, backend)['normalizedSchoolChanged'])

    def test_mount_duplicates_and_source_changes_are_genuine_changes(self):
        school, backend = fixture()
        for change in ('duplicate', 'source'):
            changed = copy.deepcopy(school)
            if change == 'duplicate': changed['Mounts'].append(copy.deepcopy(changed['Mounts'][0]))
            else: changed['Mounts'][0]['Source'] = '/other-secret-path'
            result = d.compare_samples(school, backend, changed, backend)
            self.assertTrue(result['normalizedSchoolChanged'])
            self.assertFalse(result['schoolChangeExplainedOnlyByMountOrder'])
            self.assertNotIn('secret', json.dumps(result))

    def test_env_host_network_changes_cannot_be_hidden_by_mount_sort(self):
        school, backend = fixture(); changed = copy.deepcopy(school); net = copy.deepcopy(backend)
        changed['Config']['Env'] = ['SECRET=new-never-output-value']
        changed['Config']['private-unknown-key'] = 'sensitive'
        changed['HostConfig']['Binds'] = ['/other-private-path:/data']
        changed['NetworkSettings']['Networks'][d.BACKEND]['Aliases'].reverse()
        net['Internal'] = False
        result = d.compare_samples(school, backend, changed, net)
        self.assertTrue(result['normalizedSchoolChanged']); self.assertTrue(result['backendExactChanged'])
        self.assertIn('School.Config.Env',result['changedFieldPaths'])
        self.assertIn('School.Config.<other>',result['changedFieldPaths'])
        combined=json.dumps(result)+json.dumps(d.fingerprint_record(changed,net))
        for forbidden in ('SECRET','never-output','private-unknown-key','sensitive','/data','192.0.2','private-alias'):
            self.assertNotIn(forbidden,combined)

    def test_twelve_samples_only_inspect_fixed_targets_and_bound_waits(self):
        school,backend=fixture();calls=[]
        def inspect(command):
            calls.append(command);item=copy.deepcopy(school if command[-1]==d.SCHOOL else backend)
            if command[-1]==d.SCHOOL and len(calls)%4==3:item['Mounts'].reverse()
            return item,None
        with mock.patch.object(d,'docker_command',side_effect=inspect),mock.patch.object(d.time,'sleep') as sleep:
            result=d.sample_fingerprints()
        self.assertEqual(len(calls),24);self.assertEqual(len(result['samples']),12);self.assertTrue(result['complete'])
        self.assertEqual(sleep.call_count,11)
        self.assertEqual({tuple(command) for command in calls},{('docker','container','inspect',d.SCHOOL),('docker','network','inspect',d.BACKEND)})
        self.assertTrue(any(item.get('changeFromPrevious',{}).get('schoolChangeExplainedOnlyByMountOrder') for item in result['samples']))

    def test_failed_sample_resets_comparison_and_never_reports_complete(self):
        with mock.patch.object(d,'docker_command',return_value=(None,'docker_read_unavailable')),mock.patch.object(d.time,'sleep'):
            result=d.sample_fingerprints()
        self.assertFalse(result['complete']);self.assertTrue(all('changeFromPrevious' not in item for item in result['samples']))

    def test_network_absence_variant_is_exact_and_stderr_never_exposed(self):
        for message,expected in [(f'Error response from daemon: network {d.EGRESS} not found','object_missing'),('permission denied at secret-socket','docker_read_unavailable')]:
            with mock.patch.object(d.subprocess,'run',return_value=types.SimpleNamespace(returncode=1,stdout='',stderr=message)):
                value,error=d.docker_command(['docker','network','inspect',d.EGRESS])
            self.assertIsNone(value);self.assertEqual(error,expected)

    def test_health_output_is_fixed_allowlisted_and_redirects_not_followed(self):
        class Response:
            status=200
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return json.dumps({'status':'ok','database':'available','releaseSha':'c'*40,'secret':'never-output'}).encode()
        opener=mock.Mock();opener.open.return_value=Response()
        with mock.patch.object(h.urllib.request,'build_opener',return_value=opener):result=h.observe_health()
        self.assertEqual(opener.open.call_count,2)
        self.assertEqual({call.args[0].full_url for call in opener.open.call_args_list},{url for _,url in h.ENDPOINTS})
        self.assertTrue(all(call.kwargs['timeout']==15 for call in opener.open.call_args_list))
        self.assertNotIn('secret',json.dumps(result));self.assertEqual(h.NoRedirect().redirect_request(None,None,302,None,None,'https://secret'),None)

if __name__ == '__main__':unittest.main()
