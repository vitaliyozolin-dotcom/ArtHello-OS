#!/usr/bin/env python3
"""Focused R18 tests for Atlas's extra retained R17 consumer."""
import copy
from contextlib import redirect_stderr
import hashlib
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('r18_controller_test', HERE / 'r18-backup-controller.py')
controller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controller)
REFUSED = controller.r7.Refused


def app(identity, name, image, release, running=False):
    return {
        'Id': identity, 'Name': '/' + name, 'Image': image,
        'Config': {'Labels': {'arthello.release.sha': release}},
        'State': {'Running': running, 'Paused': False, 'Restarting': False, 'Dead': False},
        'Mounts': [{'Type': 'volume', 'Name': controller.r7.SOURCE_VOLUME,
                    'Destination': '/data', 'RW': True}],
        'HostConfig': {'RestartPolicy': {
            'Name': 'unless-stopped' if running else 'no', 'MaximumRetryCount': 0}},
    }


class Docker:
    def __init__(self, objects, consumers=()):
        self.objects = objects
        self.consumers = set(consumers)

    def inspect(self, kind, name, missing=False):
        value = self.objects.get((kind, name))
        if value is None and kind == 'container':
            value = next((item for (item_kind, _), item in self.objects.items()
                          if item_kind == kind and item.get('Id') == name), None)
        if value is None and not missing:
            raise REFUSED('INSPECT_FAILED')
        return copy.deepcopy(value)

    def command(self, arguments, timeout=30):
        if arguments != ['container', 'ls', '--all', '--quiet', '--no-trunc', '--filter',
                         'volume=' + controller.r7.SOURCE_VOLUME]:
            raise AssertionError(arguments)
        return '\n'.join(sorted(self.consumers))


class AtlasPredecessorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path.home())
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        root = self.home
        for part in ('.config', 'arthello', 'release-state'):
            root /= part
            root.mkdir(mode=0o700)
        self.root = root
        self.home_patch = patch.object(controller.Path, 'home', return_value=self.home)
        self.home_patch.start()
        self.addCleanup(self.home_patch.stop)
        a = controller.adoption
        self.context = {
            'releaseSha': a.LIVE_SHA, 'sourceTree': a.LIVE_TREE,
            'runId': a.LIVE_STATE_RUN, 'runAttempt': '1',
            'candidateContainerId': a.LIVE_STATE_APP_ID,
            'candidateName': 'arthello-direct-' + a.LIVE_STATE_RUN + '-1',
            'imageId': a.LIVE_IMAGE, 'dataVolume': controller.r7.SOURCE_VOLUME,
            'previousContainerId': a.HISTORICAL_APP_ID,
            'previousName': 'arthello-direct-' + a.HISTORICAL_RUN + '-1',
        }
        digest = hashlib.sha256((json.dumps(self.context, sort_keys=True, separators=(',', ':')) + '\n').encode()).hexdigest()
        self.receipt = {'schemaVersion': 1, 'phase': 'public-started',
                        'context': self.context, 'contextSha256': digest}
        receipt = self.root / ('candidate-acceptance-' + a.LIVE_SHA + '.json')
        receipt.write_text(json.dumps(self.receipt))
        receipt.chmod(0o600)
        self.digest_patch = patch.object(controller, 'LIVE_CONTEXT_SHA256', digest)
        self.digest_patch.start()
        self.addCleanup(self.digest_patch.stop)
        retained = app(a.LIVE_STATE_APP_ID, self.context['candidateName'], a.LIVE_IMAGE, a.LIVE_SHA)
        predecessor = app(a.HISTORICAL_APP_ID, self.context['previousName'], a.HISTORICAL_IMAGE, a.HISTORICAL_SHA)
        self.objects = {
            ('container', self.context['candidateName']): retained,
            ('container', self.context['previousName']): predecessor,
            ('image', a.LIVE_IMAGE): {'Id': a.LIVE_IMAGE, 'Config': {'Labels': {'org.opencontainers.image.revision': a.LIVE_SHA}}},
            ('image', a.HISTORICAL_IMAGE): {'Id': a.HISTORICAL_IMAGE, 'Config': {'Labels': {'org.opencontainers.image.revision': a.HISTORICAL_SHA}}},
        }

    def test_r17_receipt_proves_both_retained_candidate_and_predecessor(self):
        docker = Docker(self.objects)
        self.assertEqual(controller.retained_live_candidate(docker), controller.adoption.LIVE_STATE_APP_ID)
        self.assertEqual(controller.accepted_live_predecessor(docker), controller.adoption.HISTORICAL_APP_ID)

    def test_stopped_retained_candidate_state_drift_is_refused(self):
        changed = copy.deepcopy(self.objects)
        changed[('container', self.context['candidateName'])]['State']['Running'] = True
        with self.assertRaises(REFUSED):
            controller.retained_live_candidate(Docker(changed))

    def test_exact_five_historical_consumers_complete_the_chain(self):
        a = controller.adoption
        current = app(a.LIVE_APP_ID, 'arthello-direct-' + a.LIVE_RUN + '-1', a.LIVE_IMAGE, a.LIVE_SHA, True)
        objects = {('container', current['Name'][1:]): current}
        fifth = '6' * 64
        historical = [a.LIVE_STATE_APP_ID, a.HISTORICAL_APP_ID, a.OLDER_APP_ID, a.ACCEPTED_APP_ID, fifth]
        docker = Docker(objects, [a.LIVE_APP_ID, a.ACCEPTED_WORKER_ID, *historical])
        args = SimpleNamespace(run_id='40000000001', attempt='1', image_id='sha256:' + 'a' * 64,
                               release_sha='b' * 40, tree_sha='c' * 40)
        with patch.object(a, 'Adoption', return_value=None), \
             patch.object(controller, 'retained_live_candidate', return_value=historical[0]), \
             patch.object(controller, 'accepted_live_predecessor', return_value=historical[1]), \
             patch.object(controller.historical, 'accepted_live_predecessor', return_value=historical[2]), \
             patch.object(controller.historical.historical, 'accepted_live_predecessor', return_value=historical[3]), \
             patch.object(controller.historical.historical, 'historical_predecessor', return_value=fifth):
            self.assertEqual(controller.canonical_consumers(args, docker, 'live'), set(docker.consumers))

    def test_sixth_unproved_historical_consumer_is_refused(self):
        a = controller.adoption
        current = app(a.LIVE_APP_ID, 'arthello-direct-' + a.LIVE_RUN + '-1', a.LIVE_IMAGE, a.LIVE_SHA, True)
        docker = Docker({('container', current['Name'][1:]): current},
                        [a.LIVE_APP_ID, a.ACCEPTED_WORKER_ID, *[str(number) * 64 for number in range(1, 7)]])
        args = SimpleNamespace(run_id='40000000001', attempt='1', image_id='sha256:' + 'a' * 64,
                               release_sha='b' * 40, tree_sha='c' * 40)
        with patch.object(a, 'Adoption', return_value=None), self.assertRaises(REFUSED):
            controller.canonical_consumers(args, docker, 'live')

    def test_cli_emits_only_fixed_refusal_code_to_stderr(self):
        arguments = ['consumers', '--image-id', 'image', '--release-sha', 'release',
                     '--tree-sha', 'tree', '--run-id', 'run', '--attempt', '1', '--phase', 'live']
        output = io.StringIO()
        with patch.object(controller, 'execute', side_effect=REFUSED('RETAINED_R17_PROOF_FAILED')), redirect_stderr(output):
            self.assertEqual(controller.main(arguments), 1)
        self.assertEqual(json.loads(output.getvalue()),
                         {'state': 'refused', 'code': 'RETAINED_R17_PROOF_FAILED'})
        output = io.StringIO()
        with patch.object(controller, 'execute', side_effect=ValueError('private detail')), redirect_stderr(output):
            self.assertEqual(controller.main(arguments), 1)
        self.assertEqual(json.loads(output.getvalue()),
                         {'state': 'refused', 'code': 'R14_CONTROLLER_CHECK_FAILED'})


if __name__ == '__main__':
    unittest.main()
