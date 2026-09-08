#!/usr/bin/env python3
"""Read-only release gate: consumes recorded real browser evidence, never creates it."""
import base64
import datetime
import json
import os
from pathlib import Path
import re
import urllib.request

def validate(record, release_sha, school_sha, live_arthello_sha, now):
    required_steps = ['open_education_in_authenticated_arthello', 'click_diary_entry', 'follow_natural_sso_redirects', 'authenticated_school_diary_visible']
    assert record.get('schemaVersion') == 1
    assert record.get('intendedCandidateArtHelloSha') == release_sha
    assert record.get('observedLiveSchoolSha') == school_sha and re.fullmatch('[a-f0-9]{40}', school_sha or '')
    assert record.get('observedLiveArtHelloSha') == live_arthello_sha and re.fullmatch('[a-f0-9]{40}', live_arthello_sha or '')
    assert record.get('arthelloOrigin') == 'https://arthello-188-225-38-55.sslip.io'
    assert record.get('schoolOrigin') == 'https://school-188-225-38-55.sslip.io'
    assert record.get('method') == 'natural-browser-navigation'
    assert record.get('sessionInjected') is False and record.get('callbackUrlConstructed') is False
    assert record.get('verifiedSteps') == required_steps
    assert record.get('result') == 'pass'
    assert isinstance(record.get('evidenceReference'), str) and 10 <= len(record['evidenceReference']) <= 2048
    stamp = datetime.datetime.fromisoformat(record['observedAtUtc'].replace('Z', '+00:00'))
    assert stamp.tzinfo is not None
    assert datetime.timedelta(0) <= now - stamp <= datetime.timedelta(minutes=45), 'Live SSO acceptance expired'

def main():
    items = []
    for line in Path(os.environ['SCHOOL_DIAGNOSTIC_FILE']).read_text().splitlines():
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    school = [item['release'] for item in items if isinstance(item, dict) and 'imageId' in item and 'release' in item]
    assert len(school) == 1, 'Live School identity is missing from diagnostic'
    # Historic callback errors are evidence for diagnosis, not a success/failure
    # substitute for a real current browser navigation.
    url = 'https://api.github.com/repos/vitaliyozolin-dotcom/ArtHello-OS/contents/docs/acceptance/2026-09-08-school-live-acceptance.json?ref=codex/recovery-evidence-20260907'
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            source = json.load(response)
        assert source.get('encoding') == 'base64' and source.get('size', 1_000_000) <= 8192
        record = json.loads(base64.b64decode(source['content'], validate=False))
        validate(record, os.environ['RELEASE_SHA'], school[0], os.environ['OBSERVED_LIVE_ARTHELLO_SHA'], datetime.datetime.now(datetime.timezone.utc))
    except Exception:
        raise SystemExit('ARTHELLO_SCHOOL_SSO_ACCEPTANCE=BLOCKED: real fresh browser acceptance is absent, stale or mismatched; no cutover attempted')
    print('ARTHELLO_SCHOOL_SSO_ACCEPTANCE=VERIFIED')

if __name__ == '__main__':
    main()
