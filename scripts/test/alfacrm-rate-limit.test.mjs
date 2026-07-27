import assert from "node:assert/strict";
import test from "node:test";
import { SerializedReadOnlyAlfaClient } from "../src/import-alfacrm-sandbox.ts";

function setTestCredentials() {
  const previous = {
    domain: process.env.ALFACRM_DOMAIN,
    email: process.env.ALFACRM_EMAIL,
    apiKey: process.env.ALFACRM_API_KEY,
    fetch: globalThis.fetch,
  };
  process.env.ALFACRM_DOMAIN = "example.test";
  process.env.ALFACRM_EMAIL = "api@example.test";
  process.env.ALFACRM_API_KEY = "test-key";
  return () => {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [
      ["ALFACRM_DOMAIN", previous.domain],
      ["ALFACRM_EMAIL", previous.email],
      ["ALFACRM_API_KEY", previous.apiKey],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("AlfaCRM requests overlap latency while request starts remain rate limited", async () => {
  const restore = setTestCredentials();

  const requestStarts = [];
  let activeRequests = 0;
  let maxActiveRequests = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return new Response(JSON.stringify({ token: "test-token" }), {
        status: 200,
      });
    }
    requestStarts.push(Date.now());
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 700));
    activeRequests -= 1;
    return new Response(JSON.stringify({ items: [], total: 0 }), {
      status: 200,
    });
  };

  try {
    const client = new SerializedReadOnlyAlfaClient();
    await Promise.all([
      client.postIndex("1/customer-tariff/index?customer_id=1", {}),
      client.postIndex("1/customer-tariff/index?customer_id=2", {}),
      client.postIndex("1/customer-tariff/index?customer_id=3", {}),
    ]);

    assert.equal(requestStarts.length, 3);
    assert.ok(requestStarts[1] - requestStarts[0] >= 240);
    assert.ok(requestStarts[2] - requestStarts[1] >= 240);
    assert.ok(maxActiveRequests >= 2);
  } finally {
    restore();
  }
});

test("transient AlfaCRM reads retry but non-retryable responses fail once", async () => {
  const restore = setTestCredentials();
  let transientAttempts = 0;
  let forbiddenAttempts = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return new Response(JSON.stringify({ token: "test-token" }), {
        status: 200,
      });
    }
    if (url.includes("transient")) {
      transientAttempts += 1;
      if (transientAttempts < 3) {
        throw new DOMException("timed out", "TimeoutError");
      }
      return new Response(JSON.stringify({ items: [], total: 0 }), {
        status: 200,
      });
    }
    forbiddenAttempts += 1;
    return new Response(JSON.stringify({}), { status: 403 });
  };

  try {
    const client = new SerializedReadOnlyAlfaClient({
      retryBaseDelayMs: 1,
    });
    await client.postIndex("1/transient/index", {});
    assert.equal(transientAttempts, 3);
    await assert.rejects(
      client.postIndex("1/forbidden/index", {}),
      /http_403/,
    );
    assert.equal(forbiddenAttempts, 1);
  } finally {
    restore();
  }
});
