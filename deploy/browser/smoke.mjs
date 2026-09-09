import assert from 'node:assert/strict';
import https from 'node:https';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ARTHELLO, SCHOOL, installNetworkBoundary, installCandidateGate, naturalFlow } from './flow.mjs';
import { startProxy } from './proxy.mjs';

// Hosted-only local HTTPS fixture, inside network:none. It exercises real 303
// redirects and the same proxy/network/UI flow; it cannot create live evidence.
export async function smoke(browser) {
  const directory = mkdtempSync(path.join(tmpdir(), 'browser-fixture-'));
  let server, proxy;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=browser-fixture.invalid', '-keyout', directory + '/key.pem', '-out', directory + '/cert.pem'], { stdio: 'ignore' });
    let owner = false;
    let finance = false;
    let loginCount = 0;
    let maintenance = false;
    const nonce = '7'.repeat(64); // Synthetic fixture only; never a production credential.
    let headerViolation = false;
    let authorizedHops = [];
    let schoolHops = 0;
    let businessWrites = 0;
    server = https.createServer({ key: readFileSync(directory + '/key.pem'), cert: readFileSync(directory + '/cert.pem') }, (request, response) => {
      request.resume();
      const url = new URL(request.url, 'https://' + request.headers.host);
      const html = body => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(body); };
      const json = (body, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
      const redirect = target => { response.writeHead(303, { location: target }); response.end(); };
      const hasCookie = name => (request.headers.cookie || '').split(';').some(part => part.trim() === name + '=fixture');
      if (url.origin === SCHOOL) {
        schoolHops++;
        if (request.headers.authorization || request.headers['x-arthello-candidate-gate']) headerViolation = true;
      }
      if (url.origin === ARTHELLO) {
        if (maintenance) {
          if (request.headers.authorization !== 'ArtHelloCandidate ' + nonce) {
            headerViolation = true;
            return json({ error: 'fixture_maintenance' }, 503);
          }
          authorizedHops.push(url.pathname);
        } else if (request.headers.authorization) headerViolation = true;
      }
      if (url.pathname === '/fixture-business-write' && request.method === 'POST') {
        businessWrites++;
        return json({ error: 'forbidden_fixture_write' }, 403);
      }
      if (url.pathname === '/fixture-same-origin') return redirect(ARTHELLO + '/');
      if (url.origin === ARTHELLO && url.pathname === '/') return html(`<form><input name="login"><input name="password" type="password"><button>Войти</button></form><script>document.querySelector('form').onsubmit=async(e)=>{e.preventDefault();await fetch('/api/auth/login',{method:'POST'});document.body.innerHTML='<aside aria-label="Основная навигация"><a href="#education">Обучение</a></aside>';document.querySelector('a').onclick=async(e)=>{e.preventDefault();await fetch('/api/education');document.body.insertAdjacentHTML('beforeend','<button id="diary">Открыть дневник</button>');document.querySelector('#diary').onclick=()=>location.assign('${SCHOOL}/auth/central/start');};};</script>`);
      if (url.origin === ARTHELLO && url.pathname === '/api/auth/login') {
        loginCount++;
        response.setHeader('Set-Cookie', 'arthello_session=fixture; Path=/; Secure; HttpOnly; SameSite=Lax');
        return json({ userId: 'fixture', isSystemOwner: owner, apiRole: owner ? 'OWNER' : 'EMPLOYEE', role: owner ? 'owner' : 'viewer', mustChangePassword: false, canAccessMedical: false, allowedModules: finance ? ['education', 'finance'] : ['education'] });
      }
      if (url.origin === ARTHELLO && ['/api/finance', '/api/medical', '/api/education', '/api/school-sso/authorize'].includes(url.pathname) && !hasCookie('arthello_session')) return json({ error: 'fixture_arthello_session_missing' }, 401);
      if (url.origin === ARTHELLO && url.pathname === '/api/finance') return json({ error: 'fixture' }, 403);
      if (url.origin === ARTHELLO && url.pathname === '/api/medical') return json({ error: 'fixture' }, 403);
      if (url.origin === ARTHELLO && url.pathname === '/api/education') return json({});
      if (url.origin === SCHOOL && url.pathname === '/auth/central/start') {
        response.setHeader('Set-Cookie', 'school_state=fixture; Path=/; Secure; HttpOnly; SameSite=Lax');
        return redirect(ARTHELLO + '/api/school-sso/authorize?state=fixture');
      }
      if (url.origin === ARTHELLO && url.pathname === '/api/school-sso/authorize') return redirect(SCHOOL + '/auth/central/callback?code=fixture&state=fixture');
      if (url.origin === SCHOOL && url.pathname === '/auth/central/callback') {
        if (!hasCookie('school_state')) return json({ error: 'fixture_school_state_missing' }, 401);
        response.setHeader('Set-Cookie', 'school_session=fixture; Path=/; Secure; HttpOnly; SameSite=Lax');
        return html(`<nav aria-label="Основная навигация">Дневник</nav><script>fetch('/api/school')</script>`);
      }
      if (url.origin === SCHOOL && url.pathname === '/api/school') {
        if (!hasCookie('school_session')) return json({ error: 'fixture_school_session_missing' }, 401);
        return json({ viewer: { email: 'fixture@example.invalid', role: 'teacher' } });
      }
      if (url.pathname === '/fixture-foreign-redirect') return redirect('https://example.invalid/');
      return json({ error: 'fixture_not_found' }, 404);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    proxy = await startProxy(() => net.connect({ host: '127.0.0.1', port: server.address().port }));
    const accounts = [{ owner: false, finance: false }, { owner: false, finance: true }, { owner: true, finance: false }];
    for (const scenario of [false, true].flatMap(candidate => accounts.map(account => ({ ...account, candidate })))) {
      owner = scenario.owner;
      finance = scenario.finance;
      maintenance = scenario.candidate;
      loginCount = 0;
      headerViolation = false;
      authorizedHops = [];
      schoolHops = 0;
      businessWrites = 0;
      // Only the local, self-signed fixture accepts its throwaway TLS cert.
      // The real entrypoint always sets ignoreHTTPSErrors:false.
      const context = await browser.newContext({ proxy: proxy.settings, ignoreHTTPSErrors: true, serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
      try {
        await installNetworkBoundary(context);
        const page = await context.newPage();
        const gate = maintenance ? await installCandidateGate(context, page, nonce) : undefined;
        page.setDefaultTimeout(10000);
        const task = naturalFlow(page, { login: 'fixture@example.invalid', password: 'fixture-password-only' }, stage => process.stderr.write('FIXTURE_STAGE=' + stage + '\n'));
        if (owner) await assert.rejects(task, /dedicated_employee_required/);
        else {
          const result = await task;
          assert.equal(result.result, 'pass');
          assert.equal(result.deniedApi, 'verified');
          assert.equal(result.deniedModule, finance ? 'medical' : 'finance');
          assert.ok(schoolHops >= 3, 'Natural School chain did not reach the real fixture server');
          if (maintenance) assert.ok(authorizedHops.includes('/api/school-sso/authorize'), 'Candidate header missing on the real redirect hop');
        }
        assert.equal(loginCount, 1);
        // Same-origin redirects also need a fresh per-hop header, and the
        // original global one-login/write policy remains in force.
        await page.goto(ARTHELLO + '/fixture-same-origin');
        const deniedWrites = await page.evaluate(async () => {
          const statuses = [];
          for (const endpoint of ['/api/auth/login', '/fixture-business-write']) {
            try { await fetch(endpoint, { method: 'POST' }); statuses.push('sent'); }
            catch { statuses.push('blocked'); }
          }
          return statuses;
        });
        assert.deepEqual(deniedWrites, ['blocked', 'blocked']);
        assert.equal(loginCount, 1);
        assert.equal(businessWrites, 0);
        assert.equal(headerViolation, false, 'Candidate header was absent or crossed the origin boundary');
        gate?.assertHealthy();
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
