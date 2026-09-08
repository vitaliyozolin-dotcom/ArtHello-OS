import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForRenderedRoot } from '../lib/visual-readiness.mjs';

function clock() {
  let time = 0;
  const waits = [];
  return { now: () => time, delay: async ms => { waits.push(ms); time += ms; }, waits };
}

test('already complete rendered document is accepted without a blind delay', async () => {
  const fake = clock();
  const audit = { rootRendered: true, documentReady: true };
  const result = await waitForRenderedRoot(async () => audit, fake);
  assert.equal(result.ready, true);
  assert.equal(result.audit, audit);
  assert.equal(result.attempts, 1);
  assert.deepEqual(fake.waits, []);
});

test('cold startup is polled until both document and root are ready', async () => {
  const fake = clock();
  const audits = [
    { rootRendered: false, documentReady: false },
    { rootRendered: false, documentReady: true },
    { rootRendered: true, documentReady: true },
  ];
  const result = await waitForRenderedRoot(async () => audits.shift(), fake);
  assert.equal(result.ready, true);
  assert.equal(result.attempts, 3);
  assert.deepEqual(fake.waits, [100, 100]);
});

test('empty root times out and retains failure evidence instead of passing', async () => {
  const fake = clock();
  const audit = { rootRendered: false, documentReady: true, interactive: [] };
  const result = await waitForRenderedRoot(async () => audit, { ...fake, timeoutMs: 250 });
  assert.equal(result.ready, false);
  assert.equal(result.audit, audit);
  assert.equal(result.attempts, 4);
  assert.deepEqual(fake.waits, [100, 100, 50]);
});

test('rendered root in an incomplete document is not readiness', async () => {
  const fake = clock();
  const result = await waitForRenderedRoot(async () => ({ rootRendered: true, documentReady: false }), { ...fake, timeoutMs: 100 });
  assert.equal(result.ready, false);
});

test('truthy nonboolean values cannot satisfy the readiness gate', async () => {
  for (const audit of [{ rootRendered: 'true', documentReady: true }, { rootRendered: true, documentReady: 1 }]) {
    const result = await waitForRenderedRoot(async () => audit, { ...clock(), timeoutMs: 100 });
    assert.equal(result.ready, false);
  }
});

test('browser evaluation failures are not hidden by retrying', async () => {
  await assert.rejects(waitForRenderedRoot(async () => { throw new Error('synthetic-cdp-failure'); }, clock()), /synthetic-cdp-failure/);
});

test('invalid polling bounds fail before browser evaluation', async () => {
  let reads = 0;
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: Infinity }, { timeoutMs: 60001 }, { pollMs: 0 }, { pollMs: NaN }, { pollMs: 1001 }]) {
    await assert.rejects(waitForRenderedRoot(async () => { reads += 1; }, options), /Invalid readiness bounds/);
  }
  assert.equal(reads, 0);
});
