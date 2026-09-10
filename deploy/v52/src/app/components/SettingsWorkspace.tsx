"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { moduleCatalog, type ModuleId } from "../../data/test-snapshot";
import { API_ROLE_BY_APP_ROLE, APP_ROLE_DEFINITIONS, canAccessModule, permissionForRole } from "../../lib/access-policy";
import { recordLabel } from "../../lib/record-labels";
import { IntegrationWorkspace } from "./IntegrationWorkspace";
import { ReadinessWorkspace } from "./ReadinessWorkspace";
import { BackupWorkspace } from "./BackupWorkspace";
import { SoftSelect } from "./SoftSelect";
import { Button, EmptyState, Tabs } from "./design-system";
import "./SettingsWorkspace.ds.css";

export type Branch = { id: string; name: string; kind: string; status: string };
export type AccessContext = {
  me: { id: string; displayName: string; role: string; isAdministrative: boolean; contact: string; accessVersion: number; updatedAt: string; allowedModules?: ModuleId[]; favoriteModules?: ModuleId[] };
  branches: Branch[];
  access: Array<{ branchId: string; accessLevel: string }>;
};

type SettingsUser = { id: string; employeeId?: string; displayName: string; contact: string; contactType: string; role: string; jobTitle?: string; allowedModules?: ModuleId[]; favoriteModules?: ModuleId[]; isAdministrative: boolean; status: string; invitationStatus: string; accessVersion: number; hasAccess?: boolean; source?: string; unit?: string; position?: string; employeeBranchIds?: string[]; dataQuality?: string };
type TemporaryCredential = {
  userId: string;
  displayName: string;
  login: string;
  temporaryPassword: string;
  expiresAt: string;
  mustChangePassword: true;
};
type SettingsData = AccessContext & {
  users: SettingsUser[];
  grants: Array<{ userId: string; branchId: string }>;
  systems: Array<{ id: string; systemKey: string; name: string; description: string; status: string }>;
  systemGrants: Array<{ userId: string; systemId: string; role: string; status: string; lastSyncStatus: string; lastSyncedAt: string }>;
  syncEvents: Array<{ id: string; eventType: string; userId: string; systemId: string; status: string; attempts: number; createdAt: string; updatedAt: string }>;
  familyDirectory: Array<{ id: string; displayName: string; status: string; sourceSystem: string; sourceRecordId: string; dataQuality: string; scope: string; members: Array<{ id: string; displayName: string; entityType: string; relation: string; sourceSystem: string; sourceRecordId: string; scope: string; phone: string; email: string }> }>;
  familyAccessGrants: Array<{ id: string; familyEntityId: string; principalEntityId: string; principalType: string; role: string; loginType: string; login: string; deliveryChannel: string; deliveryStatus: string; status: string; accessVersion: number; lastSyncStatus: string; lastSyncedAt: string }>;
  systemRoleOptions: Record<string, Array<{ value: string; label: string }>>;
  canManage: boolean;
  authBoundary: string;
};

export const settingsTabs = ["Филиалы", "Доступы", "Семьи", "Избранное", "Интеграции", "Проверка системы", "Резервные копии"] as const;
export type SettingsTab = typeof settingsTabs[number];
const roles = APP_ROLE_DEFINITIONS.filter((definition) => definition.apiRole !== "OWNER").map((definition) => definition.appRole);
const assignableModules = moduleCatalog.filter((module) => module.id !== "home" && module.id !== "access");

export function SettingsWorkspace({ close, notify, onContextChanged, initialTab = "Филиалы", onTasksChanged = () => undefined, onFavoritesChanged = () => undefined }: { close: () => void; notify: (value: string) => void; onContextChanged: (value: AccessContext) => void; initialTab?: SettingsTab; onTasksChanged?: () => void | Promise<void>; onFavoritesChanged?: (value: ModuleId[]) => void }) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [credentialLink, setCredentialLink] = useState("");
  const [accessEmployeeId, setAccessEmployeeId] = useState("");
  const [temporaryCredential, setTemporaryCredential] = useState<TemporaryCredential | null>(null);
  const [ownerDiaryOpen, setOwnerDiaryOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const payload = await response.json() as SettingsData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Настройки недоступны");
      setData(payload);
      onContextChanged(payload);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Настройки недоступны");
    } finally { setLoading(false); }
  }, [onContextChanged]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (temporaryCredential) setTemporaryCredential(null);
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, temporaryCredential]);

  async function action(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": readClientCookie("__Host-arthello_csrf") }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string; message?: string; activationLink?: string };
      if (!response.ok) throw new Error(payload.error ?? "Действие не выполнено");
      if (payload.activationLink) setCredentialLink(payload.activationLink);
      notify(payload.message ?? "Сохранено");
      await load();
      return payload;
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Действие не выполнено"); }
    finally { setBusy(""); }
    return null;
  }

  async function issueTemporaryCredential(user: SettingsUser) {
    const key = `temporary-${user.id}`;
    setBusy(key);
    setTemporaryCredential(null);
    try {
      const response = await fetch("/api/settings/temporary-credential", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": readClientCookie("__Host-arthello_csrf"),
        },
        body: JSON.stringify({ userId: user.id }),
      });
      const payload = await response.json() as TemporaryCredential & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось создать временный вход");
      setTemporaryCredential(payload);
      notify("Временный вход создан. Сохраните данные до закрытия окна.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Не удалось создать временный вход");
    } finally {
      setBusy("");
    }
  }

  async function copyCredential(value: string, label: string) {
    const copied = copyTextSynchronously(value) || await copyTextWithClipboardApi(value);
    notify(copied ? `${label} скопирован` : "Не удалось скопировать. Нажмите на поле и выберите «Скопировать».");
    return copied;
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selected = data?.users.find((user) => user.id === accessEmployeeId);
    if (!selected) { notify("Сначала выберите сотрудника"); return; }
    void action({
      action: "inviteUser",
      employeeId: selected.employeeId,
      displayName: selected.displayName,
      contact: form.get("contact"),
      position: form.get("position"),
      role: form.get("role"),
      allowedModules: form.getAll("allowedModules"),
      isAdministrative: form.get("isAdministrative") === "on",
      branchIds: form.getAll("branchIds"),
      systemIds: form.getAll("systemIds"),
      diaryRole: form.get("diaryRole"),
      expectedAccessVersion: selected.accessVersion,
    }, "invite");
  }

  function familyAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const principalId = String(form.get("principalEntityId") ?? "");
    void action({
      action: "grantFamilyAccess",
      familyEntityId: form.get("familyEntityId"),
      principalEntityId: principalId,
      role: form.get("role"),
      login: form.get("login"),
      expectedAccessVersion: Number(form.get("expectedAccessVersion") ?? 0),
    }, `family-${principalId}`);
  }

  const branchNames = useMemo(() => Object.fromEntries((data?.branches ?? []).map((branch) => [branch.id, branch.name])), [data]);
  const systemNames = useMemo(() => Object.fromEntries((data?.systems ?? []).map((system) => [system.id, system.name])), [data]);

  return <div className="ahSettingsLayer">
    <button className="drawer-scrim" onClick={close} aria-label="Закрыть настройки" />
    <section className="ahSettingsModal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="settings-head"><div><p>Управление системой</p><h2 id="settings-title">Настройки</h2><span>Филиалы, доступы, личное меню, интеграции и проверка системы</span></div><button onClick={close} aria-label="Закрыть">×</button></header>
      {loading ? <EmptyState className="ahSettingsState" density="compact" title="Загружаем настройки" description="Проверяем права, филиалы и доступные системы." /> : error || !data ? <EmptyState className="ahSettingsState" density="compact" title={error || "Настройки недоступны"} description="Рабочие права и филиалы не заменены заглушкой." action={<Button variant="secondary" onClick={() => void load()}>Повторить</Button>} /> : <>
        <div className="ahSettingsTabs"><Tabs items={settingsTabs.filter((item) => item !== "Резервные копии" || (data.me.id === "USR-OWNER" && data.me.role === "Собственник" && data.me.isAdministrative)).map((item) => ({ id: item, label: item }))} value={tab} onChange={setTab} ariaLabel="Разделы настроек" /></div>
        <div className="settings-body">
          {tab === "Резервные копии" && data.me.id === "USR-OWNER" && data.me.role === "Собственник" && data.me.isAdministrative ? <BackupWorkspace notify={notify} /> : null}
          {tab === "Филиалы" ? <div className="settings-grid">
            <article className="settings-card wide"><header><div><p>Рабочие контуры</p><h3>Филиалы</h3></div><span>{data.branches.length}</span></header><div className="branch-list">{data.branches.map((branch) => <div key={branch.id}><span aria-hidden="true">⌂</span><div><strong>{branch.name}</strong><small>{branch.kind} · {branch.status}</small></div><em>{data.me.isAdministrative ? "Доступен" : data.access.some((item) => item.branchId === branch.id) ? "Назначен" : "Нет доступа"}</em></div>)}</div></article>
            <article className="settings-card"><header><div><p>Текущий пользователь</p><h3>{data.me.displayName}</h3></div></header><dl><div><dt>Роль</dt><dd>{data.me.role}</dd></div><div><dt>Контур</dt><dd>{data.me.isAdministrative ? "Административный корпус · все филиалы" : `${data.access.length} филиал(а)`}</dd></div><div><dt>Вход</dt><dd>{data.me.contact}</dd></div></dl></article>
            {data.canManage ? <form className="settings-card settings-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void action({ action: "createBranch", name: form.get("name"), kind: form.get("kind") }, "branch"); event.currentTarget.reset(); }}><header><div><p>Структура</p><h3>Добавить филиал</h3></div></header><label><span>Название</span><input name="name" required placeholder="Новый филиал" /></label><label><span>Тип</span><SoftSelect name="kind" ariaLabel="Тип филиала" defaultValue="Школа" options={["Школа", "Детский сад", "Дополнительное образование", "Филиал"].map((item) => ({ value: item, label: item }))} /></label><button disabled={busy === "branch"}>{busy === "branch" ? "Сохраняем…" : "Добавить филиал"}</button></form> : null}
          </div> : null}

          {tab === "Доступы" ? <div className="settings-grid users-grid access-users-full">
            <article className="settings-card wide">
              <header><div><p>Только управление входом</p><h3>Сотрудники из раздела «Команда»</h3></div><span>{data.users.length}</span></header>
              <div className="user-list">{data.users.map((user) => {
                const granted = data.grants.filter((grant) => grant.userId === user.id).map((grant) => branchNames[grant.branchId]).filter(Boolean);
                const assignedSystems = data.systemGrants.filter((grant) => grant.userId === user.id);
                const diaryGrant = assignedSystems.find((grant) => grant.systemId === "SYS-SCHOOL-1-11");
                return <div className="user-card-compact" data-ah-compact-card="true" key={user.id}>
                  <span className="user-avatar">{user.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
                  <div className="user-summary">
                    <div className="user-title-line"><strong>{user.displayName}</strong><small>{humanPosition(user.jobTitle || user.position, user.role)}{user.unit ? ` · ${user.unit}` : ""}</small></div>
                    <div className="user-meta-line">
                      <span>{user.contact || "Контакт не указан"}</span>
                      <span>{user.isAdministrative ? "Все филиалы" : granted.join(", ") || "Филиалы не назначены"}</span>
                      <span>{assignedSystems.map((grant) => `${systemNames[grant.systemId] ?? "Система"}: ${systemRoleLabel(data.systemRoleOptions, grant.systemId, grant.role)}`).join(" · ") || "Системы не назначены"}</span>
                      {diaryGrant ? <span>Дневник: {syncLabel(diaryGrant.lastSyncStatus)}</span> : null}
                    </div>
                  </div>
                  <b className={user.status === "Активен" ? "active" : ""}>{user.status === "Доступ приостановлен" ? "Заблокирован" : user.hasAccess ? user.invitationStatus : "Доступ не выдан"}</b>
                  {data.canManage && user.id !== data.me.id ? <div className="user-access-buttons">
                    <button className="access-configure" disabled={!user.contact} title={!user.contact ? "Сначала укажите телефон или email в карточке сотрудника" : undefined} onClick={() => { setOwnerDiaryOpen(false); setAccessEmployeeId(user.id); }}>{user.hasAccess ? "Изменить доступ" : "Выдать доступ"}</button>
                    {user.hasAccess ? <button className="temporary-access" disabled={busy === `temporary-${user.id}` || user.status !== "Активен"} title={user.status !== "Активен" ? "Сначала восстановите доступ сотрудника" : "Создать временный вход только в ArtHello OS"} onClick={() => void issueTemporaryCredential(user)}>{busy === `temporary-${user.id}` ? "Создаём…" : "Временный вход"}</button> : null}
                    {user.hasAccess && diaryGrant ? <button disabled={busy === `password-${user.id}`} onClick={() => void action({ action: "resetPassword", userId: user.id, expectedAccessVersion: user.accessVersion }, `password-${user.id}`)}>Завершить входы</button> : null}
                    {user.hasAccess ? user.status === "Доступ приостановлен"
                      ? <button disabled={busy === `restore-${user.id}`} onClick={() => void action({ action: "restoreUser", userId: user.id, employeeId: user.employeeId, expectedAccessVersion: user.accessVersion }, `restore-${user.id}`)}>Восстановить</button>
                      : <button disabled={busy === `block-${user.id}`} onClick={() => void action({ action: "blockUser", userId: user.id, employeeId: user.employeeId, expectedAccessVersion: user.accessVersion }, `block-${user.id}`)}>Заблокировать</button> : null}
                  </div> : null}
                  {data.canManage && user.id === data.me.id ? <div className="user-access-buttons owner-access-buttons">
                    <button className="access-configure" onClick={() => { setAccessEmployeeId(""); setOwnerDiaryOpen(true); }}>Настроить дневник</button>
                  </div> : null}
                </div>;
              })}</div>
            </article>
            {data.canManage && ownerDiaryOpen
              ? <OwnerDiaryAccessForm
                grant={data.systemGrants.find((grant) => grant.userId === data.me.id && grant.systemId === "SYS-SCHOOL-1-11")}
                roles={data.systemRoleOptions["SYS-SCHOOL-1-11"] ?? []}
                busy={busy === "owner-diary"}
                close={() => setOwnerDiaryOpen(false)}
                save={async (enabled, diaryRole) => {
                  const result = await action({ action: "saveOwnerDiaryAccess", enabled, diaryRole, expectedAccessVersion: data.me.accessVersion, expectedUpdatedAt: data.me.updatedAt }, "owner-diary");
                  if (result) setOwnerDiaryOpen(false);
                }}
              />
              : data.canManage && accessEmployeeId
                ? <AccessAssignmentForm key={accessEmployeeId} user={data.users.find((user) => user.id === accessEmployeeId)!} data={data} busy={busy} close={() => setAccessEmployeeId("")} submit={invite} />
                : <div className="settings-boundary access-source-boundary"><strong>Сотрудники здесь не создаются</strong><span>Добавление, импорт и исправление персональных данных выполняются в «Команда → Сотрудники». Здесь выбирается готовая карточка и отдельно подтверждаются системы, филиалы и роль доступа.</span></div>}
            {credentialLink ? <div className="settings-boundary credential-result"><strong>Одноразовая ссылка готова</strong><span>Передайте её сотруднику безопасным каналом. Повторный сброс аннулирует предыдущую.</span><input readOnly value={credentialLink} onFocus={(event) => event.currentTarget.select()} /><button type="button" onClick={() => void copyCredential(credentialLink, "Ссылка")}>Скопировать ссылку</button></div> : null}
            {data.syncEvents.some((event) => retryableSyncStatus(event.status)) ? <article className="settings-card wide">
              <header><div><p>Надёжная доставка</p><h3>Повторить синхронизацию</h3></div><span>{data.syncEvents.filter((event) => retryableSyncStatus(event.status)).length}</span></header>
              <div className="user-list">{data.syncEvents.filter((event) => retryableSyncStatus(event.status)).slice(0, 10).map((event) => <div data-ah-compact-card="true" className="user-card-compact" key={event.id}>
                <div className="user-summary"><strong>{syncEventLabel(event.eventType)}</strong><div className="user-meta-line"><span>{event.status}</span><span>{event.attempts ? `Попыток отправки: ${event.attempts}` : "Ещё не отправлялось"}</span></div></div>
                <button type="button" disabled={busy === `retry-${event.id}` || event.status === "Синхронизация выполняется"} onClick={() => void action({ action: "retryAccessSync", eventId: event.id }, `retry-${event.id}`)}>{event.status === "Синхронизация выполняется" ? "Отправляется…" : "Отправить снова"}</button>
              </div>)}</div>
            </article> : null}
            <div className="settings-boundary"><strong>Как работает вход</strong><span>{data.authBoundary}</span></div>
          </div> : null}

          {tab === "Семьи" ? <div className="settings-grid users-grid family-access-grid">
            <div className="settings-boundary family-source-boundary"><strong>Только выдача доступа</strong><span>Ручная карточка уже подтверждена её автором. Для импорта и конфликтов сначала нужна сверка источника. Сам доступ всегда выдаётся здесь отдельным действием.</span></div>
            <article className="settings-card wide">
              <header><div><p>Центральный реестр</p><h3>Карточки семей</h3></div><span>{data.familyDirectory.length}</span></header>
              {data.familyDirectory.length ? <div className="family-access-list">{data.familyDirectory.map((family) => <section key={family.id} className="family-access-card">
                <header><div><strong>{family.displayName}</strong><small>{recordLabel("Карточка семьи", family.id)} · {family.scope}</small></div><em>{familyAccessState(family)}</em></header>
                {family.members.length ? <div className="family-member-list">{family.members.map((member) => {
                  const grant = data.familyAccessGrants.find((item) => item.principalEntityId === member.id);
                  const role = member.entityType === "Ребёнок" ? "student" : "parent";
                  const defaultLogin = grant?.login || member.phone || member.email;
                  return <form key={member.id} className="family-member-access" onSubmit={familyAccess}>
                    <input type="hidden" name="familyEntityId" value={family.id} />
                    <input type="hidden" name="principalEntityId" value={member.id} />
                    <input type="hidden" name="role" value={role} />
                    <input type="hidden" name="expectedAccessVersion" value={grant?.accessVersion ?? 0} />
                    <div className="family-member-identity"><span>{member.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><div><strong>{member.displayName}</strong><small>{member.entityType === "Ребёнок" ? "Ученик" : "Родитель / представитель"} · {recordLabel("Карточка", member.id)}</small><em>{member.relation}</em></div></div>
                    <label><span>Логин и канал активации</span><input name="login" required defaultValue={defaultLogin} placeholder="+7… или name@example.ru" /><small>Телефон — SMS, email — письмо. Пароль человек создаст сам по одноразовой ссылке.</small></label>
                    <div className="family-access-state"><b className={grant?.status === "Активен" ? "active" : ""}>{grant ? grant.status : "Доступ не выдан"}</b>{grant ? <small>{syncLabel(grant.lastSyncStatus)} · {deliveryLabel(grant.deliveryStatus)}</small> : null}</div>
                    <div className="family-access-actions">
                      <button disabled={busy === `family-${member.id}` || familyAccessNeedsReview(family)}>{busy === `family-${member.id}` ? "Сохраняем…" : familyAccessNeedsReview(family) ? "Сначала сверить источник" : grant ? "Обновить и отправить" : "Выдать и отправить"}</button>
                      {grant ? <>
                        <button type="button" disabled={busy === `family-password-${grant.id}`} onClick={() => void action({ action: "resetFamilyPassword", grantId: grant.id, expectedAccessVersion: grant.accessVersion }, `family-password-${grant.id}`)}>Завершить входы</button>
                        {grant.status === "Приостановлен" ? <button type="button" disabled={busy === `family-restore-${grant.id}`} onClick={() => void action({ action: "restoreFamilyAccess", grantId: grant.id, expectedAccessVersion: grant.accessVersion }, `family-restore-${grant.id}`)}>Восстановить</button> : <button type="button" disabled={busy === `family-block-${grant.id}`} onClick={() => void action({ action: "blockFamilyAccess", grantId: grant.id, expectedAccessVersion: grant.accessVersion }, `family-block-${grant.id}`)}>Заблокировать</button>}
                      </> : null}
                    </div>
                  </form>;
                })}</div> : <div data-ah-compact-card="true" className="settings-empty"><strong>Нет связанных людей</strong><p>Сначала AlfaCRM должна передать ребёнка и представителей, а ArtHello OS — связать их со стабильной карточкой семьи.</p></div>}
              </section>)}</div> : <div data-ah-compact-card="true" className="settings-empty"><strong>Семьи ещё не синхронизированы</strong><p>Подключите AlfaCRM в разделе «Интеграции». Создавать параллельные карточки в дневнике больше не требуется.</p></div>}
            </article>
            {credentialLink ? <div className="settings-boundary credential-result"><strong>Одноразовая ссылка готова</strong><span>Ссылка предназначена для первого входа или создания нового пароля. После подключения канала она отправляется выбранному человеку по SMS или email.</span><input readOnly value={credentialLink} onFocus={(event) => event.currentTarget.select()} /><button type="button" onClick={() => void copyCredential(credentialLink, "Ссылка")}>Скопировать ссылку</button></div> : null}
            <div className="settings-boundary"><strong>Граница систем</strong><span>{data.authBoundary}</span></div>
          </div> : null}

          {tab === "Избранное" ? <FavoritesEditor
            key={(data.me.favoriteModules ?? []).join("|")}
            available={moduleCatalog.filter((module) => module.id !== "home" && !["access", "integrations", "acceptance"].includes(module.id) && (data.me.allowedModules?.includes(module.id) ?? true))}
            value={data.me.favoriteModules ?? []}
            busy={busy === "favorites"}
            save={async (favoriteModules) => {
              const result = await action({ action: "saveFavorites", favoriteModules }, "favorites");
              if (result) onFavoritesChanged(favoriteModules);
            }}
          /> : null}

          {tab === "Интеграции" ? (canOpenSettingsModule(data.me, "integrations")
            ? <div className="settings-embedded-workspace"><IntegrationWorkspace role={data.me.role} notify={notify} onTasksChanged={() => void onTasksChanged()} /></div>
            : <SettingsAccessDenied title="Интеграции" />) : null}

          {tab === "Проверка системы" ? (canOpenSettingsModule(data.me, "acceptance")
            ? <div className="settings-embedded-workspace"><ReadinessWorkspace role={data.me.role} notify={notify} /></div>
            : <SettingsAccessDenied title="Проверка системы" />) : null}
        </div>
      </>}
    </section>
    {temporaryCredential ? <TemporaryCredentialDialog credential={temporaryCredential} close={() => setTemporaryCredential(null)} copy={copyCredential} /> : null}
  </div>;
}

function FavoritesEditor({ available, value, busy, save }: { available: Array<{ id: ModuleId; label: string }>; value: ModuleId[]; busy: boolean; save: (value: ModuleId[]) => Promise<void> }) {
  const availableIds = useMemo(() => new Set(available.map((module) => module.id)), [available]);
  const [selected, setSelected] = useState<ModuleId[]>(() => value.filter((id) => availableIds.has(id)));

  function toggle(id: ModuleId, checked: boolean) {
    setSelected((current) => checked ? [...current, id].slice(0, 12) : current.filter((item) => item !== id));
  }

  function move(id: ModuleId, direction: -1 | 1) {
    setSelected((current) => {
      const index = current.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return <section className="settings-favorites">
    <header><div><p>Личное меню</p><h3>Избранное</h3><span>Выберите нужные разделы и задайте их порядок. Настройка сохраняется только для вашей учётной записи.</span></div><b>{selected.length}</b></header>
    <div className="favorites-editor-grid">
      <div className="favorites-available"><h4>Доступные разделы</h4>{available.map((entry) => <label key={entry.id}><input type="checkbox" checked={selected.includes(entry.id)} onChange={(event) => toggle(entry.id, event.target.checked)} /><span>{entry.label}</span></label>)}</div>
      <div className="favorites-order"><h4>Порядок в меню</h4>{selected.length ? selected.map((id, index) => {
        const entry = available.find((item) => item.id === id);
        if (!entry) return null;
        return <div data-ah-compact-card="true" key={id}><span>{index + 1}</span><strong>{entry.label}</strong><button type="button" disabled={index === 0} aria-label={`Переместить выше: ${entry.label}`} onClick={() => move(id, -1)}>↑</button><button type="button" disabled={index === selected.length - 1} aria-label={`Переместить ниже: ${entry.label}`} onClick={() => move(id, 1)}>↓</button></div>;
      }) : <p>Отметьте разделы слева — они появятся здесь и в боковом меню.</p>}</div>
    </div>
    <footer><Button variant="primary" disabled={busy} onClick={() => void save(selected)}>{busy ? "Сохраняем…" : "Сохранить избранное"}</Button></footer>
  </section>;
}

function SettingsAccessDenied({ title }: { title: string }) {
  return <div className="settings-boundary"><strong>{title} недоступен</strong><span>Этот раздел не включён в ваш набор доступов. Владелец может добавить его в настройках пользователя.</span></div>;
}

function TemporaryCredentialDialog({ credential, close, copy }: { credential: TemporaryCredential; close: () => void; copy: (value: string, label: string) => Promise<boolean> }) {
  const [copyState, setCopyState] = useState<{ target: "login" | "password" | "all"; message: string; copied: boolean } | null>(null);
  const bundle = `Логин: ${credential.login}\nВременный пароль: ${credential.temporaryPassword}`;
  const expiresAt = new Date(credential.expiresAt);
  const expiryLabel = Number.isNaN(expiresAt.getTime()) ? credential.expiresAt : expiresAt.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });

  useEffect(() => {
    if (!copyState) return;
    const timer = window.setTimeout(() => setCopyState(null), 2400);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function handleCopy(target: "login" | "password" | "all", value: string, label: string) {
    const copied = await copy(value, label);
    setCopyState({
      target,
      copied,
      message: copied ? `${label} скопирован` : "Не удалось скопировать. Нажмите на поле и выберите «Скопировать».",
    });
  }

  const buttonLabel = (target: "login" | "password" | "all", fallback: string) => copyState?.copied && copyState.target === target ? "Скопировано ✓" : fallback;
  return <div className="temporary-credential-layer">
    <button className="temporary-credential-scrim" onClick={close} aria-label="Закрыть данные временного входа" />
    <section className="temporary-credential-dialog" role="dialog" aria-modal="true" aria-labelledby="temporary-credential-title">
      <header><div><p>Одноразовый показ</p><h3 id="temporary-credential-title">Временный вход для {credential.displayName}</h3></div><button type="button" onClick={close} aria-label="Закрыть">×</button></header>
      <div className="temporary-credential-warning"><strong>Сохраните данные сейчас</strong><span>После закрытия пароль больше не показывается. Новый временный вход аннулирует предыдущий, а сотрудник должен сменить пароль при первом входе.</span></div>
      <div className="temporary-credential-fields">
        <label><span>Логин</span><div><input readOnly value={credential.login} onFocus={(event) => event.currentTarget.select()} /><button type="button" className={copyState?.copied && copyState.target === "login" ? "copy-confirmed" : ""} onClick={() => void handleCopy("login", credential.login, "Логин")}>{buttonLabel("login", "Скопировать")}</button></div></label>
        <label><span>Временный пароль</span><div><input className="temporary-password" readOnly value={credential.temporaryPassword} onFocus={(event) => event.currentTarget.select()} /><button type="button" className={copyState?.copied && copyState.target === "password" ? "copy-confirmed" : ""} onClick={() => void handleCopy("password", credential.temporaryPassword, "Пароль")}>{buttonLabel("password", "Скопировать")}</button></div></label>
      </div>
      <p className={copyState?.copied ? "temporary-credential-copy-status copied" : "temporary-credential-copy-status"} role="status" aria-live="polite">{copyState?.message ?? ""}</p>
      <p className="temporary-credential-expiry">Действует до {expiryLabel}. Используйте безопасный канал передачи.</p>
      <footer><button type="button" className={copyState?.copied && copyState.target === "all" ? "copy-confirmed" : ""} onClick={() => void handleCopy("all", bundle, "Логин и пароль")}>{buttonLabel("all", "Скопировать всё")}</button><button type="button" onClick={close}>Готово, закрыть</button></footer>
    </section>
  </div>;
}

function copyTextSynchronously(value: string) {
  const textarea = document.createElement("textarea");
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  textarea.value = value;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.setAttribute("aria-hidden", "true");
  Object.assign(textarea.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "1px",
    height: "1px",
    padding: "0",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
    fontSize: "16px",
  });
  document.body.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    activeElement?.focus({ preventScroll: true });
  }
}

async function copyTextWithClipboardApi(value: string) {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function readClientCookie(name: string) {
  const prefix = `${name}=`;
  const item = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!item) return "";
  try { return decodeURIComponent(item.slice(prefix.length)); } catch { return ""; }
}

function retryableSyncStatus(value: string) {
  return value === "Ожидает синхронизации" || value === "Ожидает подключения" || value === "Ошибка синхронизации" || value === "Синхронизация выполняется";
}

function syncEventLabel(value: string) {
  return ({
    upsert: "Обновление доступа сотрудника",
    block: "Блокировка сотрудника",
    restore: "Восстановление сотрудника",
    reset_password: "Новый пароль",
    revoke: "Отзыв доступа сотрудника",
    grant_access: "Выдача доступа семье",
    block_access: "Блокировка доступа семьи",
    restore_access: "Восстановление доступа семьи",
    revoke_access: "Отзыв доступа семьи",
  } as Record<string, string>)[value] ?? "Изменение доступа";
}

function OwnerDiaryAccessForm({ grant, roles, busy, close, save }: {
  grant?: { role: string; status: string };
  roles: Array<{ value: string; label: string }>;
  busy: boolean;
  close: () => void;
  save: (enabled: boolean, diaryRole: string) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(grant?.status === "Активен");
  const [diaryRole, setDiaryRole] = useState(grant?.role ?? "director");
  return <form className="settings-card settings-form owner-diary-access-form" onSubmit={(event) => { event.preventDefault(); void save(enabled, diaryRole); }}>
    <header><div><p>Личный доступ владельца</p><h3>Вход в «Дневник 1–11»</h3><small>Меняется только разрешение на вход в дневник. Роль, логин и права владельца в ArtHello OS останутся без изменений.</small></div><button type="button" onClick={close} aria-label="Закрыть форму">×</button></header>
    <label className="owner-diary-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>Разрешить мне вход в электронный дневник</span></label>
    {enabled ? <label><span>Роль в дневнике</span><SoftSelect ariaLabel="Роль владельца в дневнике" value={diaryRole} onChange={setDiaryRole} options={roles} /><small>Эта роль действует только внутри учебного контура.</small></label> : <p className="owner-diary-warning">После сохранения вход в дневник будет отключён. Текущий доступ к ArtHello OS сохранится.</p>}
    <footer className="owner-diary-actions"><button type="button" onClick={close}>Отмена</button><button disabled={busy || (enabled && !diaryRole)}>{busy ? "Сохраняем…" : "Сохранить"}</button></footer>
  </form>;
}

function AccessAssignmentForm({ user, data, busy, close, submit }: { user: SettingsUser; data: SettingsData; busy: string; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void }) {
  const savedBranchIds = data.grants.filter((grant) => grant.userId === user.id).map((grant) => grant.branchId);
  const branchIds = new Set(user.hasAccess ? savedBranchIds : user.employeeBranchIds ?? []);
  const employeeBranchIds = new Set(user.employeeBranchIds ?? []);
  const systemGrants = data.systemGrants.filter((grant) => grant.userId === user.id);
  const systemIds = new Set(systemGrants.map((grant) => grant.systemId));
  const diaryRole = systemGrants.find((grant) => grant.systemId === "SYS-SCHOOL-1-11")?.role ?? "teacher";
  const [selectedRole, setSelectedRole] = useState(user.role || "Сотрудник");
  const [allowedModules, setAllowedModules] = useState<ModuleId[]>(user.allowedModules ?? modulesForRole(user.role || "Сотрудник"));
  function chooseRole(role: string) {
    setSelectedRole(role);
    setAllowedModules(modulesForRole(role));
  }
  function toggleModule(moduleId: ModuleId, checked: boolean) {
    setAllowedModules((current) => checked ? [...new Set([...current, moduleId])] : current.filter((id) => id !== moduleId));
  }
  return <form className="settings-card settings-form invite-form access-assignment-form" onSubmit={submit}>
    <header><div><p>Выдача доступа</p><h3>{user.displayName}</h3><small>{humanPosition(user.jobTitle || user.position, user.role)}{user.unit ? ` · ${user.unit}` : ""}</small></div><button type="button" onClick={close} aria-label="Закрыть форму">×</button></header>
    <div className="access-form-columns">
      <div>
        <label><span>Логин из карточки сотрудника</span><input readOnly value={user.contact} aria-readonly="true" /><input type="hidden" name="contact" value={user.contact} /><small>Телефон или email изменяется только в «Команда → Сотрудники».</small></label>
        <label><span>Должность</span><input name="position" required maxLength={120} defaultValue={humanPosition(user.jobTitle || user.position, user.role)} placeholder="Например, руководитель филиала" /><small>Свободное название, которое будет видно в карточке пользователя.</small></label>
        <label><span>Шаблон роли</span><SoftSelect name="role" ariaLabel="Шаблон роли" value={selectedRole} onChange={chooseRole} options={roles.map((role) => ({ value: role, label: role }))} /><small>Шаблон сразу отмечает типовой набор. Ниже его можно вручную изменить.</small></label>
        <label className="admin-check"><input type="checkbox" name="isAdministrative" defaultChecked={user.isAdministrative} /><span>Административный корпус — доступ ко всем филиалам</span></label>
      </div>
      <fieldset><legend>Филиалы из карточки</legend>{data.branches.map((branch) => { const belongs = employeeBranchIds.has(branch.id); return <label key={branch.id} className={!belongs ? "unavailable" : ""}><input type="checkbox" name="branchIds" value={branch.id} disabled={!belongs && !user.isAdministrative} defaultChecked={branchIds.has(branch.id)} /><span>{branch.name}</span></label>; })}<small>Здесь можно сузить доступ, но добавить новый филиал сотруднику можно только в его основной карточке.</small></fieldset>
      <fieldset className="module-access-fieldset"><legend>Ручная настройка разделов</legend><div className="module-access-grid">{assignableModules.map((module) => { const specialMedical = module.id === "medical" && selectedRole !== "Медработник"; return <label key={module.id} className={specialMedical ? "unavailable" : ""}><input type="checkbox" name="allowedModules" value={module.id} checked={allowedModules.includes(module.id)} disabled={specialMedical} onChange={(event) => toggleModule(module.id, event.target.checked)} /><span><strong>{module.label}</strong><small>{module.group}{specialMedical ? " · нужен отдельный медицинский допуск" : ""}</small></span></label>; })}</div><small>Снятая галочка закрывает экран и действия раздела. Добавленный сверх шаблона раздел доступен только для чтения; изменение данных всё равно ограничено ролью.</small></fieldset>
      <fieldset><legend>Доступные системы</legend>{data.systems.map((system, index) => <label key={system.id}><input type="checkbox" name="systemIds" value={system.id} defaultChecked={user.hasAccess ? systemIds.has(system.id) : index === 0} /><span><strong>{system.name}</strong><small>{system.description}</small></span></label>)}</fieldset>
      <label><span>Роль в дневнике</span><SoftSelect name="diaryRole" ariaLabel="Роль в дневнике" defaultValue={diaryRole} options={data.systemRoleOptions["SYS-SCHOOL-1-11"] ?? []} /><small>Используется, только если выбран «Дневник 1–11».</small></label>
    </div>
    <div className="access-approval-note"><strong>Отдельное подтверждение</strong><span>Сохранение карточки сотрудника в «Команде» не выдаёт доступ. Приглашение будет создано только после нажатия кнопки ниже.</span></div>
    <div className="access-form-actions"><button type="button" onClick={close}>Отмена</button><button disabled={busy === "invite"}>{busy === "invite" ? "Сохраняем…" : user.hasAccess ? "Сохранить изменения" : "Подтвердить и выдать доступ"}</button></div>
  </form>;
}

function syncLabel(value:string){return value==="Ожидает синхронизации"||value==="Ожидает подключения"?"подключение ещё не настроено":value}
function deliveryLabel(value:string){return value==="pending"?"ожидает отправки":value==="sent"?"отправлено":value==="delivered"?"доставлено":value==="failed"?"не доставлено":value}
function familyAccessState(family:{sourceSystem:string;dataQuality:string}){return family.sourceSystem==="MANUAL"&&family.dataQuality!=="Требует сверки"?"Создано вручную":family.dataQuality}
function familyAccessNeedsReview(family:{sourceSystem:string;dataQuality:string}){return family.dataQuality==="Требует сверки"||family.dataQuality==="На проверке"||(family.sourceSystem!=="MANUAL"&&family.dataQuality!=="Проверено")}
function modulesForRole(role: string) {
  const apiRole = API_ROLE_BY_APP_ROLE[role];
  if (!apiRole) return ["tasks", "events"] as ModuleId[];
  return assignableModules.filter((module) => permissionForRole(apiRole, module.id) !== "Нет доступа").map((module) => module.id);
}
function humanPosition(value: string | undefined, fallback: string) {
  const position = value?.trim() ?? "";
  if (!position || /^POS[-_:]/i.test(position) || /^[A-Z_]{3,}$/i.test(position)) return fallback || "Должность не указана";
  return position;
}
function systemRoleLabel(options: SettingsData["systemRoleOptions"], systemId: string, role: string) {
  return options[systemId]?.find((option) => option.value === role)?.label
    ?? ({ director: "Директор", deputy: "Завуч", admin: "Администратор школы", teacher: "Учитель", tech_admin: "Технический администратор" } as Record<string, string>)[role]
    ?? "Назначенная роль";
}
function canOpenSettingsModule(user: AccessContext["me"], moduleId: "integrations" | "acceptance") {
  const apiRole = API_ROLE_BY_APP_ROLE[user.role] ?? "";
  return canAccessModule({ apiRole, isSystemOwner: user.role === "Собственник", allowedModules: user.allowedModules }, moduleId);
}
