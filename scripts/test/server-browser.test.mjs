import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { capacity, RESERVE_KIB } from '../../deploy/browser/capacity.mjs';
import { validateCredentials, validateEmployee, sameSchoolIdentity, requestAllowed, navigationStep, inspectSandbox, selectDeniedProbe } from '../../deploy/browser/flow.mjs';
import * as browserFlow from '../../deploy/browser/flow.mjs';
import { retirePreviousBrowserImage, retireCurrentBrowserImage } from '../../deploy/browser/retire-image.mjs';

const employee = { userId: 'fixture-id', isSystemOwner: false, apiRole: 'EMPLOYEE', role: 'viewer', mustChangePassword: false, allowedModules: ['education'] };
test('capacity reserves expanded import copies, both download copies and host headroom', () => {
  assert.deepEqual(capacity(1024, 4096), { scratchKiB: RESERVE_KIB + 2, dockerKiB: RESERVE_KIB + 14 });
  for (const values of [[0, 1], [1, 0], [-1, 4], [2, 1], [NaN, 4], [1.5, 4], [1, 101 * 1024 ** 3]]) {
    assert.throws(() => capacity(...values), /archive_size_invalid/);
  }
});
test('every passing account must have a concrete denied API probe', () => {
  assert.equal(selectDeniedProbe(employee).module, 'finance');
  assert.equal(selectDeniedProbe({ ...employee, allowedModules: ['education', 'finance'], canAccessMedical: false }).module, 'medical');
  assert.throws(() => selectDeniedProbe({ ...employee, allowedModules: ['education', 'finance', 'medical'], canAccessMedical: true }), /denied_probe_missing/);
});
test('pinned Chromium status requires namespace, PID, network and seccomp layers', () => {
  const rows = { 'Layer 1 Sandbox': 'Namespace', 'PID namespaces': 'Yes', 'Network namespaces': 'Yes', 'Seccomp-BPF sandbox': 'Yes' };
  assert.equal(Object.values(inspectSandbox(rows)).every(Boolean), true);
  for (const key of Object.keys(rows)) assert.equal(Object.values(inspectSandbox({ ...rows, [key]: 'No' })).every(Boolean), false);
  assert.equal(Object.values(inspectSandbox({})).every(Boolean), false);
});
test('dedicated input fails closed without printing secrets', () => {
  const password = 'fixture-private-password';
  assert.deepEqual(validateCredentials({ login: 'fixture@example.invalid', password }), { login: 'fixture@example.invalid', password });
  for (const input of [{}, { login: 'owner', password }, { login: 'fixture', password: 'short' }]) assert.throws(() => validateCredentials(input), /^Error: credentials_invalid$/);
});
test('owner, temporary password and absent explicit Education grant fail closed', () => {
  assert.doesNotThrow(() => validateEmployee(employee));
  for (const patch of [{ isSystemOwner: true }, { isSystemOwner: undefined }, { apiRole: 'OWNER' }, { role: 'owner' }, { mustChangePassword: true }, { allowedModules: undefined }, { allowedModules: ['tasks'] }]) {
    assert.throws(() => validateEmployee({ ...employee, ...patch }));
  }
});
test('School contact and staff role must match the dedicated login', () => {
  for (const role of ['director', 'deputy', 'admin', 'teacher', 'tech_admin']) assert.equal(sameSchoolIdentity({ email: 'fixture@example.invalid', role }, 'fixture@example.invalid'), true);
  assert.equal(sameSchoolIdentity({ email: 'fixture@example.invalid', role: 'methodist' }, 'fixture@example.invalid'), false);
  assert.equal(sameSchoolIdentity({ email: 'fixture@example.invalid', role: 'technical' }, 'fixture@example.invalid'), false);
  assert.equal(sameSchoolIdentity({ email: 'Fixture@example.invalid', role: 'teacher' }, 'fixture@example.invalid'), true);
  assert.equal(sameSchoolIdentity({ phone: '+7 (900) 111-22-33', role: 'teacher' }, '89001112233'), true);
  assert.equal(sameSchoolIdentity({ email: 'other@example.invalid', role: 'teacher' }, 'fixture@example.invalid'), false);
  assert.equal(sameSchoolIdentity({ email: 'fixture@example.invalid', role: 'parent' }, 'fixture@example.invalid'), false);
  assert.equal(sameSchoolIdentity({}, ''), false);
});
test('network accepts fixed HTTPS origins and only the one login write', () => {
  const origin = 'https://arthello-188-225-38-55.sslip.io';
  assert.equal(requestAllowed(origin + '/api/auth/login', 'POST'), true);
  assert.equal(requestAllowed(origin + '/api/education', 'GET'), true);
  for (const [url, method] of [[origin + '/api/finance-actions', 'POST'], [origin + '/api/settings', 'PATCH'], ['http://arthello-188-225-38-55.sslip.io/', 'GET'], [origin + '.attacker.invalid/', 'GET'], ['https://private:secret@arthello-188-225-38-55.sslip.io/', 'GET'], ['https://169.254.169.254/', 'GET']]) assert.equal(requestAllowed(url, method), false);
});
test('SSO observer retains only fixed step names, never callback query values', () => {
  const secret = 'PRIVATE_CALLBACK';
  assert.equal(navigationStep('https://school-188-225-38-55.sslip.io/auth/central/callback?code=' + secret), 'school_callback');
  assert.equal(navigationStep('https://arthello-188-225-38-55.sslip.io/api/school-sso/authorize?state=' + secret), 'arthello_authorize');
  assert.equal(navigationStep('https://evil.invalid/auth/central/callback?code=' + secret), null);
});

test('employee failure diagnostics emit only exact allowlisted tags', () => {
  const reasons = ['login_rejected', 'dedicated_employee_required', 'permanent_password_required', 'education_grant_missing', 'denied_probe_missing', 'denied_navigation_visible', 'denied_api_not_forbidden', 'unreadable_login_response', 'employee_navigation_unavailable'];
  for (const reason of reasons) {
    const error = new Error(reason);
    error.stack = 'PRIVATE_STACK';
    error.contact = 'fixture@example.invalid';
    assert.equal(browserFlow.safeFailureReason('employee_access', error), reason);
  }
  for (const error of [null, undefined, 'PRIVATE_PASSWORD', { message: 'login_rejected' }, new Error('login_rejected PRIVATE_PASSWORD'), new Error('https://school.example.invalid/callback?code=PRIVATE_CALLBACK'), new Error('PRIVATE_PASSWORD\nlogin_rejected')]) {
    assert.equal(browserFlow.safeFailureReason('employee_access', error), 'employee_access_failed');
  }
  for (const stage of ['sandbox', 'login_form', 'education', 'school_identity', 'PRIVATE_STAGE', '__proto__', undefined]) {
    assert.equal(browserFlow.safeFailureReason(stage, new Error('PRIVATE_PASSWORD')), 'browser_check_failed');
    assert.equal(browserFlow.safeFailureReason(stage, new Error('login_rejected')), 'browser_check_failed');
  }
});

test('hostile exception access cannot escape the privacy-safe diagnostic fallback', () => {
  const throwingMessage = Object.defineProperty(new Error(), 'message', {
    get() { throw new Error('PRIVATE_DIAGNOSTIC_SENTINEL'); },
  });
  const throwingPrototype = new Proxy(new Error(), {
    getPrototypeOf() { throw new Error('PRIVATE_PROTOTYPE_SENTINEL'); },
  });
  const revoked = Proxy.revocable(new Error(), {});
  revoked.revoke();
  for (const error of [throwingMessage, throwingPrototype, revoked.proxy]) {
    assert.equal(browserFlow.safeFailureReason('employee_access', error), 'employee_access_failed');
  }
});

function employeePage(options = {}) {
  let loginAttempts = 0;
  const locator = {
    fill: async () => {},
    first() { return this; },
    waitFor: async () => { if (options.navigationError) throw new Error('PRIVATE_NAVIGATION_URL'); },
    isVisible: async () => false,
    count: async () => options.deniedNavigation ? 1 : 0,
  };
  const response = {
    status: () => options.loginStatus ?? 200,
    json: async () => { if (options.jsonError) throw new Error('PRIVATE_RESPONSE_BODY'); return { ...employee, ...options.user }; },
  };
  return {
    loginAttempts: () => loginAttempts,
    page: {
      on() {},
      goto: async () => {},
      locator: () => locator,
      getByRole: () => ({ ...locator, click: async () => { loginAttempts++; } }),
      waitForResponse: async () => response,
      evaluate: async () => { if (options.probeError) throw new Error('PRIVATE_COOKIE'); return options.deniedStatus ?? 403; },
    },
  };
}

test('natural flow distinguishes employee failures without a second login or sensitive exception details', async () => {
  const cases = [
    [{ loginStatus: 401 }, 'login_rejected'],
    [{ user: { isSystemOwner: true } }, 'dedicated_employee_required'],
    [{ user: { mustChangePassword: true } }, 'permanent_password_required'],
    [{ user: { allowedModules: ['tasks'] } }, 'education_grant_missing'],
    [{ jsonError: true }, 'unreadable_login_response'],
    [{ navigationError: true }, 'employee_navigation_unavailable'],
    [{ user: { allowedModules: ['education', 'finance', 'medical'], canAccessMedical: true } }, 'denied_probe_missing'],
    [{ deniedNavigation: true }, 'denied_navigation_visible'],
    [{ deniedStatus: 200 }, 'denied_api_not_forbidden'],
  ];
  for (const [options, expected] of cases) {
    const fixture = employeePage(options);
    const stages = [];
    await assert.rejects(browserFlow.naturalFlow(fixture.page, { login: 'fixture@example.invalid', password: 'fixture-private-password' }, stage => stages.push(stage)), error => {
      assert.equal(error.message, expected);
      assert.equal(browserFlow.safeFailureReason(stages.at(-1), error), expected);
      return true;
    });
    assert.deepEqual(stages, ['login_form', 'employee_access']);
    assert.equal(fixture.loginAttempts(), 1);
  }
  const fixture = employeePage({ probeError: true });
  await assert.rejects(browserFlow.naturalFlow(fixture.page, { login: 'fixture@example.invalid', password: 'fixture-private-password' }), error => {
    assert.equal(browserFlow.safeFailureReason('employee_access', error), 'employee_access_failed');
    return true;
  });
  assert.equal(fixture.loginAttempts(), 1);
});


const laterStageReasons = {
  education: ['education_response_missing', 'education_navigation_failed', 'education_forbidden', 'education_rejected', 'diary_entry_not_visible'],
  diary_navigation: ['school_response_missing', 'diary_entry_click_failed', 'school_forbidden', 'school_rejected'],
  school_identity: ['unreadable_school_response', 'school_identity_mismatch', 'natural_redirect_chain_missing', 'school_navigation_unavailable', 'school_diary_not_visible'],
};

test('later-stage diagnostics are exact, scoped tags and redact unknown or hostile errors', () => {
  const throwingMessage = Object.defineProperty(new Error(), 'message', { get() { throw new Error('PRIVATE_MESSAGE'); } });
  const throwingPrototype = new Proxy(new Error(), { getPrototypeOf() { throw new Error('PRIVATE_PROTOTYPE'); } });
  const revoked = Proxy.revocable(new Error(), {});
  revoked.revoke();
  for (const [stage, reasons] of Object.entries(laterStageReasons)) {
    for (const reason of reasons) {
      const error = Object.assign(new Error(reason), { contact: 'fixture@example.invalid', stack: 'PRIVATE_STACK' });
      assert.equal(browserFlow.safeFailureReason(stage, error), reason);
      for (const other of Object.keys(laterStageReasons).filter(value => value !== stage)) {
        assert.equal(browserFlow.safeFailureReason(other, error), 'browser_check_failed');
      }
      assert.equal(browserFlow.safeFailureReason('employee_access', error), 'employee_access_failed');
    }
    for (const error of [throwingMessage, throwingPrototype, revoked.proxy, null, undefined,
      { message: reasons[0] }, reasons[0], new Error(reasons[0] + ' PRIVATE_PASSWORD'),
      new Error('https://school.example.invalid/callback?code=PRIVATE_CALLBACK')]) {
      assert.equal(browserFlow.safeFailureReason(stage, error), 'browser_check_failed');
    }
  }
});

function laterStagePage(options = {}) {
  let requestListener, responseNumber = 0;
  const actions = [];
  const fail = boundary => { if (boundary && options.fail === boundary) throw new Error('PRIVATE_EXCEPTION_URL?code=PRIVATE_CALLBACK'); };
  const response = (url, method, status, value, boundary) => ({
    url: () => url, request: () => ({ method: () => method }), status: () => status,
    json: async () => { fail(boundary); return value; },
  });
  const educationLocator = {
    first() { return this; }, waitFor: async () => {}, click: async () => { actions.push('education_click'); fail('education_click'); },
  };
  const diary = {
    waitFor: async () => { fail('diary_visible'); },
    click: async () => {
      actions.push('diary_click');
      fail('diary_click');
      for (const url of [
        browserFlow.SCHOOL + '/auth/central/start',
        browserFlow.ARTHELLO + '/api/school-sso/authorize?state=PRIVATE_STATE',
        ...(options.missingChain ? [] : [browserFlow.SCHOOL + '/auth/central/callback?code=PRIVATE_CALLBACK']),
      ]) requestListener({ isNavigationRequest: () => true, url: () => url });
    },
  };
  return {
    actions,
    page: {
      on(event, listener) { assert.equal(event, 'request'); requestListener = listener; },
      goto: async () => { actions.push('open_login'); },
      locator(selector) {
        if (selector.startsWith('input[name=')) return { fill: async () => {} };
        if (selector === 'aside[aria-label="Основная навигация"] a[href="#education"]') return educationLocator;
        if (selector === 'aside a[href="#finance"]') return { count: async () => 0 };
        if (selector === 'nav[aria-label="Основная навигация"]') return {
          first() { return this; }, waitFor: async () => { fail('school_navigation'); },
        };
        assert.equal(selector, 'input[type="password"]');
        return { count: async () => options.passwordVisible ? 1 : 0 };
      },
      getByRole(role, query) {
        assert.equal(role, 'button');
        if (query.name === 'Войти') return { click: async () => { actions.push('login_click'); } };
        if (query.name.source === 'Разработчикам') return { first() { return this; }, isVisible: async () => false };
        assert.equal(query.name.source, '^(Открыть дневник|Перейти в дневник)$');
        return diary;
      },
      waitForResponse: async predicate => {
        responseNumber++;
        let result;
        if (responseNumber === 1) {
          result = response(browserFlow.ARTHELLO + '/api/auth/login', 'POST', 200, employee);
        } else if (responseNumber === 2) {
          fail('education_response');
          result = response(browserFlow.ARTHELLO + '/api/education', 'GET', options.educationStatus ?? 200);
        } else {
          assert.equal(responseNumber, 3);
          fail('school_response');
          result = response(browserFlow.SCHOOL + '/api/school', 'GET', options.schoolStatus ?? 200,
            { viewer: { role: 'teacher', email: options.wrongIdentity ? 'other@example.invalid' : 'fixture@example.invalid' } }, 'school_json');
        }
        assert.equal(predicate(result), true);
        return result;
      },
      evaluate: async (callback, endpoint) => { assert.equal(endpoint, '/api/finance'); actions.push('denied_api'); return 403; },
      url: () => options.wrongSchoolOrigin ? browserFlow.ARTHELLO : browserFlow.SCHOOL,
    },
  };
}

test('natural flow distinguishes Education, diary navigation and School identity boundaries without changing acceptance', async () => {
  const cases = [
    [{ fail: 'education_response' }, 'education', 'education_response_missing'],
    [{ fail: 'education_click' }, 'education', 'education_navigation_failed'],
    [{ educationStatus: 403 }, 'education', 'education_forbidden'],
    [{ educationStatus: 500 }, 'education', 'education_rejected'],
    [{ fail: 'diary_visible' }, 'education', 'diary_entry_not_visible'],
    [{ fail: 'school_response' }, 'diary_navigation', 'school_response_missing'],
    [{ fail: 'diary_click' }, 'diary_navigation', 'diary_entry_click_failed'],
    [{ schoolStatus: 403 }, 'diary_navigation', 'school_forbidden'],
    [{ schoolStatus: 500 }, 'diary_navigation', 'school_rejected'],
    [{ fail: 'school_json' }, 'school_identity', 'unreadable_school_response'],
    [{ wrongIdentity: true }, 'school_identity', 'school_identity_mismatch'],
    [{ missingChain: true }, 'school_identity', 'natural_redirect_chain_missing'],
    [{ fail: 'school_navigation' }, 'school_identity', 'school_navigation_unavailable'],
    [{ wrongSchoolOrigin: true }, 'school_identity', 'school_diary_not_visible'],
    [{ passwordVisible: true }, 'school_identity', 'school_diary_not_visible'],
  ];
  for (const [options, expectedStage, expected] of cases) {
    const fixture = laterStagePage(options);
    const stages = [];
    await assert.rejects(browserFlow.naturalFlow(fixture.page, {
      login: 'fixture@example.invalid', password: 'fixture-private-password',
    }, stage => stages.push(stage)), error => {
      assert.equal(stages.at(-1), expectedStage);
      assert.equal(error.message, expected);
      assert.equal(browserFlow.safeFailureReason(expectedStage, error), expected);
      assert.equal(error.message.includes('PRIVATE'), false);
      return true;
    });
    assert.equal(fixture.actions.filter(action => action === 'login_click').length, 1);
    assert.equal(fixture.actions.filter(action => action === 'education_click').length, 1);
    assert.equal(fixture.actions.filter(action => action === 'diary_click').length, expectedStage === 'education' ? 0 : 1);
    assert.equal(stages.includes('complete'), false);
  }
});

test('successful natural flow retains one login, one denied probe, both navigation clicks and all original proofs', async () => {
  const fixture = laterStagePage();
  const stages = [];
  const result = await browserFlow.naturalFlow(fixture.page, {
    login: 'fixture@example.invalid', password: 'fixture-private-password',
  }, stage => stages.push(stage));
  assert.deepEqual(stages, ['login_form', 'employee_access', 'education', 'diary_navigation', 'school_identity', 'complete']);
  assert.deepEqual(fixture.actions, ['open_login', 'login_click', 'denied_api', 'education_click', 'diary_click']);
  assert.deepEqual(result, {
    result: 'pass', method: 'natural-browser-navigation', sessionInjected: false, callbackUrlConstructed: false,
    employeeAccount: 'verified', educationAccess: 'verified', schoolIdentity: 'verified', deniedApi: 'verified', deniedModule: 'finance',
    feedbackVisible: false,
    verifiedSteps: ['open_education_in_authenticated_arthello', 'click_diary_entry', 'follow_natural_sso_redirects', 'authenticated_school_diary_visible'],
  });
});


const retiredImage = {
  id: 'sha256:0763e7e6404c4ecf19b81bdcc236dd815a0210e9bb6b087adec279692cc7701c',
  source: '5385090d48f4dae29c314dff7ae974d854560940',
  tag: 'arthello-e2e:5385090d48f4dae29c314dff7ae974d854560940',
  fingerprint: '5970abba2518f5fc1f3bb27ef2624570e8050cbc606a3cb300f596031c26564e',
};

function retirementFixture(options = {}) {
  const calls = [];
  const githubCalls = [];
  let removed = false, inspections = 0, referenceChecks = 0, mainChecks = 0;
  const source = 'b52a5326f650060036d7ccd66a87e8d2d6a5a292';
  const target = options.current ? { id: 'sha256:' + 'c'.repeat(64), source, tag: 'arthello-e2e:' + source, fingerprint: 'a'.repeat(64) } : retiredImage;
  const runId = options.current ? 34285119759 : 34283447507;
  const snapshot = [{ Id: target.id, RepoTags: [target.tag], RepoDigests: [], Config: { User: '1000:1000', Labels: { 'org.arthello.role': 'e2e-browser', 'org.opencontainers.image.revision': target.source } } }];
  const archive = {
    id: 10078598718,
    name: `server-browser-${target.source}-${runId}-1`,
    size_in_bytes: 640791883,
    digest: 'sha256:e7a77316e647ba17a8e232d1b060d2c02f73ef2cfbdfe769b99cc01e841fc140',
    expired: false,
    expires_at: '2026-09-10T22:00:54Z',
    workflow_run: { id: runId, repository_id: 1311964413, head_repository_id: 1311964413, head_branch: 'main', head_sha: target.source },
  };
  return {
    calls, githubCalls, target,
    dependencies: {
      checkedSource: source,
      environment: { CHECKED_SOURCE_SHA: source, BROWSER_IMAGE_ID: target.id, EXPECTED_BROWSER_FINGERPRINT: target.fingerprint, BROWSER_ARCHIVE_NAME: archive.name, GITHUB_RUN_ID: String(runId), GITHUB_RUN_ATTEMPT: '1', ...options.environment },
      now: () => Date.parse('2026-09-09T00:00:00Z'),
      fingerprint: () => options.fingerprint ?? target.fingerprint,
      readGitHub: async path => {
        githubCalls.push(path);
        if (options.githubFailure) throw new Error('PRIVATE_GITHUB_TOKEN');
        if (path === '/git/ref/heads/main') {
          mainChecks++;
          return { object: { sha: options.mainChanged && mainChecks > 1 ? 'f'.repeat(40) : source } };
        }
        assert.equal(path, options.current ? '/actions/runs/34285119759/artifacts?per_page=100' : '/actions/artifacts/10078598718');
        const value = structuredClone(archive);
        options.alterArchive?.(value);
        const response = options.current ? { total_count: 1, artifacts: [value] } : value;
        options.alterArchiveResponse?.(response);
        return response;
      },
      docker: args => {
        calls.push(args);
        if (options.daemonFailure) throw new Error('PRIVATE_DAEMON_ERROR');
        if (args[0] === 'image' && args[1] === 'ls') {
          const tagged = args.includes('--filter');
          if (options.inventoryMalformed) return 'PRIVATE_INVALID_INVENTORY';
          if (removed || options.absent) return tagged && options.foreignTag ? 'sha256:' + 'f'.repeat(64) + '\n' : '';
          return target.id + '\n';
        }
        if (args[0] === 'image' && args[1] === 'inspect') {
          if (options.inspectFailure) throw Object.defineProperty(new Error(), 'message', { get() { throw new Error('PRIVATE_EXCEPTION_DETAIL'); } });
          assert.ok([target.id, target.tag].includes(args[2]));
          inspections++;
          const value = structuredClone(snapshot);
          options.alterImage?.(value, inspections);
          return JSON.stringify(value);
        }
        if (args[0] === 'ps') {
          assert.deepEqual(args, ['ps', '-a', '-q', '--no-trunc', '--filter', 'ancestor=' + target.id]);
          referenceChecks++;
          return options.containerReference || (options.racedContainer && referenceChecks > 1) ? 'c'.repeat(64) + '\n' : '';
        }
        assert.deepEqual(args, ['image', 'rm', '--no-prune', target.id]);
        if (options.removalRefused) throw new Error('PRIVATE_CONFLICT_DETAIL');
        removed = !options.removalNoEffect;
        return 'PRIVATE_DAEMON_REMOVAL_OUTPUT';
      },
    },
  };
}

test('retirement removes only the exact unused reproducible image after fresh identity, artifact and main checks', async () => {
  const fixture = retirementFixture();
  assert.deepEqual(await retirePreviousBrowserImage(fixture.dependencies), { kind: 'server-browser-image-retirement', result: 'retired' });
  assert.deepEqual(fixture.calls.filter(args => args[1] === 'rm'), [['image', 'rm', '--no-prune', retiredImage.id]]);
  assert.equal(fixture.calls.filter(args => args[1] === 'inspect').length, 4);
  assert.equal(fixture.calls.filter(args => args[0] === 'ps').length, 2);
  assert.deepEqual(fixture.githubCalls, ['/git/ref/heads/main', '/actions/artifacts/10078598718', '/git/ref/heads/main']);
  assert.ok(fixture.calls.slice(-2).every(args => args[1] === 'ls'));
});

test('retirement is idempotent only after successful ID and tag absence observations', async () => {
  const fixture = retirementFixture({ absent: true });
  assert.deepEqual(await retirePreviousBrowserImage(fixture.dependencies), { kind: 'server-browser-image-retirement', result: 'absent' });
  assert.equal(fixture.calls.length, 2);
  for (const options of [{ daemonFailure: true }, { inventoryMalformed: true }, { absent: true, foreignTag: true }]) {
    const denied = retirementFixture(options);
    const result = await retirePreviousBrowserImage(denied.dependencies);
    assert.equal(result.result, 'blocked');
    assert.equal(result.reason, 'retirement_inventory_failed');
    assert.equal(denied.calls.some(args => args[1] === 'rm'), false);
  }
});

test('retirement rejects mismatched images, stopped references, missing recovery evidence and races without broadening deletion', async () => {
  const cases = [
    { alterImage: value => { value[0].Id = 'sha256:' + 'f'.repeat(64); } },
    { alterImage: value => { value[0].RepoTags.push('unrelated:latest'); } },
    { alterImage: value => { value[0].RepoTags = []; } },
    { alterImage: value => { value[0].RepoDigests = ['unrelated@sha256:' + 'f'.repeat(64)]; } },
    { alterImage: value => { value[0].Config.User = '0:0'; } },
    { alterImage: value => { value[0].Config.Labels['org.arthello.role'] = 'application'; } },
    { alterImage: value => { value[0].Config.Labels['org.opencontainers.image.revision'] = 'f'.repeat(40); } },
    { fingerprint: 'f'.repeat(64) },
    { inspectFailure: true },
    { containerReference: true },
    { racedContainer: true },
    { alterImage: (value, count) => { if (count > 2) value[0].RepoTags.push('new-reference:latest'); } },
    { mainChanged: true },
    { githubFailure: true },
    { alterArchive: value => { value.expired = true; } },
    { alterArchive: value => { value.expires_at = '2026-09-08T00:00:00Z'; } },
    { alterArchive: value => { value.expires_at = 'not-a-date'; } },
    { alterArchive: value => { value.name = 'different-artifact'; } },
    { alterArchive: value => { value.digest = 'sha256:' + 'f'.repeat(64); } },
    { alterArchive: value => { value.size_in_bytes = 1; } },
    { alterArchive: value => { value.workflow_run.id = 1; } },
    { alterArchive: value => { value.workflow_run.head_sha = 'f'.repeat(40); } },
  ];
  for (const options of cases) {
    const fixture = retirementFixture(options);
    const result = await retirePreviousBrowserImage(fixture.dependencies);
    assert.equal(result.result, 'blocked');
    assert.match(result.reason, /^retirement_[a-z_]+_failed$/);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.equal(fixture.calls.some(args => args[1] === 'rm'), false);
  }
  const refused = retirementFixture({ removalRefused: true });
  assert.deepEqual(await retirePreviousBrowserImage(refused.dependencies), { kind: 'server-browser-image-retirement', result: 'blocked', reason: 'retirement_removal_failed' });
  assert.deepEqual(refused.calls.filter(args => args[1] === 'rm'), [['image', 'rm', '--no-prune', retiredImage.id]]);
  const ineffective = retirementFixture({ removalNoEffect: true });
  assert.deepEqual(await retirePreviousBrowserImage(ineffective.dependencies), { kind: 'server-browser-image-retirement', result: 'blocked', reason: 'retirement_removal_verification_failed' });
  assert.equal(ineffective.calls.filter(args => args[1] === 'rm').length, 1);
});

test('current retirement requires this verified job output and its recoverable producing artifact', async () => {
  const fixture = retirementFixture({ current: true });
  assert.deepEqual(await retireCurrentBrowserImage(fixture.dependencies), { kind: 'server-browser-image-retirement', result: 'retired' });
  assert.deepEqual(fixture.calls.filter(args => args[1] === 'rm'), [['image', 'rm', '--no-prune', fixture.target.id]]);
  assert.deepEqual(fixture.githubCalls, ['/git/ref/heads/main', '/actions/runs/34285119759/artifacts?per_page=100', '/git/ref/heads/main']);
  const partialRerun = retirementFixture({ current: true, environment: { GITHUB_RUN_ATTEMPT: '2' } });
  assert.equal((await retireCurrentBrowserImage(partialRerun.dependencies)).result, 'retired');
});

test('current retirement never selects a fallback image after missing verification, foreign identity or unproven artifact', async () => {
  const cases = [
    { environment: { BROWSER_IMAGE_ID: '' } },
    { environment: { BROWSER_IMAGE_ID: retiredImage.id } },
    { environment: { BROWSER_IMAGE_ID: 'sha256:' + 'd'.repeat(64) } },
    { environment: { EXPECTED_BROWSER_FINGERPRINT: '' } },
    { environment: { GITHUB_RUN_ID: '34285119759/../../other' } },
    { environment: { BROWSER_ARCHIVE_NAME: 'server-browser-' + retiredImage.source + '-34285119759-1' } },
    { environment: { BROWSER_ARCHIVE_NAME: 'server-browser-b52a5326f650060036d7ccd66a87e8d2d6a5a292-34285119759-2' } },
    { alterImage: value => { value[0].RepoTags.push('unrelated:latest'); } },
    { alterImage: value => { value[0].Config.Labels['org.opencontainers.image.revision'] = retiredImage.source; } },
    { fingerprint: 'f'.repeat(64) },
    { containerReference: true },
    { racedContainer: true },
    { mainChanged: true },
    { alterArchive: value => { value.workflow_run.head_sha = retiredImage.source; } },
    { alterArchive: value => { value.workflow_run.id = 34283447507; } },
    { alterArchive: value => { value.expired = true; } },
    { alterArchiveResponse: value => { value.total_count = 101; } },
    { alterArchiveResponse: value => { value.total_count = 2; value.artifacts.push(structuredClone(value.artifacts[0])); } },
    { alterArchiveResponse: value => { value.total_count = 0; value.artifacts = []; } },
  ];
  for (const options of cases) {
    const fixture = retirementFixture({ current: true, ...options });
    const result = await retireCurrentBrowserImage(fixture.dependencies);
    assert.equal(result.result, 'blocked');
    assert.match(result.reason, /^retirement_[a-z_]+_failed$/);
    assert.equal(fixture.calls.some(args => args[1] === 'rm'), false);
  }
});

test('retirement CLI rejects unknown modes and unverified current output without credentials or Docker', () => {
  const script = fileURLToPath(new URL('../../deploy/browser/retire-image.mjs', import.meta.url));
  for (const [args, reason] of [
    [['--target', 'PRIVATE_TARGET'], 'retirement_arguments_failed'],
    [['--current', 'PRIVATE_ARGUMENT'], 'retirement_arguments_failed'],
    [['--current'], 'retirement_current_inputs_failed'],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: {}, timeout: 5000 });
    assert.equal(result.status, 2);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), { kind: 'server-browser-image-retirement', result: 'blocked', reason });
  }
});

test('retirement accepts the observed single own-repository self digest for each bounded target', async () => {
  for (const current of [false, true]) {
    const fixture = retirementFixture({ current, alterImage: value => {
      value[0].RepoDigests = ['arthello-e2e@' + value[0].Id];
    } });
    const retire = current ? retireCurrentBrowserImage : retirePreviousBrowserImage;
    assert.deepEqual(await retire(fixture.dependencies), { kind: 'server-browser-image-retirement', result: 'retired' });
    assert.deepEqual(fixture.calls.filter(args => args[1] === 'rm'), [['image', 'rm', '--no-prune', fixture.target.id]]);
    assert.equal(fixture.calls.filter(args => args[1] === 'inspect').length, 4);
    assert.equal(fixture.calls.filter(args => args[0] === 'ps').length, 2);
    assert.equal(fixture.githubCalls.filter(path => path === '/git/ref/heads/main').length, 2);
    assert.ok(fixture.calls.slice(-2).every(args => args[1] === 'ls'));
  }
});

test('retirement still rejects null, arbitrary digests, foreign repositories and every extra reference', async () => {
  const shapes = [
    () => null,
    () => undefined,
    id => 'arthello-e2e@' + id,
    () => ['arthello-e2e@sha256:' + 'f'.repeat(64)],
    id => ['PRIVATE_REPOSITORY@' + id],
    id => ['arthello-e2e@' + id, 'arthello-e2e@' + id],
    id => ['arthello-e2e@' + id, 'PRIVATE_REPOSITORY@' + id],
    id => ['arthello-e2e@' + id + '\n'],
    () => [{ private: 'PRIVATE_DIGEST_VALUE' }],
  ];
  for (const current of [false, true]) {
    for (const shape of shapes) {
      const fixture = retirementFixture({ current, alterImage: value => { value[0].RepoDigests = shape(value[0].Id); } });
      const retire = current ? retireCurrentBrowserImage : retirePreviousBrowserImage;
      assert.deepEqual(await retire(fixture.dependencies), {
        kind: 'server-browser-image-retirement', result: 'blocked', reason: 'retirement_image_identity_failed',
      });
      assert.equal(fixture.calls.some(args => args[1] === 'rm'), false);
    }
  }
});

test('self-digest representation is rechecked immediately before retirement and cannot admit a changed reference', async () => {
  for (const current of [false, true]) {
    const fixture = retirementFixture({ current, alterImage: (value, count) => {
      value[0].RepoDigests = ['arthello-e2e@' + value[0].Id];
      if (count > 2) value[0].RepoDigests.push('PRIVATE_REFERENCE@' + value[0].Id);
    } });
    const retire = current ? retireCurrentBrowserImage : retirePreviousBrowserImage;
    assert.deepEqual(await retire(fixture.dependencies), {
      kind: 'server-browser-image-retirement', result: 'blocked', reason: 'retirement_final_image_identity_failed',
    });
    assert.equal(fixture.calls.some(args => args[1] === 'rm'), false);
  }
});
