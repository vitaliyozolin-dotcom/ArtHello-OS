#!/usr/bin/env python3
"""Read-only delivery of D193 verification artifacts for protected D194 release."""
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import time
import zipfile
import shutil

helper_path = Path(__file__).resolve().parents[1] / '.github/scripts/download-v52-artifact-d182.py'
spec = importlib.util.spec_from_file_location('bounded_github_download', helper_path)
bounded = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bounded)
require = bounded.require
REPOSITORY = bounded.REPOSITORY
MAX_BYTES = bounded.MAX_BYTES


def verify_run(run, source, workflow):
    bounded.exact_fields(run, {'head_sha': source, 'head_branch': 'main', 'run_attempt': 1,
                             'event': 'push', 'status': 'completed', 'conclusion': 'success',
                             'path': '.github/workflows/' + workflow + '.yml'}, 'PRODUCER_IDENTITY')
    for key in ('repository', 'head_repository'):
        bounded.exact_fields(run.get(key), {'full_name': REPOSITORY, 'id': bounded.REPOSITORY_ID}, 'REPOSITORY')
    for key in ('actor', 'triggering_actor'):
        bounded.exact_fields(run.get(key), {'login': bounded.OWNER}, 'OWNER')


def artifact_inventory(listing, run_id, source, now):
    names = {'arthello-v52-verification-' + str(run_id), 'finance-browser-' + str(run_id) + '-1',
             'diary-directory-atlas-' + str(run_id), 'diary-directory-school-' + str(run_id)}
    rows = listing.get('artifacts', [])
    require(listing.get('total_count') == len(rows) == 4 and {r.get('name') for r in rows} == names, 'ARTIFACT_INVENTORY')
    require(len({r.get('id') for r in rows}) == 4, 'ARTIFACT_IDENTITY')
    for row in rows:
        require(type(row.get('id')) is int and row['id'] > 0 and row.get('expired') is False, 'ARTIFACT_IDENTITY')
        require(type(row.get('size_in_bytes')) is int and 0 < row['size_in_bytes'] <= MAX_BYTES, 'ARTIFACT_SIZE')
        require(isinstance(row.get('digest'), str) and re.fullmatch(r'sha256:[a-f0-9]{64}', row['digest']), 'ARTIFACT_DIGEST')
        expiry = datetime.fromisoformat(row['expires_at'].replace('Z', '+00:00'))
        require(expiry.utcoffset() is not None and expiry > now, 'ARTIFACT_EXPIRED')
        bounded.exact_fields(row.get('workflow_run'), {'id': run_id, 'head_sha': source, 'head_branch': 'main',
                            'repository_id': bounded.REPOSITORY_ID, 'head_repository_id': bounded.REPOSITORY_ID}, 'ARTIFACT_PRODUCER')
    return {r['name']: r for r in rows}


def extract(archive, target, size, members):
    with zipfile.ZipFile(archive) as zipped:
        entries = zipped.infolist()
        require(len(entries) == len(members) and {e.filename for e in entries} == set(members), 'ARCHIVE_MEMBERS')
        require(sum(e.file_size for e in entries) <= min(MAX_BYTES, size * 4 + 1024 * 1024), 'ARCHIVE_EXPANSION')
        for entry in entries:
            require(not entry.is_dir() and stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG)
                    and not entry.flag_bits & 1 and entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                    and 0 < entry.file_size <= members[entry.filename], 'ARCHIVE_MEMBER_TYPE')
        require(zipped.testzip() is None, 'ARCHIVE_CRC')
        for entry in entries:
            with zipped.open(entry) as source, (target / entry.filename).open('xb') as output:
                shutil.copyfileobj(source, output, 1024 * 1024)


def download(source, directory, system):
    require(system in ('central', 'atlas', 'school'), 'SYSTEM')
    client = bounded.GitHub(os.environ.get('GH_TOKEN'))
    bounded.exact_fields(client.json('/git/ref/heads/main').get('object'), {'type': 'commit', 'sha': source}, 'MAIN_MOVED')
    evidence = {}
    for workflow in ('quality', 'proof-gates', 'verify-arthello-v52'):
        runs = client.json('/actions/workflows/' + workflow + '.yml/runs?head_sha=' + source + '&event=push&per_page=100')
        require(runs.get('total_count') == len(runs.get('workflow_runs', [])) == 1, 'RUN_AMBIGUOUS')
        run = runs['workflow_runs'][0]
        verify_run(run, source, workflow)
        evidence[workflow] = run['id']
    run_id = evidence['verify-arthello-v52']
    inventory = artifact_inventory(client.json('/actions/runs/' + str(run_id) + '/artifacts?per_page=100'),
                                   run_id, source, datetime.now(timezone.utc))
    directory.mkdir(mode=0o700, exist_ok=False)
    for system in (system,):
        name = ('arthello-v52-verification-' if system == 'central' else 'diary-directory-' + system + '-') + str(run_id)
        artifact = inventory[name]
        target = directory / system
        target.mkdir(mode=0o700)
        archive = target / 'artifact.zip'
        with client.stream(artifact) as incoming, archive.open('xb') as output:
            bounded.copy_verified(incoming, output, artifact['size_in_bytes'], artifact['digest'][7:], deadline=time.monotonic() + 25 * 60)
        members = bounded.MEMBERS if system == 'central' else {'image.tar.gz': MAX_BYTES, 'receipt.json': 128 * 1024, 'checksums.sha256': 1024}
        extract(archive, target, artifact['size_in_bytes'], members)
        archive.unlink()
    bounded.exact_fields(client.json('/git/ref/heads/main').get('object'), {'type': 'commit', 'sha': source}, 'MAIN_MOVED')
    (directory / 'verification-runs.json').write_text(json.dumps(evidence))
    return evidence
