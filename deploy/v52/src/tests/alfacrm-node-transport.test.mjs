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

test("D177 release preserves the AlfaCRM egress proof before stopping production", () => {
  const workflow = sourceText("./contract-fixtures/deploy-d177.yml");
  const egressProof = workflow.indexOf("ARTHELLO_D177_ALFACRM_EGRESS=VERIFIED");
  const liveStop = workflow.indexOf('docker stop --time 30 "$live_id"');

  assert.match(workflow, /D177: refine Money cards and mobile bank history/);
  assert.ok(egressProof > 0 && liveStop > egressProof, "AlfaCRM egress must pass before the live container is stopped");
  assert.match(workflow, /import \{ createAlfaCrmTransport \} from "\.\/production\/alfacrm-transport\.mjs"/);
  assert.match(workflow, /api_key: "synthetic-release-probe"/);
  assert.doesNotMatch(workflow, /@arthello\.ru|buh@/i);
});

test("D179 preserves the enabled AlfaCRM import and egress proof before stopping production", () => {
  const workflow = sourceText("../../../../.github/workflows/deploy-arthello-finance-d179.yml", "./contract-fixtures/deploy-d179.yml");
  const egressProof = workflow.indexOf("ARTHELLO_D179_ALFACRM_EGRESS=VERIFIED");
  const importProof = workflow.indexOf("ALFACRM_IMPORT_ENABLED=true");
  const liveStop = workflow.indexOf('docker stop --time 30 "$live_id"');

  assert.match(workflow, /D179: compact finance operation workflow/);
  assert.ok(egressProof > 0 && importProof > 0 && liveStop > egressProof && liveStop > importProof, "AlfaCRM import and egress must be preserved before the live container is stopped");
  assert.match(workflow, /import \{ createAlfaCrmTransport \} from "\.\/production\/alfacrm-transport\.mjs"/);
  assert.match(workflow, /api_key: "synthetic-release-probe"/);
  assert.doesNotMatch(workflow, /@arthello\.ru|buh@/i);
});

test("D178 activates controlled AlfaCRM imports only after exact D177 and preview evidence", () => {
  const workflow = sourceText("./contract-fixtures/deploy-d178.yml");
  const evidence = workflow.indexOf("ARTHELLO_D178_PREVIEW_EVIDENCE=VERIFIED");
  const liveStop = workflow.indexOf('docker stop --time 30 "$live_id"');

  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.actor\.login == 'vitaliyozolin-dotcom'/);
  assert.match(workflow, /D178: activate AlfaCRM controlled import/);
  assert.match(workflow, /ACTIVATION_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.doesNotMatch(workflow, /workflow_dispatch:|inputs\./);
  assert.match(workflow, /environment: production-ru/);
  assert.match(workflow, /runs-on:\s*\[self-hosted, linux, x64, arthello-gateway\]/);
  assert.match(workflow, /EXPECTED_LIVE_RELEASE_SHA: 6ef7a3dc82e4644d1991d5454e61b62149b3738b/);
  assert.match(workflow, /EXPECTED_LIVE_IMAGE_ID: sha256:8bda721095c7b178ea5721115bd2146269a07fd30eb91f905abe59b889306000/);
  assert.match(workflow, /production-d177-\$EXPECTED_LIVE_RELEASE_SHA\.json/);
  assert.match(workflow, /\.decision=="D177"/);
  assert.match(workflow, /ALFACRM_IMPORT_ENABLED=true/);
  assert.match(workflow, /connected and credential_stored and mapping_count >= 1/);
  assert.match(workflow, /families\["status"\] == "previewed" and families\["previewCount"\] > 0/);
  assert.match(workflow, /staff\["status"\] == "previewed" and staff\["previewCount"\] > 0/);
  assert.ok(evidence > 0 && liveStop > evidence, "preview evidence must pass before the live container is stopped");
  assert.match(workflow, /cmp -s <\(sort "\$runtime_env"\) "\$candidate_env"/);
  assert.match(workflow, /production-d178-\$ACTIVATION_SHA\.json/);
  assert.match(workflow, /ARTHELLO_D178_ROLLBACK_SNAPSHOT=VERIFIED/);
  assert.match(workflow, /ARTHELLO_D178_EXTERNAL=VERIFIED arthello=200 school=200 pay=200/);
  assert.doesNotMatch(workflow, /@arthello\.ru|buh@|api_key\s*:/i);
});

test("D180 deploys the import usability fix over the verified D179 runtime", () => {
  const workflow = sourceText("../../../../.github/workflows/deploy-arthello-alfacrm-d180.yml", "./contract-fixtures/deploy-d180.yml");
  const snapshot = workflow.indexOf("ARTHELLO_D180_ROLLBACK_SNAPSHOT=VERIFIED");
  const liveStop = workflow.indexOf('docker stop --time 30 "$live_id"');
  const candidateStart = workflow.indexOf('docker run -d --name "$candidate"');
  const productionProof = workflow.indexOf("ARTHELLO_D180_PRODUCTION=VERIFIED");
  const lockedRouteProof = workflow.indexOf("ARTHELLO_D180_LOCKED_ROUTE=VERIFIED");
  const externalProof = workflow.indexOf("ARTHELLO_D180_EXTERNAL=VERIFIED");

  assert.match(workflow, /D180: fix AlfaCRM live import/);
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /concurrency:\s*\n\s*group: gateway-38-55-arthello-production-d180[\s\S]*?jobs:\s*\n\s*deploy:\s*\n\s*concurrency:\s*\n\s*group: gateway-38-55-arthello-production/);
  assert.match(workflow, /verify-external:\n    needs: deploy\n    concurrency:[\s\S]*?group: gateway-38-55-arthello-production[\s\S]*?runs-on: ubuntu-latest/);
  assert.ok(productionProof > 0 && lockedRouteProof > productionProof && externalProof > lockedRouteProof, "the locked gateway proof must precede off-host exact-release verification");
  assert.match(workflow, /D180_CANDIDATE_NAME: \$\{\{ steps\.publish\.outputs\.candidate \}\}/);
  assert.match(workflow, /D180_RECEIPT: \$\{\{ steps\.publish\.outputs\.receipt \}\}/);
  assert.match(workflow, /test "\$live_id" = "\$candidate"/);
  assert.match(workflow, /arthello\.release\.sha/);
  assert.match(workflow, /pay-assets\/release\.json\?release=\$RELEASE_SHA/);
  assert.match(workflow, /\.decision == "D180" and \.releaseSha == \$release/);
  assert.doesNotMatch(workflow, /docker ps --filter label=arthello\.production/);
  assert.match(workflow, /environment: production-ru/);
  assert.match(workflow, /runs-on:[\s\S]*?self-hosted[\s\S]*?arthello-gateway/);
  assert.match(workflow, /EXPECTED_LIVE_RELEASE_SHA: a2f30685f037e540206f459c34a6c37e90d3b95b/);
  assert.doesNotMatch(workflow, /__D179_RELEASE_SHA__/);
  assert.match(workflow, /production-d179-\$EXPECTED_LIVE_RELEASE_SHA\.json/);
  assert.match(workflow, /\.decision=="D179"/);
  assert.match(workflow, /\.releaseSha==\$release/);
  assert.match(workflow, /expected_live_image="\$\(jq -er '\.imageId'/);
  assert.match(workflow, /runChunkedAlfaImport/);
  assert.match(workflow, /NOTICE_AUTO_DISMISS_MS = 7_000/);
  assert.match(workflow, /listEntities\(storedRows/);
  assert.match(workflow, /isCurrentAlfaStaffRecord/);
  assert.match(workflow, /ALFACRM_IMPORT_ENABLED=true/);
  assert.match(workflow, /families\["status"\] == "imported"/);
  assert.match(workflow, /staff\["status"\] == "imported"/);
  assert.match(workflow, /subscriptions\["status"\] in \("importing", "imported"\)/);
  assert.ok(liveStop > 0 && snapshot > liveStop && candidateStart > snapshot, "recoverable data snapshot must complete before the replacement starts");
  assert.match(workflow, /ARTHELLO_D180_EDGE_STABILITY=VERIFIED seconds=65/);
  assert.match(workflow, /ARTHELLO_D180_PRODUCTION=VERIFIED/);
  assert.match(workflow, /ARTHELLO_D180_EXTERNAL=VERIFIED arthello=200 school=200 pay=200/);
  assert.doesNotMatch(workflow, /@arthello\.ru|buh@|api_key\s*:/i);
});

test("D181 deploys bounded family settings over the verified D180 runtime", () => {
  const workflow = sourceText("../../../../.github/workflows/deploy-arthello-settings-d181.yml", "./contract-fixtures/deploy-d181.yml");
  const settingsRoute = sourceText("../app/api/settings/route.ts");
  const snapshot = workflow.indexOf("ARTHELLO_D181_ROLLBACK_SNAPSHOT=VERIFIED");
  const liveStop = workflow.indexOf('docker stop --time 30 "$live_id"');
  const candidateStart = workflow.indexOf('docker run -d --name "$candidate"');
  const productionProof = workflow.indexOf("ARTHELLO_D181_PRODUCTION=VERIFIED");
  const lockedRouteProof = workflow.indexOf("ARTHELLO_D181_LOCKED_ROUTE=VERIFIED");
  const externalProof = workflow.indexOf("ARTHELLO_D181_EXTERNAL=VERIFIED");
  const mainRefRetry = workflow.indexOf("for attempt in 1 2 3 4 5 6; do");
  const artifactDownload = workflow.indexOf("python3 -I -B .github/scripts/download-v52-artifact-r17.py");

  assert.match(workflow, /D181: keep settings available for large family directories/);
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /concurrency:\s*\n\s*group: gateway-38-55-arthello-production-d181[\s\S]*?jobs:\s*\n\s*deploy:\s*\n\s*concurrency:\s*\n\s*group: gateway-38-55-arthello-production/);
  assert.match(workflow, /verify-external:\n    needs: deploy\n    concurrency:[\s\S]*?group: gateway-38-55-arthello-production[\s\S]*?runs-on: ubuntu-latest/);
  assert.ok(productionProof > 0 && lockedRouteProof > productionProof && externalProof > lockedRouteProof, "the locked gateway proof must precede off-host exact-release verification");
  assert.match(workflow, /EXPECTED_LIVE_RELEASE_SHA: 511d467763b7ca050c096df23cfcdcd1f62fe51d/);
  assert.match(workflow, /production-d180-\$EXPECTED_LIVE_RELEASE_SHA\.json/);
  assert.match(workflow, /\.decision=="D180"/);
  assert.match(workflow, /FAMILY_DIRECTORY_PAGE_SIZE = 25/);
  assert.match(settingsRoute, /searchParams\.get\("section"\) === "families"/);
  assert.match(workflow, /grep -F 'searchParams\.get\("section"\) === "families"'/);
  assert.match(workflow, /loadFamilyPage/);
  assert.match(workflow, /FAMILY_COUNT = 2_887/);
  assert.ok(mainRefRetry > 0 && artifactDownload > mainRefRetry, "the exact-main check must tolerate bounded GitHub ref propagation before artifact download");
  assert.match(workflow, /sleep 5/);
  assert.match(workflow, /ALFACRM_IMPORT_ENABLED=true/);
  assert.match(workflow, /families\["status"\] == "imported"/);
  assert.match(workflow, /staff\["status"\] == "imported"/);
  assert.match(workflow, /subscriptions\["status"\] in \("importing", "imported"\)/);
  assert.ok(liveStop > 0 && snapshot > liveStop && candidateStart > snapshot, "recoverable data snapshot must complete before the replacement starts");
  assert.match(workflow, /ARTHELLO_D181_EDGE_STABILITY=VERIFIED seconds=65/);
  assert.match(workflow, /ARTHELLO_D181_PRODUCTION=VERIFIED/);
  assert.match(workflow, /ARTHELLO_D181_EXTERNAL=VERIFIED arthello=200 school=200 pay=200/);
  assert.doesNotMatch(workflow, /@arthello\.ru|buh@|api_key\s*:/i);
});

test('source status dictionary is available through the real production transport', async () => {
  const transport=createAlfaCrmTransport({fetchImpl:async()=>Response.json({items:[{id:1,name:'Активен'}],total:1})});
  const response=await transport(request('https://tenant.s20.online/v2api/6/study-status/index',{headers:{'x-alfacrm-token':'synthetic-session-token'},body:{page:0,pageSize:500}}));
  assert.equal(response.status,200);
  assert.equal((await response.json()).items[0].name,'Активен');
});
