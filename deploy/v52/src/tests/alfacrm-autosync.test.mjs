import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = stripTypeScriptTypes(readFileSync(new URL('../lib/alfacrm-import.ts', import.meta.url), 'utf8'));
const { newAlfaAutosync, advanceAlfaAutosync, authenticateAlfaAutosync } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('successful cycle waits one hour, chunk continues without resetting its cursor', () => {
  let s = newAlfaAutosync(['families', 'subscriptions'], 'scope', 1000);
  s = advanceAlfaAutosync(s, { status: 200, previewToken: 'preview' }, 1000);
  assert.equal(s.phase, 'import');
  s = advanceAlfaAutosync(s, { status: 200, complete: true }, 2000);
  assert.equal(s.index, 1);
  assert.equal(s.phase, 'preview');
  s = advanceAlfaAutosync(s, { status: 200, previewToken: 'next' }, 3000);
  s = advanceAlfaAutosync(s, { status: 200, complete: false, nextCursor: 15 }, 4000);
  assert.equal(s.phase, 'import');
  assert.equal(s.cursor, 15);
  s = advanceAlfaAutosync(s, { status: 200, complete: true }, 5000);
  assert.equal(s.nextAt, 3605000);
  assert.equal(s.lastSuccessAt, 5000);
  assert.equal(s.index, 0);
});
test('retry has persisted backoff, bounded failures and no fabricated success', () => {
  let s = newAlfaAutosync(['families'], 'scope', 0);
  for (let i = 1; i <= 5; i++) {
    s = advanceAlfaAutosync(s, { status: 503 }, 1000);
    assert.equal(s.failures, i);
    assert.equal(s.lastSuccessAt, 0);
    assert.ok(s.nextAt >= 301000);
  }
  assert.equal(s.enabled, false);
});
test('data rejection, scope error and stalled chunks pause automatic writes', () => {
  for (const result of [{status:409}, {status:200,rejected:1}, {status:200,projectionBlocked:true}, {status:200,complete:false,nextCursor:0}]) {
    const s = newAlfaAutosync(['families'], 'scope', 0);
    s.phase = 'import';
    assert.equal(advanceAlfaAutosync(s, result, 1000).enabled, false);
  }
});
test('only permitted scope can be scheduled', () => {
  for (const modules of [[], ['finance'], ['lessons'], ['groups'], ['subscriptions']]) {
    assert.throws(() => newAlfaAutosync(modules, 'scope', 0));
  }
});
test('scheduler authorization rejects browser credentials and invalid secrets', async () => {
  const secret = 'a'.repeat(64);
  const request = headers => new Request('https://example.test/api/integrations/alfacrm', {method:'POST',headers});
  assert.equal(await authenticateAlfaAutosync(request({'x-arthello-alfa-autosync':secret}), secret), true);
  for (const headers of [{}, {'x-arthello-alfa-autosync':'b'.repeat(64)}, {'x-arthello-alfa-autosync':secret,cookie:'session=x'}, {'x-arthello-alfa-autosync':secret,origin:'https://example.test'}]) {
    assert.equal(await authenticateAlfaAutosync(request(headers), secret), false);
  }
  assert.equal(await authenticateAlfaAutosync(request({'x-arthello-alfa-autosync':secret}), ''), false);
});

test('timer serializes requests, suppresses response data and does not restart after stop', async () => {
  const { startAlfaAutosyncTimer } = await import('../production/alfacrm-autosync-timer.mjs');
  const queue = []; const logs = []; let finish; let calls = 0;
  const timer = startAlfaAutosyncTimer({ enabled:true,secret:'a'.repeat(64),publicOrigin:'https://example.test',
    setTimer: fn => {queue.push(fn);return 1;}, clearTimer:()=>{},log:m=>logs.push(m),
    runtime:{dispatchFetch:async (url, options)=>{
      calls++; assert.equal(url,'https://example.test/api/integrations/alfacrm');
      assert.equal(options.headers['x-arthello-alfa-autosync'],'a'.repeat(64));
      await new Promise(resolve=>{finish=resolve;});
      return Response.json({ran:true,outcome:'private payload must not be logged'});
    }},
  });
  const pending=queue.shift()();
  assert.equal(calls,1); assert.equal(queue.length,0);
  timer.stop(); finish(); await pending;
  assert.equal(queue.length,0);
  assert.deepEqual(logs,['ALFACRM_AUTOSYNC_TICK=INVALID_RESPONSE']);
});
