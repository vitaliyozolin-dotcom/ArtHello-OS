"use client";

import { FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModuleId, moduleCatalog } from "../../data/test-snapshot";
import { canAccessModule, registryCapabilities, resolveModuleRoute } from "../../lib/access-policy";
import { humanPeriodLabel, humanTechnicalText, recordLabel, taskRecordLabel } from "../../lib/record-labels";
import { AppIcon } from "./AppIcon";
import { OwnerDashboard } from "./OwnerDashboard";
import { useProductionAuthActions, useProductionAuthUser } from "./ProductionAuthGate";
import type { AccessContext, SettingsTab } from "./SettingsWorkspace";
import "./ShellFoundation.css";
import "./AiryLayout.css";
import "./ContentModern.css";
import "./design-system/tokens.css";
import "./design-system/design-system.css";
import "./SystemWideMobilePolish.css";

const RegistryWorkspace = lazy(() => import("./RegistryWorkspace").then((item) => ({ default: item.RegistryWorkspace })));
const WorkflowWorkspace = lazy(() => import("./WorkflowWorkspace").then((item) => ({ default: item.WorkflowWorkspace })));
const FinanceWorkspace = lazy(() => import("./FinanceWorkspace").then((item) => ({ default: item.FinanceWorkspace })));
const SalesWorkspace = lazy(() => import("./SalesWorkspace").then((item) => ({ default: item.SalesWorkspace })));
const FamilyWorkspace = lazy(() => import("./FamilyWorkspace").then((item) => ({ default: item.FamilyWorkspace })));
const ContentWorkspace = lazy(() => import("./ContentWorkspace").then((item) => ({ default: item.ContentWorkspace })));
const EducationWorkspace = lazy(() => import("./EducationWorkspace").then((item) => ({ default: item.EducationWorkspace })));
const HrWorkspace = lazy(() => import("./HrWorkspace").then((item) => ({ default: item.HrWorkspace })));
const LegalWorkspace = lazy(() => import("./LegalWorkspace").then((item) => ({ default: item.LegalWorkspace })));
const ProcurementWorkspace = lazy(() => import("./ProcurementWorkspace").then((item) => ({ default: item.ProcurementWorkspace })));
const FoodWorkspace = lazy(() => import("./FoodWorkspace").then((item) => ({ default: item.FoodWorkspace })));
const SafetyWorkspace = lazy(() => import("./SafetyWorkspace").then((item) => ({ default: item.SafetyWorkspace })));
const MedicalWorkspace = lazy(() => import("./MedicalWorkspace").then((item) => ({ default: item.MedicalWorkspace })));
const AccountingWorkspace = lazy(() => import("./AccountingWorkspace").then((item) => ({ default: item.AccountingWorkspace })));
const StrategyWorkspace = lazy(() => import("./StrategyWorkspace").then((item) => ({ default: item.StrategyWorkspace })));
const ContractorWorkspace = lazy(() => import("./ContractorWorkspace").then((item) => ({ default: item.ContractorWorkspace })));
const AnalyticsWorkspace = lazy(() => import("./AnalyticsWorkspace").then((item) => ({ default: item.AnalyticsWorkspace })));
const SystemWorkspace = lazy(() => import("./SystemWorkspace").then((item) => ({ default: item.SystemWorkspace })));
const SettingsWorkspace = lazy(() => import("./SettingsWorkspace").then((item) => ({ default: item.SettingsWorkspace })));

type Task = {
  id: number;
  title: string;
  owner: string;
  dueDate: string;
  priority: string;
  status: string;
  sourceType: string;
  sourceId: string;
  createdAt: string;
  updatedAt: string;
};

type DrawerData = {
  title: string;
  value?: string;
  summary: string;
  source: string;
  calculation: string;
  updated: string;
  owner: string;
  quality: string;
  lineage: string[];
};

const rub = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

const uiStorage = {
  sidebar: "arthello:ui:v1:sidebar",
  recents: "arthello:ui:v1:recent-modules",
  navigationDepth: "arthello:ui:v1:navigation-depth",
  branch: "arthello:ui:v1:branch",
} as const;

// Every implemented workspace remains reachable when its registry is empty.
// Primary input is an action inside Settings, not a replacement for a module.
const manualFirstModules: ReadonlySet<ModuleId> = new Set();
const knownModuleIds = moduleCatalog.map((module) => module.id);
const settingsModuleIds: ReadonlySet<ModuleId> = new Set(["access", "integrations", "acceptance"]);
const defaultFavoriteModules: ModuleId[] = ["registry", "clients", "legal", "hr", "projects"];

function settingsTabForModule(id: ModuleId): SettingsTab | null {
  if (id === "access") return "Доступы";
  if (id === "integrations") return "Интеграции";
  if (id === "acceptance") return "Проверка системы";
  return null;
}

function readStorage(scope: "local" | "session", key: string, legacyKey?: string) {
  if (typeof window === "undefined") return null;
  try {
    const storage = scope === "local" ? window.localStorage : window.sessionStorage;
    return storage.getItem(key) ?? (legacyKey ? storage.getItem(legacyKey) : null);
  } catch {
    return null;
  }
}

function writeStorage(scope: "local" | "session", key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    const storage = scope === "local" ? window.localStorage : window.sessionStorage;
    storage.setItem(key, value);
  } catch {
    // Preferences remain optional when storage is unavailable (for example, private browsing).
  }
}

// Entity results must come from the database. Until the search API is connected,
// global search returns only real tasks and the static module catalog.
const entitySearchIndex: Array<{ id: string; label: string; type: string; meta: string; module: ModuleId }> = [];

const dashboardProfiles: Record<string, { label: string }> = {
  "Собственник": { label: "Собственник" },
  "Директор": { label: "Директор" },
  "Администратор": { label: "Администратор" },
  "Завуч": { label: "Завуч" },
  "Финансы": { label: "Финансы" },
  "Бухгалтерия": { label: "Бухгалтерия" },
  "Продажи": { label: "Продажи" },
  "Маркетинг": { label: "Маркетинг" },
  "HR": { label: "HR" },
  "Педагог": { label: "Педагог" },
  "Методист": { label: "Методист" },
  "Кухня": { label: "Кухня" },
  "Закупки": { label: "Закупки" },
  "Безопасность": { label: "Безопасность" },
  "Медработник": { label: "Медработник" },
  "Юрист": { label: "Юрист" },
  "Интеграции": { label: "Интеграции" },
  "Аналитика": { label: "Аналитика" },
  "Проекты": { label: "Проекты" },
  "Контроль качества": { label: "Контроль качества" },
  "Сотрудник": { label: "Сотрудник" },
  "Представитель Виталия": { label: "Представитель Виталия" },
};

export default function ArtHelloShell({ displayName: displayNameOverride = "" }: { displayName?: string }) {
  const authenticatedUser = useProductionAuthUser();
  const { logout, loggingOut } = useProductionAuthActions();
  const displayName = authenticatedUser?.name?.trim() || displayNameOverride.trim() || "Пользователь";
  const [active, setActive] = useState<ModuleId>("home");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState(authenticatedUser?.appRole ?? "");
  const [drawer, setDrawer] = useState<DrawerData | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>("Филиалы");
  const [favoriteModules, setFavoriteModules] = useState<ModuleId[]>(() => (authenticatedUser?.favoriteModules ?? defaultFavoriteModules).filter((id): id is ModuleId => knownModuleIds.includes(id as ModuleId)));
  const [moduleFocus, setModuleFocus] = useState<{ module: ModuleId; id: string } | null>(null);
  const [, setRecentModules] = useState<ModuleId[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [administrative, setAdministrative] = useState(Boolean(authenticatedUser?.isAdministrative));
  const [selectedBranch, setSelectedBranch] = useState("ALL");
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const navigationDepth = useRef(0);
  const accessContext = useMemo(() => ({
    apiRole: authenticatedUser?.apiRole ?? "",
    isSystemOwner: Boolean(authenticatedUser?.isSystemOwner),
    canAccessMedical: Boolean(authenticatedUser?.canAccessMedical),
    allowedModules: authenticatedUser?.allowedModules,
  }), [authenticatedUser?.allowedModules, authenticatedUser?.apiRole, authenticatedUser?.canAccessMedical, authenticatedUser?.isSystemOwner]);
  const isModuleAllowed = useCallback((id: ModuleId) => canAccessModule(accessContext, id), [accessContext]);
  const allowedModuleIds = useMemo(
    () => new Set(moduleCatalog.map((module) => module.id).filter(isModuleAllowed)),
    [isModuleAllowed],
  );
  const availableDashboardModules = useMemo(
    () => moduleCatalog
      .filter((moduleEntry) => allowedModuleIds.has(moduleEntry.id) && !settingsModuleIds.has(moduleEntry.id))
      .map(({ id, label }) => ({ id, label })),
    [allowedModuleIds],
  );
  const registryAccess = useMemo(() => registryCapabilities(accessContext), [accessContext]);

  const applyAccessContext = useCallback((context: AccessContext) => {
    setRole(context.me.role);
    const nextFavorites = (context.me.favoriteModules ?? defaultFavoriteModules).filter((id): id is ModuleId => knownModuleIds.includes(id as ModuleId));
    setFavoriteModules((current) => sameOrderedValues(current, nextFavorites) ? current : nextFavorites);
    setBranches(context.branches);
    setAdministrative(context.me.isAdministrative);
    const allowed = context.me.isAdministrative ? context.branches.map((branch) => branch.id) : context.access.map((grant) => grant.branchId);
    const saved = readStorage("local", uiStorage.branch);
    const next = context.me.isAdministrative && saved === "ALL" ? "ALL" : saved && allowed.includes(saved) ? saved : context.me.isAdministrative ? "ALL" : allowed[0] ?? "";
    setSelectedBranch(next);
    writeStorage("local", uiStorage.branch, next);
    document.cookie = `arthello_branch=${encodeURIComponent(next)}; Path=/; SameSite=Lax`;
  }, []);

  useEffect(() => {
    void loadTasks();
    const loadAccessContext = async () => {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        if (response.ok) applyAccessContext((await response.json()) as AccessContext);
      } catch { /* The owner fallback remains available while settings reconnect. */ }
    };
    void loadAccessContext();

    const preferenceHydration = window.setTimeout(() => {
      setSidebarCollapsed(readStorage("local", uiStorage.sidebar, "arthello:sidebar") === "collapsed");
      const savedRecent = readStorage("local", uiStorage.recents, "arthello:recent-modules");
      if (savedRecent) {
        try {
          setRecentModules((JSON.parse(savedRecent) as ModuleId[]).filter((id) => moduleCatalog.some((item) => item.id === id) && isModuleAllowed(id)).slice(0, 3));
        } catch {
          writeStorage("local", uiStorage.recents, "[]");
        }
      }
    }, 0);

    const openHashModule = () => {
      const requested = window.location.hash.slice(1);
      const next = resolveModuleRoute(accessContext, requested, knownModuleIds);
      const settingsTab = settingsTabForModule(next);
      if (settingsTab) {
        setSettingsInitialTab(settingsTab);
        setSettingsOpen(true);
        setActive("home");
        window.history.replaceState({ module: "home" }, "", "#home");
        return;
      }
      setActive(next);
      if (requested && next !== requested) window.history.replaceState({ module: "home" }, "", "#home");
      requestAnimationFrame(() => contentRef.current?.scrollTo({ top: scrollPositions.current[next] ?? 0 }));
    };
    const onPopState = () => {
      navigationDepth.current = Math.max(0, navigationDepth.current - 1);
      writeStorage("session", uiStorage.navigationDepth, String(navigationDepth.current));
      openHashModule();
    };
    const onKeyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setDrawer(null);
      }
    };
    navigationDepth.current = Number(readStorage("session", uiStorage.navigationDepth, "arthello:navigation-depth") ?? 0);
    const initialRoute = window.setTimeout(openHashModule, 0);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("keydown", onKeyboard);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("keydown", onKeyboard);
      window.clearTimeout(initialRoute);
      window.clearTimeout(preferenceHydration);
    };
  }, [accessContext, applyAccessContext, isModuleAllowed]);

  function changeBranch(branchId: string) {
    setSelectedBranch(branchId);
    writeStorage("local", uiStorage.branch, branchId);
    document.cookie = `arthello_branch=${encodeURIComponent(branchId)}; Path=/; SameSite=Lax`;
    setNotice(branchId === "ALL" ? "Показаны все филиалы административного корпуса" : `Рабочий филиал: ${branches.find((branch) => branch.id === branchId)?.name ?? "выбранный филиал"}`);
    window.dispatchEvent(new CustomEvent("arthello:branch-changed", { detail: branchId }));
  }

  async function loadTasks() {
    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      if (!response.ok) throw new Error("Не удалось загрузить задачи");
      const payload = (await response.json()) as { tasks: Task[] };
      setTasks(payload.tasks);
    } catch {
      setTasks([]);
    }
  }

  function openModule(id: ModuleId, focusId?: string) {
    const settingsTab = settingsTabForModule(id);
    if (settingsTab) {
      if (!isModuleAllowed(id)) {
        setNotice("Этот раздел не входит в права вашей роли");
        return;
      }
      setSettingsInitialTab(settingsTab);
      setSettingsOpen(true);
      setNavOpen(false);
      setQuery("");
      return;
    }
    const next = isModuleAllowed(id) ? id : "home";
    if (contentRef.current) scrollPositions.current[active] = contentRef.current.scrollTop;
    setActive(next);
    setModuleFocus(next === id && focusId ? { module: id, id: focusId } : null);
    setQuery("");
    setNavOpen(false);
    if (next !== id) setNotice("Этот раздел не входит в права вашей роли");
    if (next !== "home") {
      setRecentModules((current) => {
        const recent = [next, ...current.filter((item) => item !== next && isModuleAllowed(item))].slice(0, 3);
        writeStorage("local", uiStorage.recents, JSON.stringify(recent));
        return recent;
      });
    }
    if (typeof window !== "undefined") {
      if (window.location.hash !== `#${next}`) {
        if (next === id) {
          window.history.pushState({ module: next }, "", `#${next}`);
          navigationDepth.current += 1;
          writeStorage("session", uiStorage.navigationDepth, String(navigationDepth.current));
        } else {
          window.history.replaceState({ module: "home" }, "", "#home");
        }
      }
      requestAnimationFrame(() => contentRef.current?.scrollTo({ top: scrollPositions.current[next] ?? 0, behavior: "auto" }));
    }
  }

  function openSettings(tab: SettingsTab = "Филиалы") {
    setSettingsInitialTab(tab);
    setSettingsOpen(true);
  }

  function goBack() {
    if (navigationDepth.current > 0) window.history.back();
    else openModule("home");
  }

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      writeStorage("local", uiStorage.sidebar, next ? "collapsed" : "expanded");
      return next;
    });
  }

  const searchResults = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (clean.length < 2) return [];
    const modules = moduleCatalog
      .filter((module) => isModuleAllowed(module.id))
      .filter((module) => `${module.label} ${module.group}`.toLowerCase().includes(clean))
      .map((module) => ({ id: module.id, label: module.label, type: "Раздел", meta: module.group, module: module.id as ModuleId }));
    const entities = entitySearchIndex.filter((item) => isModuleAllowed(item.module) && `${item.id} ${item.label} ${item.type} ${item.meta}`.toLowerCase().includes(clean));
    const taskResults = isModuleAllowed("tasks")
      ? tasks.filter((task) => `${task.id} ${task.title} ${task.owner} ${task.sourceId}`.toLowerCase().includes(clean)).map((task) => ({ id: `TASK-${task.id}`, label: taskRecordLabel(task.id), type: "Задача", meta: `${humanTechnicalText(task.title)} · ${task.owner} · ${task.status}`, module: "tasks" as ModuleId }))
      : [];
    return [...modules, ...entities, ...taskResults].slice(0, 8);
  }, [isModuleAllowed, query, tasks]);

  const routedActive = isModuleAllowed(active) ? active : "home";
  const activeEntry = moduleCatalog.find((item) => item.id === routedActive) ?? moduleCatalog[0];
  const primaryNav = (["home", "finance", "clients", "education", "hr", "sales", "content", "tasks", "legal", "analytics"] as ModuleId[]).filter((id) => isModuleAllowed(id) && !settingsModuleIds.has(id));
  const favoriteNav = favoriteModules.filter((id) => isModuleAllowed(id) && !settingsModuleIds.has(id));
  const extraNav = moduleCatalog.filter((item) => isModuleAllowed(item.id) && !settingsModuleIds.has(item.id) && !primaryNav.includes(item.id) && !favoriteNav.includes(item.id));
  const navLabels: Partial<Record<ModuleId, string>> = { finance: "Деньги", clients: "Клиенты", hr: "Команда", legal: "Документы", projects: "План-факт" };

  const renderNavItem = (item: typeof moduleCatalog[number], keyPrefix = "") => (
    <a
      href={`#${item.id}`}
      className={`nav-item ${routedActive === item.id ? "active" : ""}`}
      key={`${keyPrefix}${item.id}`}
      title={item.label}
      onClick={(event) => { event.preventDefault(); openModule(item.id); }}
    >
      <span className="nav-mark"><AppIcon name={item.id} /></span>
      <span>{navLabels[item.id] ?? item.label}</span>
      {item.id === "tasks" && tasks.length > 0 ? <b>{tasks.length}</b> : null}
      {item.status === "restricted" ? <em>особые права</em> : null}
    </a>
  );

  return (
    <div className={`os-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${navOpen ? "sidebar-open" : ""}`} aria-label="Основная навигация">
        <div className="brand-row">
          <button className="brand-home" onClick={() => openModule("home")} aria-label="На персональный дашборд">
            <span className="brand-mark brand-mark-new" aria-hidden="true"><i /><i /></span>
          </button>
          <div className="brand-copy">
            <strong>ArtHello <span>OS</span></strong>
          </div>
          <button className="sidebar-close" onClick={() => setNavOpen(false)} aria-label="Закрыть меню">×</button>
        </div>
        <nav className="nav-scroll">
          {primaryNav.length ? <div className="nav-group"><p>Основное</p>{primaryNav.map((id) => renderNavItem(moduleCatalog.find((item) => item.id === id)!))}</div> : null}
          {favoriteNav.length ? <div className="nav-group"><p>Избранное</p>{favoriteNav.map((id) => renderNavItem(moduleCatalog.find((item) => item.id === id)!, "favorite-"))}</div> : null}
          {extraNav.length ? <details className="nav-more">
            <summary><AppIcon name="more" /><span>Все разделы</span></summary>
            <div className="nav-group">{extraNav.map((item) => renderNavItem(item, "extra-"))}</div>
          </details> : null}
        </nav>
        <div className="sidebar-tools" aria-label="Системные действия">
          <button onClick={() => setCommandOpen(true)} title="Командная палитра"><AppIcon name="command" /><span>Команды</span><kbd>⌘K</kbd></button>
          <button onClick={() => openSettings()} title="Настройки"><AppIcon name="settings" /><span>Настройки</span></button>
          <button onClick={() => setNotice("Откройте командную палитру: там собраны разделы, сущности и быстрые действия")} title="Помощь"><AppIcon name="help" /><span>Помощь</span></button>
          <button disabled={loggingOut} onClick={() => void logout().catch((error) => setNotice(error instanceof Error ? error.message : "Не удалось выйти"))} title="Выйти из ArtHello OS"><AppIcon name="logout" /><span>{loggingOut ? "Выходим…" : "Выйти"}</span></button>
        </div>
        <div className="sidebar-user">
          <div className="avatar">{initials(displayName)}</div>
          <div><strong>{displayName}</strong><span>{role}</span></div>
        </div>
        <div className="sidebar-version"><span>ArtHello OS</span><b>v1.0.0</b></div>
        <button className="sidebar-collapse" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"} title={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"}><AppIcon name="collapse" /><span>{sidebarCollapsed ? "Развернуть" : "Свернуть"}</span></button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button
            className="mobile-menu"
            onClick={routedActive === "home" ? () => setNavOpen(true) : goBack}
            aria-label={routedActive === "home" ? "Открыть меню" : "Вернуться назад"}
          >
            <AppIcon name={routedActive === "home" ? "menu" : "back"} />
          </button>
          <div className="mobile-shell-title" aria-live="polite">
            <strong>{routedActive === "home" ? "ArtHello" : activeEntry.label}</strong>
            <span>{routedActive === "home" ? "Рабочий контур" : activeEntry.group}</span>
          </div>
          <div className="search-wrap">
            <AppIcon name="search" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти раздел, семью, документ или задачу"
              aria-label="Глобальный поиск"
            />
            {searchResults.length > 0 ? (
              <div className="search-results">
                {searchResults.map((result) => (
                  <button key={result.id} onClick={() => openModule(result.module)}>
                    <span className="nav-mark"><AppIcon name={result.module} /></span>
                    <span><strong>{result.label}</strong><small>{result.type} · {result.meta}</small></span>
                  </button>
                ))}
              </div>
            ) : null}
            <button className="command-trigger" onClick={() => setCommandOpen(true)} aria-label="Открыть командную палитру"><kbd>⌘ K</kbd></button>
          </div>
          <div className="mobile-top-actions">
            <button onClick={() => setCommandOpen(true)} aria-label="Открыть поиск"><AppIcon name="search" /></button>
          </div>
          <div className="top-actions">
            <div className="scope-switcher" aria-label="Рабочий контекст">
              <label><span className="sr-only">Филиал</span><select aria-label="Выбрать филиал" value={selectedBranch} onChange={(event) => changeBranch(event.target.value)}>{administrative ? <option value="ALL">Все филиалы</option> : null}{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            </div>
            {isModuleAllowed("integrations") ? <button className="freshness" onClick={() => openModule("integrations")}><span /> Данных пока нет</button> : null}
            {isModuleAllowed("tasks") ? <button className="top-icon-action create" onClick={() => setTaskOpen(true)} aria-label="Быстро создать задачу" title="Быстро создать"><AppIcon name="plus" /></button> : null}
            {isModuleAllowed("tasks") ? <button className="top-icon-action" onClick={() => openModule("tasks")} aria-label={`Открыть задачи: ${tasks.length}`} title="Задачи"><AppIcon name="tasks" />{tasks.length > 0 ? <b>{tasks.length}</b> : null}</button> : null}
            <button className="top-icon-action" onClick={() => setNotice("Новых системных уведомлений нет")} aria-label="Уведомления" title="Уведомления"><AppIcon name="bell" /></button>
            <button className="role-switch" onClick={() => openSettings("Доступы")}><span>{role}</span></button>
          </div>
        </header>

        {routedActive !== "home" ? (
          <div className="context-bar">
            <button className="back-action" onClick={goBack}><AppIcon name="back" />Назад</button>
            <nav aria-label="Хлебные крошки">
              <button onClick={() => openModule("home")}>Главная</button><AppIcon name="chevron" />
              <span>{activeEntry.group}</span><AppIcon name="chevron" />
              <strong aria-current="page">{activeEntry.label}</strong>
            </nav>
            <div><button onClick={() => contentRef.current?.scrollTo({ top: 0, behavior: "smooth" })}>Начало раздела</button><button onClick={() => setCommandOpen(true)}><AppIcon name="command" />Команды</button></div>
          </div>
        ) : null}

        <div className="content-frame" ref={contentRef}>
          <div className="route-stage" key={routedActive}>
          <Suspense fallback={<section className="workspace-loading" aria-live="polite"><span /><strong>Открываем рабочее пространство…</strong><small>Контекст и навигация уже доступны</small></section>}>
          {manualFirstModules.has(routedActive) ? (
            <ManualStartWorkspace module={routedActive} selectedBranch={selectedBranch} branches={branches} openSettings={() => openSettings()} openIntegrations={() => openModule("integrations")} />
          ) : routedActive === "home" ? (
            <HomeView
              displayName={displayName}
              userKey={authenticatedUser?.userId ?? ""}
              role={role}
              setActive={openModule}
              setDrawer={setDrawer}
              createTask={() => setTaskOpen(true)}
              tasks={tasks}
              availableModules={availableDashboardModules}
              sourceOnly
            />
          ) : routedActive === "tasks" ? (
            <WorkflowWorkspace role={role} notify={setNotice} onChanged={loadTasks} />
          ) : routedActive === "registry" ? (
            <RegistryWorkspace notify={setNotice} capabilities={registryAccess} />
          ) : routedActive === "finance" ? (
            <FinanceWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} focusId={moduleFocus?.module === "finance" ? moduleFocus.id : undefined} />
          ) : routedActive === "sales" ? (
            <SalesWorkspace workspace="sales" role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenFinance={() => openModule("finance")} onOpenIntegrations={() => openModule("integrations")} focusId={moduleFocus?.module === "sales" ? moduleFocus.id : undefined} />
          ) : routedActive === "clients" ? (
            <div className="family-workspace"><FamilyWorkspace notify={setNotice} onOpenIntegrations={() => openModule("integrations")} onNavigate={(module, focusId) => openModule(module, focusId)} /></div>
          ) : routedActive === "content" ? (
            <ContentWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenSales={() => openModule("sales")} onOpenFinance={() => openModule("finance")} onOpenIntegrations={() => openModule("integrations")} />
          ) : routedActive === "education" || routedActive === "methods" ? (
            <EducationWorkspace key={routedActive} workspace={routedActive} role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenIntegrations={() => openModule("integrations")} focusId={moduleFocus?.module === "education" ? moduleFocus.id : undefined} />
          ) : routedActive === "hr" ? (
            <HrWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenDocuments={(focusId) => openModule("legal", focusId)} />
          ) : routedActive === "legal" ? (
            <LegalWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenIntegrations={() => openModule("integrations")} focusId={moduleFocus?.module === "legal" ? moduleFocus.id : undefined} />
          ) : routedActive === "procurement" ? (
            <ProcurementWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenFinance={() => openModule("finance")} />
          ) : routedActive === "food" ? (
            <FoodWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenFinance={() => openModule("finance")} />
          ) : routedActive === "safety" ? (
            <SafetyWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenFinance={() => openModule("finance")} />
          ) : routedActive === "medical" ? (
            <MedicalWorkspace role={role} notify={setNotice} />
          ) : routedActive === "accounting" ? (
            <AccountingWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenFinance={() => openModule("finance")} />
          ) : routedActive === "projects" ? (
            <StrategyWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} />
          ) : routedActive === "contractors" ? (
            <div className="ahContractorScope"><ContractorWorkspace notify={setNotice} onOpenFinance={() => openModule("finance")} /></div>
          ) : routedActive === "events" || routedActive === "assets" || routedActive === "quality" ? (
            <SystemWorkspace module={routedActive} role={role} notify={setNotice} createTask={() => setTaskOpen(true)} navigate={openModule} />
          ) : routedActive === "analytics" ? (
            <AnalyticsWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenIntegrations={() => openModule("integrations")} />
          ) : (
            <EmptyModuleWorkspace module={routedActive} openIntegrations={() => openModule("integrations")} />
          )}
          </Suspense>
          </div>
        </div>
      </main>

      {drawer ? <DetailDrawer data={drawer} close={() => setDrawer(null)} createTask={() => { setDrawer(null); setTaskOpen(true); }} /> : null}
      {taskOpen ? <TaskModal close={() => setTaskOpen(false)} refresh={loadTasks} notify={setNotice} /> : null}
      {notice ? <div className="toast" role="status">{notice}<button onClick={() => setNotice(null)}>×</button></div> : null}
      {navOpen ? <button className="nav-scrim" aria-label="Закрыть меню" onClick={() => setNavOpen(false)} /> : null}
      {commandOpen ? <CommandPalette tasks={tasks} allowedModules={allowedModuleIds} close={() => setCommandOpen(false)} navigate={(id) => { openModule(id); setCommandOpen(false); }} createTask={() => { setCommandOpen(false); setTaskOpen(true); }} /> : null}
      {settingsOpen ? <Suspense fallback={<div className="settings-layer"><button className="drawer-scrim" onClick={() => setSettingsOpen(false)} aria-label="Закрыть настройки" /><section className="settings-modal" role="dialog" aria-modal="true" aria-label="Настройки"><div className="settings-state"><strong>Открываем настройки…</strong><span>Проверяем роль владельца и доступные филиалы</span></div></section></div>}><SettingsWorkspace key={settingsInitialTab} initialTab={settingsInitialTab} close={() => setSettingsOpen(false)} notify={setNotice} onContextChanged={applyAccessContext} onTasksChanged={loadTasks} onFavoritesChanged={setFavoriteModules} /></Suspense> : null}
      <nav className="mobile-dock" aria-label="Мобильная навигация">
        <button className={routedActive === "home" ? "active" : ""} onClick={() => openModule("home")}><AppIcon name="home" /><span>Главная</span></button>
        {isModuleAllowed("tasks") ? <button className={routedActive === "tasks" ? "active" : ""} onClick={() => openModule("tasks")}><AppIcon name="tasks" /><span>Задачи</span></button> : null}
        {isModuleAllowed("tasks") ? <button className="mobile-create" onClick={() => setTaskOpen(true)}><AppIcon name="plus" /><span>Создать</span></button> : null}
        <button onClick={() => setCommandOpen(true)}><AppIcon name="search" /><span>Поиск</span></button>
        <button onClick={() => setNavOpen(true)}><AppIcon name="registry" /><span>Разделы</span></button>
      </nav>
    </div>
  );
}

function HomeView({
  displayName,
  userKey,
  role,
  setActive,
  setDrawer,
  createTask,
  tasks,
  availableModules,
  sourceOnly,
}: {
  displayName: string;
  userKey: string;
  role: string;
  setActive: (id: ModuleId) => void;
  setDrawer: (value: DrawerData) => void;
  createTask: () => void;
  tasks: Task[];
  availableModules: ReadonlyArray<{ id: ModuleId; label: string }>;
  sourceOnly: boolean;
}) {
  const profile = dashboardProfiles[role] ?? { label: role || dashboardProfiles.Сотрудник.label };
  return (
    <OwnerDashboard
      displayName={displayName}
      userKey={userKey}
      roleLabel={profile.label}
      tasks={tasks}
      availableModules={availableModules}
      sourceOnly={sourceOnly}
      navigate={setActive}
      createTask={createTask}
      openOperation={setDrawer}
    />
  );
}

const manualTypesByModule: Partial<Record<ModuleId, string[]>> = {
  sales: ["Семья", "Ребёнок", "Договор", "Начисление", "Оплата"],
  education: ["Ребёнок", "Класс или группа", "Занятие", "Дополнительное занятие"],
  methods: ["Класс или группа", "Занятие", "Дополнительное занятие"],
  hr: ["Сотрудник", "Заработная плата"], legal: ["Договор"], accounting: ["ДДС", "ОПиУ", "Заработная плата", "Договор", "Оплата"],
  projects: ["Другое"], events: ["Другое"], procurement: ["Договор", "Оплата", "Другое"], food: ["Оплата", "Другое"],
  safety: ["Договор", "Другое"], medical: ["Другое"], assets: ["Другое"], quality: ["Другое"], access: ["Сотрудник"], analytics: ["ДДС", "ОПиУ", "Заработная плата", "Оплата"],
};

function ManualStartWorkspace({ module, selectedBranch, branches, openSettings, openIntegrations }: { module: ModuleId; selectedBranch: string; branches: Array<{ id: string; name: string }>; openSettings: () => void; openIntegrations: () => void }) {
  const [records, setRecords] = useState<Array<{ id: string; branchId: string; recordType: string; title: string; period: string; amountMinor: number; status: string }>>([]);
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { records: typeof records };
        const allowedTypes = manualTypesByModule[module] ?? ["Другое"];
        setRecords(payload.records.filter((record) => allowedTypes.includes(record.recordType) && (selectedBranch === "ALL" || record.branchId === selectedBranch)));
      } catch { setRecords([]); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [module, selectedBranch]);
  const entry = moduleCatalog.find((item) => item.id === module);
  const branchName = selectedBranch === "ALL" ? "Все филиалы" : branches.find((branch) => branch.id === selectedBranch)?.name ?? "Филиал";
  return <section className="page manual-start-workspace"><header><div><p className="eyebrow">Первичный ввод · {branchName}</p><h1>{entry?.label}</h1><p>Здесь показываются только данные, введённые вручную или полученные из выбранных вами полей интеграции.</p></div><div><button onClick={openSettings}>+ Ввести данные</button><button onClick={openIntegrations}>Подключить источник</button></div></header>{records.length ? <div className="manual-module-list">{records.map((record) => <article key={record.id}><span>{record.recordType}</span><h2>{humanTechnicalText(record.title)}</h2><p>{branches.find((branch) => branch.id === record.branchId)?.name}{record.period ? ` · ${humanPeriodLabel(record.period)}` : ""}</p><footer><strong>{record.amountMinor ? rub.format(record.amountMinor / 100) : record.status}</strong><em>{recordLabel(record.recordType, record.id)}</em></footer></article>)}</div> : <div data-ah-compact-card="true" className="manual-module-empty"><span>＋</span><h2>Данных пока нет</h2><p>Введите исходные записи вручную или подключите источник и выберите, какие именно поля разрешено получать.</p><button onClick={openSettings}>Открыть первичный ввод</button></div>}</section>;
}

function EmptyModuleWorkspace({ module, openIntegrations }: { module: ModuleId; openIntegrations: () => void }) {
  const entry = moduleCatalog.find((item) => item.id === module);

  return (
    <section className="page module-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{entry?.group ?? "Рабочий раздел"}</p>
          <h1>{entry?.label ?? "Раздел"}</h1>
          <p>Здесь появятся данные после ручного добавления или подключения подтверждённого источника.</p>
        </div>
      </div>
      <div data-ah-compact-card="true" className="manual-module-empty">
        <span>＋</span>
        <h2>Данных пока нет</h2>
        <p>Структура раздела готова. Подключите источник, когда будете готовы начать наполнение системы.</p>
        <button onClick={openIntegrations}>Подключить источник</button>
      </div>
    </section>
  );
}

function CommandPalette({
  tasks,
  allowedModules,
  close,
  navigate,
  createTask,
}: {
  tasks: Task[];
  allowedModules: ReadonlySet<ModuleId>;
  close: () => void;
  navigate: (id: ModuleId) => void;
  createTask: () => void;
}) {
  const [commandQuery, setCommandQuery] = useState("");
  const clean = commandQuery.trim().toLocaleLowerCase("ru-RU");
  const items = [
    ...moduleCatalog.filter((item) => allowedModules.has(item.id)).map((item) => ({ id: `module-${item.id}`, label: item.label, type: "Раздел", meta: item.group, module: item.id as ModuleId })),
    ...entitySearchIndex.filter((item) => allowedModules.has(item.module)),
    ...(allowedModules.has("tasks") ? tasks.map((task) => ({ id: `task-${task.id}`, label: taskRecordLabel(task.id), type: "Задача", meta: `${humanTechnicalText(task.title)} · ${task.owner} · ${task.status}`, module: "tasks" as ModuleId })) : []),
  ].filter((item) => !clean || `${item.id} ${item.label} ${item.type} ${item.meta}`.toLocaleLowerCase("ru-RU").includes(clean)).slice(0, 12);

  return (
    <div className="command-layer" role="presentation">
      <button className="command-scrim" onClick={close} aria-label="Закрыть командную палитру" />
      <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-title">
        <header>
          <AppIcon name="search" />
          <label><span id="command-title" className="sr-only">Командная палитра</span><input autoFocus value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} placeholder="Раздел, семья, сотрудник, договор, платёж или действие" /></label>
          <kbd>Esc</kbd>
        </header>
        <div className="command-quick">
          {allowedModules.has("tasks") ? <button onClick={createTask}><AppIcon name="plus" /><span><strong>Создать задачу</strong><small>Сохранить в рабочем контуре</small></span></button> : null}
          {allowedModules.has("integrations") ? <button onClick={() => navigate("integrations")}><AppIcon name="integrations" /><span><strong>Проверить источники</strong><small>Авторизация, передача и журнал подключений</small></span></button> : null}
          {allowedModules.has("analytics") ? <button onClick={() => navigate("analytics")}><AppIcon name="analytics" /><span><strong>Открыть аналитику</strong><small>Показатели, сигналы и правила ИИ</small></span></button> : null}
        </div>
        <div className="command-results">
          <p>{clean ? `Результаты по запросу «${commandQuery}»` : "Разделы и недавние объекты"}</p>
          {items.map((item) => (
            <button key={item.id} onClick={() => navigate(item.module)}>
              <span className="command-icon"><AppIcon name={item.module} /></span>
              <span><strong>{item.label}</strong><small>{item.type} · {item.meta}</small></span>
              <kbd>↵</kbd>
            </button>
          ))}
          {items.length === 0 ? <div className="command-empty"><strong>Совпадений нет</strong><span>Проверьте номер или откройте нужный раздел через меню.</span></div> : null}
        </div>
        <footer><span><kbd>Tab</kbd> выбрать</span><span><kbd>↵</kbd> открыть</span><span><kbd>Esc</kbd> закрыть</span><b>Поиск по доступным данным</b></footer>
      </section>
    </div>
  );
}

function DetailDrawer({ data, close, createTask }: { data: DrawerData; close: () => void; createTask: () => void }) {
  return <div className="drawer-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть карточку" /><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label={data.title}>
    <div className="drawer-head"><div><p>Доказуемый показатель</p><h2>{data.title}</h2>{data.value ? <strong>{data.value}</strong> : null}</div><button onClick={close} aria-label="Закрыть">×</button></div>
    <p className="drawer-summary">{data.summary}</p>
    <div className="lineage"><p>Цепочка происхождения</p><div>{data.lineage.map((step, index) => <span key={step}>{step}{index < data.lineage.length - 1 ? <i>→</i> : null}</span>)}</div></div>
    <dl className="proof-list"><div><dt>Источник</dt><dd>{data.source}</dd></div><div><dt>Расчёт</dt><dd>{data.calculation}</dd></div><div><dt>Последнее обновление</dt><dd>{data.updated}</dd></div><div><dt>Ответственный</dt><dd>{data.owner}</dd></div><div><dt>Качество данных</dt><dd>{data.quality}</dd></div></dl>
    <div className="drawer-actions"><button onClick={createTask}>Создать задачу</button><button onClick={close}>Закрыть</button></div>
  </aside></div>;
}

function TaskModal({ close, refresh, notify }: { close: () => void; refresh: () => Promise<void>; notify: (value: string) => void }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось создать задачу");
      await refresh();
      close();
      notify("Задача создана и сохранена");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось создать задачу");
    } finally {
      setSaving(false);
    }
  }
  return <div className="modal-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть форму" /><form className="task-modal" onSubmit={submit}>
    <div className="drawer-head"><div><p>Новая запись</p><h2>Создать задачу</h2></div><button type="button" onClick={close}>×</button></div>
    <label><span>Что нужно сделать</span><input name="title" required minLength={4} placeholder="Например: сверить оплаты за июль" /></label>
    <div className="form-row"><label><span>Ответственный</span><input name="owner" required defaultValue="Финансовый контролёр" /></label><label><span>Срок</span><input name="dueDate" type="date" /></label></div>
    <div className="form-row"><label><span>Приоритет</span><select name="priority" defaultValue="Высокий"><option>Высокий</option><option>Средний</option><option>Низкий</option></select></label><label><span>Источник</span><select name="sourceType" defaultValue="Сигнал качества"><option>Сигнал качества</option><option>Финансы</option><option>Документ</option><option>Ручная задача</option></select></label></div>
    <input type="hidden" name="sourceId" value="MANUAL" />
    <div className="modal-actions"><button type="button" onClick={close}>Отмена</button><button disabled={saving} type="submit">{saving ? "Сохраняем…" : "Создать задачу"}</button></div>
  </form></div>;
}

function sameOrderedValues(left: readonly string[] | undefined, right: readonly string[] | undefined) {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function initials(name: string) {
  const parts = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase()).join("") || "ВО";
}
