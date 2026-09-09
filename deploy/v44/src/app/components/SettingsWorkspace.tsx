"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

export type Branch = { id: string; name: string; kind: string; status: string };
export type AccessContext = {
  me: { id: string; displayName: string; role: string; isAdministrative: boolean; contact: string };
  branches: Branch[];
  access: Array<{ branchId: string; accessLevel: string }>;
};

type SettingsData = AccessContext & {
  users: Array<{ id: string; displayName: string; contact: string; contactType: string; role: string; isAdministrative: boolean; status: string; invitationStatus: string; accessVersion: number }>;
  grants: Array<{ userId: string; branchId: string }>;
  systems: Array<{ id: string; systemKey: string; name: string; description: string; status: string }>;
  systemGrants: Array<{ userId: string; systemId: string; role: string; status: string; lastSyncStatus: string; lastSyncedAt: string }>;
  syncEvents: Array<{ id: string; userId: string; systemId: string; status: string; lastError: string; createdAt: string }>;
  familyDirectory: Array<{ id: string; displayName: string; status: string; sourceSystem: string; sourceRecordId: string; dataQuality: string; scope: string; members: Array<{ id: string; displayName: string; entityType: string; relation: string; sourceSystem: string; sourceRecordId: string; scope: string; phone: string; email: string }> }>;
  familyAccessGrants: Array<{ id: string; familyEntityId: string; principalEntityId: string; principalType: string; role: string; loginType: string; login: string; deliveryChannel: string; deliveryStatus: string; status: string; accessVersion: number; lastSyncStatus: string; lastSyncedAt: string }>;
  systemRoleOptions: Record<string, Array<{ value: string; label: string }>>;
  records: Array<{ id: string; branchId: string; recordType: string; title: string; period: string; amountMinor: number; status: string; createdAt: string }>;
  canManage: boolean;
  authBoundary: string;
};

const tabs = ["Филиалы", "Пользователи", "Семьи и доступы", "Первичный ввод"] as const;
const roles = ["Директор", "Финансы", "Бухгалтерия", "HR", "Продажи", "Маркетинг", "Педагог", "Методист", "Кухня", "Безопасность", "Юрист", "Сотрудник"];
const recordTypes = ["Заработная плата", "ДДС", "ОПиУ", "Сотрудник", "Ребёнок", "Семья", "Класс или группа", "Занятие", "Дополнительное занятие", "Договор", "Начисление", "Оплата", "Другое"];

export function SettingsWorkspace({ close, notify, onContextChanged }: { close: () => void; notify: (value: string) => void; onContextChanged: (value: AccessContext) => void }) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [tab, setTab] = useState<typeof tabs[number]>("Филиалы");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [credentialLink, setCredentialLink] = useState("");

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
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

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

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void action({
      action: "inviteUser",
      displayName: form.get("displayName"),
      contact: form.get("contact"),
      role: form.get("role"),
      isAdministrative: form.get("isAdministrative") === "on",
      branchIds: form.getAll("branchIds"),
      systemIds: form.getAll("systemIds"),
      diaryRole: form.get("diaryRole"),
    }, "invite");
  }

  function manual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void action({ action: "createManualRecord", branchId: form.get("branchId"), recordType: form.get("recordType"), title: form.get("title"), period: form.get("period"), amount: form.get("amount"), details: form.get("details") }, "manual");
    event.currentTarget.reset();
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
      <header className="settings-head"><div><p>Управление системой</p><h2 id="settings-title">Настройки</h2><span>Филиалы, доступы и проверенный первичный ввод</span></div><button onClick={close} aria-label="Закрыть">×</button></header>
      {loading ? <div className="settings-state">Загружаем права и филиалы…</div> : error || !data ? <div className="settings-state"><strong>{error}</strong><button onClick={() => void load()}>Повторить</button></div> : <>
        <nav className="settings-tabs">{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>
        <div className="settings-body">
          {tab === "Филиалы" ? <div className="settings-grid">
            <article className="settings-card wide"><header><div><p>Рабочие контуры</p><h3>Филиалы</h3></div><span>{data.branches.length}</span></header><div className="branch-list">{data.branches.map((branch) => <div key={branch.id}><span>{branch.kind.slice(0, 2).toUpperCase()}</span><div><strong>{branch.name}</strong><small>{branch.kind} · {branch.status}</small></div><em>{data.me.isAdministrative ? "Доступен" : data.access.some((item) => item.branchId === branch.id) ? "Назначен" : "Нет доступа"}</em></div>)}</div></article>
            <article className="settings-card"><header><div><p>Текущий пользователь</p><h3>{data.me.displayName}</h3></div></header><dl><div><dt>Роль</dt><dd>{data.me.role}</dd></div><div><dt>Контур</dt><dd>{data.me.isAdministrative ? "Административный корпус · все филиалы" : `${data.access.length} филиал(а)`}</dd></div><div><dt>Вход</dt><dd>{data.me.contact}</dd></div></dl></article>
            {data.canManage ? <form className="settings-card settings-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void action({ action: "createBranch", name: form.get("name"), kind: form.get("kind") }, "branch"); event.currentTarget.reset(); }}><header><div><p>Структура</p><h3>Добавить филиал</h3></div></header><label><span>Название</span><input name="name" required placeholder="Новый филиал" /></label><label><span>Тип</span><select name="kind"><option>Школа</option><option>Детский сад</option><option>Дополнительное образование</option><option>Филиал</option></select></label><button disabled={busy === "branch"}>{busy === "branch" ? "Сохраняем…" : "Добавить филиал"}</button></form> : null}
          </div> : null}

          {tab === "Пользователи" ? <div className="settings-grid users-grid">
            <article className="settings-card wide">
              <header><div><p>Единый источник доступа</p><h3>Сотрудники</h3></div><span>{data.users.length}</span></header>
              <div className="user-list">{data.users.map((user) => {
                const granted = data.grants.filter((grant) => grant.userId === user.id).map((grant) => branchNames[grant.branchId]).filter(Boolean);
                const assignedSystems = data.systemGrants.filter((grant) => grant.userId === user.id);
                const diaryGrant = assignedSystems.find((grant) => grant.systemId === "SYS-SCHOOL-1-11");
                return <div key={user.id}>
                  <span>{user.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
                  <div>
                    <strong>{user.displayName}</strong>
                    <small>{user.contact} · {user.role}</small>
                    <em>{user.isAdministrative ? "Все филиалы" : granted.join(", ") || "Филиалы не назначены"}</em>
                    <em>{assignedSystems.map((grant) => `${systemNames[grant.systemId] ?? grant.systemId}: ${grant.role}`).join(" · ") || "Системы не назначены"}</em>
                  </div>
                  <b className={user.status === "Активен" ? "active" : ""}>{user.status === "Доступ приостановлен" ? "Заблокирован" : diaryGrant?.lastSyncStatus ?? user.invitationStatus}</b>
                  {data.canManage && user.id !== data.me.id ? <div className="user-access-buttons">
                    {diaryGrant ? <button disabled={busy === `password-${user.id}`} onClick={() => void action({ action: "resetPassword", userId: user.id }, `password-${user.id}`)}>Сбросить пароль</button> : null}
                    {user.status === "Доступ приостановлен"
                      ? <button disabled={busy === `restore-${user.id}`} onClick={() => void action({ action: "restoreUser", userId: user.id }, `restore-${user.id}`)}>Восстановить</button>
                      : <button disabled={busy === `block-${user.id}`} onClick={() => void action({ action: "blockUser", userId: user.id }, `block-${user.id}`)}>Заблокировать</button>}
                  </div> : null}
                </div>;
              })}</div>
            </article>
            {data.canManage ? <form className="settings-card settings-form invite-form" onSubmit={invite}>
              <header><div><p>Единая карточка сотрудника</p><h3>Создать или обновить доступ</h3></div></header>
              <label><span>Имя</span><input name="displayName" required placeholder="Имя и фамилия" /></label>
              <label><span>Телефон или email</span><input name="contact" required placeholder="+7… или name@example.ru" /></label>
              <label><span>Роль в организации</span><select name="role">{roles.map((role) => <option key={role}>{role}</option>)}</select></label>
              <fieldset><legend>Доступные филиалы</legend>{data.branches.map((branch) => <label key={branch.id}><input type="checkbox" name="branchIds" value={branch.id} /><span>{branch.name}</span></label>)}</fieldset>
              <label className="admin-check"><input type="checkbox" name="isAdministrative" /><span>Административный корпус — доступ ко всем филиалам</span></label>
              <fieldset><legend>Доступные системы</legend>{data.systems.map((system, index) => <label key={system.id}><input type="checkbox" name="systemIds" value={system.id} defaultChecked={index === 0} /><span><strong>{system.name}</strong><small>{system.description}</small></span></label>)}</fieldset>
              <label><span>Роль в дневнике</span><select name="diaryRole">{(data.systemRoleOptions["SYS-SCHOOL-1-11"] ?? []).map((role) => <option value={role.value} key={role.value}>{role.label}</option>)}</select><small>Используется только если выбран «Дневник 1–11». Классы и предметы назначаются внутри дневника.</small></label>
              <button disabled={busy === "invite"}>{busy === "invite" ? "Сохраняем…" : "Сохранить сотрудника и доступы"}</button>
            </form> : null}
            {credentialLink ? <div className="settings-boundary credential-result"><strong>Одноразовая ссылка готова</strong><span>Передайте её сотруднику безопасным каналом. Повторный сброс аннулирует предыдущую.</span><input readOnly value={credentialLink} onFocus={(event) => event.currentTarget.select()} /><button onClick={() => void navigator.clipboard.writeText(credentialLink)}>Скопировать ссылку</button></div> : null}
            <div className="settings-boundary"><strong>Как работает вход</strong><span>{data.authBoundary}</span></div>
          </div> : null}

          {tab === "Семьи и доступы" ? <div className="settings-grid users-grid family-access-grid">
            <div className="settings-boundary family-source-boundary"><strong>Один источник данных</strong><span>AlfaCRM передаёт семьи, родителей, учеников и классы в ArtHello OS по API. Здесь им присваиваются стабильные ID и выдаётся доступ. Дневник получает read-only проекцию; повторное создание внутри дневника отключено.</span></div>
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
                      <button disabled={busy === `family-${member.id}`}>{busy === `family-${member.id}` ? "Сохраняем…" : grant ? "Обновить и отправить" : "Выдать и отправить"}</button>
                      {grant ? <>
                        <button type="button" disabled={busy === `family-password-${grant.id}`} onClick={() => void action({ action: "resetFamilyPassword", grantId: grant.id }, `family-password-${grant.id}`)}>Сбросить пароль</button>
                        {grant.status === "Приостановлен" ? <button type="button" disabled={busy === `family-restore-${grant.id}`} onClick={() => void action({ action: "restoreFamilyAccess", grantId: grant.id }, `family-restore-${grant.id}`)}>Восстановить</button> : <button type="button" disabled={busy === `family-block-${grant.id}`} onClick={() => void action({ action: "blockFamilyAccess", grantId: grant.id }, `family-block-${grant.id}`)}>Заблокировать</button>}
                      </> : null}
                    </div>
                  </form>;
                })}</div> : <div className="settings-empty"><strong>Нет связанных людей</strong><p>Сначала AlfaCRM должна передать ребёнка и представителей, а ArtHello OS — связать их со стабильной карточкой семьи.</p></div>}
              </section>)}</div> : <div className="settings-empty"><strong>Семьи ещё не синхронизированы</strong><p>Подключите AlfaCRM в разделе «Интеграции». Создавать параллельные карточки в дневнике больше не требуется.</p></div>}
            </article>
            {credentialLink ? <div className="settings-boundary credential-result"><strong>Одноразовая ссылка готова</strong><span>Ссылка предназначена для первого входа или создания нового пароля. После подключения канала она отправляется выбранному человеку по SMS или email.</span><input readOnly value={credentialLink} onFocus={(event) => event.currentTarget.select()} /><button onClick={() => void navigator.clipboard.writeText(credentialLink)}>Скопировать ссылку</button></div> : null}
            <div className="settings-boundary"><strong>Граница систем</strong><span>{data.authBoundary}</span></div>
          </div> : null}

          {tab === "Первичный ввод" ? <div className="settings-grid manual-grid">
            <form className="settings-card settings-form" onSubmit={manual}><header><div><p>Проверено человеком</p><h3>Добавить исходную запись</h3></div></header><label><span>Филиал</span><select name="branchId" required>{data.branches.filter((branch) => data.me.isAdministrative || data.access.some((item) => item.branchId === branch.id)).map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label><label><span>Что вводим</span><select name="recordType">{recordTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label><span>Название или объект</span><input name="title" required placeholder="Например, зарплата за август" /></label><div className="form-pair"><label><span>Период</span><input type="month" name="period" /></label><label><span>Сумма, ₽</span><input type="number" name="amount" step="0.01" min="0" /></label></div><label><span>Подробности</span><textarea name="details" placeholder="Состав, основание, ответственный или примечание" /></label><button disabled={busy === "manual"}>{busy === "manual" ? "Сохраняем…" : "Сохранить запись"}</button></form>
            <article className="settings-card wide"><header><div><p>Стартовый реестр</p><h3>Введено вручную</h3></div><span>{data.records.length}</span></header>{data.records.length ? <div className="manual-list">{data.records.map((record) => <div key={record.id}><span>{record.recordType}</span><div><strong>{record.title}</strong><small>{branchNames[record.branchId]}{record.period ? ` · ${record.period}` : ""}</small></div><em>{record.amountMinor ? new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(record.amountMinor / 100) : record.status}</em></div>)}</div> : <div className="settings-empty"><strong>Пока пусто</strong><p>Начните с филиалов, сотрудников, семей, классов, ДДС, ОПиУ и зарплат. Каждая запись сохраняется отдельно по филиалу.</p></div>}</article>
          </div> : null}
        </div>
      </>}
    </section>
  </div>;
}
