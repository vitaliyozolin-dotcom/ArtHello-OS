export const ARTHELLO = 'https://arthello-188-225-38-55.sslip.io';
export const SCHOOL = 'https://school-188-225-38-55.sslip.io';

export function validateCredentials(input) {
  const login = typeof input?.login === 'string' ? input.login.trim() : '';
  const password = input?.password;
  if (!login || login.length > 254 || login.toLowerCase() === 'owner' || typeof password !== 'string' || password.length < 12 || password.length > 512) throw Error('credentials_invalid');
  return { login, password };
}

export function validateEmployee(user) {
  if (!user?.userId || user.isSystemOwner !== false || user.apiRole === 'OWNER' || user.role === 'owner') throw Error('dedicated_employee_required');
  if (user.mustChangePassword !== false) throw Error('permanent_password_required');
  if (!Array.isArray(user.allowedModules) || !user.allowedModules.includes('education')) throw Error('education_grant_missing');
}

function phone(value) {
  if (typeof value !== 'string' || !/^[+()\s\d-]+$/.test(value)) return '';
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('8') ? '7' + digits.slice(1) : digits;
}

export function sameSchoolIdentity(viewer, login) {
  if (!['teacher', 'methodist', 'deputy', 'director', 'admin', 'technical'].includes(viewer?.role)) return false;
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
  const user = await loginResponse.json();
  validateEmployee(user);
  credentials.password = '';
  await page.locator('aside[aria-label="Основная навигация"] a[href="#education"]').first().waitFor({ state: 'visible' });
  const feedbackVisible = await page.getByRole('button', { name: /Разработчикам/ }).first().isVisible();
  let deniedFinance = 'not_applicable';
  if (!user.allowedModules.includes('finance')) {
    if (await page.locator('aside a[href="#finance"]').count()) throw Error('denied_navigation_visible');
    const status = await page.evaluate(async () => (await fetch('/api/finance', { cache: 'no-store' })).status);
    if (status !== 403) throw Error('denied_api_not_forbidden');
    deniedFinance = 'verified';
  }
  stage('education');
  const [educationResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).origin === ARTHELLO && new URL(response.url()).pathname === '/api/education' && response.request().method() === 'GET'),
    page.locator('aside[aria-label="Основная навигация"] a[href="#education"]').first().click(),
  ]);
  if (educationResponse.status() !== 200) throw Error('education_rejected');
  const diary = page.getByRole('button', { name: /^(Открыть дневник|Перейти в дневник)$/ });
  await diary.waitFor({ state: 'visible' });
  stage('diary_navigation');
  const [schoolResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).origin === SCHOOL && new URL(response.url()).pathname === '/api/school' && response.request().method() === 'GET'),
    diary.click(),
  ]);
  if (schoolResponse.status() !== 200) throw Error('school_rejected');
  stage('school_identity');
  const snapshot = await schoolResponse.json();
  if (!sameSchoolIdentity(snapshot.viewer, credentials.login)) throw Error('school_identity_mismatch');
  if (JSON.stringify(observed) !== JSON.stringify(['school_start', 'arthello_authorize', 'school_callback'])) throw Error('natural_redirect_chain_missing');
  await page.locator('nav[aria-label="Основная навигация"]').first().waitFor({ state: 'visible' });
  if (new URL(page.url()).origin !== SCHOOL || await page.locator('input[type="password"]').count()) throw Error('school_diary_not_visible');
  stage('complete');
  return {
    result: 'pass', method: 'natural-browser-navigation', sessionInjected: false, callbackUrlConstructed: false,
    employeeAccount: 'verified', educationAccess: 'verified', schoolIdentity: 'verified', deniedFinance,
    feedbackVisible,
    verifiedSteps: ['open_education_in_authenticated_arthello', 'click_diary_entry', 'follow_natural_sso_redirects', 'authenticated_school_diary_visible'],
  };
}
