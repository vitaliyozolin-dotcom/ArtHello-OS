import test from 'node:test';
import assert from 'node:assert/strict';
import { capacity, RESERVE_KIB } from '../../deploy/browser/capacity.mjs';
import { validateCredentials, validateEmployee, sameSchoolIdentity, requestAllowed, navigationStep, inspectSandbox, selectDeniedProbe } from '../../deploy/browser/flow.mjs';
import * as browserFlow from '../../deploy/browser/flow.mjs';

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
