// Hosted synthetic visual CI only. Production's natural-browser launcher is separate.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = code => Object.assign(new Error(code), { code });

export async function startVisualChrome(binary, { out, port = 0, timeoutMs = 30000, prefix = [] } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !Number.isFinite(timeoutMs)
      || timeoutMs <= 0 || timeoutMs > 30000) throw fail('BROWSER_STARTUP_BOUNDS');
  await fs.mkdir(out, { recursive: true });
  const receipt = { kind: 'visual-browser-startup', result: 'blocked', attempts: [] };
  const save = () => fs.writeFile(path.join(out, 'browser-startup.json'), JSON.stringify(receipt, null, 2) + '\n');
  for (let attempt = 1; attempt <= 2; attempt++) {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'arthello-visual-'));
    const row = { attempt, stage: 'startup', result: 'blocked', reason: 'CDP_NOT_READY', stderrBytes: 0 };
    receipt.attempts.push(row);
    const child = spawn(binary, [...prefix, '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let ended = false, startupOutput = '', reportedEndpoint = null;
    child.on('error', () => { ended = true; row.reason = 'CHROME_SPAWN'; });
    child.on('exit', (code, signal) => { ended = true; row.exitCode = code; row.signal = signal; });
    child.stderr.on('data', data => {
      row.stderrBytes = Math.min(1048576, row.stderrBytes + data.length);
      startupOutput = (startupOutput + data.toString()).slice(-4096);
      const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d{1,5})(\/devtools\/browser\/[a-f0-9-]{36})(?:\r?\n|$)/.exec(startupOutput);
      if (match) reportedEndpoint = `${match[1]}\n${match[2]}\n`;
    });
    let cleaned = false;
    const close = async () => {
      if (cleaned) return;
      if (!ended) child.kill('SIGTERM');
      const until = performance.now() + 2000;
      while (!ended && performance.now() < until) await delay(20);
      if (!ended) child.kill('SIGKILL');
      const forcedUntil = performance.now() + 2000;
      while (!ended && performance.now() < forcedUntil) await delay(20);
      if (!ended) throw fail('BROWSER_CLEANUP');
      await fs.rm(profile, { recursive: true, force: true });
      cleaned = true;
    };
    try {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        if (ended) throw fail(row.reason === 'CHROME_SPAWN' ? 'CHROME_SPAWN' : 'CHROME_EXIT');
        let raw;
        try { raw = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); }
        catch (error) { if (error.code !== 'ENOENT') throw fail('CDP_PROFILE'); }
        // Chrome with an explicit port reports its owned endpoint on stderr.
        if (raw === undefined && reportedEndpoint !== null) raw = reportedEndpoint;
        if (raw !== undefined) {
          const match = /^(\d{1,5})\n(\/devtools\/browser\/[a-f0-9-]{36})\n?$/.exec(raw);
          if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535
              || (port !== 0 && Number(match[1]) !== port)) throw fail('CDP_IDENTITY');
          const assigned = Number(match[1]);
          try {
            const response = await fetch(`http://127.0.0.1:${assigned}/json/version`,
              { redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(2000, Math.ceil(deadline - performance.now())))) });
            if (response.ok) {
              const text = await response.text();
              if (text.length > 4096) throw fail('CDP_IDENTITY');
              let value;
              try { value = JSON.parse(text); } catch { throw fail('CDP_IDENTITY'); }
              if (value.webSocketDebuggerUrl !== `ws://127.0.0.1:${assigned}${match[2]}`) throw fail('CDP_IDENTITY');
              if (ended) throw fail('CHROME_EXIT');
              row.result = 'ready'; row.reason = 'OWNED_CDP_READY';
              receipt.result = 'ready'; await save();
              return { port: assigned, close };
            }
          } catch (error) {
            if (['CDP_IDENTITY', 'CHROME_EXIT'].includes(error.code)) throw error;
          }
        }
        await delay(Math.min(100, Math.max(1, deadline - performance.now())));
      }
      throw fail('CDP_NOT_READY');
    } catch (error) {
      row.reason = ['CDP_PROFILE', 'CDP_IDENTITY', 'CHROME_EXIT', 'CHROME_SPAWN', 'CDP_NOT_READY'].includes(error.code)
        ? error.code : 'BROWSER_STARTUP_UNCLASSIFIED';
      await close(); await save();
      // At most one startup retry, before any page navigation or visual assertion.
      if (attempt === 2 || !['CHROME_EXIT', 'CDP_NOT_READY'].includes(row.reason)) throw fail(row.reason);
    }
  }
}
