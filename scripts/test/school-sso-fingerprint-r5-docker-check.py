#!/usr/bin/env python3
"""Hosted fixture: compare real Docker inspect results using the R5 controller."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

assert os.environ.get('GITHUB_ACTIONS') == 'true'
assert os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
assert len(sys.argv) == 4
baseline_path, container, phase = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
assert phase in ('before-peer', 'after-peer', 'after-peer-removal')
assert container.startswith('school-r5-fingerprint-')
source = Path('deploy/school/sso-relay-r5/repair.py')
spec = importlib.util.spec_from_file_location('r5_repair', source)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
baseline = json.loads(baseline_path.read_text())[0]
assert baseline['Name'] == '/' + container
assert len(baseline['Mounts']) >= 2
assert all(mount['RW'] is False for mount in baseline['Mounts'])
fingerprint = r.school_fingerprint(baseline)
for _ in range(20):
    result = subprocess.run(['docker', 'container', 'inspect', container], check=True,
                            capture_output=True, text=True, timeout=20)
    current = json.loads(result.stdout)[0]
    assert current['Id'] == baseline['Id']
    assert current['Image'] == baseline['Image']
    assert current['State']['StartedAt'] == baseline['State']['StartedAt']
    assert current['State']['Running'] is True
    assert r.school_fingerprint(current) == fingerprint, 'same container configuration must stay stable'

# Prove deterministically even if this daemon happens to emit a stable order.
permuted = copy.deepcopy(baseline)
permuted['Mounts'].reverse()
assert r.school_fingerprint(permuted) == fingerprint
duplicate = copy.deepcopy(baseline)
duplicate['Mounts'].append(copy.deepcopy(duplicate['Mounts'][0]))
assert r.school_fingerprint(duplicate) != fingerprint
for field, value in [('Source', '/fixture-changed'), ('Destination', '/fixture-changed'),
                     ('RW', True), ('UnknownFutureDockerField', {'value': ['second', 'first']})]:
    changed = copy.deepcopy(baseline)
    changed['Mounts'][0][field] = value
    assert r.school_fingerprint(changed) != fingerprint, field
for key in ('Config', 'HostConfig'):
    changed = copy.deepcopy(baseline)
    changed[key]['UnknownFixtureField'] = ['first', 'second']
    one = r.school_fingerprint(changed)
    changed[key]['UnknownFixtureField'].reverse()
    assert r.school_fingerprint(changed) != one
print('R5_REAL_DOCKER_FINGERPRINT_' + phase.upper().replace('-', '_') + '=PASS')
