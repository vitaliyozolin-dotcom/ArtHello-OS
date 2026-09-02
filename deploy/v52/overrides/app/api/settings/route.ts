import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { accessSyncEvents, appSystems, appUsers, auditEvents, entities, entityLinks, familySystemAccess, hrEmployees, manualRecords, organizationBranches, userBranchAccess, userSystemAccess } from "../../../db/schema";
import { getRequestUser } from "../../../lib/request-user";
import { type FamilyAccessEvent, syncFamilyDiaryAccess } from "../../../lib/family-access-sync";
import { SCHOOL_SYSTEM_ID, syncSchoolDiaryAccess } from "../../../lib/staff-access-sync";
import { ASSIGNABLE_APP_ROLES, canManageAccess } from "../../../lib/access-policy";

const defaultBranches = [
  { id: "BR-KINDERGARTEN", name: "Атлас — садик", kind: "Детский сад", sortOrder: 10 },
  { id: "BR-ATLAS-SCHOOL", name: "Атлас — школа", kind: "Школа", sortOrder: 20 },
  { id: "BR-SCHOOL", name: "1–11", kind: "Школа", sortOrder: 30 },
  { id: "BR-NEBO", name: "Небо", kind: "Детский сад", sortOrder: 40 },
  { id: "BR-LISTVENNAYA", name: "Лиственная", kind: "Филиал", sortOrder: 50 },
] as const;

const defaultSystems = [
  { id: "SYS-ARTHELLO-OS", systemKey: "ARTHELLO_OS", name: "ArtHello OS", description: "Управление группой, филиалами и сквозными процессами", sortOrder: 10 },
  { id: SCHOOL_SYSTEM_ID, systemKey: "SCHOOL_DIARY", name: "Дневник 1–11", description: "Учебный контур школы; классы и предметы назначаются уже в дневнике", sortOrder: 20 },
] as const;

const diaryRoles = new Set(["director", "deputy", "admin", "teacher", "tech_admin"]);

const assignableRoles = new Set(ASSIGNABLE_APP_ROLES);

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
    const branchIds = access.map((item) => item.branchId);
    const records = me.isAdministrative
      ? await db.select().from(manualRecords).orderBy(desc(manualRecords.createdAt)).limit(80)
      : branchIds.length
        ? await db.select().from(manualRecords).where(inArray(manualRecords.branchId, branchIds)).orderBy(desc(manualRecords.createdAt)).limit(80)
        : [];
    const accountUsers = canManage
      ? await db.select().from(appUsers).orderBy(asc(appUsers.displayName))
      : [me];
    const users = canManage
      ? await loadEmployeeAccessDirectory(accountUsers)
      : accountUsers.map((user) => ({ ...user, employeeId: "", hasAccess: true, source: "Учётная запись" }));
    const grants = canManage ? await db.select().from(userBranchAccess) : access.map((item, index) => ({ id: index, userId: me.id, grantedBy: "", createdAt: "", ...item }));
    const systems = await db.select().from(appSystems).where(eq(appSystems.status, "Активна")).orderBy(asc(appSystems.sortOrder));
    const systemGrants = canManage
      ? await db.select().from(userSystemAccess)
      : await db.select().from(userSystemAccess).where(eq(userSystemAccess.userId, me.id));
    const syncEvents = canManage
      ? await db.select().from(accessSyncEvents).orderBy(desc(accessSyncEvents.createdAt)).limit(40)
      : [];
    const accessHistory = canManage
      ? await db.select().from(auditEvents).where(like(auditEvents.action, "settings.%")).orderBy(desc(auditEvents.createdAt)).limit(80)
      : [];
    const familyDirectory = canManage ? await loadFamilyDirectory() : [];
    const familyAccessGrants = canManage ? await db.select().from(familySystemAccess).orderBy(desc(familySystemAccess.updatedAt)) : [];
    return Response.json({
      me,
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
        [SCHOOL_SYSTEM_ID]: [
          { value: "director", label: "Директор" },
          { value: "deputy", label: "Завуч" },
          { value: "admin", label: "Администратор школы" },
          { value: "teacher", label: "Учитель" },
          { value: "tech_admin", label: "Технический администратор" },
        ],
      },
      records,
      canManage,
      authBoundary: "ArtHello OS — единый источник сотрудников, семей, родителей, учеников, классов и прав входа. AlfaCRM передаёт исходные записи через API, ArtHello OS присваивает стабильные ID, а дневник получает только проекцию и хранит учебные данные. Внутри дневника ничего из этого повторно не создаётся.",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Настройки недоступны" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    await ensureBranches();
    await ensureSystems();
    const db = getDb();
    const me = await ensureUser(actor);
    if (!me || me.status === "Доступ приостановлен") return Response.json({ error: "Доступ не активирован" }, { status: 403 });
    const canManage = canManageAccess(requestAccessContext(request));
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 50);

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
      const contactType = rawContact.includes("@") ? "email" : "phone";
      const contact = normalizeContact(rawContact, contactType);
      const displayName = clean(body.displayName, 120);
      const role = clean(body.role, 80);
      const systemIds = stringArray(body.systemIds).filter((id) => defaultSystems.some((system) => system.id === id));
      const diaryRole = clean(body.diaryRole, 40);
      const administrative = body.isAdministrative === true;
      const branchIds = administrative ? [] : stringArray(body.branchIds).slice(0, 20);
      if (!validContact(contact, contactType) || displayName.length < 2) return Response.json({ error: "Проверьте контакт и имя" }, { status: 400 });
      if (!systemIds.length) return Response.json({ error: "Выберите хотя бы одну систему" }, { status: 400 });
      if (!administrative && !branchIds.length) return Response.json({ error: "Выберите хотя бы один филиал" }, { status: 400 });
      if (systemIds.includes(SCHOOL_SYSTEM_ID) && (contactType !== "phone" || !diaryRoles.has(diaryRole))) {
        return Response.json({ error: "Для дневника нужен номер телефона и отдельная роль дневника" }, { status: 400 });
      }
      if (employeeId) {
        const [employee] = await db.select().from(hrEmployees).where(eq(hrEmployees.id, employeeId)).limit(1);
        if (!employee || employee.status === "Уволен") return Response.json({ error: "Сотрудник не найден или уже уволен" }, { status: 404 });
      }
      const [existingByEmployee] = employeeId ? await db.select().from(appUsers).where(eq(appUsers.id, employeeId)).limit(1) : [];
      const [existingByContact] = await db.select().from(appUsers).where(eq(appUsers.contact, contact)).limit(1);
      if (existingByEmployee && existingByContact && existingByEmployee.id !== existingByContact.id) return Response.json({ error: "Этот контакт уже используется другой учётной записью" }, { status: 409 });
      const existing = existingByEmployee ?? existingByContact;
      const canonicalOwnerTarget = existing?.id === "USR-OWNER" || (requestAccessContext(request).isSystemOwner && existing?.id === me.id);
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
      const nextVersion = Number(existing?.accessVersion ?? 0) + 1;
      const id = existing?.id ?? (employeeId || `USR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`);
      const invitationStatus = contactType === "email" ? "Ожидает первого входа в ArtHello OS" : "Ожидает активации в назначенных системах";
      const [user] = existing
        ? await db.update(appUsers).set({ contactType, contact, displayName, role, isAdministrative: administrative, invitationStatus, accessVersion: nextVersion, updatedAt: new Date().toISOString() }).where(eq(appUsers.id, existing.id)).returning()
        : await db.insert(appUsers).values({ id, contactType, contact, displayName, role, isAdministrative: administrative, status: "Активен", invitationStatus, accessVersion: nextVersion, invitedBy: actor }).returning();
      const previousSystems = existing
        ? await db.select().from(userSystemAccess).where(eq(userSystemAccess.userId, user.id))
        : [];
      await db.delete(userBranchAccess).where(eq(userBranchAccess.userId, user.id));
      if (!administrative) {
        await db.insert(userBranchAccess).values(branchIds.map((branchId) => ({ userId: user.id, branchId, grantedBy: actor }))).onConflictDoNothing();
      }
      await db.delete(userSystemAccess).where(eq(userSystemAccess.userId, user.id));
      await db.insert(userSystemAccess).values(systemIds.map((systemId) => ({
        userId: user.id,
        systemId,
        role: systemId === SCHOOL_SYSTEM_ID ? diaryRole : role,
        status: user.status === "Доступ приостановлен" ? "Приостановлен" : "Активен",
        accessVersion: nextVersion,
        lastSyncStatus: systemId === SCHOOL_SYSTEM_ID ? "Ожидает синхронизации" : "Не требуется",
        grantedBy: actor,
      }))).onConflictDoNothing();
      const branchRows = administrative
        ? await db.select({ id: organizationBranches.id, name: organizationBranches.name }).from(organizationBranches).where(eq(organizationBranches.status, "Активен"))
        : await db.select({ id: organizationBranches.id, name: organizationBranches.name }).from(organizationBranches).where(inArray(organizationBranches.id, branchIds));
      let syncResult: Awaited<ReturnType<typeof syncSchoolDiaryAccess>> | null = null;
      if (systemIds.includes(SCHOOL_SYSTEM_ID)) {
        syncResult = await syncSchoolDiaryAccess({ actor, eventType: "upsert", user, diaryRole, branches: branchRows });
      } else if (previousSystems.some((grant) => grant.systemId === SCHOOL_SYSTEM_ID)) {
        syncResult = await syncSchoolDiaryAccess({ actor, eventType: "revoke", user, diaryRole: previousSystems.find((grant) => grant.systemId === SCHOOL_SYSTEM_ID)?.role ?? "teacher", branches: [] });
      }
      await audit(actor, "settings.user_access_saved", "app_user", user.id, { contactType, role, administrative, branchIds, systemIds, diaryRole, syncStatus: syncResult?.status ?? "not_required" });
      if (employeeId) await db.update(hrEmployees).set({ accessStatus: user.status === "Доступ приостановлен" ? "Приостановлен" : "Активен", updatedAt: new Date().toISOString() }).where(eq(hrEmployees.id, employeeId));
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
      const nextVersion = Number(target.accessVersion) + 1;
      const updated = await db.update(appUsers).set({ status: "Доступ приостановлен", invitationStatus: "Заблокирован владельцем", accessVersion: nextVersion, activatedAt: "", updatedAt: new Date().toISOString() }).where(eq(appUsers.id, userId)).returning();
      if (!updated.length) return Response.json({ error: "Пользователь не найден" }, { status: 404 });
      await db.update(userSystemAccess).set({ status: "Приостановлен", accessVersion: nextVersion, updatedAt: new Date().toISOString() }).where(eq(userSystemAccess.userId, userId));
      const syncResult = await syncExistingDiaryGrant(actor, updated[0], "block");
      await audit(actor, "settings.user_blocked", "app_user", userId, { syncStatus: syncResult?.status ?? "not_required" });
      await db.update(hrEmployees).set({ accessStatus: "Приостановлен", updatedAt: new Date().toISOString() }).where(eq(hrEmployees.id, employeeId || userId));
      return Response.json({ message: syncResult?.message ?? "Сотрудник заблокирован во всех назначенных системах." });
    }

    if (action === "restoreUser") {
      requireOwner(canManage);
      const userId = clean(body.userId, 80);
      const employeeId = clean(body.employeeId, 80);
      const [target] = await db.select().from(appUsers).where(eq(appUsers.id, userId)).limit(1);
      if (!target) return Response.json({ error: "Пользователь не найден" }, { status: 404 });
      const nextVersion = Number(target.accessVersion) + 1;
      const [updated] = await db.update(appUsers).set({ status: "Активен", invitationStatus: "Доступ восстановлен", accessVersion: nextVersion, updatedAt: new Date().toISOString() }).where(eq(appUsers.id, userId)).returning();
      await db.update(userSystemAccess).set({ status: "Активен", accessVersion: nextVersion, updatedAt: new Date().toISOString() }).where(eq(userSystemAccess.userId, userId));
      const syncResult = await syncExistingDiaryGrant(actor, updated, "restore");
      await audit(actor, "settings.user_restored", "app_user", userId, { syncStatus: syncResult?.status ?? "not_required" });
      await db.update(hrEmployees).set({ accessStatus: "Активен", updatedAt: new Date().toISOString() }).where(eq(hrEmployees.id, employeeId || userId));
      return Response.json({ message: syncResult?.message ?? "Доступ сотрудника восстановлен." });
    }

    if (action === "resetPassword" || action === "resetAccess") {
      requireOwner(canManage);
      const userId = clean(body.userId, 80);
      const [target] = await db.select().from(appUsers).where(eq(appUsers.id, userId)).limit(1);
      if (!target) return Response.json({ error: "Пользователь не найден" }, { status: 404 });
      const nextVersion = Number(target.accessVersion) + 1;
      const [updated] = await db.update(appUsers).set({ invitationStatus: "Требуется новый пароль", accessVersion: nextVersion, updatedAt: new Date().toISOString() }).where(eq(appUsers.id, userId)).returning();
      await db.update(userSystemAccess).set({ accessVersion: nextVersion, updatedAt: new Date().toISOString() }).where(eq(userSystemAccess.userId, userId));
      const syncResult = await syncExistingDiaryGrant(actor, updated, "reset_password");
      if (!syncResult) return Response.json({ error: "У сотрудника нет доступа к системе с собственным паролем" }, { status: 409 });
      await audit(actor, "settings.user_password_reset", "app_user", userId, { syncStatus: syncResult.status });
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
      const nextVersion = Number(existing?.accessVersion ?? 0) + 1;
      const [grant] = await db.insert(familySystemAccess).values({
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
      }).onConflictDoUpdate({ target: [familySystemAccess.principalEntityId, familySystemAccess.systemId], set: {
        familyEntityId,
        principalType: principal.entityType === "Ребёнок" ? "student" : "guardian",
        role,
        loginType,
        login,
        deliveryChannel,
        deliveryStatus: "Ожидает отправки",
        status: "Активен",
        accessVersion: nextVersion,
        lastSyncStatus: "Ожидает синхронизации",
        grantedBy: actor,
        updatedAt: new Date().toISOString(),
      } }).returning();
      const syncResult = await syncFamilyDiaryAccess({ actor, eventType: "grant_access", grant, family });
      await audit(actor, "settings.family_access_granted", "entity", principalEntityId, { familyEntityId, role, loginType, deliveryChannel, accessVersion: nextVersion, syncStatus: syncResult.status });
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
      const nextVersion = Number(current.accessVersion) + 1;
      const status = action === "blockFamilyAccess" ? "Приостановлен" : action === "revokeFamilyAccess" ? "Отозван" : "Активен";
      const deliveryStatus = action === "resetFamilyPassword" ? "Ожидает повторной отправки" : current.deliveryStatus;
      const [grant] = await db.update(familySystemAccess).set({ status, accessVersion: nextVersion, deliveryStatus, lastSyncStatus: "Ожидает синхронизации", updatedAt: new Date().toISOString() }).where(eq(familySystemAccess.id, grantId)).returning();
      const family = await getFamilySnapshot(grant.familyEntityId);
      const syncResult = await syncFamilyDiaryAccess({ actor, eventType: eventByAction[action], grant, family });
      await audit(actor, `settings.family_access_${eventByAction[action]}`, "entity", grant.principalEntityId, { familyEntityId: grant.familyEntityId, accessVersion: nextVersion, syncStatus: syncResult.status });
      return Response.json({ message: syncResult.message, activationLink: syncResult.activationLink, expiresAt: syncResult.expiresAt });
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
    const message = error instanceof Error ? error.message : "Действие не выполнено";
    return Response.json({ error: message }, { status: message.includes("Нет прав") ? 403 : 500 });
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
    if (account) return { ...account, employeeId: employee.id, hasAccess: true, source: entity?.sourceSystem ?? "HR", unit: employee.unit, position: employee.positionId, employeeBranchIds, dataQuality: entity?.dataQuality ?? "На проверке" };
    return {
      id: employee.id,
      employeeId: employee.id,
      contactType: contact.includes("@") ? "email" : "phone",
      contact,
      displayName: entity?.displayName ?? employee.id,
      role: suggestedRole(employee.positionId),
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
  const accessOnly = accountUsers.filter((user) => !usedAccounts.has(user.id)).map((user) => ({ ...user, employeeId: "", hasAccess: true, source: "Учётная запись", unit: "", position: "", employeeBranchIds: [] as string[], dataQuality: "Проверено" }));
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
      await ensureAdministrativeSystemGrants(activeUser, actor);
      return activeUser;
    }
    await ensureAdministrativeSystemGrants(existing, actor);
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
    await ensureAdministrativeSystemGrants(owner, actor);
    return owner;
  }
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(appUsers);
  if (Number(count) > 0) return null;
  const [owner] = await db.insert(appUsers).values({ id: "USR-OWNER", contactType: "email", contact: normalized, displayName: "Виталий Озолин", role: "Собственник", isAdministrative: true, status: "Активен", invitationStatus: "Активирован", invitedBy: actor, activatedAt: new Date().toISOString() }).returning();
  await ensureAdministrativeSystemGrants(owner, actor);
  return owner;
}

async function ensureAdministrativeSystemGrants(user: typeof appUsers.$inferSelect, actor: string) {
  if (!user.isAdministrative) return;
  await getDb().insert(userSystemAccess).values(defaultSystems.map((system) => ({
    userId: user.id,
    systemId: system.id,
    role: system.id === SCHOOL_SYSTEM_ID ? "director" : user.role,
    status: user.status === "Доступ приостановлен" ? "Приостановлен" : "Активен",
    accessVersion: user.accessVersion,
    lastSyncStatus: system.id === SCHOOL_SYSTEM_ID ? "Ожидает синхронизации" : "Не требуется",
    grantedBy: actor,
  }))).onConflictDoNothing();
}

async function syncExistingDiaryGrant(actor: string, user: typeof appUsers.$inferSelect, eventType: "block" | "restore" | "reset_password") {
  const db = getDb();
  const [grant] = await db.select().from(userSystemAccess).where(and(eq(userSystemAccess.userId, user.id), eq(userSystemAccess.systemId, SCHOOL_SYSTEM_ID))).limit(1);
  if (!grant) return null;
  const branches = user.isAdministrative
    ? await db.select({ id: organizationBranches.id, name: organizationBranches.name }).from(organizationBranches).where(eq(organizationBranches.status, "Активен"))
    : await db.select({ id: organizationBranches.id, name: organizationBranches.name })
      .from(organizationBranches)
      .innerJoin(userBranchAccess, eq(userBranchAccess.branchId, organizationBranches.id))
      .where(eq(userBranchAccess.userId, user.id));
  return syncSchoolDiaryAccess({ actor, eventType, user, diaryRole: grant.role, branches });
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
