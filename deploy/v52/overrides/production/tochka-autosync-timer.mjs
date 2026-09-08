export function startTochkaAutosyncTimer({ runtime, secret, publicOrigin, enabled, log = console.log,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (!enabled) return { stop() {} };
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error('TOCHKA_AUTOSYNC_SECRET_INVALID');
  const url = new URL('/api/integration-actions', publicOrigin).href;
  let stopped = false;
  let timer;
  const tick = async () => {
    if (stopped) return;
    try {
      const response = await runtime.dispatchFetch(url, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-arthello-tochka-autosync': secret }, body: '{}' });
      if (!response.ok) log(`TOCHKA_AUTOSYNC_TICK=HTTP_${response.status}`);
      else {
        const result = await response.json();
        const outcome = new Set(['complete', 'pending', 'busy', 'error', 'superseded', 'disabled', 'not_due']).has(result.outcome)
          ? result.outcome : 'invalid_response';
        if (result.ran || outcome === 'invalid_response') log(`TOCHKA_AUTOSYNC_TICK=${outcome.toUpperCase()}`);
      }
    } catch { log('TOCHKA_AUTOSYNC_TICK=FAILED'); }
    finally {
      if (!stopped) { timer = setTimer(tick, 60_000); timer?.unref?.(); }
    }
  };
  timer = setTimer(tick, 30_000);
  timer?.unref?.();
  return { stop() { stopped = true; clearTimer(timer); } };
}
