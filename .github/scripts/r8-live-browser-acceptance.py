"""Bind actual same-job browser and live identity observations; reuse schema3 gate."""
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('schema3', HERE / 'check-school-live-acceptance-r7.py')
schema3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(schema3)
STEPS = ['open_education_in_authenticated_arthello', 'click_diary_entry',
         'follow_natural_sso_redirects', 'authenticated_school_diary_visible']


def build(browser, repair, *, release, school, live, config, reference, now, phase):
    assert phase in ('before', 'after')
    assert all(re.fullmatch('[a-f0-9]{40}', value or '') for value in (release, school, live))
    assert phase != 'after' or live == release, 'Published source is not the candidate'
    assert browser.get('kind') == 'server-natural-sso' and browser.get('result') == 'pass'
    for field in ('chromiumSandbox', 'employeeAccount', 'educationAccess', 'schoolIdentity', 'deniedApi'):
        assert browser.get(field) == 'verified'
    assert browser.get('deniedModule') in ('finance', 'medical')
    assert repair.get('schemaVersion') == 2 and repair.get('state') == 'verified'
    assert repair.get('repairConfigSha256') == config
    record = dict(schemaVersion=3, intendedCandidateArtHelloSha=release,
                  observedLiveSchoolSha=school, observedLiveArtHelloSha=live,
                  observedSchoolRepairConfigSha256=config,
                  observedSchoolRepairExecutionUid=repair['executionUid'],
                  observedSchoolRepairStateDirectorySha256=repair['stateDirectorySha256'],
                  arthelloOrigin='https://arthello-188-225-38-55.sslip.io',
                  schoolOrigin='https://school-188-225-38-55.sslip.io',
                  evidenceReference=reference)
    for field in ('method', 'sessionInjected', 'callbackUrlConstructed', 'verifiedSteps', 'result', 'observedAtUtc'):
        record[field] = browser.get(field)
    schema3.validate(record, release, school, live, config, repair['activatedAtUtc'],
                     repair['executionUid'], repair['stateDirectorySha256'], now)
    return record


def read_bounded(name):
    with open(os.environ[name], encoding='utf8') as stream:
        content = stream.read(32769)
    assert len(content) <= 32768
    return content


def main():
    try:
        browser = json.loads(read_bounded('BROWSER_REPORT_FILE'))
        repair = json.loads(read_bounded('SCHOOL_REPAIR_RECEIPT_FILE'))
        observed = []
        for line in read_bounded('SCHOOL_DIAGNOSTIC_FILE').splitlines():
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict) and 'imageId' in item and 'release' in item:
                observed.append(item['release'])
        assert len(observed) == 1
        run_id, attempt = os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT']
        assert re.fullmatch('[0-9]+', run_id) and re.fullmatch('[1-9][0-9]*', attempt)
        record = build(browser, repair, release=os.environ['RELEASE_SHA'], school=observed[0],
                       live=os.environ['OBSERVED_LIVE_ARTHELLO_SHA'],
                       config=os.environ['SCHOOL_REPAIR_CONFIG_SHA256'],
                       reference='https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/' + run_id + '/attempts/' + attempt,
                       now=dt.datetime.now(dt.timezone.utc), phase=os.environ['BROWSER_PHASE'])
    except Exception:
        raise SystemExit('ARTHELLO_R8_SSO_ACCEPTANCE=BLOCKED: browser, source or repair evidence is absent, stale or mismatched')
    print(json.dumps(record, separators=(',', ':')))
    print('ARTHELLO_R8_SSO_ACCEPTANCE=VERIFIED')


if __name__ == '__main__':
    main()
