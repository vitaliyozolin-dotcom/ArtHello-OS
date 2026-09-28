import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
import contextlib
import io
import runpy
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('audit',Path(__file__).with_name('alfa_audit.py'))
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)

class CentralSourceTests(unittest.TestCase):
    def test_confirmed_release85_and_current_controller_are_accepted(self):
        audit.verify_central_source('49cea8d5f69d356e16c6aa88ecc8a7e93cef417d','c'*40)
        audit.verify_central_source('c'*40,'c'*40)

    def test_unconfirmed_runtime_never_reaches_bank_audit(self):
        with self.assertRaisesRegex(audit.release.Refused,'CENTRAL_SOURCE'):
            audit.verify_central_source('f'*40,'c'*40)

class SchoolPinTests(unittest.TestCase):
    def probe(self, fingerprint):
        calls=[]
        def run(command, **kwargs):
            calls.append(command)
            if command[0]=='ssh-keyscan': return subprocess.CompletedProcess(command,0,b'fixture ssh-ed25519 synthetic-public-key\n',b'')
            if command[0]=='ssh-keygen': return subprocess.CompletedProcess(command,0,('256 '+fingerprint+' fixture (ED25519)\n').encode(),b'')
            if sum(c[0]=='ssh' for c in calls)==1: return subprocess.CompletedProcess(command,255,b'',b'Host key verification failed.')
            self.assertIn('StrictHostKeyChecking=yes',command)
            known=next(v.split('=',1)[1] for v in command if v.startswith('UserKnownHostsFile='))
            self.assertIn('synthetic-public-key',Path(known).read_text())
            return subprocess.CompletedProcess(command,0,json.dumps({'status':'verified','candidates':[]}).encode(),b'')
        with patch.dict(audit.os.environ,{'DEPLOY_HOST':'fixture.test','DEPLOY_USER':'fixture','DEPLOY_PORT':'2222','SSH_PRIVATE_KEY':'x'*150,'SSH_KNOWN_HOSTS':'fixture old-key-value'},clear=True),patch.object(audit.subprocess,'run',side_effect=run):
            return audit.school_inventory(),calls
    def test_only_previously_pinned_key_allows_authenticated_retry(self):
        result,calls=self.probe(audit.SCHOOL_HOST_PIN)
        self.assertEqual(result['status'],'verified')
        self.assertEqual(sum(c[0]=='ssh' for c in calls),2)
    def test_untrusted_key_never_reaches_second_connection(self):
        result,calls=self.probe('SHA256:not-the-accepted-school-key')
        self.assertEqual(result['reason'],'PINNED_KEY_MISMATCH')
        self.assertEqual(sum(c[0]=='ssh' for c in calls),1)

class StoppedInventoryTests(unittest.TestCase):
    def probe(self, running=False):
        row={'Id':'a'*64,'Image':'sha256:'+'b'*64,
             'State':{'Running':running,'ExitCode':137,'OOMKilled':True,'FinishedAt':'2026-09-26T00:00:00Z','Error':'private-error'},
             'Config':{'WorkingDir':'/app','Env':['DATABASE_PATH=/data/private.sqlite']},
             'HostConfig':{'ReadonlyRootfs':False,'PortBindings':{},'RestartPolicy':{'Name':'on-failure','MaximumRetryCount':5}},
             'Mounts':[{'Destination':'/data','Type':'volume','RW':True,'Name':'private-volume'}],
             'NetworkSettings':{'Networks':{'private-network':{}}}}
        def run(command, **kwargs):
            args=command[1:]
            if args==['ps','-q']: data=('a'*64).encode() if running else b''
            elif args==['ps','-aq']: data=('a'*64).encode()
            elif args[0]=='inspect': data=json.dumps([row]).encode()
            elif args[:2]==['image','inspect']:
                revision='5802a5e6fb6d254f1f67a3776ae0c47d43a68859' if running else '5876accedbdf3758971fdc383f1e0fad8c32a158'
                data=json.dumps([{'Config':{'Labels':{'org.opencontainers.image.revision':revision}}}]).encode()
            else: self.fail('Unexpected Docker operation')
            return subprocess.CompletedProcess(command,0,data,b'')
        output=io.StringIO()
        with patch('subprocess.run',side_effect=run),contextlib.redirect_stdout(output):
            runpy.run_path(str(Path(__file__).with_name('school_inventory.py')))
        return json.loads(output.getvalue()),output.getvalue()

    def test_accepted_successor_is_read_back_as_current_writer(self):
        report,text=self.probe(running=True)
        self.assertEqual(report['status'],'verified')
        self.assertEqual(report['applicationContainerId'],'a'*64)
        self.assertEqual(len(report['candidates']),1)
        self.assertEqual(report['stoppedCandidates'],[])
        self.assertNotIn('private-',text)

    def test_stopped_diagnostics_keep_retry_limit_without_disclosing_names(self):
        report,text=self.probe(); stopped=report['stoppedCandidates'][0]
        self.assertEqual(report['status'],'blocked')
        self.assertIsNone(report['applicationContainerId'])
        self.assertEqual(stopped['restartMaximumRetryCount'],5)
        self.assertTrue(stopped['oomKilled'])
        self.assertTrue(stopped['errorPresent'])
        self.assertTrue(stopped['dataVolumePresent'])
        self.assertNotIn('private-',text)

class RuntimeFailureTests(unittest.TestCase):
    def test_runtime_summary_counts_only_fixed_signals(self):
        container={'State':{'Running':True,'OOMKilled':False,'Error':'PRIVATE'},'RestartCount':2,'Config':{'Env':['PRIVATE']}}
        lines=b'PRIVATE token\nError: Cannot perform I/O on behalf of a different request. PRIVATE\nalfacrm.staged_action_failed\nPRIVATE fetch failed\n'
        result=audit.summarize_runtime_failure(container,lines)
        self.assertEqual(result['restartCount'],2)
        self.assertEqual(result['signals']['crossRequestIo'],1)
        self.assertEqual(result['signals']['alfaActionFailed'],1)
        self.assertEqual(result['signals']['fetchFailed'],1)
        self.assertNotIn('PRIVATE',json.dumps(result))
        self.assertEqual(result['linesRead'],4)

    def test_runtime_log_failure_is_not_an_empty_success(self):
        container={'State':{'Running':True},'RestartCount':0}
        with patch.object(audit.subprocess,'run',return_value=subprocess.CompletedProcess([],1,b'PRIVATE',b'PRIVATE')):
            result=audit.runtime_failure_diagnostics(container,'a'*64)
        self.assertEqual(result['status'],'blocked')
        self.assertEqual(result['reason'],'RUNTIME_LOG_READ_UNCONFIRMED')
        self.assertNotIn('PRIVATE',json.dumps(result))

    def test_stream_join_preserves_real_blank_rows(self):
        container={'State':{'Running':True},'RestartCount':0}
        for stdout,stderr,expected in [(b'one\n\n',b'two\n',3),(b'one\n',b'',1),(b'',b'two\n',1),(b'one',b'two',2)]:
            with patch.object(audit.subprocess,'run',return_value=subprocess.CompletedProcess([],0,stdout,stderr)):
                self.assertEqual(audit.runtime_failure_diagnostics(container,'a'*64)['linesRead'],expected)

    def test_runtime_read_has_fixed_bounded_scope(self):
        container={'State':{'Running':True,'OOMKilled':False},'RestartCount':0}
        with patch.object(audit.subprocess,'run',return_value=subprocess.CompletedProcess([],0,b'',b'')) as run:
            result=audit.runtime_failure_diagnostics(container,'a'*64)
        self.assertEqual(result['status'],'observed')
        self.assertEqual(result['linesRead'],0)
        self.assertEqual(run.call_args.args[0],['docker','logs','--since','2h','--tail','200','a'*64])
        self.assertEqual(run.call_args.kwargs['timeout'],30)


class GatewayFailureTests(unittest.TestCase):
    def test_gateway_summary_counts_fixed_signals_without_private_values(self):
        rows=[
            {'level':'error','logger':'http.log.error','status':502,'msg':'dial tcp PRIVATE: connect: connection refused','request':{'host':'arthello-188-225-38-55.sslip.io','uri':'/api/integrations/alfacrm','headers':{'Cookie':['PRIVATE']}}},
            {'level':'error','status':502,'msg':'PRIVATE unexpected EOF','request':{'host':'arthello-188-225-38-55.sslip.io','uri':'/api/integrations/alfacrm?PRIVATE'}},
            {'level':'error','status':504,'msg':'PRIVATE i/o timeout','request':{'host':'unrelated.test','uri':'/api/integrations/alfacrm'}},
        ]
        report=audit.summarize_gateway_failure(('\n'.join(json.dumps(row) for row in rows)+'\nPRIVATE not JSON').encode())
        self.assertEqual(report['linesRead'],4)
        self.assertEqual(report['centralErrors'],2)
        self.assertEqual(report['alfaErrors'],2)
        self.assertEqual(report['signals']['connectionRefused'],1)
        self.assertEqual(report['signals']['unexpectedEof'],1)
        self.assertEqual(report['signals']['ioTimeout'],0)
        self.assertEqual(report['statuses']['502'],2)
        self.assertNotIn('PRIVATE',json.dumps(report))

    def test_gateway_requires_unique_pinned_image_container(self):
        for raw in (b'',b'a'*64+b'\n'+b'b'*64,b'bad-id'):
            with patch.object(audit.subprocess,'run',return_value=subprocess.CompletedProcess([],0,raw,b'')) as run:
                self.assertEqual(audit.gateway_failure_diagnostics()['status'],'blocked')
                self.assertEqual(run.call_count,1)

    def test_gateway_log_read_is_bounded_and_read_only(self):
        def run(command,**kwargs):
            if command[:2]==['docker','ps']:return subprocess.CompletedProcess(command,0,b'a'*64+b'\n',b'')
            self.assertEqual(command,['docker','logs','--since','2h','--tail','200','a'*64])
            self.assertEqual(kwargs['timeout'],30)
            return subprocess.CompletedProcess(command,0,b'',b'')
        with patch.object(audit.subprocess,'run',side_effect=run):
            self.assertEqual(audit.gateway_failure_diagnostics()['status'],'observed')

    def test_gateway_failure_does_not_publish_command_error(self):
        with patch.object(audit.subprocess,'run',return_value=subprocess.CompletedProcess([],1,b'PRIVATE',b'PRIVATE')):
            report=audit.gateway_failure_diagnostics()
        self.assertEqual(report['status'],'blocked')
        self.assertNotIn('PRIVATE',json.dumps(report))


class GatewayCauseTests(unittest.TestCase):
    def test_alfa_failures_are_not_mixed_with_health_or_other_routes(self):
        rows=[
            {'level':'error','status':502,'msg':'PRIVATE connection reset by peer','ts':1790592642.5,'duration':0.01,'request':{'host':'arthello-188-225-38-55.sslip.io','uri':'/api/integrations/alfacrm?PRIVATE','method':'POST'}},
            {'level':'error','status':502,'msg':'PRIVATE connection refused','request':{'host':'arthello-188-225-38-55.sslip.io','uri':'/api/health','method':'GET'}},
            {'level':'error','status':502,'msg':'EOF','request':{'host':'arthello-origin.internal','uri':'/api/integrations/alfacrm','method':'POST'}},
        ]
        result=audit.summarize_gateway_failure('\n'.join(json.dumps(row) for row in rows).encode())
        self.assertEqual(result['alfa']['signals']['connectionReset'],1)
        self.assertEqual(result['alfa']['signals']['connectionRefused'],0)
        self.assertEqual(result['alfa']['signals']['eof'],1)
        self.assertEqual(result['alfa']['statuses']['502'],2)
        self.assertEqual(result['alfa']['recent'][0]['durationMs'],10)
        self.assertNotIn('PRIVATE',json.dumps(result))

    def test_gateway_config_summary_inherits_host_scope_and_hides_unrelated_config(self):
        config={'apps':{'http':{'servers':{'PRIVATE':{'routes':[
            {'match':[{'host':['arthello-188-225-38-55.sslip.io']}],
             'handle':[{'handler':'subroute','routes':[{'handle':[
                 {'handler':'reverse_proxy','upstreams':[{'dial':'arthello-direct-34837407187-1:8081'}],
                  'transport':{'protocol':'http','keep_alive':{'enabled':False}}}]}]}]},
            {'match':[{'host':['PRIVATE']}],'handle':[{'handler':'reverse_proxy','upstreams':[{'dial':'PRIVATE'}]}]}
        ]}}}}}
        result=audit.summarize_gateway_config(config)
        self.assertEqual(result['status'],'observed')
        self.assertEqual(len(result['centralProxies']),1)
        self.assertEqual(result['centralProxies'][0]['keepAliveEnabled'],False)
        self.assertTrue(result['centralProxies'][0]['exactCentralUpstream'])
        self.assertNotIn('PRIVATE',json.dumps(result))

    def test_omitted_keep_alive_reports_caddy_default_explicitly(self):
        config={'apps':{'http':{'servers':{'server':{'routes':[{
            'match':[{'host':['arthello-188-225-38-55.sslip.io','PRIVATE']}],
            'handle':[{'handler':'reverse_proxy','upstreams':[{'dial':'arthello-direct-34837407187-1:8081'}]}]
        }]}}}}}
        proxy=audit.summarize_gateway_config(config)['centralProxies'][0]
        self.assertEqual(proxy['keepAliveSource'],'caddy-default')
        self.assertEqual(proxy['idleTimeoutNs'],120000000000)
        self.assertFalse(proxy['exclusiveCentralHostScope'])
        self.assertNotIn('PRIVATE',json.dumps(proxy))



    def test_gateway_configuration_read_uses_only_local_admin_get(self):
        def run(command,**kwargs):
            self.assertEqual(kwargs['timeout'],30)
            if command[:2]==['docker','ps']:return subprocess.CompletedProcess(command,0,b'a'*64,b'')
            self.assertEqual(command,['docker','exec','a'*64,'wget','-qO-','http://127.0.0.1:2019/config/'])
            return subprocess.CompletedProcess(command,0,b'{"apps":{"http":{"servers":{}}}}',b'')
        with patch.object(audit.subprocess,'run',side_effect=run):
            self.assertEqual(audit.gateway_config_diagnostics()['status'],'observed')

    def test_configuration_read_failure_does_not_reveal_raw_values(self):
        with patch.object(audit.subprocess,'run',side_effect=OSError('PRIVATE')):
            report=audit.gateway_config_diagnostics()
        self.assertEqual(report['status'],'blocked')
        self.assertNotIn('PRIVATE',json.dumps(report))


if __name__=='__main__':unittest.main()
