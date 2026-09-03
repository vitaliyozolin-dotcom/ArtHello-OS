import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import * as ts from "typescript";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const validPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nxoAAAAASUVORK5CYII=";
let routeNonce = 0;
const openDatabases = new Set();

after(() => {
  for (const database of openDatabases) database.close();
  openDatabases.clear();
});

class QuotaD1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new QuotaD1Statement(this.database, this.sql, bindings);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async run() {
    return this.database.prepare(this.sql).run(...this.bindings);
  }
}

class QuotaD1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new QuotaD1Statement(this.database, sql);
  }
}

function createQuotaDatabase() {
  const raw = new DatabaseSync(":memory:");
  openDatabases.add(raw);
  return { raw, binding: new QuotaD1Database(raw) };
}

async function loadRoute(overrides = {}) {
  const routeSource = await source("app/api/content-generate/route.ts");
  const lastImport = `import {
  getAuthenticatedRequestContext,
  isCanonicalOwnerContext,
  verifyAuthenticatedRequestCsrf,
} from "../../../lib/production-auth";`;
  const lastImportAt = routeSource.indexOf(lastImport);
  assert.ok(lastImportAt >= 0, "content generation auth imports changed");
  const body = routeSource.slice(lastImportAt + lastImport.length);
  const stubs = routeStubs(overrides);
  globalThis.__ARTHELLO_CONTENT_GENERATE_TEST__ = stubs;
  const preamble = `
    const {
      env, canAccessModule, hasTrustedMutationOrigin, getAuthenticatedRequestContext,
      isCanonicalOwnerContext, verifyAuthenticatedRequestCsrf, fetch
    } = globalThis.__ARTHELLO_CONTENT_GENERATE_TEST__;
  `;
  const output = ts.transpileModule(`${preamble}\n${body}`, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "content-generate/route.ts",
    reportDiagnostics: true,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}#content-generate-${routeNonce++}`);
}

function routeStubs(overrides = {}) {
  const context = authenticatedContext();
  const quota = createQuotaDatabase();
  return {
    env: {
      DB: quota.binding,
      OPENAI_API_KEY: "focused-test-provider-key",
      ARTHELLO_PUBLIC_ORIGIN: "https://example.test",
    },
    hasTrustedMutationOrigin: (request, publicOrigin) => request.headers.get("origin") === publicOrigin,
    getAuthenticatedRequestContext: async () => context,
    isCanonicalOwnerContext: (candidate) => candidate.apiRole === "OWNER" && candidate.auth.user.isSystemOwner === true,
    verifyAuthenticatedRequestCsrf: (request, candidate) => {
      if (request.headers.get("x-csrf-token") !== candidate.auth.session.csrf_token) throw new Error("csrf");
    },
    canAccessModule: (candidate, moduleId) => moduleId === "content"
      && candidate.allowedModules?.includes("content") !== false,
    fetch: async () => Response.json({ data: [{ b64_json: validPngBase64 }] }),
    ...overrides,
  };
}

function authenticatedContext(role = "MARKETING", options = {}) {
  return {
    actor: "signed-in@example.test",
    apiRole: role,
    appUserId: options.appUserId ?? (role === "OWNER" ? "USR-OWNER" : "USR-MARKETING"),
    appUserName: "Signed In User",
    accessVersion: 7,
    auth: {
      user: {
        isSystemOwner: options.isSystemOwner ?? role === "OWNER",
        canAccessMedical: false,
        allowedModules: options.allowedModules ?? ["content"],
      },
      session: { csrf_token: "csrf-ok" },
      access: {},
    },
  };
}

function baseForm() {
  const form = new FormData();
  form.set("provider", "openai");
  form.set("prompt", "Подробное описание изображения для безопасного теста");
  form.set("size", "1024x1024");
  form.set("quality", "medium");
  return form;
}

async function multipartRequest(form = baseForm(), options = {}) {
  const encoded = new Response(form);
  const body = await encoded.arrayBuffer();
  const headers = new Headers({
    "content-type": encoded.headers.get("content-type"),
    "content-length": String(body.byteLength),
    "x-csrf-token": options.csrf ?? "csrf-ok",
    "x-arthello-role": options.claimedRole ?? "OWNER",
    origin: options.origin ?? "https://example.test",
  });
  if (options.withoutLength) headers.delete("content-length");
  if (options.contentLength !== undefined) headers.set("content-length", String(options.contentLength));
  if (options.contentType !== undefined) headers.set("content-type", options.contentType);
  if (options.contentEncoding !== undefined) headers.set("content-encoding", options.contentEncoding);
  if (options.userId !== undefined) headers.set("x-test-user", options.userId);
  return new Request("https://example.test/api/content-generate", {
    method: "POST",
    headers,
    body,
  });
}

test("content generation uses live auth, canonical role/module policy and CSRF", async () => {
  const originGuard = await loadRoute();
  assert.equal((await originGuard.POST(await multipartRequest(baseForm(), { origin: "https://attacker.test" }))).status, 403);

  const noSession = await loadRoute({ getAuthenticatedRequestContext: async () => null });
  assert.equal((await noSession.POST(await multipartRequest())).status, 401, "a forged role header must not create a session");

  const representative = authenticatedContext("REPRESENTATIVE");
  const wrongRole = await loadRoute({ getAuthenticatedRequestContext: async () => representative });
  assert.equal((await wrongRole.POST(await multipartRequest())).status, 403, "a forged OWNER header must not override the live role");

  const nonCanonicalOwner = authenticatedContext("OWNER", { isSystemOwner: false });
  const wrongOwner = await loadRoute({ getAuthenticatedRequestContext: async () => nonCanonicalOwner });
  assert.equal((await wrongOwner.POST(await multipartRequest())).status, 403, "OWNER text alone must not grant owner authority");

  const missingModuleContext = authenticatedContext("MARKETING", { allowedModules: ["sales"] });
  const missingModule = await loadRoute({ getAuthenticatedRequestContext: async () => missingModuleContext });
  assert.equal((await missingModule.POST(await multipartRequest())).status, 403);

  const route = await loadRoute();
  assert.equal((await route.POST(await multipartRequest(baseForm(), { csrf: "wrong" }))).status, 403);
});

test("multipart envelope is numeric, bounded and checked before parsing", async () => {
  const route = await loadRoute();
  assert.equal((await route.POST(await multipartRequest(baseForm(), { contentType: "application/json" }))).status, 415);
  assert.equal((await route.POST(await multipartRequest(baseForm(), { contentEncoding: "gzip" }))).status, 415);
  assert.equal((await route.POST(await multipartRequest(baseForm(), { withoutLength: true }))).status, 411);
  assert.equal((await route.POST(await multipartRequest(baseForm(), { contentLength: "12x" }))).status, 400);
  assert.equal((await route.POST(await multipartRequest(baseForm(), { contentLength: 9 * 1024 * 1024 }))).status, 413);
});

test("multipart fields are exact and an optional reference cannot be repeated", async () => {
  const route = await loadRoute({ fetch: async () => { throw new Error("provider must not be called"); } });

  const unknown = baseForm();
  unknown.set("unexpected", "value");
  assert.equal((await route.POST(await multipartRequest(unknown))).status, 400);

  const duplicateText = baseForm();
  duplicateText.append("prompt", "Второе описание, которое нельзя принимать");
  assert.equal((await route.POST(await multipartRequest(duplicateText))).status, 400);

  const duplicateReference = baseForm();
  const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  duplicateReference.append("reference", new File([pngHeader], "one.png", { type: "image/png" }));
  duplicateReference.append("reference", new File([pngHeader], "two.png", { type: "image/png" }));
  assert.equal((await route.POST(await multipartRequest(duplicateReference))).status, 400);

  const textReference = baseForm();
  textReference.set("reference", "not-a-file");
  assert.equal((await route.POST(await multipartRequest(textReference))).status, 400);
});

test("reference size and magic bytes are enforced before provider upload", async () => {
  const route = await loadRoute({ fetch: async () => { throw new Error("provider must not be called"); } });

  const mismatched = baseForm();
  mismatched.set("reference", new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "spoofed.png", { type: "image/png" }));
  assert.equal((await route.POST(await multipartRequest(mismatched))).status, 415);

  const oversized = baseForm();
  oversized.set("reference", new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }));
  assert.equal((await route.POST(await multipartRequest(oversized))).status, 413);
});

test("provider failures and exceptions never disclose raw provider text", async () => {
  const providerError = await loadRoute({
    fetch: async () => Response.json({ error: { message: "secret-provider-diagnostic" } }, { status: 400 }),
  });
  const failed = await providerError.POST(await multipartRequest());
  assert.equal(failed.status, 502);
  assert.doesNotMatch(JSON.stringify(await failed.json()), /secret-provider-diagnostic/);

  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args);
  try {
    const thrownError = await loadRoute({ fetch: async () => { throw new Error("secret-key-in-exception"); } });
    const response = await thrownError.POST(await multipartRequest());
    assert.equal(response.status, 502);
    assert.doesNotMatch(JSON.stringify(await response.json()), /secret-key-in-exception/);
  } finally {
    console.error = originalConsoleError;
  }
  assert.deepEqual(logged, [["content.image_generation_failed"]]);
});

test("provider calls are abortable, response-bounded, and successful output remains ephemeral", async () => {
  let generationRequest;
  const success = await loadRoute({
    fetch: async (url, init) => {
      generationRequest = { url, init };
      return Response.json({ data: [{ b64_json: validPngBase64 }] });
    },
  });
  const response = await success.POST(await multipartRequest());
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(payload.stored, false);
  assert.equal(payload.imageDataUrl, `data:image/png;base64,${validPngBase64}`);
  assert.equal(generationRequest.url, "https://api.openai.com/v1/images/generations");
  assert.equal(generationRequest.init.redirect, "error");
  assert.ok(generationRequest.init.signal instanceof AbortSignal);

  const timedOut = await loadRoute({
    fetch: async (_url, init) => {
      assert.ok(init.signal instanceof AbortSignal);
      throw new DOMException("provider detail", "AbortError");
    },
  });
  assert.equal((await timedOut.POST(await multipartRequest())).status, 504);

  const oversizedResponse = await loadRoute({
    fetch: async () => new Response("{}", { headers: { "content-length": String(25 * 1024 * 1024) } }),
  });
  assert.equal((await oversizedResponse.POST(await multipartRequest())).status, 502);
});

test("reference upload strips the local filename before forwarding", async () => {
  let forwardedFile;
  const route = await loadRoute({
    fetch: async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/images/edits");
      forwardedFile = init.body.get("image");
      return Response.json({ data: [{ b64_json: validPngBase64 }] });
    },
  });
  const form = baseForm();
  form.set("reference", new File([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ], "private-client-name.png", { type: "image/png" }));
  assert.equal((await route.POST(await multipartRequest(form))).status, 200);
  assert.equal(forwardedFile.name, "reference.png");
});

test("quota allows ten attempts per hour and isolates pseudonymous users", async () => {
  const quota = createQuotaDatabase();
  let providerCalls = 0;
  const route = await loadRoute({
    env: {
      DB: quota.binding,
      OPENAI_API_KEY: "focused-test-provider-key",
      ARTHELLO_PUBLIC_ORIGIN: "https://example.test",
    },
    getAuthenticatedRequestContext: async (request) => authenticatedContext("MARKETING", {
      appUserId: request.headers.get("x-test-user") || "user-a",
    }),
    fetch: async () => {
      providerCalls += 1;
      return Response.json({ data: [{ b64_json: validPngBase64 }] });
    },
  });

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    assert.equal((await route.POST(await multipartRequest(baseForm(), { userId: "user-a" }))).status, 200);
  }
  assert.equal((await route.POST(await multipartRequest(baseForm(), { userId: "user-a" }))).status, 429);
  assert.equal((await route.POST(await multipartRequest(baseForm(), { userId: "user-b" }))).status, 200);
  assert.equal(providerCalls, 11, "a rejected quota claim must not reach the provider");

  const rows = quota.raw.prepare("SELECT subject_hash,request_count FROM content_generation_limits ORDER BY subject_hash").all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => /^[a-f0-9]{64}$/.test(row.subject_hash)));
  assert.ok(rows.every((row) => row.subject_hash !== "user-a" && row.subject_hash !== "user-b"));
  assert.deepEqual(rows.map((row) => Number(row.request_count)).sort((a, b) => a - b), [1, 10]);
});

test("quota has one atomic in-flight lease and releases it after completion", async () => {
  const quota = createQuotaDatabase();
  let finishFirst;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  let providerCalls = 0;
  const route = await loadRoute({
    env: {
      DB: quota.binding,
      OPENAI_API_KEY: "focused-test-provider-key",
      ARTHELLO_PUBLIC_ORIGIN: "https://example.test",
    },
    fetch: async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        markStarted();
        return new Promise((resolve) => { finishFirst = () => resolve(Response.json({ data: [{ b64_json: validPngBase64 }] })); });
      }
      return Response.json({ data: [{ b64_json: validPngBase64 }] });
    },
  });

  const first = route.POST(await multipartRequest());
  await started;
  assert.equal((await route.POST(await multipartRequest())).status, 429, "a concurrent claim must lose atomically");
  assert.equal(providerCalls, 1);
  finishFirst();
  assert.equal((await first).status, 200);
  assert.equal((await route.POST(await multipartRequest())).status, 200, "the exact finished lease must release the slot");
  assert.equal(providerCalls, 2);
});

test("provider failure and invalid output consume quota while expired rows are cleaned", async () => {
  const quota = createQuotaDatabase();
  let providerCalls = 0;
  const route = await loadRoute({
    env: {
      DB: quota.binding,
      OPENAI_API_KEY: "focused-test-provider-key",
      ARTHELLO_PUBLIC_ORIGIN: "https://example.test",
    },
    fetch: async () => {
      providerCalls += 1;
      if (providerCalls === 1) return Response.json({ error: { message: "raw provider failure" } }, { status: 400 });
      return Response.json({ data: [{ b64_json: "not-an-image" }] });
    },
  });

  assert.equal((await route.POST(await multipartRequest())).status, 502);
  assert.equal((await route.POST(await multipartRequest())).status, 502);
  let row = quota.raw.prepare("SELECT request_count,active_until,subject_hash FROM content_generation_limits").get();
  assert.equal(Number(row.request_count), 2, "post-claim failures must still consume attempts");
  assert.equal(Number(row.active_until), 0, "the completed lease must be released");
  assert.notEqual(row.subject_hash, "USR-MARKETING");

  quota.raw.prepare("UPDATE content_generation_limits SET expires_at=0,active_until=0").run();
  assert.equal((await route.POST(await multipartRequest())).status, 502);
  row = quota.raw.prepare("SELECT request_count,expires_at FROM content_generation_limits").get();
  assert.equal(Number(row.request_count), 1, "expired quota state must be deleted before a new claim");
  assert.ok(Number(row.expires_at) > 0);
});

test("source contract keeps generation private and the UI supplies the CSRF cookie", async () => {
  const [route, ui] = await Promise.all([
    source("app/api/content-generate/route.ts"),
    source("app/components/ContentWorkspace.tsx"),
  ]);
  assert.match(route, /getAuthenticatedRequestContext/);
  assert.match(route, /isCanonicalOwnerContext/);
  assert.match(route, /canAccessModule\(accessContext, "content"\)/);
  assert.match(route, /verifyAuthenticatedRequestCsrf/);
  assert.match(route, /hasTrustedMutationOrigin\(request, publicOrigin\)/);
  assert.ok(route.indexOf("hasTrustedMutationOrigin(request, publicOrigin)") < route.indexOf("getAuthenticatedRequestContext(request)"));
  assert.ok(route.indexOf("const envelopeIssue = multipartEnvelopeIssue") < route.indexOf("request.formData()"));
  assert.match(route, /MAX_REFERENCE_BYTES\s*=\s*8\s*\*\s*1024\s*\*\s*1024/);
  assert.match(route, /contentEncoding\s*&&\s*contentEncoding\s*!==\s*"identity"/);
  assert.match(route, /detectReferenceType/);
  assert.match(route, /AbortController/);
  assert.match(route, /MAX_PROVIDER_RESPONSE_BYTES/);
  assert.match(route, /content-generation-quota:v1:/);
  assert.match(route, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(route, /QUOTA_REQUESTS_PER_WINDOW\s*=\s*10/);
  assert.match(route, /ON CONFLICT\(subject_hash\) DO UPDATE/);
  assert.match(route, /WHERE content_generation_limits\.active_until<=\?/);
  assert.match(route, /DELETE FROM content_generation_limits/);
  assert.match(route, /WHERE subject_hash=\? AND lease_nonce=\? AND active_until=\?/);
  assert.match(route, /stored:\s*false/);
  assert.doesNotMatch(route, /getRequestUser|payload\.error|response\.text\(|from "\.\.\/\.\.\/\.\.\/db"/);
  assert.doesNotMatch(route, /console\.error\([^\n]+,/);
  assert.match(ui, /"x-csrf-token":\s*readClientCookie\("__Host-arthello_csrf"\)/);
  assert.match(ui, /function readClientCookie\(name: string\)/);
});
