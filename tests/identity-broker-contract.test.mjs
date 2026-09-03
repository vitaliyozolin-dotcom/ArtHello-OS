import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("passwordless challenges are hashed, expiring, rate-limited and one-time", async () => {
  const [broker, migration] = await Promise.all([
    read("../server/identity-broker.ts"),
    read("../drizzle/0006_identity_broker.sql"),
  ]);
  assert.match(broker, /createHmac/);
  assert.match(broker, /identifier_hash/);
  assert.match(broker, /code_hash/);
  assert.match(broker, /magic_token_hash/);
  assert.match(broker, /PASSWORDLESS_MAX_REQUESTS_PER_TARGET = 3/);
  assert.match(broker, /PASSWORDLESS_MAX_REQUESTS_PER_IP = 12/);
  assert.match(broker, /used_at IS NULL/);
  assert.match(broker, /expires_at > \?/);
  assert.match(broker, /attempts < max_attempts/);
  assert.doesNotMatch(migration, /\bcode\s+text/i);
  assert.doesNotMatch(migration, /\bmagic_token\s+text/i);
});

test("passwordless delivery is a signed server-to-server call", async () => {
  const broker = await read("../server/identity-broker.ts");
  assert.match(broker, /PASSWORDLESS_DELIVERY_URL/);
  assert.match(broker, /PASSWORDLESS_DELIVERY_TOKEN/);
  assert.match(broker, /x-arthello-timestamp/);
  assert.match(broker, /x-arthello-signature/);
  assert.match(broker, /AbortSignal\.timeout\(12_000\)/);
  assert.match(broker, /url\.protocol !== "https:"/);
  assert.doesNotMatch(broker, /console\.log\([^\n]*(code|magicLink)/i);
});

test("central employee SSO is stateful, PKCE-bound and fixed-audience", async () => {
  const central = await read("../server/central-sso.ts");
  assert.match(central, /school_sso_tx/);
  assert.match(central, /school-sso-transaction/);
  assert.match(central, /code_challenge/);
  assert.match(central, /codeVerifier/);
  assert.match(central, /\/api\/school-sso\/authorize/);
  assert.match(central, /\/api\/school-sso\/exchange/);
  assert.match(central, /arthello-188-225-38-55\.sslip\.io/);
  assert.match(central, /school-188-225-38-55\.sslip\.io/);
  assert.match(central, /PUBLIC_APP_ORIGIN/);
  assert.match(
    central,
    /headers:\s*{[\s\S]*?"content-type": "application\/json",[\s\S]*?"content-length": String\(Buffer\.byteLength\(exchangeBody\)\),[\s\S]*?origin: schoolPublicOrigin\(\),[\s\S]*?}/,
  );
  assert.doesNotMatch(central, /origin: exchangeUrl\.origin/);
  assert.match(central, /returnTo: transaction\.returnTo/);
  assert.doesNotMatch(central, /redirect_uri/);
});

test("central employee callback never redirects to an internal bind address", async () => {
  const callback = await read("../app/auth/central/callback/route.ts");
  assert.match(callback, /schoolPublicOrigin/);
  assert.match(callback, /const publicOrigin = schoolPublicOrigin\(\)/);
  assert.match(callback, /new URL\(completed\.returnTo, publicOrigin\)/);
  assert.match(callback, /new URL\("\/login", publicOrigin\)/);
  assert.doesNotMatch(callback, /new URL\(completed\.returnTo, url\.origin\)/);
  assert.doesNotMatch(callback, /new URL\("\/login", url\.origin\)/);
});

test("staff passwords are retired while family fallback remains controllable", async () => {
  const route = await read("../app/api/auth/login/route.ts");
  assert.match(route, /ENABLE_LEGACY_PASSWORD_LOGIN/);
  assert.match(route, /value !== "false" && value !== "0"/);
  assert.match(route, /staffRoles\.has\(user\.role\)/);
  assert.match(route, /Сотрудники входят через ArtHello OS/);
  assert.match(route, /status: 410/);
  assert.match(route, /createSession\(user, request\)/);
});
