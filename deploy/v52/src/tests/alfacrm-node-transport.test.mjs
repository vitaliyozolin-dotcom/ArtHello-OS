import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { createAlfaCrmTransport } from "../production/alfacrm-transport.mjs";

const loginUrl = "https://tenant.s20.online/v2api/auth/login";

function sourceText(...relatives) {
  let missing;
  for (const relative of relatives) {
    try {
      return readFileSync(new URL(relative, import.meta.url), "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      missing = error;
    }
  }
  throw missing;
}

function request(url = loginUrl, init = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: JSON.stringify(init.body ?? { email: "fixture@example.test", api_key: "synthetic-api-key" }),
  });
}

test("AlfaCRM Node transport forwards only an allowlisted login without exposing extra headers", async () => {
  const calls = [];
  const transport = createAlfaCrmTransport({ fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return Response.json({ token: "synthetic-upstream-token" });
  } });

  const response = await transport(request(loginUrl, {
    headers: { "x-app-key": "synthetic-app-key", "x-not-forwarded": "secret-marker" },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { token: "synthetic-upstream-token" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, loginUrl);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.headers["x-app-key"], "synthetic-app-key");
  assert.equal(calls[0].init.headers["x-not-forwarded"], undefined);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    email: "fixture@example.test",
    api_key: "synthetic-api-key",
  });
});

test("AlfaCRM Node transport allows branch reads with the worker token", async () => {
  const calls = [];
  const transport = createAlfaCrmTransport({ fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return Response.json({ items: [{ id: 1, name: "Fixture" }], total: 1 });
  } });

  const response = await transport(request("https://tenant.s20.online/v2api/branch/index", {
    headers: { "x-alfacrm-token": "synthetic-session-token" },
    body: { is_active: 1, page: 0, pageSize: 500 },
  }));

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers["x-alfacrm-token"], "synthetic-session-token");
});

for (const [name, candidate] of [
  ["plain HTTP", "http://tenant.s20.online/v2api/auth/login"],
  ["foreign host", "https://example.com/v2api/auth/login"],
  ["credentials in URL", "https://user:pass@tenant.s20.online/v2api/auth/login"],
  ["unexpected port", "https://tenant.s20.online:444/v2api/auth/login"],
  ["unexpected path", "https://tenant.s20.online/v2api/1/customer/update"],
  ["unexpected query", "https://tenant.s20.online/v2api/auth/login?next=https://example.com"],
]) test(`AlfaCRM Node transport rejects ${name} before network`, async () => {
  let calls = 0;
  const transport = createAlfaCrmTransport({ fetchImpl: async () => { calls += 1; return Response.json({}); } });
  const candidateRequest = candidate.includes("user:pass@")
    ? { url: candidate, method: "POST", headers: new Headers({ "content-type": "application/json" }), text: async () => "{}" }
    : request(candidate);
  const response = await transport(candidateRequest);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "request_not_allowed" });
  assert.equal(calls, 0);
});

test("AlfaCRM Node transport converts timeout and network failures to sanitized classifications", async () => {
  const timeout = createAlfaCrmTransport({
    timeoutMs: 10,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("fixture detail", "AbortError")), { once: true });
    }),
  });
  const unavailable = createAlfaCrmTransport({ fetchImpl: async () => { throw new Error("secret network detail"); } });

  const timedOut = await timeout(request());
  assert.equal(timedOut.status, 504);
  assert.equal(timedOut.headers.get("x-arthello-upstream-error"), "timeout");
  assert.deepEqual(await timedOut.json(), { error: "upstream_timeout" });

  const failed = await unavailable(request());
  assert.equal(failed.status, 502);
  assert.equal(failed.headers.get("x-arthello-upstream-error"), "unavailable");
  const failedText = await failed.text();
  assert.deepEqual(JSON.parse(failedText), { error: "upstream_unavailable" });
  assert.doesNotMatch(failedText, /secret network detail/);
});

test("production runtime registers and packages the protected AlfaCRM transport exactly once", () => {
  const runtime = sourceText("../production/runtime-server.mjs");
  const dockerfile = sourceText("../../Dockerfile", "../contract-fixtures/v52.Dockerfile");

  assert.match(runtime, /import \{ createAlfaCrmTransport \} from "\.\/alfacrm-transport\.mjs"/);
  assert.equal((runtime.match(/ALFACRM_TRANSPORT:\s*createAlfaCrmTransport\(\)/g) ?? []).length, 1);
  assert.equal((dockerfile.match(/COPY --from=application \/app\/production\/alfacrm-transport\.mjs \/app\/production\/alfacrm-transport\.mjs/g) ?? []).length, 1);
});

test("D176 release proves AlfaCRM egress without real credentials before stopping production", () => {
  const workflow = sourceText("./contract-fixtures/deploy-d176.yml");
  const egressProof = workflow.indexOf("ARTHELLO_D176_ALFACRM_EGRESS=VERIFIED");
  const liveStop = workflow.indexOf('docker stop --time 30 "$live_id"');

  assert.match(workflow, /D176: restore AlfaCRM production transport/);
  assert.ok(egressProof > 0 && liveStop > egressProof, "AlfaCRM egress must pass before the live container is stopped");
  assert.match(workflow, /import \{ createAlfaCrmTransport \} from "\.\/production\/alfacrm-transport\.mjs"/);
  assert.match(workflow, /api_key: "synthetic-release-probe"/);
  assert.doesNotMatch(workflow, /@arthello\.ru|buh@/i);
});

test("D177 activates controlled AlfaCRM imports only after explicit owner confirmation and preview evidence", () => {
  const workflow = sourceText("../../../../.github/workflows/deploy-arthello-acquiring-pay-d168.yml");
  const evidence = workflow.indexOf("ARTHELLO_D177_PREVIEW_EVIDENCE=VERIFIED");
  const liveStop = workflow.indexOf('docker stop --time 30 "$live_id"');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /confirmation:/);
  assert.match(workflow, /ACTIVATE ALFACRM IMPORT/);
  assert.match(workflow, /environment: production-ru/);
  assert.match(workflow, /runs-on:\s*\[self-hosted, linux, x64, arthello-gateway\]/);
  assert.match(workflow, /ALFACRM_IMPORT_ENABLED=true/);
  assert.match(workflow, /connected and credential_stored and mapping_count >= 1/);
  assert.match(workflow, /families\["status"\] == "previewed" and families\["previewCount"\] > 0/);
  assert.match(workflow, /staff\["status"\] == "previewed" and staff\["previewCount"\] > 0/);
  assert.match(workflow, /lastCheckedAt/);
  assert.ok(evidence > 0 && liveStop > evidence, "preview evidence must pass before the live container is stopped");
  assert.match(workflow, /cmp -s <\(sort "\$runtime_env"\) "\$candidate_env"/);
  assert.match(workflow, /production-d177-\$GITHUB_SHA\.json/);
  assert.match(workflow, /ARTHELLO_D177_EXTERNAL=VERIFIED arthello=200 school=200 pay=200/);
  assert.doesNotMatch(workflow, /@arthello\.ru|buh@|api_key\s*:/i);
});
