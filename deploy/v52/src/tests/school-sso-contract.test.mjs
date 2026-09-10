import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("School SSO uses one-time PKCE-bound authorization codes", async () => {
  const [broker, authorize, exchange] = await Promise.all([
    read("../lib/school-sso.ts"),
    read("../app/api/school-sso/authorize/route.ts"),
    read("../app/api/school-sso/exchange/route.ts"),
  ]);
  assert.match(broker, /school_sso_codes/);
  assert.match(broker, /CODE_TTL_SECONDS = 60/);
  assert.match(broker, /code_challenge/);
  assert.match(broker, /used_at = 0/);
  assert.match(broker, /UPDATE school_sso_codes[\s\S]+RETURNING/);
  assert.match(broker, /requireCurrentSchoolSsoIdentity/);
  assert.match(broker, /issuedIdentity[\s\S]+currentIdentity/);
  assert.match(authorize, /code_challenge/);
  assert.match(authorize, /getAuthenticatedSession/);
  assert.match(authorize, /authenticated\.user\.mustChangePassword/);
  assert.match(authorize, /artHelloPublicOrigin\(\)/);
  assert.match(authorize, /schoolPublicOrigin\(\)/);
  assert.match(authorize, /loginRedirect\(url, centralOrigin\)/);
  assert.doesNotMatch(authorize, /new URL\("\/school-sso\/login", url\.origin\)/);
  assert.match(authorize, /schoolOrigin = schoolPublicOrigin\(\)[\s\S]+status: 503/);
  assert.match(authorize, /new URL\("\/auth\/central\/callback", schoolOrigin\)/);
  assert.ok(
    authorize.indexOf("schoolOrigin = schoolPublicOrigin()") < authorize.indexOf("issueSchoolSsoCode("),
    "the trusted school origin must be validated before an authorization code is issued",
  );
  assert.match(authorize, /requireCurrentSchoolSsoIdentity/);
  assert.match(authorize, /expectedAccessErrors\.has\(message\)/);
  assert.match(authorize, /school_sso\.authorize_failed/);
  assert.doesNotMatch(authorize, /message\.slice/);
  assert.doesNotMatch(authorize, /fetch\s*\(/);
  assert.doesNotMatch(authorize, /\/api\/settings/);
  assert.match(exchange, /exchangeSchoolSsoCode/);
  assert.match(exchange, /MAX_EXCHANGE_BODY_BYTES = 4 \* 1024/);
  assert.match(exchange, /contentEncoding !== "identity"/);
  assert.match(exchange, /mediaType !== "application\/json"/);
  assert.match(exchange, /request\.headers\.get\("content-length"\)/);
  assert.match(exchange, /contentLength > MAX_EXCHANGE_BODY_BYTES/);
  assert.match(exchange, /keys\.length !== 2/);
  assert.match(exchange, /keys\.includes\("code"\)/);
  assert.match(exchange, /keys\.includes\("codeVerifier"\)/);
  assert.ok(
    exchange.indexOf("envelopeIssue(request)") < exchange.indexOf("request.json()"),
    "the bounded JSON envelope must be checked before parsing",
  );
  assert.match(exchange, /acquireSchoolSsoExchangeRateLease/);
  assert.match(exchange, /releaseSchoolSsoExchangeRateLease/);
  assert.match(exchange, /suppliedOrigin !== parsedOrigin\.origin/);
  assert.doesNotMatch(exchange, /getAuthenticatedSession/);
});

test("public School SSO exchange is rate limited without persisting a raw source address", async () => {
  const [broker, securityDoc] = await Promise.all([
    read("../lib/school-sso.ts"),
    read("../docs/school-sso-security.md"),
  ]);
  assert.match(broker, /school_sso_exchange_rate_limits/);
  assert.match(broker, /EXCHANGE_RATE_WINDOW_REQUESTS = 60/);
  assert.match(broker, /cf-connecting-ip/);
  assert.match(broker, /arthello:school-sso-exchange-rate:v1:/);
  assert.match(broker, /sha256\(`arthello:school-sso-exchange-rate:v1:/);
  assert.match(broker, /ON CONFLICT\(subject_hash\) DO UPDATE SET/);
  assert.match(broker, /active_until<=\?/);
  assert.match(broker, /request_count<\?/);
  assert.match(broker, /RETURNING subject_hash/);
  assert.match(broker, /DELETE FROM school_sso_exchange_rate_limits WHERE expires_at <= \?/);
  assert.doesNotMatch(broker, /(?:client|source|remote)_ip\s+TEXT/i);
  assert.match(securityDoc, /CF-Connecting-IP/);
  assert.match(securityDoc, /reverse proxy/);
  assert.match(securityDoc, /Edge\/WAF rate limit/);
});

test("production runtime passes explicit diary configuration and never falls back to another environment", async () => {
  const [broker, runtime] = await Promise.all([
    read("../lib/school-sso.ts"),
    read("../production/runtime-server.mjs"),
  ]);
  assert.match(broker, /trustedHttpsOrigin\(runtimeEnv\(\)\.SCHOOL_PUBLIC_ORIGIN, "School"\)/);
  assert.match(broker, /trustedHttpsOrigin\(runtimeEnv\(\)\.ARTHELLO_PUBLIC_ORIGIN, "ArtHello"\)/);
  assert.match(broker, /if \(!configured\) throw new Error\(`\$\{label\} public origin is unavailable`\)/);
  assert.match(broker, /url\.protocol !== "https:"/);
  for (const forbiddenPart of ["url.username", "url.password", "url.search", "url.hash"]) {
    assert.match(broker, new RegExp(forbiddenPart.replace(".", "\\.")));
  }
  assert.match(broker, /url\.pathname !== "\/"/);
  assert.doesNotMatch(broker, /SCHOOL_FALLBACK_ORIGIN|school-188-225-38-55\.sslip\.io/);
  for (const name of [
    "SCHOOL_PUBLIC_ORIGIN",
    "SCHOOL_DIARY_SYNC_URL",
    "SCHOOL_DIARY_ALLOWED_ORIGINS",
  ]) assert.match(runtime, new RegExp(`${name}: process\\.env\\.${name}`));
  assert.match(runtime, /readRuntimeSecret\(\s*"CENTRAL_ACCESS_SECRET",\s*"CENTRAL_ACCESS_SECRET_FILE",?\s*\)/);
  assert.match(runtime, /CENTRAL_ACCESS_SECRET: centralAccessSecret/);
  assert.doesNotMatch(runtime, /CENTRAL_ACCESS_SECRET:\s*process\.env/);
});

test("School SSO derives identity from live central and diary grants", async () => {
  const broker = await read("../lib/school-sso.ts");
  for (const field of [
    "user_status",
    "user_access_version",
    "school_role",
    "school_status",
    "school_access_version",
    "central_status",
    "central_access_version",
  ]) assert.match(broker, new RegExp(field));
  assert.match(broker, /SYS-SCHOOL-1-11/);
  assert.match(broker, /SYS-ARTHELLO-OS/);
  assert.match(broker, /schoolAccessVersion !== userAccessVersion/);
  assert.match(broker, /centralAccessVersion !== userAccessVersion/);
  assert.match(broker, /issuedIdentity\.role !== role/);
  assert.match(broker, /issuedIdentity\.accessVersion !== userAccessVersion/);
  assert.match(broker, /Доступ к электронному дневнику не выдан/);
  assert.doesNotMatch(broker, /includes\("актив"\)/);
});

test("employee can continue an interrupted School SSO login", async () => {
  const page = await read("../app/school-sso/login/page.tsx");
  assert.match(page, /\/api\/auth\/login/);
  assert.match(page, /\/api\/auth\/password/);
  assert.match(page, /mustChangePassword/);
  assert.match(page, /x-csrf-token/);
  assert.match(page, /safeContinue/);
  assert.match(page, /Войти и открыть дневник/);
  assert.match(page, /Родители входят[\s\S]+одноразовому коду/);
});

test("ArtHello education workspace exposes the controlled diary entry", async () => {
  const [workspace, patch] = await Promise.all([
    read("../app/components/EducationWorkspace.tsx"),
    read("../scripts/patch-school-sso-entry.mjs"),
  ]);
  assert.match(workspace, /SCHOOL_DIARY_SSO_URL/);
  assert.match(workspace, /window\.location\.assign\(SCHOOL_DIARY_SSO_URL\)/);
  assert.match(workspace, />Дневник 1–11<\/Button>/);
  assert.match(workspace, /window\.location\.assign\("\/api\/atlas-sso\/open"\)/);
  assert.match(workspace, />Дневник Атласа<\/Button>/);
  assert.match(patch, /SCHOOL_DIARY_SSO_URL/);
  assert.match(patch, /\/auth\/central\/start/);
  assert.match(patch, /Открыть дневник/);
  assert.match(patch, />Завершить входы<\/button>/);
  assert.match(patch, /temporary credential clarification/);
  assert.match(patch, /installed === 1/);
  assert.match(patch, /SCHOOL_SSO_UI_INSTALLS/);
});

test("central session can return from the diary while mutation CSRF stays strict", async () => {
  const [auth, requestSecurity] = await Promise.all([
    read("../lib/production-auth.ts"),
    read("../lib/request-security.ts"),
  ]);
  assert.match(auth, /SESSION_COOKIE[\s\S]+HttpOnly; Secure; SameSite=Lax/);
  assert.match(auth, /CSRF_COOKIE[\s\S]+Secure; SameSite=Strict/);
  assert.match(requestSecurity, /Readonly<Record<string, "GET" \| "POST">>/);
  assert.match(requestSecurity, /"\/api\/school-sso\/exchange": "POST"/);
});
