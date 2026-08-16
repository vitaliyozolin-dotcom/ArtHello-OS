const state = {
  data: null,
  activeView: "overview",
  filters: { search: "", portfolio: "all", status: "all", priority: "all" },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function formatDate(value) {
  if (!value) return "Не подтверждён";
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatDateTime(value) {
  if (!value) return "нет данных";
  const date = new Date(value);
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function plural(number, one, few, many) {
  const n = Math.abs(number) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function setView(view) {
  state.activeView = view;
  $$('[data-view]').forEach((section) => section.classList.toggle("is-visible", section.dataset.view === view));
  $$('[data-view-link]').forEach((link) => link.classList.toggle("is-active", link.dataset.viewLink === view));
  history.replaceState(null, "", `#${view}`);
  $(".sidebar")?.classList.remove("is-open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function metricCard(label, value, foot, color, tint) {
  return `<article class="metric-card" style="--metric-color:${color};--metric-tint:${tint}"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong><span class="metric-foot"><i class="metric-dot"></i>${escapeHtml(foot)}</span></article>`;
}

function renderMetrics() {
  const s = state.data.summary;
  $("#metricGrid").innerHTML = [
    metricCard("Активные находки", s.opportunities, "после фильтра качества", "#3157e7", "#eef2ff"),
    metricCard("Подтверждён приём", s.confirmed_open, "только с проверенным дедлайном", "#0e9f6e", "#e9fbf4"),
    metricCard("Требуют проверки", s.data_required, "дедлайн или профиль", "#d97706", "#fff5e8"),
    metricCard("Покрытие источников", `${s.source_coverage_percent}%`, `${s.sources_working} из ${s.sources_total} доступны`, "#12a9b5", "#e8fbfc"),
  ].join("");
}

function renderAttention() {
  const items = state.data.opportunities.filter((item) => item.operational_status !== "ARCHIVED").sort((a, b) => b.score - a.score).slice(0, 5);
  const container = $("#attentionList");
  if (!items.length) {
    container.innerHTML = '<div class="empty-state"><strong>Активных находок нет</strong><span>Следующий скан обновит реестр.</span></div>';
    return;
  }
  container.innerHTML = items.map((item) => `<button class="attention-item" data-open-id="${escapeHtml(item.id)}"><span class="score-box">${item.score}</span><span class="attention-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.operational_status_label)} · ${escapeHtml(item.portfolios.map(p => p.name).join(", ") || "Портфель не определён")}</span></span><span class="attention-arrow">›</span></button>`).join("");
}

function renderCoverage() {
  const summary = state.data.summary;
  const ring = $("#coverageRing");
  ring.style.setProperty("--percent", summary.source_coverage_percent);
  $("#coverageValue").textContent = `${summary.source_coverage_percent}%`;
  $("#coverageTitle").textContent = `${summary.sources_working} из ${summary.sources_total}`;
  const sources = [...state.data.source_health].sort((a, b) => (a.status === "OK" ? -1 : 1) - (b.status === "OK" ? -1 : 1)).slice(0, 5);
  $("#sourceMiniList").innerHTML = sources.map((source) => `<div class="source-mini"><span class="source-mini-name">${escapeHtml(source.name)}</span><span class="source-state state-${escapeHtml(source.status)}"><i class="state-dot"></i>${escapeHtml(source.status_label)}</span></div>`).join("");
}

function renderProfileStrip() {
  $("#profileStrip").innerHTML = state.data.profiles.map((profile) => `<article class="profile-mini"><div class="profile-mini-top"><strong>${escapeHtml(profile.display_name)}</strong><span class="profile-percent">${profile.profile_completeness}%</span></div><p>${escapeHtml(profile.subtitle)}</p><div class="progress"><span style="width:${profile.profile_completeness}%"></span></div></article>`).join("");
}

function renderProfiles() {
  $("#profileGrid").innerHTML = state.data.profiles.map((profile) => `<article class="profile-card"><div class="profile-card-head"><h3>${escapeHtml(profile.display_name)}<span>${escapeHtml(profile.subtitle)}</span></h3><div class="completeness"><strong>${profile.profile_completeness}%</strong><span>готовность</span></div></div><div class="progress" style="margin-top:15px"><span style="width:${profile.profile_completeness}%"></span></div><div class="profile-facts"><div class="fact"><span>Тип</span><strong>${escapeHtml(profile.legal_form)}</strong></div><div class="fact"><span>Софинансирование</span><strong>${escapeHtml(profile.cofinancing_band_rub)}</strong></div><div class="fact"><span>Регион</span><strong>${escapeHtml(profile.region.join(", "))}</strong></div><div class="fact"><span>Статус МСП</span><strong>${profile.sme_status === "unknown" ? "Не подтверждён" : escapeHtml(profile.sme_status)}</strong></div></div><div class="missing-title">Не хватает для eligibility</div><div class="missing-list">${profile.missing.map((item) => `<span class="missing-chip">${escapeHtml(item)}</span>`).join("")}</div></article>`).join("");
}

function populateFilters() {
  const select = $("#portfolioFilter");
  select.innerHTML = '<option value="all">Все портфели</option>' + state.data.profiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.display_name)} — ${escapeHtml(profile.subtitle)}</option>`).join("");
}

function filteredOpportunities() {
  const { search, portfolio, status, priority } = state.filters;
  const needle = search.trim().toLowerCase();
  return state.data.opportunities.filter((item) => {
    const matchesSearch = !needle || `${item.title} ${item.source_name}`.toLowerCase().includes(needle);
    const matchesPortfolio = portfolio === "all" || item.portfolios.some((p) => p.id === portfolio);
    const matchesStatus = status === "all" || item.operational_status === status;
    const matchesPriority = priority === "all" || item.priority === priority;
    return matchesSearch && matchesPortfolio && matchesStatus && matchesPriority;
  });
}

function renderOpportunities() {
  const items = filteredOpportunities();
  $("#resultsCount").textContent = `${items.length} ${plural(items.length, "возможность", "возможности", "возможностей")}`;
  $("#emptyState").classList.toggle("is-hidden", items.length > 0);
  $("#opportunitiesTable").innerHTML = items.map((item) => `<tr data-id="${escapeHtml(item.id)}"><td class="program-cell"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.decision_label)} · ${item.is_new ? "новая находка" : "в портфеле"}</span></td><td><div class="portfolio-tags">${item.portfolios.length ? item.portfolios.map(p => `<span class="mini-tag" title="${escapeHtml(p.subtitle)}">${escapeHtml(p.name)}</span>`).join("") : '<span class="mini-tag">Не определён</span>'}</div></td><td>${escapeHtml(item.source_name)}</td><td><span class="status-badge status-${escapeHtml(item.operational_status)}">${escapeHtml(item.operational_status_label)}</span></td><td><span class="score-pill">${item.score}</span></td><td><span class="row-arrow">›</span></td></tr>`).join("");
}

function renderSources() {
  $("#sourcesTable").innerHTML = state.data.source_health.map((source) => `<tr><td><strong>${escapeHtml(source.name)}</strong></td><td><span class="source-state state-${escapeHtml(source.status)}"><i class="state-dot"></i>${escapeHtml(source.status_label)}</span></td><td>${source.pages_scanned}</td><td>${source.links_seen}</td><td>${source.candidates_found}</td><td class="diagnostic">${source.error ? escapeHtml(source.error) : "Ошибок нет"}</td></tr>`).join("");
}

function openDrawer(id) {
  const item = state.data.opportunities.find((opportunity) => opportunity.id === id);
  if (!item) return;
  const portfolioHtml = item.portfolios.length ? item.portfolios.map((p) => `<span class="mini-tag">${escapeHtml(p.name)} · ${escapeHtml(p.subtitle)}</span>`).join("") : '<span class="mini-tag">Портфель не определён</span>';
  const missing = item.missing_profile_data.length ? item.missing_profile_data.map((value) => `<span class="missing-chip">${escapeHtml(value)}</span>`).join("") : '<span class="mini-tag">Нет данных</span>';
  $("#drawerContent").innerHTML = `<span class="drawer-kicker">${escapeHtml(item.source_name)}</span><h2>${escapeHtml(item.title)}</h2><div class="drawer-meta"><span class="status-badge status-${escapeHtml(item.operational_status)}">${escapeHtml(item.operational_status_label)}</span><span class="score-pill">Score ${item.score}</span><span class="mini-tag">${escapeHtml(item.decision_label)}</span></div><div class="drawer-grid"><div class="drawer-stat"><span>Дедлайн</span><strong>${escapeHtml(formatDate(item.deadline))}</strong></div><div class="drawer-stat"><span>Доверие к дедлайну</span><strong>${item.deadline_confidence === "verified" ? "Подтверждён" : "Не подтверждён"}</strong></div><div class="drawer-stat"><span>Режим данных</span><strong>Обезличенный precheck</strong></div><div class="drawer-stat"><span>Автоподача</span><strong>Заблокирована</strong></div></div><section class="drawer-section"><h3>Для каких портфелей</h3><div class="portfolio-tags">${portfolioHtml}</div></section><section class="drawer-section"><h3>Предварительная применимость</h3><p>${escapeHtml(item.eligibility_note)}</p></section><section class="drawer-section"><h3>Проверка источника</h3><p>${escapeHtml(item.verification_note)}</p></section><section class="drawer-section"><h3>Недостающие данные профилей</h3><div class="missing-list">${missing}</div></section><div class="action-row">${item.official_url ? `<a class="primary-button" href="${escapeHtml(item.official_url)}" target="_blank" rel="noopener noreferrer">Открыть официальный источник</a>` : '<button class="primary-button" disabled>Источник недоступен</button>'}<button class="disabled-button" title="Нужен проверенный профиль юридического лица">Проверить с реальными данными</button></div>`;
  $("#opportunityDrawer").classList.add("is-open");
  $("#opportunityDrawer").setAttribute("aria-hidden", "false");
  $("#drawerBackdrop").classList.add("is-open");
}

function closeDrawer() {
  $("#opportunityDrawer").classList.remove("is-open");
  $("#opportunityDrawer").setAttribute("aria-hidden", "true");
  $("#drawerBackdrop").classList.remove("is-open");
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const viewLink = event.target.closest("[data-view-link]");
    if (viewLink) { event.preventDefault(); setView(viewLink.dataset.viewLink); }
    const goView = event.target.closest("[data-go-view]");
    if (goView) setView(goView.dataset.goView);
    const open = event.target.closest("[data-open-id]");
    if (open) openDrawer(open.dataset.openId);
    const row = event.target.closest("tr[data-id]");
    if (row) openDrawer(row.dataset.id);
  });
  $("#drawerClose").addEventListener("click", closeDrawer);
  $("#drawerBackdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });
  $("#mobileMenu").addEventListener("click", () => $(".sidebar").classList.toggle("is-open"));
  $("#refreshButton").addEventListener("click", async () => { showToast("Проверяем опубликованные данные…"); await loadData(true); });
  $("#searchInput").addEventListener("input", (event) => { state.filters.search = event.target.value; renderOpportunities(); });
  $("#portfolioFilter").addEventListener("change", (event) => { state.filters.portfolio = event.target.value; renderOpportunities(); });
  $("#statusFilter").addEventListener("change", (event) => { state.filters.status = event.target.value; renderOpportunities(); });
  $("#priorityFilter").addEventListener("change", (event) => { state.filters.priority = event.target.value; renderOpportunities(); });
}

function renderAll() {
  $("#noticeText").textContent = state.data.meta.notice;
  $("#sidebarRuntime").textContent = `обновлено ${formatDateTime(state.data.meta.generated_at)}`;
  renderMetrics(); renderAttention(); renderCoverage(); renderProfileStrip(); renderProfiles(); populateFilters(); renderOpportunities(); renderSources();
}

async function loadData(force = false) {
  try {
    const response = await fetch(`./data.json${force ? `?t=${Date.now()}` : ""}`, { cache: force ? "no-store" : "default" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    renderAll();
    if (force) showToast("Данные обновлены");
  } catch (error) {
    $("#noticeText").textContent = "Не удалось загрузить опубликованный реестр. Технический контур продолжает работать; проверьте последний запуск Hunter.";
    $("#sidebarRuntime").textContent = "данные недоступны";
    console.error(error);
    if (force) showToast("Реестр пока недоступен");
  }
}

bindEvents();
const initialView = location.hash.replace("#", "");
if (["overview", "opportunities", "applicants", "sources"].includes(initialView)) setView(initialView);
loadData();
