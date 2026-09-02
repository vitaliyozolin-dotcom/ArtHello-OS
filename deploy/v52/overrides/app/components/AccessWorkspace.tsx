"use client";

import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { moduleCatalog, type ModuleId } from "../../data/test-snapshot";
import { APP_ROLE_DEFINITIONS, ASSIGNABLE_APP_ROLES, permissionForRole, type RolePermission } from "../../lib/access-policy";
import styles from "./AccessWorkspace.module.css";
import { SoftSelect } from "./SoftSelect";
import { CompactListCard } from "./design-system";

type Branch = { id: string; name: string; kind: string; status: string };
type User = {
  id: string;
  employeeId?: string;
  displayName: string;
  contact: string;
  contactType: string;
  role: string;
  isAdministrative: boolean;
  status: string;
  invitationStatus: string;
  accessVersion: number;
  updatedAt: string;
  hasAccess?: boolean;
  unit?: string;
  position?: string;
  employeeBranchIds?: string[];
};
type SystemGrant = { userId: string; systemId: string; role: string; status: string; lastSyncStatus: string; lastSyncedAt: string };
type FamilyMember = { id: string; displayName: string; entityType: string; relation: string; phone: string; email: string };
type Family = { id: string; displayName: string; status: string; sourceSystem: string; dataQuality: string; scope: string; members: FamilyMember[] };
type FamilyGrant = { id: string; familyEntityId: string; principalEntityId: string; role: string; login: string; deliveryStatus: string; status: string; accessVersion: number; lastSyncStatus: string; lastSyncedAt: string };
type AuditEvent = { id: number; actor: string; action: string; entityType: string; entityId: string; payload: string; createdAt: string };
type SyncEvent = { id: string; eventType: string; userId: string; systemId: string; status: string; lastError: string; createdAt: string };

type AccessData = {
  me: { id: string; displayName: string; role: string; isAdministrative: boolean; contact: string };
  branches: Branch[];
  users: User[];
  grants: Array<{ userId: string; branchId: string; accessLevel: string }>;
  systems: Array<{ id: string; name: string; description: string; status: string }>;
  systemGrants: SystemGrant[];
  familyDirectory: Family[];
  familyAccessGrants: FamilyGrant[];
  systemRoleOptions: Record<string, Array<{ value: string; label: string }>>;
  syncEvents: SyncEvent[];
  accessHistory: AuditEvent[];
  canManage: boolean;
};

const tabs = ["Пользователи", "Семьи и ученики", "Роли и права", "Журнал"] as const;
type Tab = typeof tabs[number];

const staffRoles = ASSIGNABLE_APP_ROLES;
const permissionDomains = moduleCatalog.map(({ id, label }) => [id, label] as const);
const roleTemplates = APP_ROLE_DEFINITIONS.map((definition) => ({
  name: definition.appRole,
  description: definition.description,
  scope: definition.scope,
  permissions: Object.fromEntries(
    permissionDomains.map(([moduleId]) => [moduleId, permissionForRole(definition.apiRole, moduleId)]),
  ) as Record<ModuleId, RolePermission>,
}));

const auditLabels: Record<string, string> = {
  "settings.user_access_saved": "Доступ сотрудника сохранён",
  "settings.user_blocked": "Доступ сотрудника заблокирован",
  "settings.user_restored": "Доступ сотрудника восстановлен",
  "settings.user_password_reset": "Пароль сотрудника сброшен",
  "settings.family_access_granted": "Доступ семье выдан",
  "settings.family_access_block_access": "Доступ семье приостановлен",
  "settings.family_access_restore_access": "Доступ семье восстановлен",
  "settings.family_access_reset_password": "Пароль семьи сброшен",
  "settings.family_access_revoke_access": "Доступ семье отозван",
};

export function AccessWorkspace({ notify }: { role: string; notify: (value: string) => void }) {
  const [data, setData] = useState<AccessData | null>(null);
  const [tab, setTab] = useState<Tab>("Пользователи");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Все статусы");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userForm, setUserForm] = useState<User | null>(null);
  const [selectedRole, setSelectedRole] = useState("Собственник");
  const [familyDialog, setFamilyDialog] = useState<{ family: Family; member: FamilyMember } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "block" | "restore" | "reset"; user: User } | null>(null);
  const [credentialLink, setCredentialLink] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const payload = await response.json() as AccessData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Раздел доступов недоступен");
      setData(payload);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Раздел доступов недоступен");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedUser(null); setUserForm(null); setFamilyDialog(null); setConfirm(null); setCredentialLink("");
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  async function action(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string; message?: string; activationLink?: string };
      if (!response.ok) throw new Error(payload.error ?? "Действие не выполнено");
      if (payload.activationLink) setCredentialLink(payload.activationLink);
      notify(payload.message ?? "Изменения сохранены");
      await load();
      return true;
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Действие не выполнено");
      return false;
    } finally {
      setBusy("");
    }
  }

  const branchNames = useMemo(() => Object.fromEntries((data?.branches ?? []).map((branch) => [branch.id, branch.name])), [data]);
  const systemNames = useMemo(() => Object.fromEntries((data?.systems ?? []).map((system) => [system.id, system.name])), [data]);
  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (data?.users ?? []).filter((user) => {
      const statusMatch = status === "Все статусы" || (status === "Активные" ? user.hasAccess && user.status === "Активен" : status === "Ожидают" ? !user.hasAccess || user.invitationStatus.includes("Ожидает") || user.invitationStatus.includes("Требуется") : user.hasAccess && user.status !== "Активен");
      const searchMatch = !normalized || `${user.displayName} ${user.contact} ${user.role}`.toLowerCase().includes(normalized);
      return statusMatch && searchMatch;
    });
  }, [data, query, status]);
  const metrics = useMemo(() => {
    const users = data?.users ?? [];
    const grants = data?.systemGrants ?? [];
    return {
      active: users.filter((user) => user.hasAccess && user.status === "Активен").length,
      waiting: users.filter((user) => !user.hasAccess || user.invitationStatus.includes("Ожидает") || user.invitationStatus.includes("Требуется")).length,
      blocked: users.filter((user) => user.hasAccess && user.status !== "Активен").length,
      attention: grants.filter((grant) => grant.lastSyncStatus.includes("Ошибка") || grant.lastSyncStatus.includes("Ожидает")).length,
    };
  }, [data]);

  if (loading) return <section className={styles.state}><span /><strong>Собираем карту доступов…</strong><small>Пользователи, филиалы, системы и семейные кабинеты</small></section>;
  if (error || !data) return <section className={styles.state}><strong>{error || "Данные недоступны"}</strong><button onClick={() => void load()}>Повторить</button></section>;

  const roleTemplate = roleTemplates.find((item) => item.name === selectedRole) ?? roleTemplates[0];

  return <section className={styles.workspace}>
    <header className={styles.hero}>
      <div><p>Люди · роли · границы</p><h1>Доступы</h1><span>Кто входит в систему, какие данные видит и что может изменять.</span></div>
      {data.canManage ? <button className={styles.primary} onClick={() => { const employee = data.users.find((user) => !user.hasAccess && user.employeeId); if (employee) setUserForm(employee); else setTab("Пользователи"); }}>+ Выдать доступ</button> : <span className={styles.readOnly}>Только просмотр</span>}
    </header>

    <div className={styles.boundary}><span>Рабочий контур доступа</span><p>Права проверяются сервером при каждом запросе. Изменение роли, филиалов или систем сохраняется в журнале действий.</p></div>
    <div className={styles.setupGrid}>
      <CompactListCard index="01" title="Вход в ArtHello OS" description="Пользователь входит по выданному логину и личному паролю. Временный пароль требуется сменить при первом входе." />
      <CompactListCard index="02" title="Синхронизация дневника" description="Подключается отдельно после настройки защищённого обмена между системами." />
      <CompactListCard index="03" title="Доставка приглашений" description="До подключения Email или SMS администратор один раз копирует временные данные входа и передаёт их по защищённому каналу." />
    </div>

    <div className={styles.metrics}>
      <button onClick={() => { setStatus("Активные"); setTab("Пользователи"); }}><span>Активные</span><strong>{metrics.active}</strong><small>могут войти</small></button>
      <button onClick={() => { setStatus("Ожидают"); setTab("Пользователи"); }}><span>Ожидают</span><strong>{metrics.waiting}</strong><small>первый вход или пароль</small></button>
      <button onClick={() => { setStatus("Заблокированные"); setTab("Пользователи"); }}><span>Заблокированы</span><strong>{metrics.blocked}</strong><small>вход закрыт</small></button>
      <button className={metrics.attention ? styles.warn : ""} onClick={() => setTab("Журнал")}><span>Нужна проверка</span><strong>{metrics.attention}</strong><small>синхронизация систем</small></button>
    </div>

    <nav className={styles.tabs} aria-label="Разделы доступов">{tabs.map((item) => <button key={item} className={tab === item ? styles.active : ""} onClick={() => setTab(item)}>{item}{item === "Семьи и ученики" ? <b>{data.familyAccessGrants.length}</b> : null}</button>)}</nav>

    {tab === "Пользователи" ? <div className={styles.surface}>
      <div className={styles.toolbar}>
        <label><span className="sr-only">Поиск пользователей</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти по имени, роли или контакту" /></label>
        <SoftSelect ariaLabel="Фильтр по статусу" value={status} onChange={setStatus} options={["Все статусы", "Активные", "Ожидают", "Заблокированные"].map((item) => ({ value: item, label: item }))} />
        <span>{filteredUsers.length} из {data.users.length}</span>
      </div>
      {filteredUsers.length ? <div className={styles.userTable}>
        <div className={styles.tableHead}><span>Пользователь</span><span>Роль</span><span>Филиалы</span><span>Системы</span><span>Статус</span></div>
        {filteredUsers.map((user) => {
          const branches = user.isAdministrative ? ["Все филиалы"] : data.grants.filter((grant) => grant.userId === user.id).map((grant) => branchNames[grant.branchId]).filter(Boolean);
          const systems = data.systemGrants.filter((grant) => grant.userId === user.id);
          return <button data-ah-compact-card="true" className={styles.userRow} key={user.id} onClick={() => setSelectedUser(user)}>
            <span className={styles.identity}><i>{initials(user.displayName)}</i><span><strong>{user.displayName}</strong><small>{user.contact}</small></span></span>
            <span><strong>{user.position || user.role}</strong><small>{user.unit || (user.isAdministrative ? "Административный контур" : "Рабочая роль")}</small></span>
            <span><strong>{branches.slice(0, 2).join(", ") || "Не назначены"}</strong><small>{branches.length > 2 ? `ещё ${branches.length - 2}` : "область работы"}</small></span>
            <span><strong>{systems.map((grant) => systemNames[grant.systemId] ?? grant.systemId).join(", ") || "Не назначены"}</strong><small>{systems.map((grant) => grant.role).join(" · ")}</small></span>
            <span><b className={user.hasAccess && user.status === "Активен" ? styles.good : user.hasAccess ? styles.bad : styles.neutral}>{user.hasAccess ? user.status === "Активен" ? user.invitationStatus : "Заблокирован" : "Доступ не выдан"}</b><small>{user.hasAccess ? `версия прав ${user.accessVersion}` : "из раздела «Команда»"}</small></span>
          </button>;
        })}
      </div> : <Empty title="Пользователи не найдены" text="Измените запрос или фильтр. Нового пользователя можно добавить кнопкой «Выдать доступ»." />}
    </div> : null}

    {tab === "Семьи и ученики" ? <div className={styles.familyGrid}>
      <div className={styles.sectionIntro}><div><p>Личные кабинеты</p><h2>Доступ семьи к дневнику</h2></div><span>Родитель видит только связанных с ним детей. Ученик — только собственный учебный контур.</span></div>
      {data.familyDirectory.length ? data.familyDirectory.map((family) => <article className={styles.familyCard} key={family.id}>
        <header><div><strong>{family.displayName}</strong><small>{family.id} · {family.scope}</small></div><em>{familyAccessState(family)}</em></header>
        {family.members.map((member) => {
          const grant = data.familyAccessGrants.find((item) => item.principalEntityId === member.id);
          return <div data-ah-compact-card="true" className={styles.familyMember} key={member.id}>
            <span className={styles.identity}><i>{initials(member.displayName)}</i><span><strong>{member.displayName}</strong><small>{member.entityType === "Ребёнок" ? "Ученик" : "Родитель"} · {member.relation}</small></span></span>
            <span><strong>{grant?.login || member.phone || member.email || "Контакт не указан"}</strong><small>{grant ? `версия прав ${grant.accessVersion}` : "доступ ещё не выдавался"}</small></span>
            <span><b className={grant?.status === "Активен" ? styles.good : grant ? styles.bad : styles.neutral}>{grant?.status ?? "Не выдан"}</b><small>{grant?.lastSyncStatus ?? "—"}</small></span>
            {data.canManage ? <div className={styles.inlineActions}>
              <button disabled={familyAccessNeedsReview(family)} onClick={() => setFamilyDialog({ family, member })}>{familyAccessNeedsReview(family) ? "Сначала сверить источник" : grant ? "Изменить" : "Выдать"}</button>
              {grant ? <button onClick={() => void action({ action: grant.status === "Приостановлен" ? "restoreFamilyAccess" : "blockFamilyAccess", grantId: grant.id }, `family-${grant.id}`)} disabled={busy === `family-${grant.id}`}>{grant.status === "Приостановлен" ? "Восстановить" : "Приостановить"}</button> : null}
            </div> : null}
          </div>;
        })}
      </article>) : <Empty title="Семьи ещё не добавлены" text="После появления карточек семей здесь можно будет выдать родителям и ученикам персональный вход." />}
    </div> : null}

    {tab === "Роли и права" ? <div className={styles.rolesLayout}>
      <aside className={styles.roleList}><header><p>Шаблоны ролей</p><h2>{roleTemplates.length}</h2></header>{roleTemplates.map((item) => <button data-ah-compact-card="true" key={item.name} className={selectedRole === item.name ? styles.selectedRole : ""} onClick={() => setSelectedRole(item.name)}><strong>{item.name}</strong><small>{item.scope}</small></button>)}</aside>
      <article className={styles.permissionCard}>
        <header><div><p>Матрица прав</p><h2>{roleTemplate.name}</h2><span>{roleTemplate.description}</span></div><b>{roleTemplate.scope}</b></header>
        <div data-ah-compact-card="true" className={styles.permissionList}>{permissionDomains.map(([key, label]) => <div key={key}><span><strong>{label}</strong><small>{permissionHint(key)}</small></span><b className={permissionClass(roleTemplate.permissions[key], styles)}>{roleTemplate.permissions[key]}</b></div>)}</div>
        <footer><strong>Правило безопасности</strong><span>Скрытие кнопки — только визуальная часть. Каждое чтение и изменение обязано повторно проверяться на сервере.</span></footer>
      </article>
    </div> : null}

    {tab === "Журнал" ? <div className={styles.historyLayout}>
      <article className={styles.historyCard}><header><div><p>Действия</p><h2>История доступов</h2></div><span>{data.accessHistory.length}</span></header>{data.accessHistory.length ? <div data-ah-compact-card="true" className={styles.timeline}>{data.accessHistory.map((event) => <div key={event.id}><i /><span><strong>{auditLabels[event.action] ?? event.action}</strong><small>{event.entityId} · {event.actor}</small></span><time>{formatDate(event.createdAt)}</time></div>)}</div> : <Empty title="История пока пуста" text="Выдача, изменение, блокировка и восстановление появятся здесь автоматически." />}</article>
      <article className={styles.historyCard}><header><div><p>Системы</p><h2>Синхронизация</h2></div><span>{data.syncEvents.length}</span></header>{data.syncEvents.length ? <div data-ah-compact-card="true" className={styles.timeline}>{data.syncEvents.map((event) => <div key={event.id}><i className={event.status.includes("Ошибка") ? styles.errorDot : ""} /><span><strong>{event.eventType} · {systemNames[event.systemId] ?? event.systemId}</strong><small>{event.userId}{event.lastError ? ` · ${event.lastError}` : ""}</small></span><time>{formatDate(event.createdAt)}</time></div>)}</div> : <Empty title="Событий синхронизации нет" text="Подключённые системы ещё не получали изменений доступа." />}</article>
    </div> : null}

    {selectedUser ? <Modal title="Карточка доступа" subtitle={selectedUser.displayName} close={() => setSelectedUser(null)}>
      <div className={styles.profileHead}><i>{initials(selectedUser.displayName)}</i><div><h3>{selectedUser.displayName}</h3><p>{selectedUser.contact}</p></div><b className={selectedUser.status === "Активен" ? styles.good : styles.bad}>{selectedUser.status}</b></div>
      <dl className={styles.profileFacts}><div><dt>Роль</dt><dd>{selectedUser.role}</dd></div><div><dt>Филиалы</dt><dd>{selectedUser.isAdministrative ? "Все филиалы" : data.grants.filter((grant) => grant.userId === selectedUser.id).map((grant) => branchNames[grant.branchId]).join(", ") || "Не назначены"}</dd></div><div><dt>Системы</dt><dd>{data.systemGrants.filter((grant) => grant.userId === selectedUser.id).map((grant) => `${systemNames[grant.systemId] ?? grant.systemId} · ${grant.role}`).join(", ") || "Не назначены"}</dd></div><div><dt>Состояние входа</dt><dd>{selectedUser.invitationStatus}</dd></div><div><dt>Дневник</dt><dd>{syncLabel(data.systemGrants.find((grant)=>grant.userId===selectedUser.id&&grant.systemId==="SYS-SCHOOL-1-11")?.lastSyncStatus)}</dd></div></dl>
      {data.canManage && selectedUser.id !== data.me.id ? <div className={styles.modalActions}><button className={styles.primary} onClick={() => { setUserForm(selectedUser); setSelectedUser(null); }}>{selectedUser.hasAccess ? "Изменить доступ" : "Выдать доступ"}</button>{selectedUser.hasAccess ? <><button onClick={() => setConfirm({ kind: "reset", user: selectedUser })}>Сбросить пароль</button><button className={selectedUser.status === "Активен" ? styles.danger : ""} onClick={() => setConfirm({ kind: selectedUser.status === "Активен" ? "block" : "restore", user: selectedUser })}>{selectedUser.status === "Активен" ? "Заблокировать" : "Восстановить"}</button></> : null}</div> : null}
    </Modal> : null}

    {userForm ? <UserAccessModal data={data} user={userForm} busy={busy} close={() => setUserForm(null)} submit={async (body) => { const ok = await action(body, "save-user"); if (ok) setUserForm(null); }} /> : null}

    {familyDialog ? <FamilyAccessModal family={familyDialog.family} member={familyDialog.member} grant={data.familyAccessGrants.find((item) => item.principalEntityId === familyDialog.member.id)} busy={busy} close={() => setFamilyDialog(null)} submit={async (body) => { const ok = await action(body, "save-family"); if (ok) setFamilyDialog(null); }} /> : null}

    {confirm ? <Modal title={confirm.kind === "block" ? "Заблокировать доступ?" : confirm.kind === "restore" ? "Восстановить доступ?" : "Сбросить пароль?"} subtitle={confirm.user.displayName} close={() => setConfirm(null)}>
      <p className={styles.confirmText}>{confirm.kind === "block" ? "Пользователь сразу потеряет доступ ко всем назначенным системам. История и связанные записи сохранятся." : confirm.kind === "restore" ? "Пользователь снова сможет войти в назначенные системы с прежним набором прав." : "Текущая ссылка активации перестанет действовать. Будет создана новая одноразовая ссылка."}</p>
      <div className={styles.modalActions}><button onClick={() => setConfirm(null)}>Отмена</button><button className={confirm.kind === "block" ? styles.danger : styles.primary} disabled={busy === "confirm"} onClick={async () => { const actionName = confirm.kind === "block" ? "blockUser" : confirm.kind === "restore" ? "restoreUser" : "resetPassword"; const ok = await action({ action: actionName, userId: confirm.user.id, employeeId: confirm.user.employeeId }, "confirm"); if (ok) { setConfirm(null); setSelectedUser(null); } }}>{busy === "confirm" ? "Выполняем…" : "Подтвердить"}</button></div>
    </Modal> : null}

    {credentialLink ? <Modal title="Одноразовая ссылка готова" subtitle="Первый вход или создание нового пароля" close={() => setCredentialLink("")}><p className={styles.confirmText}>Передайте ссылку человеку безопасным каналом. Новый сброс аннулирует предыдущую ссылку.</p><label className={styles.linkField}><span>Ссылка активации</span><input readOnly value={credentialLink} onFocus={(event) => event.currentTarget.select()} /></label><div className={styles.modalActions}><button onClick={() => setCredentialLink("")}>Закрыть</button><button className={styles.primary} onClick={() => void navigator.clipboard.writeText(credentialLink)}>Скопировать</button></div></Modal> : null}
  </section>;
}

function UserAccessModal({ data, user, busy, close, submit }: { data: AccessData; user: User; busy: string; close: () => void; submit: (body: Record<string, unknown>) => Promise<void> }) {
  const systemGrants = data.systemGrants.filter((grant) => grant.userId === user.id);
  const branchIds = new Set(data.grants.filter((grant) => grant.userId === user.id).map((grant) => grant.branchId));
  const employeeBranchIds = new Set(user.employeeBranchIds ?? []);
  const systemIds = new Set(systemGrants.map((grant) => grant.systemId));
  const diaryGrant = systemGrants.find((grant) => grant.systemId === "SYS-SCHOOL-1-11");
  const [administrative, setAdministrative] = useState(user.isAdministrative);
  const [diary, setDiary] = useState(systemIds.has("SYS-SCHOOL-1-11"));
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void submit({ action: "inviteUser", employeeId: user.employeeId, displayName: user.displayName, contact: form.get("contact"), role: form.get("role"), isAdministrative: form.get("isAdministrative") === "on", branchIds: form.getAll("branchIds"), systemIds: form.getAll("systemIds"), diaryRole: form.get("diaryRole") });
  }
  return <Modal title={user.hasAccess ? "Изменить доступ" : "Выдать доступ"} subtitle={user.displayName} close={close} wide>
    <form className={styles.accessForm} onSubmit={save}>
      <div className={styles.formGrid}><label><span>Сотрудник из «Команды»</span><input value={user.displayName} readOnly /></label><label><span>Логин из карточки сотрудника</span><input name="contact" value={user.contact} readOnly required /><small>Телефон или email изменяется только в «Команда → Сотрудники».</small></label></div>
      <label><span>Основная роль</span><SoftSelect name="role" ariaLabel="Основная роль" defaultValue={user.role ?? "Сотрудник"} options={staffRoles.map((role) => ({ value: role, label: role }))} /><small>Роль задаёт базовый набор разделов. Филиалы и системы уточняют область доступа.</small></label>
      <label className={styles.checkLine}><input type="checkbox" name="isAdministrative" checked={administrative} onChange={(event) => setAdministrative(event.target.checked)} /><span><strong>Административный контур</strong><small>Доступ ко всем действующим филиалам. Использовать только для руководителей.</small></span></label>
      <fieldset disabled={administrative}><legend>Филиалы из карточки сотрудника</legend><div className={styles.choiceGrid}>{data.branches.map((branch) => {const belongs=employeeBranchIds.has(branch.id);return <label key={branch.id}><input type="checkbox" name="branchIds" value={branch.id} disabled={!belongs} defaultChecked={user.hasAccess?branchIds.has(branch.id):belongs} /><span><strong>{branch.name}</strong><small>{belongs?branch.kind:"Не назначен сотруднику"}</small></span></label>})}</div><small>Доступ можно сузить. Новый филиал сначала добавляется в основной карточке сотрудника.</small></fieldset>
      <fieldset><legend>Системы</legend><div className={styles.choiceGrid}>{data.systems.map((system) => <label key={system.id}><input type="checkbox" name="systemIds" value={system.id} defaultChecked={user.hasAccess ? systemIds.has(system.id) : system.id === "SYS-ARTHELLO-OS"} onChange={system.id === "SYS-SCHOOL-1-11" ? (event) => setDiary(event.target.checked) : undefined} /><span><strong>{system.name}</strong><small>{system.description}</small></span></label>)}</div></fieldset>
      {diary ? <label><span>Роль в дневнике 1–11</span><SoftSelect name="diaryRole" ariaLabel="Роль в дневнике 1–11" defaultValue={diaryGrant?.role ?? "teacher"} options={data.systemRoleOptions["SYS-SCHOOL-1-11"] ?? []} /><small>Классы, группы и предметы назначаются отдельно в учебном контуре.</small></label> : <input type="hidden" name="diaryRole" value="teacher" />}
      <div className={styles.modalActions}><button type="button" onClick={close}>Отмена</button><button className={styles.primary} disabled={busy === "save-user"}>{busy === "save-user" ? "Сохраняем…" : user.hasAccess ? "Сохранить изменения" : "Подтвердить и выдать доступ"}</button></div>
    </form>
  </Modal>;
}

function FamilyAccessModal({ family, member, grant, busy, close, submit }: { family: Family; member: FamilyMember; grant?: FamilyGrant; busy: string; close: () => void; submit: (body: Record<string, unknown>) => Promise<void> }) {
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void submit({ action: "grantFamilyAccess", familyEntityId: family.id, principalEntityId: member.id, role: member.entityType === "Ребёнок" ? "student" : "parent", login: form.get("login") });
  }
  return <Modal title={grant ? "Изменить доступ" : "Выдать доступ"} subtitle={`${family.displayName} · ${member.displayName}`} close={close}>
    <form className={styles.accessForm} onSubmit={save}><div className={styles.profileHead}><i>{initials(member.displayName)}</i><div><h3>{member.displayName}</h3><p>{member.entityType === "Ребёнок" ? "Ученик" : "Родитель / представитель"}</p></div></div><label><span>Логин и канал активации</span><input name="login" required defaultValue={grant?.login || member.phone || member.email} placeholder="+7… или name@example.ru" /><small>На телефон отправляется SMS, на email — письмо. Пароль пользователь создаёт сам.</small></label><div className={styles.modalActions}><button type="button" onClick={close}>Отмена</button><button className={styles.primary} disabled={busy === "save-family"}>{busy === "save-family" ? "Сохраняем…" : "Сохранить и отправить"}</button></div></form>
  </Modal>;
}

function Modal({ title, subtitle, close, wide = false, children }: { title: string; subtitle: string; close: () => void; wide?: boolean; children: ReactNode }) {
  return createPortal(<div className={styles.modalLayer}><button className={styles.scrim} onClick={close} aria-label="Закрыть окно" /><section className={`${styles.modal} ${wide ? styles.modalWide : ""}`} role="dialog" aria-modal="true" aria-label={title}><header><div><p>{subtitle}</p><h2>{title}</h2></div><button onClick={close} aria-label="Закрыть">×</button></header><div className={styles.modalBody}>{children}</div></section></div>, document.body);
}

function Empty({ title, text }: { title: string; text: string }) { return <div className={styles.empty}><span>＋</span><strong>{title}</strong><p>{text}</p></div>; }
function initials(value: string) { return value.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date); }
function syncLabel(value?:string){return !value?"Не назначен":value==="Ожидает синхронизации"||value==="Ожидает подключения"?"Дневник ещё не подключён — права сохранены только в ArtHello OS":value}
function familyAccessState(family:Pick<Family,"sourceSystem"|"dataQuality">){return family.sourceSystem==="MANUAL"&&family.dataQuality!=="Требует сверки"?"Создано вручную":family.dataQuality}
function familyAccessNeedsReview(family:Pick<Family,"sourceSystem"|"dataQuality">){return family.dataQuality==="Требует сверки"||family.dataQuality==="На проверке"||(family.sourceSystem!=="MANUAL"&&family.dataQuality!=="Проверено")}
function permissionHint(key: string) { return ({ home: "Персональный обзор и доступные действия", tasks: "Задачи, процессы и календарь", finance: "Платежи, начисления, ДДС и ОПиУ", accounting: "Бухгалтерские документы и 1С", registry: "Единые карточки и связи", sales: "Воронка и оплаты", clients: "Семьи, ученики и коммуникации", education: "Занятия, оценки и программы", methods: "Методики и учебные материалы", hr: "Сотрудники, ставки и кадровые события", legal: "Договоры, версии и обязательства", procurement: "Закупки и поставщики", food: "Меню, производство и экономика", safety: "Риски и меры безопасности", medical: "Чувствительные медицинские сведения", content: "Контент-план и материалы", events: "Общие рабочие события", projects: "Проекты и KPI", analytics: "Подтверждённые показатели и аналитика", contractors: "Подрядчики и связанные документы", assets: "Имущество и обслуживание", quality: "Готовность и контроль качества", access: "Пользователи, роли и отзыв доступа", integrations: "Подключения и журнал обмена", acceptance: "Приёмочные сценарии и готовность" } as Record<string, string>)[key] ?? ""; }
function permissionClass(permission: RolePermission, css: typeof styles) { return permission === "Управление" ? css.manage : permission === "Редактирование" ? css.edit : permission === "Просмотр" ? css.view : permission === "Особый доступ" ? css.special : css.none; }
