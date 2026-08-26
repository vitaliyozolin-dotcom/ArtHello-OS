#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const canon = JSON.parse(await fs.readFile(path.join(ROOT, 'quality-gates', 'visual-canon.json'), 'utf8'));
const arg = (name, fallback) => {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
};
const APP_URL = arg('--url', 'http://127.0.0.1:4173/');
const OUT = path.resolve(process.cwd(), arg('--out', '.artifacts/visual-acceptance'));
const PORT = Number(arg('--cdp-port', '9223'));

function chromeBinary() {
  const candidates = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const candidate of candidates) {
    const result = spawnSync('bash', ['-lc', `command -v ${candidate}`], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error('Chrome/Chromium binary not found on runner.');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function fetchJson(url, attempts = 40) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      last = new Error(`HTTP ${response.status}`);
    } catch (error) {
      last = error;
    }
    await sleep(250);
  }
  throw last ?? new Error(`Unable to fetch ${url}`);
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    this.ws.close();
  }
}

function auditExpression() {
  return `(() => {
    const visible = (el) => {
      const s = getComputedStyle(el); const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && s.pointerEvents !== 'none' && Number(s.opacity || 1) !== 0 && !el.closest('[aria-hidden="true"]') && !el.closest('[inert]') && r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
    };
    const root = document.querySelector('#root');
    const selectors = 'button,a,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"]';
    const interactive = [...document.querySelectorAll(selectors)].filter(visible).map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, text: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '').trim().slice(0, 80), left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height };
    });
    const dialogs = [...document.querySelectorAll('[role="dialog"],dialog,[data-radix-dialog-content]')].filter(visible).map((el) => {
      const r = el.getBoundingClientRect();
      return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height, centerX:r.left+r.width/2, centerY:r.top+r.height/2 };
    });
    return {
      url: location.href,
      title: document.title,
      rootRendered: Boolean(root && root.childElementCount > 0 && (root.textContent || '').trim().length > 0),
      viewport: { width: innerWidth, height: innerHeight },
      documentSize: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, scrollHeight: document.documentElement.scrollHeight },
      interactive,
      dialogs
    };
  })()`;
}

await fs.mkdir(OUT, { recursive: true });
const userDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arthello-visual-'));
const chrome = spawn(chromeBinary(), [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDir}`,
  'about:blank'
], { stdio: 'ignore' });

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  engine: 'ArtHello Visual Acceptance Gate',
  url: APP_URL,
  viewports: [],
  failures: []
};

try {
  const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
  const target = targets.find((item) => item.type === 'page');
  if (!target?.webSocketDebuggerUrl) throw new Error('No CDP page target found.');
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');

  for (const viewport of canon.viewports) {
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
      mobile: viewport.id === 'mobile'
    });
    await cdp.call('Page.navigate', { url: APP_URL });
    await sleep(1800);
    const evaluated = await cdp.call('Runtime.evaluate', {
      expression: auditExpression(),
      returnByValue: true
    });
    const audit = evaluated.result.value;
    const failures = [];
    if (audit.viewport.width !== viewport.width || audit.viewport.height !== viewport.height) {
      failures.push(`VIEWPORT_MISMATCH:${audit.viewport.width}x${audit.viewport.height}`);
    }
    if (canon.rules.root_must_render && !audit.rootRendered) failures.push('ROOT_NOT_RENDERED');
    const overflow = Math.max(0, audit.documentSize.scrollWidth - audit.documentSize.clientWidth);
    if (overflow > canon.rules.max_horizontal_overflow_px) failures.push(`HORIZONTAL_OVERFLOW:${overflow}`);
    const tol = canon.rules.interactive_viewport_tolerance_px ?? 0;
    const offscreen = audit.interactive.filter((item) => item.left < -tol || item.right > viewport.width + tol);
    if (offscreen.length) failures.push(`OFFSCREEN_INTERACTIVE:${offscreen.length}`);
    const centerTol = canon.rules.dialog_center_tolerance_px ?? 40;
    const badDialogs = audit.dialogs.filter((dialog) =>
      dialog.left < -tol || dialog.right > viewport.width + tol || dialog.top < -tol || dialog.bottom > viewport.height + tol || Math.abs(dialog.centerX - viewport.width / 2) > centerTol
    );
    if (badDialogs.length) failures.push(`DIALOG_NOT_CENTERED:${badDialogs.length}`);

    const shot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const screenshot = path.join(OUT, `${viewport.id}.png`);
    await fs.writeFile(screenshot, Buffer.from(shot.data, 'base64'));
    report.viewports.push({
      id: viewport.id,
      width: viewport.width,
      height: viewport.height,
      overflow_px: overflow,
      interactive_count: audit.interactive.length,
      dialog_count: audit.dialogs.length,
      offscreen_interactive: offscreen,
      bad_dialogs: badDialogs,
      screenshot: path.basename(screenshot),
      failures
    });
    report.failures.push(...failures.map((failure) => ({ viewport: viewport.id, failure })));
  }
  cdp.close();
} finally {
  chrome.kill('SIGTERM');
  await sleep(250);
  await fs.rm(userDir, { recursive: true, force: true }).catch(() => {});
}

report.summary = {
  viewports: report.viewports.length,
  failures: report.failures.length,
  status: report.failures.length ? 'FAILED' : 'ACCEPTED'
};
await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
if (report.failures.length) {
  console.error(`Visual Acceptance: FAILED (${report.failures.length}). Evidence: ${OUT}`);
  process.exit(1);
}
console.log(`Visual Acceptance: ACCEPTED ${report.viewports.length} viewport(s). Evidence: ${OUT}`);
