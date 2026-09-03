import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Log, LogLevel, Miniflare } from "miniflare";

import {
  authRouteDecision,
  hasTrustedMutationOrigin,
  publicApiRouteDecision,
} from "../lib/request-security.ts";

const PUBLIC_ORIGIN = "https://arthello-188-225-38-55.sslip.io";
const BOOTSTRAP_LOGIN = "owner@example.test";
const BOOTSTRAP_PASSWORD = "Runtime-Auth-Test-Password-42";
const PERMANENT_PASSWORD = "Runtime-Permanent-Password-73";

test("auth and unauthenticated system routes use an exact path and method allowlist", () => {
  assert.deepEqual(authRouteDecision("/api/auth/me", "GET"), { kind: "allow", access: "public" });
  assert.deepEqual(authRouteDecision("/api/auth/login", "POST"), { kind: "allow", access: "public" });
  assert.deepEqual(authRouteDecision("/api/auth/password", "POST"), { kind: "allow", access: "session" });
  assert.deepEqual(authRouteDecision("/api/auth/logout", "POST"), { kind: "allow", access: "session" });
  assert.deepEqual(authRouteDecision("/api/auth/login", "GET"), { kind: "reject", status: 405, allow: "POST" });
  assert.deepEqual(authRouteDecision("/api/auth/login/extra", "POST"), { kind: "reject", status: 404 });
  assert.deepEqual(publicApiRouteDecision("/api/health", "POST"), { kind: "reject", status: 405, allow: "GET" });
  assert.equal(publicApiRouteDecision("/api/integrations/tochka/callback", "GET"), null);
  assert.equal(publicApiRouteDecision("/api/integrations/tochka/callback", "POST"), null);
  assert.deepEqual(publicApiRouteDecision("/api/school-sso/authorize", "GET"), { kind: "allow", access: "public" });
  assert.deepEqual(publicApiRouteDecision("/api/school-sso/authorize", "POST"), { kind: "reject", status: 405, allow: "GET" });
  assert.deepEqual(publicApiRouteDecision("/api/school-sso/exchange", "POST"), { kind: "allow", access: "public" });
  assert.deepEqual(publicApiRouteDecision("/api/school-sso/exchange", "GET"), { kind: "reject", status: 405, allow: "POST" });
  assert.equal(authRouteDecision("/api/tasks", "GET"), null);
});

test("mutation origin ignores spoofable forwarded headers and uses the canonical origin", () => {
  const accepted = new Request("http://internal:8081/api/tasks", {
    method: "POST",
    headers: { origin: PUBLIC_ORIGIN },
  });
  assert.equal(hasTrustedMutationOrigin(accepted, PUBLIC_ORIGIN), true);

  const spoofed = new Request("http://internal:8081/api/tasks", {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(hasTrustedMutationOrigin(spoofed, PUBLIC_ORIGIN), false);
  assert.equal(hasTrustedMutationOrigin(new Request("http://internal:8081/api/tasks", { method: "POST" }), PUBLIC_ORIGIN), false);
  assert.equal(hasTrustedMutationOrigin(new Request("http://internal:8081/api/tasks"), PUBLIC_ORIGIN), true);

  const proxySource = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.doesNotMatch(proxySource, /headers\.delete\(["'](?:forwarded|x-forwarded-(?:host|proto))["']\)/);
});

test("production worker completes login, password rotation and logout with session and CSRF protection", { timeout: 30_000 }, async () => {
  const persistenceRoot = mkdtempSync(join(tmpdir(), "arthello-auth-runtime-"));
  const applicationRoot = resolve(import.meta.dirname, "..");
  const runtime = new Miniflare({
    log: new Log(LogLevel.ERROR),
    logRequests: false,
    cf: false,
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    modules: true,
    scriptPath: join(applicationRoot, "dist/server/index.js"),
    modulesRoot: join(applicationRoot, "dist/server"),
    modulesRules: [
      { type: "ESModule", include: ["**/*.js", "**/*.mjs"], fallthrough: true },
    ],
    bindings: {
      ARTHELLO_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
      ARTHELLO_BOOTSTRAP_LOGIN: BOOTSTRAP_LOGIN,
      ARTHELLO_BOOTSTRAP_PASSWORD: BOOTSTRAP_PASSWORD,
      INTEGRATION_CREDENTIALS_KEY: "runtime-test-integration-key-1234567890",
    },
    d1Databases: { DB: "arthello-production-auth-test" },
    d1Persist: persistenceRoot,
    assets: {
      directory: join(applicationRoot, "dist/client"),
      binding: "ASSETS",
      routerConfig: { invoke_user_worker_ahead_of_assets: false, has_user_worker: true },
    },
  });

  const request = (pathname, init = {}) => runtime.dispatchFetch(`${PUBLIC_ORIGIN}${pathname}`, init);
  const postJson = (pathname, body, headers = {}) => request(pathname, {
    method: "POST",
    headers: { origin: PUBLIC_ORIGIN, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  try {
    const forged = await postJson("/api/auth/login", { login: BOOTSTRAP_LOGIN, password: BOOTSTRAP_PASSWORD }, {
      origin: "https://evil.example",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    });
    assert.equal(forged.status, 403);

    assert.equal((await request("/api/auth/login")).status, 405);
    assert.equal((await postJson("/api/health", {})).status, 405);
    assert.equal((await request("/api/integrations/tochka/callback?code=untrusted")).status, 401);
    assert.equal((await postJson("/api/integrations/tochka/callback", {})).status, 401);
    assert.equal((await request("/api/school-sso/exchange")).status, 405);
    assert.equal((await postJson("/api/auth/not-a-route", {})).status, 404);

    const anonymousSchoolStart = await request(`/api/school-sso/authorize?state=${"s".repeat(40)}&code_challenge=${"c".repeat(43)}&return_to=%2F`, {
      redirect: "manual",
      headers: {
        "oai-authenticated-user-email": "forged-owner@example.test",
        "x-arthello-role": "OWNER",
        "x-arthello-system-owner": "1",
      },
    });
    assert.equal(anonymousSchoolStart.status, 503);
    assert.equal(anonymousSchoolStart.headers.get("location"), null);
    assert.match((await anonymousSchoolStart.json()).error, /ещё не настроен/);

    const anonymousSchoolExchangeBody = JSON.stringify({
      code: "x".repeat(43),
      codeVerifier: "y".repeat(43),
    });
    const anonymousSchoolExchange = await request("/api/school-sso/exchange", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(anonymousSchoolExchangeBody)),
      },
      body: anonymousSchoolExchangeBody,
    });
    assert.equal(anonymousSchoolExchange.status, 503);
    assert.equal(anonymousSchoolExchange.headers.get("location"), null);
    assert.match((await anonymousSchoolExchange.json()).error, /ещё не настроен/);

    const login = await postJson("/api/auth/login", { login: BOOTSTRAP_LOGIN, password: BOOTSTRAP_PASSWORD });
    assert.equal(login.status, 200);
    const firstUser = await login.json();
    assert.equal(firstUser.userId, "USR-OWNER");
    assert.equal(firstUser.isSystemOwner, true);
    assert.equal(firstUser.mustChangePassword, true);
    const issuedCookies = login.headers.getSetCookie();
    assert.equal(issuedCookies.length, 2);
    assert.match(issuedCookies.find((value) => value.startsWith("__Host-arthello_session=")) ?? "", /Path=\/; Max-Age=28800; HttpOnly; Secure; SameSite=Lax/);
    assert.match(issuedCookies.find((value) => value.startsWith("__Host-arthello_csrf=")) ?? "", /Path=\/; Max-Age=28800; Secure; SameSite=Strict/);
    assert.equal(issuedCookies.some((value) => /\bDomain=/i.test(value)), false);
    const firstCookies = responseCookieJar(login);
    const firstCsrf = cookieValue(firstCookies, "__Host-arthello_csrf");
    assert.ok(firstCsrf);

    const unknownLogin = await postJson("/api/auth/login", { login: "unknown", password: "incorrect" });
    const wrongPassword = await postJson("/api/auth/login", { login: BOOTSTRAP_LOGIN, password: "incorrect" });
    assert.equal(unknownLogin.status, 401);
    assert.equal(wrongPassword.status, 401);
    assert.deepEqual(await unknownLogin.json(), await wrongPassword.json());

    const me = await request("/api/auth/me", { headers: { cookie: firstCookies } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).userId, "USR-OWNER");
    const blockedBeforePasswordChange = await request("/api/settings", { headers: { cookie: firstCookies } });
    assert.equal(blockedBeforePasswordChange.status, 403);

    const forgedPassword = await postJson("/api/auth/password", {
      currentPassword: BOOTSTRAP_PASSWORD,
      newPassword: PERMANENT_PASSWORD,
    }, {
      origin: "https://evil.example",
      cookie: firstCookies,
      "x-csrf-token": firstCsrf,
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    });
    assert.equal(forgedPassword.status, 403);

    const missingCsrf = await postJson("/api/auth/password", {
      currentPassword: BOOTSTRAP_PASSWORD,
      newPassword: PERMANENT_PASSWORD,
    }, { cookie: firstCookies });
    assert.equal(missingCsrf.status, 403);

    const passwordChanged = await postJson("/api/auth/password", {
      currentPassword: BOOTSTRAP_PASSWORD,
      newPassword: PERMANENT_PASSWORD,
    }, { cookie: firstCookies, "x-csrf-token": firstCsrf });
    assert.equal(passwordChanged.status, 200);
    assert.match(passwordChanged.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal((await request("/api/auth/me", { headers: { cookie: firstCookies } })).status, 401);

    const oldPassword = await postJson("/api/auth/login", { login: BOOTSTRAP_LOGIN, password: BOOTSTRAP_PASSWORD });
    assert.equal(oldPassword.status, 401);

    const relogin = await postJson("/api/auth/login", { login: BOOTSTRAP_LOGIN, password: PERMANENT_PASSWORD });
    assert.equal(relogin.status, 200);
    assert.equal((await relogin.clone().json()).mustChangePassword, false);
    const secondCookies = responseCookieJar(relogin);
    const secondCsrf = cookieValue(secondCookies, "__Host-arthello_csrf");
    const retiredTochkaCallback = await request("/api/integrations/tochka/callback?code=untrusted", {
      headers: { cookie: secondCookies },
    });
    assert.equal(retiredTochkaCallback.status, 410);
    assert.doesNotMatch(await retiredTochkaCallback.text(), /TOCHKA_CLIENT_(?:ID|SECRET)/);

    const settings = await request("/api/settings", { headers: { cookie: secondCookies } });
    assert.equal(settings.status, 200);
    const ownerMutation = await postJson("/api/settings", {
      action: "inviteUser",
      contact: BOOTSTRAP_LOGIN,
      displayName: "Подменённый владелец",
      role: "Сотрудник",
      isAdministrative: false,
      branchIds: ["BR-KINDERGARTEN"],
      systemIds: ["SYS-ARTHELLO-OS"],
    }, { cookie: secondCookies, "x-csrf-token": secondCsrf });
    assert.equal(ownerMutation.status, 409);
    assert.match((await ownerMutation.json()).error, /системного владельца/);

    const secondOwner = await postJson("/api/settings", {
      action: "inviteUser",
      contact: "second-owner@example.test",
      displayName: "Второй владелец",
      role: "Собственник",
      isAdministrative: true,
      systemIds: ["SYS-ARTHELLO-OS"],
    }, { cookie: secondCookies, "x-csrf-token": secondCsrf });
    assert.equal(secondOwner.status, 409);
    assert.match((await secondOwner.json()).error, /нельзя назначить/);

    const blockedOwner = await postJson("/api/settings", {
      action: "blockUser",
      userId: "USR-OWNER",
    }, { cookie: secondCookies, "x-csrf-token": secondCsrf });
    assert.equal(blockedOwner.status, 409);
    assert.equal((await request("/api/auth/me", { headers: { cookie: secondCookies } })).status, 200);

    const ownerProfile = await postJson("/api/settings", {
      action: "inviteUser",
      contact: BOOTSTRAP_LOGIN,
      displayName: "Владелец ArtHello",
      role: "Собственник",
      isAdministrative: true,
      systemIds: ["SYS-ARTHELLO-OS"],
    }, { cookie: secondCookies, "x-csrf-token": secondCsrf });
    assert.equal(ownerProfile.status, 200);
    const ownerAfterProfile = await request("/api/auth/me", { headers: { cookie: secondCookies } });
    assert.equal(ownerAfterProfile.status, 200);
    assert.equal((await ownerAfterProfile.json()).name, "Владелец ArtHello");

    const d1 = await runtime.getD1Database("DB");
    const configuredWithoutSchoolOrigin = await postJson("/api/settings", {
      action: "saveOwnerDiaryAccess",
      enabled: true,
      diaryRole: "director",
    }, { cookie: secondCookies, "x-csrf-token": secondCsrf });
    assert.equal(configuredWithoutSchoolOrigin.status, 200);
    const failClosedSchoolStart = await request(`/api/school-sso/authorize?state=${"z".repeat(40)}&code_challenge=${"q".repeat(43)}&return_to=%2Fjournal`, {
      redirect: "manual",
      headers: { cookie: secondCookies },
    });
    assert.equal(failClosedSchoolStart.status, 503);
    assert.equal(failClosedSchoolStart.headers.get("location"), null);
    assert.equal(await d1.prepare(`SELECT name FROM sqlite_master
      WHERE type='table' AND name='school_sso_codes'`).first(), null);
    await d1.batch([
      d1.prepare(`INSERT INTO hr_employees
        (id,candidate_id,contract_id,position_id,unit,rate_minor,hire_date,status,access_status)
        VALUES (?,?,?,?,?,?,?,?,?)`).bind("EMP-COLLISION-A", "", "", "EMPLOYEE", "Тест", 0, "2026-01-01", "Работает", "Активен"),
      d1.prepare(`INSERT INTO hr_employees
        (id,candidate_id,contract_id,position_id,unit,rate_minor,hire_date,status,access_status)
        VALUES (?,?,?,?,?,?,?,?,?)`).bind("EMP-COLLISION-B", "", "", "EMPLOYEE", "Тест", 0, "2026-01-01", "Работает", "Активен"),
      d1.prepare(`INSERT INTO app_users
        (id,contact_type,contact,display_name,role,is_administrative,status,invitation_status,access_version,invited_by)
        VALUES (?,?,?,?,?,0,'Активен','Активирован',1,'runtime-test')`)
        .bind("EMP-COLLISION-A", "email", "employee-a@example.test", "Сотрудник А", "Сотрудник"),
      d1.prepare(`INSERT INTO app_users
        (id,contact_type,contact,display_name,role,is_administrative,status,invitation_status,access_version,invited_by)
        VALUES (?,?,?,?,?,0,'Активен','Активирован',1,'runtime-test')`)
        .bind("EMP-COLLISION-B", "email", "employee-b@example.test", "Сотрудник Б", "Сотрудник"),
    ]);
    const contactCollision = await postJson("/api/settings", {
      action: "inviteUser",
      employeeId: "EMP-COLLISION-A",
      contact: "employee-b@example.test",
      displayName: "Сотрудник А",
      role: "Сотрудник",
      isAdministrative: false,
      branchIds: ["BR-KINDERGARTEN"],
      systemIds: ["SYS-ARTHELLO-OS"],
    }, { cookie: secondCookies, "x-csrf-token": secondCsrf });
    assert.equal(contactCollision.status, 409);
    assert.match((await contactCollision.json()).error, /контакт уже используется/);

    const managedEmployee = await postJson("/api/settings", {
      action: "inviteUser",
      employeeId: "EMP-COLLISION-A",
      contact: "employee-a@example.test",
      displayName: "Сотрудник А обновлён",
      role: "Финансы",
      isAdministrative: false,
      branchIds: ["BR-KINDERGARTEN"],
      systemIds: ["SYS-ARTHELLO-OS"],
    }, { cookie: secondCookies, "x-csrf-token": secondCsrf });
    assert.equal(managedEmployee.status, 201);
    const employeeRow = await d1.prepare("SELECT role,display_name,access_version FROM app_users WHERE id=?")
      .bind("EMP-COLLISION-A").first();
    assert.deepEqual(employeeRow, { role: "Финансы", display_name: "Сотрудник А обновлён", access_version: 2 });
    const employeeGrant = await d1.prepare("SELECT role,access_version FROM user_system_access WHERE user_id=? AND system_id='SYS-ARTHELLO-OS'")
      .bind("EMP-COLLISION-A").first();
    assert.deepEqual(employeeGrant, { role: "Финансы", access_version: 2 });

    const wrongLogoutCsrf = await request("/api/auth/logout", {
      method: "POST",
      headers: { origin: PUBLIC_ORIGIN, cookie: secondCookies, "x-csrf-token": "wrong" },
    });
    assert.equal(wrongLogoutCsrf.status, 403);

    const loggedOut = await request("/api/auth/logout", {
      method: "POST",
      headers: { origin: PUBLIC_ORIGIN, cookie: secondCookies, "x-csrf-token": secondCsrf },
    });
    assert.equal(loggedOut.status, 200);
    assert.match(loggedOut.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal((await request("/api/auth/me", { headers: { cookie: secondCookies } })).status, 401);
  } finally {
    await runtime.dispose();
    rmSync(persistenceRoot, { recursive: true, force: true });
  }
});

function responseCookieJar(response) {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
}

function cookieValue(cookieJar, name) {
  const prefix = `${name}=`;
  const pair = cookieJar.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return pair ? decodeURIComponent(pair.slice(prefix.length)) : "";
}
