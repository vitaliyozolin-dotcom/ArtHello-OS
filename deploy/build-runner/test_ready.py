#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('ready', Path(__file__).with_name('check-ready.py'))
ready = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ready)

class FreshnessTest(unittest.TestCase):
    def setUp(self):
        self.record = {'schemaVersion': 1, 'repository': 'vitaliyozolin-dotcom/ArtHello-OS', 'runnerLabel': 'arthello-build-only-linux-x64', 'bootId': 'boot-1', 'hostname': 'build-1', 'runnerName': 'arthello-build-fixture', 'sourceSha': 'a'*40, 'sourceTree': 'b'*40, 'controllerSha': 'd'*40, 'createdAt': 1000, 'expiresAt': 2000, 'ephemeral': True, 'productionCapability': False, 'addresses': ['192.0.2.10'], 'providerInstanceId': 'fixture-vm-1', 'networkPolicyRef': 'fixture-network-1', 'externalExpiryRef': 'fixture-expiry-1', 'baseImageRef': 'fixture-image-1'}
        self.facts = {'boot_id': 'boot-1', 'hostname': 'build-1', 'runner_name': 'arthello-build-fixture', 'now': 1500, 'source_sha': 'a'*40, 'source_tree': 'b'*40, 'controller_sha': 'd'*40}

    def test_exact_fresh_approved_machine(self):
        self.assertTrue(ready.validate_ready(self.record, **self.facts))

    def test_wrong_candidate_fails(self):
        for key in ['source_sha', 'source_tree', 'controller_sha']:
            with self.subTest(key=key), self.assertRaises(ValueError):
                ready.validate_ready(self.record, **dict(self.facts, **{key: 'c'*40}))

    def test_wrong_vm_boot_or_runner_fails(self):
        for key in ['boot_id', 'hostname', 'runner_name']:
            with self.subTest(key=key), self.assertRaises(ValueError):
                ready.validate_ready(self.record, **dict(self.facts, **{key: 'other'}))

    def test_expired_and_future_stamp_fail(self):
        for now in [999, 2000, 2001]:
            with self.subTest(now=now), self.assertRaises(ValueError):
                ready.validate_ready(self.record, **dict(self.facts, now=now))

    def test_known_production_addresses_fail(self):
        for address in ready.PRODUCTION_IPS:
            with self.subTest(address=address), self.assertRaises(ValueError):
                ready.validate_ready(dict(self.record, addresses=[address]), **self.facts)

    def test_no_external_isolation_reference_fails(self):
        for field in ['providerInstanceId', 'networkPolicyRef', 'externalExpiryRef', 'baseImageRef']:
            with self.subTest(field=field), self.assertRaises(ValueError):
                ready.validate_ready(dict(self.record, **{field: ''}), **self.facts)

    def test_reusable_or_production_vm_fails(self):
        for patch in [{'ephemeral': False}, {'productionCapability': True}, {'expiresAt': 16000}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                ready.validate_ready(dict(self.record, **patch), **self.facts)

if __name__ == '__main__':
    unittest.main()
