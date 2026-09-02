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
  assert.match(authorize, /code_challenge/);
  assert.match(authorize, /getAuthenticatedSession/);
  assert.match(authorize, /schoolPublicOrigin\(\)/);
  assert.match(exchange, /exchangeSchoolSsoCode/);
  assert.doesNotMatch(exchange, /getAuthenticatedSession/);
});

test("School SSO resolves access in-process and never self-fetches public ArtHello", async () => {
  const [authorize, access] = await Promise.all([
    read("../app/api/school-sso/authorize/route.ts"),
    read("../lib/school-sso-access.ts"),
  ]);

  assert.match(authorize, /authenticated\.access/);
  assert.match(authorize, /loadSchoolSystemGrant\(me\.app_user_id\)/);
  assert.match(authorize, /authenticated\.user\.role === "owner"/);
  assert.match(authorize, /owner \? "director"/);
  assert.match(authorize, /Доступ к электронному дневнику не выдан/);
  assert.match(authorize, /методист/);
  assert.match(authorize, /methodist/);
  assert.doesNotMatch(authorize, /fetch\s*\(/);
  assert.doesNotMatch(authorize, /\/api\/settings/);
  assert.doesNotMatch(authorize, /SettingsPayload/);

  assert.match(access, /cloudflare:workers/);
  assert.match(access, /user_system_access/);
  assert.match(access, /SYS-SCHOOL-1-11/);
  assert.match(access, /WHERE user_id=\? AND system_id=\?/);
});

test("School SSO derives the complete identity from authenticated ArtHello access", async () => {
  const authorize = await read("../app/api/school-sso/authorize/route.ts");
  for (const field of [
    "centralUserId",
    "displayName",
    "contact",
    "role",
    "accessVersion",
    "app_user_id",
    "display_name",
    "user_access_version",
  ]) assert.match(authorize, new RegExp(field));
});

test("employee can continue an interrupted School SSO login", async () => {
  const page = await read("../app/school-sso/login/page.tsx");
  assert.match(page, /\/api\/auth\/login/);
  assert.match(page, /safeContinue/);
  assert.match(page, /Войти и открыть дневник/);
  assert.match(page, /Родители входят[\s\S]+одноразовому коду/);
});

test("ArtHello education workspace exposes the controlled diary entry", async () => {
  const patch = await read("../scripts/patch-school-sso-entry.mjs");
  assert.match(patch, /SCHOOL_DIARY_SSO_URL/);
  assert.match(patch, /\/auth\/central\/start/);
  assert.match(patch, /Открыть дневник/);
  assert.match(patch, />Завершить входы<\/button>/);
  assert.match(patch, /temporary credential clarification/);
});
