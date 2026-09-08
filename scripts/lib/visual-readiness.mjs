// A readiness deadline does not relax any visual assertion. The caller must
// reject ready=false even if a partially loaded document already contains text.
export async function waitForRenderedRoot(readAudit, {
  timeoutMs = 10000,
  pollMs = 100,
  now = () => performance.now(),
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000
    || !Number.isFinite(pollMs) || pollMs <= 0 || pollMs > 1000) {
    throw new Error('Invalid readiness bounds');
  }
  const deadline = now() + timeoutMs;
  let attempts = 0;
  for (;;) {
    const audit = await readAudit();
    attempts += 1;
    if (audit?.rootRendered === true && audit?.documentReady === true) {
      return { ready: true, audit, attempts };
    }
    const remaining = deadline - now();
    if (remaining <= 0) return { ready: false, audit, attempts };
    await delay(Math.min(pollMs, remaining));
  }
}
