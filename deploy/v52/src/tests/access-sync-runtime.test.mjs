import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Log, LogLevel, Miniflare } from "miniflare";

const PUBLIC_ORIGIN = "https://arthello-188-225-38-55.sslip.io";
const LOGIN = "access-outbox-owner@example.test";
const BOOTSTRAP_PASSWORD = "Access-Outbox-Bootstrap-42";
const PERMANENT_PASSWORD = "Access-Outbox-Permanent-73";

test("access mutations commit an atomic outbox, reject stale versions and deduplicate retries", { timeout: 30_000 }, async () => {
  const persistenceRoot = mkdtempSync(join(tmpdir(), "arthello-access-outbox-"));
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
      ARTHELLO_BOOTSTRAP_PASSWORD: BOOTSTRAP_PASSWORD,
      INTEGRATION_CREDENTIALS_KEY: "access-outbox-runtime-integration-key-1234567890",
    },
    d1Databases: { DB: "arthello-access-outbox-test" },
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
    const session = await ownerSession(postJson);
    const authHeaders = { cookie: session.cookies, "x-csrf-token": session.csrf };
    const d1 = await runtime.getD1Database("DB");

    const initialSettings = await settingsData(request, session.cookies);
    const firstOwnerRevision = initialSettings.me.updatedAt;
    const ownerGrant = await postJson("/api/settings", {
      action: "saveOwnerDiaryAccess",
      enabled: true,
      diaryRole: "director",
      expectedAccessVersion: initialSettings.me.accessVersion,
      expectedUpdatedAt: firstOwnerRevision,
    }, authHeaders);
    assert.equal(ownerGrant.status, 200, await ownerGrant.clone().text());

    const firstOwnerEvent = await d1.prepare(`SELECT id,event_type,payload,status,attempts
      FROM access_sync_events WHERE user_id='USR-OWNER' ORDER BY created_at,id LIMIT 1`).first();
    assert.ok(firstOwnerEvent);
    const firstOwnerPayload = JSON.parse(firstOwnerEvent.payload);
    assert.equal(firstOwnerPayload.eventId, firstOwnerEvent.id);
    assert.equal(firstOwnerPayload.action, "upsert");
    assert.equal(firstOwnerPayload.user.accessVersion, initialSettings.me.accessVersion);
    assert.notEqual(firstOwnerPayload.accessRevision, firstOwnerRevision);
    assert.equal(firstOwnerEvent.status, "Ожидает подключения");
    assert.equal(firstOwnerEvent.attempts, 0, "missing configuration is not a transport attempt");
    assert.deepEqual(await d1.prepare(`SELECT role,access_version,updated_at FROM user_system_access
      WHERE user_id='USR-OWNER' AND system_id='SYS-SCHOOL-1-11'`).first(), {
      role: "director",
      access_version: initialSettings.me.accessVersion,
      updated_at: firstOwnerPayload.accessRevision,
    });

    const retriedWithoutConfig = await postJson("/api/settings", {
      action: "retryAccessSync",
      eventId: firstOwnerEvent.id,
    }, authHeaders);
    assert.equal(retriedWithoutConfig.status, 200, await retriedWithoutConfig.clone().text());
    assert.deepEqual(await d1.prepare("SELECT id,attempts,status,payload FROM access_sync_events WHERE id=?")
      .bind(firstOwnerEvent.id).first(), {
      id: firstOwnerEvent.id,
      attempts: 0,
      status: "Ожидает подключения",
      payload: firstOwnerEvent.payload,
    });

    const staleOwner = await postJson("/api/settings", {
      action: "saveOwnerDiaryAccess",
      enabled: true,
      diaryRole: "deputy",
      expectedAccessVersion: initialSettings.me.accessVersion,
      expectedUpdatedAt: firstOwnerRevision,
    }, authHeaders);
    assert.equal(staleOwner.status, 409);
    assert.match((await staleOwner.json()).error, /другом окне/);
    assert.equal(await count(d1, "SELECT COUNT(*) AS count FROM access_sync_events WHERE user_id='USR-OWNER'"), 1);

    const ownerAfterGrant = await settingsData(request, session.cookies);
    const ownerUpdate = await postJson("/api/settings", {
      action: "saveOwnerDiaryAccess",
      enabled: true,
      diaryRole: "deputy",
      expectedAccessVersion: ownerAfterGrant.me.accessVersion,
      expectedUpdatedAt: ownerAfterGrant.me.updatedAt,
    }, authHeaders);
    assert.equal(ownerUpdate.status, 200, await ownerUpdate.clone().text());
    const ownerEvents = await d1.prepare(`SELECT id,payload FROM access_sync_events
      WHERE user_id='USR-OWNER' AND event_type='upsert' ORDER BY created_at,id`).all();
    assert.equal(ownerEvents.results.length, 2);
    const secondOwnerPayload = JSON.parse(ownerEvents.results.find((row) => row.id !== firstOwnerEvent.id).payload);
    assert.notEqual(secondOwnerPayload.eventId, firstOwnerPayload.eventId);
    assert.notEqual(secondOwnerPayload.accessRevision, firstOwnerPayload.accessRevision);
    const staleProjection = await d1.prepare(`UPDATE user_system_access SET last_sync_status='СТАРОЕ СОБЫТИЕ'
      WHERE user_id='USR-OWNER' AND system_id='SYS-SCHOOL-1-11'
        AND access_version=? AND updated_at=?`)
      .bind(firstOwnerPayload.user.accessVersion, firstOwnerPayload.accessRevision).run();
    assert.equal(staleProjection.meta.changes, 0, "an older owner event cannot mark the newer owner diary revision");

    await d1.prepare(`UPDATE access_sync_events SET status='Синхронизировано',attempts=1,last_error='',result='{}'
      WHERE id=?`).bind(firstOwnerEvent.id).run();
    for (let index = 0; index < 2; index += 1) {
      const duplicateRetry = await postJson("/api/settings", { action: "retryAccessSync", eventId: firstOwnerEvent.id }, authHeaders);
      assert.equal(duplicateRetry.status, 200, await duplicateRetry.clone().text());
      assert.match((await duplicateRetry.json()).message, /повторная отправка не требуется/);
    }
    assert.deepEqual(await d1.prepare("SELECT attempts,status FROM access_sync_events WHERE id=?")
      .bind(firstOwnerEvent.id).first(), { attempts: 1, status: "Синхронизировано" });

    const staffPhone = "+79990001122";
    const createdStaff = await postJson("/api/settings", {
      action: "inviteUser",
      contact: staffPhone,
      displayName: "Сотрудник Очереди",
      position: "Учитель",
      role: "Сотрудник",
      allowedModules: ["education"],
      isAdministrative: false,
      branchIds: ["BR-KINDERGARTEN"],
      systemIds: ["SYS-ARTHELLO-OS", "SYS-SCHOOL-1-11"],
      diaryRole: "teacher",
      expectedAccessVersion: 0,
    }, authHeaders);
    assert.equal(createdStaff.status, 201, await createdStaff.clone().text());
    const staff = await d1.prepare("SELECT id,status,access_version FROM app_users WHERE contact=?").bind(staffPhone).first();
    assert.ok(staff);
    assert.equal(staff.access_version, 1);
    const staffEvent = await d1.prepare("SELECT id,payload,status,attempts FROM access_sync_events WHERE user_id=? AND event_type='upsert'")
      .bind(staff.id).first();
    assert.ok(staffEvent);
    assert.equal(JSON.parse(staffEvent.payload).eventId, staffEvent.id);
    assert.deepEqual({ status: staffEvent.status, attempts: staffEvent.attempts }, { status: "Ожидает подключения", attempts: 0 });

    await d1.prepare(`CREATE TRIGGER test_fail_access_outbox
      BEFORE INSERT ON access_sync_events
      BEGIN SELECT RAISE(ABORT,'forced access outbox failure'); END`).run();
    const blockAuditBefore = await count(d1, `SELECT COUNT(*) AS count FROM audit_events
      WHERE action='settings.user_blocked' AND entity_id=?`, staff.id);
    const failedBlock = await postJson("/api/settings", {
      action: "blockUser",
      userId: staff.id,
      expectedAccessVersion: 1,
    }, authHeaders);
    assert.equal(failedBlock.status, 500);
    assert.deepEqual(await d1.prepare("SELECT status,access_version FROM app_users WHERE id=?").bind(staff.id).first(), {
      status: "Активен",
      access_version: 1,
    });
    assert.deepEqual(await d1.prepare(`SELECT status,access_version FROM user_system_access
      WHERE user_id=? AND system_id='SYS-SCHOOL-1-11'`).bind(staff.id).first(), {
      status: "Активен",
      access_version: 1,
    });
    assert.equal(await count(d1, `SELECT COUNT(*) AS count FROM audit_events
      WHERE action='settings.user_blocked' AND entity_id=?`, staff.id), blockAuditBefore);
    assert.equal(await count(d1, "SELECT COUNT(*) AS count FROM access_sync_events WHERE user_id=? AND event_type='block'", staff.id), 0);
    await d1.prepare("DROP TRIGGER test_fail_access_outbox").run();

    const blocked = await postJson("/api/settings", {
      action: "blockUser",
      userId: staff.id,
      expectedAccessVersion: 1,
    }, authHeaders);
    assert.equal(blocked.status, 200, await blocked.clone().text());
    assert.deepEqual(await d1.prepare("SELECT status,access_version FROM app_users WHERE id=?").bind(staff.id).first(), {
      status: "Доступ приостановлен",
      access_version: 2,
    });
    const staleRestore = await postJson("/api/settings", {
      action: "restoreUser",
      userId: staff.id,
      expectedAccessVersion: 1,
    }, authHeaders);
    assert.equal(staleRestore.status, 409);
    assert.equal(await count(d1, "SELECT COUNT(*) AS count FROM access_sync_events WHERE user_id=? AND event_type='restore'", staff.id), 0);
    assert.equal(await count(d1, `SELECT COUNT(*) AS count FROM audit_events
      WHERE action='settings.user_restored' AND entity_id=?`, staff.id), 0);

    const restored = await postJson("/api/settings", {
      action: "restoreUser",
      userId: staff.id,
      expectedAccessVersion: 2,
    }, authHeaders);
    assert.equal(restored.status, 200, await restored.clone().text());
    assert.deepEqual(await d1.prepare("SELECT status,access_version FROM app_users WHERE id=?").bind(staff.id).first(), {
      status: "Активен",
      access_version: 3,
    });

    await d1.prepare(`CREATE TRIGGER test_fail_staff_revoke_outbox
      BEFORE INSERT ON access_sync_events
      BEGIN SELECT RAISE(ABORT,'forced revoke outbox failure'); END`).run();
    const accessAuditBefore = await count(d1, `SELECT COUNT(*) AS count FROM audit_events
      WHERE action='settings.user_access_saved' AND entity_id=?`, staff.id);
    const failedRevoke = await updateStaffWithoutDiary(postJson, authHeaders, staff.id, staffPhone, 3);
    assert.equal(failedRevoke.status, 500);
    assert.equal((await d1.prepare("SELECT access_version FROM app_users WHERE id=?").bind(staff.id).first()).access_version, 3);
    assert.ok(await d1.prepare(`SELECT id FROM user_system_access
      WHERE user_id=? AND system_id='SYS-SCHOOL-1-11'`).bind(staff.id).first(), "the School grant rolls back with a failed revoke outbox");
    assert.equal(await count(d1, `SELECT COUNT(*) AS count FROM audit_events
      WHERE action='settings.user_access_saved' AND entity_id=?`, staff.id), accessAuditBefore);
    assert.equal(await count(d1, "SELECT COUNT(*) AS count FROM access_sync_events WHERE user_id=? AND event_type='revoke'", staff.id), 0);
    await d1.prepare("DROP TRIGGER test_fail_staff_revoke_outbox").run();

    const revokedStaffDiary = await updateStaffWithoutDiary(postJson, authHeaders, staff.id, staffPhone, 3);
    assert.equal(revokedStaffDiary.status, 201, await revokedStaffDiary.clone().text());
    assert.equal((await d1.prepare("SELECT access_version FROM app_users WHERE id=?").bind(staff.id).first()).access_version, 4);
    assert.equal(await d1.prepare(`SELECT id FROM user_system_access
      WHERE user_id=? AND system_id='SYS-SCHOOL-1-11'`).bind(staff.id).first(), null);
    const revokeEvent = await d1.prepare("SELECT id,payload,attempts FROM access_sync_events WHERE user_id=? AND event_type='revoke'")
      .bind(staff.id).first();
    assert.ok(revokeEvent);
    assert.equal(JSON.parse(revokeEvent.payload).user.accessVersion, 4);
    assert.equal(revokeEvent.attempts, 0);

    await d1.batch([
      d1.prepare(`INSERT INTO entities
        (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by)
        VALUES ('FAMILY-OUTBOX','Семья','Семья Очереди','Активна','MANUAL','FAMILY-OUTBOX','Проверено','BR-KINDERGARTEN','{}','runtime-test')`),
      d1.prepare(`INSERT INTO entities
        (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by)
        VALUES ('PARENT-OUTBOX','Клиент','Родитель Очереди','Активен','MANUAL','PARENT-OUTBOX','Проверено','BR-KINDERGARTEN','{}','runtime-test')`),
      d1.prepare(`INSERT INTO entity_links (from_entity_id,to_entity_id,relation_type,created_by)
        VALUES ('FAMILY-OUTBOX','PARENT-OUTBOX','Родитель','runtime-test')`),
    ]);
    const familyGrant = await postJson("/api/settings", {
      action: "grantFamilyAccess",
      familyEntityId: "FAMILY-OUTBOX",
      principalEntityId: "PARENT-OUTBOX",
      role: "parent",
      login: "parent-outbox@example.test",
      expectedAccessVersion: 0,
    }, authHeaders);
    assert.equal(familyGrant.status, 201, await familyGrant.clone().text());
    const familyAccess = await d1.prepare("SELECT id,status,access_version FROM family_system_access WHERE principal_entity_id='PARENT-OUTBOX'").first();
    assert.deepEqual({ status: familyAccess.status, access_version: familyAccess.access_version }, { status: "Активен", access_version: 1 });
    assert.equal(await count(d1, "SELECT COUNT(*) AS count FROM access_sync_events WHERE user_id='PARENT-OUTBOX' AND event_type='grant_access'"), 1);

    const blockedFamily = await postJson("/api/settings", {
      action: "blockFamilyAccess",
      grantId: familyAccess.id,
      expectedAccessVersion: 1,
    }, authHeaders);
    assert.equal(blockedFamily.status, 200, await blockedFamily.clone().text());
    const staleFamilyRestore = await postJson("/api/settings", {
      action: "restoreFamilyAccess",
      grantId: familyAccess.id,
      expectedAccessVersion: 1,
    }, authHeaders);
    assert.equal(staleFamilyRestore.status, 409);
    assert.equal(await count(d1, "SELECT COUNT(*) AS count FROM access_sync_events WHERE user_id='PARENT-OUTBOX' AND event_type='restore_access'"), 0);
    const restoredFamily = await postJson("/api/settings", {
      action: "restoreFamilyAccess",
      grantId: familyAccess.id,
      expectedAccessVersion: 2,
    }, authHeaders);
    assert.equal(restoredFamily.status, 200, await restoredFamily.clone().text());
    const revokedFamily = await postJson("/api/settings", {
      action: "revokeFamilyAccess",
      grantId: familyAccess.id,
      expectedAccessVersion: 3,
    }, authHeaders);
    assert.equal(revokedFamily.status, 200, await revokedFamily.clone().text());
    assert.deepEqual(await d1.prepare("SELECT status,access_version FROM family_system_access WHERE id=?").bind(familyAccess.id).first(), {
      status: "Отозван",
      access_version: 4,
    });
    const invalidRestore = await postJson("/api/settings", {
      action: "restoreFamilyAccess",
      grantId: familyAccess.id,
      expectedAccessVersion: 4,
    }, authHeaders);
    assert.equal(invalidRestore.status, 409);
    assert.equal(await count(d1, "SELECT COUNT(*) AS count FROM access_sync_events WHERE user_id='PARENT-OUTBOX' AND event_type='restore_access'"), 1);

    const ownerBeforeRevoke = await settingsData(request, session.cookies);
    const ownerRevoke = await postJson("/api/settings", {
      action: "saveOwnerDiaryAccess",
      enabled: false,
      diaryRole: "deputy",
      expectedAccessVersion: ownerBeforeRevoke.me.accessVersion,
      expectedUpdatedAt: ownerBeforeRevoke.me.updatedAt,
    }, authHeaders);
    assert.equal(ownerRevoke.status, 200, await ownerRevoke.clone().text());
    assert.equal(await d1.prepare(`SELECT id FROM user_system_access
      WHERE user_id='USR-OWNER' AND system_id='SYS-SCHOOL-1-11'`).first(), null);
    const ownerRevokeEvent = await d1.prepare("SELECT id,payload FROM access_sync_events WHERE user_id='USR-OWNER' AND event_type='revoke'").first();
    assert.ok(ownerRevokeEvent);
    assert.equal(JSON.parse(ownerRevokeEvent.payload).eventId, ownerRevokeEvent.id);
  } finally {
    await runtime.dispose();
    rmSync(persistenceRoot, { recursive: true, force: true });
  }
});

async function ownerSession(postJson) {
  const firstLogin = await postJson("/api/auth/login", { login: LOGIN, password: BOOTSTRAP_PASSWORD });
  assert.equal(firstLogin.status, 200);
  const firstCookies = responseCookieJar(firstLogin);
  const firstCsrf = cookieValue(firstCookies, "__Host-arthello_csrf");
  const changed = await postJson("/api/auth/password", {
    currentPassword: BOOTSTRAP_PASSWORD,
    newPassword: PERMANENT_PASSWORD,
  }, { cookie: firstCookies, "x-csrf-token": firstCsrf });
  assert.equal(changed.status, 200);
  const login = await postJson("/api/auth/login", { login: LOGIN, password: PERMANENT_PASSWORD });
  assert.equal(login.status, 200);
  const cookies = responseCookieJar(login);
  return { cookies, csrf: cookieValue(cookies, "__Host-arthello_csrf") };
}

async function settingsData(request, cookies) {
  const response = await request("/api/settings", { headers: { cookie: cookies } });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

function updateStaffWithoutDiary(postJson, headers, userId, contact, expectedAccessVersion) {
  return postJson("/api/settings", {
    action: "inviteUser",
    employeeId: "",
    contact,
    displayName: "Сотрудник Очереди",
    position: "Учитель",
    role: "Сотрудник",
    allowedModules: ["education"],
    isAdministrative: false,
    branchIds: ["BR-KINDERGARTEN"],
    systemIds: ["SYS-ARTHELLO-OS"],
    diaryRole: "teacher",
    expectedAccessVersion,
  }, headers);
}

async function count(d1, query, value) {
  const statement = d1.prepare(query);
  const row = value === undefined ? await statement.first() : await statement.bind(value).first();
  return Number(row.count);
}

function responseCookieJar(response) {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
}

function cookieValue(cookieJar, name) {
  const prefix = `${name}=`;
  const pair = cookieJar.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return pair ? decodeURIComponent(pair.slice(prefix.length)) : "";
}
