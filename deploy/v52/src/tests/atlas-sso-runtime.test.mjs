import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Log, LogLevel, Miniflare } from "miniflare";

const CENTRAL_ORIGIN = "https://arthello-188-225-38-55.sslip.io";
const ATLAS_ORIGIN = "https://atlas-188-225-38-55.sslip.io";
const LOGIN = "atlas-sso-owner@example.test";
const BOOTSTRAP_PASSWORD = "Atlas-Sso-Bootstrap-Password-42";
const PERMANENT_PASSWORD = "Atlas-Sso-Permanent-Password-73";

test("owner explicitly grants and revokes Atlas SSO while live access remains authoritative", { timeout: 30_000 }, async () => {
  const persistenceRoot = mkdtempSync(join(tmpdir(), "arthello-atlas-sso-"));
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
      ARTHELLO_PUBLIC_ORIGIN: CENTRAL_ORIGIN,
      ATLAS_PUBLIC_ORIGIN: ATLAS_ORIGIN,
      ATLAS_CENTRAL_ACCESS_SECRET: "atlas-session-check-test-only-key-123456789",
      ARTHELLO_BOOTSTRAP_LOGIN: LOGIN,
      ARTHELLO_BOOTSTRAP_PASSWORD: BOOTSTRAP_PASSWORD,
      INTEGRATION_CREDENTIALS_KEY: "atlas-sso-runtime-integration-key-1234567890",
    },
    d1Databases: { DB: "arthello-atlas-sso-test" },
    d1Persist: persistenceRoot,
    assets: {
      directory: join(applicationRoot, "dist/client"),
      binding: "ASSETS",
      routerConfig: { invoke_user_worker_ahead_of_assets: false, has_user_worker: true },
    },
  });

  const request = (pathname, init = {}) =>
    runtime.dispatchFetch(`${CENTRAL_ORIGIN}${pathname}`, init);
  const postJson = (pathname, body, headers = {}) =>
    request(pathname, {
      method: "POST",
      headers: {
        origin: CENTRAL_ORIGIN,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });

  try {
    const exchangeBody = JSON.stringify({
      code: "x".repeat(43),
      codeVerifier: "y".repeat(43),
    });
    const missingLength = await request("/api/atlas-sso/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: exchangeBody,
    });
    assert.equal(missingLength.status, 411);
    const wrongMediaType = await request("/api/atlas-sso/exchange", {
      method: "POST",
      headers: { "content-type": "text/plain", "content-length": String(exchangeBody.length) },
      body: exchangeBody,
    });
    assert.equal(wrongMediaType.status, 415);
    const oversizedBody = " ".repeat(4_097);
    const oversized = await request("/api/atlas-sso/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "4097" },
      body: oversizedBody,
    });
    assert.equal(oversized.status, 413);
    const foreignOrigin = await request("/api/atlas-sso/exchange", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/json",
        "content-length": String(exchangeBody.length),
      },
      body: exchangeBody,
    });
    assert.equal(foreignOrigin.status, 403);

    const anonymous = await request(authorizePath("a", "/journal"), {
      redirect: "manual",
    });
    assert.equal(anonymous.status, 303);
    const fallback = new URL(anonymous.headers.get("location") ?? CENTRAL_ORIGIN);
    assert.equal(fallback.origin, CENTRAL_ORIGIN);
    assert.equal(fallback.pathname, "/school-sso/login");
    assert.match(fallback.searchParams.get("continue") ?? "", /^\/api\/atlas-sso\/authorize\?/);

    const proxiedAnonymous = await runtime.dispatchFetch(
      `http://arthello-internal${authorizePath("p", "/journal")}`,
      { redirect: "manual" },
    );
    assert.equal(proxiedAnonymous.status, 303);
    assert.equal(
      new URL(proxiedAnonymous.headers.get("location") ?? "http://invalid").origin,
      CENTRAL_ORIGIN,
      "the login redirect must use the configured external HTTPS origin behind a proxy",
    );

    const firstLogin = await postJson("/api/auth/login", {
      login: LOGIN,
      password: BOOTSTRAP_PASSWORD,
    });
    assert.equal(firstLogin.status, 200);
    const firstCookies = responseCookieJar(firstLogin);
    const firstCsrf = cookieValue(firstCookies, "__Host-arthello_csrf");
    assert.match(
      firstLogin.headers.getSetCookie().find((value) => value.startsWith("__Host-arthello_session=")) ?? "",
      /HttpOnly; Secure; SameSite=Lax/,
    );

    const temporaryMe = await request("/api/auth/me", {
      headers: { cookie: firstCookies },
    });
    assert.equal(temporaryMe.status, 200);
    assert.equal((await temporaryMe.json()).mustChangePassword, true);

    const temporaryAuthorization = await request(authorizePath("t", "/journal"), {
      redirect: "manual",
      headers: { cookie: firstCookies },
    });
    assert.equal(temporaryAuthorization.status, 303);
    const passwordGate = new URL(
      temporaryAuthorization.headers.get("location") ?? CENTRAL_ORIGIN,
    );
    assert.equal(passwordGate.origin, CENTRAL_ORIGIN);
    assert.equal(passwordGate.pathname, "/school-sso/login");
    assert.match(
      passwordGate.searchParams.get("continue") ?? "",
      /^\/api\/atlas-sso\/authorize\?/,
    );

    const passwordChanged = await postJson(
      "/api/auth/password",
      { currentPassword: BOOTSTRAP_PASSWORD, newPassword: PERMANENT_PASSWORD },
      { cookie: firstCookies, "x-csrf-token": firstCsrf },
    );
    assert.equal(passwordChanged.status, 200);

    const login = await postJson("/api/auth/login", {
      login: LOGIN,
      password: PERMANENT_PASSWORD,
    });
    assert.equal(login.status, 200);
    const cookies = responseCookieJar(login);
    const csrf = cookieValue(cookies, "__Host-arthello_csrf");
    assert.equal((await login.clone().json()).mustChangePassword, false);

    const d1 = await runtime.getD1Database("DB");
    const grantBeforeSettings = await d1.prepare(
      "SELECT role,status,access_version FROM user_system_access WHERE user_id='USR-OWNER' AND system_id='SYS-SCHOOL-ATLAS'",
    ).first();
    assert.equal(grantBeforeSettings, null);
    const settings = await request("/api/settings", { headers: { cookie: cookies } });
    assert.equal(settings.status, 200);
    const grantAfterSettings = await d1.prepare(
      "SELECT role,status,access_version FROM user_system_access WHERE user_id='USR-OWNER' AND system_id='SYS-SCHOOL-ATLAS'",
    ).first();
    assert.equal(grantAfterSettings, null);

    await assertAuthorizationDenied(request, cookies, "n", "/journal", /Доступ к электронному дневнику не выдан/);

    const protectedOwnerBefore = await ownerCentralAccess(d1);
    const grantedByOwner = await postJson(
      "/api/settings",
      {
        action: "saveOwnerDiaryAccess", systemId: "SYS-SCHOOL-ATLAS",
        enabled: true,
        diaryRole: "director",
        role: "Сотрудник",
        contact: "attempted-change@example.test",
        isAdministrative: false,
        allowedModules: [],
        accessVersion: 999,
      },
      { cookie: cookies, "x-csrf-token": csrf },
    );
    assert.equal(grantedByOwner.status, 200, await grantedByOwner.clone().text());
    assert.deepEqual(await ownerCentralAccess(d1), protectedOwnerBefore);
    const grant = await d1.prepare(
      "SELECT role,status,access_version FROM user_system_access WHERE user_id='USR-OWNER' AND system_id='SYS-SCHOOL-ATLAS'",
    ).first();
    assert.deepEqual(grant, { role: "director", status: "Активен", access_version: 1 });

    const updatedByOwner = await postJson(
      "/api/settings",
      { action: "saveOwnerDiaryAccess", systemId: "SYS-SCHOOL-ATLAS", enabled: true, diaryRole: "deputy" },
      { cookie: cookies, "x-csrf-token": csrf },
    );
    assert.equal(updatedByOwner.status, 200, await updatedByOwner.clone().text());
    assert.deepEqual(await d1.prepare(
      "SELECT role,status,access_version FROM user_system_access WHERE user_id='USR-OWNER' AND system_id='SYS-SCHOOL-ATLAS'",
    ).first(), { role: "deputy", status: "Активен", access_version: 1 });
    const restoredByOwner = await postJson(
      "/api/settings",
      { action: "saveOwnerDiaryAccess", systemId: "SYS-SCHOOL-ATLAS", enabled: true, diaryRole: "director" },
      { cookie: cookies, "x-csrf-token": csrf },
    );
    assert.equal(restoredByOwner.status, 200, await restoredByOwner.clone().text());

    const valid = await issueAuthorization(request, cookies, "b", "/journal/today?view=compact");
    const wrongPkce = await exchange(request, valid.code, "wrong-verifier-value".padEnd(64, "x"));
    assert.equal(wrongPkce.status, 401);
    const exchanged = await exchange(request, valid.code, valid.verifier);
    assert.equal(exchanged.status, 200);
    const payload = await exchanged.json();
    assert.deepEqual(payload.identity, {
      centralUserId: "USR-OWNER",
      displayName: "Виталий Озолин",
      contact: LOGIN,
      role: "director",
      accessVersion: 1,
    });
    assert.equal(payload.systemId, "SYS-SCHOOL-ATLAS");
    assert.equal(payload.branchId, "BR-ATLAS-SCHOOL");
    const check = async (identity = payload.identity, overrides = {}, key = "atlas-session-check-test-only-key-123456789") => {
      const body=JSON.stringify({systemId:"SYS-SCHOOL-ATLAS",branchId:"BR-ATLAS-SCHOOL",identity,...overrides});
      const stamp=String(Math.floor(Date.now()/1000));
      return request("/api/atlas-sso/check", {method:"POST",headers:{"content-type":"application/json","content-length":String(Buffer.byteLength(body)),"x-arthello-timestamp":stamp,"x-arthello-signature":createHmac("sha256",key).update(stamp+"."+body).digest("hex")},body});
    };
    assert.equal((await check()).status,200);
    assert.equal((await check(payload.identity,{systemId:"SYS-SCHOOL-1-11"})).status,403);
    assert.equal((await check(payload.identity,{branchId:"BR-KINDERGARTEN"})).status,403);
    assert.equal((await check(payload.identity,{},"wrong-key")).status,403);
    await d1.prepare("UPDATE app_users SET is_administrative=0 WHERE id='USR-OWNER'").run();
    assert.equal((await check()).status,403,"Atlas branch membership required");
    await d1.prepare("INSERT INTO user_branch_access(user_id,branch_id,access_level,granted_by) VALUES('USR-OWNER','BR-SCHOOL','Работа','fixture')").run();
    assert.equal((await check()).status,403,"1–11 membership does not grant Atlas");
    await d1.prepare("INSERT INTO user_branch_access(user_id,branch_id,access_level,granted_by) VALUES('USR-OWNER','BR-ATLAS-SCHOOL','Работа','fixture')").run();
    assert.equal((await check()).status,200);
    await d1.prepare("UPDATE app_users SET is_administrative=1 WHERE id='USR-OWNER'").run();
    await d1.prepare("DELETE FROM user_branch_access WHERE user_id='USR-OWNER'").run();
    assert.equal(payload.returnTo, "/journal/today?view=compact");
    assert.equal((await exchange(request, valid.code, valid.verifier)).status, 401);

    const roleChanged = await issueAuthorization(request, cookies, "c", "/");
    await d1.prepare(
      "UPDATE user_system_access SET role='teacher' WHERE user_id='USR-OWNER' AND system_id='SYS-SCHOOL-ATLAS'",
    ).run();
    assert.equal((await check()).status,403,"Changed role invalidates existing Atlas session");
    const deniedRole = await exchange(request, roleChanged.code, roleChanged.verifier);
    assert.equal(deniedRole.status, 401);
    assert.match((await deniedRole.json()).error, /Права доступа изменились/);
    await d1.prepare(
      "UPDATE user_system_access SET role='director' WHERE user_id='USR-OWNER' AND system_id='SYS-SCHOOL-ATLAS'",
    ).run();

    const versionChanged = await issueAuthorization(request, cookies, "d", "/");
    await d1.prepare("UPDATE app_users SET access_version=2 WHERE id='USR-OWNER'").run();
    assert.equal((await check()).status,403,"Changed version invalidates existing Atlas session");
    const deniedVersion = await exchange(request, versionChanged.code, versionChanged.verifier);
    assert.equal(deniedVersion.status, 401);
    assert.match((await deniedVersion.json()).error, /Права доступа изменились/);
    await d1.prepare("UPDATE app_users SET access_version=1 WHERE id='USR-OWNER'").run();

    const suspended = await issueAuthorization(request, cookies, "e", "/");
    await d1.prepare(
      "UPDATE user_system_access SET status='Приостановлен' WHERE user_id='USR-OWNER' AND system_id='SYS-SCHOOL-ATLAS'",
    ).run();
    assert.equal((await check()).status,403,"Suspension invalidates existing Atlas session");
    const deniedSuspended = await exchange(request, suspended.code, suspended.verifier);
    assert.equal(deniedSuspended.status, 401);
    assert.match((await deniedSuspended.json()).error, /Доступ к электронному дневнику не выдан/);

    const revokedByOwner = await postJson(
      "/api/settings",
      { action: "saveOwnerDiaryAccess", systemId: "SYS-SCHOOL-ATLAS", enabled: false, diaryRole: "teacher" },
      { cookie: cookies, "x-csrf-token": csrf },
    );
    assert.equal(revokedByOwner.status, 200, await revokedByOwner.clone().text());
    assert.equal(await d1.prepare(
      "SELECT id FROM user_system_access WHERE user_id='USR-OWNER' AND system_id='SYS-SCHOOL-ATLAS'",
    ).first(), null);
    assert.deepEqual(await ownerCentralAccess(d1), protectedOwnerBefore);
    await assertAuthorizationDenied(request, cookies, "r", "/journal", /Доступ к электронному дневнику не выдан/);

    const throttledIp = "198.51.100.7";
    const throttledSubject = createHash("sha256")
      .update(`arthello:atlas-sso-exchange-rate:v1:ip:${throttledIp}`)
      .digest("base64url");
    const quotaNow = Math.floor(Date.now() / 1000);
    await d1.prepare(`INSERT INTO atlas_sso_exchange_rate_limits
      (subject_hash,window_started_at,request_count,active_until,expires_at)
      VALUES (?,?,?,?,?)`).bind(
        throttledSubject,
        quotaNow,
        60,
        0,
        quotaNow + 120,
      ).run();
    const throttled = await exchange(
      request,
      "x".repeat(43),
      "y".repeat(43),
      throttledIp,
    );
    assert.equal(throttled.status, 429);
    assert.equal(
      (await exchange(request, "x".repeat(43), "y".repeat(43), "198.51.100.8")).status,
      401,
    );
    const leasedIp = "198.51.100.9";
    const leasedSubject = createHash("sha256")
      .update(`arthello:atlas-sso-exchange-rate:v1:ip:${leasedIp}`)
      .digest("base64url");
    const nowSeconds = Math.floor(Date.now() / 1000);
    await d1.prepare(`INSERT INTO atlas_sso_exchange_rate_limits
      (subject_hash,window_started_at,request_count,active_until,expires_at)
      VALUES (?,?,?,?,?)`).bind(
        leasedSubject,
        nowSeconds,
        1,
        nowSeconds + 60,
        nowSeconds + 120,
      ).run();
    assert.equal(
      (await exchange(request, "x".repeat(43), "y".repeat(43), leasedIp)).status,
      429,
    );
    await d1.prepare(`UPDATE atlas_sso_exchange_rate_limits
      SET active_until=0,expires_at=0 WHERE subject_hash=?`).bind(leasedSubject).run();
    assert.equal(
      (await exchange(request, "x".repeat(43), "y".repeat(43), leasedIp)).status,
      401,
    );
    assert.deepEqual(await d1.prepare(`SELECT request_count FROM atlas_sso_exchange_rate_limits
      WHERE subject_hash=?`).bind(leasedSubject).first(), { request_count: 1 });
    const rateRows = await d1.prepare(
      "SELECT subject_hash FROM atlas_sso_exchange_rate_limits",
    ).all();
    assert.ok(rateRows.results.length >= 2);
    for (const row of rateRows.results) {
      assert.match(row.subject_hash, /^[A-Za-z0-9_-]{43}$/);
      assert.doesNotMatch(row.subject_hash, /198\.51\.100\./);
    }
  } finally {
    await runtime.dispose();
    rmSync(persistenceRoot, { recursive: true, force: true });
  }
});

async function issueAuthorization(request, cookies, seed, returnTo) {
  const verifier = seed.repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const response = await request(authorizePath(seed, returnTo, challenge), {
    redirect: "manual",
    headers: { cookie: cookies },
  });
  assert.equal(response.status, 303);
  const callback = new URL(response.headers.get("location") ?? CENTRAL_ORIGIN);
  assert.equal(callback.origin, ATLAS_ORIGIN);
  assert.equal(callback.pathname, "/auth/central/callback");
  assert.equal(callback.searchParams.get("state"), seed.repeat(40));
  const code = callback.searchParams.get("code") ?? "";
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  return { code, verifier };
}

async function assertAuthorizationDenied(request, cookies, seed, returnTo, reasonPattern) {
  const response = await request(authorizePath(seed, returnTo), {
    redirect: "manual",
    headers: { cookie: cookies },
  });
  assert.equal(response.status, 303);
  const denied = new URL(response.headers.get("location") ?? CENTRAL_ORIGIN);
  assert.equal(denied.origin, ATLAS_ORIGIN);
  assert.equal(denied.pathname, "/login");
  assert.equal(denied.searchParams.get("authError"), "central_denied");
  assert.match(denied.searchParams.get("reason") ?? "", reasonPattern);
}

function ownerCentralAccess(d1) {
  return d1.prepare(`SELECT
    u.contact,
    u.role,
    u.is_administrative,
    u.allowed_modules,
    u.access_version,
    central.role AS central_role,
    central.status AS central_status,
    central.access_version AS central_access_version
  FROM app_users u
  JOIN user_system_access central
    ON central.user_id=u.id AND central.system_id='SYS-ARTHELLO-OS'
  WHERE u.id='USR-OWNER'`).first();
}

function authorizePath(seed, returnTo, challenge = createHash("sha256").update(seed.repeat(64)).digest("base64url")) {
  const params = new URLSearchParams({
    system_id: "SYS-SCHOOL-ATLAS",
    state: seed.repeat(40),
    code_challenge: challenge,
    return_to: returnTo,
  });
  return `/api/atlas-sso/authorize?${params}`;
}

function exchange(request, code, codeVerifier, sourceIp = "203.0.113.10") {
  const body = JSON.stringify({ code, codeVerifier });
  return request("/api/atlas-sso/exchange", {
    method: "POST",
    headers: {
      origin: ATLAS_ORIGIN,
      "cf-connecting-ip": sourceIp,
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    },
    body,
  });
}

function responseCookieJar(response) {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
}

function cookieValue(cookieJar, name) {
  const prefix = `${name}=`;
  const pair = cookieJar.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return pair ? decodeURIComponent(pair.slice(prefix.length)) : "";
}
