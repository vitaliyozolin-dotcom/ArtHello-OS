import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createTochkaTransport } from "../production/tochka-transport.mjs";

const syntheticJwt = [
  Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url"),
  Buffer.from(JSON.stringify({ exp: 9_999_999_999 })).toString("base64url"),
  ["synthetic", "signature"].join("-"),
].join(".");

test("Node transport forwards only the documented Tochka read flow and strips caller headers", async () => {
  const calls = [];
  const transport = createTochkaTransport({
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ Data: { Customer: [] } }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": "must-not-cross-the-boundary=1",
          "x-upstream-debug": "private",
        },
      });
    },
  });

  const response = await transport(new Request("https://enter.tochka.com/uapi/open-banking/v1.0/customers", {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${syntheticJwt}`,
      cookie: "session=must-not-forward",
      "x-forwarded-for": "203.0.113.7",
    },
  }));

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://enter.tochka.com/uapi/open-banking/v1.0/customers");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${syntheticJwt}`);
  assert.equal(calls[0].init.headers.accept, "application/json");
  assert.equal("cookie" in calls[0].init.headers, false);
  assert.equal("x-forwarded-for" in calls[0].init.headers, false);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(response.headers.has("x-upstream-debug"), false);
});

test("Node transport accepts bounded statement creation and blocks write, query and foreign-origin requests", async () => {
  const calls = [];
  const transport = createTochkaTransport({
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response("{}", { status: 201, headers: { "content-type": "application/json" } });
    },
  });
  const statementBody = JSON.stringify({
    Data: {
      Statement: {
        accountId: "40817810802000000008/044525104",
        startDateTime: "2026-08-01",
        endDateTime: "2026-09-03",
      },
    },
  });

  const allowed = await transport(new Request("https://enter.tochka.com/uapi/open-banking/v1.0/statements", {
    method: "POST",
    headers: {
      authorization: `Bearer ${syntheticJwt}`,
      "content-type": "application/json",
    },
    body: statementBody,
  }));
  assert.equal(allowed.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.body, statementBody);

  const denied = await Promise.all([
    transport(new Request("https://enter.tochka.com/uapi/payment/v1.0/for-sign", {
      method: "POST",
      headers: { authorization: `Bearer ${syntheticJwt}`, "content-type": "application/json" },
      body: "{}",
    })),
    transport(new Request("https://enter.tochka.com/uapi/open-banking/v1.0/customers?debug=1", {
      headers: { authorization: `Bearer ${syntheticJwt}` },
    })),
    transport(new Request("https://evil.example/uapi/open-banking/v1.0/customers", {
      headers: { authorization: `Bearer ${syntheticJwt}` },
    })),
    transport(new Request("https://enter.tochka.com/uapi/open-banking/v1.0/customers", {
      method: "DELETE",
      headers: { authorization: `Bearer ${syntheticJwt}` },
    })),
    transport(new Request("https://enter.tochka.com/uapi/open-banking/v1.0/customers")),
  ]);

  assert.deepEqual(denied.map((response) => response.status), [403, 403, 403, 403, 401]);
  assert.equal(calls.length, 1);
});

test("Node transport converts upstream exceptions to a credential-free response", async () => {
  const transport = createTochkaTransport({
    fetchImpl: async () => {
      throw new Error(`network failed for ${syntheticJwt}`);
    },
  });

  const response = await transport(new Request("https://enter.tochka.com/uapi/open-banking/v1.0/accounts", {
    headers: { authorization: `Bearer ${syntheticJwt}` },
  }));
  const body = await response.text();

  assert.equal(response.status, 502);
  assert.match(body, /upstream_unavailable/);
  assert.doesNotMatch(body, new RegExp(syntheticJwt.replaceAll(".", "\\.")));
});

test("production runtime binds the worker to the Node Tochka transport", () => {
  const runtime = readFileSync(new URL("../production/runtime-server.mjs", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/integration-actions/route.ts", import.meta.url), "utf8");

  assert.match(runtime, /import \{ createTochkaTransport \} from "\.\/tochka-transport\.mjs"/);
  assert.match(runtime, /serviceBindings:\s*\{\s*TOCHKA_TRANSPORT:\s*createTochkaTransport\(\)\s*\}/);
  assert.match(route, /TOCHKA_TRANSPORT/);
  assert.match(route, /probeTochkaJwt\([\s\S]*?tochkaTransportFetch/);
  assert.match(route, /syncTochkaReadOnly\(\{[\s\S]*?request:\s*tochkaTransportFetch/);
});
