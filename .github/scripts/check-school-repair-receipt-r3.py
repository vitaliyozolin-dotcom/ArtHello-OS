"""Verify a sanitized School configuration receipt; never declares browser SSO."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re

SCHOOL_SHA='54242340f2d9b6a9887d69ecc03520ddf9f7982c'
SCHOOL_IMAGE='sha256:664c2c0c3e628a53ca492953803b420e0c4a44acab35eb250f5f899c10bc93df'


def timestamp(value):
    result=datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
    assert result.tzinfo is not None
    return result


def validate(receipt, manifest, expected, now):
    digest=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode('utf-8')).hexdigest()
    assert digest==expected and re.fullmatch('[a-f0-9]{64}',expected)
    assert manifest['school']=={'container':'school-1-11','sourceSha':SCHOOL_SHA,'imageId':SCHOOL_IMAGE,'network':'arthello-os_backend'}
    assert set(receipt)=={'schemaVersion','state','mode','repairConfigSha256','runtimeConfigSha256','schoolSourceSha','schoolImageId','schoolContainerId','relayContainerId','activatedAtUtc','verifiedAtUtc','executionUid','stateDirectorySha256'}
    assert receipt['schemaVersion']==2 and receipt['state']=='verified'
    assert type(receipt['executionUid']) is int and 0 < receipt['executionUid'] < 2**31
    assert receipt['mode'] in ('created','verified-existing')
    assert receipt['repairConfigSha256']==expected
    assert receipt['schoolSourceSha']==SCHOOL_SHA and receipt['schoolImageId']==SCHOOL_IMAGE
    for name in ('runtimeConfigSha256','schoolContainerId','relayContainerId','stateDirectorySha256'):
        assert re.fullmatch('[a-f0-9]{64}',receipt[name])
    assert receipt['schoolContainerId']!=receipt['relayContainerId']
    activated=timestamp(receipt['activatedAtUtc'])
    verified=timestamp(receipt['verifiedAtUtc'])
    assert activated<=verified
    # Allow only small host clock skew; stale receipts cannot approve a run.
    assert -datetime.timedelta(seconds=60)<=now-verified<=datetime.timedelta(minutes=10)
    return receipt


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--manifest',required=True)
    parser.add_argument('--receipt',required=True)
    arguments=parser.parse_args()
    try:
        path=Path(arguments.receipt)
        assert path.is_file() and not path.is_symlink() and path.stat().st_size<=8192
        validate(json.loads(path.read_text()),json.loads(Path(arguments.manifest).read_text()),os.environ['SCHOOL_REPAIR_CONFIG_SHA256'],datetime.datetime.now(datetime.timezone.utc))
    except (AssertionError,KeyError,OSError,TypeError,ValueError):
        raise SystemExit('SCHOOL_R3_REPAIR_RECEIPT=BLOCKED: configuration evidence is absent, stale or mismatched')
    print('SCHOOL_R3_REPAIR_CONFIG=VERIFIED; natural browser SSO remains separate')
