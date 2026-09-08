import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleBackupRequest } from "../lib/backup-api.ts";
import { API_ROLES, canAccessApi } from "../lib/access-policy.ts";
import { createBackupTransport } from "../production/backup-transport.mjs";

function harness(overrides = {}) {
  let calls = 0;
  const dependencies = {
    authenticate: async () => ({ owner: true, auth: { user: {} } }),
    isOwner: (context) => context.owner,
    trustedOrigin: (request) => request.headers.get("origin") === "https://arthello.example",
    verifyCsrf: (request) => { if (request.headers.get("x-csrf-token") !== "session-csrf") throw new Error("secret csrf"); },
    transport: { fetch: async (request) => { calls++; return Response.json({ state: "running", path: new URL(request.url).pathname }, { status: request.method === "POST" ? 202 : 200 }); } },
    ...overrides,
  };
  return { run: (request) => handleBackupRequest(request, dependencies), calls: () => calls };
}
function post(body = { action: "create" }, headers = {}) {
  return new Request("https://arthello.example/api/settings/backups", { method: "POST", headers: { "content-type": "application/json", origin: "https://arthello.example", "x-csrf-token": "session-csrf", ...headers }, body: JSON.stringify(body) });
}

test("backup policy denies every non-owner role and forged owner", () => {
  for (const role of API_ROLES) for (const method of ["GET", "POST"]) {
    assert.equal(canAccessApi({ apiRole: role, isSystemOwner: role === "OWNER", allowedModules: ["access"] }, "/api/settings/backups", method), role === "OWNER", `${role} ${method}`);
  }
  assert.equal(canAccessApi({ apiRole: "OWNER", isSystemOwner: false }, "/api/settings/backups", "GET"), false);
});

test("backup API authenticates direct requests and ignores spoofed owner headers", async () => {
  const h = harness({ authenticate: async () => null });
  assert.equal((await h.run(post(undefined, { "x-arthello-system-owner": "1" }))).status, 401);
  assert.equal(h.calls(), 0);
  const other = harness({ authenticate: async () => ({ owner: false, auth: { user: {} } }) });
  assert.equal((await other.run(post())).status, 403);
  const temporary = harness({ authenticate: async () => ({ owner: true, auth: { user: { mustChangePassword: true } } }) });
  assert.equal((await temporary.run(post())).status, 403);
});

test("backup mutation requires session CSRF and same origin before host execution", async () => {
  const h = harness();
  assert.equal((await h.run(post(undefined, { origin: "https://attacker.example" }))).status, 403);
  assert.equal((await h.run(post(undefined, { "x-csrf-token": "wrong" }))).status, 403);
  assert.equal(h.calls(), 0);
  const response = await h.run(post());
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { state: "running", path: "/create" });
});

test("backup API rejects arbitrary commands, paths, restore and oversized input", async () => {
  const h = harness();
  for (const body of [{ action: "restore" }, { action: "create", path: "/etc" }, { action: "create", unit: "other.service" }, null]) assert.equal((await h.run(post(body))).status, 400);
  assert.equal((await h.run(post({ action: "x".repeat(200) }))).status, 413);
  assert.equal(h.calls(), 0);
});

test("backup unavailable and concurrent responses never claim completion or leak errors", async () => {
  const h = harness({ transport: undefined });
  assert.equal((await h.run(post())).status, 503);
  const fail = harness({ transport: { fetch: async () => { throw new Error("private server secret"); } } });
  const result = await fail.run(post());
  assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /secret/);
  const concurrent = harness({ transport: { fetch: async () => Response.json({ state: "running" }, { status: 409 }) } });
  assert.equal((await concurrent.run(post())).status, 409);
});

test("Node transport uses the Unix socket and only the two fixed host operations", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "backup-socket-"));
  const socketPath = join(directory, "control.sock");
  const seen = [];
  const server = createServer((request, response) => { seen.push([request.method, request.url]); response.writeHead(request.method === "POST" ? 202 : 200, { "content-type": "application/json" }); response.end(JSON.stringify({ state: "running" })); });
  const bindError = await new Promise((resolve) => { server.once("error", resolve); server.listen(socketPath, () => resolve(null)); });
  if (bindError?.code === "EPERM" && process.env.ARTHELLO_BACKUP_REQUIRE_UNIX !== "1") { await rm(directory, { recursive: true, force: true }); context.skip("This environment prohibits AF_UNIX; run this integration check on the isolated builder"); return; }
  if (bindError) throw bindError;
  try {
    const transport = createBackupTransport({ socketPath });
    for (const [method, path] of [["GET", "/status"], ["POST", "/create"]]) assert.equal((await transport(new Request(`http://backup.internal${path}`, { method }))).status, method === "GET" ? 200 : 202);
    for (const target of ["http://evil.example/status", "http://backup.internal/create?unit=other", "http://backup.internal/restore"]) assert.equal((await transport(new Request(target))).status, 403);
    assert.deepEqual(seen, [["GET", "/status"], ["POST", "/create"]]);
  } finally { await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});

test("Node transport bounds timeout and invalid/oversized bridge responses", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "backup-bounds-"));
  const socketPath = join(directory, "control.sock");
  let mode = "invalid";
  const server = createServer((_request, response) => {
    if (mode === "timeout") return;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(mode === "invalid" ? "private diagnostic secret" : "x".repeat(129000));
  });
  const bindError = await new Promise((resolve) => { server.once("error", resolve); server.listen(socketPath, () => resolve(null)); });
  if (bindError?.code === "EPERM" && process.env.ARTHELLO_BACKUP_REQUIRE_UNIX !== "1") { await rm(directory, { recursive: true, force: true }); context.skip("This environment prohibits AF_UNIX; run this integration check on the isolated builder"); return; }
  if (bindError) throw bindError;
  try {
    const transport = createBackupTransport({ socketPath, timeoutMs: 50 });
    for (const value of ["invalid", "large", "timeout"]) {
      mode = value;
      const result = await transport(new Request("http://backup.internal/status"));
      assert.equal(result.status, 503);
      assert.doesNotMatch(await result.text(), /secret/);
    }
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
