"""Narrow School SSH transport: unpack an exact reviewed bundle, then execute it.

The controller runs only after exact current-main Quality/Proof/Verify gates.
This bootstrap carries no application/build operation and never accepts a path
or command from the transport envelope.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

FILES = {'manifest.json', 'repair.py', 'relay.mjs', 'healthcheck.mjs'}
ENVIRONMENTS = {
    'RELEASE_SHA': r'[a-f0-9]{40}',
    'RELEASE_RUN_ID': r'[1-9][0-9]{0,19}',
    'RELEASE_ATTEMPT': r'[1-9][0-9]{0,2}',
    'EXPECTED_REPAIR_CONFIG_SHA256': r'[a-f0-9]{64}',
    'EXPECTED_REPAIR_BUNDLE_SHA256': r'[a-f0-9]{64}',
}


def validated_environment():
    result = {}
    for name, pattern in ENVIRONMENTS.items():
        value = os.environ.get(name, '')
        if not re.fullmatch(pattern, value):
            raise ValueError('Invalid protected repair identity')
        result[name] = value
    return result


def decode_bundle(raw, expected_digest):
    if not 0 < len(raw) <= 1_048_576 or hashlib.sha256(raw).hexdigest() != expected_digest:
        raise ValueError('Repair bundle transport digest mismatch')
    envelope = json.loads(raw)
    if set(envelope) != {'schemaVersion', 'files'} or envelope['schemaVersion'] != 1:
        raise ValueError('Invalid repair bundle envelope')
    files = envelope['files']
    if not isinstance(files, dict) or set(files) != FILES:
        raise ValueError('Only exact School relay bundle files are allowed')
    decoded = {}
    for name, encoded in files.items():
        data = base64.b64decode(encoded, validate=True)
        if not 0 < len(data) <= 262_144:
            raise ValueError('Invalid repair bundle file size')
        decoded[name] = data
    return decoded


def main():
    protected = validated_environment()
    # Elevate the small reviewed bootstrap before it reads stdin or creates any
    # file. Only these nonsecret release identities survive sudo environment reset.
    if os.geteuid() != 0:
        bootstrap = os.environ.get('R2_BOOTSTRAP_BASE64', '')
        source = base64.b64decode(bootstrap, validate=True).decode('utf-8')
        if not source or len(source) > 32_768:
            raise ValueError('Missing reviewed bootstrap for root execution')
        command = ['sudo', '-n', 'env', *[f'{name}={value}' for name, value in protected.items()],
                   sys.executable, '-I', '-c', source]
        os.execvp(command[0], command)
    raw = sys.stdin.buffer.read(1_048_577)
    decoded = decode_bundle(raw, protected['EXPECTED_REPAIR_BUNDLE_SHA256'])
    work = Path(tempfile.mkdtemp(prefix='arthello-school-r2-'))
    os.chmod(work, 0o700)
    try:
        for name, data in decoded.items():
            target = work / name
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        environment = dict(os.environ, **protected, REPAIR_BUNDLE_DIR=str(work))
        environment.pop('R2_BOOTSTRAP_BASE64', None)
        result = subprocess.run([sys.executable, '-I', str(work / 'repair.py')], env=environment,
                                stdin=subprocess.DEVNULL, timeout=600)
        if result.returncode:
            raise SystemExit(result.returncode)
    finally:
        # mkdtemp generated this path, and only our fixed filenames were written.
        shutil.rmtree(work)


if __name__ == '__main__':
    main()
