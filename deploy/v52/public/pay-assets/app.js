const app = document.querySelector("#app");
const toastRoot = document.querySelector("#toast-root");

const state = {
  user: null,
  catalog: [],
  obligations: [],
  requests: [],
  view: "overview",
  search: "",
  statusFilter: "all",
  modal: null,
  customerResults: [],
  customerLoading: false,
  customerSearchTimer: null,
};

const activeRequestStatuses = new Set([
  "ready",
  "link_creating",
  "waiting",
  "authorized",
]);
const paidRequestStatuses = new Set([
  "paid",
  "fiscalizing",
  "fiscalized",
  "posted",
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(kopecks) {
  const rubles = Number(kopecks ?? 0) / 100;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: Number.isInteger(rubles) ? 0 : 2,
  }).format(rubles);
}

function formatDate(value, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatPeriod(value) {
  if (!value) return "Без периода";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Без периода";
  const label = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function todayIso() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function currentMonthValue() {
  return todayIso().slice(0, 7);
}

function monthToDate(value) {
  return /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : undefined;
}

function initials(name) {
  const parts = String(name ?? "A")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "A"
  );
}

function canUsePay(user) {
  if (!user) return false;
  if (user.isSystemOwner === true || user.role === "owner") return true;
  const modules = Array.isArray(user.allowedModules) ? user.allowedModules : [];
  return (
    user.isAdministrative === true &&
    (modules.includes("ArtHello Pay") || modules.includes("Оплаты"))
  );
}

function roleLabel(userOrRole) {
  const user = userOrRole && typeof userOrRole === "object" ? userOrRole : null;
  const role = user?.role ?? userOrRole;
  if (user?.isSystemOwner === true || role === "owner") return "Владелец";
  if (role === "payment_operator" || canUsePay(user))
    return "Администратор оплат";
  return "Нет доступа";
}

function statusMeta(status) {
  const map = {
    open: ["К оплате", "warning"],
    paid: ["Оплачено", ""],
    ready: ["Ссылка готова", "warning"],
    link_creating: ["Создаём ссылку", "warning"],
    waiting: ["Ждём оплату", "warning"],
    authorized: ["Подтверждается", "warning"],
    fiscalizing: ["Формируем чек", "warning"],
    fiscalized: ["Чек готов", ""],
    posted: ["Проведено", ""],
    cancelled: ["Отменено", "neutral"],
    expired: ["Истекло", "neutral"],
    refunded: ["Возврат", "neutral"],
    review: ["Нужно проверить", "danger"],
  };
  return map[status] ?? [status || "Неизвестно", "neutral"];
}

function statusPill(status) {
  const [label, tone] = statusMeta(status);
  return `<span class="status-pill ${tone}">${escapeHtml(label)}</span>`;
}

function csrfToken() {
  const cookies = document.cookie.split(";").map((part) => part.trim());
  const match = cookies.find(
    (part) =>
      part.startsWith("__Host-arthello_csrf=") ||
      part.startsWith("arthello_csrf="),
  );
  if (!match) return null;
  return decodeURIComponent(match.slice(match.indexOf("=") + 1));
}

async function api(path, options = {}) {
  const method = String(options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers ?? {});
  if (options.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    path !== "/api/auth/login"
  ) {
    const token = csrfToken();
    if (token) headers.set("x-csrf-token", token);
  }
  const response = await fetch(path, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
  });
  let data = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) data = await response.json();
  if (!response.ok) {
    const error = new Error(data?.error || `Ошибка ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function toast(message, tone = "") {
  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.textContent = message;
  toastRoot.append(node);
  window.setTimeout(() => node.remove(), 3200);
}

function renderLoading(label = "Загружаем ArtHello Pay") {
  app.innerHTML = `<main class="loading-page"><div class="loading-card"><div class="spinner"></div><strong>${escapeHtml(label)}</strong></div></main>`;
}

function renderLogin(error = "") {
  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-brand-panel">
        <div class="brand-lockup">
          <div class="brand-mark">A</div>
          <div class="brand-copy"><strong>ArtHello Pay</strong><span>единый контур оплаты</span></div>
        </div>
        <div class="auth-pitch">
          <div class="eyebrow">Отдельный доступ · без интернет-банка</div>
          <h1>Оплаты клиентов в одном понятном окне.</h1>
          <p>Создавайте начисления, выдавайте ссылки и отслеживайте оплату. Остатки, выписки и исходящие банковские операции этому модулю недоступны.</p>
        </div>
        <div class="security-note"><span class="security-dot"></span>Приём денег отделён от доступа к банку</div>
      </section>
      <section class="auth-form-panel">
        <div class="auth-card">
          <h2>Войти в ArtHello Pay</h2>
          <p>Используйте отдельный доступ администратора оплат или учётную запись владельца.</p>
          <form class="form-stack" id="login-form">
            ${error ? `<div class="form-error">${escapeHtml(error)}</div>` : ""}
            <div class="field"><label for="login">Логин</label><input class="input" id="login" name="login" autocomplete="username" required /></div>
            <div class="field"><label for="password">Пароль</label><input class="input" id="password" name="password" type="password" autocomplete="current-password" required /></div>
            <button class="primary-button full-button" type="submit">Войти</button>
          </form>
        </div>
      </section>
    </main>`;
}

function renderPasswordChange(error = "") {
  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-brand-panel">
        <div class="brand-lockup"><div class="brand-mark">A</div><div class="brand-copy"><strong>ArtHello Pay</strong><span>первый вход</span></div></div>
        <div class="auth-pitch"><div class="eyebrow">Безопасность доступа</div><h1>Задайте свой пароль.</h1><p>Временный пароль действует только для первого входа. После смены все старые сессии закрываются автоматически.</p></div>
        <div class="security-note"><span class="security-dot"></span>Пароль не даёт доступа к интернет-банку</div>
      </section>
      <section class="auth-form-panel">
        <div class="auth-card">
          <h2>Сменить временный пароль</h2>
          <p>После сохранения потребуется войти ещё раз уже с новым паролем.</p>
          <form class="form-stack" id="password-form">
            ${error ? `<div class="form-error">${escapeHtml(error)}</div>` : ""}
            <div class="field"><label for="current-password">Текущий пароль</label><input class="input" id="current-password" name="currentPassword" type="password" autocomplete="current-password" required /></div>
            <div class="field"><label for="new-password">Новый пароль</label><input class="input" id="new-password" name="newPassword" type="password" autocomplete="new-password" required /></div>
            <button class="primary-button full-button" type="submit">Сохранить пароль</button>
          </form>
        </div>
      </section>
    </main>`;
}

function filteredObligations() {
  const query = state.search.trim().toLowerCase();
  return state.obligations.filter((item) => {
    if (state.statusFilter !== "all" && item.status !== state.statusFilter)
      return false;
    if (!query) return true;
    const branch = catalogFor(item.branchCrmId, item.legalEntityId);
    return [
      item.purpose,
      item.studentCrmId,
      item.contractId,
      branch?.branchName,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
}

function catalogFor(branchCrmId, legalEntityId) {
  return (
    state.catalog.find(
      (item) =>
        item.branchCrmId === branchCrmId &&
        item.legalEntityId === legalEntityId,
    ) ?? null
  );
}

function requestForObligation(obligationId) {
  return (
    state.requests.find((item) => item.obligationId === obligationId) ?? null
  );
}

function publicLink(request) {
  return `${window.location.origin}/p/${encodeURIComponent(request.paymentLinkId)}`;
}

function stats() {
  const today = todayIso();
  const open = state.obligations.filter(
    (item) =>
      item.status === "open" && item.confirmedPaidKopecks < item.amountKopecks,
  );
  const outstanding = open.reduce(
    (sum, item) =>
      sum + Math.max(0, item.amountKopecks - item.confirmedPaidKopecks),
    0,
  );
  const overdue = open.filter(
    (item) => item.dueDate && item.dueDate < today,
  ).length;
  const waiting = state.requests.filter((item) =>
    activeRequestStatuses.has(item.status),
  ).length;
  const receipts = state.requests.filter(
    (item) =>
      item.receiptStatus &&
      !["fiscalized", "done", "sent"].includes(item.receiptStatus),
  ).length;
  return { outstanding, overdue, waiting, receipts };
}

function navMarkup() {
  const items = [
    ["overview", "⌂", "Обзор"],
    ["obligations", "₽", "Начисления"],
    ["requests", "↗", "Платежи"],
    ["automation", "↻", "Автоматизация"],
  ];
  return items
    .map(
      ([id, icon, label]) => `
    <button class="nav-item ${state.view === id ? "is-active" : ""}" type="button" data-nav="${id}">
      <span class="nav-icon">${icon}</span><span>${label}</span>${id === "requests" && state.requests.length ? `<span class="nav-badge">${state.requests.length}</span>` : ""}
    </button>`,
    )
    .join("");
}

function mobileNavMarkup() {
  const items = [
    ["overview", "⌂", "Обзор"],
    ["obligations", "₽", "Начисления"],
    ["requests", "↗", "Платежи"],
    ["automation", "↻", "Авто"],
  ];
  return `<nav class="mobile-bottom-nav">${items.map(([id, icon, label]) => `<button class="mobile-nav-item ${state.view === id ? "is-active" : ""}" type="button" data-nav="${id}"><span>${icon}</span>${label}</button>`).join("")}</nav>`;
}

function renderShell() {
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand-lockup"><div class="brand-mark">A</div><div class="brand-copy"><strong>ArtHello Pay</strong><span>приём платежей</span></div></div>
        <div class="sidebar-section-label">Рабочее пространство</div>
        <nav class="nav-list">${navMarkup()}</nav>
        <div class="sidebar-spacer"></div>
        <div class="quick-card safety-card" style="margin:0 0 14px;padding:15px">
          <div class="safety-line" style="margin-top:0"><span class="safety-check">✓</span><div><strong style="font-size:12px">Банк изолирован</strong><br><span style="font-size:11px;color:rgba(255,255,255,.62)">Нет остатков и исходящих платежей</span></div></div>
        </div>
        <div class="sidebar-user"><div class="avatar">${escapeHtml(initials(state.user?.name))}</div><div class="sidebar-user-copy"><strong>${escapeHtml(state.user?.name)}</strong><span>${escapeHtml(roleLabel(state.user))}</span></div><button class="logout-icon" type="button" data-action="logout" aria-label="Выйти">↪</button></div>
      </aside>
      <main class="main">
        <header class="mobile-topbar"><div class="brand-lockup"><div class="brand-mark">A</div><div class="brand-copy"><strong>ArtHello Pay</strong><span>${escapeHtml(roleLabel(state.user))}</span></div></div><button class="icon-button" type="button" data-action="logout" aria-label="Выйти">↪</button></header>
        <div class="page">${renderCurrentView()}</div>
      </main>
      ${mobileNavMarkup()}
    </div>
    ${renderModal()}`;
}

function renderCurrentView() {
  if (state.view === "obligations") return renderObligations();
  if (state.view === "requests") return renderRequests();
  if (state.view === "automation") return renderAutomation();
  return renderOverview();
}

function renderOverview() {
  const summary = stats();
  const recent = state.obligations.slice(0, 7);
  return `
    <section>
      <div class="page-heading">
        <div><div class="eyebrow">Единый контур оплат</div><h1>Оплаты без доступа в банк</h1><p>Начисления, ссылки, статусы и чеки — в одном окне. Получатель определяется системой по филиалу и юридическому лицу.</p></div>
        <div class="heading-actions"><button class="primary-button" type="button" data-action="new-payment">+ Создать оплату</button></div>
      </div>
      <div class="kpi-grid">
        ${kpi("К оплате", formatMoney(summary.outstanding), "текущий остаток начислений", "₽")}
        ${kpi("Ожидают оплаты", String(summary.waiting), "активные платёжные ссылки", "↗")}
        ${kpi("Просрочено", String(summary.overdue), "начисления после срока", "!")}
        ${kpi("Чеки в работе", String(summary.receipts), "ожидают фискализации", "✓")}
      </div>
      <div class="workspace-grid">
        <article class="panel">
          <div class="panel-header"><div><h2>Последние начисления</h2><p>Система не создаёт вторую активную ссылку на тот же долг.</p></div><button class="secondary-button" type="button" data-nav="obligations">Все начисления</button></div>
          ${renderObligationRows(recent, true)}
        </article>
        <div class="side-stack">
          <article class="quick-card"><h3>Маршрутизация</h3><p>Филиал автоматически определяет правильного получателя.</p><div class="quick-list">${
            state.catalog
              .slice(0, 5)
              .map(
                (item) =>
                  `<div class="quick-line"><span>${escapeHtml(item.branchName)}</span><strong>${escapeHtml(item.legalEntityName)}</strong></div>`,
              )
              .join("") ||
            `<div class="empty-state" style="padding:18px 0"><strong>Маршруты не найдены</strong></div>`
          }</div></article>
          <article class="quick-card safety-card"><h3>Что администратор не видит</h3><p>Ограничение работает на API, а не только в интерфейсе.</p><div class="safety-line"><span class="safety-check">✓</span><span>Остатки на расчётных счетах</span></div><div class="safety-line"><span class="safety-check">✓</span><span>Банковские выписки и токены</span></div><div class="safety-line"><span class="safety-check">✓</span><span>Создание исходящих платежей</span></div></article>
        </div>
      </div>
    </section>`;
}

function kpi(label, value, note, icon) {
  return `<article class="kpi-card"><div class="kpi-top"><span>${escapeHtml(label)}</span><span class="kpi-icon">${icon}</span></div><div><div class="kpi-value">${escapeHtml(value)}</div><div class="kpi-note">${escapeHtml(note)}</div></div></article>`;
}

function renderObligations() {
  const items = filteredObligations();
  return `
    <section>
      <div class="page-heading"><div><div class="eyebrow">Реестр</div><h1>Начисления</h1><p>Каждое начисление связано с конкретным филиалом, получателем и периодом.</p></div><div class="heading-actions"><button class="primary-button" type="button" data-action="new-payment">+ Создать оплату</button></div></div>
      <article class="panel">
        <div class="panel-header"><div><h2>Все начисления</h2><p>${items.length} из ${state.obligations.length}</p></div><div class="toolbar"><div class="search-wrap"><input class="input" id="obligation-search" data-search placeholder="Ребёнок, назначение, договор" value="${escapeHtml(state.search)}" /></div><select class="select compact-select" data-status-filter><option value="all" ${state.statusFilter === "all" ? "selected" : ""}>Все статусы</option><option value="open" ${state.statusFilter === "open" ? "selected" : ""}>К оплате</option><option value="paid" ${state.statusFilter === "paid" ? "selected" : ""}>Оплачено</option></select></div></div>
        ${renderObligationRows(items)}
      </article>
    </section>`;
}

function renderObligationRows(items, compact = false) {
  if (!items.length)
    return `<div class="empty-state"><div class="empty-icon">₽</div><strong>Начислений пока нет</strong><p>Создайте первую оплату — получатель будет выбран автоматически по филиалу.</p></div>`;
  return `<div class="data-list">${items
    .map((item) => {
      const branch = catalogFor(item.branchCrmId, item.legalEntityId);
      const request = requestForObligation(item.id);
      const outstanding = Math.max(
        0,
        item.amountKopecks - item.confirmedPaidKopecks,
      );
      return `<div class="data-row">
      <div class="data-primary"><strong>${escapeHtml(item.purpose)}</strong><span>${escapeHtml(branch?.branchName || item.branchCrmId)} · ${escapeHtml(formatPeriod(item.billingPeriod))}</span></div>
      <div class="data-secondary"><strong>${escapeHtml(item.studentName || (item.studentCrmId ? `Ученик ${item.studentCrmId}` : "Клиент"))}</strong><span>${escapeHtml(branch?.legalEntityName || "Получатель определён системой")}</span></div>
      <div>${statusPill(request?.status || item.status)}</div>
      <div class="money">${escapeHtml(formatMoney(outstanding))}</div>
      <button class="row-action" type="button" data-action="obligation-menu" data-id="${escapeHtml(item.id)}" aria-label="Действия">•••</button>
    </div>`;
    })
    .join("")}</div>`;
}

function renderRequests() {
  const items = state.requests;
  return `
    <section>
      <div class="page-heading"><div><div class="eyebrow">Ссылки и чеки</div><h1>Платежи</h1><p>Одна стабильная ссылка остаётся у клиента; после подключения Точки внутри неё появятся доступные способы оплаты.</p></div><div class="heading-actions"><button class="primary-button" type="button" data-action="new-payment">+ Создать оплату</button></div></div>
      <article class="panel">
        <div class="panel-header"><div><h2>Платёжные ссылки</h2><p>${items.length} запросов</p></div></div>
        ${
          items.length
            ? `<div class="data-list">${items
                .map((item) => {
                  const branch = catalogFor(
                    item.branchCrmId,
                    item.legalEntityId,
                  );
                  return `<div class="data-row">
            <div class="data-primary"><strong>${escapeHtml(item.purpose || item.paymentLinkId)}</strong><span>${escapeHtml(branch?.branchName || item.branchCrmId || "Филиал")}</span></div>
            <div class="data-secondary"><strong>${escapeHtml(item.recipientLabel || branch?.legalEntityName || "Получатель")}</strong><span>Чек: ${escapeHtml(item.receiptStatus || "ожидается")}</span></div>
            <div>${statusPill(item.status)}</div>
            <div class="money">${escapeHtml(formatMoney(item.amountKopecks))}</div>
            <button class="row-action" type="button" data-action="request-menu" data-id="${escapeHtml(item.id)}" aria-label="Действия">•••</button>
          </div>`;
                })
                .join("")}</div>`
            : `<div class="empty-state"><div class="empty-icon">↗</div><strong>Платёжных ссылок пока нет</strong><p>Ссылка появится после создания начисления и проверки маршрута.</p></div>`
        }
      </article>
    </section>`;
}

function renderAutomation() {
  return `
    <section>
      <div class="page-heading"><div><div class="eyebrow">Следующий слой</div><h1>Автоматическое выставление</h1><p>Этот экран уже закладывает будущую логику: в указанную дату система проверяет факт оплаты и выставляет только реальный остаток.</p></div><div class="heading-actions"><span class="status-pill warning">После подключения Точки</span></div></div>
      <article class="automation-card">
        <div class="panel-header" style="padding:0 0 18px;border:0"><div><h2>Ежемесячный сценарий</h2><p>Единый алгоритм для ручного и автоматического выставления.</p></div></div>
        <div class="automation-flow">
          <div class="flow-step"><small>01 · ДАТА</small><strong>Наступает день начисления</strong><p>Например, 1 число каждого месяца.</p></div>
          <div class="flow-step"><small>02 · СВЕРКА</small><strong>Проверяем оплаты</strong><p>Банк + CRM + уже созданные запросы.</p></div>
          <div class="flow-step"><small>03 · РЕШЕНИЕ</small><strong>Считаем остаток</strong><p>Оплачено — пропускаем; частично — только разница.</p></div>
          <div class="flow-step"><small>04 · ССЫЛКА</small><strong>Создаём оплату</strong><p>Правильное юрлицо и фискальный профиль.</p></div>
          <div class="flow-step"><small>05 · КОНТРОЛЬ</small><strong>Напоминание</strong><p>Только если долг всё ещё существует.</p></div>
        </div>
      </article>
      <div class="workspace-grid" style="margin-top:16px">
        <article class="quick-card"><h3>Что уже работает одинаково</h3><p>Автоматизация будет использовать существующую политику, а не отдельный набор правил.</p><div class="safety-line" style="color:var(--ah-text-secondary)"><span class="safety-check">✓</span><span>Не дублировать активную ссылку</span></div><div class="safety-line" style="color:var(--ah-text-secondary)"><span class="safety-check">✓</span><span>Не выставлять уже оплаченное</span></div><div class="safety-line" style="color:var(--ah-text-secondary)"><span class="safety-check">✓</span><span>Не угадывать при неоднозначной сверке</span></div></article>
        <article class="quick-card"><h3>Следующий этап</h3><p>После активации интернет-эквайринга Точки добавим расписание, канал отправки и правила напоминаний.</p><button class="secondary-button" type="button" disabled>Настроить расписание</button></article>
      </div>
    </section>`;
}

function renderModal() {
  if (!state.modal) return "";
  if (state.modal.type === "actions") return renderActionsModal();
  if (state.modal.step === "success") return renderSuccessModal();
  return renderCreateModal();
}

function branchOptions() {
  return state.catalog
    .map(
      (item) =>
        `<option value="${escapeHtml(item.branchCrmId)}" data-legal="${escapeHtml(item.legalEntityId)}" ${state.modal?.branchCrmId === item.branchCrmId ? "selected" : ""}>${escapeHtml(item.branchName)} · ${escapeHtml(item.legalEntityName)}</option>`,
    )
    .join("");
}

function renderCreateModal() {
  const modal = state.modal;
  const selected = modal.selectedCustomer;
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="create-title" data-modal-stop>
        <header class="modal-header"><div><h2 id="create-title">Создать оплату</h2><p>Получатель определяется по филиалу автоматически.</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Закрыть">×</button></header>
        <form id="create-payment-form">
          <div class="modal-body">
            ${modal.error ? `<div class="form-error" style="margin-bottom:18px">${escapeHtml(modal.error)}</div>` : ""}
            <section class="form-section">
              <div class="form-section-title"><strong>1. Филиал и клиент</strong><span>Оператор видит только разрешённые ему филиалы.</span></div>
              <div class="field"><label for="branch">Филиал</label><select class="select" id="branch" name="branchCrmId" data-create-branch required><option value="">Выберите филиал</option>${branchOptions()}</select></div>
              ${
                modal.branchCrmId
                  ? selected
                    ? `
                <div style="margin-top:12px" class="selected-customer"><div class="customer-avatar">${escapeHtml(initials(selected.studentName))}</div><div class="customer-copy"><strong>${escapeHtml(selected.studentName)}</strong><span>${escapeHtml(selected.payerName || "Плательщик не указан")} · ${escapeHtml(selected.payerPhone || selected.payerEmail || "контакт не найден")}</span></div><button class="text-action" type="button" data-action="change-customer">Изменить</button></div>`
                    : `
                <div class="field" style="margin-top:12px"><label for="customer-search">Ребёнок / семья</label><input class="input" id="customer-search" data-customer-search placeholder="Начните вводить фамилию или телефон" value="${escapeHtml(modal.customerQuery || "")}" /></div>
                <div class="customer-search-results">${renderCustomerResults()}</div>`
                  : ""
              }
              ${
                modal.branchCrmId && !selected
                  ? `
                <div class="quick-card" style="margin-top:12px;padding:16px">
                  <div class="form-section-title"><strong>Нет в справочнике?</strong><span>Можно создать оплату вручную. После синхронизации семьи будут подставляться автоматически.</span></div>
                  <div class="input-row" style="margin-top:12px">
                    <div class="field"><label for="manual-student-name">Ребёнок</label><input class="input" id="manual-student-name" name="manualStudentName" data-manual-field="manualStudentName" placeholder="Имя и фамилия" value="${escapeHtml(modal.manualStudentName || "")}" /></div>
                    <div class="field"><label for="manual-payer-name">Плательщик</label><input class="input" id="manual-payer-name" name="manualPayerName" data-manual-field="manualPayerName" placeholder="Имя плательщика" value="${escapeHtml(modal.manualPayerName || "")}" /></div>
                  </div>
                </div>`
                  : ""
              }
            </section>
            <section class="form-section">
              <div class="form-section-title"><strong>2. Начисление</strong><span>Сумма фиксируется в момент создания платёжного запроса.</span></div>
              <div class="input-row"><div class="field"><label for="period">Период</label><input class="input" id="period" name="period" type="month" value="${escapeHtml(modal.period || currentMonthValue())}" required /></div><div class="field"><label for="amount">Сумма, ₽</label><input class="input" id="amount" name="amount" inputmode="decimal" placeholder="45 000" value="${escapeHtml(modal.amount || "")}" required /></div></div>
              <div class="field" style="margin-top:12px"><label for="purpose">Назначение</label><input class="input" id="purpose" name="purpose" placeholder="Обучение за сентябрь 2026" value="${escapeHtml(modal.purpose || "")}" required /></div>
              <div class="field" style="margin-top:12px"><label for="due-date">Оплатить до</label><input class="input" id="due-date" name="dueDate" type="date" value="${escapeHtml(modal.dueDate || "")}" /></div>
            </section>
            <section class="form-section">
              <div class="form-section-title"><strong>3. Электронный чек</strong><span>Контакт подставляется из карточки семьи, его можно поправить для конкретной оплаты.</span></div>
              <div class="input-row"><div class="field"><label for="payer-email">Email</label><input class="input" id="payer-email" name="payerEmail" type="email" value="${escapeHtml(modal.payerEmail ?? selected?.payerEmail ?? "")}" /></div><div class="field"><label for="payer-phone">Телефон</label><input class="input" id="payer-phone" name="payerPhone" inputmode="tel" value="${escapeHtml(modal.payerPhone ?? selected?.payerPhone ?? "")}" /></div></div>
              <p class="form-hint" style="margin-top:8px">Для фискального чека должен быть указан хотя бы один корректный электронный контакт.</p>
            </section>
          </div>
          <footer class="modal-footer"><button class="secondary-button" type="button" data-action="close-modal">Отмена</button><button class="primary-button" type="submit" ${modal.submitting ? "disabled" : ""}>${modal.submitting ? "Создаём…" : "Создать ссылку"}</button></footer>
        </form>
      </section>
    </div>`;
}

function renderCustomerResults() {
  if (state.customerLoading)
    return `<div class="empty-state" style="padding:20px"><div class="spinner" style="width:24px;height:24px;margin-bottom:10px"></div><p>Ищем клиентов…</p></div>`;
  if (!state.customerResults.length)
    return `<div class="empty-state" style="padding:20px"><strong>Клиентов в справочнике пока нет</strong><p>Выберите клиента после синхронизации или заполните ребёнка вручную ниже.</p></div>`;
  return state.customerResults
    .map(
      (item, index) =>
        `<button class="customer-option" type="button" data-action="select-customer" data-customer-index="${index}"><span class="customer-avatar">${escapeHtml(initials(item.studentName))}</span><span class="customer-copy"><strong>${escapeHtml(item.studentName)}</strong><span>${escapeHtml(item.payerName || "Семья")} · ${escapeHtml(item.payerPhone || item.payerEmail || "без контакта")}</span></span><span>→</span></button>`,
    )
    .join("");
}

function renderSuccessModal() {
  const { request, obligation, warning } = state.modal;
  const link = request ? publicLink(request) : null;
  return `
    <div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" data-modal-stop>
      <header class="modal-header"><div><h2>Оплата подготовлена</h2><p>${warning ? "Начисление создано, но ссылку пока нельзя активировать." : "Стабильная ссылка создана."}</p></div><button class="modal-close" type="button" data-action="close-modal">×</button></header>
      <div class="modal-body">
        <div class="success-box"><h3>${warning ? "Нужна настройка маршрута" : "Готово"}</h3><p>${escapeHtml(warning || "Эту ссылку можно использовать и после подключения банковского адаптера — менять её клиенту не потребуется.")}</p></div>
        ${link ? `<div class="link-box"><input class="input" readonly value="${escapeHtml(link)}" aria-label="Ссылка на оплату" /><button class="secondary-button" type="button" data-action="copy-link" data-link="${escapeHtml(link)}">Копировать</button></div><div class="button-row" style="margin-top:12px"><a class="primary-button" style="text-decoration:none;display:grid;place-items:center" href="${escapeHtml(link)}" target="_blank" rel="noopener">Открыть страницу оплаты</a></div>` : ""}
        <div class="quick-card" style="margin-top:18px"><div class="quick-list"><div class="quick-line"><span>Начисление</span><strong>${escapeHtml(obligation?.purpose || "Создано")}</strong></div><div class="quick-line"><span>Сумма</span><strong>${escapeHtml(formatMoney(request?.amountKopecks || obligation?.amountKopecks || 0))}</strong></div>${request ? `<div class="quick-line"><span>Статус</span><strong>${escapeHtml(statusMeta(request.status)[0])}</strong></div>` : ""}</div></div>
      </div>
      <footer class="modal-footer"><button class="primary-button" type="button" data-action="close-modal">Закрыть</button></footer>
    </section></div>`;
}

function renderActionsModal() {
  const item = state.modal.item;
  const isRequest = state.modal.kind === "request";
  const request = isRequest ? item : requestForObligation(item.id);
  const link = request ? publicLink(request) : null;
  return `
    <div class="modal-backdrop" data-action="close-modal"><section class="modal" style="width:min(520px,100%)" role="dialog" aria-modal="true" data-modal-stop>
      <header class="modal-header"><div><h2>${escapeHtml(isRequest ? item.purpose || "Платёж" : item.purpose)}</h2><p>${escapeHtml(isRequest ? item.paymentLinkId : formatPeriod(item.billingPeriod))}</p></div><button class="modal-close" type="button" data-action="close-modal">×</button></header>
      <div class="modal-body">
        <div class="quick-list">
          <div class="quick-line"><span>Сумма</span><strong>${escapeHtml(formatMoney(isRequest ? item.amountKopecks : item.amountKopecks - item.confirmedPaidKopecks))}</strong></div>
          <div class="quick-line"><span>Статус</span><strong>${escapeHtml(statusMeta(request?.status || item.status)[0])}</strong></div>
          ${request?.receiptStatus ? `<div class="quick-line"><span>Чек</span><strong>${escapeHtml(request.receiptStatus)}</strong></div>` : ""}
        </div>
        ${link ? `<div class="link-box"><input class="input" readonly value="${escapeHtml(link)}" /><button class="secondary-button" type="button" data-action="copy-link" data-link="${escapeHtml(link)}">Копировать</button></div>` : `<div class="payment-waiting" style="margin-top:16px">Для этого начисления ещё нет активной платёжной ссылки.</div>`}
      </div>
      <footer class="modal-footer">${request?.status === "ready" ? `<button class="danger-button" type="button" data-action="cancel-request" data-id="${escapeHtml(request.id)}">Отменить запрос</button>` : ""}<button class="secondary-button" type="button" data-action="close-modal">Закрыть</button></footer>
    </section></div>`;
}

async function loadCustomers(branchCrmId, query = "") {
  if (!branchCrmId) return;
  state.customerLoading = true;
  renderShell();
  try {
    state.customerResults = await api(
      `/api/payments/customers?branchCrmId=${encodeURIComponent(branchCrmId)}&q=${encodeURIComponent(query)}`,
    );
  } catch (error) {
    state.customerResults = [];
    toast(error.message, "error");
  } finally {
    state.customerLoading = false;
    renderShell();
  }
}

async function loadWorkspace() {
  const [catalog, obligations, requests] = await Promise.all([
    api("/api/payments/catalog"),
    api("/api/payments/obligations"),
    api("/api/payments/requests"),
  ]);
  state.catalog = catalog;
  state.obligations = obligations;
  state.requests = requests;
}

async function performLogin(form) {
  const formData = new FormData(form);
  const login = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  renderLoading("Проверяем доступ");
  try {
    const session = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ login, password }),
    });
    state.user = { ...session, scope: null };
    if (session.mustChangePassword) {
      renderPasswordChange();
      return;
    }
    const me = await api("/api/auth/me");
    state.user = me;
    if (!canUsePay(me)) {
      await safeLogout();
      renderLogin("Эта учётная запись не имеет доступа к ArtHello Pay.");
      return;
    }
    await loadWorkspace();
    renderShell();
  } catch (error) {
    renderLogin(error.message);
  }
}

async function changePassword(form) {
  const formData = new FormData(form);
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  try {
    await api("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    state.user = null;
    renderLogin();
    toast("Пароль изменён. Войдите снова.", "success");
  } catch (error) {
    renderPasswordChange(error.message);
  }
}

async function safeLogout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch (_) {
    /* session may already be gone */
  }
  state.user = null;
  state.catalog = [];
  state.obligations = [];
  state.requests = [];
}

async function createPayment(form) {
  const modal = state.modal;
  const selected = modal?.selectedCustomer;
  if (!modal) return;
  const formData = new FormData(form);
  const manualStudentName = String(
    formData.get("manualStudentName") ?? "",
  ).trim();
  const manualPayerName = String(formData.get("manualPayerName") ?? "").trim();
  if (!selected && !manualStudentName) {
    modal.error = "Выберите клиента или укажите ребёнка вручную.";
    renderShell();
    return;
  }
  const branchCrmId = String(formData.get("branchCrmId") ?? "");
  const catalog = state.catalog.find(
    (item) => item.branchCrmId === branchCrmId,
  );
  const rawAmount = String(formData.get("amount") ?? "")
    .replace(/\s/g, "")
    .replace(",", ".");
  const rubles = Number(rawAmount);
  if (!catalog || !Number.isFinite(rubles) || rubles <= 0) {
    modal.error = "Проверьте филиал и сумму.";
    renderShell();
    return;
  }
  const amountKopecks = Math.round(rubles * 100);
  const payerEmail = String(formData.get("payerEmail") ?? "").trim();
  const payerPhone = String(formData.get("payerPhone") ?? "").trim();
  if (!payerEmail && !payerPhone) {
    modal.error = "Укажите email или телефон для электронного чека.";
    renderShell();
    return;
  }
  modal.submitting = true;
  modal.error = "";
  renderShell();
  try {
    const period = String(formData.get("period") ?? "");
    const payload = {
      branchCrmId,
      legalEntityId: catalog.legalEntityId,
      familyId: selected?.familyId || undefined,
      payerPersonId: selected?.payerPersonId || undefined,
      studentPersonId: selected?.studentPersonId || undefined,
      studentCrmId: selected?.studentCrmId || undefined,
      studentName: selected?.studentName || manualStudentName,
      payerName: selected?.payerName || manualPayerName || undefined,
      billingPeriod: monthToDate(period),
      purpose: String(formData.get("purpose") ?? "").trim(),
      amountKopecks,
      dueDate: String(formData.get("dueDate") ?? "") || undefined,
      payerEmail: payerEmail || undefined,
      payerPhone: payerPhone || undefined,
      sourceRef: selected?.studentCrmId
        ? `pay-web:${selected.studentCrmId}:${period}:${amountKopecks}`
        : `pay-web:manual:${branchCrmId}:${period}:${amountKopecks}:${payerEmail || payerPhone}`,
    };
    const obligation = await api("/api/payments/obligations", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const preview = await api(
      `/api/payments/obligations/${encodeURIComponent(obligation.id)}/requests/preview`,
      { method: "POST" },
    );
    if (preview.decision?.action !== "ISSUE") {
      state.modal = {
        step: "success",
        obligation,
        warning:
          preview.decision?.reason ||
          "Ссылка не создана: начисление требует проверки.",
      };
      await loadWorkspace();
      renderShell();
      return;
    }
    if (!preview.route?.ready) {
      state.modal = {
        step: "success",
        obligation,
        warning: `Маршрут оплаты ещё не готов: ${preview.route?.reason || "требуется настройка владельца"}.`,
      };
      await loadWorkspace();
      renderShell();
      return;
    }
    const request = await api(
      `/api/payments/obligations/${encodeURIComponent(obligation.id)}/requests`,
      {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
      },
    );
    state.modal = { step: "success", obligation, request };
    await loadWorkspace();
    renderShell();
  } catch (error) {
    modal.submitting = false;
    modal.error = error.message;
    renderShell();
  }
}

async function cancelRequest(id) {
  try {
    await api(`/api/payments/requests/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    });
    state.modal = null;
    await loadWorkspace();
    renderShell();
    toast("Платёжный запрос отменён.", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (_) {
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast("Ссылка скопирована.", "success");
}

function openNewPayment() {
  const first = state.catalog[0] ?? null;
  state.customerResults = [];
  state.modal = {
    step: "form",
    branchCrmId: first?.branchCrmId || "",
    selectedCustomer: null,
    customerQuery: "",
    period: currentMonthValue(),
    amount: "",
    purpose: "",
    dueDate: "",
    manualStudentName: "",
    manualPayerName: "",
    submitting: false,
    error: "",
  };
  renderShell();
  if (first) void loadCustomers(first.branchCrmId, "");
}

function scheduleCustomerSearch(value) {
  if (!state.modal) return;
  state.modal.customerQuery = value;
  window.clearTimeout(state.customerSearchTimer);
  state.customerSearchTimer = window.setTimeout(() => {
    void loadCustomers(state.modal?.branchCrmId || "", value);
  }, 260);
}

async function renderPublicPayment() {
  const match = window.location.pathname.match(/^\/p\/(AH-[0-9a-f-]+)\/?$/i);
  if (!match) return false;
  renderLoading("Открываем оплату");
  try {
    const payment = await api(
      `/api/payments/public/${encodeURIComponent(match[1])}`,
    );
    const paid =
      paidRequestStatuses.has(payment.status) ||
      ["fiscalized", "posted"].includes(payment.status);
    app.innerHTML = `
      <main class="public-page">
        <header class="public-header"><div class="brand-lockup"><div class="brand-mark">A</div><div class="brand-copy"><strong>ArtHello Pay</strong><span>безопасная оплата</span></div></div></header>
        <section class="public-main">
          <article class="payment-card">
            <div class="payment-card-head"><div class="payment-kicker">${escapeHtml(payment.recipientLabel)}</div><h1>${escapeHtml(payment.purpose)}</h1>${payment.studentName ? `<div class="payment-person">${escapeHtml(payment.studentName)}</div>` : ""}</div>
            <div class="payment-card-body">
              <div class="payment-amount">${escapeHtml(formatMoney(payment.amountKopecks))}</div>
              <div class="payment-meta">
                <div class="payment-meta-row"><span>Получатель</span><strong>${escapeHtml(payment.recipientLabel)}</strong></div>
                <div class="payment-meta-row"><span>Период</span><strong>${escapeHtml(formatPeriod(payment.billingPeriod))}</strong></div>
                <div class="payment-meta-row"><span>Оплатить до</span><strong>${escapeHtml(formatDate(payment.dueDate))}</strong></div>
              </div>
              ${
                paid
                  ? `<div class="payment-paid"><strong>Оплачено</strong><span>${payment.receiptUrl ? "Электронный чек уже сформирован." : "Платёж подтверждён. Чек появится здесь после фискализации."}</span></div>${payment.receiptUrl ? `<a class="secondary-button full-button" style="margin-top:12px;text-decoration:none;display:grid;place-items:center" href="${escapeHtml(payment.receiptUrl)}" target="_blank" rel="noopener">Открыть чек</a>` : ""}`
                  : payment.canPay
                    ? `
                <div class="payment-methods"><div class="payment-method"><strong>СБП</strong><span>QR или переход в банковское приложение</span></div><div class="payment-method"><strong>Банковская карта</strong><span>Без сохранения данных карты в ArtHello</span></div></div>
                <a class="primary-button full-button" style="text-decoration:none;display:grid;place-items:center" href="${escapeHtml(payment.paymentUrl)}" rel="noopener">Перейти к оплате</a>`
                    : `
                <div class="payment-waiting"><strong>Оплата ещё активируется.</strong><br>Ссылка уже создана, но банковский приём платежа пока не включён. Не переводите деньги вручную по реквизитам — дождитесь активации этой страницы.</div>`
              }
            </div>
          </article>
        </section>
        <footer class="public-footer">ArtHello Pay · данные карты обрабатывает платёжный провайдер</footer>
      </main>`;
  } catch (error) {
    app.innerHTML = `<main class="loading-page"><div class="loading-card"><div class="brand-mark" style="margin:0 auto 18px">A</div><h2 style="margin:0">Ссылка недоступна</h2><p style="color:var(--ah-text-secondary);line-height:22px">${escapeHtml(error.message)}</p></div></main>`;
  }
  return true;
}

app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === "login-form") void performLogin(form);
  if (form.id === "password-form") void changePassword(form);
  if (form.id === "create-payment-form") void createPayment(form);
});

app.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.matches("[data-search]")) {
    state.search = target.value;
    renderShell();
    const input = document.querySelector("[data-search]");
    input?.focus();
    if (input instanceof HTMLInputElement)
      input.setSelectionRange(input.value.length, input.value.length);
  }
  if (target.matches("[data-customer-search]"))
    scheduleCustomerSearch(target.value);
  const manualField = target.getAttribute("data-manual-field");
  if (manualField && state.modal) state.modal[manualField] = target.value;
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (
    target instanceof HTMLSelectElement &&
    target.matches("[data-status-filter]")
  ) {
    state.statusFilter = target.value;
    renderShell();
  }
  if (
    target instanceof HTMLSelectElement &&
    target.matches("[data-create-branch]")
  ) {
    if (!state.modal) return;
    state.modal.branchCrmId = target.value;
    state.modal.selectedCustomer = null;
    state.modal.customerQuery = "";
    state.modal.manualStudentName = "";
    state.modal.manualPayerName = "";
    state.customerResults = [];
    renderShell();
    if (target.value) void loadCustomers(target.value, "");
  }
});

app.addEventListener("click", (event) => {
  const raw = event.target;
  if (!(raw instanceof Element)) return;
  const nav = raw.closest("[data-nav]");
  if (nav) {
    state.view = nav.getAttribute("data-nav") || "overview";
    state.modal = null;
    renderShell();
    return;
  }
  const action = raw.closest("[data-action]");
  if (!action) return;
  const name = action.getAttribute("data-action");
  if (name === "close-modal") {
    if (
      raw.closest("[data-modal-stop]") &&
      raw === action.closest("[data-modal-stop]")
    )
      return;
    state.modal = null;
    renderShell();
  }
  if (name === "new-payment") openNewPayment();
  if (name === "logout") void safeLogout().then(() => renderLogin());
  if (name === "select-customer") {
    const index = Number(action.getAttribute("data-customer-index"));
    const customer = state.customerResults[index];
    if (state.modal && customer) {
      state.modal.selectedCustomer = customer;
      state.modal.payerEmail = customer.payerEmail || "";
      state.modal.payerPhone = customer.payerPhone || "";
      renderShell();
    }
  }
  if (name === "change-customer" && state.modal) {
    state.modal.selectedCustomer = null;
    renderShell();
    void loadCustomers(
      state.modal.branchCrmId,
      state.modal.customerQuery || "",
    );
  }
  if (name === "copy-link")
    void copyText(action.getAttribute("data-link") || "");
  if (name === "cancel-request")
    void cancelRequest(action.getAttribute("data-id") || "");
  if (name === "request-menu") {
    const item = state.requests.find(
      (request) => request.id === action.getAttribute("data-id"),
    );
    if (item) {
      state.modal = { type: "actions", kind: "request", item };
      renderShell();
    }
  }
  if (name === "obligation-menu") {
    const item = state.obligations.find(
      (obligation) => obligation.id === action.getAttribute("data-id"),
    );
    if (item) {
      state.modal = { type: "actions", kind: "obligation", item };
      renderShell();
    }
  }
});

app.addEventListener("click", (event) => {
  const target = event.target;
  if (target instanceof Element && target.matches("[data-modal-stop]"))
    event.stopPropagation();
});

async function bootstrap() {
  if (await renderPublicPayment()) return;
  renderLoading();
  try {
    const me = await api("/api/auth/me");
    state.user = me;
    if (me.mustChangePassword) {
      renderPasswordChange();
      return;
    }
    if (!canUsePay(me)) {
      await safeLogout();
      renderLogin("Эта учётная запись не имеет доступа к ArtHello Pay.");
      return;
    }
    await loadWorkspace();
    renderShell();
  } catch (error) {
    if (error.status === 401) renderLogin();
    else renderLogin(error.message);
  }
}

void bootstrap();
