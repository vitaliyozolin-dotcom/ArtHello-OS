#!/usr/bin/env python3
"""Fetch exact V52 app from its reviewed app-plus-finance-proof inventory; never import an image."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPOSITORY = 'vitaliyozolin-dotcom/ArtHello-OS'
REPOSITORY_ID = 1311964413
OWNER = 'vitaliyozolin-dotcom'
API = 'https://api.github.com/repos/' + REPOSITORY
MAX_BYTES = 2 * 1024 ** 3
MEMBERS = {'arthello-v52.json': 128 * 1024,
           'arthello-v52.json.sha256': 256,
           'arthello-v52-image.tar.gz': MAX_BYTES}


class Refused(ValueError):
    pass


def require(value, code):
    if not value:
        raise Refused(code)


def exact_fields(value, expected, code):
    require(isinstance(value, dict), code)
    for key, item in expected.items():
        require(type(value.get(key)) is type(item) and value[key] == item, code)


def metadata(run, listing, main_ref, source, run_id, now):
    exact_fields(main_ref, {'ref': 'refs/heads/main'}, 'MAIN_IDENTITY')
    exact_fields(main_ref.get('object'), {'type': 'commit', 'sha': source}, 'MAIN_MOVED')
    exact_fields(run, {'id': run_id, 'head_sha': source, 'head_branch': 'main', 'run_attempt': 1,
                      'event': 'push', 'status': 'completed', 'conclusion': 'success',
                      'path': '.github/workflows/verify-arthello-v52.yml'}, 'PRODUCER_IDENTITY')
    for name in ('repository', 'head_repository'):
        exact_fields(run.get(name), {'full_name': REPOSITORY, 'id': REPOSITORY_ID}, 'PRODUCER_REPOSITORY')
    for name in ('actor', 'triggering_actor'):
        exact_fields(run.get(name), {'login': OWNER}, 'PRODUCER_OWNER')
    require(isinstance(listing, dict) and type(listing.get('total_count')) is int
            and isinstance(listing.get('artifacts'), list)
            and listing['total_count'] == len(listing['artifacts']) == 2
            and all(isinstance(item, dict) and isinstance(item.get('name'), str)
                    for item in listing['artifacts']), 'ARTIFACT_INVENTORY')
    app_name, proof_name = 'arthello-v52-verification-' + str(run_id), 'finance-browser-' + str(run_id) + '-1'
    require({item.get('name') for item in listing['artifacts']} == {app_name, proof_name}, 'ARTIFACT_INVENTORY')
    artifact = next(item for item in listing['artifacts'] if item['name'] == app_name)
    proof = next(item for item in listing['artifacts'] if item['name'] == proof_name)
    require(type(proof.get('id')) is int and proof['id'] > 0 and proof['id'] != artifact.get('id'), 'PROOF_ARTIFACT_IDENTITY')
    exact_fields(proof, {'name': proof_name, 'expired': False}, 'PROOF_ARTIFACT_IDENTITY')
    require(type(proof.get('size_in_bytes')) is int and 0 < proof['size_in_bytes'] <= 8 * 1024 ** 2, 'PROOF_ARTIFACT_SIZE')
    require(isinstance(proof.get('digest'), str) and re.fullmatch(r'sha256:[a-f0-9]{64}', proof['digest']), 'PROOF_ARTIFACT_DIGEST')
    require(isinstance(proof.get('expires_at'), str), 'PROOF_ARTIFACT_EXPIRED')
    try:
        expiry = datetime.fromisoformat(proof['expires_at'].replace('Z', '+00:00'))
        require(expiry.utcoffset() is not None and expiry > now, 'PROOF_ARTIFACT_EXPIRED')
    except (KeyError, TypeError, ValueError):
        raise Refused('PROOF_ARTIFACT_EXPIRED') from None
    exact_fields(proof.get('workflow_run'), {'id': run_id, 'head_sha': source, 'head_branch': 'main',
                 'repository_id': REPOSITORY_ID, 'head_repository_id': REPOSITORY_ID}, 'PROOF_ARTIFACT_PRODUCER')
    # The proof archive is inventory evidence only. Only the exact application
    # artifact below may be streamed, verified and extracted by the frozen tail.
    exact_fields(artifact, {'name': 'arthello-v52-verification-' + str(run_id), 'expired': False}, 'ARTIFACT_IDENTITY')
    require(type(artifact.get('id')) is int and artifact['id'] > 0, 'ARTIFACT_IDENTITY')
    require(type(artifact.get('size_in_bytes')) is int and 0 < artifact['size_in_bytes'] <= MAX_BYTES, 'ARTIFACT_SIZE')
    require(isinstance(artifact.get('digest'), str) and
            re.fullmatch(r'sha256:[a-f0-9]{64}', artifact['digest']), 'ARTIFACT_DIGEST')
    try:
        expiry = datetime.fromisoformat(artifact['expires_at'].replace('Z', '+00:00'))
        require(expiry.utcoffset() is not None and expiry > now, 'ARTIFACT_EXPIRED')
    except (KeyError, TypeError, ValueError):
        raise Refused('ARTIFACT_EXPIRED') from None
    exact_fields(artifact.get('workflow_run'), {'id': run_id, 'head_sha': source, 'head_branch': 'main',
                 'repository_id': REPOSITORY_ID, 'head_repository_id': REPOSITORY_ID}, 'ARTIFACT_PRODUCER')
    return artifact


def blob_url(value):
    try:
        parsed = urllib.parse.urlsplit(value)
        require(parsed.scheme == 'https' and parsed.hostname and
                parsed.hostname.endswith('.blob.core.windows.net') and parsed.port in (None, 443)
                and parsed.username is None and parsed.password is None and not parsed.fragment,
                'DOWNLOAD_REDIRECT')
    except (TypeError, ValueError):
        raise Refused('DOWNLOAD_REDIRECT') from None
    return value


def copy_verified(source, output, size, expected_digest, *, deadline):
    checksum, count = hashlib.sha256(), 0
    while True:
        require(time.monotonic() < deadline, 'DOWNLOAD_DEADLINE')
        data = source.read(1024 * 1024)
        if not data:
            break
        count += len(data)
        require(count <= size, 'DOWNLOAD_SIZE')
        checksum.update(data)
        output.write(data)
    require(count == size, 'DOWNLOAD_SIZE')
    require(checksum.hexdigest() == expected_digest, 'DOWNLOAD_DIGEST')


def extract(archive, target, archive_size):
    with zipfile.ZipFile(archive) as zipped:
        entries = zipped.infolist()
        require(len(entries) == len(MEMBERS) and {e.filename for e in entries} == set(MEMBERS), 'ARCHIVE_MEMBERS')
        require(sum(e.file_size for e in entries) <= min(MAX_BYTES, archive_size * 4 + 1024 * 1024), 'ARCHIVE_EXPANSION')
        for entry in entries:
            mode = entry.external_attr >> 16
            require(not entry.is_dir() and stat.S_IFMT(mode) in (0, stat.S_IFREG)
                    and not entry.flag_bits & 1 and entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                    and 0 < entry.file_size <= MEMBERS[entry.filename], 'ARCHIVE_MEMBER_TYPE')
        # Validate every CRC before creating any extracted member. This extra
        # read is bounded by the validated inventory and expansion limit.
        require(zipped.testzip() is None, 'ARCHIVE_CRC')
        for entry in entries:
            with zipped.open(entry) as source, (Path(target) / entry.filename).open('xb') as destination:
                shutil.copyfileobj(source, destination, 1024 * 1024)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, new_url):
        return None


class GitHub:
    def __init__(self, token):
        require(isinstance(token, str) and token and not re.search(r'\s', token), 'TOKEN_UNAVAILABLE')
        self.headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                        'X-GitHub-Api-Version': '2022-11-28'}
        self.opener = urllib.request.build_opener(NoRedirect())

    def json(self, suffix):
        with self.opener.open(urllib.request.Request(API + suffix, headers=self.headers), timeout=45) as response:
            raw = response.read(1024 * 1024 + 1)
        require(len(raw) <= 1024 * 1024, 'METADATA_SIZE')
        return json.loads(raw)

    def stream(self, artifact):
        request = urllib.request.Request(API + '/actions/artifacts/' + str(artifact['id']) + '/zip', headers=self.headers)
        try:
            return self.opener.open(request, timeout=45)
        except urllib.error.HTTPError as error:
            require(error.code in (301, 302, 303, 307, 308), 'DOWNLOAD_HTTP')
            location = blob_url(error.headers.get('Location'))
            error.close()
        # Never forward the bearer token to a signed storage URL. A second
        # redirect is not followed by this opener.
        return self.opener.open(urllib.request.Request(location), timeout=45)


def context(env):
    for key, value in {'GITHUB_REPOSITORY': REPOSITORY, 'EXPECTED_REPOSITORY': REPOSITORY,
                       'GITHUB_ACTOR': OWNER, 'GITHUB_TRIGGERING_ACTOR': OWNER,
                       'GITHUB_EVENT_NAME': 'workflow_run'}.items():
        require(env.get(key) == value, 'PROTECTED_CONTEXT')
    source = env.get('RELEASE_SHA', '')
    require(re.fullmatch(r'[a-f0-9]{40}', source), 'SOURCE_IDENTITY')
    for key in ('TRIGGER_VERIFY_RUN_ID', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'):
        require(re.fullmatch(r'[1-9][0-9]*', env.get(key, '')), 'RUN_IDENTITY')
    require(1 <= int(env['GITHUB_RUN_ATTEMPT']) <= 50, 'RUN_IDENTITY')
    checked = subprocess.run(['git', 'rev-parse', 'HEAD'], check=True, capture_output=True, timeout=30).stdout.decode().strip()
    require(checked == source == env.get('CHECKED_SOURCE_SHA'), 'CHECKED_SOURCE_MOVED')
    root = Path(env.get('RUNNER_TEMP', ''))
    require(root.is_absolute() and root.is_dir() and root.resolve() == root, 'SCRATCH_IDENTITY')
    directory = root / ('arthello-v52-release-' + env['GITHUB_RUN_ID'] + '-' + env['GITHUB_RUN_ATTEMPT'])
    return source, int(env['TRIGGER_VERIFY_RUN_ID']), directory


def main():
    stage = 'context'
    try:
        require(len(sys.argv) == 1, 'ARGUMENTS_NOT_ALLOWED')
        source, run_id, directory = context(os.environ)
        client = GitHub(os.environ.get('GH_TOKEN'))
        stage = 'metadata'
        artifact = metadata(client.json('/actions/runs/' + str(run_id)),
                            client.json('/actions/runs/' + str(run_id) + '/artifacts?per_page=100'),
                            client.json('/git/ref/heads/main'), source, run_id, datetime.now(timezone.utc))
        stage = 'owned_directory'
        directory.mkdir(mode=0o700, exist_ok=False)
        part = directory / 'artifact.zip.part'
        archive = directory / 'artifact.zip'
        deadline = time.monotonic() + 25 * 60
        stage = 'download'
        for attempt in range(1, 4):
            try:
                with client.stream(artifact) as incoming, part.open('xb') as output:
                    copy_verified(incoming, output, artifact['size_in_bytes'], artifact['digest'][7:], deadline=deadline)
                part.rename(archive)
                break
            except (TimeoutError, ConnectionError, urllib.error.URLError):
                if part.exists():
                    part.unlink()
                require(attempt < 3 and time.monotonic() < deadline, 'DOWNLOAD_NETWORK')
        stage = 'current_main'
        exact_fields(client.json('/git/ref/heads/main').get('object'), {'type': 'commit', 'sha': source}, 'MAIN_MOVED')
        stage = 'archive'
        extract(archive, directory, artifact['size_in_bytes'])
        archive.unlink()
        print(json.dumps({'kind': 'v52-artifact-delivery', 'result': 'verified', 'artifactId': artifact['id'],
                          'artifactBytes': artifact['size_in_bytes'], 'zipSha256': artifact['digest'][7:],
                          'members': 3, 'imageImported': False}, separators=(',', ':')), flush=True)
        return 0
    except Refused as error:
        # All Refused codes are fixed literals; no external values are used.
        print(json.dumps({'kind': 'v52-artifact-delivery', 'result': 'blocked', 'stage': stage,
                          'reason': str(error)}, separators=(',', ':')), flush=True)
        return 2
    except Exception:
        # No API payload, signed URL, exception string, credentials or paths.
        print(json.dumps({'kind': 'v52-artifact-delivery', 'result': 'blocked', 'stage': stage}, separators=(',', ':')), flush=True)
        return 2


if __name__ == '__main__':
    sys.exit(main())
