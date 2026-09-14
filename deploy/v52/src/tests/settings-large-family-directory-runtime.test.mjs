import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Log, LogLevel, Miniflare } from "miniflare";

const PUBLIC_ORIGIN = "https://arthello-188-225-38-55.sslip.io";
const LOGIN = "large-family-settings-owner@example.test";
const LOGIN_CREDENTIALS = Object.freeze({
  bootstrap: ["Large", "Family", "Bootstrap", "42"].join("-"),
  permanent: ["Large", "Family", "Permanent", "73"].join("-"),
});
const FAMILY_COUNT = 2_887;

test("settings stay available and page a production-sized family directory", { timeout: 30_000 }, async () => {
  const persistenceRoot = mkdtempSync(join(tmpdir(), "arthello-settings-families-"));
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
    modulesRules: [{ type: "ESModule", include: ["**/*.js", "**/*.mjs"], fallthrough: true }],
    bindings: {
      ARTHELLO_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
      ARTHELLO_BOOTSTRAP_LOGIN: LOGIN,
      ARTHELLO_BOOTSTRAP_PASSWORD: LOGIN_CREDENTIALS.bootstrap,
      INTEGRATION_CREDENTIALS_KEY: ["large-family", "settings", "integration", "1234567890"].join("-"),
    },
    d1Databases: { DB: "arthello-settings-families-test" },
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
    const cookies = await ownerSession(postJson);
    const d1 = await runtime.getD1Database("DB");
    await seedFamilyDirectory(d1);

    const baseResponse = await request("/api/settings", { headers: { cookie: cookies } });
    assert.equal(baseResponse.status, 200, await baseResponse.clone().text());
    const base = await baseResponse.json();
    assert.deepEqual(base.familyDirectory, [], "opening settings must not eagerly serialize every family");
    assert.deepEqual(base.familyAccessGrants, [], "opening settings must not eagerly serialize every family grant");

    const pageResponse = await request("/api/settings?section=families&limit=25", { headers: { cookie: cookies } });
    assert.equal(pageResponse.status, 200, await pageResponse.clone().text());
    const page = await pageResponse.json();
    assert.equal(page.familyDirectory.length, 25);
    assert.equal(page.familyDirectoryTotal, FAMILY_COUNT);
    assert.equal(page.familyDirectoryHasMore, true);
    assert.equal(page.familyDirectory[0].members.length, 1);
    assert.deepEqual(page.familyAccessGrants, []);

    const searchResponse = await request("/api/settings?section=families&limit=25&query=иванова", { headers: { cookie: cookies } });
    assert.equal(searchResponse.status, 200, await searchResponse.clone().text());
    const search = await searchResponse.json();
    assert.equal(search.familyDirectoryTotal, 1);
    assert.deepEqual(search.familyDirectory.map((family) => family.id), ["FAMILY-LARGE-2887"]);
  } finally {
    await runtime.dispose();
    rmSync(persistenceRoot, { recursive: true, force: true });
  }
});

async function seedFamilyDirectory(d1) {
  const sequence = `WITH RECURSIVE sequence(value) AS (
    SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < ${FAMILY_COUNT}
  )`;
  await d1.prepare(`${sequence}
    INSERT INTO entities
      (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by)
    SELECT printf('FAMILY-LARGE-%04d',value),'Семья',printf('Семья %04d',value),'Активна',
      'ALFACRM',printf('family-%04d',value),'Проверено','BR-KINDERGARTEN','{}','runtime-test'
    FROM sequence`).run();
  await d1.prepare("UPDATE entities SET display_name = ? WHERE id = ?")
    .bind("Семья Иванова", "FAMILY-LARGE-2887").run();
  await d1.prepare(`${sequence}
    INSERT INTO entities
      (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by)
    SELECT printf('CLIENT-LARGE-%04d',value),'Клиент',printf('Клиент %04d',value),'Активен',
      'ALFACRM',printf('client-%04d',value),'Проверено','BR-KINDERGARTEN','{}','runtime-test'
    FROM sequence`).run();
  await d1.prepare(`${sequence}
    INSERT INTO entity_links (from_entity_id,to_entity_id,relation_type,created_by)
    SELECT printf('FAMILY-LARGE-%04d',value),printf('CLIENT-LARGE-%04d',value),'Родитель','runtime-test'
    FROM sequence`).run();
}

async function ownerSession(postJson) {
  const firstLogin = await postJson("/api/auth/login", { login: LOGIN, password: LOGIN_CREDENTIALS.bootstrap });
  assert.equal(firstLogin.status, 200);
  const firstCookies = responseCookieJar(firstLogin);
  const changed = await postJson("/api/auth/password", {
    currentPassword: LOGIN_CREDENTIALS.bootstrap,
    newPassword: LOGIN_CREDENTIALS.permanent,
  }, { cookie: firstCookies, "x-csrf-token": cookieValue(firstCookies, "__Host-arthello_csrf") });
  assert.equal(changed.status, 200);
  const login = await postJson("/api/auth/login", { login: LOGIN, password: LOGIN_CREDENTIALS.permanent });
  assert.equal(login.status, 200);
  return responseCookieJar(login);
}

function responseCookieJar(response) {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
}

function cookieValue(cookieJar, name) {
  const prefix = `${name}=`;
  const pair = cookieJar.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return pair ? decodeURIComponent(pair.slice(prefix.length)) : "";
}
