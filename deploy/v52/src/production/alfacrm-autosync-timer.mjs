export function startAlfaAutosyncTimer({ runtime, secret, publicOrigin, enabled,
  log = console.log, setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (!enabled) return { stop() {} };
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('ALFACRM_AUTOSYNC_SECRET_INVALID');
  const url = new URL('/api/integrations/alfacrm', publicOrigin).href;
  let stopped = false;
  let timer;
  async function tick() {
    if (stopped) return;
    try {
      const response = await runtime.dispatchFetch(url, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-arthello-alfa-autosync': secret }, body: '{}' });
      if (!response.ok) log(`ALFACRM_AUTOSYNC_TICK=HTTP_${response.status}`);
      else {
        const result = await response.json();
        const allowed = ['disabled', 'not_due', 'pending', 'complete', 'retry', 'paused'];
        const outcome = allowed.includes(result.outcome) ? result.outcome : 'invalid_response';
        if (result.ran || outcome === 'invalid_response') log(`ALFACRM_AUTOSYNC_TICK=${outcome.toUpperCase()}`);
      }
    } catch { log('ALFACRM_AUTOSYNC_TICK=FAILED'); }
    finally {
      if (!stopped) { timer = setTimer(tick, 60_000); timer?.unref?.(); }
    }
  }
  timer = setTimer(tick, 30_000);
  timer?.unref?.();
  return { stop() { stopped = true; clearTimer(timer); } };
}
