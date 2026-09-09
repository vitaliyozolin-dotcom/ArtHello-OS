import assert from "node:assert/strict";
import test from "node:test";
import { startSessionRefresh } from "../lib/session-refresh.ts";

const settle = () => new Promise((resolve) => setImmediate(resolve));
function setup(request) {
  const windowTarget = new EventTarget();
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const state = { users: [], expired: 0, timer: null, delay: 0, cancelled: false };
  const stop = startSessionRefresh({
    request,
    windowTarget,
    documentTarget,
    onAuthenticated: (value) => state.users.push(value),
    onExpired: () => state.expired++,
    schedule: (callback, delay) => { state.timer = callback; state.delay = delay; return 7; },
    cancel: (timer) => { assert.equal(timer, 7); state.cancelled = true; },
  });
  return { state, stop, windowTarget, documentTarget };
}
test("active session refreshes its authoritative module list every minute and on focus", async () => {
  const fixture = setup(async () => Response.json({ userId: "STAFF-1", allowedModules: ["tasks"] }));
  assert.equal(fixture.state.delay, 60_000);
  fixture.state.timer();
  await settle();
  fixture.windowTarget.dispatchEvent(new Event("focus"));
  await settle();
  assert.equal(fixture.state.users.length, 2);
  assert.deepEqual(fixture.state.users[0].allowedModules, ["tasks"]);
  fixture.stop();
});
test("hidden tabs defer polling and revalidate on returning visible", async () => {
  const fixture = setup(async () => new Response(null, { status: 401 }));
  fixture.documentTarget.visibilityState = "hidden";
  fixture.state.timer();
  await settle();
  assert.equal(fixture.state.expired, 0);
  fixture.documentTarget.visibilityState = "visible";
  fixture.documentTarget.dispatchEvent(new Event("visibilitychange"));
  await settle();
  assert.equal(fixture.state.expired, 1);
  fixture.stop();
});
test("parallel focus/interval signals make one request and cannot revive a disposed session", async () => {
  let finish;
  let requests = 0;
  const fixture = setup(() => { requests++; return new Promise((resolve) => { finish = resolve; }); });
  fixture.state.timer();
  fixture.windowTarget.dispatchEvent(new Event("focus"));
  assert.equal(requests, 1);
  fixture.stop();
  finish(Response.json({ userId: "OLD-SESSION" }));
  await settle();
  assert.deepEqual(fixture.state.users, []);
  assert.equal(fixture.state.cancelled, true);
  fixture.windowTarget.dispatchEvent(new Event("focus"));
  assert.equal(requests, 1);
});
test("temporary errors never replace the identity; a later 403 expires it", async () => {
  let outcome = 503;
  const fixture = setup(async () => new Response(null, { status: outcome }));
  fixture.state.timer();
  await settle();
  assert.equal(fixture.state.expired, 0);
  assert.deepEqual(fixture.state.users, []);
  outcome = 403;
  fixture.state.timer();
  await settle();
  assert.equal(fixture.state.expired, 1);
  fixture.stop();
});
