import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const auth = readFileSync("server/auth.ts", "utf8");
const identityBroker = readFileSync("server/identity-broker.ts", "utf8");
const centralSso = readFileSync("server/central-sso.ts", "utf8");
const legacyLogin = readFileSync("app/api/auth/login/route.ts", "utf8");
const loginPage = readFileSync("app/login/page.tsx", "utf8");
const schoolApi = readFileSync("app/api/school/route.ts", "utf8");
const passwordlessMigration = readFileSync(
  "drizzle/0006_identity_broker.sql",
  "utf8",
);
const interfaceSource = readFileSync("app/school-app.tsx", "utf8");
const compose = readFileSync("deploy/docker-compose.yml", "utf8");
const caddy = readFileSync("deploy/Caddyfile.school", "utf8");

test("parents and students keep direct diary entry while OTP is introduced", () => {
  assert.match(loginPage, /Получить одноразовый код/);
  assert.match(loginPage, /one-time-code/);
  assert.match(loginPage, /Войти по выданному паролю/);
  assert.match(loginPage, /Временный резервный вход/);
  assert.match(loginPage, /name="password"/);
  assert.match(identityBroker, /randomInt\(0, 1_000_000\)/);
  assert.match(identityBroker, /magicToken/);
  assert.match(identityBroker, /PASSWORDLESS_TTL_SECONDS = 10 \* 60/);
  assert.match(identityBroker, /PASSWORDLESS_MAX_ATTEMPTS = 5/);
  assert.match(passwordlessMigration, /passwordless_challenges/);
  assert.match(passwordlessMigration, /code_hash text NOT NULL/);
  assert.match(passwordlessMigration, /magic_token_hash text NOT NULL/);
});

test("employees use ArtHello OS SSO and cannot create a diary password session", () => {
  assert.match(loginPage, /Вход для сотрудников/);
  assert.doesNotMatch(loginPage, /ArtHello OS|Виталий/);
  assert.match(centralSso, /code_challenge/);
  assert.match(centralSso, /codeVerifier/);
  assert.match(centralSso, /reconcileCentralStaff/);
  assert.match(auth, /HttpOnly/);
  assert.match(auth, /SameSite=Lax/);
  assert.match(auth, /auth_sessions/);
  assert.match(legacyLogin, /staffRoles\.has\(user\.role\)/);
  assert.match(legacyLogin, /Сотрудники входят через ArtHello OS/);
  assert.match(legacyLogin, /status: 410/);
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

test("central revocation invalidates existing technical access", () => {
  assert.match(schoolApi, /centralDirectoryActions/);
  assert.match(identityBroker, /status = 'active'/);
  assert.match(identityBroker, /DELETE FROM auth_sessions WHERE user_id = \?/);
  assert.match(identityBroker, /identity_source = 'arthello_os'/);
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
