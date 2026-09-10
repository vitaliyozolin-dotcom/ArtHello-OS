import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname } from 'node:path';

export const TOCHKA_AUTOSYNC_ACTIVATION_PATH = '/var/lib/arthello-v52-tochka-activation/tochka-autosync.activation';

// Only the post-verification one-shot writer UID1002 publishes in this dedicated
// volume. App UID1000 mounts it read-only; the backup worker has no such mount.
// V2 and a fresh nonce reject root-owned/V1 markers from all previous releases.
export async function hasTochkaAutosyncActivation({ releaseSha, activationId,
  markerPath = TOCHKA_AUTOSYNC_ACTIVATION_PATH, openMarker = open, openDirectory = open }) {
  if (!/^[0-9a-f]{40}$/.test(releaseSha ?? '') || !/^[0-9a-f]{64}$/.test(activationId ?? '')) return false;
  const expected = Buffer.from(`ARTHELLO_TOCHKA_AUTOSYNC_V2 ${releaseSha} ${activationId}\n`);
  let directory;
  let handle;
  try {
    directory = await openDirectory(dirname(markerPath), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const parent = await directory.stat();
    if (!parent.isDirectory() || parent.uid !== 1002 || parent.gid !== 1000 || (parent.mode & 0o7777) !== 0o750) return false;
    handle = await openMarker(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const safe = stat => stat.isFile() && stat.uid === 1002 && stat.gid === 1000 && stat.nlink === 1
      && (stat.mode & 0o7777) === 0o640 && stat.size === expected.length && stat.size <= 160;
    const before = await handle.stat();
    if (!safe(before)) return false;
    const bytes = Buffer.alloc(161);
    const result = await handle.read(bytes, 0, bytes.length, 0);
    const after = await handle.stat();
    return safe(after) && before.dev === after.dev && before.ino === after.ino
      && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs
      && result.bytesRead === expected.length && bytes.subarray(0, result.bytesRead).equals(expected);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
    await directory?.close().catch(() => {});
  }
}

export function startTochkaAutosyncTimer({ runtime, secret, publicOrigin, enabled,
  releaseSha = '', activationId = '',
  isActivated = () => hasTochkaAutosyncActivation({ releaseSha, activationId }), log = console.log,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (!enabled) return { stop() {} };
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error('TOCHKA_AUTOSYNC_SECRET_INVALID');
  const url = new URL('/api/integration-actions', publicOrigin).href;
  let stopped = false;
  let timer;
  const tick = async () => {
    if (stopped) return;
    try {
      if (!await isActivated() || stopped) return;
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
