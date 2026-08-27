import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const auth = readFileSync("server/auth.ts", "utf8");
const schoolApi = readFileSync("app/api/school/route.ts", "utf8");
const migration = readFileSync("drizzle/0004_phone_auth.sql", "utf8");
const interfaceSource = readFileSync("app/school-app.tsx", "utf8");
const compose = readFileSync("deploy/docker-compose.yml", "utf8");
const caddy = readFileSync("deploy/Caddyfile.school", "utf8");

test("phone or email login uses hashed passwords and server sessions", () => {
  assert.match(auth, /scrypt\$/);
  assert.match(auth, /timingSafeEqual/);
  assert.match(auth, /HttpOnly/);
  assert.match(auth, /SameSite=Lax/);
  assert.match(auth, /auth_sessions/);
  assert.match(auth, /lower\(email\)/);
  assert.match(migration, /token_hash text NOT NULL/);
  assert.doesNotMatch(schoolApi, /oai-authenticated-user-email/);
});

test("same-origin validation uses the configured public origin behind the proxy", () => {
  assert.match(auth, /process\.env\.PUBLIC_APP_ORIGIN/);
  assert.match(auth, /parseCanonicalOrigin\(configuredOrigin\)/);
  assert.match(auth, /url\.protocol !== "http:"/);
  assert.match(auth, /url\.protocol !== "https:"/);
  assert.match(auth, /url\.pathname !== "\/"/);
  assert.doesNotMatch(
    auth,
    /origin && origin !== new URL\(request\.url\)\.origin/,
  );
  assert.doesNotMatch(auth, /x-forwarded-(host|proto)/i);
  assert.equal(
    auth.match(/expectedRequestOrigin\(request\)\.startsWith\("https:\/\/"\)/g)
      ?.length,
    2,
  );
});

test("first login and central reset invalidate previous access", () => {
  assert.match(migration, /credential_tokens/);
  assert.match(auth, /used_at IS NULL/);
  assert.match(schoolApi, /user\.password\.reset/);
  assert.match(schoolApi, /centralDirectoryActions/);
});

test("management exposes central identity source", () => {
  assert.match(interfaceSource, /Источник: ArtHello OS/);
  assert.match(interfaceSource, /одноразовая ссылка/iu);
});

test("self-hosted service is not exposed without the HTTPS proxy", () => {
  assert.match(compose, /127\.0\.0\.1:3111:3000/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /healthcheck:/);
  assert.match(compose, /school-188-225-38-55\.sslip\.io/);
  assert.match(caddy, /^school-188-225-38-55\.sslip\.io/m);
  assert.doesNotMatch(caddy, /^school\.arthelloteam\.ru/m);
});
