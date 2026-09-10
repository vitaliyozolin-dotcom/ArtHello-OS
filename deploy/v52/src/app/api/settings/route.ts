import { env } from "cloudflare:workers";
import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { moduleCatalog, type ModuleId } from "../../../data/test-snapshot";
import { ensureCoreTables, getDb } from "../../../db";
import { accessSyncEvents, appSystems, appUsers, auditEvents, entities, entityLinks, familySystemAccess, hrEmployees, manualRecords, organizationBranches, userBranchAccess, userSystemAccess } from "../../../db/schema";
import { getRequestUser } from "../../../lib/request-user";
import { batchChangeCount } from "../../../lib/access-sync-outbox";
import { dispatchFamilyDiaryAccessEvent, type FamilyAccessEvent, prepareFamilyDiaryAccessEvent, type PreparedFamilyAccessSyncEvent } from "../../../lib/family-access-sync";
import { dispatchSchoolDiaryAccessEvent, prepareSchoolDiaryAccessEvent, type PreparedStaffAccessSyncEvent, SCHOOL_SYSTEM_ID, type StaffAccessEvent, type StaffSyncResult } from "../../../lib/staff-access-sync";
import { API_ROLE_BY_APP_ROLE, ASSIGNABLE_APP_ROLES, canAccessModule, canManageAccess } from "../../../lib/access-policy";
import { getAuthenticatedRequestContext, isCanonicalOwnerContext, verifyAuthenticatedRequestCsrf } from "../../../lib/production-auth";
import { hasTrustedMutationOrigin } from "../../../lib/request-security";
import { safeSettingsActionError } from "../../../lib/settings-error";

import { normalizeAtlasRole, ATLAS_SYSTEM_ID } from "../../../lib/atlas-sso";

const defaultBranches = [
  { id: "BR-KINDERGARTEN", name: "Атлас — садик", kind: "Детский сад", sortOrder: 10 },
  { id: "BR-ATLAS-SCHOOL", name: "Атлас — школа", kind: "Школа", sortOrder: 20 },
  { id: "BR-SCHOOL", name: "1–11", kind: "Школа", sortOrder: 30 },
  { id: "BR-NEBO", name: "Небо", kind: "Детский сад", sortOrder: 40 },
  { id: "BR-LISTVENNAYA", name: "Лиственная", kind: "Филиал", sortOrder: 50 },
] as const;

const defaultSystems = [
  { id: ATLAS_SYSTEM_ID, systemKey: "ATLAS_DIARY", name: "Дневник Атласа", description: "Отдельный дневник школы Атлас; вход через ArtHello OS", sortOrder: 30 },
  { id: "SYS-ARTHELLO-OS", systemKey: "ARTHELLO_OS", name: "ArtHello OS", description: "Управление группой, филиалами и сквозными процессами", sortOrder: 10 },
  { id: SCHOOL_SYSTEM_ID, systemKey: "SCHOOL_DIARY", name: "Дневник 1–11", description: "Учебный контур школы; классы и предметы назначаются уже в дневнике", sortOrder: 20 },
] as const;

const diaryRoles = new Set(["director", "deputy", "admin", "teacher", "tech_admin"]);
const familyAccessEvents = new Set<FamilyAccessEvent>(["grant_access", "block_access", "restore_access", "reset_password", "revoke_access"]);
const CENTRAL_SYSTEM_ID = "SYS-ARTHELLO-OS";

const assignableRoles = new Set(ASSIGNABLE_APP_ROLES);
const assignableModuleIds = new Set<ModuleId>(moduleCatalog.map((module) => module.id).filter((id) => id !== "home" && id !== "access"));
const favoriteModuleIds = new Set<ModuleId>(moduleCatalog.map((module) => module.id).filter((id) => !["home", "access", "integrations", "acceptance"].includes(id)));

const recordTypes = new Set([
  "Заработная плата", "ДДС", "ОПиУ", "Сотрудник", "Ребёнок", "Семья", "Класс или группа",
  "Занятие", "Дополнительное занятие", "Договор", "Начисление", "Оплата", "Другое",
]);

const ownerContacts = new Set(
  (process.env.ARTHELLO_OWNER_EMAILS ?? "vitaliyozolin@gmail.com,ozolin@arthello.ru,local-preview@arthello.test")
    .split(",")
    .map((contact) => contact.trim().toLowerCase())
    .filter(Boolean),
);

export async function GET(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const db = getDb();
    await ensureBranches();
    await ensureSystems();
    const me = await ensureUser(actor);
    if (!me || me.status === "Доступ приостановлен") return Response.json({ error: "Доступ ещё не активирован владельцем" }, { status: 403 });
    const canManage = canManageAccess(requestAccessContext(request));
    const branches = await db.select().from(organizationBranches).where(eq(organizationBranches.status, "Активен")).orderBy(asc(organizationBranches.sortOrder));
    const access = me.isAdministrative
      ? branches.map((branch) => ({ branchId: branch.id, accessLevel: "Администратор" }))
      : await db.select({ branchId: userBranchAccess.branchId, accessLevel: userBranchAccess.accessLevel }).from(userBranchAccess).where(eq(userBranchAccess.userId, me.id));
    const accountUsers = canManage
      ? await db.select().from(appUsers).orderBy(asc(appUsers.displayName))
      : [me];
    const users = canManage
      ? await loadEmployeeAccessDirectory(accountUsers)
      : accountUsers.map((user) => ({ ...exposeAccountUser(user), employeeId: "", hasAccess: true, source: "Учётная запись" }));
    const grants = canManage ? await db.select().from(userBranchAccess) : access.map((item, index) => ({ id: index, userId: me.id, grantedBy: "", createdAt: "", ...item }));
    const systems = await db.select().from(appSystems).where(eq(appSystems.status, "Активна")).orderBy(asc(appSystems.sortOrder));
    const systemGrants = canManage
      ? await db.select().from(userSystemAccess)
      : await db.select().from(userSystemAccess).where(eq(userSystemAccess.userId, me.id));
    const syncEvents = canManage
      ? await db.select({
        id: accessSyncEvents.id,
        eventType: accessSyncEvents.eventType,
        userId: accessSyncEvents.userId,
        systemId: accessSyncEvents.systemId,
        status: accessSyncEvents.status,
        attempts: accessSyncEvents.attempts,
        createdAt: accessSyncEvents.createdAt,
        updatedAt: accessSyncEvents.updatedAt,
      }).from(accessSyncEvents).orderBy(desc(accessSyncEvents.createdAt)).limit(40)
      : [];
    const accessHistory = canManage
      ? await db.select().from(auditEvents).where(like(auditEvents.action, "settings.%")).orderBy(desc(auditEvents.createdAt)).limit(80)
      : [];
    const familyDirectory = canManage ? await loadFamilyDirectory() : [];
    const familyAccessGrants = canManage ? await db.select().from(familySystemAccess).orderBy(desc(familySystemAccess.updatedAt)) : [];
    return Response.json({
      me: exposeAccountUser(me),
      branches,
      access,
      users,
      grants,
      systems,
      systemGrants,
      syncEvents,
      accessHistory,
      familyDirectory,
      familyAccessGrants,
      systemRoleOptions: {
        [ATLAS_SYSTEM_ID]: [
          { value: "director", label: "Директор" }, { value: "deputy", label: "Завуч" },
          { value: "methodist", label: "Методист" }, { value: "teacher", label: "Учитель" },
          { value: "admin", label: "Администратор школы" }, { value: "tech_admin", label: "Технический администратор" },
        ],
        [SCHOOL_SYSTEM_ID]: [
          { value: "director", label: "Директор" },
          { value: "deputy", label: "Завуч" },
          { value: "admin", label: "Администратор школы" },
          { value: "teacher", label: "Учитель" },
          { value: "tech_admin", label: "Технический администратор" },
        ],
      },
      canManage,
      authBoundary: "ArtHello OS — единый источник сотрудников, семей, родителей, учеников, классов и прав входа. AlfaCRM передаёт исходные записи через защищённое подключение, ArtHello OS присваивает постоянный внутренний номер, а дневник получает только нужные учебному контуру данные. Внутри дневника ничего из этого повторно не создаётся.",
    });
  } catch {
    console.error("settings.load_failed");
    return Response.json({ error: "Настройки временно недоступны" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authenticated = await assertSameOriginMutation(request);
  if (authenticated instanceof Response) return authenticated;
  const actor = authenticated.actor;
  try {
    await ensureCoreTables();
    await ensureBranches();
    await ensureSystems();
    const db = getDb();
    const me = await ensureUser(actor);
    if (!me || me.status === "Доступ приостановлен") return Response.json({ error: "Доступ не активирован" }, { status: 403 });
    const canManage = canManageAccess(authenticated.auth.user);
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 50);

    if (action === "saveFavorites") {
      const allowedModules = new Set(resolveAllowedModules(me.allowedModules, me.role));
      const favoriteModules = uniqueStrings(body.favoriteModules)
        .filter((id): id is ModuleId => favoriteModuleIds.has(id as ModuleId) && allowedModules.has(id as ModuleId))
        .slice(0, 12);
      await db.update(appUsers).set({ favoriteModules: JSON.stringify(favoriteModules), updatedAt: new Date().toISOString() }).where(eq(appUsers.id, me.id));
      return Response.json({ message: "Избранное сохранено", favoriteModules });
    }

    if (action === "saveOwnerDiaryAccess") {
      if (
        !isCanonicalOwnerContext(authenticated) ||
        authenticated.appUserId !== "USR-OWNER" ||
        me.id !== authenticated.appUserId ||
        me.role !== "Собственник" ||
        !me.isAdministrative ||
        me.status !== "Активен"
      ) {
        return Response.json({ error: "Настраивать свой вход в дневник может только системный владелец" }, { status: 403 });
      }
      if (typeof body.enabled !== "boolean") {
        return Response.json({ error: "Укажите, нужно ли включить вход в дневник" }, { status: 400 });
      }
      const enabled = body.enabled;
      const systemId = body.systemId ?? SCHOOL_SYSTEM_ID;
      if (systemId !== SCHOOL_SYSTEM_ID && systemId !== ATLAS_SYSTEM_ID) return Response.json({ error: "Неизвестный дневник" }, { status: 400 });
      const isAtlas = systemId === ATLAS_SYSTEM_ID;
      const diaryRole = clean(body.diaryRole, 40);
      if (enabled && (isAtlas ? !normalizeAtlasRole(diaryRole) : !diaryRoles.has(diaryRole))) {
        return Response.json({ error: "Выберите роль в дневнике" }, { status: 400 });
      }

      const [centralGrant] = await db.select().from(userSystemAccess).where(and(
        eq(userSystemAccess.userId, me.id),
        eq(userSystemAccess.systemId, CENTRAL_SYSTEM_ID),
      )).limit(1);
      const accessVersion = Number(me.accessVersion);
      if (
        !centralGrant ||
        centralGrant.status !== "Активен" ||
        centralGrant.role !== "Собственник" ||
        !Number.isSafeInteger(accessVersion) ||
        accessVersion < 1 ||
        Number(centralGrant.accessVersion) !== accessVersion ||
        authenticated.accessVersion !== accessVersion
      ) {
        return Response.json({ error: "Основные права владельца изменились. Войдите заново и повторите настройку." }, { status: 409 });
      }
      assertExpectedAccessVersion(body.expectedAccessVersion, accessVersion);
      const expectedUpdatedAt = clean(body.expectedUpdatedAt, 80) || me.updatedAt;
      if (expectedUpdatedAt !== me.updatedAt) throwAccessConflict();

      const now = uniqueMutationTimestamp();
      const branches = await db.select({ id: organizationBranches.id, name: organizationBranches.name })
        .from(organizationBranches)
        .where(eq(organizationBranches.status, "Активен"));
      const syncEvent = isAtlas ? null : prepareSchoolDiaryAccessEvent({
        actor,
        eventType: enabled ? "upsert" : "revoke",
        accessRevision: now,
        user: {
          id: me.id,
          displayName: me.displayName,
          contact: me.contact,
          contactType: me.contactType,
          status: me.status,
          accessVersion,
        },
        diaryRole: enabled ? diaryRole : centralGrant.role,
        branches: enabled ? branches : [],
      });
      const auditPayload = JSON.stringify({
        enabled,
        systemId,
        diaryRole: enabled ? diaryRole : null,
        accessVersion,
        syncEventId: syncEvent?.id,
      });
      const ownerGuard = `EXISTS (SELECT 1 FROM app_users
        WHERE id=? AND access_version=? AND updated_at=?)`;
      const diaryMutation = enabled
        ? env.DB.prepare(`INSERT INTO user_system_access
          (user_id,system_id,role,status,access_version,last_sync_status,last_synced_at,granted_by,updated_at)
          SELECT ?,?,?,?,?,?,'',?,?
          WHERE ${ownerGuard}
          ON CONFLICT(user_id,system_id) DO UPDATE SET
            role=excluded.role,
            status='Активен',
            access_version=excluded.access_version,
            last_sync_status=excluded.last_sync_status,
            last_synced_at='',
            granted_by=excluded.granted_by,
            updated_at=excluded.updated_at`)
          .bind(me.id, systemId, diaryRole, "Активен", accessVersion, isAtlas ? "Вход через ArtHello OS" : "Ожидает синхронизации", actor, now, me.id, accessVersion, expectedUpdatedAt)
        : env.DB.prepare(`DELETE FROM user_system_access
          WHERE user_id=? AND system_id=? AND ${ownerGuard}`)
          .bind(me.id, systemId, me.id, accessVersion, expectedUpdatedAt);
      const results = await env.DB.batch([
        diaryMutation,
        env.DB.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
          SELECT ?,'settings.owner_diary_access_saved','app_user',?,?
          WHERE ${ownerGuard}`)
          .bind(actor, me.id, auditPayload, me.id, accessVersion, expectedUpdatedAt),
        ...(syncEvent ? [accessOutboxInsert(syncEvent, ownerGuard, [me.id, accessVersion, expectedUpdatedAt])] : []),
        env.DB.prepare(`UPDATE app_users SET updated_at=?
          WHERE id=? AND access_version=? AND updated_at=?`)
          .bind(now, me.id, accessVersion, expectedUpdatedAt),
      ]);
      assertCasApplied(results.at(-1));
      const syncResult = syncEvent ? await dispatchStaffEventSafely(syncEvent.id) : { message: enabled ? "Вход в дневник Атласа настроен. Откройте его через ArtHello OS." : "Вход в дневник Атласа отключён.", activationLink: undefined, expiresAt: undefined };

      return Response.json({
        message: syncResult.message || (enabled ? "Вход владельца в дневник настроен" : "Вход владельца в дневник отключён"),
        diaryAccess: enabled ? { enabled: true, role: diaryRole } : { enabled: false },
        activationLink: syncResult.activationLink,
        expiresAt: syncResult.expiresAt,
      });
    }

    if (action === "createBranch") {
      requireOwner(canManage);
      const name = clean(body.name, 100);
      const kind = clean(body.kind, 60) || "Филиал";
      if (name.length < 3) return Response.json({ error: "Укажите название филиала" }, { status: 400 });
      const id = `BR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      await db.insert(organizationBranches).values({ id, name, kind, sortOrder: 100 });
      await audit(actor, "settings.branch_created", "branch", id, { name, kind });
      return Response.json({ message: "Филиал добавлен" }, { status: 201 });
    }

    if (action === "inviteUser") {
      requireOwner(canManage);
      const employeeId = clean(body.employeeId, 80);
      const rawContact = clean(body.contact, 160).toLowerCase();
      const submittedContactType = rawContact.includes("@") ? "email" : "phone";
      const submittedContact = normalizeContact(rawContact, submittedContactType);
      const displayName = clean(body.displayName, 120);
      const role = clean(body.role, 80);
      const requestedPosition = clean(body.position, 120);
      const systemIds = stringArray(body.systemIds).filter((id) => defaultSystems.some((system) => system.id === id));
      const diaryRole = clean(body.diaryRole, 40);
      const atlasDiaryRole = normalizeAtlasRole(body.atlasDiaryRole);
      const administrative = body.isAdministrative === true;
      const branchIds = administrative ? [] : stringArray(body.branchIds).slice(0, 20);
      const [employee] = employeeId ? await db.select().from(hrEmployees).where(eq(hrEmployees.id, employeeId)).limit(1) : [];
      if (employeeId && (!employee || employee.status === "Уволен")) return Response.json({ error: "Сотрудник не найден или уже уволен" }, { status: 404 });
      const [existingByEmployee] = employeeId ? await db.select().from(appUsers).where(eq(appUsers.id, employeeId)).limit(1) : [];
      const [existingByContact] = submittedContact ? await db.select().from(appUsers).where(eq(appUsers.contact, submittedContact)).limit(1) : [];
      if (existingByEmployee && existingByContact && existingByEmployee.id !== existingByContact.id) return Response.json({ error: "Этот контакт уже используется другой учётной записью" }, { status: 409 });
      const existing = existingByEmployee ?? existingByContact;
      if (existing && (submittedContactType !== existing.contactType || submittedContact !== existing.contact)) {
        return Response.json({ error: "Логин существующего пользователя нельзя изменить. Исправьте контакт в «Команда» и выдайте новый доступ отдельной процедурой." }, { status: 409 });
      }
      const contactType = existing?.contactType ?? submittedContactType;
      const contact = existing?.contact ?? submittedContact;
      const position = requestedPosition || existing?.jobTitle || employee?.positionId || role;
      if (!validContact(contact, contactType) || displayName.length < 2 || position.length < 2) return Response.json({ error: "Проверьте контакт, имя и должность" }, { status: 400 });
      if (!systemIds.length) return Response.json({ error: "Выберите хотя бы одну систему" }, { status: 400 });
      if (!administrative && !branchIds.length) return Response.json({ error: "Выберите хотя бы один филиал" }, { status: 400 });
      if (systemIds.includes(SCHOOL_SYSTEM_ID) && (contactType !== "phone" || !diaryRoles.has(diaryRole))) {
        return Response.json({ error: "Для дневника нужен номер телефона и отдельная роль дневника" }, { status: 400 });
      }
      if (systemIds.includes(ATLAS_SYSTEM_ID) && (!atlasDiaryRole || !systemIds.includes(CENTRAL_SYSTEM_ID) || (!administrative && !branchIds.includes("BR-ATLAS-SCHOOL")))) {
        return Response.json({ error: "Для Атласа выберите роль дневника, вход в ArtHello OS и доступ к школе Атлас." }, { status: 400 });
      }
      const canonicalOwnerTarget = existing?.id === "USR-OWNER" || (authenticated.auth.user.isSystemOwner && existing?.id === me.id);
      if (canonicalOwnerTarget) {
        if (contactType !== existing.contactType || contact !== existing.contact || role !== "Собственник" || !administrative) {
          return Response.json({ error: "Роль, контакт и административный статус системного владельца изменяются только офлайн-процедурой восстановления" }, { status: 409 });
        }
        await db.update(appUsers).set({ displayName, updatedAt: new Date().toISOString() }).where(eq(appUsers.id, existing.id));
        await audit(actor, "settings.owner_profile_updated", "app_user", existing.id, { displayName });
        return Response.json({ message: "Имя системного владельца обновлено. Права и данные входа сохранены." });
      }
      if (!assignableRoles.has(role)) {
        return Response.json({ error: "Роль собственника нельзя назначить через управление сотрудниками" }, { status: 409 });
      }
      const allowedModules = Array.isArray(body.allowedModules)
        ? uniqueStrings(body.allowedModules).filter((id): id is ModuleId => assignableModuleIds.has(id as ModuleId))
        : defaultModulesForRole(role);
      const id = existing?.id ?? (employeeId || `USR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`);
      const currentVersion = Number(existing?.accessVersion ?? 0);
      if (!Number.isSafeInteger(currentVersion) || currentVersion < 0) throwAccessConflict();
      assertExpectedAccessVersion(body.expectedAccessVersion, currentVersion);
      const nextVersion = currentVersion + 1;
      const invitationStatus = existing?.invitationStatus || (contactType === "email" ? "Ожидает первого входа в ArtHello OS" : "Ожидает активации в назначенных системах");
      const userStatus = existing?.status ?? "Активен";
      const favoriteModules = resolveFavoriteModules(existing?.favoriteModules ?? "", allowedModules);
      const previousSystems = existing
        ? await db.select().from(userSystemAccess).where(eq(userSystemAccess.userId, id))
        : [];
      const branchRows = administrative
        ? await db.select({ id: organizationBranches.id, name: organizationBranches.name }).from(organizationBranches).where(eq(organizationBranches.status, "Активен"))
        : await db.select({ id: organizationBranches.id, name: organizationBranches.name }).from(organizationBranches).where(inArray(organizationBranches.id, branchIds));
      if (!administrative && branchRows.length !== new Set(branchIds).size) return Response.json({ error: "Один из выбранных филиалов больше не доступен" }, { status: 409 });
      const now = uniqueMutationTimestamp();
      const user = { id, displayName, contact, contactType, status: userStatus, accessVersion: nextVersion };
      const previousDiaryGrant = previousSystems.find((grant) => grant.systemId === SCHOOL_SYSTEM_ID);
      const syncEvent = systemIds.includes(SCHOOL_SYSTEM_ID)
        ? prepareSchoolDiaryAccessEvent({ actor, eventType: "upsert", accessRevision: now, user, diaryRole, branches: branchRows })
        : previousDiaryGrant
          ? prepareSchoolDiaryAccessEvent({ actor, eventType: "revoke", accessRevision: now, user, diaryRole: previousDiaryGrant.role, branches: [] })
          : null;
      const auditPayload = JSON.stringify({ role, position, administrative, branchIds, systemIds, allowedModules, diarySync: syncEvent ? "pending" : "not-required", syncEventId: syncEvent?.id });
      let casResult: unknown;

      if (existing) {
        const guard = "EXISTS (SELECT 1 FROM app_users WHERE id=? AND access_version=?)";
        const guardValues = [id, currentVersion];
        const statements = [
          env.DB.prepare(`DELETE FROM user_branch_access WHERE user_id=? AND ${guard}`).bind(id, ...guardValues),
          env.DB.prepare(`DELETE FROM user_system_access WHERE user_id=? AND ${guard}`).bind(id, ...guardValues),
        ];
        if (!administrative) {
          for (const branchId of new Set(branchIds)) {
            statements.push(env.DB.prepare(`INSERT INTO user_branch_access (user_id,branch_id,access_level,granted_by)
              SELECT ?,?,'Работа',? WHERE ${guard}`).bind(id, branchId, actor, ...guardValues));
          }
        }
        for (const systemId of systemIds) {
          statements.push(env.DB.prepare(`INSERT INTO user_system_access
            (user_id,system_id,role,status,access_version,last_sync_status,granted_by,updated_at)
            SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`)
            .bind(id, systemId, systemId === SCHOOL_SYSTEM_ID ? diaryRole : systemId === ATLAS_SYSTEM_ID ? atlasDiaryRole : role, userStatus === "Доступ приостановлен" ? "Приостановлен" : "Активен", nextVersion, systemId === SCHOOL_SYSTEM_ID ? "Ожидает синхронизации" : systemId === ATLAS_SYSTEM_ID ? "Вход через ArtHello OS" : "Не требуется", actor, now, ...guardValues));
        }
        if (employeeId) {
          statements.push(env.DB.prepare(`UPDATE hr_employees SET position_id=?,access_status=?,updated_at=?
            WHERE id=? AND ${guard}`).bind(position, userStatus === "Доступ приостановлен" ? "Приостановлен" : "Активен", now, employeeId, ...guardValues));
        }
        statements.push(env.DB.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
          SELECT ?,'settings.user_access_saved','app_user',?,? WHERE ${guard}`)
          .bind(actor, id, auditPayload, ...guardValues));
        if (syncEvent) statements.push(accessOutboxInsert(syncEvent, guard, guardValues));
        statements.push(env.DB.prepare(`UPDATE app_users SET
          display_name=?,role=?,job_title=?,allowed_modules=?,favorite_modules=?,is_administrative=?,invitation_status=?,access_version=?,updated_at=?
          WHERE id=? AND access_version=?`)
          .bind(displayName, role, position, JSON.stringify(allowedModules), JSON.stringify(favoriteModules), administrative ? 1 : 0, invitationStatus, nextVersion, now, id, currentVersion));
        const results = await env.DB.batch(statements);
        casResult = results.at(-1);
      } else {
        const guard = "NOT EXISTS (SELECT 1 FROM app_users WHERE id=? OR contact=?)";
        const guardValues = [id, contact];
        const statements = [
        ];
        if (!administrative) {
          for (const branchId of new Set(branchIds)) {
            statements.push(env.DB.prepare(`INSERT INTO user_branch_access (user_id,branch_id,access_level,granted_by)
              SELECT ?,?,'Работа',? WHERE ${guard}`).bind(id, branchId, actor, ...guardValues));
          }
        }
        for (const systemId of systemIds) {
          statements.push(env.DB.prepare(`INSERT INTO user_system_access
            (user_id,system_id,role,status,access_version,last_sync_status,granted_by,updated_at)
            SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`)
            .bind(id, systemId, systemId === SCHOOL_SYSTEM_ID ? diaryRole : systemId === ATLAS_SYSTEM_ID ? atlasDiaryRole : role, userStatus === "Доступ приостановлен" ? "Приостановлен" : "Активен", nextVersion, systemId === SCHOOL_SYSTEM_ID ? "Ожидает синхронизации" : systemId === ATLAS_SYSTEM_ID ? "Вход через ArtHello OS" : "Не требуется", actor, now, ...guardValues));
        }
        if (employeeId) statements.push(env.DB.prepare(`UPDATE hr_employees SET position_id=?,access_status=?,updated_at=?
          WHERE id=? AND ${guard}`).bind(position, "Активен", now, employeeId, ...guardValues));
        statements.push(env.DB.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
          SELECT ?,'settings.user_access_saved','app_user',?,? WHERE ${guard}`).bind(actor, id, auditPayload, ...guardValues));
        if (syncEvent) statements.push(accessOutboxInsert(syncEvent, guard, guardValues));
        statements.push(env.DB.prepare(`INSERT INTO app_users
          (id,contact_type,contact,display_name,role,job_title,allowed_modules,favorite_modules,is_administrative,status,invitation_status,access_version,invited_by,updated_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`)
          .bind(id, contactType, contact, displayName, role, position, JSON.stringify(allowedModules), JSON.stringify(favoriteModules), administrative ? 1 : 0, userStatus, invitationStatus, nextVersion, actor, now, ...guardValues));
        const results = await env.DB.batch(statements);
        casResult = results.at(-1);
      }
      assertCasApplied(casResult);
      const syncResult = syncEvent ? await dispatchStaffEventSafely(syncEvent.id) : null;
      return Response.json({
        message: syncResult?.message ?? "Сотрудник и его доступы сохранены в ArtHello OS.",
        activationLink: syncResult?.activationLink,
        expiresAt: syncResult?.expiresAt,
      }, { status: 201 });
    }

    if (action === "blockUser") {
      requireOwner(canManage);
      const userId = clean(body.userId, 80);
      const employeeId = clean(body.employeeId, 80);
      if (userId === me.id || userId === "USR-OWNER") return Response.json({ error: "Нельзя приостановить вход системного владельца" }, { status: 409 });
      const [target] = await db.select().from(appUsers).where(eq(appUsers.id, userId)).limit(1);
      if (!target) return Response.json({ error: "Пользователь не найден" }, { status: 404 });
      const currentVersion = validStoredAccessVersion(target.accessVersion);
      assertExpectedAccessVersion(body.expectedAccessVersion, currentVersion);
      const nextVersion = currentVersion + 1;
      const now = uniqueMutationTimestamp();
      const updated = { ...target, status: "Доступ приостановлен", invitationStatus: "Заблокирован владельцем", accessVersion: nextVersion, activatedAt: "", updatedAt: now };
      const syncEvent = await prepareExistingStaffEvent(actor, updated, "block");
      const guard = "EXISTS (SELECT 1 FROM app_users WHERE id=? AND access_version=?)";
      const guardValues = [userId, currentVersion];
      const statements = [
        env.DB.prepare(`UPDATE user_system_access SET status='Приостановлен',access_version=?,updated_at=?
          WHERE user_id=? AND ${guard}`).bind(nextVersion, now, userId, ...guardValues),
        env.DB.prepare(`UPDATE hr_employees SET access_status='Приостановлен',updated_at=?
          WHERE id=? AND ${guard}`).bind(now, employeeId || userId, ...guardValues),
        env.DB.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
          SELECT ?,'settings.user_blocked','app_user',?,? WHERE ${guard}`)
          .bind(actor, userId, JSON.stringify({ syncStatus: syncEvent ? "pending" : "not-required", syncEventId: syncEvent?.id }), ...guardValues),
      ];
      if (syncEvent) statements.push(accessOutboxInsert(syncEvent, guard, guardValues));
      statements.push(env.DB.prepare(`UPDATE app_users SET
        status='Доступ приостановлен',invitation_status='Заблокирован владельцем',access_version=?,activated_at='',updated_at=?
        WHERE id=? AND access_version=?`).bind(nextVersion, now, userId, currentVersion));
      const results = await env.DB.batch(statements);
      assertCasApplied(results.at(-1));
      const syncResult = syncEvent ? await dispatchStaffEventSafely(syncEvent.id) : null;
      return Response.json({ message: syncResult?.message ?? "Сотрудник заблокирован во всех назначенных системах." });
    }

    if (action === "restoreUser") {
      requireOwner(canManage);
      const userId = clean(body.userId, 80);
      const employeeId = clean(body.employeeId, 80);
      const [target] = await db.select().from(appUsers).where(eq(appUsers.id, userId)).limit(1);
      if (!target) return Response.json({ error: "Пользователь не найден" }, { status: 404 });
      const currentVersion = validStoredAccessVersion(target.accessVersion);
      assertExpectedAccessVersion(body.expectedAccessVersion, currentVersion);
      const nextVersion = currentVersion + 1;
      const now = uniqueMutationTimestamp();
      const updated = { ...target, status: "Активен", invitationStatus: "Доступ восстановлен", accessVersion: nextVersion, updatedAt: now };
      const syncEvent = await prepareExistingStaffEvent(actor, updated, "restore");
      const guard = "EXISTS (SELECT 1 FROM app_users WHERE id=? AND access_version=?)";
      const guardValues = [userId, currentVersion];
      const statements = [
        env.DB.prepare(`UPDATE user_system_access SET status='Активен',access_version=?,updated_at=?
          WHERE user_id=? AND ${guard}`).bind(nextVersion, now, userId, ...guardValues),
        env.DB.prepare(`UPDATE hr_employees SET access_status='Активен',updated_at=?
          WHERE id=? AND ${guard}`).bind(now, employeeId || userId, ...guardValues),
        env.DB.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
          SELECT ?,'settings.user_restored','app_user',?,? WHERE ${guard}`)
          .bind(actor, userId, JSON.stringify({ syncStatus: syncEvent ? "pending" : "not-required", syncEventId: syncEvent?.id }), ...guardValues),
      ];
      if (syncEvent) statements.push(accessOutboxInsert(syncEvent, guard, guardValues));
      statements.push(env.DB.prepare(`UPDATE app_users SET
        status='Активен',invitation_status='Доступ восстановлен',access_version=?,updated_at=?
        WHERE id=? AND access_version=?`).bind(nextVersion, now, userId, currentVersion));
      const results = await env.DB.batch(statements);
      assertCasApplied(results.at(-1));
      const syncResult = syncEvent ? await dispatchStaffEventSafely(syncEvent.id) : null;
      return Response.json({ message: syncResult?.message ?? "Доступ сотрудника восстановлен." });
    }

    if (action === "resetPassword" || action === "resetAccess") {
      requireOwner(canManage);
      const userId = clean(body.userId, 80);
      if (userId === me.id || userId === "USR-OWNER") return Response.json({ error: "Нельзя завершить входы системного владельца из управления доступами" }, { status: 409 });
      const [target] = await db.select().from(appUsers).where(eq(appUsers.id, userId)).limit(1);
      if (!target) return Response.json({ error: "Пользователь не найден" }, { status: 404 });
      const [diaryGrant] = await db.select().from(userSystemAccess).where(and(eq(userSystemAccess.userId, userId), eq(userSystemAccess.systemId, SCHOOL_SYSTEM_ID))).limit(1);
      if (!diaryGrant) return Response.json({ error: "У сотрудника нет доступа к системе с собственным паролем" }, { status: 409 });
      const currentVersion = validStoredAccessVersion(target.accessVersion);
      assertExpectedAccessVersion(body.expectedAccessVersion, currentVersion);
      const nextVersion = currentVersion + 1;
      const now = uniqueMutationTimestamp();
      const updated = { ...target, invitationStatus: "Требуется новый пароль", accessVersion: nextVersion, updatedAt: now };
      const syncEvent = await prepareExistingStaffEvent(actor, updated, "reset_password");
      if (!syncEvent) return Response.json({ error: "Не удалось подготовить смену пароля" }, { status: 409 });
      const guard = "EXISTS (SELECT 1 FROM app_users WHERE id=? AND access_version=?)";
      const guardValues = [userId, currentVersion];
      const results = await env.DB.batch([
        env.DB.prepare(`UPDATE user_system_access SET access_version=?,updated_at=?
          WHERE user_id=? AND ${guard}`).bind(nextVersion, now, userId, ...guardValues),
        env.DB.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
          SELECT ?,'settings.user_password_reset','app_user',?,? WHERE ${guard}`)
          .bind(actor, userId, JSON.stringify({ syncStatus: "pending", syncEventId: syncEvent.id }), ...guardValues),
        accessOutboxInsert(syncEvent, guard, guardValues),
        env.DB.prepare(`UPDATE app_users SET invitation_status='Требуется новый пароль',access_version=?,updated_at=?
          WHERE id=? AND access_version=?`).bind(nextVersion, now, userId, currentVersion),
      ]);
      assertCasApplied(results.at(-1));
      const syncResult = await dispatchStaffEventSafely(syncEvent.id);
      return Response.json({ message: syncResult.message, activationLink: syncResult.activationLink, expiresAt: syncResult.expiresAt });
    }

    if (action === "grantFamilyAccess") {
      requireOwner(canManage);
      const familyEntityId = clean(body.familyEntityId, 80);
      const principalEntityId = clean(body.principalEntityId, 80);
      const role = clean(body.role, 20);
      const rawLogin = clean(body.login, 160).toLowerCase();
      const loginType = rawLogin.includes("@") ? "email" : "phone";
      const login = normalizeContact(rawLogin, loginType);
      const deliveryChannel = loginType === "email" ? "email" : "sms";
      if (!familyEntityId || !principalEntityId || !["parent", "student"].includes(role) || !validContact(login, loginType)) {
        return Response.json({ error: "Выберите члена семьи и укажите корректный телефон или email" }, { status: 400 });
      }
      const family = await getFamilySnapshot(familyEntityId);
      if (familyNeedsReview(family)) return Response.json({ error: "Сначала завершите сверку внешнего источника или конфликта в разделе «Клиенты»" }, { status: 409 });
      const principal = family.members.find((member) => member.id === principalEntityId);
      if (!principal) return Response.json({ error: "Этот человек не связан с выбранной семьёй в ArtHello OS" }, { status: 409 });
      if ((role === "student") !== (principal.entityType === "Ребёнок")) return Response.json({ error: "Роль не соответствует типу карточки" }, { status: 409 });
      const [existing] = await db.select().from(familySystemAccess).where(and(eq(familySystemAccess.principalEntityId, principalEntityId), eq(familySystemAccess.systemId, SCHOOL_SYSTEM_ID))).limit(1);
      const id = existing?.id ?? `FACCESS-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const currentVersion = Number(existing?.accessVersion ?? 0);
      if (!Number.isSafeInteger(currentVersion) || currentVersion < 0) throwAccessConflict();
      assertExpectedAccessVersion(body.expectedAccessVersion, currentVersion);
      const nextVersion = currentVersion + 1;
      const now = uniqueMutationTimestamp();
      const grant = {
        id,
        familyEntityId,
        principalEntityId,
        principalType: principal.entityType === "Ребёнок" ? "student" : "guardian",
        systemId: SCHOOL_SYSTEM_ID,
        role,
        loginType,
        login,
        deliveryChannel,
        deliveryStatus: "Ожидает отправки",
        status: "Активен",
        accessVersion: nextVersion,
        lastSyncStatus: "Ожидает синхронизации",
        grantedBy: actor,
      };
      const syncEvent = prepareFamilyDiaryAccessEvent({ actor, eventType: "grant_access", grant, family });
      const auditPayload = JSON.stringify({ familyEntityId, role, loginType, deliveryChannel, accessVersion: nextVersion, syncStatus: "pending", syncEventId: syncEvent.id });
      let casResult: unknown;
      if (existing) {
        const guard = "EXISTS (SELECT 1 FROM family_system_access WHERE id=? AND access_version=?)";
        const guardValues = [id, currentVersion];
        const results = await env.DB.batch([
          env.DB.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
            SELECT ?,'settings.family_access_granted','entity',?,? WHERE ${guard}`)
            .bind(actor, principalEntityId, auditPayload, ...guardValues),
          accessOutboxInsert(syncEvent, guard, guardValues),
          env.DB.prepare(`UPDATE family_system_access SET
            family_entity_id=?,principal_type=?,role=?,login_type=?,login=?,delivery_channel=?,delivery_status='Ожидает отправки',
            status='Активен',access_version=?,last_sync_status='Ожидает синхронизации',last_synced_at='',granted_by=?,updated_at=?
            WHERE id=? AND principal_entity_id=? AND system_id=? AND access_version=?`)
            .bind(familyEntityId, grant.principalType, role, loginType, login, deliveryChannel, nextVersion, actor, now, id, principalEntityId, SCHOOL_SYSTEM_ID, currentVersion),
        ]);
        casResult = results.at(-1);
      } else {
        const guard = `NOT EXISTS (SELECT 1 FROM family_system_access
          WHERE (principal_entity_id=? OR login=?) AND system_id=?)`;
        const guardValues = [principalEntityId, login, SCHOOL_SYSTEM_ID];
        const results = await env.DB.batch([
          env.DB.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
            SELECT ?,'settings.family_access_granted','entity',?,? WHERE ${guard}`)
            .bind(actor, principalEntityId, auditPayload, ...guardValues),
          accessOutboxInsert(syncEvent, guard, guardValues),
          env.DB.prepare(`INSERT INTO family_system_access
            (id,family_entity_id,principal_entity_id,principal_type,system_id,role,login_type,login,delivery_channel,delivery_status,status,access_version,last_sync_status,last_synced_at,granted_by,updated_at)
            SELECT ?,?,?,?,?,?,?,?,?,'Ожидает отправки','Активен',?,'Ожидает синхронизации','',?,?
            WHERE ${guard}`)
            .bind(id, familyEntityId, principalEntityId, grant.principalType, SCHOOL_SYSTEM_ID, role, loginType, login, deliveryChannel, nextVersion, actor, now, ...guardValues),
        ]);
        casResult = results.at(-1);
      }
      assertCasApplied(casResult);
      const syncResult = await dispatchFamilyEventSafely(syncEvent.id);
      return Response.json({ message: syncResult.message, activationLink: syncResult.activationLink, expiresAt: syncResult.expiresAt }, { status: 201 });
    }

    if (["blockFamilyAccess", "restoreFamilyAccess", "resetFamilyPassword", "revokeFamilyAccess"].includes(action)) {
      requireOwner(canManage);
      const grantId = clean(body.grantId, 100);
      const [current] = await db.select().from(familySystemAccess).where(eq(familySystemAccess.id, grantId)).limit(1);
      if (!current) return Response.json({ error: "Доступ не найден" }, { status: 404 });
      const eventByAction: Record<string, FamilyAccessEvent> = {
        blockFamilyAccess: "block_access",
        restoreFamilyAccess: "restore_access",
        resetFamilyPassword: "reset_password",
        revokeFamilyAccess: "revoke_access",
      };
      if (action === "restoreFamilyAccess" && current.status !== "Приостановлен") {
        return Response.json({ error: "Восстановить можно только приостановленный доступ" }, { status: 409 });
      }
      if (action === "blockFamilyAccess" && current.status !== "Активен") {
        return Response.json({ error: "Приостановить можно только активный доступ" }, { status: 409 });
      }
      if (action === "resetFamilyPassword" && current.status !== "Активен") {
        return Response.json({ error: "Сбросить пароль можно только для активного доступа" }, { status: 409 });
      }
      if (action === "revokeFamilyAccess" && current.status === "Отозван") {
        return Response.json({ error: "Доступ уже отозван" }, { status: 409 });
      }
      const currentVersion = validStoredAccessVersion(current.accessVersion);
      assertExpectedAccessVersion(body.expectedAccessVersion, currentVersion);
      const nextVersion = currentVersion + 1;
      const status = action === "blockFamilyAccess" ? "Приостановлен" : action === "revokeFamilyAccess" ? "Отозван" : "Активен";
      const deliveryStatus = action === "resetFamilyPassword" ? "Ожидает повторной отправки" : current.deliveryStatus;
      const now = uniqueMutationTimestamp();
      const grant = { ...current, status, accessVersion: nextVersion, deliveryStatus, lastSyncStatus: "Ожидает синхронизации", updatedAt: now };
      const family = await getFamilySnapshot(grant.familyEntityId);
      const syncEvent = prepareFamilyDiaryAccessEvent({ actor, eventType: eventByAction[action], grant, family });
      const guard = "EXISTS (SELECT 1 FROM family_system_access WHERE id=? AND access_version=?)";
      const guardValues = [grantId, currentVersion];
      const results = await env.DB.batch([
        env.DB.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
          SELECT ?,?,'entity',?,? WHERE ${guard}`)
          .bind(actor, `settings.family_access_${eventByAction[action]}`, grant.principalEntityId, JSON.stringify({ familyEntityId: grant.familyEntityId, accessVersion: nextVersion, syncStatus: "pending", syncEventId: syncEvent.id }), ...guardValues),
        accessOutboxInsert(syncEvent, guard, guardValues),
        env.DB.prepare(`UPDATE family_system_access SET
          status=?,access_version=?,delivery_status=?,last_sync_status='Ожидает синхронизации',last_synced_at='',updated_at=?
          WHERE id=? AND access_version=?`)
          .bind(status, nextVersion, deliveryStatus, now, grantId, currentVersion),
      ]);
      assertCasApplied(results.at(-1));
      const syncResult = await dispatchFamilyEventSafely(syncEvent.id);
      return Response.json({ message: syncResult.message, activationLink: syncResult.activationLink, expiresAt: syncResult.expiresAt });
    }

    if (action === "retryAccessSync") {
      requireOwner(canManage);
      const eventId = clean(body.eventId, 100);
      const [event] = await db.select({ eventType: accessSyncEvents.eventType })
        .from(accessSyncEvents)
        .where(and(eq(accessSyncEvents.id, eventId), eq(accessSyncEvents.systemId, SCHOOL_SYSTEM_ID)))
        .limit(1);
      if (!event) return Response.json({ error: "Событие синхронизации не найдено" }, { status: 404 });
      const result = familyAccessEvents.has(event.eventType as FamilyAccessEvent)
        ? await dispatchFamilyDiaryAccessEvent(eventId)
        : await dispatchSchoolDiaryAccessEvent(eventId);
      return Response.json({ message: result.message, status: result.status, activationLink: result.activationLink, expiresAt: result.expiresAt });
    }

    if (action === "createManualRecord") {
      requireOwner(canManage);
      const branchId = clean(body.branchId, 80);
      const recordType = clean(body.recordType, 80);
      const title = clean(body.title, 180);
      if (!recordTypes.has(recordType) || title.length < 2) return Response.json({ error: "Выберите тип и укажите название" }, { status: 400 });
      await assertBranchAccess(me.id, me.isAdministrative, branchId);
      const id = `MAN-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
      const amount = Math.round(Number(body.amount ?? 0) * 100);
      const details = clean(body.details, 2000);
      await db.insert(manualRecords).values({ id, branchId, recordType, title, period: clean(body.period, 10), amountMinor: Number.isFinite(amount) ? amount : 0, details: JSON.stringify({ note: details }), status: "Проверено вручную", createdBy: actor });
      await audit(actor, "manual_record.created", "manual_record", id, { branchId, recordType });
      return Response.json({ message: "Запись сохранена в выбранном филиале" }, { status: 201 });
    }

    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    const failure = safeSettingsActionError(error);
    if (!failure.expected) console.error("settings.action_failed");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

async function ensureBranches() {
  const db = getDb();
  const updatedAt = new Date().toISOString();
  for (const branch of defaultBranches) {
    await db.insert(organizationBranches).values({ ...branch, status: "Активен", updatedAt }).onConflictDoUpdate({
      target: organizationBranches.id,
      set: { name: branch.name, kind: branch.kind, status: "Активен", sortOrder: branch.sortOrder, updatedAt },
    });
  }
  await db.update(organizationBranches).set({ status: "Архив", updatedAt }).where(eq(organizationBranches.id, "BR-EXTRA"));
}

async function loadEmployeeAccessDirectory(accountUsers: Array<typeof appUsers.$inferSelect>) {
  const db = getDb();
  const [employees, employeeEntities, branchRows] = await Promise.all([
    db.select().from(hrEmployees).orderBy(asc(hrEmployees.unit), asc(hrEmployees.positionId)),
    db.select().from(entities).where(eq(entities.entityType, "Сотрудник")).orderBy(asc(entities.displayName)),
    db.select({ id: organizationBranches.id, name: organizationBranches.name }).from(organizationBranches).where(eq(organizationBranches.status, "Активен")),
  ]);
  const branchIdByName = new Map(branchRows.map((branch) => [branch.name.toLocaleLowerCase("ru"), branch.id]));
  const matchLegacyBranch = (name: string) => {
    const normalized = name.trim().toLocaleLowerCase("ru");
    return branchIdByName.get(normalized) ?? branchRows.find((branch) => {
      const candidate = branch.name.toLocaleLowerCase("ru");
      return candidate.includes(normalized) || normalized.includes(candidate) || (candidate === "1–11" && normalized.includes("1-11"));
    })?.id;
  };
  const entityMap = new Map(employeeEntities.map((entity) => [entity.id, entity]));
  const accountById = new Map(accountUsers.map((user) => [user.id, user]));
  const accountByContact = new Map(accountUsers.map((user) => [normalizeLooseContact(user.contact), user]));
  const usedAccounts = new Set<string>();
  const directory = employees.map((employee) => {
    const entity = entityMap.get(employee.id);
    const metadata = parseMetadata(entity?.metadata ?? "{}");
    const contact = clean(metadata.contact, 160);
    const savedBranchIds = stringArray(metadata.branchIds);
    const legacyBranchIds = employee.unit.split(",").map(matchLegacyBranch).filter((id): id is string => Boolean(id));
    const employeeBranchIds = savedBranchIds.length ? savedBranchIds : legacyBranchIds;
    const account = accountById.get(employee.id) ?? (contact ? accountByContact.get(normalizeLooseContact(contact)) : undefined);
    if (account) usedAccounts.add(account.id);
    if (account) return { ...exposeAccountUser(account), employeeId: employee.id, hasAccess: true, source: entity?.sourceSystem ?? "HR", unit: employee.unit, position: account.jobTitle || employee.positionId, employeeBranchIds, dataQuality: entity?.dataQuality ?? "На проверке" };
    const role = suggestedRole(employee.positionId);
    return {
      id: employee.id,
      employeeId: employee.id,
      contactType: contact.includes("@") ? "email" : "phone",
      contact,
      displayName: entity?.displayName ?? employee.id,
      role,
      jobTitle: employee.positionId,
      allowedModules: defaultModulesForRole(role),
      favoriteModules: [],
      isAdministrative: false,
      status: "Доступ не выдан",
      invitationStatus: "Не приглашён",
      accessVersion: 0,
      invitedBy: "",
      invitedAt: "",
      activatedAt: "",
      updatedAt: employee.updatedAt,
      hasAccess: false,
      source: entity?.sourceSystem ?? "HR",
      unit: employee.unit,
      position: employee.positionId,
      employeeBranchIds,
      dataQuality: entity?.dataQuality ?? "На проверке",
    };
  });
  const accessOnly = accountUsers.filter((user) => !usedAccounts.has(user.id)).map((user) => ({ ...exposeAccountUser(user), employeeId: "", hasAccess: true, source: "Учётная запись", unit: "", position: user.jobTitle, employeeBranchIds: [] as string[], dataQuality: "Проверено" }));
  return [...directory, ...accessOnly].sort((a, b) => a.displayName.localeCompare(b.displayName, "ru"));
}

async function loadFamilyDirectory() {
  const db = getDb();
  const families = await db.select().from(entities).where(eq(entities.entityType, "Семья")).orderBy(asc(entities.displayName));
  const activeFamilies = families.filter((family) => family.status !== "Объединена");
  if (!activeFamilies.length) return [];
  const duplicateCounts = new Map<string, number>();
  for (const family of activeFamilies) {
    const key = normalizeEntityName(family.displayName);
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  }
  const links = await db.select().from(entityLinks);
  const memberIds = new Set<string>();
  const relationsByFamily = new Map<string, Array<{ memberId: string; relation: string }>>();
  for (const family of activeFamilies) {
    const relations: Array<{ memberId: string; relation: string }> = [];
    for (const link of links) {
      if (link.fromEntityId === family.id) {
        relations.push({ memberId: link.toEntityId, relation: link.relationType });
        memberIds.add(link.toEntityId);
      } else if (link.toEntityId === family.id) {
        relations.push({ memberId: link.fromEntityId, relation: link.relationType });
        memberIds.add(link.fromEntityId);
      }
    }
    relationsByFamily.set(family.id, relations);
  }
  const members = memberIds.size ? await db.select().from(entities).where(inArray(entities.id, [...memberIds])) : [];
  const memberMap = new Map(members.map((member) => [member.id, member]));
  return activeFamilies.map((family) => ({
    id: family.id,
    displayName: family.displayName,
    status: family.status,
    sourceSystem: family.sourceSystem,
    sourceRecordId: family.sourceRecordId,
    dataQuality: familyDataState(family, (duplicateCounts.get(normalizeEntityName(family.displayName)) ?? 0) > 1),
    scope: family.scope,
    members: (relationsByFamily.get(family.id) ?? []).map((relation) => {
      const member = memberMap.get(relation.memberId);
      if (!member || !["Ребёнок", "Клиент"].includes(member.entityType)) return null;
      const metadata = parseMetadata(member.metadata);
      return { id: member.id, displayName: member.displayName, entityType: member.entityType, relation: relation.relation, sourceSystem: member.sourceSystem, sourceRecordId: member.sourceRecordId, scope: member.scope, phone: clean(metadata.phone, 80), email: clean(metadata.email, 160) };
    }).filter(Boolean),
  }));
}

async function getFamilySnapshot(familyId: string) {
  const directory = await loadFamilyDirectory();
  const family = directory.find((item) => item.id === familyId);
  if (!family) throw new Error("Семья не найдена в центральном реестре");
  return {
    id: family.id,
    displayName: family.displayName,
    sourceSystem: family.sourceSystem,
    sourceRecordId: family.sourceRecordId,
    dataQuality: family.dataQuality,
    members: family.members.map((member) => ({ id: member!.id, displayName: member!.displayName, entityType: member!.entityType, relation: member!.relation, sourceSystem: member!.sourceSystem, sourceRecordId: member!.sourceRecordId, scope: member!.scope })),
  };
}

async function ensureSystems() {
  await getDb().insert(appSystems).values(defaultSystems.map((system) => ({ ...system }))).onConflictDoNothing();
}

async function ensureUser(actor: string) {
  const db = getDb();
  const normalized = actor.trim().toLowerCase();
  const [existing] = await db.select().from(appUsers).where(eq(appUsers.contact, normalized)).limit(1);
  if (existing) {
    if (existing.status === "Приглашён" && existing.contactType === "email") {
      const [activated] = await db.update(appUsers).set({ status: "Активен", invitationStatus: "Активирован", activatedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(and(eq(appUsers.id, existing.id), eq(appUsers.status, "Приглашён"))).returning();
      const activeUser = activated ?? existing;
      await ensureCanonicalOwnerSystemGrant(activeUser, actor);
      return activeUser;
    }
    await ensureCanonicalOwnerSystemGrant(existing, actor);
    return existing;
  }
  if (ownerContacts.has(normalized)) {
    const [savedOwner] = await db.select().from(appUsers).where(eq(appUsers.id, "USR-OWNER")).limit(1);
    const ownerValues = {
      contactType: "email",
      contact: normalized,
      displayName: "Виталий Озолин",
      role: "Собственник",
      isAdministrative: true,
      status: "Активен",
      invitationStatus: "Активирован",
      activatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const [owner] = savedOwner
      ? await db.update(appUsers).set(ownerValues).where(eq(appUsers.id, savedOwner.id)).returning()
      : await db.insert(appUsers).values({ id: "USR-OWNER", ...ownerValues, invitedBy: actor }).returning();
    await ensureCanonicalOwnerSystemGrant(owner, actor);
    return owner;
  }
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(appUsers);
  if (Number(count) > 0) return null;
  const [owner] = await db.insert(appUsers).values({ id: "USR-OWNER", contactType: "email", contact: normalized, displayName: "Виталий Озолин", role: "Собственник", isAdministrative: true, status: "Активен", invitationStatus: "Активирован", invitedBy: actor, activatedAt: new Date().toISOString() }).returning();
  await ensureCanonicalOwnerSystemGrant(owner, actor);
  return owner;
}

async function ensureCanonicalOwnerSystemGrant(user: typeof appUsers.$inferSelect, actor: string) {
  if (user.id !== "USR-OWNER" || user.role !== "Собственник" || !user.isAdministrative) return;
  const system = defaultSystems.find((entry) => entry.systemKey === "ARTHELLO_OS");
  if (!system) throw new Error("Основная система не настроена");
  await getDb().insert(userSystemAccess).values({
    userId: user.id,
    systemId: system.id,
    role: user.role,
    status: user.status === "Доступ приостановлен" ? "Приостановлен" : "Активен",
    accessVersion: user.accessVersion,
    lastSyncStatus: "Не требуется",
    grantedBy: actor,
  }).onConflictDoNothing();
}

async function prepareExistingStaffEvent(actor: string, user: typeof appUsers.$inferSelect, eventType: Extract<StaffAccessEvent, "block" | "restore" | "reset_password">) {
  const db = getDb();
  const [grant] = await db.select().from(userSystemAccess).where(and(eq(userSystemAccess.userId, user.id), eq(userSystemAccess.systemId, SCHOOL_SYSTEM_ID))).limit(1);
  if (!grant) return null;
  const branches = user.isAdministrative
    ? await db.select({ id: organizationBranches.id, name: organizationBranches.name }).from(organizationBranches).where(eq(organizationBranches.status, "Активен"))
    : await db.select({ id: organizationBranches.id, name: organizationBranches.name })
      .from(organizationBranches)
      .innerJoin(userBranchAccess, eq(userBranchAccess.branchId, organizationBranches.id))
      .where(eq(userBranchAccess.userId, user.id));
  return prepareSchoolDiaryAccessEvent({ actor, eventType, accessRevision: user.updatedAt, user, diaryRole: grant.role, branches });
}

function accessOutboxInsert(event: PreparedStaffAccessSyncEvent | PreparedFamilyAccessSyncEvent, guard = "", guardValues: unknown[] = []) {
  if (!guard) {
    return env.DB.prepare(`INSERT INTO access_sync_events (id,event_type,user_id,system_id,payload)
      VALUES (?,?,?,?,?)`).bind(event.id, event.eventType, event.userId, event.systemId, event.payload);
  }
  return env.DB.prepare(`INSERT INTO access_sync_events (id,event_type,user_id,system_id,payload)
    SELECT ?,?,?,?,? WHERE ${guard}`)
    .bind(event.id, event.eventType, event.userId, event.systemId, event.payload, ...guardValues);
}

async function dispatchStaffEventSafely(eventId: string): Promise<StaffSyncResult> {
  try {
    return await dispatchSchoolDiaryAccessEvent(eventId);
  } catch {
    console.error("settings.staff_access_dispatch_failed");
    return {
      status: "Ошибка синхронизации",
      message: "Права сохранены в ArtHello OS. Событие осталось в очереди и будет доступно для повторной отправки.",
    };
  }
}

async function dispatchFamilyEventSafely(eventId: string) {
  try {
    return await dispatchFamilyDiaryAccessEvent(eventId);
  } catch {
    console.error("settings.family_access_dispatch_failed");
    return {
      status: "Ошибка синхронизации" as const,
      message: "Доступ сохранён в ArtHello OS. Событие осталось в очереди и будет доступно для повторной отправки.",
    };
  }
}

function validStoredAccessVersion(value: unknown) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) throwAccessConflict();
  return version;
}

function assertExpectedAccessVersion(value: unknown, currentVersion: number) {
  const expectedVersion = value === undefined ? currentVersion : Number(value);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== currentVersion) throwAccessConflict();
}

function assertCasApplied(result: unknown) {
  if (batchChangeCount(result) !== 1) throwAccessConflict();
}

function throwAccessConflict(): never {
  throw new Error("Права уже изменены в другом окне. Обновите данные и повторите действие");
}

function uniqueMutationTimestamp() {
  const base = new Date().toISOString();
  const suffix = crypto.getRandomValues(new Uint32Array(1))[0].toString().padStart(10, "0").slice(-6);
  return `${base.slice(0, -1)}${suffix}Z`;
}

async function assertBranchAccess(userId: string, administrative: boolean, branchId: string) {
  if (!branchId) throw new Error("Выберите филиал");
  if (administrative) return;
  const [grant] = await getDb().select().from(userBranchAccess).where(and(eq(userBranchAccess.userId, userId), eq(userBranchAccess.branchId, branchId))).limit(1);
  if (!grant) throw new Error("Нет прав на выбранный филиал");
}

async function audit(actor: string, action: string, entityType: string, entityId: string, payload: unknown) {
  await getDb().insert(auditEvents).values({ actor, action, entityType, entityId, payload: JSON.stringify(payload) });
}

async function assertSameOriginMutation(request: Request) {
  const publicOrigin = (env as unknown as { ARTHELLO_PUBLIC_ORIGIN?: string }).ARTHELLO_PUBLIC_ORIGIN?.trim() ?? "";
  if (!hasTrustedMutationOrigin(request, publicOrigin)) {
    return Response.json({ error: "Запрос отклонён: источник страницы не совпадает" }, { status: 403 });
  }

  let authenticated: Awaited<ReturnType<typeof getAuthenticatedRequestContext>>;
  try {
    authenticated = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!authenticated) return Response.json({ error: "Требуется вход" }, { status: 401 });

  try {
    verifyAuthenticatedRequestCsrf(request, authenticated);
  } catch {
    return Response.json({ error: "Защитная сессия устарела. Войдите заново." }, { status: 403 });
  }
  return authenticated;
}

function requestAccessContext(request: Request) {
  return {
    apiRole: request.headers.get("x-arthello-role") ?? "",
    isSystemOwner: request.headers.get("x-arthello-system-owner") === "1",
  };
}

function requireOwner(value: boolean) { if (!value) throw new Error("Нет прав: изменять доступы и системные настройки может только собственник"); }
function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function normalizeEntityName(value: string) { return value.toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]/gi, ""); }
function familyDataState(family: { sourceSystem: string; dataQuality: string }, hasDuplicate: boolean) { if (hasDuplicate) return "Требует сверки"; if (family.sourceSystem === "MANUAL" && family.dataQuality !== "Требует сверки") return "Создано вручную"; return family.dataQuality; }
function familyNeedsReview(family: { sourceSystem: string; dataQuality: string }) { return family.dataQuality === "Требует сверки" || family.dataQuality === "На проверке" || (family.sourceSystem !== "MANUAL" && family.dataQuality !== "Проверено"); }
function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function uniqueStrings(value: unknown) { return [...new Set(stringArray(value).map((item) => item.trim()).filter(Boolean))]; }
function storedModules(value: string) {
  if (!value) return null;
  try { return uniqueStrings(JSON.parse(value)); } catch { return null; }
}
function defaultModulesForRole(role: string) {
  const apiRole = API_ROLE_BY_APP_ROLE[role];
  if (!apiRole) return ["tasks", "events"] as ModuleId[];
  const context = { apiRole, isSystemOwner: apiRole === "OWNER", canAccessMedical: apiRole === "MEDICAL" };
  return moduleCatalog.map((module) => module.id).filter((id) => id !== "home" && canAccessModule(context, id));
}
function resolveAllowedModules(value: string, role: string) {
  const stored = storedModules(value);
  return stored === null
    ? defaultModulesForRole(role)
    : stored.filter((id): id is ModuleId => assignableModuleIds.has(id as ModuleId) || (role === "Собственник" && id === "access"));
}
function resolveFavoriteModules(value: string, allowedModules: readonly string[]) {
  const allowed = new Set(allowedModules);
  const stored = storedModules(value);
  const source = stored === null ? ["registry", "clients", "legal", "hr", "projects"] : stored;
  return source.filter((id): id is ModuleId => favoriteModuleIds.has(id as ModuleId) && allowed.has(id)).slice(0, 12);
}
function exposeAccountUser(user: typeof appUsers.$inferSelect) {
  const allowedModules = resolveAllowedModules(user.allowedModules, user.role);
  return { ...user, allowedModules, favoriteModules: resolveFavoriteModules(user.favoriteModules, allowedModules) };
}
function parseMetadata(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function validContact(value: string, type: string) { return type === "email" ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) : /^\+?[0-9 ()-]{10,20}$/.test(value); }
function normalizeContact(value: string, type: string) {
  if (type === "email") return value;
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits ? `+${digits}` : value;
}
function normalizeLooseContact(value: string) { return value.includes("@") ? value.trim().toLowerCase() : value.replace(/\D/g, "").replace(/^8(?=\d{10}$)/, "7"); }
function suggestedRole(position: string) { const value = position.toLocaleLowerCase("ru"); if (value.includes("учител") || value.includes("педагог")) return "Педагог"; if (value.includes("завуч")) return "Завуч"; if (value.includes("директор")) return "Директор"; if (value.includes("бухгалтер")) return "Бухгалтерия"; if (value.includes("hr") || value.includes("кадр")) return "HR"; if (value.includes("администратор")) return "Администратор"; return "Сотрудник"; }
