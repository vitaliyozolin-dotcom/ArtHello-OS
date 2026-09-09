export const ARTHELLO = 'https://arthello-188-225-38-55.sslip.io';
export const SCHOOL = 'https://school-188-225-38-55.sslip.io';

const employeeFailureReasons = new Set([
  'login_rejected', 'dedicated_employee_required', 'permanent_password_required', 'education_grant_missing',
  'denied_probe_missing', 'denied_navigation_visible', 'denied_api_not_forbidden',
  'unreadable_login_response', 'employee_navigation_unavailable',
]);

const failureReasonsByStage = new Map([
  ['employee_access', employeeFailureReasons],
  ['feedback', new Set(['feedback_open_failed', 'feedback_response_missing', 'feedback_list_forbidden', 'feedback_list_rejected',
    'feedback_dialog_missing', 'feedback_own_list_failed', 'feedback_all_control_visible', 'feedback_close_failed'])],
  ['backup_access', new Set(['backup_probe_failed', 'backup_api_not_forbidden'])],
  ['education', new Set(['education_response_missing', 'education_navigation_failed', 'education_forbidden', 'education_rejected', 'diary_entry_not_visible'])],
  ['diary_navigation', new Set(['school_response_missing', 'diary_entry_click_failed', 'school_forbidden', 'school_rejected'])],
  ['school_identity', new Set(['unreadable_school_response', 'school_identity_mismatch', 'natural_redirect_chain_missing', 'school_navigation_unavailable', 'school_diary_not_visible'])],
]);

export function safeFailureReason(stage, error) {
  const reasons = failureReasonsByStage.get(stage);
  const fallback = stage === 'employee_access' ? 'employee_access_failed' : 'browser_check_failed';
  if (!reasons) return fallback;
  // Exact tags only: never interpolate an exception, response, contact or URL.
  try {
    const message = error instanceof Error ? error.message : '';
    return reasons.has(message) ? message : fallback;
  } catch { return fallback; }
}

export function inspectSandbox(rows) {
  return { namespaces: rows['Layer 1 Sandbox'] === 'Namespace', pidNamespaces: rows['PID namespaces'] === 'Yes', networkNamespaces: rows['Network namespaces'] === 'Yes', seccomp: rows['Seccomp-BPF sandbox'] === 'Yes' };
}

export function validateCredentials(input) {
  const login = typeof input?.login === 'string' ? input.login.trim() : '';
  const password = input?.password;
  if (!login || login.length > 254 || login.toLowerCase() === 'owner' || typeof password !== 'string' || password.length < 12 || password.length > 512) throw Error('credentials_invalid');
  return { login, password };
}

export function validateMaintenanceNonce(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length !== 64 || !/^[a-f0-9]{64}$/.test(value)) throw Error('candidate_nonce_invalid');
  return value;
}

export function validateBrowserInput(input) {
  const credentials = validateCredentials(input);
  const maintenanceNonce = validateMaintenanceNonce(input?.maintenanceNonce);
  return maintenanceNonce === undefined ? credentials : { ...credentials, maintenanceNonce };
}

export function validateEmployee(user) {
  if (!user?.userId || user.isSystemOwner !== false || user.apiRole === 'OWNER' || user.role === 'owner') throw Error('dedicated_employee_required');
  if (user.mustChangePassword !== false) throw Error('permanent_password_required');
  if (!Array.isArray(user.allowedModules) || !user.allowedModules.includes('education')) throw Error('education_grant_missing');
}

export function selectDeniedProbe(user) {
  if (!user.allowedModules.includes('finance')) return { module: 'finance', path: '/api/finance' };
  if (!user.allowedModules.includes('medical') || user.canAccessMedical === false) return { module: 'medical', path: '/api/medical' };
  throw Error('denied_probe_missing');
}

function phone(value) {
  if (typeof value !== 'string' || !/^[+()\s\d-]+$/.test(value)) return '';
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('8') ? '7' + digits.slice(1) : digits;
}

export function sameSchoolIdentity(viewer, login) {
  // Match the central issuer's canonical SchoolRole union, not legacy roles.
  if (!['teacher', 'deputy', 'director', 'admin', 'tech_admin'].includes(viewer?.role)) return false;
  if (login.includes('@')) return typeof viewer.email === 'string' && viewer.email.toLowerCase() === login.toLowerCase();
  const normalized = phone(login);
  return normalized.length >= 10 && normalized === phone(viewer.phone);
}

export function requestAllowed(url, method) {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || ![ARTHELLO, SCHOOL].includes(parsed.origin)) return false;
    if (method === 'GET' || method === 'HEAD') return true;
    return method === 'POST' && parsed.origin === ARTHELLO && parsed.pathname === '/api/auth/login' && !parsed.search;
  } catch { return false; }
}

export function navigationStep(url) {
  try {
    const parsed = new URL(url);
    if (parsed.origin === SCHOOL && parsed.pathname === '/auth/central/start') return 'school_start';
    if (parsed.origin === ARTHELLO && parsed.pathname === '/api/school-sso/authorize') return 'arthello_authorize';
    if (parsed.origin === SCHOOL && parsed.pathname === '/auth/central/callback') return 'school_callback';
  } catch { /* Only fixed event names leave this observer. */ }
  return null;
}

export async function installNetworkBoundary(context) {
  let loginAttempts = 0;
  await context.route('**/*', async route => {
    const request = route.request();
    if (!requestAllowed(request.url(), request.method())) return route.abort('blockedbyclient');
    if (request.method() === 'POST' && ++loginAttempts > 1) return route.abort('blockedbyclient');
    return route.continue();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
}

// Keep the context-wide network/write policy above active for every page.
// Never set this secret with Playwright route.continue headers: Playwright
// carries those overrides across redirects. CDP Fetch.continueRequest applies
// its header override to one request only, including each real redirect hop.
// https://chromedevtools.github.io/devtools-protocol/tot/Fetch/#method-continueRequest
export async function installCandidateGate(context, page, value) {
  const nonce = validateMaintenanceNonce(value);
  if (!nonce || page.context() !== context) throw Error('candidate_nonce_invalid');
  const session = await context.newCDPSession(page);
  let failed = false;
  let loginAttempts = 0;
  session.on('Fetch.requestPaused', async event => {
    try {
      const request = event.request;
      if (failed || !requestAllowed(request.url, request.method) || (request.method === 'POST' && ++loginAttempts > 1)) {
        await session.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
        return;
      }
      const headers = Object.entries(request.headers).filter(([name]) => !['authorization', 'x-arthello-candidate-gate'].includes(name.toLowerCase()))
        .map(([name, headerValue]) => ({ name, value: String(headerValue) }));
      if (new URL(request.url).origin === ARTHELLO) headers.push({ name: 'Authorization', value: 'ArtHelloCandidate ' + nonce });
      await session.send('Fetch.continueRequest', { requestId: event.requestId, headers });
    } catch {
      failed = true;
      await session.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      await context.close().catch(() => {});
    }
  });
  await session.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  return { assertHealthy() { if (failed) throw Error('candidate_network_boundary_failed'); } };
}

// Ordinary employee navigation may lazily initialize the feedback schema. This is
// not D075's database-only observation. Inspect statuses and UI structure only:
// never read/report feedback bodies, fill the form, send, or change a status.
export async function employeeReadControls(page, stage = () => {}) {
  stage('feedback');
  const trigger = page.getByRole('button', { name: 'Разработчикам', exact: true }).first();
  const ownListResponse = () => page.waitForResponse(response =>
    response.url() === ARTHELLO + '/api/developer-feedback?scope=mine' && response.request().method() === 'GET')
    .catch(() => { throw Error('feedback_response_missing'); });
  const requireOwnList = response => {
    if (response.status() === 403) throw Error('feedback_list_forbidden');
    if (response.status() !== 200) throw Error('feedback_list_rejected');
  };
  const [opened] = await Promise.all([
    ownListResponse(), trigger.click().catch(() => { throw Error('feedback_open_failed'); }),
  ]);
  requireOwnList(opened);
  const dialog = page.getByRole('dialog', { name: 'Разработчикам', exact: true });
  await dialog.waitFor({ state: 'visible' }).catch(() => { throw Error('feedback_dialog_missing'); });
  const [listed] = await Promise.all([
    ownListResponse(),
    dialog.getByRole('button', { name: 'Мои обращения', exact: true }).click()
      .catch(() => { throw Error('feedback_own_list_failed'); }),
  ]);
  requireOwnList(listed);
  await dialog.locator('section[aria-label="Мои обращения"][aria-busy="false"]').waitFor({ state: 'visible' })
    .catch(() => { throw Error('feedback_own_list_failed'); });
  if (await dialog.getByRole('alert').count()) throw Error('feedback_own_list_failed');
  if (await dialog.getByRole('button', { name: 'Все обращения', exact: true }).count()) throw Error('feedback_all_control_visible');
  await dialog.getByRole('button', { name: 'Закрыть обращения', exact: true }).click()
    .catch(() => { throw Error('feedback_close_failed'); });
  await dialog.waitFor({ state: 'hidden' }).catch(() => { throw Error('feedback_close_failed'); });
  stage('backup_access');
  const backupStatus = await page.evaluate(async endpoint => (await fetch(endpoint, { cache: 'no-store', redirect: 'error' })).status, '/api/settings/backups')
    .catch(() => { throw Error('backup_probe_failed'); });
  if (backupStatus !== 403) throw Error('backup_api_not_forbidden');
  return { feedbackVisible: true, feedbackDialog: 'verified', feedbackOwnList: 'verified',
    feedbackAllHidden: 'verified', backupApiDenied: 'verified' };
}

// Production and hosted fixture execute this same interaction. No API-created
// session, cookie injection, prebuilt callback, trace or screenshot is used.
export async function naturalFlow(page, input, stage = () => {}) {
  const credentials = validateCredentials(input);
  const observed = [];
  page.on('request', request => {
    if (!request.isNavigationRequest()) return;
    const step = navigationStep(request.url());
    if (step && observed.at(-1) !== step && observed.length < 20) observed.push(step);
  });
  stage('login_form');
  await page.goto(ARTHELLO + '/', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="login"]').fill(credentials.login);
  await page.locator('input[name="password"]').fill(credentials.password);
  const [loginResponse] = await Promise.all([
    page.waitForResponse(response => response.url() === ARTHELLO + '/api/auth/login' && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Войти', exact: true }).click(),
  ]);
  stage('employee_access');
  if (loginResponse.status() !== 200) throw Error('login_rejected');
  let user;
  try { user = await loginResponse.json(); } catch { throw Error('unreadable_login_response'); }
  validateEmployee(user);
  credentials.password = '';
  try {
    await page.locator('aside[aria-label="Основная навигация"] a[href="#education"]').first().waitFor({ state: 'visible' });
  } catch { throw Error('employee_navigation_unavailable'); }
  const denied = selectDeniedProbe(user);
  if (await page.locator('aside a[href="#' + denied.module + '"]').count()) throw Error('denied_navigation_visible');
  const deniedStatus = await page.evaluate(async endpoint => (await fetch(endpoint, { cache: 'no-store' })).status, denied.path);
  if (deniedStatus !== 403) throw Error('denied_api_not_forbidden');
  const employeeControls = await employeeReadControls(page, stage);
  stage('education');
  const [educationResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).origin === ARTHELLO && new URL(response.url()).pathname === '/api/education' && response.request().method() === 'GET')
      .catch(() => { throw Error('education_response_missing'); }),
    page.locator('aside[aria-label="Основная навигация"] a[href="#education"]').first().click()
      .catch(() => { throw Error('education_navigation_failed'); }),
  ]);
  if (educationResponse.status() === 403) throw Error('education_forbidden');
  if (educationResponse.status() !== 200) throw Error('education_rejected');
  const diary = page.getByRole('button', { name: /^(Открыть дневник|Перейти в дневник)$/ });
  try { await diary.waitFor({ state: 'visible' }); } catch { throw Error('diary_entry_not_visible'); }
  stage('diary_navigation');
  const [schoolResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).origin === SCHOOL && new URL(response.url()).pathname === '/api/school' && response.request().method() === 'GET')
      .catch(() => { throw Error('school_response_missing'); }),
    diary.click().catch(() => { throw Error('diary_entry_click_failed'); }),
  ]);
  if (schoolResponse.status() === 403) throw Error('school_forbidden');
  if (schoolResponse.status() !== 200) throw Error('school_rejected');
  stage('school_identity');
  let snapshot;
  try { snapshot = await schoolResponse.json(); } catch { throw Error('unreadable_school_response'); }
  if (!sameSchoolIdentity(snapshot.viewer, credentials.login)) throw Error('school_identity_mismatch');
  if (JSON.stringify(observed) !== JSON.stringify(['school_start', 'arthello_authorize', 'school_callback'])) throw Error('natural_redirect_chain_missing');
  try {
    await page.locator('nav[aria-label="Основная навигация"]').first().waitFor({ state: 'visible' });
  } catch { throw Error('school_navigation_unavailable'); }
  if (new URL(page.url()).origin !== SCHOOL || await page.locator('input[type="password"]').count()) throw Error('school_diary_not_visible');
  stage('complete');
  return {
    result: 'pass', method: 'natural-browser-navigation', sessionInjected: false, callbackUrlConstructed: false,
    employeeAccount: 'verified', educationAccess: 'verified', schoolIdentity: 'verified', deniedApi: 'verified', deniedModule: denied.module,
    ...employeeControls,
    verifiedSteps: ['open_education_in_authenticated_arthello', 'click_diary_entry', 'follow_natural_sso_redirects', 'authenticated_school_diary_visible'],
  };
}
