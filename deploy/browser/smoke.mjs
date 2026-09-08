import assert from 'node:assert/strict';
import { ARTHELLO, SCHOOL, installNetworkBoundary, naturalFlow } from './flow.mjs';

// Hosted-only synthetic fixture. Separate from production; cannot produce a
// release receipt. Exercises the real browser, login form, click and redirects.
export async function smoke(browser) {
  for (const owner of [false, true]) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
    const user = { userId: 'fixture', isSystemOwner: owner, apiRole: owner ? 'OWNER' : 'EMPLOYEE', role: owner ? 'owner' : 'viewer', mustChangePassword: false, allowedModules: ['education'] };
    let loginCount = 0;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      const html = body => route.fulfill({ contentType: 'text/html', body });
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.origin === ARTHELLO && url.pathname === '/') return html(`<form><input name="login"><input name="password" type="password"><button>Войти</button></form><script>document.querySelector('form').onsubmit=async(e)=>{e.preventDefault();await fetch('/api/auth/login',{method:'POST'});document.body.innerHTML='<aside aria-label="Основная навигация"><a href="#education">Обучение</a></aside>';document.querySelector('a').onclick=async(e)=>{e.preventDefault();await fetch('/api/education');document.body.insertAdjacentHTML('beforeend','<button id="diary">Открыть дневник</button>');document.querySelector('#diary').onclick=()=>location.assign('${SCHOOL}/auth/central/start');};};</script>`);
      if (url.origin === ARTHELLO && url.pathname === '/api/auth/login') { loginCount++; return json(user); }
      if (url.origin === ARTHELLO && url.pathname === '/api/finance') return json({ error: 'fixture' }, 403);
      if (url.origin === ARTHELLO && url.pathname === '/api/education') return json({});
      // A mocked HTTP redirect is followed by Chromium outside route handlers.
      // Use fixture-only document navigation so the network:none test remains
      // fully synthetic. The live flow still follows real server redirects.
      if (url.origin === SCHOOL && url.pathname === '/auth/central/start') return html(`<script>location.assign('${ARTHELLO}/api/school-sso/authorize?state=fixture')</script>`);
      if (url.origin === ARTHELLO && url.pathname === '/api/school-sso/authorize') return html(`<script>location.assign('${SCHOOL}/auth/central/callback?code=fixture&state=fixture')</script>`);
      if (url.origin === SCHOOL && url.pathname === '/auth/central/callback') return html(`<nav aria-label="Основная навигация">Дневник</nav><script>fetch('/api/school')</script>`);
      if (url.origin === SCHOOL && url.pathname === '/api/school') return json({ viewer: { email: 'fixture@example.invalid', role: 'teacher' } });
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => process.stderr.write('FIXTURE_PAGE_ERROR=' + String(error.message).slice(0,2000) + '\n'));
    page.on('requestfailed', request => process.stderr.write('FIXTURE_REQUEST_FAILED=' + new URL(request.url()).pathname + '\n'));
    page.on('response', response => process.stderr.write('FIXTURE_RESPONSE=' + new URL(response.url()).pathname + ':' + response.status() + '\n'));
    page.setDefaultTimeout(10000);
    const task = naturalFlow(page, { login: 'fixture@example.invalid', password: 'fixture-password-only' }, stage => process.stderr.write('FIXTURE_STAGE=' + stage + '\n'));
    if (owner) await assert.rejects(task, /dedicated_employee_required/);
    else assert.equal((await task).result, 'pass');
    assert.equal(loginCount, 1);
    await context.close();
  }
  const restricted = await browser.newContext();
  await installNetworkBoundary(restricted);
  const page = await restricted.newPage();
  await assert.rejects(page.goto('https://example.invalid/'));
  await restricted.close();
}
