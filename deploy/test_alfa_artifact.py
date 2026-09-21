import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('artifact', Path(__file__).with_name('alfa_artifact.py'))
artifact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifact)


class ArtifactTests(unittest.TestCase):
    def listing(self):
        names = ['arthello-v52-verification-123', 'finance-browser-123-1',
                 'diary-directory-atlas-123', 'diary-directory-school-123']
        rows = [{'id': i+1, 'name': name, 'size_in_bytes': 100, 'expired': False,
                 'digest': 'sha256:' + 'a'*64, 'expires_at': '2030-01-01T00:00:00Z',
                 'workflow_run': {'id': 123, 'head_sha': 'b'*40, 'head_branch': 'main',
                                  'repository_id': 1311964413, 'head_repository_id': 1311964413}}
                for i, name in enumerate(names)]
        return {'total_count': 4, 'artifacts': rows}

    def test_current_inventory_accepts_both_diaries_without_relaxing_provenance(self):
        result = artifact.artifact_inventory(self.listing(), 123, 'b'*40, datetime.now(timezone.utc))
        self.assertEqual(len(result), 4)

    def test_unknown_missing_expired_or_other_source_artifact_is_rejected(self):
        for change in (
            lambda v: v['artifacts'].pop(),
            lambda v: v['artifacts'][0].update(name='unexpected'),
            lambda v: v['artifacts'][0].update(expired=True),
            lambda v: v['artifacts'][0]['workflow_run'].update(head_sha='c'*40),
            lambda v: v['artifacts'][0].update(digest='bad'),
        ):
            value = self.listing()
            change(value)
            with self.assertRaises(artifact.bounded.Refused):
                artifact.artifact_inventory(value, 123, 'b'*40, datetime.now(timezone.utc))

    def test_foreign_or_non_main_or_rerun_producer_is_rejected(self):
        value = {'head_sha': 'b'*40, 'head_branch': 'main', 'run_attempt': 1, 'event': 'push',
                 'status': 'completed', 'conclusion': 'success', 'path': '.github/workflows/quality.yml',
                 'repository': {'full_name': artifact.REPOSITORY, 'id': 1311964413},
                 'head_repository': {'full_name': artifact.REPOSITORY, 'id': 1311964413},
                 'actor': {'login': artifact.bounded.OWNER}, 'triggering_actor': {'login': artifact.bounded.OWNER}}
        artifact.verify_run(value, 'b'*40, 'quality')
        for key, bad in (('head_branch', 'feature'), ('event', 'pull_request'), ('run_attempt', 2), ('head_sha', 'c'*40)):
            changed = json.loads(json.dumps(value)); changed[key] = bad
            with self.assertRaises(artifact.bounded.Refused):
                artifact.verify_run(changed, 'b'*40, 'quality')

    def test_zip_traversal_and_unknown_members_never_extract(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root); target = root/'target'; target.mkdir(); archive = root/'bundle.zip'
            with zipfile.ZipFile(archive, 'w') as zipped:
                zipped.writestr('../escape', 'payload')
            with self.assertRaises(artifact.bounded.Refused):
                artifact.extract(archive, target, archive.stat().st_size, {'receipt.json': 1000})
            self.assertEqual(list(target.iterdir()), [])
            self.assertFalse((root/'escape').exists())


if __name__ == '__main__':
    unittest.main()
