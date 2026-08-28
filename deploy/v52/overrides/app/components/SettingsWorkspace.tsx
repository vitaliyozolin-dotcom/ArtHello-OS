"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { SoftSelect } from "./SoftSelect";

export type Branch = { id: string; name: string; kind: string; status: string };
export type AccessContext = {
  me: { id: string; displayName: string; role: string; isAdministrative: boolean; contact: string };
  branches: Branch[];
  access: Array<{ branchId: string; accessLevel: string }>;
};

type SettingsUser = { id: string; employeeId?: string; displayName: string; contact: string; contactType: string; role: string; isAdministrative: boolean; status: string; invitationStatus: string; accessVersion: number; hasAccess?: boolean; source?: string; unit?: string; position?: string; employeeBranchIds?: string[]; dataQuality?: string };
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
  syncEvents: Array<{ id: string; userId: string; systemId: string; status: string; lastError: string; createdAt: string }>;
  familyDirectory: Array<{ id: string; displayName: string; status: string; sourceSystem: string; sourceRecordId: string; dataQuality: string; scope: string; members: Array<{ id: string; displayName: string; entityType: string; relation: string; sourceSystem: string; sourceRecordId: string; scope: string; phone: string; email: string }> }>;
  familyAccessGrants: Array<{ id: string; familyEntityId: string; principalEntityId: string; principalType: string; role: string; loginType: string; login: string; deliveryChannel: string; deliveryStatus: string; status: string; accessVersion: number; lastSyncStatus: string; lastSyncedAt: string }>;
  systemRoleOptions: Record<string, Array<{ value: string; label: string }>>;
  canManage: boolean;
  authBoundary: string;
};

const tabs = ["Филиалы", "Пользователи", "Семьи и доступы"] as const;
const roles = ["Директор", "Администратор", "Завуч", "Финансы", "Бухгалтерия", "HR", "Продажи", "Маркетинг", "Педагог", "Методист", "Кухня", "Закупки", "Безопасность", "Медработник", "Юрист", "Интеграции", "Аналитика", "Проекты", "Сотрудник"];

export function SettingsWorkspace({ close, notify, onContextChanged }: { close: () => void; notify: (value: string) => void; onContextChanged: (value: AccessContext) => void }) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [tab, setTab] = useState<typeof tabs[number]>("Филиалы");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [credentialLink, setCredentialLink] = useState("");
  const [accessEmployeeId, setAccessEmployeeId] = useState("");
  const [temporaryCredential, setTemporaryCredential] = useState<TemporaryCredential | null>(null);

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
      const response = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string; message?: string; activationLink?: string };
      if (!response.ok) throw new Error(payload.error ?? "Действие не выполнено");
      if (payload.activationLink) setCredentialLink(payload.activationLink);
      notify(payload.message ?? "Сохранено");
      await load();
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Действие не выполнено"); }
    finally { setBusy(""); }
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
      role: form.get("role"),
      isAdministrative: form.get("isAdministrative") === "on",
      branchIds: form.getAll("branchIds"),
      systemIds: form.getAll("systemIds"),
      diaryRole: form.get("diaryRole"),
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
    }, `family-${principalId}`);
  }

  const branchNames = useMemo(() => Object.fromEntries((data?.branches ?? []).map((branch) => [branch.id, branch.name])), [data]);
  const systemNames = useMemo(() => Object.fromEntries((data?.systems ?? []).map((system) => [system.id, system.name])), [data]);

  return <div className="settings-layer">
    <button className="drawer-scrim" onClick={close} aria-label="Закрыть настройки" />
    <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="settings-head"><div><p>Управление системой</p><h2 id="settings-title">Настройки</h2><span>Филиалы, пользователи и контуры доступа</span></div><button onClick={close} aria-label="Закрыть">×</button></header>
      {loading ? <div className="settings-state">Загружаем права и филиалы…</div> : error || !data ? <div className="settings-state"><strong>{error}</strong><button onClick={() => void load()}>Повторить</button></div> : <>
        <nav className="settings-tabs">{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>
        <div className="settings-body">
          {tab === "Филиалы" ? <div className="settings-grid">
            <article className="settings-card wide"><header><div><p>Рабочие контуры</p><h3>Филиалы</h3></div><span>{data.branches.length}</span></header><div className="branch-list">{data.branches.map((branch) => <div key={branch.id}><span>{branch.kind.slice(0, 2).toUpperCase()}</span><div><strong>{branch.name}</strong><small>{branch.kind} · {branch.status}</small></div><em>{data.me.isAdministrative ? "Доступен" : data.access.some((item) => item.branchId === branch.id) ? "Назначен" : "Нет доступа"}</em></div>)}</div></article>
            <article className="settings-card"><header><div><p>Текущий пользователь</p><h3>{data.me.displayName}</h3></div></header><dl><div><dt>Роль</dt><dd>{data.me.role}</dd></div><div><dt>Контур</dt><dd>{data.me.isAdministrative ? "Административный корпус · все филиалы" : `${data.access.length} филиал(а)`}</dd></div><div><dt>Вход</dt><dd>{data.me.contact}</dd></div></dl></article>
            {data.canManage ? <form className="settings-card settings-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void action({ action: "createBranch", name: form.get("name"), kind: form.get("kind") }, "branch"); event.currentTarget.reset(); }}><header><div><p>Структура</p><h3>Добавить филиал</h3></div></header><label><span>Название</span><input name="name" required placeholder="Новый филиал" /></label><label><span>Тип</span><SoftSelect name="kind" ariaLabel="Тип филиала" defaultValue="Школа" options={["Школа", "Детский сад", "Дополнительное образование", "Филиал"].map((item) => ({ value: item, label: item }))} /></label><button disabled={busy === "branch"}>{busy === "branch" ? "Сохраняем…" : "Добавить филиал"}</button></form> : null}
          </div> : null}

          {tab === "Пользователи" ? <div className="settings-grid users-grid access-users-full">
            <article className="settings-card wide">
              <header><div><p>Только управление входом</p><h3>Сотрудники из раздела «Команда»</h3></div><span>{data.users.length}</span></header>
              <div className="user-list">{data.users.map((user) => {
                const granted = data.grants.filter((grant) => grant.userId === user.id).map((grant) => branchNames[grant.branchId]).filter(Boolean);
                const assignedSystems = data.systemGrants.filter((grant) => grant.userId === user.id);
                const diaryGrant = assignedSystems.find((grant) => grant.systemId === "SYS-SCHOOL-1-11");
                return <div key={user.id}>
                  <span>{user.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
                  <div>
                    <strong>{user.displayName}</strong>
                    <small>{user.position || user.role}{user.unit ? ` · ${user.unit}` : ""}</small>
                    <em>{user.contact || "Контакт не указан в карточке сотрудника"}</em>
                    <em>{user.isAdministrative ? "Все филиалы" : granted.join(", ") || "Филиалы не назначены"}</em>
                    <em>{assignedSystems.map((grant) => `${systemNames[grant.systemId] ?? grant.systemId}: ${grant.role}`).join(" · ") || "Системы не назначены"}</em>
                    {diaryGrant ? <em>Дневник: {syncLabel(diaryGrant.lastSyncStatus)}</em> : null}
                  </div>
                  <b className={user.status === "Активен" ? "active" : ""}>{user.status === "Доступ приостановлен" ? "Заблокирован" : user.hasAccess ? user.invitationStatus : "Доступ не выдан"}</b>
                  {data.canManage && user.id !== data.me.id ? <div className="user-access-buttons">
                    <button className="access-configure" disabled={!user.contact} title={!user.contact ? "Сначала укажите телефон или email в карточке сотрудника" : undefined} onClick={() => setAccessEmployeeId(user.id)}>{user.hasAccess ? "Изменить доступ" : "Выдать доступ"}</button>
                    {user.hasAccess ? <button className="temporary-access" disabled={busy === `temporary-${user.id}` || user.status !== "Активен"} title={user.status !== "Активен" ? "Сначала восстановите доступ сотрудника" : "Создать логин и одноразовый временный пароль"} onClick={() => void issueTemporaryCredential(user)}>{busy === `temporary-${user.id}` ? "Создаём…" : "Временный вход"}</button> : null}
                    {user.hasAccess && diaryGrant ? <button disabled={busy === `password-${user.id}`} onClick={() => void action({ action: "resetPassword", userId: user.id }, `password-${user.id}`)}>Сбросить пароль</button> : null}
                    {user.hasAccess ? user.status === "Доступ приостановлен"
                      ? <button disabled={busy === `restore-${user.id}`} onClick={() => void action({ action: "restoreUser", userId: user.id, employeeId: user.employeeId }, `restore-${user.id}`)}>Восстановить</button>
                      : <button disabled={busy === `block-${user.id}`} onClick={() => void action({ action: "blockUser", userId: user.id, employeeId: user.employeeId }, `block-${user.id}`)}>Заблокировать</button> : null}
                  </div> : null}
                </div>;
              })}</div>
            </article>
            {data.canManage && accessEmployeeId ? <AccessAssignmentForm key={accessEmployeeId} user={data.users.find((user) => user.id === accessEmployeeId)!} data={data} busy={busy} close={() => setAccessEmployeeId("")} submit={invite} /> : <div className="settings-boundary access-source-boundary"><strong>Сотрудники здесь не создаются</strong><span>Добавление, импорт и исправление персональных данных выполняются в «Команда → Сотрудники». Здесь выбирается готовая карточка и отдельно подтверждаются системы, филиалы и роль доступа.</span></div>}
            {credentialLink ? <div className="settings-boundary credential-result"><strong>Одноразовая ссылка готова</strong><span>Передайте её сотруднику безопасным каналом. Повторный сброс аннулирует предыдущую.</span><input readOnly value={credentialLink} onFocus={(event) => event.currentTarget.select()} /><button type="button" onClick={() => void copyCredential(credentialLink, "Ссылка")}>Скопировать ссылку</button></div> : null}
            <div className="settings-boundary"><strong>Как работает вход</strong><span>{data.authBoundary}</span></div>
          </div> : null}

          {tab === "Семьи и доступы" ? <div className="settings-grid users-grid family-access-grid">
            <div className="settings-boundary family-source-boundary"><strong>Только выдача доступа</strong><span>Семьи импортируются или создаются вручную в разделе «Клиенты». Пока карточка не проверена человеком, приглашение отсюда отправить нельзя.</span></div>
            <article className="settings-card wide">
              <header><div><p>Центральный реестр</p><h3>Карточки семей</h3></div><span>{data.familyDirectory.length}</span></header>
              {data.familyDirectory.length ? <div className="family-access-list">{data.familyDirectory.map((family) => <section key={family.id} className="family-access-card">
                <header><div><strong>{family.displayName}</strong><small>{family.id} · {family.scope}</small></div><em>{family.sourceSystem === "SYNTHETIC" ? "Тестовая карточка" : `Источник: ${family.sourceSystem}`}</em></header>
                {family.members.length ? <div className="family-member-list">{family.members.map((member) => {
                  const grant = data.familyAccessGrants.find((item) => item.principalEntityId === member.id);
                  const role = member.entityType === "Ребёнок" ? "student" : "parent";
                  const defaultLogin = grant?.login || member.phone || member.email;
                  return <form key={member.id} className="family-member-access" onSubmit={familyAccess}>
                    <input type="hidden" name="familyEntityId" value={family.id} />
                    <input type="hidden" name="principalEntityId" value={member.id} />
                    <input type="hidden" name="role" value={role} />
                    <div className="family-member-identity"><span>{member.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><div><strong>{member.displayName}</strong><small>{member.entityType === "Ребёнок" ? "Ученик" : "Родитель / представитель"} · {member.id}</small><em>{member.relation}</em></div></div>
                    <label><span>Логин и канал активации</span><input name="login" required defaultValue={defaultLogin} placeholder="+7… или name@example.ru" /><small>Телефон — SMS, email — письмо. Пароль человек создаст сам по одноразовой ссылке.</small></label>
                    <div className="family-access-state"><b className={grant?.status === "Активен" ? "active" : ""}>{grant ? grant.status : "Доступ не выдан"}</b>{grant ? <small>{grant.lastSyncStatus} · {grant.deliveryStatus}</small> : null}</div>
                    <div className="family-access-actions">
                      <button disabled={busy === `family-${member.id}` || family.dataQuality !== "Проверено"}>{busy === `family-${member.id}` ? "Сохраняем…" : family.dataQuality !== "Проверено" ? "Сначала проверить" : grant ? "Обновить и отправить" : "Выдать и отправить"}</button>
                      {grant ? <>
                        <button type="button" disabled={busy === `family-password-${grant.id}`} onClick={() => void action({ action: "resetFamilyPassword", grantId: grant.id }, `family-password-${grant.id}`)}>Сбросить пароль</button>
                        {grant.status === "Приостановлен" ? <button type="button" disabled={busy === `family-restore-${grant.id}`} onClick={() => void action({ action: "restoreFamilyAccess", grantId: grant.id }, `family-restore-${grant.id}`)}>Восстановить</button> : <button type="button" disabled={busy === `family-block-${grant.id}`} onClick={() => void action({ action: "blockFamilyAccess", grantId: grant.id }, `family-block-${grant.id}`)}>Заблокировать</button>}
                      </> : null}
                    </div>
                  </form>;
                })}</div> : <div data-ah-compact-card="true" className="settings-empty"><strong>Нет связанных людей</strong><p>Сначала AlfaCRM должна передать ребёнка и представителей, а ArtHello OS — связать их со стабильной карточкой семьи.</p></div>}
              </section>)}</div> : <div data-ah-compact-card="true" className="settings-empty"><strong>Семьи ещё не синхронизированы</strong><p>Подключите AlfaCRM в разделе «Интеграции». Создавать параллельные карточки в дневнике больше не требуется.</p></div>}
            </article>
            {credentialLink ? <div className="settings-boundary credential-result"><strong>Одноразовая ссылка готова</strong><span>Ссылка предназначена для первого входа или создания нового пароля. После подключения канала она отправляется выбранному человеку по SMS или email.</span><input readOnly value={credentialLink} onFocus={(event) => event.currentTarget.select()} /><button type="button" onClick={() => void copyCredential(credentialLink, "Ссылка")}>Скопировать ссылку</button></div> : null}
            <div className="settings-boundary"><strong>Граница систем</strong><span>{data.authBoundary}</span></div>
          </div> : null}
        </div>
      </>}
    </section>
    {temporaryCredential ? <TemporaryCredentialDialog credential={temporaryCredential} close={() => setTemporaryCredential(null)} copy={copyCredential} /> : null}
  </div>;
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

function AccessAssignmentForm({ user, data, busy, close, submit }: { user: SettingsUser; data: SettingsData; busy: string; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void }) {
  const savedBranchIds = data.grants.filter((grant) => grant.userId === user.id).map((grant) => grant.branchId);
  const branchIds = new Set(user.hasAccess ? savedBranchIds : user.employeeBranchIds ?? []);
  const employeeBranchIds = new Set(user.employeeBranchIds ?? []);
  const systemGrants = data.systemGrants.filter((grant) => grant.userId === user.id);
  const systemIds = new Set(systemGrants.map((grant) => grant.systemId));
  const diaryRole = systemGrants.find((grant) => grant.systemId === "SYS-SCHOOL-1-11")?.role ?? "teacher";
  return <form className="settings-card settings-form invite-form access-assignment-form" onSubmit={submit}>
    <header><div><p>Выдача доступа</p><h3>{user.displayName}</h3><small>{user.position || user.role}{user.unit ? ` · ${user.unit}` : ""}</small></div><button type="button" onClick={close} aria-label="Закрыть форму">×</button></header>
    <div className="access-form-columns">
      <div>
        <label><span>Логин из карточки сотрудника</span><input readOnly value={user.contact} aria-readonly="true" /><input type="hidden" name="contact" value={user.contact} /><small>Телефон или email изменяется только в «Команда → Сотрудники».</small></label>
        <label><span>Роль в системе</span><SoftSelect name="role" ariaLabel="Роль в системе" defaultValue={user.role || "Сотрудник"} options={roles.map((role) => ({ value: role, label: role }))} /></label>
        <label className="admin-check"><input type="checkbox" name="isAdministrative" defaultChecked={user.isAdministrative} /><span>Административный корпус — доступ ко всем филиалам</span></label>
      </div>
      <fieldset><legend>Филиалы из карточки</legend>{data.branches.map((branch) => { const belongs = employeeBranchIds.has(branch.id); return <label key={branch.id} className={!belongs ? "unavailable" : ""}><input type="checkbox" name="branchIds" value={branch.id} disabled={!belongs && !user.isAdministrative} defaultChecked={branchIds.has(branch.id)} /><span>{branch.name}</span></label>; })}<small>Здесь можно сузить доступ, но добавить новый филиал сотруднику можно только в его основной карточке.</small></fieldset>
      <fieldset><legend>Доступные системы</legend>{data.systems.map((system, index) => <label key={system.id}><input type="checkbox" name="systemIds" value={system.id} defaultChecked={user.hasAccess ? systemIds.has(system.id) : index === 0} /><span><strong>{system.name}</strong><small>{system.description}</small></span></label>)}</fieldset>
      <label><span>Роль в дневнике</span><SoftSelect name="diaryRole" ariaLabel="Роль в дневнике" defaultValue={diaryRole} options={data.systemRoleOptions["SYS-SCHOOL-1-11"] ?? []} /><small>Используется, только если выбран «Дневник 1–11».</small></label>
    </div>
    <div className="access-approval-note"><strong>Отдельное подтверждение</strong><span>Сохранение карточки сотрудника в «Команде» не выдаёт доступ. Приглашение будет создано только после нажатия кнопки ниже.</span></div>
    <div className="access-form-actions"><button type="button" onClick={close}>Отмена</button><button disabled={busy === "invite"}>{busy === "invite" ? "Сохраняем…" : user.hasAccess ? "Сохранить изменения" : "Подтвердить и выдать доступ"}</button></div>
  </form>;
}

function syncLabel(value:string){return value==="Ожидает синхронизации"||value==="Ожидает подключения"?"подключение ещё не настроено":value}
