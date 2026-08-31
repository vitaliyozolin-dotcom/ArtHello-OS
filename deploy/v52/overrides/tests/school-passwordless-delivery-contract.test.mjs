import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gateway = readFileSync(
  new URL("../lib/school-passwordless-delivery.ts", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL(
    "../app/api/school-passwordless-delivery/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("School delivery endpoint accepts only signed, fresh server requests", () => {
  assert.match(gateway, /SCHOOL_PASSWORDLESS_DELIVERY_SECRET/);
  assert.match(gateway, /x-arthello-timestamp/);
  assert.match(gateway, /x-arthello-signature/);
  assert.match(gateway, /HMAC/);
  assert.match(gateway, /SHA-256/);
  assert.match(gateway, /MAX_CLOCK_SKEW_SECONDS = 5 \* 60/);
  assert.match(gateway, /constantTimeEqual/);
  assert.match(route, /statusFor/);
  assert.match(route, /return 401/);
});

test("delivery payload is restricted to School login and canonical magic links", () => {
  assert.match(gateway, /purpose: "school_login"/);
  assert.match(gateway, /\^passwordless-/);
  assert.match(gateway, /\^\\d\{6\}\$/);
  assert.match(gateway, /school-188-225-38-55\.sslip\.io/);
  assert.match(gateway, /\/api\/auth\/passwordless\/magic/);
  assert.match(gateway, /\^\\\+7\\d\{10\}\$/);
});

test("gateway supports SMS.RU and Resend without exposing provider credentials to School", () => {
  assert.match(gateway, /SMS_RU_API_ID/);
  assert.match(gateway, /https:\/\/sms\.ru\/sms\/send/);
  assert.match(gateway, /application\/x-www-form-urlencoded/);
  assert.match(gateway, /status_code !== 100/);
  assert.match(gateway, /RESEND_API_KEY/);
  assert.match(gateway, /SCHOOL_EMAIL_FROM/);
  assert.match(gateway, /https:\/\/api\.resend\.com\/emails/);
  assert.match(gateway, /idempotency-key/);
  assert.match(route, /return 503/);
});

test("delivery journal is idempotent and never stores codes, links or message bodies", () => {
  assert.match(gateway, /school_passwordless_deliveries/);
  assert.match(gateway, /event_id TEXT PRIMARY KEY/);
  assert.match(gateway, /target_hash TEXT NOT NULL/);
  assert.match(gateway, /existing\?\.status === "completed"/);
  assert.match(gateway, /duplicate: true/);
  const tableDefinition = gateway.match(
    /CREATE TABLE IF NOT EXISTS school_passwordless_deliveries \([\s\S]*?\)`,/,
  )?.[0];
  assert.ok(tableDefinition);
  assert.doesNotMatch(tableDefinition, /code|magic|message|target TEXT/i);
});

test("provider errors are sanitized and recorded without returning secrets", () => {
  assert.match(gateway, /SMS provider rejected the message/);
  assert.match(gateway, /Email provider rejected the message/);
  assert.match(gateway, /message\.slice\(0, 240\)/);
  assert.doesNotMatch(route, /console\.(log|error)/);
  assert.doesNotMatch(route, /SMS_RU_API_ID|RESEND_API_KEY/);
});