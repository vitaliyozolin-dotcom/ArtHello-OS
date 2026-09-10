import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
from email.message import Message
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('download', ROOT / '.github/scripts/download-v52-artifact-r15.py')
download = importlib.util.module_from_spec(spec)
spec.loader.exec_module(download)


def archive(entries=None):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as z:
        for name, data in (entries or [
                ('arthello-v52.json', b'{}'),
                ('arthello-v52.json.sha256', b'checksum'),
                ('arthello-v52-image.tar.gz', b'fixture-not-an-image')]):
            z.writestr(name, data)
    return buffer.getvalue()


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_exact_archive_extracts_all_three_files(self):
        payload = archive()
        file = self.root / 'payload.zip'
        file.write_bytes(payload)
        download.extract(file, self.root, len(payload))
        self.assertTrue(all((self.root / name).is_file() for name in download.MEMBERS))

    def test_missing_extra_duplicate_and_path_entries_are_refused_before_writes(self):
        valid = [(name, b'fixture') for name in download.MEMBERS]
        for entries in [valid[:-1], valid + [('unexpected', b'x')], valid + [valid[0]],
                        [('..//outside', b'x')] + valid[1:]]:
            with self.subTest(entries=[p for p, _ in entries]):
                file = self.root / 'payload.zip'
                file.write_bytes(archive(entries))
                with self.assertRaises(download.Refused):
                    download.extract(file, self.root, file.stat().st_size)
                self.assertFalse(any((self.root / name).exists() for name in download.MEMBERS))

    def test_symbolic_link_is_not_extracted(self):
        file = self.root / 'payload.zip'
        with zipfile.ZipFile(file, 'w') as z:
            for name in download.MEMBERS:
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                info.external_attr = 0o120777 << 16
                z.writestr(info, 'target')
        with self.assertRaises(download.Refused):
            download.extract(file, self.root, file.stat().st_size)
        self.assertFalse(any((self.root / name).exists() for name in download.MEMBERS))

    def test_stream_requires_exact_size_and_digest(self):
        for data, size, digest in [(b'x', 2, hashlib.sha256(b'x').hexdigest()),
                                   (b'xx', 1, hashlib.sha256(b'xx').hexdigest()),
                                   (b'x', 1, '0' * 64)]:
            with self.subTest(size=size, digest=digest):
                with self.assertRaises(download.Refused):
                    download.copy_verified(io.BytesIO(data), io.BytesIO(), size, digest, deadline=float('inf'))
        output = io.BytesIO()
        download.copy_verified(io.BytesIO(b'complete'), output, 8, hashlib.sha256(b'complete').hexdigest(), deadline=float('inf'))
        self.assertEqual(output.getvalue(), b'complete')

    def test_expired_deadline_refuses_stream(self):
        with self.assertRaisesRegex(download.Refused, 'DOWNLOAD_DEADLINE'):
            download.copy_verified(io.BytesIO(b'x'), io.BytesIO(), 1, hashlib.sha256(b'x').hexdigest(), deadline=0)

    def test_signed_redirect_is_restricted(self):
        self.assertEqual(download.blob_url('https://productionresultssa15.blob.core.windows.net/path?sig=private'),
                         'https://productionresultssa15.blob.core.windows.net/path?sig=private')
        for url in ['http://host.blob.core.windows.net/path', 'https://evil.example/path',
                    'https://user:pass@host.blob.core.windows.net/path',
                    'https://host.blob.core.windows.net:444/path', 'https://host.blob.core.windows.net/path#fragment']:
            with self.subTest(url=url), self.assertRaises(download.Refused):
                download.blob_url(url)

    def test_bearer_is_not_forwarded_to_blob_storage(self):
        client = download.GitHub('synthetic-test-token')
        requests = []
        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                if len(requests) == 1:
                    headers = Message()
                    headers['Location'] = 'https://host.blob.core.windows.net/path?sig=fixture'
                    raise urllib.error.HTTPError(request.full_url, 302, 'redirect', headers, io.BytesIO())
                return io.BytesIO(b'fixture')
        client.opener = Opener()
        with client.stream({'id': 456}) as response:
            self.assertEqual(response.read(), b'fixture')
        self.assertEqual(requests[0].get_header('Authorization'), 'Bearer synthetic-test-token')
        self.assertIsNone(requests[1].get_header('Authorization'))

    def test_metadata_requires_successful_owner_main_attempt_one_and_exact_artifact(self):
        source = 'a' * 40
        run = dict(id=123, head_sha=source, head_branch='main', run_attempt=1, event='push',
                   status='completed', conclusion='success', path='.github/workflows/verify-arthello-v52.yml',
                   repository={'full_name': download.REPOSITORY, 'id': download.REPOSITORY_ID},
                   head_repository={'full_name': download.REPOSITORY, 'id': download.REPOSITORY_ID},
                   actor={'login': download.OWNER}, triggering_actor={'login': download.OWNER})
        artifact = dict(id=456, name='arthello-v52-verification-123', size_in_bytes=100,
                        digest='sha256:' + 'b' * 64, expired=False, expires_at='2030-01-01T00:00:00Z',
                        workflow_run=dict(id=123, head_sha=source, head_branch='main',
                                          repository_id=download.REPOSITORY_ID, head_repository_id=download.REPOSITORY_ID))
        listing = dict(total_count=1, artifacts=[artifact])
        main = {'ref': 'refs/heads/main', 'object': {'type': 'commit', 'sha': source}}
        now = datetime(2026, 9, 10, tzinfo=timezone.utc)
        self.assertEqual(download.metadata(run, listing, main, source, 123, now)['id'], 456)
        for key, value in [('conclusion', 'failure'), ('run_attempt', 2), ('head_sha', 'c'*40), ('event', 'pull_request')]:
            wrong = dict(run); wrong[key] = value
            with self.subTest(key=key), self.assertRaises(download.Refused):
                download.metadata(wrong, listing, main, source, 123, now)
        for key, value in [('expired', True), ('expires_at', '2020-01-01T00:00:00Z'), ('size_in_bytes', True), ('digest', 'bad')]:
            wrong = dict(artifact); wrong[key] = value
            with self.subTest(key=key), self.assertRaises(download.Refused):
                download.metadata(run, {'total_count': 1, 'artifacts': [wrong]}, main, source, 123, now)
        with self.assertRaises(download.Refused):
            download.metadata(run, {'total_count': 2, 'artifacts': [artifact]}, main, source, 123, now)


if __name__ == '__main__':
    unittest.main()
