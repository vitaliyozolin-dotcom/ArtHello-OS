import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(
  new URL("../server/school-sso.ts", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../app/api/school/sso/route.ts", import.meta.url),
  "utf8",
);
const auth = readFileSync(
  new URL("../server/auth.ts", import.meta.url),
  "utf8",
);

test("ArtHello OS has a supported authenticated-user resolver", () => {
  const candidates = [
    "requireAuthenticatedUser",
    "requireSessionUser",
    "requireUser",
    "getAuthenticatedUser",
    "getCurrentUser",
    "getSessionUser",
    "getAuthUser",
    "currentUser",
  ];
  assert.ok(
    candidates.some((name) =>
      new RegExp(`(?:export\\s+(?:async\\s+)?function|export\\s+const)\\s+${name}\\b`).test(auth),
    ),
    "server/auth.ts must export one supported authenticated-user resolver",
  );
});

test("School handoff is server-side, signed and does not put credentials in ArtHello OS", () => {
  for (const fragment of [
    "createHmac",
    "x-arthello-timestamp",
    "x-arthello-signature",
    "/api/internal/staff-sso/authorize-v2",
    "centralUserId",
    "cache: \"no-store\"",
    "AbortSignal.timeout(10_000)",
  ]) assert.ok(client.includes(fragment), `Missing SSO client guard: ${fragment}`);
  assert.ok(!client.includes("password"));
  assert.ok(!client.includes("console.log"));
  assert.ok(route.includes('"referrer-policy": "no-referrer"'));
  assert.ok(route.includes("createSchoolSsoUrl"));
});
