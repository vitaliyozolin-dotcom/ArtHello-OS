import assert from 'node:assert/strict';
import https from 'node:https';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ARTHELLO, SCHOOL, installNetworkBoundary, naturalFlow } from './flow.mjs';
import { startProxy } from './proxy.mjs';

// Hosted-only local HTTPS fixture, inside network:none. It exercises real 303
// redirects and the same proxy/network/UI flow; it cannot create live evidence.
export async function smoke(browser) {
  const directory = mkdtempSync(path.join(tmpdir(), 'browser-fixture-'));
  let server, proxy;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=browser-fixture.invalid', '-keyout', directory + '/key.pem', '-out', directory + '/cert.pem'], { stdio: 'ignore' });
    let owner = false;
    let loginCount = 0;
    server = https.createServer({ key: readFileSync(directory + '/key.pem'), cert: readFileSync(directory + '/cert.pem') }, (request, response) => {
      request.resume();
      const url = new URL(request.url, 'https://' + request.headers.host);
      const html = body => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(body); };
      const json = (body, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
      const redirect = target => { response.writeHead(303, { location: target }); response.end(); };
      if (url.origin === ARTHELLO && url.pathname === '/') return html(`<form><input name="login"><input name="password" type="password"><button>Войти</button></form><script>document.querySelector('form').onsubmit=async(e)=>{e.preventDefault();await fetch('/api/auth/login',{method:'POST'});document.body.innerHTML='<aside aria-label="Основная навигация"><a href="#education">Обучение</a></aside>';document.querySelector('a').onclick=async(e)=>{e.preventDefault();await fetch('/api/education');document.body.insertAdjacentHTML('beforeend','<button id="diary">Открыть дневник</button>');document.querySelector('#diary').onclick=()=>location.assign('${SCHOOL}/auth/central/start');};};</script>`);
      if (url.origin === ARTHELLO && url.pathname === '/api/auth/login') {
        loginCount++;
        return json({ userId: 'fixture', isSystemOwner: owner, apiRole: owner ? 'OWNER' : 'EMPLOYEE', role: owner ? 'owner' : 'viewer', mustChangePassword: false, allowedModules: ['education'] });
      }
      if (url.origin === ARTHELLO && url.pathname === '/api/finance') return json({ error: 'fixture' }, 403);
      if (url.origin === ARTHELLO && url.pathname === '/api/education') return json({});
      if (url.origin === SCHOOL && url.pathname === '/auth/central/start') return redirect(ARTHELLO + '/api/school-sso/authorize?state=fixture');
      if (url.origin === ARTHELLO && url.pathname === '/api/school-sso/authorize') return redirect(SCHOOL + '/auth/central/callback?code=fixture&state=fixture');
      if (url.origin === SCHOOL && url.pathname === '/auth/central/callback') return html(`<nav aria-label="Основная навигация">Дневник</nav><script>fetch('/api/school')</script>`);
      if (url.origin === SCHOOL && url.pathname === '/api/school') return json({ viewer: { email: 'fixture@example.invalid', role: 'teacher' } });
      if (url.pathname === '/fixture-foreign-redirect') return redirect('https://example.invalid/');
      return json({ error: 'fixture_not_found' }, 404);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    proxy = await startProxy(() => net.connect({ host: '127.0.0.1', port: server.address().port }));
    for (owner of [false, true]) {
      loginCount = 0;
      // Only the local, self-signed fixture accepts its throwaway TLS cert.
      // The real entrypoint always sets ignoreHTTPSErrors:false.
      const context = await browser.newContext({ proxy: proxy.settings, ignoreHTTPSErrors: true, serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
      try {
        await installNetworkBoundary(context);
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        const task = naturalFlow(page, { login: 'fixture@example.invalid', password: 'fixture-password-only' }, stage => process.stderr.write('FIXTURE_STAGE=' + stage + '\n'));
        if (owner) await assert.rejects(task, /dedicated_employee_required/);
        else assert.equal((await task).result, 'pass');
        assert.equal(loginCount, 1);
        // A foreign destination reached through a 303 is blocked by CONNECT,
        // including redirects that Playwright routing itself does not inspect.
        await assert.rejects(page.goto(ARTHELLO + '/fixture-foreign-redirect'));
      } finally { await context.close(); }
    }
  } finally {
    await proxy?.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    rmSync(directory, { recursive: true, force: true });
  }
}
