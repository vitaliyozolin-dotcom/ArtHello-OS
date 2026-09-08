#!/usr/bin/env python3
"""Fail-closed freshness check. External VM/network isolation remains mandatory."""
import json
import os
from pathlib import Path
import re
import socket
import stat
import time

STAMP = Path('/opt/arthello-builder/ready.json')
PRODUCTION_IPS = {'188.225.38.55', '188.225.47.207'}

def validate_ready(record, *, boot_id, hostname, runner_name, now, source_sha, source_tree, controller_sha):
    if record.get('schemaVersion') != 1:
        raise ValueError('unsupported readiness schema')
    if record.get('repository') != 'vitaliyozolin-dotcom/ArtHello-OS':
        raise ValueError('wrong repository')
    if record.get('runnerLabel') != 'arthello-build-only-linux-x64':
        raise ValueError('wrong runner label')
    if record.get('bootId') != boot_id or record.get('hostname') != hostname:
        raise ValueError('readiness belongs to another VM boot')
    if record.get('runnerName') != runner_name:
        raise ValueError('runner identity mismatch')
    if not re.fullmatch(r'[a-f0-9]{40}', controller_sha or '') or record.get('controllerSha') != controller_sha:
        raise ValueError('controller is not the externally approved main commit')
    if not re.fullmatch(r'[a-f0-9]{40}', source_sha or '') or record.get('sourceSha') != source_sha:
        raise ValueError('candidate is not the externally approved commit')
    if not re.fullmatch(r'[a-f0-9]{40}', source_tree or '') or record.get('sourceTree') != source_tree:
        raise ValueError('candidate tree is not the externally approved tree')
    if not isinstance(record.get('createdAt'), int) or not isinstance(record.get('expiresAt'), int):
        raise ValueError('invalid readiness timestamps')
    if not (record['createdAt'] <= now < record['expiresAt'] <= record['createdAt'] + 4 * 3600):
        raise ValueError('readiness expired or lifetime exceeds four hours')
    if record.get('ephemeral') is not True or record.get('productionCapability') is not False:
        raise ValueError('invalid machine capability declaration')
    if not isinstance(record.get('addresses'), list) or not record['addresses']:
        raise ValueError('missing host addresses')
    if PRODUCTION_IPS.intersection(record['addresses']):
        raise ValueError('known production address is forbidden')
    for field in ['providerInstanceId', 'networkPolicyRef', 'externalExpiryRef', 'baseImageRef']:
        if not isinstance(record.get(field), str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9:._/@-]{2,255}', record[field]):
            raise ValueError('missing external provisioning reference: ' + field)
    return True

def main():
    info = STAMP.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o644:
        raise ValueError('readiness stamp must be a root-owned regular file mode 0644')
    validate_ready(json.loads(STAMP.read_text()), boot_id=Path('/proc/sys/kernel/random/boot_id').read_text().strip(), hostname=socket.gethostname(), runner_name=os.environ.get('RUNNER_NAME'), now=int(time.time()), source_sha=os.environ.get('EXPECTED_SOURCE_SHA'), source_tree=os.environ.get('EXPECTED_SOURCE_TREE'), controller_sha=os.environ.get('GITHUB_SHA'))
    print('ARTHELLO_BUILD_VM_FRESHNESS=VERIFIED')

if __name__ == '__main__':
    main()
