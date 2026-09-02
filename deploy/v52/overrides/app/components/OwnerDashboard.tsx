"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModuleId } from "../../data/test-snapshot";
import {
  DASHBOARD_LAYOUT_VERSION,
  allowedDashboardWidgetIds,
  dashboardBrowserStorageKey,
  type DashboardWidgetId,
  type DashboardWidgetPreference,
  type DashboardWidgetSize,
} from "../../lib/dashboard-layout";
import { AppIcon } from "./AppIcon";
import styles from "./OwnerDashboard.module.css";
import chartStyles from "./OwnerDashboardChart.module.css";

type TaskSummary = {
  id: number;
  title: string;
  dueDate: string;
  priority: string;
  status: string;
  sourceId: string;
};

type FinanceOperation = {
  id: string;
  period: string;
  operationDate: string;
  direction: string;
  amountMinor: number;
  category: string;
  reportClass: string;
  counterpartyEntityId: string;
  contractId: string;
  documentId: string;
  bankOperationRef: string;
  sourceFile: string;
  sourceSheet: string;
  sourceRef: string;
  dataQuality: string;
  status: string;
};

type FinancePayload = {
  selectedPeriod: string;
  operations: FinanceOperation[];
  accruals: Array<{ period: string; debtMinor: number }>;
  entityNames: Record<string, string>;
  monthly: Array<{
    period: string;
    receiptsMinor: number;
    outflowsMinor: number;
    netMinor: number;
  }>;
  summary: {
    receiptsMinor: number;
    outflowsMinor: number;
    netMinor: number;
    debtMinor: number;
  };
};

type OperationDetail = {
  title: string;
  value: string;
  summary: string;
  source: string;
  calculation: string;
  updated: string;
  owner: string;
  quality: string;
  lineage: string[];
};

type OwnerDashboardProps = {
  displayName: string;
  userKey?: string;
  roleLabel: string;
  availableModules: ReadonlyArray<{ id: ModuleId; label: string }>;
  tasks: TaskSummary[];
  sourceOnly: boolean;
  navigate: (module: ModuleId) => void;
  createTask: () => void;
  openOperation: (detail: OperationDetail) => void;
};

const DASHBOARD_STORAGE_PREFIX = `arthello:dashboard-layout:v${DASHBOARD_LAYOUT_VERSION}`;
const MOSCOW_TIME_ZONE = "Europe/Moscow";

const WIDGETS: ReadonlyArray<{ id: DashboardWidgetId; title: string; description: string; defaultSize: DashboardWidgetSize }> = [
  { id: "kpis", title: "Ключевые показатели", description: "Факт по финансам и открытым задачам", defaultSize: "full" },
  { id: "cashflow", title: "Денежный поток", description: "Поступления и списания по данным ОДДС", defaultSize: "wide" },
  { id: "decisions", title: "Мои решения", description: "Открытые задачи, требующие действия", defaultSize: "compact" },
  { id: "signals", title: "Сигналы и риски", description: "Только подтверждённые сигналы из аналитики", defaultSize: "compact" },
  { id: "milestones", title: "Контрольные точки", description: "Ближайшие сроки из задач", defaultSize: "compact" },
  { id: "roleFocus", title: "Мои разделы", description: "Быстрый доступ только к разрешённым разделам", defaultSize: "full" },
  { id: "operations", title: "Операции", description: "Короткий банковский реестр", defaultSize: "full" },
];

type RoleHomeProfile = {
  title: string;
  description: string;
  preferredModules: ModuleId[];
  widgets: DashboardWidgetId[];
};

const ROLE_HOME_PROFILES: Record<string, RoleHomeProfile> = {
  "Собственник": { title: "Контур собственника", description: "Финансы, решения и состояние группы", preferredModules: ["finance", "analytics", "projects", "integrations", "tasks", "access"], widgets: ["kpis", "cashflow", "decisions", "signals", "milestones", "roleFocus", "operations"] },
  "Представитель Виталия": { title: "Контур представителя", description: "Полный управленческий контур от имени собственника", preferredModules: ["finance", "analytics", "projects", "integrations", "access", "tasks"], widgets: ["kpis", "cashflow", "decisions", "signals", "milestones", "roleFocus", "operations"] },
  "Директор": { title: "Контур директора", description: "Операционная работа, показатели и контроль сроков", preferredModules: ["projects", "analytics", "education", "hr", "finance", "tasks"], widgets: ["kpis", "cashflow", "decisions", "milestones", "signals", "roleFocus"] },
  "Администратор": { title: "Контур администратора", description: "Семьи, единые карточки и ежедневные задачи", preferredModules: ["clients", "registry", "education", "content", "tasks"], widgets: ["roleFocus", "kpis", "decisions", "milestones"] },
  "Завуч": { title: "Учебный контур", description: "Обучение, методики и учебные контрольные точки", preferredModules: ["education", "methods", "tasks", "events"], widgets: ["kpis", "roleFocus", "milestones", "decisions"] },
  "Финансы": { title: "Финансовый контур", description: "Денежный поток, операции и финансовые задачи", preferredModules: ["finance", "accounting", "contractors", "procurement", "analytics", "tasks"], widgets: ["kpis", "cashflow", "decisions", "roleFocus", "operations"] },
  "Бухгалтерия": { title: "Контур бухгалтерии", description: "Учёт, банковские операции и первичные документы", preferredModules: ["accounting", "finance", "registry", "integrations", "tasks"], widgets: ["kpis", "cashflow", "decisions", "roleFocus", "operations"] },
  "Продажи": { title: "Контур продаж", description: "Воронка, семьи и задачи по обращениям", preferredModules: ["sales", "clients", "registry", "tasks", "events"], widgets: ["kpis", "roleFocus", "decisions", "milestones"] },
  "Маркетинг": { title: "Контур маркетинга", description: "Контент, продажи и аналитика продвижения", preferredModules: ["content", "sales", "tasks", "events"], widgets: ["roleFocus", "kpis", "milestones", "decisions"] },
  "HR": { title: "Контур команды", description: "Сотрудники, единые карточки и кадровые задачи", preferredModules: ["hr", "registry", "tasks", "events"], widgets: ["kpis", "roleFocus", "decisions", "milestones"] },
  "Педагог": { title: "Контур педагога", description: "Обучение, методики и ближайшие сроки", preferredModules: ["education", "methods", "tasks", "events"], widgets: ["roleFocus", "kpis", "milestones", "decisions"] },
  "Методист": { title: "Контур методиста", description: "Методики, обучение и задачи программы", preferredModules: ["methods", "education", "tasks", "events"], widgets: ["kpis", "roleFocus", "milestones", "decisions"] },
  "Кухня": { title: "Контур питания", description: "Питание и задачи операционного дня", preferredModules: ["food", "tasks", "events"], widgets: ["roleFocus", "kpis", "decisions", "milestones"] },
  "Закупки": { title: "Контур закупок", description: "Закупки, подрядчики и имущество", preferredModules: ["procurement", "contractors", "assets", "tasks", "events"], widgets: ["kpis", "roleFocus", "decisions", "milestones"] },
  "Безопасность": { title: "Контур безопасности", description: "Безопасность, события и контрольные задачи", preferredModules: ["safety", "tasks", "events"], widgets: ["roleFocus", "kpis", "decisions", "milestones"] },
  "Медработник": { title: "Медицинский контур", description: "Медицинские записи и задачи по здоровью", preferredModules: ["medical", "tasks", "events"], widgets: ["kpis", "roleFocus", "milestones", "decisions"] },
  "Юрист": { title: "Юридический контур", description: "Документы, подрядчики и юридические задачи", preferredModules: ["legal", "contractors", "accounting", "registry", "tasks"], widgets: ["roleFocus", "kpis", "decisions", "milestones"] },
  "Интеграции": { title: "Контур интеграций", description: "Подключения, качество данных и задачи обмена", preferredModules: ["integrations", "quality", "tasks", "events"], widgets: ["kpis", "roleFocus", "decisions", "milestones"] },
  "Аналитика": { title: "Контур аналитики", description: "Аналитика, финансы и проекты", preferredModules: ["analytics", "finance", "sales", "content", "tasks"], widgets: ["roleFocus", "kpis", "milestones", "decisions"] },
  "Проекты": { title: "Проектный контур", description: "Проекты, KPI и ближайшие контрольные точки", preferredModules: ["projects", "tasks", "events"], widgets: ["kpis", "roleFocus", "milestones", "decisions"] },
  "Контроль качества": { title: "Контур качества", description: "Обращения, приёмка и задачи контроля", preferredModules: ["quality", "acceptance", "tasks", "events"], widgets: ["roleFocus", "kpis", "decisions", "milestones"] },
  "Сотрудник": { title: "Рабочий контур", description: "Личные задачи и календарные события", preferredModules: ["tasks", "events"], widgets: ["kpis", "roleFocus", "decisions", "milestones"] },
};

const FINANCE_WIDGETS = new Set<DashboardWidgetId>(["kpis", "cashflow", "operations"]);
const COMPLETE_TASK = /готов|заверш|выполн|закрыт/i;

const rub = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

function rubles(minor: number) {
  return rub.format(minor / 100);
}

function compactMoney(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")} млн ₽`;
  if (absolute >= 1_000) return `${Math.round(value / 1_000)} тыс. ₽`;
  return rub.format(value);
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value || "Без срока";
  return date.toLocaleDateString("ru-RU", { timeZone: MOSCOW_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric" });
}

function monthLabel(period: string, format: "short" | "long" = "short") {
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", { timeZone: MOSCOW_TIME_ZONE, month: format, year: format === "long" ? "numeric" : undefined })
    .format(new Date(Date.UTC(year, month - 1, 1)))
    .replace(/^./, (letter) => letter.toUpperCase())
    .replace(" г.", "");
}

function chartTick(value: number) {
  if (value === 0) return "0";
  return `${Number((value / 100_000_000).toFixed(1)).toLocaleString("ru-RU")} млн`;
}

function moscowHour(value: Date) {
  const hour = new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value).find((part) => part.type === "hour")?.value;
  return Number(hour ?? 0);
}

function greetingForMoscow(value: Date) {
  const hour = moscowHour(value);
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  if (hour < 23) return "Добрый вечер";
  return "Доброй ночи";
}

function dashboardDateForMoscow(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value).replace(/^./, (letter) => letter.toUpperCase());
}

function dashboardDateKeyForMoscow(value: Date) {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function rolePreset(roleLabel: string) {
  const role = roleLabel.toLocaleLowerCase("ru-RU");
  if (role.includes("собствен") || role.includes("представитель")) return "owner" as const;
  if (role.includes("директор")) return "director" as const;
  if (role.includes("финанс") || role.includes("бухгал")) return "finance" as const;
  return "work" as const;
}

function roleHomeProfile(roleLabel: string) {
  return ROLE_HOME_PROFILES[roleLabel] ?? ROLE_HOME_PROFILES.Сотрудник;
}

function allowedWidgetIds(roleLabel: string) {
  return [...allowedDashboardWidgetIds(roleLabel)];
}

function defaultDashboardLayout(roleLabel: string): DashboardWidgetPreference[] {
  const presetName = rolePreset(roleLabel);
  const allowed = allowedWidgetIds(roleLabel);
  const allowedSet = new Set(allowed);
  const preset = roleHomeProfile(roleLabel).widgets.filter((id) => allowedSet.has(id));
  const byId = new Map(WIDGETS.map((widget) => [widget.id, widget]));
  const ordered = [...preset, ...allowed.filter((id) => !preset.includes(id))];
  return ordered.map((id) => {
    let size = byId.get(id)?.defaultSize ?? "compact";
    if (presetName === "work" && id === "decisions") size = "wide";
    if ((presetName === "owner" || presetName === "director") && id === "milestones") size = "wide";
    return { id, visible: preset.includes(id), size };
  });
}

function dashboardStorageKey(roleLabel: string, userKey: string) {
  return dashboardBrowserStorageKey(userKey, roleLabel, DASHBOARD_STORAGE_PREFIX);
}

function normalizeDashboardLayout(value: unknown, roleLabel: string): DashboardWidgetPreference[] {
  const defaults = defaultDashboardLayout(roleLabel);
  if (!value || typeof value !== "object") return defaults;
  const stored = value as { version?: unknown; widgets?: unknown };
  if (stored.version !== DASHBOARD_LAYOUT_VERSION || !Array.isArray(stored.widgets)) return defaults;

  const allowed = new Set(allowedWidgetIds(roleLabel));
  const validSizes = new Set<DashboardWidgetSize>(["compact", "wide", "full"]);
  const seen = new Set<DashboardWidgetId>();
  const normalized: DashboardWidgetPreference[] = [];
  for (const item of stored.widgets) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<DashboardWidgetPreference>;
    if (!candidate.id || !allowed.has(candidate.id) || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    normalized.push({
      id: candidate.id,
      visible: candidate.visible !== false,
      size: candidate.size && validSizes.has(candidate.size) ? candidate.size : "compact",
    });
  }
  for (const item of defaults) {
    if (!seen.has(item.id)) normalized.push(item);
  }
  return normalized;
}

function readDashboardLayout(roleLabel: string, userKey: string) {
  if (typeof window === "undefined") return defaultDashboardLayout(roleLabel);
  try {
    const raw = window.localStorage.getItem(dashboardStorageKey(roleLabel, userKey));
    return raw ? normalizeDashboardLayout(JSON.parse(raw), roleLabel) : defaultDashboardLayout(roleLabel);
  } catch {
    return defaultDashboardLayout(roleLabel);
  }
}

function persistDashboardLayout(roleLabel: string, userKey: string, widgets: DashboardWidgetPreference[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(dashboardStorageKey(roleLabel, userKey), JSON.stringify({
      version: DASHBOARD_LAYOUT_VERSION,
      role: roleLabel,
      widgets,
    }));
  } catch {
    // Personalization remains optional when browser storage is unavailable.
  }
}

type DashboardSyncStatus = "loading" | "saving" | "synced" | "local";

async function syncDashboardLayout(method: "PUT" | "DELETE", widgets?: DashboardWidgetPreference[]) {
  const response = await fetch("/api/dashboard-layout", {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "x-csrf-token": readClientCookie("__Host-arthello_csrf"),
      ...(method === "PUT" ? { "content-type": "application/json" } : {}),
    },
    body: method === "PUT" ? JSON.stringify({ version: DASHBOARD_LAYOUT_VERSION, widgets }) : undefined,
  });
  if (!response.ok) throw new Error("Dashboard layout sync failed");
}

function readClientCookie(name: string) {
  const prefix = `${name}=`;
  const item = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!item) return "";
  try { return decodeURIComponent(item.slice(prefix.length)); } catch { return ""; }
}

function sizeClass(size: DashboardWidgetSize) {
  if (size === "full") return styles.sizeFull;
  if (size === "wide") return styles.sizeWide;
  return styles.sizeCompact;
}

export function OwnerDashboard({ displayName, userKey, roleLabel, availableModules, tasks, sourceOnly, navigate, createTask, openOperation }: OwnerDashboardProps) {
  const [finance, setFinance] = useState<FinancePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState("Все типы");
  const [dashboardPeriod, setDashboardPeriod] = useState("");
  const [activeChartIndex, setActiveChartIndex] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<DashboardWidgetPreference[]>(() => defaultDashboardLayout(roleLabel));
  const [layoutSyncStatus, setLayoutSyncStatus] = useState<DashboardSyncStatus>("loading");
  const [now, setNow] = useState(() => new Date());
  const layoutRef = useRef(layout);
  const layoutRevisionRef = useRef(0);
  const syncSequenceRef = useRef(0);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);
  const dashboardUserKey = userKey?.trim() || displayName.trim() || "anonymous";

  const preset = rolePreset(roleLabel);
  const roleProfile = roleHomeProfile(roleLabel);
  const availableModuleIds = useMemo(() => new Set(availableModules.map((module) => module.id)), [availableModules]);
  const canUseTasks = availableModuleIds.has("tasks");
  const canUseFinanceWidgets = preset !== "work" && availableModuleIds.has("finance");
  const needsFinance = canUseFinanceWidgets && layout.some((item) => item.visible && FINANCE_WIDGETS.has(item.id));

  const applyLayout = useCallback((next: DashboardWidgetPreference[]) => {
    layoutRef.current = next;
    setLayout(next);
  }, []);

  const queueServerLayoutSync = useCallback((method: "PUT" | "DELETE", widgets?: DashboardWidgetPreference[]) => {
    const sequence = ++syncSequenceRef.current;
    setLayoutSyncStatus("saving");
    const queued = syncQueueRef.current
      .catch(() => undefined)
      .then(() => syncDashboardLayout(method, widgets));
    syncQueueRef.current = queued;
    void queued.then(
      () => {
        if (mountedRef.current && sequence === syncSequenceRef.current) setLayoutSyncStatus("synced");
      },
      () => {
        if (mountedRef.current && sequence === syncSequenceRef.current) setLayoutSyncStatus("local");
      },
    );
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const storageKey = dashboardStorageKey(roleLabel, dashboardUserKey);
    const localLayout = readDashboardLayout(roleLabel, dashboardUserKey);
    const startRevision = ++layoutRevisionRef.current;
    let serverResolved = false;
    const controller = new AbortController();
    const hydrationTimer = window.setTimeout(() => {
      if (!serverResolved && layoutRevisionRef.current === startRevision) {
        applyLayout(localLayout);
        setLayoutSyncStatus("loading");
      }
    }, 0);
    const synchronize = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      layoutRevisionRef.current += 1;
      try {
        applyLayout(event.newValue ? normalizeDashboardLayout(JSON.parse(event.newValue), roleLabel) : defaultDashboardLayout(roleLabel));
      } catch {
        applyLayout(defaultDashboardLayout(roleLabel));
      }
      setLayoutSyncStatus("local");
    };
    const hydrateFromServer = async () => {
      try {
        const response = await fetch("/api/dashboard-layout", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Dashboard layout hydrate failed");
        const payload = await response.json() as { layout?: unknown };
        if (controller.signal.aborted || layoutRevisionRef.current !== startRevision) return;
        serverResolved = true;
        if (payload.layout) {
          const serverLayout = normalizeDashboardLayout(payload.layout, roleLabel);
          applyLayout(serverLayout);
          persistDashboardLayout(roleLabel, dashboardUserKey, serverLayout);
          setLayoutSyncStatus("synced");
        } else {
          applyLayout(localLayout);
          queueServerLayoutSync("PUT", localLayout);
        }
      } catch {
        if (controller.signal.aborted || layoutRevisionRef.current !== startRevision) return;
        serverResolved = true;
        applyLayout(localLayout);
        setLayoutSyncStatus("local");
      }
    };
    window.addEventListener("storage", synchronize);
    void hydrateFromServer();
    return () => {
      controller.abort();
      window.clearTimeout(hydrationTimer);
      window.removeEventListener("storage", synchronize);
    };
  }, [applyLayout, dashboardUserKey, queueServerLayoutSync, roleLabel]);

  useEffect(() => {
    const updateClock = () => setNow(new Date());
    const timer = window.setInterval(updateClock, 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") updateClock();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!needsFinance) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      try {
        const periodQuery = dashboardPeriod ? `?period=${encodeURIComponent(dashboardPeriod)}` : "";
        const response = await fetch(`/api/finance${periodQuery}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as FinancePayload & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Не удалось загрузить финансовый контур");
        setFinance(payload);
        setDashboardPeriod((current) => current || payload.selectedPeriod || payload.monthly.at(-1)?.period || "");
        const selectedPeriodOperations = payload.operations.filter((operation) => operation.period === payload.selectedPeriod);
        setSelectedId((current) => selectedPeriodOperations.some((operation) => operation.id === current) ? current : selectedPeriodOperations[0]?.id || "");
        setError("");
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить финансовый контур");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [dashboardPeriod, needsFinance]);

  const updateLayout = useCallback((change: (current: DashboardWidgetPreference[]) => DashboardWidgetPreference[]) => {
    const current = layoutRef.current;
    const next = change(current);
    if (next === current) return;
    layoutRevisionRef.current += 1;
    applyLayout(next);
    persistDashboardLayout(roleLabel, dashboardUserKey, next);
    queueServerLayoutSync("PUT", next);
  }, [applyLayout, dashboardUserKey, queueServerLayoutSync, roleLabel]);

  const periodOperations = useMemo(() => finance?.operations.filter((operation) => operation.period === finance.selectedPeriod) ?? [], [finance]);
  const operations = useMemo(() => {
    const clean = query.trim().toLocaleLowerCase("ru-RU");
    return periodOperations
      .filter((operation) => direction === "Все типы" || operation.direction === direction)
      .filter((operation) => !clean || [operation.id, operation.category, operation.counterpartyEntityId, operation.contractId].some((value) => value.toLocaleLowerCase("ru-RU").includes(clean)))
      .slice(0, 6);
  }, [direction, periodOperations, query]);

  const selected = operations.find((operation) => operation.id === selectedId) ?? operations[0] ?? null;
  const firstName = displayName.trim().split(/\s+/)[0] || "Пользователь";
  const greeting = greetingForMoscow(now);
  const dashboardDate = dashboardDateForMoscow(now);
  const summary = finance?.summary;
  const financePeriod = finance?.selectedPeriod ? monthLabel(finance.selectedPeriod, "long") : "Данных пока нет";
  const hasSelectedCashData = periodOperations.length > 0;
  const hasDebtData = Boolean(finance?.accruals.length);
  const financeValue = (minor: number | undefined, available: boolean) => available && minor !== undefined ? compactMoney(minor / 100) : "—";
  const openTasks = useMemo(() => tasks.filter((task) => !COMPLETE_TASK.test(task.status)), [tasks]);
  const today = dashboardDateKeyForMoscow(now);
  const taskMetrics = [
    { label: "Открытые задачи", value: String(openTasks.length), note: openTasks.length ? "В вашем рабочем контуре" : "Очередь свободна", tone: "indigo", icon: "tasks" as const, module: "tasks" as ModuleId },
    { label: "Просрочено", value: String(openTasks.filter((task) => task.dueDate && task.dueDate < today).length), note: "По установленным срокам", tone: "red", icon: "events" as const, module: "tasks" as ModuleId },
    { label: "Высокий приоритет", value: String(openTasks.filter((task) => /высок|сроч|критич/i.test(task.priority)).length), note: "Требуют внимания", tone: "orange", icon: "safety" as const, module: "tasks" as ModuleId },
    { label: "Со сроком", value: String(openTasks.filter((task) => Boolean(task.dueDate)).length), note: "Есть контрольная дата", tone: "blue", icon: "projects" as const, module: "tasks" as ModuleId },
  ];
  const financeMetrics = [
    { label: "Чистый денежный поток", value: financeValue(summary?.netMinor, hasSelectedCashData), note: hasSelectedCashData ? financePeriod : "Подключите источник", tone: "indigo", icon: "finance" as const, module: "finance" as ModuleId },
    { label: "Поступления", value: financeValue(summary?.receiptsMinor, hasSelectedCashData), note: hasSelectedCashData ? financePeriod : "Факта пока нет", tone: "green", icon: "sales" as const, module: "finance" as ModuleId },
    { label: "Списания", value: financeValue(summary?.outflowsMinor, hasSelectedCashData), note: hasSelectedCashData ? financePeriod : "Факта пока нет", tone: "orange", icon: "legal" as const, module: "finance" as ModuleId },
    { label: "Задолженность", value: financeValue(summary?.debtMinor, hasDebtData), note: hasDebtData ? summary?.debtMinor ? "По подтверждённым начислениям" : "Подтверждённого долга нет" : "Источник начислений не подключён", tone: "red", icon: "clients" as const, module: "finance" as ModuleId },
    { label: "Операции", value: loading ? "…" : finance ? String(periodOperations.length) : "—", note: periodOperations.length ? `В реестре за ${financePeriod.toLocaleLowerCase("ru-RU")}` : "Реестр пуст", tone: "blue", icon: "registry" as const, module: "finance" as ModuleId },
    { label: "Открытые задачи", value: String(openTasks.length), note: tasks.length ? "В рабочем контуре" : "Задач пока нет", tone: "violet", icon: "hr" as const, module: "tasks" as ModuleId },
  ];
  const metrics = canUseFinanceWidgets ? financeMetrics : taskMetrics;

  const decisions = useMemo(() => openTasks.slice(0, 4), [openTasks]);
  const milestones = useMemo(() => openTasks
    .filter((task) => task.dueDate && !Number.isNaN(new Date(`${task.dueDate}T00:00:00Z`).getTime()))
    .toSorted((left, right) => left.dueDate.localeCompare(right.dueDate))
    .slice(0, 4), [openTasks]);
  const availableDashboardPeriods = useMemo(() => {
    const values = [finance?.selectedPeriod, ...(finance?.monthly.map((item) => item.period) ?? [])].filter((value): value is string => Boolean(value));
    return [...new Set(values)].sort().reverse();
  }, [finance]);
  const roleModules = useMemo(() => {
    const byId = new Map(availableModules.map((module) => [module.id, module]));
    const orderedIds = [...roleProfile.preferredModules, ...availableModules.map((module) => module.id)];
    const seen = new Set<ModuleId>();
    return orderedIds.flatMap((id) => {
      if (id === "home" || seen.has(id)) return [];
      const moduleEntry = byId.get(id);
      if (!moduleEntry) return [];
      seen.add(id);
      return [moduleEntry];
    }).slice(0, 6);
  }, [availableModules, roleProfile]);
  const chartData = useMemo(() => {
    if (!finance) return [];
    const cashPeriods = new Set(finance.operations.map((operation) => operation.period));
    return finance.monthly.filter((item) => cashPeriods.has(item.period)).slice(-12);
  }, [finance]);
  const chartGeometry = useMemo(() => {
    const width = 720;
    const height = 190;
    const left = 48;
    const right = 12;
    const top = 18;
    const bottom = 30;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const rawMax = Math.max(1, ...chartData.flatMap((item) => [item.receiptsMinor, item.outflowsMinor]));
    const step = rawMax > 900_000_000 ? 300_000_000 : rawMax > 400_000_000 ? 200_000_000 : 100_000_000;
    const max = Math.ceil(rawMax / step) * step;
    const point = (value: number, index: number) => ({
      x: left + (chartData.length === 1 ? plotWidth / 2 : index * (plotWidth / (chartData.length - 1))),
      y: top + plotHeight - (value / max) * plotHeight,
    });
    const receipts = chartData.map((item, index) => point(item.receiptsMinor, index));
    const outflows = chartData.map((item, index) => point(item.outflowsMinor, index));
    const path = (points: Array<{ x: number; y: number }>) => points.reduce((result, item, index) => {
      if (index === 0) return `M${item.x.toFixed(1)} ${item.y.toFixed(1)}`;
      const previous = points[index - 1];
      const midpoint = (previous.x + item.x) / 2;
      return `${result} C${midpoint.toFixed(1)} ${previous.y.toFixed(1)}, ${midpoint.toFixed(1)} ${item.y.toFixed(1)}, ${item.x.toFixed(1)} ${item.y.toFixed(1)}`;
    }, "");
    return {
      width, height, left, right, top, bottom, plotHeight, max, receipts, outflows,
      receiptsPath: path(receipts),
      outflowsPath: path(outflows),
      areaPath: receipts.length ? `${path(receipts)} L${receipts.at(-1)?.x} ${height - bottom} L${receipts[0].x} ${height - bottom} Z` : "",
      ticks: Array.from({ length: 5 }, (_, index) => max - (max / 4) * index),
    };
  }, [chartData]);
  const shownChartIndex = activeChartIndex ?? Math.max(chartData.length - 1, 0);
  const shownChartItem = chartData[shownChartIndex];
  const shownChartPoint = chartGeometry.receipts[shownChartIndex];
  const widgetIsAvailable = (id: DashboardWidgetId) => {
    if (id === "roleFocus") return true;
    if (id === "kpis") return canUseFinanceWidgets || canUseTasks;
    if (id === "decisions" || id === "milestones") return canUseTasks;
    if (id === "signals") return availableModuleIds.has("analytics");
    return canUseFinanceWidgets;
  };
  const allowedVisibleWidgets = new Set(allowedWidgetIds(roleLabel));
  const customizableLayout = layout.filter((item) => allowedVisibleWidgets.has(item.id) && widgetIsAvailable(item.id));
  const visibleWidgets = customizableLayout.filter((item) => item.visible);

  function showOperation(operation: FinanceOperation) {
    openOperation({
      title: operation.category,
      value: `${operation.direction === "Поступление" ? "+" : "−"}${rubles(operation.amountMinor)}`,
      summary: `${operation.id} · ${finance?.entityNames[operation.counterpartyEntityId] ?? operation.counterpartyEntityId}`,
      source: `${operation.sourceFile} · ${operation.sourceSheet} · ${operation.sourceRef}`,
      calculation: `${operation.direction}; статья ${operation.reportClass}; исходная сумма операции без перезаписи`,
      updated: formatDate(operation.operationDate),
      owner: "Финансовый контролёр",
      quality: operation.dataQuality || operation.status,
      lineage: ["Источник", "Банковская операция", "Контрагент", "Договор", "Статья ДДС", "Документ"],
    });
  }

  function changeWidget(id: DashboardWidgetId, patch: Partial<DashboardWidgetPreference>) {
    updateLayout((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function moveWidget(id: DashboardWidgetId, directionToMove: -1 | 1) {
    updateLayout((current) => {
      const index = current.findIndex((item) => item.id === id);
      const nextIndex = index + directionToMove;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  function resetLayout() {
    const next = defaultDashboardLayout(roleLabel);
    layoutRevisionRef.current += 1;
    try {
      window.localStorage.removeItem(dashboardStorageKey(roleLabel, dashboardUserKey));
    } catch {
      // The default layout still applies even if storage is locked.
    }
    applyLayout(next);
    queueServerLayoutSync("DELETE");
  }

  function renderWidget(widget: DashboardWidgetPreference) {
    if (widget.id === "kpis") return <section className={styles.kpiPanel} aria-label="Ключевые показатели">
      <div className={`${styles.kpis} owner-dashboard-kpis`} data-help-block="kpis">
        {metrics.map((metric) => (
          <button key={metric.label} type="button" onClick={() => navigate(metric.module)} className={`${styles[metric.tone]} owner-dashboard-kpi`}>
            <span className={`${styles.kpiIcon} owner-dashboard-kpi-icon`}><AppIcon name={metric.icon} /></span>
            <span className={`${styles.kpiCopy} owner-dashboard-kpi-copy`}><small>{metric.label}</small><strong>{metric.value}</strong><em>{metric.note}</em></span>
          </button>
        ))}
      </div>
    </section>;

    if (widget.id === "roleFocus") return <article className={`${styles.panel} ${styles.roleFocus}`} data-help-block="role-focus">
      <header><span><strong>{roleProfile.title}</strong><small>{roleProfile.description}</small></span><em>{roleModules.length} {roleModules.length === 1 ? "раздел" : roleModules.length < 5 ? "раздела" : "разделов"}</em></header>
      {roleModules.length ? <div className={styles.roleModuleGrid}>
        {roleModules.map((moduleEntry) => <button key={moduleEntry.id} type="button" onClick={() => navigate(moduleEntry.id)}>
          <span className={styles.roleModuleIcon}><AppIcon name={moduleEntry.id} /></span>
          <span><strong>{moduleEntry.label}</strong><small>Открыть рабочий раздел</small></span>
          <AppIcon name="chevron" />
        </button>)}
      </div> : <div data-ah-compact-card="true" className={styles.inlineEmpty}><strong>Дополнительных разделов нет</strong><span>На главной показан только доступный для этой учётной записи рабочий контур.</span></div>}
    </article>;

    if (widget.id === "decisions") return <article className={styles.panel} data-help-block="decisions">
      <header><span><strong>Что требует решения</strong><small>{decisions.length ? `${decisions.length} ближайших` : "Очередь свободна"}</small></span><button onClick={() => navigate("tasks")}>Все задачи</button></header>
      <div data-ah-compact-card="true" className={styles.decisionList}>
        {decisions.length ? decisions.map((task) => (
          <button key={task.id} onClick={() => navigate("tasks")}>
            <AppIcon name="tasks" />
            <span><strong>{task.title}</strong><small>{task.sourceId || "Ручная задача"}</small></span>
            <em>{task.dueDate ? formatDate(task.dueDate) : task.status}</em>
          </button>
        )) : <div data-ah-compact-card="true" className={styles.inlineEmpty}><strong>Открытых решений нет</strong><span>Здесь появятся только реальные задачи, которым нужно ваше действие.</span><button onClick={createTask}>Создать задачу</button></div>}
      </div>
    </article>;

    if (widget.id === "signals") return <article className={styles.panel} data-help-block="signals">
      <header><span><strong>Сигналы и риски</strong><small>По подтверждённым данным</small></span><button onClick={() => navigate("analytics")}>Аналитика</button></header>
      <div data-ah-compact-card="true" className={styles.signalList}>
        <div data-ah-compact-card="true" className={styles.inlineEmpty}>
          <strong>Подтверждённых сигналов нет</strong>
          <span>Система не будет придумывать риски: они появятся после подключения и проверки источников.</span>
          <button onClick={() => navigate("integrations")}>Подключить источник</button>
        </div>
      </div>
    </article>;

    if (widget.id === "milestones") return <article className={styles.panel} data-help-block="milestones">
      <header><span><strong>Контрольные точки</strong><small>{milestones.length ? "По срокам задач" : "Дат пока нет"}</small></span><button onClick={() => navigate("tasks")}>Открыть задачи</button></header>
      <div data-ah-compact-card="true" className={styles.eventList}>
        {milestones.length ? milestones.map((task) => <button key={task.id} onClick={() => navigate("tasks")}>
          <time dateTime={task.dueDate}>{formatDate(task.dueDate).slice(0, 5)}</time>
          <span><strong>{task.title}</strong><small>{task.priority || task.status}</small></span>
        </button>) : <div data-ah-compact-card="true" className={styles.inlineEmpty}>
          <strong>Контрольных точек пока нет</strong>
          <span>Добавьте срок в задачу — дата автоматически появится здесь.</span>
          <button onClick={createTask}>Создать задачу</button>
        </div>}
      </div>
    </article>;

    if (widget.id === "cashflow") return <article className={`${styles.panel} ${chartStyles.chartPanel}`} data-help-block="cashflow">
      <header><span><strong>Денежный поток</strong><small>{chartData.length ? `${monthLabel(chartData[0].period)} — ${monthLabel(chartData.at(-1)?.period ?? chartData[0].period, "long")}` : "Фактические данные ОДДС"}</small></span><button onClick={() => navigate("finance")}>Открыть отчёт</button></header>
      {shownChartItem ? <div className={chartStyles.chartLegend} aria-live="polite">
        <span><i className={chartStyles.inDot} /><small>Поступления</small><strong>{compactMoney(shownChartItem.receiptsMinor / 100)}</strong></span>
        <span><i className={chartStyles.outDot} /><small>Списания</small><strong>{compactMoney(shownChartItem.outflowsMinor / 100)}</strong></span>
        <span className={shownChartItem.netMinor >= 0 ? chartStyles.netPositive : chartStyles.netNegative}><small>Сальдо</small><strong>{shownChartItem.netMinor >= 0 ? "+" : "−"}{compactMoney(Math.abs(shownChartItem.netMinor) / 100)}</strong></span>
      </div> : null}
      {loading && !chartData.length ? <div data-ah-compact-card="true" className={styles.inlineEmpty}><span className={styles.loader} /><strong>Загружаем денежный поток…</strong></div> : error && !chartData.length ? <div data-ah-compact-card="true" className={styles.inlineEmpty}><strong>Данные временно недоступны</strong><span>{error}</span><button onClick={() => navigate("finance")}>Открыть финансы</button></div> : chartData.length ? <div className={chartStyles.lineChart} onMouseLeave={() => setActiveChartIndex(null)} role="group" aria-label="График поступлений и списаний по месяцам">
        <svg viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`} role="img" aria-label="Фактическая динамика поступлений и списаний из ОДДС">
          <defs><linearGradient id="cashflow-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5b56f5" stopOpacity=".17" /><stop offset="100%" stopColor="#5b56f5" stopOpacity="0" /></linearGradient></defs>
          {chartGeometry.ticks.map((tick, index) => {
            const y = chartGeometry.top + index * (chartGeometry.plotHeight / 4);
            return <g key={tick}><line x1={chartGeometry.left} y1={y} x2={chartGeometry.width - chartGeometry.right} y2={y} className={chartStyles.gridLine} /><text x={chartGeometry.left - 8} y={y + 3} textAnchor="end" className={chartStyles.yLabel}>{chartTick(tick)}</text></g>;
          })}
          {chartData.map((item, index) => <line key={item.period} x1={chartGeometry.receipts[index].x} y1={chartGeometry.top} x2={chartGeometry.receipts[index].x} y2={chartGeometry.height - chartGeometry.bottom} className={chartStyles.verticalGrid} />)}
          <path d={chartGeometry.areaPath} className={chartStyles.inArea} />
          <path d={chartGeometry.outflowsPath} className={chartStyles.outLine} />
          <path d={chartGeometry.receiptsPath} className={chartStyles.inLine} />
          {chartGeometry.receipts.map((point, index) => <g key={chartData[index].period}>
            <circle cx={point.x} cy={point.y} r={shownChartIndex === index ? 4 : 2.7} className={chartStyles.inPoint} />
            <circle cx={chartGeometry.outflows[index].x} cy={chartGeometry.outflows[index].y} r={shownChartIndex === index ? 4 : 2.7} className={chartStyles.outPoint} />
          </g>)}
          {activeChartIndex !== null && shownChartPoint ? <line x1={shownChartPoint.x} y1={chartGeometry.top} x2={shownChartPoint.x} y2={chartGeometry.height - chartGeometry.bottom} className={chartStyles.crosshair} /> : null}
          {chartData.map((item, index) => {
            const labelStep = Math.max(1, Math.ceil(chartData.length / 6));
            return index % labelStep === 0 || index === chartData.length - 1
              ? <text key={`${item.period}-label`} x={chartGeometry.receipts[index].x} y={chartGeometry.height - 8} textAnchor="middle" className={chartStyles.xLabel}>{monthLabel(item.period)}</text>
              : null;
          })}
        </svg>
        <div className={chartStyles.chartHitGrid} style={{ left: `${(chartGeometry.left / chartGeometry.width) * 100}%`, right: `${(chartGeometry.right / chartGeometry.width) * 100}%`, gridTemplateColumns: `repeat(${Math.max(chartData.length, 1)}, 1fr)` }}>
          {chartData.map((item, index) => <button key={item.period} type="button" aria-label={`${monthLabel(item.period, "long")}: открыть операции`} onMouseEnter={() => setActiveChartIndex(index)} onFocus={() => setActiveChartIndex(index)} onClick={() => navigate("finance")} />)}
        </div>
        {activeChartIndex !== null && shownChartItem && shownChartPoint ? <div className={chartStyles.chartTooltip} style={{ left: `${(shownChartPoint.x / chartGeometry.width) * 100}%` }}><strong>{monthLabel(shownChartItem.period, "long")}</strong><span>Факт ОДДС · нажмите для детализации</span></div> : null}
      </div> : <div data-ah-compact-card="true" className={styles.inlineEmpty}><strong>Движений денег пока нет</strong><span>График появится после первой операции из подключённого банка или подтверждённого импорта.</span><button onClick={() => navigate("integrations")}>Подключить источник</button></div>}
    </article>;

    if (widget.id === "operations") return <article className={`${styles.panel} ${styles.registry}`} data-help-block="operations">
      <header><span><strong>Реестр операций</strong><small>{finance?.selectedPeriod ? monthLabel(finance.selectedPeriod, "long") : "Фактические банковские данные"}</small></span><button onClick={() => navigate("finance")}>Все операции</button></header>
      <div className={styles.registryToolbar}>
        <label className={styles.periodSelect}><span className="sr-only">Месяц реестра операций</span><select value={dashboardPeriod} onChange={(event) => setDashboardPeriod(event.target.value)} aria-label="Месяц реестра операций">{availableDashboardPeriods.length ? availableDashboardPeriods.map((item) => <option key={item} value={item}>{monthLabel(item, "long")}</option>) : <option value={dashboardPeriod}>{dashboardPeriod ? monthLabel(dashboardPeriod, "long") : "Период не выбран"}</option>}</select></label>
        <select value={direction} onChange={(event) => setDirection(event.target.value)} aria-label="Тип операции"><option>Все типы</option><option>Поступление</option><option>Списание</option></select>
        <label className={styles.registrySearch}><AppIcon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по реестру" /></label>
        <button type="button" onClick={() => navigate("finance")}><AppIcon name="settings" /> Фильтры</button>
      </div>
      <div className={styles.registrySummary}><span>Записей: <strong>{periodOperations.length}</strong></span><span>Поступления: <strong>{hasSelectedCashData && summary ? rubles(summary.receiptsMinor) : "—"}</strong></span><span>Списания: <strong>{hasSelectedCashData && summary ? rubles(summary.outflowsMinor) : "—"}</strong></span></div>
      <div className={selected ? styles.registryContent : undefined}>
        <div className={styles.registryMain}>
          {loading ? <div data-ah-compact-card="true" className={styles.registryState}><span className={styles.loader} /><strong>Загружаем реестр…</strong></div> : error ? <div data-ah-compact-card="true" className={styles.registryState}><strong>Реестр временно недоступен</strong><span>{error}</span><button onClick={() => navigate("finance")}>Открыть финансовый раздел</button></div> : operations.length ? (
            <div className={styles.tableWrap}><table><thead><tr><th>Дата</th><th>Контрагент</th><th>Назначение</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>{operations.map((operation) => (
              <tr key={operation.id} className={selected?.id === operation.id ? styles.selectedRow : ""} onClick={() => setSelectedId(operation.id)} onDoubleClick={() => showOperation(operation)} tabIndex={0} role="button" aria-pressed={selected?.id === operation.id} aria-label={`${operation.direction}: ${operation.category}, ${rubles(operation.amountMinor)}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showOperation(operation); } }}>
                <td>{formatDate(operation.operationDate)}</td><td><strong>{finance?.entityNames[operation.counterpartyEntityId] ?? operation.counterpartyEntityId}</strong><small>{operation.contractId || "Без договора"}</small></td><td><strong>{operation.category}</strong><small>{operation.reportClass}</small></td><td className={operation.direction === "Поступление" ? styles.income : styles.expense}>{operation.direction === "Поступление" ? "+" : "−"}{rubles(operation.amountMinor)}</td><td><span className={styles.status}>{operation.status}</span></td>
              </tr>
            ))}</tbody></table></div>
          ) : <div data-ah-compact-card="true" className={styles.registryState}><strong>Операций пока нет</strong><span>{sourceOnly ? "Демонстрационных записей нет. Реестр заполнится после подключения банка." : "В выбранном периоде нет операций."}</span><button onClick={() => navigate("integrations")}>Подключить банк</button></div>}
        </div>
        {selected ? <aside className={styles.preview} aria-live="polite" data-help-block="operation-preview">
          <header><span><strong>{selected.direction}</strong><small>{formatDate(selected.operationDate)}</small></span><button aria-label="Открыть полную карточку" onClick={() => showOperation(selected)}><AppIcon name="more" /></button></header>
          <div className={styles.operationHero}><strong>{selected.direction === "Поступление" ? "+" : "−"}{rubles(selected.amountMinor)}</strong><small>{selected.status} · {selected.dataQuality}</small></div>
          <dl><div><dt>Контрагент</dt><dd>{finance?.entityNames[selected.counterpartyEntityId] ?? selected.counterpartyEntityId}</dd></div><div><dt>Назначение</dt><dd>{selected.category}</dd></div><div><dt>Источник</dt><dd>{selected.sourceFile}</dd></div></dl>
          <footer><button onClick={() => showOperation(selected)}>Открыть карточку</button></footer>
        </aside> : null}
      </div>
    </article>;

    return null;
  }

  return (
    <section className={`${styles.dashboard} owner-home-dashboard`} data-ah-inline-help="off" aria-label={`Персональный дашборд: ${roleLabel}`}>
      <header className={styles.heading}>
        <div>
          <span className={styles.role}>{roleLabel}</span>
          <h1 suppressHydrationWarning>{greeting}, {firstName}!</h1>
          <p suppressHydrationWarning>{dashboardDate}</p>
        </div>
        <div className={styles.headingActions}>
          <span className={`${styles.syncStatus} ${styles[`syncStatus_${layoutSyncStatus}`]}`} aria-live="polite">
            <i aria-hidden="true" />
            {layoutSyncStatus === "loading" ? "Проверяем настройки" : layoutSyncStatus === "saving" ? "Сохраняем экран" : layoutSyncStatus === "synced" ? "Экран синхронизирован" : "Сохранено локально"}
          </span>
          <button type="button" className={editing ? styles.secondaryActive : styles.secondary} aria-pressed={editing} onClick={() => setEditing((current) => !current)}><AppIcon name="settings" /> {editing ? "Готово" : "Настроить экран"}</button>
          {canUseTasks ? <button type="button" className={styles.primary} onClick={createTask}><AppIcon name="plus" /> Новая задача</button> : null}
        </div>
      </header>

      {editing ? <section className={styles.customizer} aria-label="Настройка главного экрана">
        <header><div><strong>Ваш главный экран</strong><span>Показывайте только нужное. Порядок и размер сохраняются отдельно для роли «{roleLabel}».</span></div><button type="button" onClick={resetLayout}>Вернуть настройки роли</button></header>
        <div className={styles.customizerList}>
          {customizableLayout.map((item, index) => {
            const definition = WIDGETS.find((widget) => widget.id === item.id)!;
            return <div key={item.id} className={item.visible ? styles.customizerItem : styles.customizerItemHidden}>
              <label><input type="checkbox" checked={item.visible} onChange={(event) => changeWidget(item.id, { visible: event.target.checked })} /><span><strong>{definition.title}</strong><small>{definition.description}</small></span></label>
              <div className={styles.orderButtons}><button type="button" disabled={index === 0} onClick={() => moveWidget(item.id, -1)} aria-label={`Переместить «${definition.title}» выше`}>↑</button><button type="button" disabled={index === customizableLayout.length - 1} onClick={() => moveWidget(item.id, 1)} aria-label={`Переместить «${definition.title}» ниже`}>↓</button></div>
              <label className={styles.sizeSelect}><span>Размер</span><select value={item.size} onChange={(event) => changeWidget(item.id, { size: event.target.value as DashboardWidgetSize })} aria-label={`Размер блока «${definition.title}»`}><option value="compact">Компактный</option><option value="wide">Широкий</option><option value="full">На всю ширину</option></select></label>
            </div>;
          })}
        </div>
      </section> : null}

      {visibleWidgets.length ? <div className={styles.widgetGrid}>
        {visibleWidgets.map((widget) => <div key={widget.id} className={`${styles.widget} ${sizeClass(widget.size)} ${editing ? styles.widgetEditing : ""}`} data-dashboard-widget={widget.id}>
          {editing ? <div className={styles.widgetBadge}><span>{WIDGETS.find((item) => item.id === widget.id)?.title}</span><button type="button" onClick={() => changeWidget(widget.id, { visible: false })}>Скрыть</button></div> : null}
          {renderWidget(widget)}
        </div>)}
      </div> : <div data-ah-compact-card="true" className={styles.dashboardEmpty}><strong>Все блоки скрыты</strong><span>Откройте настройку экрана и включите хотя бы один нужный блок.</span><button type="button" onClick={() => setEditing(true)}>Настроить главный экран</button></div>}
    </section>
  );
}
