import { chromium } from 'playwright-core';
import { installNetworkBoundary, naturalFlow } from './flow.mjs';

let browser;
let stage = 'sandbox';
let result;
try {
  if (process.getuid() !== 1000 || process.getgid() !== 1000 || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error();
  // chromiumSandbox is deliberately enabled. No --no-sandbox, SYS_ADMIN,
  // privileged mode, host IPC, Docker socket or application volume is needed.
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 20000,
    args: ['--disable-background-networking', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
  const sandboxContext = await browser.newContext();
  const sandboxPage = await sandboxContext.newPage();
  await sandboxPage.goto('chrome://sandbox');
  const sandbox = await sandboxPage.locator('body').innerText();
  if (!/Namespace sandbox\s+Yes/.test(sandbox) || !/PID namespaces\s+Yes/.test(sandbox) || !/Seccomp-BPF sandbox\s+Yes/.test(sandbox)) throw Error();
  await sandboxContext.close();
  if (process.argv[2] === '--smoke') {
    const { smoke } = await import('./smoke.mjs');
    await smoke(browser);
    result = { kind: 'hosted-browser-fixture', result: 'pass', chromiumSandbox: 'verified', liveAcceptance: 'not_run' };
  } else {
    stage = 'credential_input';
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 8192) throw Error();
    }
    const credentials = JSON.parse(input);
    input = '';
    const context = await browser.newContext({ ignoreHTTPSErrors: false, serviceWorkers: 'block', acceptDownloads: false, viewport: { width: 1440, height: 1000 } });
    await installNetworkBoundary(context);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(20000);
    result = { kind: 'server-natural-sso', chromiumSandbox: 'verified', ...await naturalFlow(page, credentials, value => { stage = value; }) };
    await context.close();
  }
} catch {
  result = { kind: process.argv[2] === '--smoke' ? 'hosted-browser-fixture' : 'server-natural-sso', result: 'blocked', stage, liveAcceptance: 'not_passed' };
  process.exitCode = 2;
} finally {
  await browser?.close().catch(() => {});
}
// Do not log exception messages, response bodies, contacts, cookies or URLs.
process.stdout.write(JSON.stringify({ ...result, observedAtUtc: new Date().toISOString() }) + '\n');
